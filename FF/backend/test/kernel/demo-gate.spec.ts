// 공개 데모 게이트(FF_DEMO_GATE=on) — 클라우드 VM 공개 시연(20-99). 머리글 데모 인증을 인터넷에 열 때 역할 사칭을 막는지 본다.
//  · 기준: 게이트가 없으면 누구나 머리글만으로 승인 역할을 주장해 쓴다(공개하면 안 되는 이유)
//  · 게이트: 세션 없으면 401, 표 밖 ID·역할·SYSTEM·VEHICLE 주장은 403·DENIED, 쿠키 변경 요청은 출처 확인, 로그아웃·실패 제한
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { AuditService } from '../../src/kernel/audit.service';
import { AuthService } from '../../src/kernel/auth/auth.service';
import { DEMO_LOGIN_LIMIT, demoGateProblems, gateActorOf, LoginThrottle } from '../../src/kernel/auth/demo-gate';
import { corsOrigins, runtimeConfigProblems } from '../../src/kernel/runtime-config';

const PUBLIC = 'https://ff.demo.example';
const GATE_ENV = {
  FF_DB: ':memory:',
  FF_SEED: 'v0.81',
  FF_AUTH: 'demo',
  FF_DEMO_GATE: 'on',
  FF_PUBLIC_URL: PUBLIC,
  FF_SESSION_SECRET: 's'.repeat(48),
  FF_VEHICLE_AUTH: 'required',
  GITLAB_WEBHOOK_TOKEN: 'g'.repeat(40),
  JIRA_WEBHOOK_SECRET: 'j'.repeat(40),
  CODEBEAMER_WEBHOOK_SECRET: 'c'.repeat(40),
  FF_TRUST_PROXY: 'loopback',
};
const saved = { ...process.env };
const READ_ALL = '/api/notifications/read-all';

async function boot(env: Record<string, string>) {
  for (const k of ['FF_ENV', 'FF_CLOCK_AT', 'FF_SCHEDULER', 'FF_DEMO_GATE', 'FF_AUTH', 'FF_PUBLIC_URL', 'FF_SESSION_SECRET', 'FF_TRUST_PROXY']) delete process.env[k];
  // 전시 빈 화면 채우기는 이 시험과 무관 — 부팅이 채우기를 기다리지 않게(통합 12단계)
  Object.assign(process.env, { FF_SHOWCASE_FILL: '0' }, env);
  const app = await createApp({ logger: false });
  await app.init();
  return app;
}

describe('기준 — 게이트 없는 머리글 데모 인증은 아무나 승인 역할을 주장한다(그대로 공개하면 안 된다)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await boot({ FF_DB: ':memory:', FF_SEED: 'v0.81' });
  });
  afterAll(async () => {
    await app?.close();
    process.env = { ...saved };
  });

  it('로그인 없이 표 밖 ID로 쓰기가 통과한다', async () => {
    await request(app.getHttpServer()).post(READ_ALL).set({ 'X-Actor-Id': 'attacker', 'X-Actor-Role': 'OPS_LEAD' }).send({}).expect(201);
    expect((await request(app.getHttpServer()).get('/api/auth/config').expect(200)).body).toEqual({ mode: 'demo' });
  });

  it('게이트가 꺼져 있으면 데모 로그인 창구는 404 — 머리글 없이도(화면이 브라우저 판정으로 넘어간다)', async () => {
    const r = await request(app.getHttpServer()).post('/api/auth/demo-login').send({ id: 'ff', password: 'ff' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    // 공개 창구(로그아웃·내 정보)도 머리글 없이 열린다
    await request(app.getHttpServer()).post('/api/auth/logout').send({}).expect(200);
    expect((await request(app.getHttpServer()).get('/api/auth/me').expect(200)).body).toEqual({ authenticated: false, mode: 'demo' });
  });
});

describe('공개 데모 게이트 — 서버 세션 + 데모 계정 표', () => {
  let app: NestExpressApplication;
  let audit: AuditService;
  const http = () => request(app.getHttpServer());

  /** 로그인 — 쿠키는 Secure라 http 시험 서버로 자동으로 돌아가지 않는다. 받은 쿠키를 직접 붙이는 요청기를 돌려준다 */
  const login = async (id = 'ff', password = 'ff') => {
    const res = await http().post('/api/auth/demo-login').set('Origin', PUBLIC).send({ id, password });
    const cookie = String([res.headers['set-cookie'] ?? ''].flat()[0]).split(';')[0];
    const agent = {
      get: (path: string) => http().get(path).set('Cookie', cookie),
      post: (path: string) => http().post(path).set('Cookie', cookie),
    };
    return { agent, res };
  };

  beforeAll(async () => {
    app = await boot(GATE_ENV);
    audit = app.get(AuditService);
  });
  afterAll(async () => {
    await app?.close();
    process.env = { ...saved };
  });

  it('설정 조회는 데모 + 게이트, 로그인 전 me는 미인증', async () => {
    expect((await http().get('/api/auth/config').expect(200)).body).toEqual({ mode: 'demo', gate: true });
    expect((await http().get('/api/auth/me').expect(200)).body).toEqual({ authenticated: false, mode: 'demo', gate: true });
  });

  it('세션이 없으면 조회·쓰기 모두 401 — 머리글을 붙여도 마찬가지', async () => {
    await http().get('/api/features').expect(401);
    await http().get('/api/features').set({ 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' }).expect(401);
    await http().post(READ_ALL).set({ 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': 'OPS_LEAD', Origin: PUBLIC }).send({}).expect(401);
    // 위조 세션 쿠키(서명 없음·다른 비밀)도 세션이 아니다
    await http().get('/api/features').set('Cookie', 'ff_session=abc.def').expect(401);
  });

  it('상태 점검과 화면 설정은 로그인 없이 열린다', async () => {
    await http().get('/api/health/live').expect(200);
  });

  it('틀린 비밀번호는 401, 다른 사이트에서 보낸 로그인은 403, 맞으면 httpOnly·Secure·SameSite 세션 쿠키', async () => {
    expect((await login('ff', 'nope')).res.status).toBe(401);
    expect((await http().post('/api/auth/demo-login').set('Origin', 'https://evil.example').send({ id: 'ff', password: 'ff' })).status).toBe(403);
    expect((await http().post('/api/auth/demo-login').send({ id: 'ff', password: 'ff' })).status).toBe(403);
    const { agent, res } = await login(' Ff ', 'fF');
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^ff_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect((await agent.get('/api/auth/me').expect(200)).body).toEqual({ authenticated: true, mode: 'demo', gate: true });
  });

  it('세션이 있으면 조회는 익명 감사 조회자로도, 데모 계정으로도 된다', async () => {
    const { agent } = await login();
    await agent.get('/api/features').expect(200);
    await agent.get('/api/features').set({ 'X-Actor-Id': 'usr-viewer', 'X-Actor-Role': 'AUDITOR' }).expect(200);
  });

  it('표 밖 ID·계정이 맡지 않은 역할·SYSTEM·VEHICLE 주장은 403이고 감사 이력에 DENIED로 남는다', async () => {
    const { agent } = await login();
    const forged = [
      { 'X-Actor-Id': 'attacker', 'X-Actor-Role': 'AUDITOR' },
      { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'OPS_LEAD' },
      { 'X-Actor-Id': 'usr-integrator', 'X-Actor-Role': 'SYSTEM' },
      { 'X-Actor-Id': 'usr-operator', 'X-Actor-Role': 'VEHICLE' },
      { 'X-Actor-Id': 'usr-guest', 'X-Actor-Role': 'OPERATOR' },
      { 'X-Actor-Id': 'usr-constructor', 'X-Actor-Role': 'AUDITOR' },
      { 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': '' },
    ];
    const gateDenied = () => audit.list({ result: 'DENIED', limit: 1000 }).filter((a) => a.actorId.startsWith('demo-gate:') && /데모 계정/.test(a.reason ?? '')).length;
    const before = gateDenied();
    for (const h of forged) {
      const r = await agent.post(READ_ALL).set({ ...h, Origin: PUBLIC }).send({});
      expect(r.status, JSON.stringify(h)).toBe(403);
    }
    // 조회에서도 같은 규칙
    expect((await agent.get('/api/features').set({ 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'OPS_LEAD' })).status).toBe(403);
    expect(gateDenied()).toBe(before + forged.length + 1);
  });

  it('데모 계정 표 안의 조합으로는 쓴다 — 계정이 맡은 역할만', async () => {
    const { agent } = await login();
    await agent.post(READ_ALL).set({ 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': 'OPS_LEAD', Origin: PUBLIC }).send({}).expect(201);
    await agent.post(READ_ALL).set({ 'X-Actor-Id': 'usr-integrator', 'X-Actor-Role': 'SECURITY_OFFICER', Origin: PUBLIC }).send({}).expect(201);
  });

  it('쿠키 변경 요청은 출처가 공개 주소여야 한다(CSRF) — 없거나 다르면 403', async () => {
    const { agent } = await login();
    const who = { 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': 'OPS_LEAD' };
    expect((await agent.post(READ_ALL).set(who).send({})).status).toBe(403);
    expect((await agent.post(READ_ALL).set({ ...who, Origin: 'https://evil.example' }).send({})).status).toBe(403);
  });

  it('변경 요청에 데모 계정이 없으면 401', async () => {
    const { agent } = await login();
    expect((await agent.post(READ_ALL).set('Origin', PUBLIC).send({})).status).toBe(401);
  });

  it('로그아웃하면 세션이 지워져 같은 쿠키로 다시 쓸 수 없다', async () => {
    const { agent } = await login();
    await agent.get('/api/features').expect(200);
    await agent.post('/api/auth/logout').set('Origin', PUBLIC).send({}).expect(200);
    await agent.get('/api/features').expect(401);
  });

  it('차량 창구는 머리글만으로 차량인 척할 수 없다(FF_VEHICLE_AUTH=required)', async () => {
    const r = await http().post('/vehicle/v1/ego-01/flags').set('X-Vehicle-Id', 'ego-01').send({ context: {} });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('VEHICLE_UNAUTHENTICATED');
  });

  it('공개 저장소의 모의 webhook 비밀로는 서명할 수 없다(401)', async () => {
    const r = await http().post('/api/webhooks/gitlab').set({ 'X-Gitlab-Token': 'ff-mock-gitlab-token', 'X-Gitlab-Event': 'Merge Request Hook' }).send({});
    expect(r.status).toBe(401);
  });

  it('CORS는 허용 목록만 — 다른 출처에 CORS 머리글을 주지 않는다', async () => {
    const r = await http().get('/api/health/live').set('Origin', 'https://evil.example');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(corsOrigins(process.env)).toEqual([]);
  });

  it('https 공개 주소면 HSTS를 붙인다', async () => {
    const r = await http().get('/api/health/live');
    expect(r.headers['strict-transport-security']).toContain('max-age=');
  });

  it('지표는 로그인한 방문자에게도 닫힌다 — 공개 비밀번호로 들어온 누구나이므로. 끝 빗금(프록시 정확 경로 우회)도 같다', async () => {
    const { agent } = await login();
    for (const p of ['/api/health/metrics', '/api/health/metrics/']) expect((await agent.get(p)).status, p).toBe(404);
  });

  it('다시 로그인하면 이전 세션은 지워진다(세션 고정 방지) — 새 쿠키만 산다', async () => {
    const first = await login();
    const old = String([first.res.headers['set-cookie']].flat()[0]).split(';')[0];
    const again = await http().post('/api/auth/demo-login').set({ Origin: PUBLIC, Cookie: old }).send({ id: 'ff', password: 'ff' });
    expect(again.status).toBe(200);
    const fresh = String([again.headers['set-cookie']].flat()[0]).split(';')[0];
    expect(fresh).not.toBe(old);
    await http().get('/api/features').set('Cookie', old).expect(401);
    await http().get('/api/features').set('Cookie', fresh).expect(200);
  });

  it('세션 만료 — 유휴·절대 수명이 지나면 401(같은 쿠키를 다시 써도)', async () => {
    const auth = app.get(AuthService);
    const real = auth.now;
    try {
      let t = Date.now();
      auth.now = () => t;
      const idle = await login();
      t += 121 * 60_000; // 유휴 120분 초과
      await idle.agent.get('/api/features').expect(401);
      t = Date.now();
      const abs = await login();
      for (let i = 0; i < 5; i++) {
        t += 100 * 60_000; // 유휴는 넘지 않게 계속 쓰지만 절대 수명 480분은 넘긴다
        const r = await abs.agent.get('/api/features');
        expect(r.status, `${(i + 1) * 100}분`).toBe(i < 4 ? 200 : 401);
      }
    } finally {
      auth.now = real;
    }
  });

  it('출처 변형 — null·하위 도메인·접미 도메인·포트·http·끝 빗금·대문자는 같은 출처가 아니다(쓰기·로그인·로그아웃 403)', async () => {
    const { agent } = await login();
    const who = { 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': 'OPS_LEAD' };
    const variants = ['null', 'https://evil.ff.demo.example', 'https://ff.demo.example.evil.example', 'https://ff.demo.example:8443', 'http://ff.demo.example', `${PUBLIC}/`, 'HTTPS://FF.DEMO.EXAMPLE', `${PUBLIC}, https://evil.example`];
    for (const o of variants) {
      expect((await agent.post(READ_ALL).set({ ...who, Origin: o }).send({})).status, `쓰기 ${o}`).toBe(403);
      expect((await http().post('/api/auth/demo-login').set('Origin', o).send({ id: 'ff', password: 'ff' })).status, `로그인 ${o}`).toBe(403);
      expect((await agent.post('/api/auth/logout').set('Origin', o).send({})).status, `로그아웃 ${o}`).toBe(403);
    }
    // 다른 사이트의 로그아웃 시도 뒤에도 세션은 살아 있다
    await agent.get('/api/features').expect(200);
  });

  it('머리글 변형 — 중복 머리글·쉼표 목록·대소문자·라틴1 유사 문자로 다른 계정·역할을 주장할 수 없다', async () => {
    const { agent } = await login();
    const forged: Record<string, string | string[]>[] = [
      { 'X-Actor-Id': ['usr-author', 'usr-opslead'], 'X-Actor-Role': 'OPS_LEAD' },
      { 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': ['AUDITOR', 'OPS_LEAD'] },
      { 'X-Actor-Id': 'usr-author, usr-opslead', 'X-Actor-Role': 'OPS_LEAD' },
      { 'X-Actor-Id': 'usr-opslead', 'X-Actor-Role': 'ops_lead' },
      { 'X-Actor-Id': 'USR-OPSLEAD', 'X-Actor-Role': 'OPS_LEAD' },
      { 'X-Actor-Id': 'usr-opsleäd', 'X-Actor-Role': 'OPS_LEAD' },
      { 'X-Actor-Id': 'usr-opslead x', 'X-Actor-Role': 'OPS_LEAD' },
      { 'X-Actor-Id': 'usr-guest', 'X-Actor-Role': 'AUDITOR OPS_LEAD' },
      { 'x-actor-id': 'usr-integrator', 'X-ACTOR-ROLE': 'system' },
    ];
    for (const h of forged) expect((await agent.post(READ_ALL).set({ ...h, Origin: PUBLIC } as unknown as Record<string, string>).send({})).status, JSON.stringify(h)).toBe(403);
    // 머리글 이름의 대소문자는 HTTP 규칙대로 같다 — 표 안 조합이면 통과
    await agent.post(READ_ALL).set({ 'x-actor-id': 'usr-opslead', 'X-ACTOR-ROLE': 'OPS_LEAD', Origin: PUBLIC }).send({}).expect(201);
  });

  it('데모 ID·비밀번호는 ASCII 대소문자만 무시한다 — 유니코드 대문자 변환(ﬀ→FF)으로 맞추지 않는다', async () => {
    expect((await login('ﬀ', 'ﬀ')).res.status).toBe(401);
    expect((await login('ff', 'ﬀ')).res.status).toBe(401);
  });
});

describe('로그인 속도 제한 — 바깥의 X-Forwarded-For로 출처를 바꿔 끼울 수 없다(FF_TRUST_PROXY=uniquelocal, Caddy 사설 주소만 신뢰)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    // 시험 요청은 127.0.0.1(루프백)에서 온다 — uniquelocal에 들지 않으므로 인터넷에서 곧바로 온 요청과 같다
    app = await boot({ ...GATE_ENV, FF_TRUST_PROXY: 'uniquelocal' });
  });
  afterAll(async () => {
    await app?.close();
    process.env = { ...saved };
  });

  it('실패 10회 뒤에는 X-Forwarded-For를 바꿔도 429 — 맞는 비밀번호도 기다려야 한다', async () => {
    const tryLogin = (xff: string, password: string) => http().post('/api/auth/demo-login').set({ Origin: PUBLIC, 'X-Forwarded-For': xff }).send({ id: 'ff', password });
    for (let i = 0; i < 10; i++) expect((await tryLogin(`198.51.100.${i}`, 'wrong')).status).toBe(401);
    const r = await tryLogin('203.0.113.250', 'wrong');
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await tryLogin('10.0.0.9', 'ff')).status).toBe(429);
  });
});

describe('세션 생성 한도 — 공개 비밀번호로 세션·감사 이력을 끝없이 만들 수 없다(출처별 10분 창)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    // 신뢰 프록시(루프백 = 시험에서 Caddy 역할)가 넘긴 X-Forwarded-For로 방문자를 나눈다
    app = await boot(GATE_ENV);
  });
  afterAll(async () => {
    await app?.close();
    process.env = { ...saved };
  });

  it(`한 출처에서 ${DEMO_LOGIN_LIMIT}번 로그인한 뒤에는 429, 다른 출처는 그대로`, async () => {
    const ok = (xff: string) => http().post('/api/auth/demo-login').set({ Origin: PUBLIC, 'X-Forwarded-For': xff }).send({ id: 'ff', password: 'ff' });
    for (let i = 0; i < DEMO_LOGIN_LIMIT; i++) expect((await ok('203.0.113.7')).status, `${i + 1}번째`).toBe(200);
    const r = await ok('203.0.113.7');
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await ok('203.0.113.8')).status).toBe(200);
  });
});

describe('게이트 단위 규칙', () => {
  it('데모 계정 표 — 계정·역할 조합만, 머리글이 없으면 조회만 익명', () => {
    expect(gateActorOf('', '', false)).toMatchObject({ ok: true, id: 'anonymous', role: 'AUDITOR' });
    expect(gateActorOf('', '', true)).toMatchObject({ ok: false, status: 401 });
    expect(gateActorOf('usr-quality', 'GATE_JUDGE', true)).toMatchObject({ ok: true, id: 'usr-quality', role: 'GATE_JUDGE' });
    expect(gateActorOf('usr-quality', 'OPERATOR', true)).toMatchObject({ ok: false, status: 403 });
    expect(gateActorOf('usr-__proto__', 'AUDITOR', true)).toMatchObject({ ok: false, status: 403 });
    expect(gateActorOf('usr-toString', 'AUDITOR', true)).toMatchObject({ ok: false, status: 403 });
    expect(gateActorOf('usr-guest', 'AUDITOR', true)).toMatchObject({ ok: true });
  });

  it('설정 검사 — 운영 모드·짧은 비밀·공개 주소 없음·모의 webhook 비밀·차량 인증 demo를 거부', () => {
    expect(demoGateProblems(GATE_ENV)).toEqual([]);
    expect(runtimeConfigProblems(GATE_ENV)).toEqual([]);
    const p = demoGateProblems({ FF_DEMO_GATE: 'on', FF_ENV: 'production', FF_AUTH: 'oidc', GITLAB_WEBHOOK_TOKEN: 'ff-mock-gitlab-token' }).join('\n');
    for (const k of ['운영 모드', 'FF_AUTH=demo', 'FF_SESSION_SECRET', 'FF_PUBLIC_URL', 'GITLAB_WEBHOOK_TOKEN', 'JIRA_WEBHOOK_SECRET', 'FF_VEHICLE_AUTH']) expect(p).toContain(k);
    expect(runtimeConfigProblems({ ...GATE_ENV, FF_PUBLIC_URL: 'https://ff.demo.example/app' }).join('\n')).toContain('FF_PUBLIC_URL');
    expect(demoGateProblems({})).toEqual([]);
  });

  it('설정 검사 — FF_CORS_ORIGINS는 출처(scheme://host[:port])만. null·와일드카드·경로가 있으면 쿠키 변경 요청의 출처 확인이 무너진다', () => {
    for (const bad of ['null', '*', 'https://ok.example/path', 'ok.example', 'https://ok.example, null']) expect(demoGateProblems({ ...GATE_ENV, FF_CORS_ORIGINS: bad }).join(' | '), bad).toContain('FF_CORS_ORIGINS');
    expect(demoGateProblems({ ...GATE_ENV, FF_CORS_ORIGINS: 'https://ok.example, http://localhost:9225' })).toEqual([]);
  });

  it('로그인 실패 제한 — 10분 창 10회를 넘으면 막고, 창이 지나면 푼다', () => {
    let t = 0;
    const th = new LoginThrottle(3, 1000, () => t);
    for (let i = 0; i < 3; i++) th.fail('a');
    expect(th.blocked('a')).toBeGreaterThan(0);
    expect(th.blocked('b')).toBe(0);
    t = 1000;
    expect(th.blocked('a')).toBe(0);
  });
});
