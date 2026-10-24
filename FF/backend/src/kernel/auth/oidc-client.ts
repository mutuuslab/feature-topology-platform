// OIDC 클라이언트 — 디스커버리·JWKS 캐시·인가 코드 교환(BFF 기밀 클라이언트). 전역 fetch만 쓴다.
//  · 디스커버리(/.well-known/openid-configuration)는 발급자가 같아야 받는다(혼동 방지), 캐시 1시간
//  · JWKS 캐시 10분. 모르는 kid면 다시 받되 30초에 한 번만(위조 kid로 IdP를 두드리지 못하게), 키 수 상한 64
//  · 응답 크기 상한 1 MiB·시간 제한 10초 — IdP가 느리거나 거대해도 백엔드가 묶이지 않게
import type { OidcConfig } from './auth-config';
import { verifyJwt, type Jwk, type JwtClaims, type JwtHeader } from './jwt';

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

export class OidcError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 3_600_000;
const JWKS_TTL_MS = 600_000;
const JWKS_REFETCH_MIN_MS = 30_000;
const MAX_KEYS = 64;

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, redirect: 'error', headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
    const text = await res.text();
    if (text.length > MAX_BODY) throw new OidcError('IDP_RESPONSE_TOO_LARGE', 'IdP 응답이 너무 큽니다');
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof OidcError) throw e;
    throw new OidcError('IDP_UNREACHABLE', 'IdP에 연결할 수 없습니다');
  } finally {
    clearTimeout(t);
  }
}

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v);

export class OidcClient {
  private discovery: { at: number; doc: Discovery } | null = null;
  private jwks: { at: number; keys: Jwk[] } | null = null;
  private lastJwksFetch = 0;
  private inflight: Promise<Jwk[]> | null = null;

  constructor(
    private readonly cfg: OidcConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async meta(): Promise<Discovery> {
    if (this.discovery && this.now() - this.discovery.at < DISCOVERY_TTL_MS) return this.discovery.doc;
    const { status, body } = await fetchJson(`${this.cfg.issuer}/.well-known/openid-configuration`);
    const d = body as Partial<Discovery> | null;
    if (status !== 200 || !d) throw new OidcError('DISCOVERY_FAILED', `IdP 설정(디스커버리)을 읽을 수 없습니다 (HTTP ${status})`);
    if (typeof d.issuer !== 'string' || d.issuer.replace(/\/+$/, '') !== this.cfg.issuer) throw new OidcError('DISCOVERY_ISSUER_MISMATCH', 'IdP 디스커버리의 issuer가 OIDC_ISSUER와 다릅니다');
    if (!isUrl(d.authorization_endpoint) || !isUrl(d.token_endpoint) || !isUrl(d.jwks_uri)) throw new OidcError('DISCOVERY_INCOMPLETE', 'IdP 디스커버리에 인가·토큰·JWKS 주소가 없습니다');
    const doc: Discovery = {
      issuer: d.issuer,
      authorization_endpoint: d.authorization_endpoint,
      token_endpoint: d.token_endpoint,
      jwks_uri: d.jwks_uri,
      ...(isUrl(d.userinfo_endpoint) && { userinfo_endpoint: d.userinfo_endpoint }),
      ...(isUrl(d.end_session_endpoint) && { end_session_endpoint: d.end_session_endpoint }),
      ...(Array.isArray(d.token_endpoint_auth_methods_supported) && { token_endpoint_auth_methods_supported: d.token_endpoint_auth_methods_supported.filter((x) => typeof x === 'string') }),
    };
    this.discovery = { at: this.now(), doc };
    return doc;
  }

  private async loadKeys(): Promise<Jwk[]> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const m = await this.meta();
        this.lastJwksFetch = this.now();
        const { status, body } = await fetchJson(m.jwks_uri);
        const keys = (body as { keys?: unknown } | null)?.keys;
        if (status !== 200 || !Array.isArray(keys)) throw new OidcError('JWKS_FAILED', `IdP 서명 키(JWKS)를 읽을 수 없습니다 (HTTP ${status})`);
        const usable = keys.filter((k): k is Jwk => !!k && typeof k === 'object' && (k.kty === 'RSA' || k.kty === 'EC') && !('d' in k)).slice(0, MAX_KEYS);
        this.jwks = { at: this.now(), keys: usable };
        return usable;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** kid로 키 — 캐시가 오래됐거나 모르는 kid면(30초에 한 번) 다시 받는다 */
  async key(h: JwtHeader): Promise<Jwk | null> {
    const pick = (keys: Jwk[]) => (h.kid ? keys.find((k) => k.kid === h.kid) : keys.length === 1 ? keys[0] : keys.find((k) => !k.alg || k.alg === h.alg)) ?? null;
    if (!this.jwks || this.now() - this.jwks.at >= JWKS_TTL_MS) await this.loadKeys();
    const hit = pick(this.jwks!.keys);
    if (hit) return hit;
    if (this.now() - this.lastJwksFetch < JWKS_REFETCH_MIN_MS) return null;
    return pick(await this.loadKeys());
  }

  /** id_token — 발급자·대상(client id)·nonce·만료 */
  verifyIdToken(token: string, nonce: string): Promise<JwtClaims> {
    return verifyJwt(token, { issuer: this.cfg.issuer, audience: this.cfg.clientId, clientId: this.cfg.clientId, nonce, key: (h) => this.key(h) });
  }

  /** Bearer 접근 토큰 — 발급자·대상(OIDC_AUDIENCE)·만료 */
  verifyAccessToken(token: string): Promise<JwtClaims> {
    return verifyJwt(token, { issuer: this.cfg.issuer, audience: this.cfg.audience, key: (h) => this.key(h) });
  }

  /** 인가 코드 → 토큰(PKCE code_verifier, 기밀 클라이언트 인증) */
  async exchange(code: string, verifier: string): Promise<{ idToken: string; accessToken?: string }> {
    const m = await this.meta();
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, code_verifier: verifier });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const methods = m.token_endpoint_auth_methods_supported;
    if (methods && !methods.includes('client_secret_basic') && methods.includes('client_secret_post')) {
      form.set('client_id', this.cfg.clientId);
      form.set('client_secret', this.cfg.clientSecret);
    } else {
      // RFC 6749 2.3.1 — 아이디·비밀은 form 인코딩한 뒤 Basic으로
      const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
      headers.Authorization = `Basic ${Buffer.from(`${enc(this.cfg.clientId)}:${enc(this.cfg.clientSecret)}`).toString('base64')}`;
    }
    const { status, body } = await fetchJson(m.token_endpoint, { method: 'POST', headers, body: form.toString() });
    const b = body as { id_token?: unknown; access_token?: unknown; error?: unknown } | null;
    if (status !== 200 || typeof b?.id_token !== 'string') {
      const code = typeof b?.error === 'string' ? b.error.replace(/[^a-z_]/gi, '').slice(0, 40) : `HTTP ${status}`;
      throw new OidcError('TOKEN_EXCHANGE_FAILED', `IdP 토큰 교환이 거부됐습니다 (${code})`);
    }
    return { idToken: b.id_token, ...(typeof b.access_token === 'string' && { accessToken: b.access_token }) };
  }

  /** 사용자 정보 — id_token에 그룹 클레임이 없을 때만 */
  async userinfo(accessToken: string): Promise<Record<string, unknown> | null> {
    const m = await this.meta();
    if (!m.userinfo_endpoint) return null;
    const { status, body } = await fetchJson(m.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    return status === 200 && body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  }
}
