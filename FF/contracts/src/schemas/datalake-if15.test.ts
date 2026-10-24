// IF-15 Data Lake 계약 — docs/80-integration/datalake-if15/*.schema.json(JSON Schema 2020-12)이 FF·차량이 실제로 내는 모양과 맞는지 (설계 80-75, "차량 → Lake → FF").
// 1) FF → Lake 예제 줄이 봉투 스키마를 통과한다 2) 차량 서명 메시지 예제의 원문 바이트·해시가 맞고, 풀어 낸 본문이 FF가 지금 받는 형식(부록 D 상태 보고·VehicleDeliveryAck·VehicleReportBody)이다
// 3) 틀린 줄(VIN 필드·흐름 위반·범주 위반 등)은 떨어진다 4) 스키마 enum·형식이 FF zod·규칙과 같다(계약 표류 방지) 5) 원천으로 적은 FF 이벤트 이름이 백엔드에 실제로 있다.
// 의존성을 늘리지 않으려고 이 계약이 쓰는 키워드만 아는 작은 검사기를 둔다 — 모르는 키워드가 나오면 시험이 실패한다(조용히 건너뛰지 않음).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnomalyKind, AnomalySchema, AnomalySeverity, AnomalyStatus } from '../rules/anomaly';
import { IncidentCategory, IncidentSeverity, IncidentSource } from '../rules/ext';
import { SECURITY_EVENTS } from '../rules/security-events';
import { STATUS_CHECK_STEPS } from '../rules/status-v2';
import { VEHICLE_AUTH_FORMAT, VehicleDeliveryAck } from '../rules/vehicle-auth';
import { VehicleReportBody } from '../rules/vehicle-requests';
import { loadGuide } from '../testing/fixtures';
import { TIME_SYNC } from './safety';
import { DATA_CATEGORIES, StatusReportV2 } from './wire';

const ROOT = join(__dirname, '..', '..', '..', '..');
const DIR = join(ROOT, 'docs', '80-integration', 'datalake-if15');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const lake = (name: string) => read(join(DIR, name));

type Schema = Record<string, any> | boolean;
const KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$comment', 'title', 'description', 'examples', 'default',
  'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'format', 'minimum', 'maximum',
  'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems', 'allOf', 'if', 'then', 'else',
]);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** $id → 스키마. Lake 스키마 전부 + 부록 D 상태 보고 */
const registry = new Map<string, Schema>();
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.schema.json'))) {
  const s = lake(f);
  registry.set(s.$id, s);
}
const guideStatus = loadGuide('schema/status_report.v2.schema.json');
registry.set(guideStatus.$id, guideStatus);

const isType = (t: string, v: unknown) =>
  t === 'null' ? v === null
  : t === 'array' ? Array.isArray(v)
  : t === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v)
  : t === 'integer' ? Number.isInteger(v)
  : typeof v === t;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function resolve(ref: string, base: string): { schema: Schema; base: string } {
  const url = new URL(ref, base);
  const frag = url.hash;
  url.hash = '';
  const doc = registry.get(url.href);
  if (doc === undefined) throw new Error(`$ref를 찾을 수 없음: ${ref} (기준 ${base})`);
  let node: any = doc;
  for (const part of frag.replace(/^#\/?/, '').split('/').filter(Boolean)) node = node[decodeURIComponent(part)];
  if (node === undefined) throw new Error(`$ref 조각 없음: ${ref}`);
  return { schema: node, base: url.href };
}

function check(s: Schema, v: unknown, base: string, path: string, out: string[]) {
  if (s === true) return;
  if (s === false) return void out.push(`${path}: 허용 안 됨`);
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) throw new Error(`검사기가 모르는 키워드 ${k} (${path})`);
  if (s.$id) base = s.$id;
  if (s.$ref) {
    const r = resolve(s.$ref, base);
    check(r.schema, v, r.base, path, out);
  }
  if (s.type !== undefined) {
    const types: string[] = [].concat(s.type);
    if (!types.some((t) => isType(t, v))) return void out.push(`${path}: 형 ${types.join('|')} 아님`);
  }
  if ('const' in s && !same(s.const, v)) out.push(`${path}: ${JSON.stringify(s.const)} 아님`);
  if (s.enum && !s.enum.some((e: unknown) => same(e, v))) out.push(`${path}: enum 밖 ${JSON.stringify(v)}`);
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) out.push(`${path}: 형식 ${s.pattern} 아님`);
    if (s.minLength !== undefined && [...v].length < s.minLength) out.push(`${path}: 너무 짧음`);
    if (s.maxLength !== undefined && [...v].length > s.maxLength) out.push(`${path}: 너무 김`);
    if (s.format === 'date-time' && !(RFC3339.test(v) && !Number.isNaN(Date.parse(v)))) out.push(`${path}: 시각 형식 아님`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: ${s.minimum} 미만`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${path}: ${s.maximum} 초과`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: 항목 부족`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: 항목 초과`);
    if (s.items !== undefined) v.forEach((x, i) => check(s.items, x, base, `${path}/${i}`, out));
  }
  if (isType('object', v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) out.push(`${path}/${k}: 필수`);
    for (const [k, sub] of Object.entries<Schema>(s.properties ?? {})) if (k in o) check(sub, o[k], base, `${path}/${k}`, out);
    if (s.additionalProperties === false) for (const k of Object.keys(o)) if (!(k in (s.properties ?? {}))) out.push(`${path}/${k}: 정의에 없는 필드`);
  }
  for (const sub of s.allOf ?? []) check(sub, v, base, path, out);
  if (s.if !== undefined) {
    const probe: string[] = [];
    check(s.if, v, base, path, probe);
    if (!probe.length) s.then !== undefined && check(s.then, v, base, path, out);
    else if (s.else !== undefined) check(s.else, v, base, path, out);
  }
}

/** 스키마 파일 하나로 값 하나를 검사 — 오류 목록(통과면 빈 배열) */
const errorsBy = (file: string) => {
  const s = lake(file);
  return (v: unknown) => {
    const out: string[] = [];
    check(s, v, s.$id, '', out);
    return out;
  };
};
const errors = errorsBy('envelope.schema.json');
const messageErrors = errorsBy('vehicle-message.schema.json');
const relayErrors = errorsBy('relay-record.schema.json');
const telemetryErrors = errorsBy('vehicle-telemetry.schema.json');
const statusErrors = (v: unknown) => {
  const out: string[] = [];
  check(guideStatus, v, guideStatus.$id, '', out);
  return out;
};

const envelope = lake('envelope.schema.json');
const examples: any[] = lake('examples.json');
const vehicleExamples: { messages: any[]; relay: any[]; telemetry: any[] } = lake('examples.vehicle.json');
const byType = (t: string) => structuredClone(examples.find((e) => e.type === t));
const byKind = (k: string) => structuredClone(vehicleExamples.messages.find((m) => m.kind === k));
const body = (m: any) => Buffer.from(m.body_b64, 'base64');
/** 원문 바이트를 실은 차량 메시지 — 해시까지 맞춘다 */
const pack = (m: any, bytes: Buffer) => ({ ...m, body_b64: bytes.toString('base64'), body_sha256: createHash('sha256').update(bytes).digest('hex') });

describe('IF-15 FF → Lake 라벨 (80-75 5장)', () => {
  it('예제 줄이 모두 봉투·종류별 스키마를 통과하고 6종류를 모두 덮는다', () => {
    for (const e of examples) expect(errors(e), `${e.type} ${e.event_id}`).toEqual([]);
    expect(new Set(examples.map((e) => e.type))).toEqual(new Set(envelope.properties.type.enum));
  });

  it('차량이 만든 자료는 FF 라벨로 받지 않는다 — VIN 필드·범주 위반·옛 종류는 떨어진다', () => {
    const vin = byType('relay.verdict');
    vin.payload.vin = 'KMHXX00XXXX000000';
    expect(errors(vin).join()).toContain('/payload/vin');
    const vehicleVin = byType('entitlement');
    vehicleVin.vehicle.vin = 'KMHXX00XXXX000000';
    expect(errors(vehicleVin).join()).toContain('/vehicle/vin');
    const cat = byType('security.alert');
    cat.data_category = 'SAFETY_OPERATION';
    expect(errors(cat).join()).toContain('/data_category');
    for (const old of ['vehicle.status', 'delivery.result', 'vehicle.fault']) {
      const line = byType('ff.change');
      line.type = old;
      expect(errors(line).join(), old).toContain('/type');
    }
    const verdict = byType('relay.verdict');
    verdict.vehicle = null;
    expect(errors(verdict).join()).toContain('/vehicle');
  });
});

describe('IF-15 차량 → Lake → FF 서명 메시지 (80-75 3·4장)', () => {
  it('메시지·중계 기록·텔레메트리 예제가 스키마를 통과하고 종류를 모두 덮는다', () => {
    for (const m of vehicleExamples.messages) expect(messageErrors(m), m.message_id).toEqual([]);
    for (const r of vehicleExamples.relay) expect(relayErrors(r), String(r.relay_seq)).toEqual([]);
    for (const t of vehicleExamples.telemetry) expect(telemetryErrors(t), `${t.signal_schema.id}`).toEqual([]);
    expect(new Set(vehicleExamples.messages.map((m) => m.kind))).toEqual(new Set(lake('vehicle-message.schema.json').properties.kind.enum));
  });

  it('원문 바이트가 그대로 실린다 — 해시가 맞고, 멱등 키는 가명:nonce', () => {
    for (const m of vehicleExamples.messages) {
      expect(createHash('sha256').update(body(m)).digest('hex'), m.message_id).toBe(m.body_sha256);
      expect(m.message_id).toBe(`${m.pseudonym}:${m.auth.nonce}`);
    }
  });

  it('풀어 낸 본문은 FF가 지금 받는 형식이다 — 상태 보고 v2(부록 D)·전달 확인·차량 보고', () => {
    const status = JSON.parse(body(byKind('STATUS_REPORT')).toString('utf8'));
    expect(statusErrors(status)).toEqual([]);
    expect(StatusReportV2.safeParse(status).success).toBe(true);
    expect(status.vehicle_pseudonym).toBe(byKind('STATUS_REPORT').pseudonym);
    expect(VehicleDeliveryAck.safeParse(JSON.parse(body(byKind('INBOX_ACK')).toString('utf8'))).success).toBe(true);
    expect(VehicleReportBody.safeParse(JSON.parse(body(byKind('VEHICLE_REPORT')).toString('utf8'))).success).toBe(true);
  });

  it('보고서 부록 D 상태 보고 예시를 그대로 실을 수 있고, v1 보고는 본문 검사에서 떨어진다', () => {
    const report = loadGuide('schema/examples/status_disabled.ok.json');
    const m = pack(byKind('STATUS_REPORT'), Buffer.from(JSON.stringify(report)));
    expect(messageErrors(m)).toEqual([]);
    expect(statusErrors(JSON.parse(body(m).toString('utf8')))).toEqual([]);
    expect(statusErrors(loadGuide('schema/examples/legacy_v1_status.schema_fail.json')).length).toBeGreaterThan(0);
  });

  it('형식 규칙 — VIN 필드, 전달 확인의 ref 누락, 다른 종류의 ref, 흐름 위반, 서명 길이 오류는 떨어진다', () => {
    const vin = byKind('STATUS_REPORT');
    vin.vin = 'KMHXX00XXXX000000';
    expect(messageErrors(vin).join()).toContain('/vin');
    const noRef = byKind('INBOX_ACK');
    noRef.ref = null;
    expect(messageErrors(noRef).join()).toContain('/ref');
    const extraRef = byKind('STATUS_REPORT');
    extraRef.ref = 'DLV-1';
    expect(messageErrors(extraRef).join()).toContain('/ref');
    const wrongStream = structuredClone(vehicleExamples.relay.find((r) => r.message.kind === 'STATUS_REPORT'));
    wrongStream.stream = 'NORMAL';
    expect(relayErrors(wrongStream).join()).toContain('/message/kind');
    const mac = byKind('INBOX_ACK');
    mac.auth.mac = 'short';
    expect(messageErrors(mac).join()).toContain('/auth/mac');
    const scheme = byKind('INBOX_ACK');
    scheme.auth.scheme = 'FFV1-REQ';
    expect(messageErrors(scheme).join()).toContain('/auth/scheme');
  });
});

describe('IF-15 계약 표류 방지', () => {
  it('스키마 enum·형식이 FF zod·규칙과 같다', () => {
    const payload = (name: string) => lake(`${name}.schema.json`).properties;
    expect(envelope.properties.data_category.enum).toEqual([...DATA_CATEGORIES]);
    expect(payload('vehicle-telemetry').data_category.enum).toEqual([...DATA_CATEGORIES]);
    expect(payload('vehicle-telemetry').time_sync.enum).toEqual([...TIME_SYNC]);
    // 차량 가명 — 상태 보고 v2의 vehicle_pseudonym과 같은 값만 받는다(봉투·메시지·텔레메트리 모두)
    for (const pattern of [envelope.properties.vehicle.properties.pseudonym.pattern, payload('vehicle-message').pseudonym.pattern, payload('vehicle-telemetry').pseudonym.pattern]) {
      const pseudo = new RegExp(pattern);
      for (const s of ['9f2c4a7d1e0b5c36', 'a'.repeat(64), '9F2C4A7D1E0B5C36', 'abc', 'a'.repeat(65), 'KMHXX00XXXX000000'])
        expect(pseudo.test(s), s).toBe(StatusReportV2.shape.vehicle_pseudonym.safeParse(s).success);
    }
    // 서명 머리글 형식 — 80-40 요청 인증과 같은 nonce·mac
    const auth = payload('vehicle-message').auth.properties;
    expect(auth.nonce.pattern).toBe(VEHICLE_AUTH_FORMAT.nonce.source);
    expect(auth.mac.pattern).toBe(VEHICLE_AUTH_FORMAT.mac.source);
    expect(auth.timestamp.pattern).toBe(VEHICLE_AUTH_FORMAT.timestamp.source);
    expect(payload('relay.verdict').check.properties.step.enum.filter((s: string | null) => s !== null)).toEqual(STATUS_CHECK_STEPS);
    const a = payload('anomaly');
    expect(a.kind.enum).toEqual(AnomalyKind.options);
    expect(a.severity.enum).toEqual(AnomalySeverity.options);
    expect(a.status.enum).toEqual(AnomalyStatus.options);
    expect(a.advice.enum).toEqual(AnomalySchema.shape.advice.options);
    const i = payload('incident');
    expect(i.source.enum).toEqual(IncidentSource.options);
    expect(i.category.enum).toEqual(IncidentCategory.options);
    expect(i.severity.enum).toEqual(IncidentSeverity.options);
    expect(payload('security.alert').alert_id.enum).toEqual(SECURITY_EVENTS.map((e) => e.id));
  });

  it('FF 라벨의 원천 이벤트가 백엔드에 실제로 있다', () => {
    const SOURCES: Record<string, string[]> = {
      'ff.change': lake('ff.change.schema.json').properties.source_event.enum,
      // relay.verdict는 FF가 새로 낼 이벤트(중계 소비자, TL-M04) — 지금 백엔드에는 없다
      'relay.verdict': [],
      anomaly: ['anomaly.opened', 'anomaly.escalated', 'anomaly.acknowledged', 'anomaly.mitigated', 'anomaly.dismissed'],
      incident: ['incident.received', 'incident.sotif.triggered'],
      'security.alert': ['vsoc.alert'],
      entitlement: ['entitlement.offered', 'entitlement.accepted', 'entitlement.declined', 'entitlement.converted', 'trial.expired'],
    };
    expect(Object.keys(SOURCES).sort()).toEqual([...envelope.properties.type.enum].sort());
    const names = new Set<string>();
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/'([a-z]+(?:\.[a-z_]+)+)'/g)) names.add(m[1]);
      }
    };
    walk(join(ROOT, 'FF', 'backend', 'src'));
    expect(Object.values(SOURCES).flat().filter((n) => !names.has(n))).toEqual([]);
  });

  it('OpenAPI 초안 — 3.1, 네 갈래 경로가 있고 참조한 스키마 파일이 있다', () => {
    const api = read(join(ROOT, 'docs', '80-integration', 'datalake-if15.openapi.json'));
    expect(api.openapi).toBe('3.1.0');
    const refs = JSON.stringify(api).match(/"\$ref":"(datalake-if15\/[^"#]+)"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      const file = r.replace(/^"\$ref":"/, '').replace(/"$/, '');
      expect(() => statSync(join(ROOT, 'docs', '80-integration', file)), file).not.toThrow();
    }
    expect(Object.keys(api.paths)).toEqual(
      expect.arrayContaining([
        '/v1/vehicle/messages', '/v1/vehicle/telemetry', // 차량 → Lake
        '/v1/relay/{stream}', '/v1/relay/status', // Lake → FF 안전 메시지
        '/v1/ff/events', '/v1/ff/cursor', // FF → Lake 라벨
        '/v1/freshness', '/v1/metrics/delivery', '/v1/metrics/anomalies', '/v1/metrics/feature-health', // Lake → FF 집계
        '/v1/health/live', '/v1/health/ready',
      ]),
    );
    expect(api.paths['/v1/vehicle/messages'].post.security).toEqual([{ vehicleMtls: [] }]);
    expect(api.paths['/v1/relay/{stream}'].get.security).toEqual([{ bearer: ['lake.relay'] }]);
  });
});
