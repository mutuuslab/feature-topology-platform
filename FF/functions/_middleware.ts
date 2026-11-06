// 공개 사이트 접속 게이트 — Cloudflare Pages Functions 미들웨어. 모든 요청을 가로채 서명 쿠키가 없으면 로그인 화면으로 보낸다.
// 배경(2026-11-06, 사용자 "전부 패스워드 걸어놔, 링크로 바로 못 들어오게"): 로그인이 브라우저(localStorage ff.auth)에서만 막혀
// external.html·/api-snapshot/*.json·직접 주소가 로그인 없이 열렸다. 이제 서버가 막는다.
// - 예외: /login(SPA 로그인 화면)과 그 화면이 쓰는 최소 자산(/assets/*, /brand/*, boot-check.js, 복구 안내)뿐.
// - /__auth/login(POST JSON): ID·비밀번호 FF(대소문자 무관, frontend/src/auth-demo.ts와 같은 규칙)를 서버에서 확인하고
//   HMAC 서명 쿠키(HttpOnly·Secure·SameSite=Lax, 7일)를 준다. /__auth/logout(같은 출처 POST만)은 쿠키를 지운다.
// - 비밀 키는 Pages 환경 변수 FF_GATE_SECRET(32자 이상). 없거나 짧으면 모든 요청을 503으로 닫는다(조용히 열리지 않게).
// wrangler pages deploy는 실행 위치의 ./functions를 읽는다 — cloudflare.yml이 FF/에서 `pages deploy frontend/dist`로 올린다.
// 로컬 vite preview·정적 e2e·데스크톱에는 이 함수가 없다(기존 브라우저 로그인 그대로). 시험: tools/pages-gate.test.ts
// Node(형식 제거 실행)와 wrangler(esbuild)가 함께 읽으므로 지울 수 있는 형식 문법만 쓴다.

export interface GateEnv {
  FF_GATE_SECRET?: string;
}

interface PagesContext {
  request: Request;
  env: GateEnv;
  next: () => Promise<Response>;
}

/** 로그인 응답 표식 — 프런트(auth-demo.ts GATE_MARK)가 게이트가 있는 사이트인지 이것으로 안다 */
export const GATE_MARK = 'ff-gate-v1';
/** __Host- 접두어: Secure·Path=/·Domain 없음을 브라우저가 강제한다 */
export const COOKIE = '__Host-ff_gate';
export const TTL_S = 7 * 24 * 60 * 60;
export const MIN_SECRET = 32;
const BODY_MAX = 4096;
const DEMO = 'FF';

const PUBLIC_EXACT = new Set(['/login', '/login/', '/boot-check.js', '/recovery.html', '/recovery.js', '/robots.txt', '/favicon.ico']);
const PUBLIC_PREFIX = ['/assets/', '/brand/'];

const enc = new TextEncoder();

/** 공개 데모 ID·비밀번호 — 대소문자 무관, ID 앞뒤 공백만 지운다(auth-demo.ts login과 같다) */
export function credentialsOk(id: unknown, password: unknown): boolean {
  return typeof id === 'string' && typeof password === 'string' && id.trim().toUpperCase() === DEMO && password.toUpperCase() === DEMO;
}

/** 로그인 없이 열리는 경로 — 해시 이름 자산만 있으니 문자 집합을 좁혀 인코딩된 '..'·역슬래시 우회를 막는다 */
export function isPublicPath(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  if (!/^[A-Za-z0-9._\-/]+$/.test(path) || path.includes('..') || path.includes('//')) return false;
  return PUBLIC_PREFIX.some((p) => path.startsWith(p));
}

/** 돌아갈 주소 — 같은 사이트의 경로만(열린 리다이렉트 금지). 아니면 undefined */
export function safeNext(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  let u: URL;
  try {
    u = new URL(raw, 'https://gate.invalid');
  } catch {
    return undefined;
  }
  // 점 구간(/./, /../, %2e)이 정규화되면 '//'로 시작할 수 있다 — 브라우저에선 다른 사이트 주소
  if (u.origin !== 'https://gate.invalid' || u.pathname.startsWith('//')) return undefined;
  if (u.pathname === '/login' || u.pathname === '/login/' || u.pathname.startsWith('/__auth/')) return undefined;
  return u.pathname + u.search + u.hash;
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
    // 남는 비트만 다른 값(같은 바이트로 풀리는 다른 문자열)은 받지 않는다 — 서명 문자열이 하나뿐이게
    return b64url(bytes.buffer) === s ? bytes : null;
  } catch {
    return null;
  }
}

const hmacKey = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const payload = (exp: number) => enc.encode(`${GATE_MARK}.${exp}`);

/** 쿠키 값 — `<만료 초>.<HMAC-SHA256(서명 키, 표식.만료)>` */
export async function signToken(secret: string, nowMs: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + TTL_S;
  return `${exp}.${b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), payload(exp)))}`;
}

/** 서명·만료 확인 — 비교는 subtle.verify(상수 시간). 만료가 발급 한도(7일)보다 먼 값도 거부한다 */
export async function verifyToken(token: string | undefined, secret: string, nowMs: number): Promise<boolean> {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || exp > now + TTL_S + 60) return false;
  const sig = fromB64url(m[2]);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sig, payload(exp));
}

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}

function redirect(location: string, status = 302, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, Location: location, ...extra } });
}

const setCookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

/** 로그인한 사람에게만 가는 응답 — 공유 캐시(프록시)가 담아 두지 않게 public을 private로 바꾼다 */
function privatize(res: Response): Response {
  const cc = res.headers.get('Cache-Control');
  if (!cc || !/\bpublic\b/i.test(cc)) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', cc.replace(/\bpublic\b/i, 'private'));
  return out;
}

/** 다른 사이트에서 보낸 요청 거부 — Origin이 있으면 같은 출처여야 한다 */
const crossSite = (request: Request, url: URL) => {
  const origin = request.headers.get('Origin');
  return origin !== null && origin !== url.origin;
};

async function login(request: Request, url: URL, secret: string, nowMs: number): Promise<Response> {
  if (request.method !== 'POST') return json(405, { ok: false, gate: GATE_MARK, error: 'method_not_allowed' }, { Allow: 'POST' });
  if (crossSite(request, url)) return json(403, { ok: false, gate: GATE_MARK, error: 'cross_site' });
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { ok: false, gate: GATE_MARK, error: 'json_required' });
  const text = await request.text();
  if (text.length > BODY_MAX) return json(413, { ok: false, gate: GATE_MARK, error: 'too_large' });
  let body: { id?: unknown; password?: unknown; next?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || !credentialsOk(body.id, body.password)) return json(401, { ok: false, gate: GATE_MARK, error: 'invalid_credentials' });
  const next = safeNext(typeof body.next === 'string' ? body.next : undefined) ?? '/';
  return json(200, { ok: true, gate: GATE_MARK, next }, { 'Set-Cookie': setCookie(await signToken(secret, nowMs), TTL_S) });
}

/** 같은 출처임을 밝힌 요청 — Origin이 같거나, Origin이 없으면 브라우저의 Sec-Fetch-Site: same-origin */
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('Origin');
  return origin !== null ? origin === url.origin : request.headers.get('Sec-Fetch-Site') === 'same-origin';
};

/** 로그아웃 — POST만(GET 링크·이미지로 남이 로그아웃시키는 CSRF 차단), 출처를 밝히지 않으면 거부. 화면은 auth-demo.ts logout이 POST로 보낸다 */
function logout(request: Request, url: URL): Response {
  if (request.method !== 'POST') return json(405, { ok: false, gate: GATE_MARK, error: 'method_not_allowed' }, { Allow: 'POST' });
  if (!sameOrigin(request, url)) return json(403, { ok: false, gate: GATE_MARK, error: 'cross_site' });
  return json(200, { ok: true, gate: GATE_MARK }, { 'Set-Cookie': setCookie('', 0) });
}

/** 쿠키 없는 요청 — 화면 이동(GET HTML)은 로그인으로, 데이터·쓰기·JSON은 401 JSON */
function deny(request: Request, url: URL): Response {
  const path = url.pathname;
  const accept = request.headers.get('Accept') ?? '';
  const wantsJson = path.startsWith('/api-snapshot/') || /\.json$/i.test(path) || (accept.includes('application/json') && !accept.includes('text/html'));
  if ((request.method !== 'GET' && request.method !== 'HEAD') || wantsJson) {
    return json(401, { ok: false, gate: GATE_MARK, error: 'auth_required', login: '/login' }, { 'WWW-Authenticate': 'Cookie realm="feature-platform"' });
  }
  const next = safeNext(path + url.search);
  return redirect(next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');
}

/** 요청 하나 처리 — 시험이 시계(nowMs)와 next를 바꿔 끼운다 */
export async function handle(request: Request, env: GateEnv, next: () => Promise<Response>, nowMs: number = Date.now()): Promise<Response> {
  const secret = env.FF_GATE_SECRET ?? '';
  if (secret.length < MIN_SECRET) return new Response('Access gate is not configured.', { status: 503, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  const url = new URL(request.url);
  if (url.pathname === '/__auth/login') return login(request, url, secret, nowMs);
  if (url.pathname === '/__auth/logout') return logout(request, url);
  if (isPublicPath(url.pathname)) return next();
  if (await verifyToken(readCookie(request.headers.get('Cookie'), COOKIE), secret, nowMs)) return privatize(await next());
  return deny(request, url);
}

export const onRequest = (ctx: PagesContext): Promise<Response> => handle(ctx.request, ctx.env, ctx.next);
