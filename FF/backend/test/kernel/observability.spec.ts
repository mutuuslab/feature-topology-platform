// 관측 — 상관 ID·JSON 로그·요청 로그·지표(출시 준비 RD-OPS-11)
// readiness: RD-OPS-11
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory';
import { JsonLogger, logFormat, Metrics, metricsEndpoint, requestLogOn } from '../../src/kernel/observability';

describe('관측 — 단위', () => {
  it('운영 모드는 JSON 로그·요청 로그가 기본, 환경 변수로 바꿀 수 있다', () => {
    expect(logFormat({})).toBe('text');
    expect(logFormat({ FF_ENV: 'production' })).toBe('json');
    expect(logFormat({ FF_ENV: 'production', FF_LOG_FORMAT: 'text' })).toBe('text');
    expect(requestLogOn({})).toBe(false);
    expect(requestLogOn({ FF_ENV: 'production' })).toBe(true);
    expect(requestLogOn({ FF_REQUEST_LOG: '1' })).toBe(true);
  });

  it('JSON 로거 — 한 줄에 하나, 오류는 stack 필드로', () => {
    const lines: string[] = [];
    const log = new JsonLogger((l) => lines.push(l));
    log.log('시작', 'Boot');
    log.error(new Error('터짐'));
    log.event({ type: 'request', status: 200 });
    const [a, b, c] = lines.map((l) => JSON.parse(l));
    expect(a).toMatchObject({ level: 'info', msg: '시작', context: 'Boot' });
    expect(b).toMatchObject({ level: 'error', msg: '터짐' });
    expect(b.stack).toContain('Error: 터짐');
    expect(c).toMatchObject({ level: 'info', type: 'request', status: 200 });
    expect(lines.every((l) => !l.includes('\n'))).toBe(true);
  });

  it('지표 — 운영 모드는 토큰이 없으면 꺼짐(404), 틀리면 401, 맞으면 텍스트', () => {
    const m = new Metrics();
    m.observe('GET', '/api/features', 200, 0.02);
    const call = (env: Record<string, string>, auth?: string) => {
      const res: { code?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
      const r = { status: (c: number) => ((res.code = c), { json: (b: unknown) => (res.body = b) }), setHeader: (k: string, v: string) => (res.headers[k] = v), send: (b: unknown) => ((res.code ??= 200), (res.body = b)) };
      metricsEndpoint(m, env)({ header: (k: string) => (k === 'authorization' ? auth : undefined) } as never, r as never);
      return res;
    };
    expect(call({ FF_ENV: 'production' }).code).toBe(404);
    expect(call({ FF_ENV: 'production', FF_METRICS_TOKEN: 't'.repeat(24) }, 'Bearer nope').code).toBe(401);
    const ok = call({ FF_ENV: 'production', FF_METRICS_TOKEN: 't'.repeat(24) }, `Bearer ${'t'.repeat(24)}`);
    expect(ok.code).toBe(200);
    expect(String(ok.body)).toContain('ff_http_requests_total{method="GET",route="/api/features",status="200"} 1');
    expect(String(ok.body)).toContain('ff_http_request_duration_seconds_bucket{method="GET",route="/api/features",le="0.025"} 1');
  });
});

describe('관측 — 앱 조립(main.ts와 같은 createApp)', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    process.env.FF_DB = ':memory:';
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it('상관 ID — 받은 값은 그대로 돌려주고, 없거나 형식이 틀리면 새로 만든다', async () => {
    expect((await http().get('/api/health/live').set('X-Correlation-Id', 'req-abc_123')).headers['x-correlation-id']).toBe('req-abc_123');
    const gen = (await http().get('/api/health/live')).headers['x-correlation-id'];
    expect(gen).toMatch(/^[0-9a-f-]{36}$/);
    const bad = (await http().get('/api/health/live').set('X-Correlation-Id', 'x'.repeat(200))).headers['x-correlation-id'];
    expect(bad).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('지표 — 라우트 틀(:id)로 묶어 센다(경로 값마다 따로 세지 않는다)', async () => {
    await http().get('/api/features/FEAT-00022/versions/1.0.0');
    await http().get('/api/features/FEAT-00024/versions/1.0.0');
    await http().get('/api/no-such-thing/FEAT-00022');
    const text = (await http().get('/api/health/metrics').expect(200)).text;
    expect(text).toMatch(/ff_http_requests_total\{method="GET",route="\/api\/features\/:id\/versions\/:ver",status="200"\} 2/);
    // 없는 경로는 값 없이 unmatched 하나로
    expect(text).toMatch(/ff_http_requests_total\{method="GET",route="unmatched",status="404"\} 1/);
    expect(text).not.toContain('FEAT-00022');
    expect(text).toContain('ff_process_resident_memory_bytes');
  });
});
