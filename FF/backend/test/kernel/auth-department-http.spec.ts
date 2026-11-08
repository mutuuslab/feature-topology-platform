import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { DB, SqliteDb, migrate, type Db } from '../../src/kernel/db';
import { startFakeOidc, type FakeOidc } from '../fixtures/fake-oidc';

const PUBLIC = 'https://ff.department.test';
const USERS = {
  purchase: { sub: 'sso-purchase', name: '구매 담당', email: 'p@example.test', groups: ['cost', 'purchasing'] },
  legal: { sub: 'sso-legal', name: '법무 담당', email: 'l@example.test', groups: ['cost', 'legal'] },
  unknown: { sub: 'sso-unknown', name: '미등록 부서', email: 'u@example.test', groups: ['cost', 'not-mapped'] },
  missing: { sub: 'sso-missing', name: '부서 없음', email: 'm@example.test', groups: ['cost'] },
  ambiguous: { sub: 'sso-ambiguous', name: '복수 부서', email: 'a@example.test', groups: ['cost', 'purchasing', 'legal'] },
};
const saved = { ...process.env };
let app: NestExpressApplication;
let idp: FakeOidc;
let db: Db;
async function login(user: keyof typeof USERS) {
  const agent = request.agent(app.getHttpServer());
  const start = await agent.get('/api/auth/login').query({ login_hint: user }).expect(302);
  const response = await fetch(start.headers.location, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get('location')!);
  await agent.get(callback.pathname + callback.search).expect(302);
  return agent;
}

beforeAll(async () => {
  idp = await startFakeOidc({ clientId: 'department-test', clientSecret: 'local-fixture-only', users: USERS });
  for (const k of ['FF_ENV', 'FF_CLOCK_AT', 'FF_DB_URL', 'FF_DB_SCHEMA']) delete process.env[k];
  Object.assign(process.env, { FF_DB: ':memory:', FF_SEED: 'none', FF_DEMO_ACTIVITY: '0', FF_SCHEDULER: '0', FF_AUTH: 'oidc', OIDC_ISSUER: idp.issuer, OIDC_CLIENT_ID: 'department-test', OIDC_CLIENT_SECRET: 'local-fixture-only', FF_PUBLIC_URL: PUBLIC, FF_SESSION_SECRET: 'd'.repeat(48), OIDC_ROLE_MAP: 'cost=COST_ESTIMATOR', OIDC_DEPARTMENT_CLAIM: 'groups', OIDC_DEPARTMENT_MAP: 'purchasing=DEP-PUR,legal=DEP-LEG' });
  app = await createApp({ logger: false }); await app.init(); db = app.get(DB);
});
afterAll(async () => {
  await app?.close(); await idp?.close();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe('검증된 OIDC 부서 컨텍스트', () => {
  it('서명된 IdP 클레임을 명시 설정으로 매핑하고 세션을 거쳐 /me로 전달한다', async () => {
    const agent = await login('purchase');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ id: USERS.purchase.sub, department: 'DEP-PUR', roles: ['COST_ESTIMATOR'] });
    const stored = db.get<{ department_id: string }>('SELECT department_id FROM auth_session WHERE sub=?', USERS.purchase.sub);
    expect(stored?.department_id).toBe('DEP-PUR');
    expect((await agent.get('/api/auth/me').set('X-Department', 'DEP-LEG').set('X-Actor-Role', 'SYSTEM_ADMIN')).body.user.department).toBe('DEP-PUR');
  });
  it('다른 부서는 실제 토큰 값으로만 구분한다', async () => {
    const agent = await login('legal');
    expect((await agent.get('/api/auth/me')).body.user.department).toBe('DEP-LEG');
  });
  for (const user of ['unknown', 'missing', 'ambiguous'] as const) it(`${user}는 역할을 유지하며 부서 없는 공통 홈 컨텍스트로 전달한다`, async () => {
    const agent = await login(user); const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.authenticated).toBe(true);
    expect(me.body.user.roles).toEqual(['COST_ESTIMATOR']);
    expect(me.body.user.department).toBeUndefined();
  });
  it('부서 연결이 역할을 추가하지 않고 관리자·타 역할 쓰기를 계속 거부한다', async () => {
    const agent = await login('purchase');
    await agent.post('/api/accounts/other/deactivate').set('Origin', PUBLIC).set('X-Actor-Role', 'SYSTEM_ADMIN').send({ reason: '권한 검증' }).expect(403);
    expect((await agent.get('/api/auth/me')).body.user.roles).toEqual(['COST_ESTIMATOR']);
  });
  it('Bearer도 기존 서명·발급자·대상 검증 뒤에만 부서 값을 받는다', async () => {
    const http = request(app.getHttpServer());
    const token = idp.accessToken('purchase');
    const ok = await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ok.body.user.department).toBe('DEP-PUR');
    const forged = idp.accessToken('purchase', { groups: ['cost', 'legal'] }, { tamper: true });
    await http.get('/api/cost/projects').set('Authorization', `Bearer ${forged}`).expect(401);
    await http.get('/api/cost/projects').set('Authorization', `Bearer ${idp.accessToken('purchase', { aud: 'other-client' })}`).expect(401);
  });
});

it('401 적용 뒤 나중에 합쳐진 낮은 번호 migration도 미적용 ID로 실행한다', () => {
  const isolated = new SqliteDb();
  try {
    const initial = [{ name: '100_initial', sql: 'CREATE TABLE initial_marker(id TEXT);' }, { name: '401_later', sql: 'CREATE TABLE later_marker(id TEXT);' }];
    expect(migrate(isolated, initial)).toEqual(['100_initial', '401_later']);
    const inserted = { name: '242_future_package', sql: 'CREATE TABLE future_marker(id TEXT);' };
    expect(migrate(isolated, [...initial, inserted])).toEqual(['242_future_package']);
    expect(migrate(isolated, [...initial, inserted])).toEqual([]);
    expect(isolated.get("SELECT name FROM sqlite_master WHERE name='future_marker'")?.name).toBe('future_marker');
  } finally { isolated.close(); }
});
