// 실제 인증(OIDC SSO, BFF) — FF_AUTH=oidc. 시험 IdP(fixtures/fake-oidc.ts)로 로그인 전체 흐름·헤더 위조·Bearer·CSRF·세션 만료·승인자 키.
// readiness: RD-SEC-01, RD-SEC-04, RD-SEC-05
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { AuditService } from '../../src/kernel/audit.service';
import { AuthService } from '../../src/kernel/auth/auth.service';
import { startFakeOidc, type FakeOidc } from '../fixtures/fake-oidc';

const PUBLIC = 'https://ff.test.example';
const USERS = {
  author: { sub: 'u-author-1', name: '김작성', email: 'author@oem.example', groups: ['ff-author'] },
  ops: { sub: 'u-ops-1', name: '이운영', email: 'ops@oem.example', groups: ['ff-ops'] },
  opslead: { sub: 'u-opslead-1', name: '박리더', email: 'lead@oem.example', groups: ['ff-opslead'] },
  // 한 사람이 FSM·CSM 두 승인 역할을 가진다 — 두 칸을 혼자 채우지 못해야 한다
  integrator: { sub: 'u-integ-1', name: '최연계', email: 'integ@oem.example', groups: ['ff-integrator'] },
  // 로그인한 적 없이 Bearer로만 오는 운영 리더(승인자 키 미등록)
  apilead: { sub: 'u-apilead-1', name: 'API 리더', email: 'apilead@oem.example', groups: ['ff-opslead'] },
  nobody: { sub: 'u-nobody-1', name: '역할없음', email: 'nobody@oem.example', groups: ['other-team'] },
};
const ROLE_MAP = 'ff-author=FEATURE_AUTHOR,ff-ops=OPERATOR,ff-opslead=OPS_LEAD,ff-integrator=SAFETY_OFFICER|SECURITY_OFFICER';

let idp: FakeOidc;
let app: NestExpressApplication;
let auth: AuthService;
let audit: AuditService;
const saved = { ...process.env };
const http = () => request(app.getHttpServer());

/** 로그인 — 쿠키 저장소(agent)를 돌려준다 */
async function login(user: keyof typeof USERS, returnTo = '/policies?tab=a') {
  const agent = request.agent(app.getHttpServer());
  const start = await agent.get('/api/auth/login').query({ returnTo, login_hint: user }).expect(302);
  const authorize = new URL(start.headers.location);
  expect(authorize.origin).toBe(idp.issuer);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  const back = await fetch(authorize, { redirect: 'manual' });
  expect(back.status).toBe(302);
  const cb = new URL(back.headers.get('location')!);
  expect(cb.origin + cb.pathname).toBe(`${PUBLIC}/api/auth/callback`);
  const done = await agent.get(cb.pathname + cb.search);
  return { agent, done, cb };
}

beforeAll(async () => {
  idp = await startFakeOidc({ clientId: 'ff-platform', clientSecret: 'idp-client-secret-🙂', users: USERS });
  for (const k of ['FF_ENV', 'FF_CLOCK_AT', 'FF_SCHEDULER']) delete process.env[k];
  Object.assign(process.env, {
    FF_DB: ':memory:',
    FF_SEED: 'v0.81',
    FF_AUTH: 'oidc',
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: 'ff-platform',
    OIDC_CLIENT_SECRET: 'idp-client-secret-🙂',
    FF_PUBLIC_URL: PUBLIC,
    FF_SESSION_SECRET: 'x'.repeat(48),
    OIDC_ROLE_MAP: ROLE_MAP,
  });
  app = await createApp({ logger: false });
  await app.init();
  auth = app.get(AuthService);
  audit = app.get(AuditService);
});
afterAll(async () => {
  await app?.close();
  await idp?.close();
  process.env = saved;
});

describe('SSO 로그인 흐름 (인가 코드 + PKCE, BFF 세션)', () => {
  it('설정 조회는 oidc, 로그인 전 me는 미인증', async () => {
    expect((await http().get('/api/auth/config').expect(200)).body).toEqual({ mode: 'oidc' });
    expect((await http().get('/api/auth/me').expect(200)).body).toEqual({ authenticated: false, mode: 'oidc' });
  });

  it('IdP를 거쳐 돌아오면 httpOnly 세션 쿠키와 안전한 returnTo, me에 이름·부여 역할', async () => {
    const { agent, done } = await login('author');
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe('/policies?tab=a');
    const cookies = ([] as string[]).concat(done.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('ff_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);
    // 로그인 상태 쿠키는 한 번 쓰고 지운다
    expect(cookies.find((c) => c.startsWith('ff_oidc='))).toMatch(/Max-Age=0/);
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me).toEqual({ authenticated: true, mode: 'oidc', user: { id: USERS.author.sub, name: '김작성', email: 'author@oem.example', roles: ['FEATURE_AUTHOR'] } });
    // DB에는 세션 ID 원문이 없고 해시만
    const raw = decodeURIComponent(session.split(';')[0].slice('ff_session='.length)).split('.')[0];
    const db = (auth as unknown as { db: { all: (s: string) => { id_hash: string }[] } }).db;
    expect(db.all('SELECT id_hash FROM auth_session').some((r) => r.id_hash.includes(raw))).toBe(false);
  });

  it('열린 리디렉트 차단 — //evil, /\\evil, 절대 주소, 탭이 섞인 경로는 /로', async () => {
    for (const bad of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/\t/evil.example', 'javascript:alert(1)']) {
      const { done } = await login('author', bad);
      expect(done.status).toBe(302);
      expect(done.headers.location, bad).toBe('/');
    }
  });

  it('state가 다르면 거부(세션 없음), 상태 쿠키 없이 콜백만 오면 거부', async () => {
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/login').query({ login_hint: 'author' }).expect(302);
    const back = await fetch(start.headers.location, { redirect: 'manual' });
    const cb = new URL(back.headers.get('location')!);
    cb.searchParams.set('state', 'forged-state');
    const r = await agent.get(cb.pathname + cb.search).set('Accept', 'application/json');
    expect(r.status).toBe(400);
    expect(r.body.error.details.reason).toBe('LOGIN_STATE');
    expect(([] as string[]).concat(r.headers['set-cookie'] ?? []).some((c) => c.startsWith('ff_session=') && !/Max-Age=0/.test(c))).toBe(false);
    // 다른 브라우저(쿠키 없음)로 콜백만 보내도 거부
    const naked = await http().get('/api/auth/callback?code=x&state=y').set('Accept', 'text/html');
    expect(naked.status).toBe(400);
    expect(naked.text).toContain('로그인할 수 없습니다');
  });

  it('IdP 그룹이 역할에 매핑되지 않으면 403 안내와 DENIED 감사, 세션 없음', async () => {
    const { done, agent } = await login('nobody');
    expect(done.status).toBe(403);
    expect(done.text).toContain('역할이 없습니다');
    expect((await agent.get('/api/auth/me')).body.authenticated).toBe(false);
    expect(audit.list({ actorId: USERS.nobody.sub, result: 'DENIED' }).some((a) => a.action === 'AUTH_LOGIN')).toBe(true);
  });

  it('같은 브라우저에서 다시 로그인하면 새 세션 ID — 이전 세션 쿠키는 더 쓰이지 않는다(세션 고정 방지)', async () => {
    const { agent, done } = await login('author');
    const first = ([] as string[]).concat(done.headers['set-cookie'] ?? []).find((c) => c.startsWith('ff_session='))!.split(';')[0];
    const start = await agent.get('/api/auth/login').query({ login_hint: 'author' }).expect(302);
    const back = await fetch(start.headers.location, { redirect: 'manual' });
    const cb = new URL(back.headers.get('location')!);
    const again = await agent.get(cb.pathname + cb.search).expect(302);
    const second = ([] as string[]).concat(again.headers['set-cookie'] ?? []).find((c) => c.startsWith('ff_session='))!.split(';')[0];
    expect(second).not.toBe(first);
    await http().get('/api/features').set('Cookie', first).expect(401);
    await http().get('/api/features').set('Cookie', second).expect(200);
  });

  it('로그아웃 — 세션 삭제·쿠키 제거·IdP 로그아웃 주소, 그 뒤 401', async () => {
    const { agent } = await login('author');
    await agent.get('/api/features').expect(200);
    // 다른 출처에서 보낸 로그아웃은 거부
    await agent.post('/api/auth/logout').set('Origin', 'https://evil.example').send({}).expect(403);
    const out = await agent.post('/api/auth/logout').set('Origin', PUBLIC).send({}).expect(200);
    expect(out.body.endSessionUrl).toContain(`${idp.issuer}/logout`);
    expect(out.body.endSessionUrl).toContain(encodeURIComponent(`${PUBLIC}/login`));
    await agent.get('/api/features').expect(401);
  });
});

describe('신원 — 헤더로 주장한 신원·역할을 믿지 않는다', () => {
  it('신원 없는 GET은 401(익명 AUDITOR 없음), 상태 점검·로그인 창구는 연다', async () => {
    for (const p of ['/api/features', '/api/audit', '/api/pki/hsm', '/api/iam/me']) expect((await http().get(p)).status, p).toBe(401);
    await http().get('/api/health').expect(200);
    await http().get('/api/health/live').expect(200);
    await http().get('/api/auth/config').expect(200);
  });

  it('세션 없이 X-Actor-Role: SECURITY_OFFICER를 보내면 401', async () => {
    const r = await http().get('/api/audit').set('X-Actor-Id', 'usr-csm').set('X-Actor-Role', 'SECURITY_OFFICER');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
    await http().post('/api/notifications/read-all').set('X-Actor-Id', 'usr-csm').set('X-Actor-Role', 'SECURITY_OFFICER').set('Origin', PUBLIC).send({}).expect(401);
  });

  it('작성자 세션이 보안 책임자 역할을 주장하면 403과 DENIED 감사', async () => {
    const { agent } = await login('author');
    const r = await agent.get('/api/audit').set('X-Actor-Role', 'SECURITY_OFFICER');
    expect(r.status).toBe(403);
    const denied = audit.list({ actorId: USERS.author.sub, result: 'DENIED' });
    expect(denied.some((a) => a.reason?.includes('부여되지 않은 역할'))).toBe(true);
  });

  it('X-Actor-Id는 무시 — 행위자는 세션 주체, 역할은 부여된 것 중 경로가 허용하는 것', async () => {
    const { agent } = await login('integrator');
    const me = (await agent.get('/api/iam/me').set('X-Actor-Id', 'usr-someone-else').expect(200)).body;
    expect(me.id).toBe(USERS.integrator.sub);
    const as = (await agent.get('/api/iam/me').set('X-Actor-Role', 'SECURITY_OFFICER').expect(200)).body;
    expect(as.role).toBe('SECURITY_OFFICER');
  });

  it('CSRF — 쿠키로 인증한 변경 요청은 설치 출처의 Origin이 있어야 한다', async () => {
    const { agent } = await login('author');
    await agent.post('/api/notifications/read-all').send({}).expect(403);
    await agent.post('/api/notifications/read-all').set('Origin', 'https://evil.example').send({}).expect(403);
    const ok = await agent.post('/api/notifications/read-all').set('Origin', PUBLIC).send({});
    expect(ok.status).toBeLessThan(300);
  });
});

describe('Bearer 접근 토큰(API 클라이언트)', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const bearer = (t: string) => http().get('/api/iam/me').set('Authorization', `Bearer ${t}`);

  it('올바른 토큰은 통과, 역할은 그룹 클레임에서', async () => {
    const r = await bearer(idp.accessToken('author')).expect(200);
    expect(r.body).toMatchObject({ id: USERS.author.sub, role: 'FEATURE_AUTHOR' });
  });

  it('만료·다른 대상·다른 발급자·서명 위조·다른 키·alg none·HS256·거대 토큰·형식 오류는 모두 401', async () => {
    const cases: [string, string][] = [
      ['EXPIRED', idp.accessToken('author', { exp: now() - 120, iat: now() - 600 })],
      ['WRONG_AUDIENCE', idp.accessToken('author', { aud: 'some-other-api' })],
      ['WRONG_ISSUER', idp.accessToken('author', { iss: 'https://evil.example' })],
      ['BAD_SIGNATURE', idp.accessToken('author', {}, { tamper: true })],
      ['BAD_SIGNATURE', idp.accessToken('author', {}, { key: idp.otherKey() })],
      ['ALG_NOT_ALLOWED', idp.accessToken('author', {}, { alg: 'none' })],
      ['ALG_NOT_ALLOWED', idp.accessToken('author', {}, { alg: 'HS256' })],
      ['NOT_YET_VALID', idp.accessToken('author', { nbf: now() + 3600 })],
    ];
    for (const [reason, t] of cases) {
      const r = await bearer(t);
      expect(r.status, reason).toBe(401);
      expect(r.body.error.details?.reason, reason).toBe(reason);
      // 토큰 원문은 오류에 나오지 않는다
      expect(JSON.stringify(r.body)).not.toContain(t.split('.')[1]);
    }
    const big = await bearer('a'.repeat(12_400) + '.b.c');
    expect(big.status).toBe(401);
    expect(big.body.error.details.reason).toBe('TOO_LARGE');
    expect((await http().get('/api/iam/me').set('Authorization', 'Basic abc')).status).toBe(401);
  });

  it('시계 차이 60초 안의 만료는 받아 준다', async () => {
    await bearer(idp.accessToken('author', { exp: now() - 30 })).expect(200);
  });

  it('모르는 kid — JWKS를 다시 받되 30초에 한 번만', async () => {
    const t1 = idp.accessToken('author', {}, { kid: 'unknown-kid-1' });
    const before = idp.hits.jwks;
    expect((await bearer(t1)).status).toBe(401);
    expect((await bearer(idp.accessToken('author', {}, { kid: 'unknown-kid-2' }))).status).toBe(401);
    expect(idp.hits.jwks - before).toBeLessThanOrEqual(1);
  });

  it('토큰의 그룹이 역할에 매핑되지 않으면 403', async () => {
    expect((await bearer(idp.accessToken('nobody'))).status).toBe(403);
  });
});

describe('세션 만료 — 유휴(기본 60분, 미끄럼)·절대 수명(기본 480분)', () => {
  it('유휴 시간이 지나면 다시 로그인해야 한다', async () => {
    const { agent } = await login('author');
    const t0 = Date.now();
    try {
      auth.now = () => t0 + 59 * 60_000;
      await agent.get('/api/features').expect(200);
      // 마지막 사용(59분) 뒤 59분 — 살아 있다(미끄럼)
      auth.now = () => t0 + 118 * 60_000;
      await agent.get('/api/features').expect(200);
      auth.now = () => t0 + 179 * 60_000;
      await agent.get('/api/features').expect(401);
    } finally {
      auth.now = Date.now;
    }
  });

  it('계속 써도 절대 수명이 지나면 끝난다', async () => {
    const { agent } = await login('author');
    const t0 = Date.now();
    try {
      for (let m = 50; m <= 450; m += 50) {
        auth.now = () => t0 + m * 60_000;
        await agent.get('/api/auth/me').expect(200);
      }
      auth.now = () => t0 + 481 * 60_000;
      expect((await agent.get('/api/auth/me')).body.authenticated).toBe(false);
      await agent.get('/api/features').expect(401);
    } finally {
      auth.now = Date.now;
    }
  });
});

describe('승인자 서명 키 — 로그인 때 등록, 승인 중 즉석 생성 금지, 한 사람이 두 칸 불가 (RD-SEC-05)', () => {
  const KILL = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '현장 결함', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' };

  it('로그인하면 APPROVER_KEY_ENROLLED 감사, 다시 로그인해도 키는 하나', async () => {
    await login('opslead');
    await login('opslead');
    const enrolled = audit.list({ actorId: USERS.opslead.sub }).filter((a) => a.action === 'APPROVER_KEY_ENROLLED');
    expect(enrolled).toHaveLength(1);
  });

  it('FSM·CSM을 함께 가진 사람이 역할을 바꿔 두 번째 칸을 채우려 하면 거부, 키 미등록 Bearer 승인자는 거부', async () => {
    const ops = (await login('ops')).agent;
    const integ = (await login('integrator')).agent;
    const lead = (await login('opslead')).agent;
    const k = (await ops.post('/api/kill-requests').set('Origin', PUBLIC).set('X-Actor-Role', 'OPERATOR').send(KILL).expect(201)).body;
    await integ.post(`/api/kill-requests/${k.killId}/approvals`).set('Origin', PUBLIC).set('X-Actor-Role', 'SAFETY_OFFICER').send({}).expect(201);
    const twice = await integ.post(`/api/kill-requests/${k.killId}/approvals`).set('Origin', PUBLIC).set('X-Actor-Role', 'SECURITY_OFFICER').send({});
    expect(twice.status).toBe(409);
    expect(twice.body.error.details.code).toBe('DUPLICATE');
    // 로그인한 적 없는 운영 리더(Bearer) — 승인 서명 키가 없으니 승인할 수 없다(즉석 생성 금지)
    const api = await http().post(`/api/kill-requests/${k.killId}/approvals`).set('Authorization', `Bearer ${idp.accessToken('apilead')}`).send({});
    expect(api.status).toBe(403);
    expect(api.body.error.details.code).toBe('APPROVER_KEY_NOT_ENROLLED');
    // 로그인해 키가 등록된 운영 리더는 승인해 발행한다
    const issued = (await lead.post(`/api/kill-requests/${k.killId}/approvals`).set('Origin', PUBLIC).send({}).expect(201)).body;
    expect(issued.approvals.map((a: { approverId: string }) => a.approverId)).toEqual([USERS.integrator.sub, USERS.opslead.sub]);
  });
});
