// TL-M01 — FFV1-MSG 정규 문자열·시험 벡터, VehicleMessage·RelayRecord·RelayVerdict zod가 80-75 JSON Schema와 같은 것을 받고 같은 것을 떨어뜨린다.
// (태그 계산은 백엔드 시험 backend/test/d02/vehicle-message-auth.spec.ts가 같은 벡터로 본다 — contracts는 node:crypto를 쓰지 않는 계약 층)
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_CHECK_STEPS } from '../rules/status-v2';
import { VEHICLE_AUTH_FORMAT, VEHICLE_AUTH_SKEW_MS, VehicleDeliveryAck } from '../rules/vehicle-auth';
import { VehicleReportBody } from '../rules/vehicle-requests';
import { LAKE_SCHEMA_DIR, lakeSchemaErrors, readJson } from '../testing/json-schema-lite';
import {
  RELAY_CHECK_LAYERS,
  RELAY_OUTCOMES,
  RELAY_STREAMS,
  RelayRecord,
  RelayVerdict,
  relayStreamOf,
  VEHICLE_MESSAGE_FORMAT,
  VEHICLE_MESSAGE_FUTURE_MS,
  VEHICLE_MESSAGE_KINDS,
  VEHICLE_MESSAGE_MAX_AGE_MS,
  VEHICLE_MESSAGE_SCHEMA,
  VEHICLE_MESSAGE_VERSION,
  vehicleMessageCanonical,
  vehicleMessageIdOf,
  VehicleMessage,
} from './vehicle-message';
import { FFV1_MSG_TEST_VECTORS as V } from './vehicle-message.vectors';
import { StatusReportV2 } from './wire';

const messageErrors = lakeSchemaErrors('vehicle-message.schema.json');
const relayErrors = lakeSchemaErrors('relay-record.schema.json');
const verdictErrors = lakeSchemaErrors('relay.verdict.schema.json');
const schema = (f: string) => readJson(join(LAKE_SCHEMA_DIR, f));
const clone = <T>(x: T): T => structuredClone(x) as T;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const vec = (name: string) => clone(V.vectors.find((v) => v.name === name)!.message) as any;

/** zod와 JSON Schema가 같은 판정인가 — 둘 다 통과하거나 둘 다 떨어진다 */
const agree = (value: unknown, zod: { safeParse: (v: unknown) => { success: boolean } }, json: (v: unknown) => string[]) => ({ zod: zod.safeParse(value).success, json: json(value).length === 0 });

describe('FFV1-MSG 시험 벡터', () => {
  it('정규 문자열 — 8줄, 머리말 FFV1-MSG, ref가 없으면 -, 마지막 줄은 본문 원문 SHA-256', () => {
    for (const v of V.vectors) {
      const m = v.message;
      const canonical = vehicleMessageCanonical({ kind: m.kind, ref: m.ref, pseudonym: m.pseudonym, keyEpoch: m.auth.key_epoch, timestamp: m.auth.timestamp, nonce: m.auth.nonce, bodySha256: m.body_sha256 });
      expect(canonical, v.name).toBe(v.canonical);
      const lines = canonical.split('\n');
      expect(lines).toHaveLength(8);
      expect(lines[0]).toBe(VEHICLE_MESSAGE_VERSION);
      expect(lines[2]).toBe(m.ref ?? '-');
      // 본문 원문 바이트·해시·base64가 서로 맞는다
      expect(sha(Buffer.from(v.body, 'utf8'))).toBe(m.body_sha256);
      expect(Buffer.from(m.body_b64, 'base64').toString('utf8')).toBe(v.body);
      expect(m.message_id).toBe(vehicleMessageIdOf(m.pseudonym, m.auth.nonce));
    }
    expect(new Set(V.vectors.map((v) => v.name))).toEqual(new Set(VEHICLE_MESSAGE_KINDS));
  });

  it('가명은 sha256("ffp-pseudonym|"+VIN) 앞 16자, 벡터 메시지는 zod·JSON Schema를 모두 통과한다', () => {
    expect(V.pseudonym).toBe(sha(`ffp-pseudonym|${V.vin}`).slice(0, 16));
    for (const v of V.vectors) {
      expect(VehicleMessage.safeParse(v.message).success, v.name).toBe(true);
      expect(messageErrors(v.message), v.name).toEqual([]);
      // FFV1-REQ로 같은 값을 서명한 태그는 다르다(머리말로 용도가 갈린다)
      expect(v.ffv1ReqMac).not.toBe(v.message.auth.mac);
    }
  });

  it('풀어 낸 본문은 FF가 지금 받는 형식이다 — 상태 보고 v2·VehicleDeliveryAck·VehicleReportBody', () => {
    const body = (n: string) => JSON.parse(V.vectors.find((v) => v.name === n)!.body);
    expect(StatusReportV2.safeParse(body('STATUS_REPORT')).success).toBe(true);
    expect(body('STATUS_REPORT').vehicle_pseudonym).toBe(V.pseudonym);
    expect(VehicleDeliveryAck.safeParse(body('INBOX_ACK')).success).toBe(true);
    expect(VehicleReportBody.safeParse(body('VEHICLE_REPORT')).success).toBe(true);
  });

  it('문서 사본(datalake-if15/ffv1-msg.vectors.json)이 계약 벡터와 같다 — 차량·Lake 쪽이 읽는 파일', () => {
    expect(schema('ffv1-msg.vectors.json')).toEqual(JSON.parse(JSON.stringify(V)));
  });
});

describe('VehicleMessage zod ↔ vehicle-message.schema.json', () => {
  const cases: [string, (m: any) => void][] = [
    ['VIN 필드 추가', (m) => (m.vin = V.vin)],
    ['판 다름', (m) => (m.schema = 'ff.vehicle.msg/2')],
    ['모르는 종류', (m) => (m.kind = 'TELEMETRY')],
    ['가명 대문자', (m) => (m.pseudonym = m.pseudonym.toUpperCase())],
    ['가명 15자', (m) => (m.pseudonym = m.pseudonym.slice(0, 15))],
    ['message_id 형식', (m) => (m.message_id = 'abc')],
    ['서명 방식 FFV1-REQ', (m) => (m.auth.scheme = 'FFV1-REQ')],
    ['epoch 0', (m) => (m.auth.key_epoch = 0)],
    ['epoch 문자열', (m) => (m.auth.key_epoch = '1')],
    ['시각 9자리', (m) => (m.auth.timestamp = '176031367')],
    ['시각 숫자', (m) => (m.auth.timestamp = 1760313670000)],
    ['nonce 15자', (m) => (m.auth.nonce = 'a'.repeat(15))],
    ['태그 21자', (m) => (m.auth.mac = m.auth.mac.slice(0, 21))],
    ['auth 필드 추가', (m) => (m.auth.vin = V.vin)],
    ['본문 base64 아님', (m) => (m.body_b64 = '***')],
    ['해시 대문자', (m) => (m.body_sha256 = m.body_sha256.toUpperCase())],
    ['본문 64 KiB 초과', (m) => (m.body_b64 = 'A'.repeat(87_388))],
  ];
  it.each(cases)('%s — 둘 다 떨어진다', (_, mutate) => {
    const m = vec('STATUS_REPORT');
    mutate(m);
    expect(agree(m, VehicleMessage, messageErrors)).toEqual({ zod: false, json: false });
  });

  it('ref 규칙(if/then/else) — INBOX_ACK는 전달 ID 필수, 다른 종류는 null', () => {
    const ack = vec('INBOX_ACK');
    expect(agree({ ...ack, ref: null }, VehicleMessage, messageErrors)).toEqual({ zod: false, json: false });
    expect(agree({ ...ack, ref: '' }, VehicleMessage, messageErrors)).toEqual({ zod: false, json: false });
    expect(agree({ ...vec('STATUS_REPORT'), ref: 'DLV-1' }, VehicleMessage, messageErrors)).toEqual({ zod: false, json: false });
    expect(agree({ ...ack, ref: 'x'.repeat(80) }, VehicleMessage, messageErrors)).toEqual({ zod: true, json: true });
    expect(agree({ ...ack, ref: 'x'.repeat(81) }, VehicleMessage, messageErrors)).toEqual({ zod: false, json: false });
  });

  it('enum·형식·상수가 스키마 파일과 같다(계약 표류 방지)', () => {
    const p = schema('vehicle-message.schema.json').properties;
    expect(p.schema.const).toBe(VEHICLE_MESSAGE_SCHEMA);
    expect(p.kind.enum).toEqual([...VEHICLE_MESSAGE_KINDS]);
    expect(p.auth.properties.scheme.const).toBe(VEHICLE_MESSAGE_VERSION);
    expect(new RegExp(p.pseudonym.pattern).source).toBe(VEHICLE_MESSAGE_FORMAT.pseudonym.source);
    expect(new RegExp(p.message_id.pattern).source).toBe(VEHICLE_MESSAGE_FORMAT.messageId.source);
    expect(new RegExp(p.body_sha256.pattern).source).toBe(VEHICLE_MESSAGE_FORMAT.sha256.source);
    // nonce·시각·태그는 FFV1-REQ와 같은 형식이다(같은 차량 서명기가 만든다)
    for (const k of ['nonce', 'timestamp', 'mac'] as const) {
      expect(p.auth.properties[k].pattern, k).toBe(VEHICLE_MESSAGE_FORMAT[k].source);
      expect(VEHICLE_MESSAGE_FORMAT[k].source, k).toBe(VEHICLE_AUTH_FORMAT[k].source);
    }
    expect(VEHICLE_MESSAGE_FUTURE_MS).toBe(VEHICLE_AUTH_SKEW_MS);
    expect(VEHICLE_MESSAGE_MAX_AGE_MS).toBe(72 * 3600_000);
  });
});

describe('RelayRecord·RelayVerdict zod ↔ relay-record·relay.verdict 스키마', () => {
  const record = (name: string, seq = 1) => ({ relay_seq: seq, stream: relayStreamOf(name as any), received_at: '2026-10-13T00:01:12.345Z', message: vec(name) });

  it('벡터 메시지를 담은 중계 기록은 둘 다 통과하고, 흐름은 종류가 정한다', () => {
    for (const n of VEHICLE_MESSAGE_KINDS) expect(agree(record(n), RelayRecord, relayErrors), n).toEqual({ zod: true, json: true });
    expect(relayStreamOf('STATUS_REPORT')).toBe('SAFETY');
    expect(relayStreamOf('INBOX_ACK')).toBe('SAFETY');
    expect(relayStreamOf('VEHICLE_REPORT')).toBe('NORMAL');
    expect(schema('relay-record.schema.json').properties.stream.enum).toEqual([...RELAY_STREAMS]);
  });

  it('흐름 위반·덧붙인 필드·0번·Lake가 메시지를 고친 것은 둘 다 떨어진다', () => {
    const bad: any[] = [
      { ...record('STATUS_REPORT'), stream: 'NORMAL' },
      { ...record('VEHICLE_REPORT'), stream: 'SAFETY' },
      { ...record('STATUS_REPORT'), relay_seq: 0 },
      { ...record('STATUS_REPORT'), lake_note: 'x' },
      { ...record('STATUS_REPORT'), received_at: 'yesterday' },
      { ...record('STATUS_REPORT'), message: { ...vec('STATUS_REPORT'), vin: V.vin } },
    ];
    for (const r of bad) expect(agree(r, RelayRecord, relayErrors), JSON.stringify(r).slice(0, 80)).toEqual({ zod: false, json: false });
  });

  it('검증 결과 — 받아들임(check null)·떨어짐(층·단계·코드)이 둘 다 통과하고, enum이 같다', () => {
    const base = { message_id: vec('STATUS_REPORT').message_id, relay_seq: 7, stream: 'SAFETY', kind: 'STATUS_REPORT', relay_latency_ms: 420 };
    const ok = [
      { ...base, outcome: 'ACCEPTED', check: null },
      { ...base, outcome: 'DUPLICATE', check: null, relay_latency_ms: null },
      { ...base, outcome: 'REJECTED', check: { layer: 'MESSAGE_AUTH', step: null, code: 'REQUEST_MAC_INVALID' } },
      { ...base, outcome: 'REJECTED', check: { layer: 'STATUS_CHECK', step: 'SEQUENCE', code: 'REPLAY' } },
      { ...base, outcome: 'STALE', check: { layer: 'MESSAGE_AUTH', step: null, code: 'MESSAGE_STALE' } },
    ];
    for (const v of ok) expect(agree(v, RelayVerdict, verdictErrors), v.outcome).toEqual({ zod: true, json: true });
    const bad = [
      { ...base, outcome: 'OK', check: null },
      { ...base, outcome: 'REJECTED', check: { layer: 'LAKE', step: null, code: 'X' } },
      { ...base, outcome: 'REJECTED', check: { layer: 'STATUS_CHECK', step: 'GUARD', code: 'X' } },
      { ...base, outcome: 'REJECTED', check: { layer: 'HANDLER', step: null, code: 'lower' } },
      { ...base, outcome: 'ACCEPTED', check: null, vin: V.vin },
    ];
    for (const v of bad) expect(agree(v, RelayVerdict, verdictErrors), JSON.stringify(v).slice(0, 80)).toEqual({ zod: false, json: false });
    const p = schema('relay.verdict.schema.json').properties;
    expect(p.outcome.enum).toEqual([...RELAY_OUTCOMES]);
    expect(p.check.properties.layer.enum).toEqual([...RELAY_CHECK_LAYERS]);
    expect(p.check.properties.step.enum.filter((s: string | null) => s !== null)).toEqual(STATUS_CHECK_STEPS);
  });
});
