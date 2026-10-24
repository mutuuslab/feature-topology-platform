// 운영 모드(FF_ENV=production) — 위험한 기본값 거부와 HTTP 기본 방어. 출시 준비 게이트(harness/readiness.json)의 완료 조건 시험.
// readiness: RD-OPS-01, RD-OPS-12, RD-SEC-07, RD-SEC-09, RD-SEC-10, RD-SEC-11, RD-OPS-08
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { rateLimit } from '../../src/kernel/http-hardening';
import { runtimeConfigProblems, seedOf } from '../../src/kernel/runtime-config';

const GOOD = { FF_ENV: 'production', FF_DB: '/var/lib/ff/ff.db', FF_INSTANCE_ID: 'oem-a', UNLEASH_MODE: 'off' };

describe('운영 모드 설정 검사 — 문제를 한 번에 모두 알려 준다', () => {
  it('운영 모드가 아니면 지금까지의 기본값을 그대로 쓴다(데모 데이터·메모리 DB)', () => {
    expect(runtimeConfigProblems({})).toEqual([]);
    expect(seedOf({})).toBe('v0.81');
  });

  it('갖춘 설정은 통과하고, 운영 모드의 시드 기본값은 빈 DB(none)', () => {
    expect(runtimeConfigProblems(GOOD)).toEqual([]);
    expect(seedOf(GOOD)).toBe('none');
  });

  it('메모리 DB·데모 시드·설치 식별 없음·시험 손잡이·모의 비밀·모의 Unleash·가상 검증 실행기·와일드카드 출처를 모두 거부', () => {
    const p = runtimeConfigProblems({
      FF_ENV: 'production',
      FF_DB: ':memory:',
      FF_SEED: 'v0.81',
      FF_SCHEDULER: 'manual',
      FF_HSM_VEHICLE_ROOT: 'x',
      JIRA_WEBHOOK_SECRET: 'ff-mock-jira-secret',
      FF_CORS_ORIGINS: '*,https://ff.oem.example',
      SIM_MODE: 'auto',
    }).join('\n');
    for (const k of ['FF_DB', 'FF_SEED=v0.81', 'FF_INSTANCE_ID', 'FF_SCHEDULER', 'FF_HSM_VEHICLE_ROOT', 'JIRA_WEBHOOK_SECRET', "'*'", 'UNLEASH_MODE가 mock', 'SIM_MODE=auto']) expect(p).toContain(k);
    expect(p).not.toContain('https://ff.oem.example');
    // 비밀값은 메시지에 나오지 않는다
    expect(p).not.toContain('ff-mock-jira-secret');
  });

  it('Unleash live는 주소·토큰이 있어야 한다', () => {
    expect(runtimeConfigProblems({ ...GOOD, UNLEASH_MODE: 'live' }).join('\n')).toMatch(/UNLEASH_URL[\s\S]*UNLEASH_ADMIN_TOKEN/);
  });
});

describe('운영 모드 부팅 — 파일 DB · 빈 DB · 보안 헤더 · CORS 허용 목록 · 요청 제한 · webhook 비밀 강제', () => {
  const saved = { ...process.env };
  let dir: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ff-prod-'));
    for (const k of ['FF_SEED', 'FF_SCHEDULER', 'FF_CLOCK_AT', 'GITLAB_WEBHOOK_TOKEN', 'JIRA_WEBHOOK_SECRET', 'CODEBEAMER_WEBHOOK_SECRET', 'FF_EXT_SYNC_SEED']) delete process.env[k];
    Object.assign(process.env, GOOD, { FF_DB: join(dir, 'ff.db'), FF_CORS_ORIGINS: 'https://ff.oem.example', FF_RATE_LIMIT: '40', FF_BUILD_SHA: 'abc1234' });
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('설정이 위험하면 앱을 만들기 전에 멈춘다', async () => {
    const db = process.env.FF_DB;
    process.env.FF_DB = ':memory:';
    await expect(createApp({ logger: false })).rejects.toThrow(/운영 모드\(FF_ENV=production\) 설정 오류[\s\S]*FF_DB/);
    process.env.FF_DB = db;
  });

  it('데모 데이터 없이 빈 DB로 뜨고, 준비 점검은 마이그레이션·쓰기 가능을 확인한다', async () => {
    const h = await http().get('/api/health').expect(200);
    expect(h.body.seed).toBeNull();
    expect(h.body.counts.features).toBe(0);
    const live = await http().get('/api/health/live').expect(200);
    expect(live.body).toMatchObject({ status: 'ok', mode: 'production', instance: 'oem-a', commit: 'abc1234' });
    expect(live.body.version).toMatch(/^\d+\.\d+\.\d+/);
    const ready = await http().get('/api/health/ready').expect(200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.checks.migrations.ok).toBe(true);
    expect(ready.body.checks.dbWritable.ok).toBe(true);
  });

  it('보안 헤더 — nosniff·frame 금지·Referrer·CSP·HSTS, X-Powered-By 없음', async () => {
    const r = await http().get('/api/health/live');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['strict-transport-security']).toContain('max-age=');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS — 허용 목록의 출처만 되돌려 주고, 목록 밖 출처에는 CORS 헤더가 없다', async () => {
    const ok = await http().get('/api/health/live').set('Origin', 'https://ff.oem.example');
    expect(ok.headers['access-control-allow-origin']).toBe('https://ff.oem.example');
    const bad = await http().get('/api/health/live').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('webhook 비밀값을 설정하지 않으면 공개된 모의 값으로도 서명을 만들 수 없다(401)', async () => {
    const r = await http().post('/api/webhooks/gitlab').set('X-Gitlab-Token', 'ff-mock-gitlab-token').set('X-Gitlab-Event', 'Merge Request Hook').send({ object_kind: 'merge_request' });
    expect(r.status).toBe(401);
    const empty = await http().post('/api/webhooks/gitlab').set('X-Gitlab-Event', 'Merge Request Hook').send({ object_kind: 'merge_request' });
    expect(empty.status).toBe(401);
  });

  it('본문 크기 제한 — 넘으면 413 봉투(서버 오류 500이 아니다)', async () => {
    const r = await http().post('/api/webhooks/jira').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'a'.repeat(200_000) }));
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('VALIDATION');
  });
});

describe('요청 제한 — 출처별 1분 창, 상태 점검은 세지 않는다', () => {
  afterEach(() => undefined);
  it('한도를 넘으면 429와 Retry-After, 창이 지나면 다시 받는다', () => {
    let t = 0;
    const mw = rateLimit(2, () => t);
    const run = (path = '/api/features') => {
      const res: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
      let passed = false;
      mw(
        { path, ip: '10.0.0.1', socket: {} } as never,
        { setHeader: (k: string, v: string) => (res.headers[k] = v), status: (s: number) => ((res.status = s), { json: (b: unknown) => (res.body = b) }) } as never,
        () => (passed = true),
      );
      return { passed, ...res };
    };
    expect(run().passed).toBe(true);
    expect(run().passed).toBe(true);
    const third = run();
    expect(third.passed).toBe(false);
    expect(third.status).toBe(429);
    expect(Number(third.headers['Retry-After'])).toBeGreaterThan(0);
    expect(run('/api/health/ready').passed).toBe(true);
    t = 60_000;
    expect(run().passed).toBe(true);
  });
});
