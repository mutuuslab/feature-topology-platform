// 시험 OTA 서버 ↔ 적합성 검사(IF-05 v1) — 참조 구현이 규격을 지키고, 검사가 규격 위반을 실제로 잡는다. OpenAPI 문서가 같은 값을 말한다.
// readiness: RD-OPS-04
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runConformance } from './conformance.ts';
import { OUTCOMES, SPEC_VERSION, startOtaReference, type Fault } from './server.ts';

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
