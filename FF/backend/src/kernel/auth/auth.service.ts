// 인증(OIDC BFF) — 출시 준비 RD-SEC-01·RD-SEC-04·RD-SEC-05.
//  · 로그인: 인가 코드 + PKCE(S256) + state + nonce. 셋은 서명한 짧은 수명 httpOnly 쿠키(ff_oidc)에 둔다
//  · 세션: 서버 쪽 표(auth_session). 쿠키 ff_session에는 무작위 32바이트 ID(서명), 표에는 SHA-256만
//  · Bearer: API 클라이언트의 접근 토큰을 JWKS로 검증(발급자·대상 OIDC_AUDIENCE·만료)
//  · 역할: IdP 그룹 클레임 → OIDC_ROLE_MAP. 맵에 걸리는 역할이 없으면 로그인 거부(감사 DENIED)
// 데모 모드(FF_AUTH=demo)에서는 이 서비스가 아무것도 하지 않는다 — 신원은 지금까지처럼 X-Actor-* 헤더(actor.ts).
import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@ff/contracts';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { Actor } from '../actor';
import { AuditService } from '../audit.service';
import { DB, type Db } from '../db';
import { DomainError } from '../errors';
import { authModeOf, claimValues, mapRoles, oidcConfigOf, type AuthMode, type OidcConfig } from './auth-config';
import { readCookie, safeEqual, signValue, unsignValue } from './cookies';
import { JwtError, type JwtClaims } from './jwt';
import { OidcClient, OidcError } from './oidc-client';

export const SESSION_COOKIE = 'ff_session';
export const LOGIN_COOKIE = 'ff_oidc';
/** 로그인 상태 쿠키 수명 — IdP 화면에서 머무를 수 있는 시간 */
export const LOGIN_TTL_SEC = 600;
/** 유휴 갱신(last_seen_at) 쓰기 간격 — 요청마다 쓰지 않게 */
const TOUCH_EVERY_MS = 30_000;

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  roles: Role[];
}

export interface Identity extends AuthUser {
  via: 'session' | 'bearer';
}

/** 로그인 실패 — 사용자에게 보여 줄 말(비밀·토큰 값 없음) */
export class AuthFailure extends Error {
  constructor(
    readonly code: 'LOGIN_STATE' | 'IDP_ERROR' | 'TOKEN' | 'NO_ROLE' | 'IDP_UNAVAILABLE',
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const b64u = (n: number) => randomBytes(n).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * 안전한 되돌아갈 곳 — 같은 출처의 상대 경로만('/'로 시작하고 '//'·'/\'가 아님, 제어 문자·역슬래시 없음).
 * 아니면 '/'. 열린 리디렉트(open redirect) 방지.
 */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 2048) return '/';
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return '/';
  // 브라우저는 탭·줄바꿈을 지우고 해석한다('/\t/evil' → '//evil')
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return '/';
  }
  if (v.startsWith('/api/auth/')) return '/';
  return v;
}

interface LoginState {
  s: string;
  n: string;
  v: string;
  r: string;
  t: number;
}

interface SessionRow {
  id_hash: string;
  sub: string;
  name: string | null;
  email: string | null;
  roles: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

@Injectable()
export class AuthService {
  readonly mode: AuthMode = authModeOf();
  readonly cfg: OidcConfig | null = this.mode === 'oidc' ? oidcConfigOf() : null;
  /** 시험이 바꿔 끼운다(유휴·절대 만료) — 세션 시각은 실제 시각(Clock 고정과 무관: IdP 토큰 만료가 실제 시각이다) */
  now: () => number = Date.now;
  private client: OidcClient | null = this.cfg ? new OidcClient(this.cfg, () => this.now()) : null;
  private readonly listeners: ((user: AuthUser) => void)[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  get oidc(): OidcClient {
    if (!this.client) throw new DomainError('NOT_FOUND', 'SSO 로그인은 FF_AUTH=oidc에서만 씁니다.');
    return this.client;
  }

  private get config(): OidcConfig {
    if (!this.cfg) throw new DomainError('NOT_FOUND', 'SSO 로그인은 FF_AUTH=oidc에서만 씁니다.');
    return this.cfg;
  }

  /** 세션을 만들 때마다(로그인) — 승인자 서명 키 등록(HSM)이 여기에 붙는다 */
  onSessionCreated(fn: (user: AuthUser) => void) {
    this.listeners.push(fn);
  }

  // ── 로그인 ─────────────────────────────────────────
  async beginLogin(returnTo: unknown, loginHint?: unknown): Promise<{ url: string; cookie: string }> {
    const cfg = this.config;
    const meta = await this.oidc.meta().catch((e) => {
      throw new AuthFailure('IDP_UNAVAILABLE', e instanceof OidcError ? e.message : 'IdP에 연결할 수 없습니다', 503);
    });
    const st: LoginState = { s: b64u(24), n: b64u(24), v: b64u(48), r: safeReturnTo(returnTo), t: this.now() };
    const challenge = createHash('sha256').update(st.v).digest('base64url');
    const u = new URL(meta.authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('scope', cfg.scopes);
    u.searchParams.set('state', st.s);
    u.searchParams.set('nonce', st.n);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    if (typeof loginHint === 'string' && /^[\w.@+-]{1,128}$/.test(loginHint)) u.searchParams.set('login_hint', loginHint);
    const cookie = signValue(cfg.sessionSecret, 'login', Buffer.from(JSON.stringify(st)).toString('base64url'));
    return { url: u.toString(), cookie };
  }

  /** 콜백 — state 확인 → 코드 교환 → id_token 검증 → 역할 매핑 → 세션 */
  async finishLogin(query: Record<string, unknown>, loginCookie: string | null): Promise<{ user: AuthUser; sessionCookie: string; returnTo: string }> {
    const cfg = this.config;
    const raw = unsignValue(cfg.sessionSecret, 'login', loginCookie);
    let st: LoginState | null = null;
    try {
      st = raw ? (JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as LoginState) : null;
    } catch {
      st = null;
    }
    if (!st || typeof st.s !== 'string' || typeof st.n !== 'string' || typeof st.v !== 'string' || typeof st.t !== 'number') {
      throw new AuthFailure('LOGIN_STATE', '로그인 요청 정보가 없거나 바뀌었습니다. 처음부터 다시 로그인하세요.');
    }
    if (this.now() - st.t > LOGIN_TTL_SEC * 1000) throw new AuthFailure('LOGIN_STATE', '로그인 요청 시간이 지났습니다. 다시 로그인하세요.');
    const state = typeof query.state === 'string' ? query.state : '';
    if (!state || !safeEqual(state, st.s)) throw new AuthFailure('LOGIN_STATE', '로그인 요청이 맞지 않습니다(state 불일치). 처음부터 다시 로그인하세요.');
    if (typeof query.error === 'string') {
      const e = query.error.replace(/[^a-z_]/gi, '').slice(0, 40);
      throw new AuthFailure('IDP_ERROR', `회사 계정(IdP)이 로그인을 거부했습니다 (${e}).`, 401);
    }
    const code = typeof query.code === 'string' && query.code.length <= 4096 ? query.code : '';
    if (!code) throw new AuthFailure('LOGIN_STATE', '인가 코드가 없습니다. 다시 로그인하세요.');

    let claims: JwtClaims;
    let accessToken: string | undefined;
    try {
      const t = await this.oidc.exchange(code, st.v);
      accessToken = t.accessToken;
      claims = await this.oidc.verifyIdToken(t.idToken, st.n);
    } catch (e) {
      if (e instanceof JwtError) throw new AuthFailure('TOKEN', `IdP가 준 신원 토큰을 받을 수 없습니다 (${e.reason}).`, 401);
      if (e instanceof OidcError) throw new AuthFailure(e.reason === 'TOKEN_EXCHANGE_FAILED' ? 'TOKEN' : 'IDP_UNAVAILABLE', e.message, e.reason === 'TOKEN_EXCHANGE_FAILED' ? 401 : 503);
      throw e;
    }
    let groups = claimValues(claims, cfg.roleClaim);
    let source: Record<string, unknown> = claims;
    if (!groups.length && accessToken) {
      // 그룹 클레임을 id_token에 넣지 않는 IdP 설정 — userinfo에서 (같은 주체일 때만)
      const info = await this.oidc.userinfo(accessToken).catch(() => null);
      if (info && info.sub === claims.sub) {
        groups = claimValues(info, cfg.roleClaim);
        source = { ...info, ...claims };
      }
    }
    const user: AuthUser = { id: claims.sub!, name: strClaim(source, 'name') ?? strClaim(source, 'preferred_username'), email: strClaim(source, 'email'), roles: mapRoles(groups, cfg.roleMap) };
    if (!user.roles.length) {
      this.audit.denied(probeActor(user.id), 'AUTH_LOGIN', user.id, `IdP 그룹이 플랫폼 역할에 매핑되지 않음(그룹 ${groups.length}개, 클레임 ${cfg.roleClaim})`, 'D06-09');
      throw new AuthFailure('NO_ROLE', '회사 계정으로 확인됐지만 이 플랫폼의 역할이 없습니다. 관리자에게 IdP 그룹(역할) 부여를 요청하세요.', 403);
    }
    const sessionCookie = this.createSession(user);
    return { user, sessionCookie, returnTo: safeReturnTo(st.r) };
  }

  /** 세션 만들기 — 쿠키 값(서명된 ID)을 돌려준다 */
  createSession(user: AuthUser): string {
    const cfg = this.config;
    const id = b64u(32);
    const now = this.now();
    const iso = (t: number) => new Date(t).toISOString();
    this.db.tx(() => {
      // 끝난 세션 정리 — 표가 무한히 늘지 않게
      this.db.run('DELETE FROM auth_session WHERE expires_at <= ?', iso(now));
      this.db.run(
        'INSERT INTO auth_session (id_hash, sub, name, email, roles, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        sha256(id),
        user.id,
        user.name,
        user.email,
        JSON.stringify(user.roles),
        iso(now),
        iso(now + cfg.sessionTtlMin * 60_000),
        iso(now),
      );
      this.audit.record(actorOfUser(user), 'AUTH_LOGIN', user.id, { after: { roles: user.roles, via: 'oidc' }, componentId: 'D06-09' });
      for (const fn of this.listeners) fn(user);
    });
    return signValue(cfg.sessionSecret, 'session', id);
  }

  private sessionIdOf(req: Request): string | null {
    if (!this.cfg) return null;
    return unsignValue(this.cfg.sessionSecret, 'session', readCookie(req, SESSION_COOKIE));
  }

  /** 세션 쿠키 → 사용자. 절대 수명·유휴 만료가 지나면 지우고 null. 살아 있으면 유휴 시각을 늦춘다 */
  sessionUser(req: Request): AuthUser | null {
    const cfg = this.cfg;
    const id = this.sessionIdOf(req);
    if (!cfg || !id) return null;
    const hash = sha256(id);
    const row = this.db.get<SessionRow>('SELECT * FROM auth_session WHERE id_hash = ?', hash);
    if (!row) return null;
    const now = this.now();
    const idle = now - Date.parse(row.last_seen_at) >= cfg.sessionIdleMin * 60_000;
    if (Date.parse(row.expires_at) <= now || idle) {
      this.db.run('DELETE FROM auth_session WHERE id_hash = ?', hash);
      return null;
    }
    if (now - Date.parse(row.last_seen_at) >= TOUCH_EVERY_MS) this.db.run('UPDATE auth_session SET last_seen_at = ? WHERE id_hash = ?', new Date(now).toISOString(), hash);
    let roles: Role[] = [];
    try {
      roles = JSON.parse(row.roles);
    } catch {
      roles = [];
    }
    return { id: row.sub, name: row.name, email: row.email, roles };
  }

  /** 요청 쿠키의 세션을 지운다(있으면 주체) — 로그아웃·다시 로그인(세션 고정 방지)에서 */
  dropSession(req: Request, action = 'AUTH_LOGOUT'): string | null {
    const id = this.sessionIdOf(req);
    if (!id) return null;
    const hash = sha256(id);
    const row = this.db.get<SessionRow>('SELECT * FROM auth_session WHERE id_hash = ?', hash);
    if (!row) return null;
    this.db.tx(() => {
      this.db.run('DELETE FROM auth_session WHERE id_hash = ?', hash);
      this.audit.record(probeActor(row.sub), action, row.sub, { componentId: 'D06-09' });
    });
    return row.sub;
  }

  /** 로그아웃 — 세션을 지운다. IdP 로그아웃 주소(있으면) */
  async logout(req: Request): Promise<{ endSessionUrl?: string }> {
    if (!this.cfg || !this.dropSession(req)) return {};
    const meta = await this.oidc.meta().catch(() => null);
    if (!meta?.end_session_endpoint) return {};
    const u = new URL(meta.end_session_endpoint);
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('post_logout_redirect_uri', `${this.cfg.publicUrl}/login`);
    return { endSessionUrl: u.toString() };
  }

  /**
   * 요청의 신원 — Authorization: Bearer가 있으면 그것만(틀리면 401, 쿠키로 넘어가지 않는다), 없으면 세션 쿠키.
   * 신원이 없으면 null. 데모 모드면 항상 null.
   */
  async identify(req: Request): Promise<Identity | null> {
    if (!this.cfg) return null;
    const authz = req.header('authorization');
    if (authz !== undefined) {
      const m = /^Bearer[ ]+([A-Za-z0-9._~+/=-]+)$/.exec(authz.trim());
      if (!m) throw new DomainError('UNAUTHENTICATED', 'Authorization 머리글은 "Bearer <접근 토큰>" 형식이어야 합니다.');
      let claims: JwtClaims;
      try {
        claims = await this.oidc.verifyAccessToken(m[1]);
      } catch (e) {
        const reason = e instanceof JwtError ? e.reason : e instanceof OidcError ? e.reason : 'INVALID';
        throw new DomainError('UNAUTHENTICATED', `접근 토큰을 받을 수 없습니다 (${reason}).`, { reason });
      }
      const roles = mapRoles(claimValues(claims, this.cfg.roleClaim), this.cfg.roleMap);
      return { id: claims.sub!, name: strClaim(claims, 'name') ?? strClaim(claims, 'preferred_username'), email: strClaim(claims, 'email'), roles, via: 'bearer' };
    }
    const u = this.sessionUser(req);
    return u ? { ...u, via: 'session' } : null;
  }

  /** CSRF — 쿠키로 인증한 변경 요청은 Origin이 설치 출처(또는 FF_CORS_ORIGINS)여야 한다 */
  originAllowed(req: Request): boolean {
    const o = req.header('origin');
    return !!o && !!this.cfg && this.cfg.allowedOrigins.includes(o);
  }
}

const strClaim = (c: Record<string, unknown>, k: string): string | null => (typeof c[k] === 'string' && (c[k] as string).length <= 256 ? (c[k] as string) : null);

/** 감사용 행위자 — 로그인 기록은 사용자의 첫 역할 */
const actorOfUser = (u: AuthUser): Actor => ({ id: u.id, role: u.roles[0] ?? 'AUDITOR', roles: u.roles, correlationId: randomBytes(8).toString('hex') });
/** 역할이 아직 없는(또는 모르는) 주체 — 감사 행 역할 칸은 최소 권한 조회자 */
const probeActor = (sub: string): Actor => ({ id: sub, role: 'AUDITOR', roles: [], correlationId: randomBytes(8).toString('hex') });
