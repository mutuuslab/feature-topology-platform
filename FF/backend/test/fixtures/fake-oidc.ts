// 시험용 IdP(OIDC 제공자) — node:http, 무작위 포트. 백엔드 시험(test/kernel/oidc.spec.ts)과 브라우저 시험(e2e/oidc/fake-idp.mjs)이 같은 코드를 쓴다.
//  · 디스커버리·JWKS(프로세스 안에서 만든 RSA 키)·authorize(login_hint의 사용자를 자동 승인, 없으면 사용자 고르기 화면)
//  · token: 클라이언트 인증(Basic)·일회용 코드·redirect_uri·PKCE(S256 code_verifier) 확인 → RS256 id_token(nonce) + access_token
//  · userinfo·end_session(로그아웃) · (e2e 전용 선택) /test/token
// Node가 바로 실행할 수 있게 지울 수 있는 타입 표기만 쓴다(enum·매개변수 속성 없음).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface FakeUser {
  sub: string;
  name: string;
  email: string;
  groups: string[];
}

export interface FakeOidcOptions {
  port?: number;
  clientId: string;
  clientSecret: string;
  users: Record<string, FakeUser>;
  /** 그룹 클레임 이름(기본 groups) */
  groupsClaim?: string;
  /** 접근 토큰 대상(기본 client id) */
  accessAudience?: string;
  tokenTtlSec?: number;
  /** e2e 전용 — GET /test/token?user=키 로 접근 토큰을 준다(브라우저 밖 API 호출 준비) */
  exposeTestTokens?: boolean;
  /** 디스커버리·토큰에 적는 발급자(예: https://idp.oem.example) — 운영 모드는 https 발급자만 받는다.
   *  서버는 그대로 http 127.0.0.1에서 듣고, 시험이 fetch를 이 주소 → 실제 주소로 바꿔 보낸다(운영 모드 첫 실행 시험) */
  publicIssuer?: string;
}

export interface SignOptions {
  alg?: string;
  kid?: string;
  key?: KeyObject;
  /** 서명을 망가뜨린다 */
  tamper?: boolean;
}

export interface FakeOidc {
  issuer: string;
  port: number;
  /** 요청 수(JWKS 재조회 상한 시험) */
  hits: { discovery: number; jwks: number; token: number; authorize: number };
  /** 임의 클레임으로 토큰을 만든다(Bearer 시험) */
  sign(claims: Record<string, unknown>, o?: SignOptions): string;
  /** 사용자 접근 토큰(기본 클레임 + 덮어쓰기) */
  accessToken(user: string, over?: Record<string, unknown>, o?: SignOptions): string;
  /** 다른 키 — 서명 위조 시험 */
  otherKey(): KeyObject;
  close(): Promise<void>;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => ok(s));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function startFakeOidc(o: FakeOidcOptions): Promise<FakeOidc> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `fake-${randomBytes(4).toString('hex')}`;
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { user: string; clientId: string; redirectUri: string; nonce: string; challenge: string; at: number }>();
  const ttl = o.tokenTtlSec ?? 300;
  const claimName = o.groupsClaim ?? 'groups';
  const hits = { discovery: 0, jwks: 0, token: 0, authorize: 0 };
  let issuer = '';

  const signJwt = (claims: Record<string, unknown>, so: SignOptions = {}) => {
    const header = { alg: so.alg ?? 'RS256', typ: 'JWT', kid: so.kid ?? kid };
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    if (header.alg === 'none') return `${input}.`;
    let sig = sign('sha256', Buffer.from(input), so.key ?? privateKey);
    if (so.tamper) sig = Buffer.from(sig.map((x, i) => (i === 0 ? x ^ 0xff : x)));
    return `${input}.${b64u(sig)}`;
  };
  const userClaims = (key: string) => {
    const u = o.users[key];
    return { sub: u.sub, name: u.name, preferred_username: key, email: u.email, [claimName]: u.groups };
  };
  const now = () => Math.floor(Date.now() / 1000);
  const accessToken = (user: string, over: Record<string, unknown> = {}, so?: SignOptions) =>
    signJwt({ iss: issuer, aud: o.accessAudience ?? o.clientId, iat: now(), exp: now() + ttl, ...userClaims(user), ...over }, so);

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer || 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        hits.discovery++;
        return send(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          end_session_endpoint: `${issuer}/logout`,
          response_types_supported: ['code'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (req.method === 'GET' && url.pathname === '/jwks') {
        hits.jwks++;
        return send(res, 200, { keys: [jwk] });
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        hits.authorize++;
        const p = url.searchParams;
        const redirectUri = p.get('redirect_uri') ?? '';
        if (p.get('client_id') !== o.clientId || !/^https?:\/\//.test(redirectUri)) return send(res, 400, { error: 'invalid_client' });
        if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge') || !p.get('state') || !p.get('nonce')) return send(res, 400, { error: 'invalid_request' });
        const hint = p.get('login_hint');
        if (!hint || !o.users[hint]) {
          // 사용자 고르기 — 실제 IdP 로그인 화면 대신
          const links = Object.entries(o.users)
            .map(([k, u]) => {
              const q = new URLSearchParams(p);
              q.set('login_hint', k);
              return `<li><a href="/authorize?${escHtml(q.toString())}" data-user="${escHtml(k)}">${escHtml(u.name)}</a></li>`;
            })
            .join('');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Fake IdP</title></head><body><h1>Fake IdP 로그인</h1><ul>${links}</ul></body></html>`);
        }
        const code = b64u(randomBytes(24));
        codes.set(code, { user: hint, clientId: o.clientId, redirectUri, nonce: p.get('nonce')!, challenge: p.get('code_challenge')!, at: Date.now() });
        const back = new URL(redirectUri);
        back.searchParams.set('code', code);
        back.searchParams.set('state', p.get('state')!);
        res.writeHead(302, { Location: back.toString() });
        return res.end();
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        hits.token++;
        const form = new URLSearchParams(await body(req));
        const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
        const [id, secret] = basic ? Buffer.from(basic[1], 'base64').toString().split(':').map((s) => decodeURIComponent(s.replace(/\+/g, ' '))) : [form.get('client_id'), form.get('client_secret')];
        if (id !== o.clientId || secret !== o.clientSecret) return send(res, 401, { error: 'invalid_client' });
        if (form.get('grant_type') !== 'authorization_code') return send(res, 400, { error: 'unsupported_grant_type' });
        const c = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!c || Date.now() - c.at > 60_000 || c.redirectUri !== form.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
        const verifier = form.get('code_verifier') ?? '';
        if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return send(res, 400, { error: 'invalid_grant' });
        const idToken = signJwt({ iss: issuer, aud: o.clientId, azp: o.clientId, iat: now(), exp: now() + ttl, nonce: c.nonce, ...userClaims(c.user) });
        return send(res, 200, { token_type: 'Bearer', expires_in: ttl, id_token: idToken, access_token: accessToken(c.user) });
      }
      if (req.method === 'GET' && url.pathname === '/userinfo') {
        const user = Object.keys(o.users).find((k) => (req.headers.authorization ?? '').includes(o.users[k].sub)) ?? null;
        return user ? send(res, 200, userClaims(user)) : send(res, 401, { error: 'invalid_token' });
      }
      if (o.exposeTestTokens && req.method === 'GET' && url.pathname === '/test/token') {
        const user = url.searchParams.get('user') ?? '';
        return o.users[user] ? send(res, 200, { access_token: accessToken(user) }) : send(res, 404, { error: 'unknown_user' });
      }
      if (req.method === 'GET' && url.pathname === '/logout') {
        const back = url.searchParams.get('post_logout_redirect_uri');
        res.writeHead(back ? 302 : 200, back ? { Location: back } : { 'Content-Type': 'text/plain' });
        return res.end(back ? '' : 'logged out');
      }
      send(res, 404, { error: 'not_found' });
    } catch {
      send(res, 500, { error: 'server_error' });
    }
  });

  await new Promise<void>((ok) => server.listen(o.port ?? 0, '127.0.0.1', () => ok()));
  const port = (server.address() as { port: number }).port;
  issuer = o.publicIssuer?.replace(/\/+$/, '') ?? `http://127.0.0.1:${port}`;
  return {
    issuer,
    port,
    hits,
    sign: signJwt,
    accessToken,
    otherKey: () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
