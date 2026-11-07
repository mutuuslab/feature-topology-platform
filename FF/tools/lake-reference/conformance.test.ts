// 참조 Lake 중계 서버 ↔ 적합성 검사(IF-15 중계, TL-M07) — 참조 구현이 계약을 지키고, 검사가 계약 위반을 실제로 잡는다. OpenAPI·스키마가 같은 값을 말한다.
// 설계: docs/80-integration/80-75-data-lake-server.md 3장(차량 입구)·4장(중계). 80-45 ota-reference와 같은 방식.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runLakeConformance } from './conformance.ts';
import { KNOWN_FAULTS, MESSAGE_RESULT_REASONS, MESSAGE_RESULT_STATUSES, RELAY_PAGE_KEYS, startLakeReference, STREAMS, type Fault } from './server.ts';

const TOKEN = 'lake-relay-conformance-token-0001';
const GATEWAY = 'CN=oem-gateway-1';

async function run(faults: Fault[] = []) {
  const ref = await startLakeReference({ port: 0, relayToken: TOKEN, gatewaySubjects: [GATEWAY], faults });
  try {
    return await runLakeConformance({ url: ref.url, relayToken: TOKEN, gatewaySubject: GATEWAY, longWaitSec: 1 });
  } finally {
    await ref.close();
  }
}

const DOC = join(import.meta.dirname, '..', '..', '..', 'docs', '80-integration');

describe('Lake 중계 적합성 검사 (IF-15 차량 입구·중계)', () => {
  it('참조 Lake 서버는 모든 검사를 통과한다', async () => {
    const r = await run();
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.id} ${c.title} — ${c.detail}`);
    assert.deepEqual(failed, []);
    assert.ok(r.checks.length >= 16, `검사 ${r.checks.length}개`);
    assert.equal(r.ok, true);
  });

  it('계약을 어기면 해당 검사가 실패한다 — 메시지 고침·중복 재저장·흐름 섞음·긴 대기 없음·토큰 없이 중계·주체 확인 안 함', async () => {
    const r = await run(['mutate-message', 'no-dedup', 'single-stream', 'no-long-wait', 'relay-without-token', 'no-subject-check']);
    const failed = new Set(r.checks.filter((c) => !c.ok).map((c) => c.id));
    for (const id of ['L03', 'L05', 'L07', 'L08', 'L09', 'L12', 'L13']) assert.ok(failed.has(id), `${id}가 실패해야 한다 (실패: ${[...failed].join(',')})`);
    assert.equal(r.ok, false);
  });

  it('결함 하나씩 — 각 결함은 자기 검사만으로도 잡힌다', async () => {
    const expect: Record<Fault, string> = { 'mutate-message': 'L08', 'no-dedup': 'L05', 'single-stream': 'L09', 'no-long-wait': 'L12', 'relay-without-token': 'L07', 'no-subject-check': 'L03', reorder: 'L11' };
    assert.deepEqual(Object.keys(expect).sort(), [...KNOWN_FAULTS].sort());
    for (const f of KNOWN_FAULTS) {
      const r = await run([f]);
      assert.ok(r.checks.some((c) => c.id === expect[f] && !c.ok), `${f} → ${expect[f]} 실패해야 한다`);
    }
  });

  it('OpenAPI(datalake-if15.openapi.json)·JSON Schema가 참조 서버와 같은 경로·값을 말한다', () => {
    const doc = JSON.parse(readFileSync(join(DOC, 'datalake-if15.openapi.json'), 'utf8'));
    for (const p of ['/v1/vehicle/messages', '/v1/relay/{stream}', '/v1/relay/status', '/v1/health/live', '/v1/health/ready']) assert.ok(doc.paths[p], `경로 ${p}`);
    const results = doc.components.schemas.VehicleMessageResults.properties.results.items.properties;
    assert.deepEqual(results.status.enum, [...MESSAGE_RESULT_STATUSES]);
    assert.deepEqual(results.reason.enum, [...MESSAGE_RESULT_REASONS]);
    assert.deepEqual(doc.components.schemas.RelayPage.required, [...RELAY_PAGE_KEYS]);
    assert.deepEqual(doc.components.schemas.RelayPage.properties.stream.enum, [...STREAMS]);
    const pull = doc.paths['/v1/relay/{stream}'].get.parameters;
    assert.equal(pull.find((x: any) => x.name === 'wait').schema.maximum, 25);
    assert.equal(pull.find((x: any) => x.name === 'limit').schema.maximum, 500);
    assert.equal(doc.paths['/v1/vehicle/messages'].post.requestBody.content['application/json'].schema.properties.messages.maxItems, 50);
    const record = JSON.parse(readFileSync(join(DOC, 'datalake-if15', 'relay-record.schema.json'), 'utf8'));
    assert.deepEqual(record.required, ['relay_seq', 'stream', 'received_at', 'message']);
    assert.deepEqual(record.properties.stream.enum, STREAMS.map((s) => s.toUpperCase()));
  });
});
