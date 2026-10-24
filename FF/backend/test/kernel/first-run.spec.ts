// 빈 DB 첫 실행(운영 모드) — 출시 준비 RD-OPS-02 · RD-SEC-09 (설치 안내서 §7 "첫 시작").
// 고객 설치를 그대로: FF_ENV=production · 새 파일 DB(시드 없음) · 고객사 IdP SSO(https 발급자 — 시험 IdP를 fetch로 잇는다) · 감사 고정점 파일.
// 첫 사용자가 겪는 길: 준비 점검 ready → 익명 401 → SSO 로그인 → 모든 조회 API가 빈 DB에서 500 없이 답한다 → 첫 Feature 등록 → 재시작 뒤에도 남는다.
// 한 설치 = 한 고객: 설치 식별(FF_INSTANCE_ID)이 상태 점검·감사 고정점에 나오고, 없으면 부팅하지 않는다.
// 브라우저 화면(모든 메뉴의 빈 상태 안내)은 e2e/firstrun(verify e2e:firstrun)이 본다.
// readiness: RD-OPS-02, RD-SEC-09
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HUMAN_ROLES, ROUTES } from '@ff/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { AuditService } from '../../src/kernel/audit.service';
import { startFakeOidc, type FakeOidc } from '../fixtures/fake-oidc';

const PUBLIC = 'https://ff.first-run.example';
// 시험 IdP는 경로 없는 발급자만 흉내 낸다(Keycloak이면 https://sso.oem.example/realms/ff)
const ISSUER = 'https://idp.first-run.example';
// 첫 관리자 — 모든 사람 역할(IdP 그룹 하나 = 역할 하나). 요청마다 그 경로가 허용하는 첫 부여 역할이 고른다
const GROUPS = HUMAN_ROLES.map((r) => `ff-${r.toLowerCase()}`);
const USERS = {
  admin: { sub: 'first-admin', name: '첫관리자', email: 'admin@oem.example', groups: GROUPS },
  author: { sub: 'first-author', name: '김작성', email: 'author@oem.example', groups: ['ff-feature_author'] },
};
const PROD = {
  FF_ENV: 'production',
  FF_INSTANCE_ID: 'oem-first',
  FF_REQUEST_LOG: '0',
  UNLEASH_MODE: 'off',
  SIM_MODE: 'off',
  FF_AUDIT_KEY: 'a'.repeat(40),
  // 키 보호(RD-SEC-06) — 운영 모드 필수
  FF_KEK: Buffer.alloc(32, 5).toString('base64'),
  FF_AUTH: 'oidc',
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: 'ff-platform',
  OIDC_CLIENT_SECRET: 'first-run-client-secret',
  FF_PUBLIC_URL: PUBLIC,
  FF_SESSION_SECRET: 's'.repeat(48),
  OIDC_ROLE_MAP: HUMAN_ROLES.map((r) => `ff-${r.toLowerCase()}=${r}`).join(','),
};

const saved = { ...process.env };
const realFetch = globalThis.fetch;
let dir: string;
let idp: FakeOidc;
let app: NestExpressApplication;
const http = () => request(app.getHttpServer());

/** 운영 모드 쿠키는 Secure라 시험 쿠키 저장소가 http로 보내지 않는다 — 이름=값을 직접 모은다 */
const cookiesOf = (res: request.Response) => Object.fromEntries(([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));

async function login(user: keyof typeof USERS): Promise<string> {
  const start = await http().get('/api/auth/login').query({ returnTo: '/', login_hint: user }).expect(302);
  const authorize = new URL(start.headers.location);
  expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/authorize`);
  const flow = cookiesOf(start);
  expect(([] as string[]).concat(start.headers['set-cookie'] ?? []).join(';')).toMatch(/Secure/);
  const back = await fetch(authorize, { redirect: 'manual' });
  expect(back.status).toBe(302);
  const cb = new URL(back.headers.get('location')!);
  expect(cb.origin + cb.pathname).toBe(`${PUBLIC}/api/auth/callback`);
  const done = await http().get(cb.pathname + cb.search).set('Cookie', `ff_oidc=${flow.ff_oidc}`).expect(302);
  expect(done.headers.location).toBe('/');
  const session = cookiesOf(done).ff_session;
  expect(session).toBeTruthy();
  return `ff_session=${session}`;
}

async function boot() {
  app = await createApp({ logger: false });
  await app.init();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ff-first-run-'));
  idp = await startFakeOidc({ clientId: PROD.OIDC_CLIENT_ID, clientSecret: PROD.OIDC_CLIENT_SECRET, users: USERS, publicIssuer: ISSUER });
  const local = `http://127.0.0.1:${idp.port}`;
  // 고객사 IdP(https) — 시험에서는 같은 주소를 로컬 시험 IdP로 잇는다(백엔드 코드는 그대로 https 주소를 부른다)
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return realFetch(u.startsWith('https://idp.first-run.example') ? u.replace('https://idp.first-run.example', local) : input, init);
  }) as typeof fetch;
  for (const k of ['FF_SEED', 'FF_SCHEDULER', 'FF_CLOCK_AT', 'FF_SYNTHETIC', 'FF_DEMO_FIXTURES', 'FF_EXT_FIXTURES', 'FF_EXT_SYNC_SEED', 'GITLAB_WEBHOOK_TOKEN', 'JIRA_WEBHOOK_SECRET', 'CODEBEAMER_WEBHOOK_SECRET', 'FF_CORS_ORIGINS']) delete process.env[k];
  Object.assign(process.env, PROD, { FF_DB: join(dir, 'ff.db'), FF_AUDIT_ANCHOR_FILE: join(dir, 'anchor', 'audit-anchor.jsonl') });
  // 고정점 폴더는 설치가 만든다(compose 볼륨) — 시험도 미리 만든다
  mkdirSync(join(dir, 'anchor'));
  await boot();
});

afterAll(async () => {
  await app?.close();
  await idp?.close();
  globalThis.fetch = realFetch;
  process.env = saved;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 파일 잠금 */
  }
});

describe('운영 모드 첫 실행 — 빈 DB', () => {
  it('설치 식별이 없으면 부팅하지 않는다(한 설치 = 한 고객)', async () => {
    const id = process.env.FF_INSTANCE_ID;
    delete process.env.FF_INSTANCE_ID;
    await expect(createApp({ logger: false })).rejects.toThrow(/FF_INSTANCE_ID[\s\S]*한 설치 = 한 고객/);
    process.env.FF_INSTANCE_ID = id;
  });

  it('준비 점검 ready, 데모 데이터 없음, 설치 식별이 상태 점검에 나온다', async () => {
    const ready = await http().get('/api/health/ready').expect(200);
    expect(ready.body).toMatchObject({ status: 'ready', mode: 'production', instance: 'oem-first' });
    const h = (await http().get('/api/health').expect(200)).body;
    expect(h.seed).toBeNull();
    expect(h.counts).toMatchObject({ features: 0, baselines: 0, products: 0, dependencies: 0, gateRecords: 0 });
  });

  it('로그인 전에는 업무 API가 401 — 화면은 SSO 로그인으로 보낸다', async () => {
    expect((await http().get('/api/auth/config').expect(200)).body).toEqual({ mode: 'oidc' });
    await http().get('/api/features').expect(401);
    await http().post('/api/features').send({}).expect(401);
  });

  it('첫 관리자가 고객사 IdP로 로그인한다 — 부여 역할이 IdP 그룹에서 온다', async () => {
    const cookie = await login('admin');
    const me = (await http().get('/api/auth/me').set('Cookie', cookie).expect(200)).body;
    expect(me).toMatchObject({ authenticated: true, mode: 'oidc', user: { name: '첫관리자' } });
    expect([...me.user.roles].sort()).toEqual([...HUMAN_ROLES].sort());
  });

  it('빈 DB에서 모든 조회 API가 서버 오류(5xx) 없이 답한다 — 화면 메뉴가 기대는 목록·요약', async () => {
    const cookie = await login('admin');
    const gets = ROUTES.filter((r) => r.method === 'GET' && !r.path.includes(':') && !r.stream);
    expect(gets.length).toBeGreaterThan(80);
    const bad: string[] = [];
    for (const r of gets) {
      const url = r.path + (r.sample ? '?' + new URLSearchParams(r.sample).toString() : '');
      const res = await http().get(url).set('Cookie', cookie);
      if (res.status >= 500) bad.push(`${url} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
    expect(bad, '빈 DB에서 서버 오류').toEqual([]);
  });

  it('모의 외부 시스템의 예시 내용(레거시 옵션 코드·비SDV 차량·해외공장 주문·VOC)이 빈 설치에 나오지 않는다 — 회귀: 데모 픽스처가 그대로 보였다', async () => {
    const cookie = await login('admin');
    for (const p of ['/api/legacy/mappings', '/api/legacy-sdv/vehicles', '/api/legacy/orders', '/api/incidents']) {
      const body = (await http().get(p).set('Cookie', cookie).expect(200)).body;
      expect(body.items, p).toEqual([]);
    }
  });

  it('첫 Feature를 등록한다 — 목록에 하나, 감사 체인·고정점 검증 통과', async () => {
    const cookie = await login('author');
    expect((await http().get('/api/features').set('Cookie', cookie).expect(200)).body.items).toEqual([]);
    // 쿠키로 인증한 변경 요청은 공개 출처의 Origin이 있어야 한다(CSRF)
    await http().post('/api/features').set('Cookie', cookie).send({ name: 'x' }).expect(403);
    const created = await http()
      .post('/api/features')
      .set('Cookie', cookie)
      .set('Origin', PUBLIC)
      .set('Idempotency-Key', 'first-feature-1')
      .send({ name: '첫 기능 — 원격 시동', description: '고객 설치 첫 등록', country: 'KR', vehicleModel: 'NE1', trim: 'Base', ownerId: 'first-author', asil: 'QM' })
      .expect(201);
    expect(created.body.featureId).toMatch(/^FEAT-\d+$/);
    expect(created.body.version).toBe('0.1.0');
    const list = (await http().get('/api/features').set('Cookie', cookie).expect(200)).body.items;
    expect(list.map((f: { featureId: string }) => f.featureId)).toEqual([created.body.featureId]);
    const chain = app.get(AuditService).verifyChain();
    expect(chain.ok).toBe(true);
    expect(chain.verified).toBeGreaterThan(0);
  });

  it('고객 기준 값은 빈 목록에서 시작한다 — 데모 판매국·차종이 없고, 등록한 값으로 운영 차량(PRODUCTION)을 등록한다(RD-OPS-03)', async () => {
    const cookie = await login('admin');
    expect((await http().get('/api/reference-values').set('Cookie', cookie).expect(200)).body.items).toEqual([]);
    const post = (path: string, body: object, key: string) => http().post(path).set('Cookie', cookie).set('Origin', PUBLIC).set('Idempotency-Key', key).send(body);
    const vehicle = { vin: 'OEM-0001', label: '고객 1호차', country: 'KR', vehicleModel: 'NE1', trim: 'Base', modelYear: '2027', upgVc: 'UPGVC-A', swVersion: '1.0.0' };
    // 기준 값이 없으면 차량을 받지 않는다 — 데모 목록(KR·NX4 PE)을 그대로 받지 않는다
    await post('/api/fleet/vehicles', vehicle, 'veh-0').expect(400);
    await post('/api/reference-values', { kind: 'COUNTRY', code: 'KR', label: '대한민국' }, 'ref-1').expect(201);
    await post('/api/reference-values', { kind: 'VEHICLE_MODEL', code: 'NE1', label: 'NE1' }, 'ref-2').expect(201);
    await post('/api/reference-values', { kind: 'TRIM', code: 'Base', label: 'Base', parent: 'NE1' }, 'ref-3').expect(201);
    expect((await post('/api/fleet/vehicles', vehicle, 'veh-1').expect(201)).body).toMatchObject({ fleet: 'PRODUCTION' });
    const values = (await http().get('/api/reference-values').set('Cookie', cookie).expect(200)).body.items;
    expect(values.map((x: { origin: string }) => x.origin)).toEqual(['CUSTOMER', 'CUSTOMER', 'CUSTOMER']);
    expect(app.get(AuditService).verifyChain().ok).toBe(true);
  });

  it('재시작해도 데이터가 남고, 감사 고정점에 설치 식별이 적힌다', async () => {
    await app.close();
    await boot();
    expect((await http().get('/api/health').expect(200)).body.counts.features).toBe(1);
    await http().get('/api/health/ready').expect(200);
    const anchors = readFileSync(process.env.FF_AUDIT_ANCHOR_FILE!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(anchors.length).toBeGreaterThan(0);
    expect(new Set(anchors.map((a: { instance: string }) => a.instance))).toEqual(new Set(['oem-first']));
    expect(app.get(AuditService).verifyChain()).toMatchObject({ ok: true, broken: null });
  });
});
