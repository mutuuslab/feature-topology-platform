// OTA 서버 어댑터(IF-05) 단위 — HTTP 클라이언트(토큰·401 갱신·재시도 판정·Retry-After·제한 시간·판 협상), 설정 검사, 연결 상태.
// readiness: RD-OPS-04
// readiness: RD-UX-04
import { describe, expect, it } from 'vitest';
import { OtaCallError, OtaClient } from '../../src/adapters/ota/ota-client';
import { otaWebhookSignature } from '../../src/adapters/ota/ota-server.adapter';
import { connectionStatuses } from '../../src/kernel/connections';
import { otaConfigOf, otaConfigProblems } from '../../src/kernel/ota-config';
import { runtimeConfigProblems } from '../../src/kernel/runtime-config';
import { vehicleChannelOf } from '../../src/kernel/vehicle-auth-config';

const OTA_ENV = {
  FF_OTA_URL: 'https://ota.customer.example/',
  FF_OTA_TOKEN_URL: 'https://ota.customer.example/oauth/token',
  FF_OTA_CLIENT_ID: 'ff-platform',
  FF_OTA_CLIENT_SECRET: 's'.repeat(24),
  FF_OTA_WEBHOOK_SECRET: 'w'.repeat(40),
};
const CFG = otaConfigOf(OTA_ENV)!;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'ota-spec-version': '1.0', ...headers } });

/** 가짜 fetch — 받은 요청을 기록하고 정해 둔 응답을 차례로 돌려준다 */
function fake(responses: ((url: string, init: RequestInit) => Response | Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('예상하지 못한 요청');
    return next(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const token = (t = 'tok-1', ttl = 3600) => () => json(200, { access_token: t, token_type: 'Bearer', expires_in: ttl });

describe('OTA 클라이언트 (IF-05)', () => {
  it('토큰은 client credentials·Basic 인증으로 받고 만료 전까지 다시 쓴다, 요청에 판·멱등 키 머리글', async () => {
    const { f, calls } = fake([token(), () => json(202, { jobId: 'OTJ-1', otaJobId: 'ota-1', state: 'ACCEPTED' }), () => json(200, { jobId: 'OTJ-1', state: 'IN_PROGRESS' })]);
    const c = new OtaClient(CFG, () => 1_000, f);
    const r = await c.submit({ jobId: 'OTJ-1' }, 'OTJ-1');
    await c.job('OTJ-1');
    expect(r).toMatchObject({ status: 202, body: { otaJobId: 'ota-1' }, replayed: false });
    expect(calls.map((x) => x.url)).toEqual(['https://ota.customer.example/oauth/token', 'https://ota.customer.example/ota/v1/jobs', 'https://ota.customer.example/ota/v1/jobs/OTJ-1']);
    const tokenReq = calls[0].init;
    expect((tokenReq.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(`ff-platform:${'s'.repeat(24)}`).toString('base64')}`);
    expect(String(tokenReq.body)).toContain('grant_type=client_credentials');
    const h = calls[1].init.headers as Record<string, string>;
    expect(h).toMatchObject({ authorization: 'Bearer tok-1', 'ota-spec-version': '1.0', 'idempotency-key': 'OTJ-1' });
  });

  it('401이면 토큰을 한 번 새로 받아 다시 보낸다', async () => {
    const { f, calls } = fake([token('old'), () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x', retryable: true } }), token('new'), () => json(202, { otaJobId: 'ota-2' })]);
    const r = await new OtaClient(CFG, () => 0, f).submit({ jobId: 'OTJ-2' }, 'OTJ-2');
    expect(r.body).toEqual({ otaJobId: 'ota-2' });
    expect((calls[3].init.headers as Record<string, string>).authorization).toBe('Bearer new');
  });

  it('실패 분류 — 503·429는 재시도(Retry-After 반영), 409·400은 재시도하지 않음, 네트워크·제한 시간은 재시도', async () => {
    const run = async (res: () => Response | Promise<Response>) => {
      const { f } = fake([token(), res]);
      return new OtaClient({ ...CFG, timeoutMs: 50 }, () => 0, f).submit({ jobId: 'J' }, 'J').then(
        () => null,
        (e: OtaCallError) => e,
      );
    };
    expect(await run(() => json(503, { error: { code: 'UNAVAILABLE', message: '바쁨', retryable: true } }, { 'retry-after': '7' }))).toMatchObject({ code: 'UNAVAILABLE', status: 503, retryable: true, retryAfterMs: 7000 });
    expect(await run(() => json(429, {}))).toMatchObject({ code: 'HTTP_429', retryable: true });
    expect(await run(() => json(409, { error: { code: 'IDEMPOTENCY_CONFLICT', message: '다른 본문', retryable: false } }))).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', retryable: false });
    expect(await run(() => json(400, { error: { code: 'VALIDATION', message: 'targets' } }))).toMatchObject({ code: 'VALIDATION', retryable: false });
    expect(await run(() => Promise.reject(new TypeError('fetch failed')))).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(await run(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))).toMatchObject({ code: 'TIMEOUT', retryable: true });
    // 다른 주 번호의 규격 판으로 답하면 받지 않는다
    expect(await run(() => json(202, { otaJobId: 'x' }, { 'ota-spec-version': '2.0' }))).toMatchObject({ code: 'UNSUPPORTED_SPEC_VERSION', retryable: false });
  });

  it('토큰 끝점이 거부하면 TOKEN_REJECTED(설정 오류 — 자동 재시도하지 않는다), 비밀은 메시지에 없다', async () => {
    const { f } = fake([() => json(401, { error: 'invalid_client' })]);
    const e = await new OtaClient(CFG, () => 0, f).accessToken().catch((x: OtaCallError) => x);
    expect(e).toMatchObject({ code: 'TOKEN_REJECTED', retryable: false, status: 401 });
    expect((e as Error).message).not.toContain('s'.repeat(24));
  });

  it('webhook 서명은 ext-sync와 같은 sha256=<hex> 형식, 입력은 "<시각>.<원문>"', () => {
    expect(otaWebhookSignature('k', '1700000000', '{}')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(otaWebhookSignature('k', '1700000000', '{}')).not.toBe(otaWebhookSignature('k', '1700000001', '{}'));
  });
});

describe('OTA 설정 — 시작 검사·채널·연결 상태', () => {
  it('FF_OTA_URL이 있으면 채널 기본값이 ota, 설정이 갖춰지면 문제 없음(주소 끝 / 정리)', () => {
    expect(vehicleChannelOf(OTA_ENV)).toBe('ota');
    expect(vehicleChannelOf({})).toBe('sim');
    expect(vehicleChannelOf({ FF_ENV: 'production' })).toBe('pull');
    expect(otaConfigProblems(OTA_ENV)).toEqual([]);
    expect(CFG.url).toBe('https://ota.customer.example');
  });

  it('ota를 고르면 주소·토큰 끝점·클라이언트·webhook 비밀이 필수, 운영 모드는 https만', () => {
    const p = otaConfigProblems({ FF_VEHICLE_CHANNEL: 'ota' }).join('\n');
    for (const k of ['FF_OTA_URL', 'FF_OTA_TOKEN_URL', 'FF_OTA_CLIENT_ID', 'FF_OTA_CLIENT_SECRET', 'FF_OTA_WEBHOOK_SECRET']) expect(p).toContain(k);
    expect(otaConfigProblems({ ...OTA_ENV, FF_ENV: 'production', FF_OTA_URL: 'http://ota.local' }).join('\n')).toContain('https만');
    expect(otaConfigProblems({ ...OTA_ENV, FF_OTA_URL: 'https://user:pw@ota.local' }).join('\n')).toContain('계정');
    expect(otaConfigProblems({ ...OTA_ENV, FF_OTA_WEBHOOK_SECRET: 'short' }).join('\n')).toContain('FF_OTA_WEBHOOK_SECRET');
    expect(otaConfigProblems({ ...OTA_ENV, FF_OTA_TIMEOUT_MS: '5' }).join('\n')).toContain('FF_OTA_TIMEOUT_MS');
    expect(otaConfigProblems({ ...OTA_ENV, IF_MODE_05: 'off' }).join('\n')).toContain('IF_MODE_05');
    // 주소가 있는데 다른 채널을 고르면 헷갈린다 — 시작 거부
    expect(otaConfigProblems({ ...OTA_ENV, FF_VEHICLE_CHANNEL: 'pull' }).join('\n')).toContain('FF_VEHICLE_CHANNEL=pull');
    // 데모 모드에서도 같은 검사(어댑터가 일하지 못하는 설정으로 시작하지 않는다)
    expect(runtimeConfigProblems({ FF_VEHICLE_CHANNEL: 'ota' }).join('\n')).toContain('FF_OTA_URL');
  });

  it('연결 상태 — 설정이 있으면 OTA live(화면의 모의 표시가 사라진다), 없으면 FF_CONN_OTA=live여도 모의, IF_MODE_05=off면 꺼짐', () => {
    const ota = (env: Record<string, string>) => connectionStatuses(env).find((s) => s.key === 'ota')!;
    expect(ota(OTA_ENV)).toEqual({ key: 'ota', mode: 'live', ifId: 'IF-05', liveAdapter: true });
    expect(ota({ ...OTA_ENV, FF_CONN_OTA: 'mock' }).mode).toBe('live');
    expect(ota({}).mode).toBe('mock');
    expect(ota({ FF_CONN_OTA: 'live' }).mode).toBe('mock');
    expect(ota({ ...OTA_ENV, IF_MODE_05: 'off' }).mode).toBe('off');
  });
});
