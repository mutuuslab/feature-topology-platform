// 시험 OTA 서버 ↔ 적합성 검사(IF-05 v1) — 참조 구현이 규격을 지키고, 검사가 규격 위반을 실제로 잡는다. OpenAPI 문서가 같은 값을 말한다.
// readiness: RD-OPS-04
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runConformance } from './conformance.ts';
import { boundedDelay, FF_WEBHOOK_PATH, MAX_TIMER_MS, OUTCOMES, simConfig, simTarget, SIM_TARGET_HOSTS, SPEC_VERSION, startOtaReference, type Fault } from './server.ts';

const SECRET = 'conformance-client-secret-0001';
const WEBHOOK = 'conformance-webhook-secret-000000000001';

async function run(faults: Fault[] = []) {
  const ref = await startOtaReference({ port: 0, clientSecret: SECRET, webhookSecret: WEBHOOK, scenario: 'some-no-response', delayMs: 100, webhookRetryMs: 100, faults });
  try {
    return await runConformance({
      url: ref.url,
      tokenUrl: ref.tokenUrl,
      clientId: 'ff-platform',
      clientSecret: SECRET,
      webhookSecret: WEBHOOK,
      webhookPort: 0,
      deadlineSec: 2,
      graceMs: 3000,
      onReceiver: (url) => ref.configure({ webhookUrl: url }),
    });
  } finally {
    await ref.close();
  }
}

describe('OTA 서버 적합성 검사 (IF-05 v1)', () => {
  it('시험 OTA 서버는 모든 검사를 통과한다', async () => {
    const r = await run();
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.id} ${c.title} — ${c.detail}`);
    assert.deepEqual(failed, []);
    assert.ok(r.checks.length >= 18, `검사 ${r.checks.length}개`);
  });

  it('규격을 어기면 해당 검사가 실패한다 — 멱등 키 무시·틀린 webhook 서명·재전송 안 함·차량 결과(APPLIED)를 webhook에', async () => {
    const r = await run(['no-idempotency', 'bad-webhook-signature', 'no-webhook-retry', 'vehicle-results-in-webhook']);
    const failed = new Set(r.checks.filter((c) => !c.ok).map((c) => c.id));
    for (const id of ['C09', 'C10', 'C15', 'C16', 'C17']) assert.ok(failed.has(id), `${id}가 실패해야 한다 (실패: ${[...failed].join(',')})`);
    assert.equal(r.ok, false);
  });

  it('OpenAPI 문서(docs/80-integration/ota-if05.openapi.json)가 규격 판·경로·결과 값을 같게 말한다', () => {
    const doc = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', '80-integration', 'ota-if05.openapi.json'), 'utf8'));
    assert.match(doc.openapi, /^3\.1\./);
    assert.equal(doc.info.version, SPEC_VERSION);
    for (const p of ['/oauth/token', '/ota/v1/health', '/ota/v1/jobs', '/ota/v1/jobs/{jobId}', '/ota/v1/jobs/{jobId}/cancel']) assert.ok(doc.paths[p], `경로 ${p}`);
    assert.ok(doc.webhooks?.vehicleResults, 'webhook vehicleResults');
    assert.deepEqual(doc.components.schemas.VehicleOutcome.enum, [...OUTCOMES]);
  });
});

// CodeQL js/request-forgery·js/resource-exhaustion(2026-10-25) — 시험 손잡이로 임의 주소에 요청을 보내게 하거나 끝없는 타이머를 걸 수 없다
describe('시험 손잡이(/_sim/*) 방어', () => {
  it('webhook·Lake 주소는 허용 호스트(loopback)·정해진 경로만 — 받은 문자열이 아니라 다시 만든 주소', () => {
    assert.equal(simTarget('http://127.0.0.1:9001/api/ota/v1/events', SIM_TARGET_HOSTS, FF_WEBHOOK_PATH), 'http://127.0.0.1:9001/api/ota/v1/events');
    assert.equal(simTarget('http://localhost:9001', SIM_TARGET_HOSTS, ''), 'http://localhost:9001');
    assert.equal(simTarget(null, SIM_TARGET_HOSTS, ''), null);
    for (const bad of ['http://169.254.169.254/api/ota/v1/events', 'http://10.0.0.5:9001/api/ota/v1/events', 'file:///etc/passwd', 'http://127.0.0.1:9001/admin', 'http://u:p@127.0.0.1:9001/api/ota/v1/events', 'http://127.0.0.1:9001/api/ota/v1/events?x=1', 'not a url', 42])
      assert.ok(simTarget(bad, SIM_TARGET_HOSTS, FF_WEBHOOK_PATH) instanceof Error, String(bad));
    // 시작할 때 늘린 호스트만 더 받는다
    assert.equal(simTarget('https://ota-test.oem.example/api/ota/v1/events', ['ota-test.oem.example'], FF_WEBHOOK_PATH), 'https://ota-test.oem.example:443/api/ota/v1/events');
  });

  it('설정 본문 검사 — 지연 상한·모르는 결함·시나리오 이름', () => {
    assert.deepEqual(simConfig({ scenario: 'silent', delayMs: 2000 }, SIM_TARGET_HOSTS), { scenario: 'silent', delayMs: 2000 });
    assert.equal(typeof simConfig({ delayMs: 10 ** 9 }, SIM_TARGET_HOSTS), 'string');
    assert.equal(typeof simConfig({ faults: ['rm-rf'] }, SIM_TARGET_HOSTS), 'string');
    assert.equal(typeof simConfig({ scenario: 'nope' }, SIM_TARGET_HOSTS), 'string');
    assert.equal(typeof simConfig([], SIM_TARGET_HOSTS), 'string');
    assert.equal(boundedDelay(-5), 0);
    assert.equal(boundedDelay(Number.NaN), 0);
    assert.equal(boundedDelay(10 ** 12), MAX_TIMER_MS);
  });

  it('HTTP로 — 내부 주소를 가리키는 설정은 400(전에는 200으로 받아 그 주소로 webhook을 보냈다), 7일 넘는 기한은 400, /_sim/expire는 예약을 지금 실행', async () => {
    const ref = await startOtaReference({ port: 0, clientSecret: SECRET, webhookSecret: WEBHOOK, delayMs: 60_000 });
    try {
      const sim = (path: string, body: unknown) => fetch(`${ref.url}${path}`, { method: 'POST', headers: { 'x-sim-admin': SECRET, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await sim('/_sim/config', { webhookUrl: 'http://169.254.169.254/latest/meta-data' })).status, 400);
      assert.equal((await sim('/_sim/config', { lakeUrl: 'http://metadata.google.internal' })).status, 400);
      assert.equal((await sim('/_sim/config', { delayMs: 10 ** 10 })).status, 400);
      assert.equal((await sim('/_sim/config', '{')).status, 400);
      const ok = await sim('/_sim/config', { webhookUrl: `http://127.0.0.1:1${FF_WEBHOOK_PATH}` });
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as { webhookUrl: string }).webhookUrl, `http://127.0.0.1:1${FF_WEBHOOK_PATH}`);

      const tok = (await (await fetch(ref.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'ff-platform', client_secret: SECRET }) })).json()) as { access_token: string };
      const job = (jobId: string, deadlineAt: string) =>
        fetch(`${ref.url}/ota/v1/jobs`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tok.access_token}`, 'ota-spec-version': SPEC_VERSION, 'idempotency-key': jobId, 'content-type': 'application/json' },
          body: JSON.stringify({ jobId, publicationId: 'PUB-1', kind: 'POLICY', priority: 'NORMAL', targets: ['VIN-1', 'VIN-2'], deadlineAt, publication: { publicationId: 'PUB-1', payload: {}, signature: { payloadHash: `sha256:${'0'.repeat(64)}` } } }),
        });
      assert.equal((await job('J-FAR', new Date(Date.now() + MAX_TIMER_MS + 3600_000).toISOString())).status, 400);
      assert.equal((await job('J-1', new Date(Date.now() + 3600_000).toISOString())).status, 202);
      // 지연 60초·기한 1시간 — 기다리지 않고 앞당긴다: 차량 결과(DELIVERED) 뒤 기한이 지나 끝난다
      const r = await sim('/_sim/expire', { jobId: 'J-1' });
      assert.equal(r.status, 200);
      const v = (await r.json()) as { state: string; counts: Record<string, number> };
      assert.equal(v.state, 'COMPLETED');
      assert.equal(v.counts.DELIVERED, 2);
      assert.equal((await sim('/_sim/expire', { jobId: 'J-404' })).status, 404);
    } finally {
      await ref.close();
    }
  });
});
