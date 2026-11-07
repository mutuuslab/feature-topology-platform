// 공개 사이트 접속 게이트(functions/_middleware.ts) — 요청/응답 단위. 네트워크·wrangler 없이 Request를 직접 넣는다.
// 쿠키 없음 → 화면 302·데이터 401, 잘못된 비밀번호 거부, 맞으면 서명 쿠키, 위조·만료 거부, next 검증, 자산 예외, 비밀 키 없으면 닫힘.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, GATE_MARK, TTL_S, handle, isPublicPath, onRequest, safeNext, signToken, verifyToken } from '../functions/_middleware.ts';

const SECRET = 'test-gate-secret-0123456789-abcdefghij';
const ENV = { FF_GATE_SECRET: SECRET };
const ORIGIN = 'https://feature-topology.pages.dev';
const T0 = Date.UTC(2026, 10, 6, 9, 0, 0);

/** 정적 자산 자리 — 무엇을 돌려줬는지 시험이 본다 */
function asset(body = 'asset', headers: Record<string, string> = {}) {
  let calls = 0;
  const next = async () => {
    calls += 1;
    return new Response(body, { status: 200, headers });
  };
  return { next, calls: () => calls };
}

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('Cookie', init.cookie);
  return new Request(ORIGIN + path, { ...init, headers });
};

const loginReq = (body: unknown, headers: Record<string, string> = {}) =>
  req('/__auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

async function cookieFor(nowMs = T0) {
  return `${COOKIE}=${await signToken(SECRET, nowMs)}`;
}

test('쿠키 없이 화면 주소를 열면 원래 주소를 달고 로그인으로 보낸다(자산은 내주지 않는다)', async () => {
  const a = asset();
  const res = await handle(req('/fleet/map?vin=HMA-NX4-0001', { headers: { Accept: 'text/html' } }), ENV, a.next, T0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `/login?next=${encodeURIComponent('/fleet/map?vin=HMA-NX4-0001')}`);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(a.calls(), 0);
  // 루트는 next 없이
  assert.equal((await handle(req('/'), ENV, a.next, T0)).headers.get('Location'), '/login');
  // 별도 HTML 페이지도 막힌다
  const ext = await handle(req('/external.html'), ENV, a.next, T0);
  assert.equal(ext.status, 302);
  assert.equal(ext.headers.get('Location'), '/login?next=%2Fexternal.html');
  assert.equal(a.calls(), 0);
});

test('쿠키 없이 스냅샷·JSON·쓰기 요청은 401 JSON', async () => {
  const a = asset();
  for (const r of [
    req('/api-snapshot/features.json'),
    req('/release.json'),
    req('/models/car.glb', { headers: { Accept: 'application/json' } }),
    req('/anything', { method: 'POST', body: '{}' }),
  ]) {
    const res = await handle(r, ENV, a.next, T0);
    assert.equal(res.status, 401, r.url);
    assert.match(res.headers.get('Content-Type') ?? '', /json/);
    const body = await res.json();
    assert.equal(body.error, 'auth_required');
    assert.equal(body.gate, GATE_MARK);
  }
  assert.equal(a.calls(), 0);
});

test('로그인 화면과 그 화면이 쓰는 최소 자산은 쿠키 없이 열린다', async () => {
  for (const p of ['/login', '/assets/index-Ab12_cd.js', '/assets/index-9f.css', '/brand/mutuuslab_logo.png', '/boot-check.js', '/recovery.html']) {
    const a = asset();
    const res = await handle(req(p), ENV, a.next, T0);
    assert.equal(res.status, 200, p);
    assert.equal(a.calls(), 1, p);
  }
});

test('자산 예외는 경로 꼼수(인코딩 슬래시·역슬래시·..)로 넓어지지 않는다', () => {
  assert.equal(isPublicPath('/assets/x.js'), true);
  for (const p of ['/assets/..%2fapi-snapshot%2fa.json', '/assets/%2e%2e/api-snapshot/a.json', '/assets\\..\\x', '/assets//x', '/assetsx/a.js', '/api-snapshot/a.json', '/brand', '/external.html', '/']) {
    assert.equal(isPublicPath(p), false, p);
  }
});

// 2026-11-06 하네스 리뷰 — 함수 단위가 아니라 요청 전체(handle)로: 인코딩된 점 구간·대소문자·이중 슬래시·HEAD·OPTIONS.
// request.url은 이미 정규화된 주소라 게이트와 자산 서버가 같은 경로를 본다(/assets//../x는 /assets/x — 자산 폴더 밖이 아니다)
test('경로 꼼수·메서드 꼼수로 보낸 요청도 쿠키 없이는 자산을 내주지 않는다', async () => {
  for (const p of ['/assets/%2e%2e/api-snapshot/release.json', '/assets/..%2fapi-snapshot%2frelease.json', '/brand/%2E%2E/external.html', '/ASSETS/../api-snapshot/release.json', '/Login/../api-snapshot/release.json', '//api-snapshot/release.json', '/LOGIN']) {
    const a = asset();
    const res = await handle(req(p, { headers: { Accept: 'text/html' } }), ENV, a.next, T0);
    assert.ok(res.status === 302 || res.status === 401, `${p} → ${res.status}`);
    assert.equal(a.calls(), 0, p);
  }
  for (const method of ['HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
    const a = asset();
    const res = await handle(req('/api-snapshot/release.json', { method }), ENV, a.next, T0);
    assert.equal(res.status, 401, method);
    assert.equal(a.calls(), 0, method);
  }
  // 쿠키 이름은 대소문자를 가린다(__host-ff_gate는 다른 쿠키). 같은 이름이 둘이면 첫 값만 본다 — 가짜를 앞에 끼워도 열리지 않는다
  const good = (await cookieFor()).split('=')[1];
  for (const cookie of [`__host-ff_gate=${good}`, `${COOKIE}=forged; ${COOKIE}=${good}`]) {
    const a = asset();
    const res = await handle(req('/api-snapshot/release.json', { cookie }), ENV, a.next, T0);
    assert.equal(res.status, 401, cookie.slice(0, 30));
    assert.equal(a.calls(), 0);
  }
});

test('잘못된 ID·비밀번호는 401이고 쿠키를 주지 않는다', async () => {
  for (const body of [{ id: 'FF', password: 'wrong' }, { id: 'wrong', password: 'FF' }, { id: 'FF', password: 'FF ' }, { id: 'FF' }, { id: 1, password: 'FF' }]) {
    const res = await handle(loginReq(body), ENV, asset().next, T0);
    assert.equal(res.status, 401, JSON.stringify(body));
    assert.equal(res.headers.get('Set-Cookie'), null);
    assert.deepEqual(await res.json(), { ok: false, gate: GATE_MARK, error: 'invalid_credentials' });
  }
});

test('FF/FF(대소문자 무관)면 서명 쿠키(HttpOnly·Secure·SameSite=Lax·7일)를 주고, 그 쿠키로 화면이 열린다', async () => {
  for (const [id, password] of [['FF', 'FF'], [' ff ', 'fF'], ['Ff', 'ff']]) {
    const res = await handle(loginReq({ id, password, next: '/fleet/map?x=1' }), ENV, asset().next, T0);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, gate: GATE_MARK, next: '/fleet/map?x=1' });
    const sc = res.headers.get('Set-Cookie') ?? '';
    assert.match(sc, new RegExp(`^${COOKIE}=\\d+\\.[A-Za-z0-9_-]{43}; `));
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${TTL_S}`]) assert.ok(sc.includes(attr), attr);
    const cookie = sc.split(';')[0];
    const a = asset('page', { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' });
    const page = await handle(req('/api-snapshot/features.json', { cookie: `theme=dark; ${cookie}` }), ENV, a.next, T0 + 60_000);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), 'page');
    // 로그인한 사람의 응답은 공유 캐시에 남지 않게 private
    assert.equal(page.headers.get('Cache-Control'), 'private, max-age=300, stale-while-revalidate=600');
  }
});

test('보호 응답은 원본 캐시 지시가 없어도, public이 없어도 공유 캐시에 남지 않는다', async () => {
  const cookie = await cookieFor();
  for (const headers of [
    {},
    { 'Cache-Control': 'max-age=300' },
    { 'Cache-Control': 's-maxage=600, max-age=300' },
    { 'Cache-Control': 'private="Set-Cookie", max-age=300' },
    { 'Cache-Control': 'no-store' },
  ]) {
    const a = asset('protected snapshot', headers);
    const res = await handle(req('/api-snapshot/features.json', { cookie }), ENV, a.next, T0);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') ?? '', /(?:^|,)\s*private\s*(?:,|$)/i);
    assert.equal(await res.text(), 'protected snapshot');
    assert.equal(a.calls(), 1);
  }
});

test('보호 응답은 CDN 전용 캐시 지시도 닫고 기존 Vary를 보존하며 Cookie를 구분한다', async () => {
  const cookie = await cookieFor();
  for (const vary of [undefined, 'Accept-Encoding', 'Accept-Encoding, cookie', '*']) {
    const a = asset('protected', {
      'Cache-Control': 'public, max-age=300',
      'CDN-Cache-Control': 'public, s-maxage=3600',
      'Cloudflare-CDN-Cache-Control': 'public, s-maxage=3600',
      ...(vary ? { Vary: vary } : {}),
    });
    const res = await handle(req('/external.html', { cookie }), ENV, a.next, T0);
    assert.equal(res.headers.get('CDN-Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
    const resultVary = res.headers.get('Vary') ?? '';
    if (vary === '*') assert.equal(resultVary, '*');
    else {
      const names = resultVary.split(',').map((x) => x.trim().toLowerCase());
      assert.equal(names.filter((x) => x === 'cookie').length, 1);
      if (vary) assert.ok(names.includes('accept-encoding'));
    }
  }
});

test('로그인 요청 형식 — POST·JSON·같은 출처만', async () => {
  assert.equal((await handle(req('/__auth/login'), ENV, asset().next, T0)).status, 405);
  const form = req('/__auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'id=FF&password=FF' });
  assert.equal((await handle(form, ENV, asset().next, T0)).status, 415);
  assert.equal((await handle(loginReq({ id: 'FF', password: 'FF' }, { Origin: 'https://evil.example' }), ENV, asset().next, T0)).status, 403);
  const big = req('/__auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'FF', password: 'FF', pad: 'x'.repeat(5000) }) });
  assert.equal((await handle(big, ENV, asset().next, T0)).status, 413);
  const bad = req('/__auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal((await handle(bad, ENV, asset().next, T0)).status, 401);
});

test('위조·변조·다른 키로 서명한 쿠키는 거부한다', async () => {
  const good = await signToken(SECRET, T0);
  const [exp, sig] = good.split('.');
  const other = await signToken('another-secret-0123456789-abcdefghijk', T0);
  const flip = (i: number) => sig.slice(0, i) + (sig[i] === 'A' ? 'B' : 'A') + sig.slice(i + 1);
  // 마지막 문자는 남는 비트가 있다 — 같은 바이트로 풀리는 다른 표기(비정규)도 거부해야 한다
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = sig.slice(0, -1) + B64[B64.indexOf(sig[42]) ^ 1];
  for (const token of [`${Number(exp) + 100}.${sig}`, `${exp}.${flip(0)}`, `${exp}.${flip(20)}`, `${exp}.${last}`, other, '1', `${exp}.`, `${exp}.${sig}x`, 'true']) {
    assert.equal(await verifyToken(token, SECRET, T0), false, token);
    const a = asset();
    const res = await handle(req('/fleet', { cookie: `${COOKIE}=${token}` }), ENV, a.next, T0);
    assert.equal(res.status, 302, token);
    assert.equal(a.calls(), 0);
  }
  // 다른 이름의 쿠키에 같은 값을 넣어도 통하지 않는다
  assert.equal((await handle(req('/fleet', { cookie: `ff_gate=${good}` }), ENV, asset().next, T0)).status, 302);
  assert.equal(await verifyToken(good, SECRET, T0), true);
});

test('7일이 지나면 만료 — 다시 로그인으로', async () => {
  const cookie = await cookieFor(T0);
  assert.equal((await handle(req('/', { cookie }), ENV, asset().next, T0 + (TTL_S - 1) * 1000)).status, 200);
  assert.equal((await handle(req('/', { cookie }), ENV, asset().next, T0 + TTL_S * 1000)).status, 302);
  // 발급 한도보다 먼 만료(서버 시계가 뒤로 간 위조 대비)도 거부
  assert.equal(await verifyToken(await signToken(SECRET, T0 + 30 * 24 * 3600 * 1000), SECRET, T0), false);
});

test('next는 같은 사이트 경로만 — 열린 리다이렉트 금지', async () => {
  assert.equal(safeNext('/fleet/map?vin=1#a'), '/fleet/map?vin=1#a');
  assert.equal(safeNext('/external.html'), '/external.html');
  // 점 구간(/./, /../, %2e)은 정규화 뒤 '//'가 된다 — 브라우저에선 다른 사이트 주소
  for (const bad of ['//evil.example/x', '/.//evil.example', '/..//evil.example', '/a/..//evil.example', '/%2e//evil.example', '/%2E%2E//evil.example/x', '/./login', 'https://evil.example', '/\\evil.example', '\\\\evil', 'evil', '/login', '/login?next=/x', '/__auth/logout', '/x\n', '', null, undefined]) {
    assert.equal(safeNext(bad), undefined, String(bad));
  }
  const res = await handle(loginReq({ id: 'FF', password: 'FF', next: '//evil.example/steal' }), ENV, asset().next, T0);
  assert.equal((await res.json()).next, '/');
  const res2 = await handle(loginReq({ id: 'FF', password: 'FF', next: 'https://evil.example' }), ENV, asset().next, T0);
  assert.equal((await res2.json()).next, '/');
});

test('로그아웃은 같은 출처의 POST로만 쿠키를 지운다', async () => {
  const post = await handle(req('/__auth/logout', { method: 'POST', headers: { Origin: ORIGIN } }), ENV, asset().next, T0);
  assert.equal(post.status, 200);
  assert.match(post.headers.get('Set-Cookie') ?? '', new RegExp(`^${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax$`));
  // Origin 없이도 브라우저가 같은 출처라고 밝히면(Sec-Fetch-Site) 받는다
  const meta = await handle(req('/__auth/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } }), ENV, asset().next, T0);
  assert.equal(meta.status, 200);
});

test('로그아웃 CSRF — GET(링크·이미지)과 출처를 밝히지 않거나 다른 출처의 POST는 쿠키를 지우지 않는다', async () => {
  const get = await handle(req('/__auth/logout'), ENV, asset().next, T0);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST');
  assert.equal(get.headers.get('Set-Cookie'), null);
  for (const headers of [{}, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    const res = await handle(req('/__auth/logout', { method: 'POST', headers }), ENV, asset().next, T0);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal(res.headers.get('Set-Cookie'), null);
  }
});

test('비밀 키가 없거나 짧으면 아무것도 열지 않는다(503)', async () => {
  for (const env of [{}, { FF_GATE_SECRET: '' }, { FF_GATE_SECRET: 'short' }]) {
    for (const p of ['/login', '/assets/a.js', '/api-snapshot/a.json']) {
      const a = asset();
      const res = await handle(req(p), env, a.next, T0);
      assert.equal(res.status, 503, p);
      assert.equal(a.calls(), 0);
    }
  }
});

test('Pages 진입점 onRequest가 같은 처리를 한다', async () => {
  const a = asset();
  const res = await onRequest({ request: req('/api-snapshot/a.json'), env: ENV, next: a.next });
  assert.equal(res.status, 401);
  assert.equal(a.calls(), 0);
});
