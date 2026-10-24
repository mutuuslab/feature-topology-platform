// IF-15 Data Lake 이벤트 계약 — docs/80-integration/datalake-if15/*.schema.json(JSON Schema 2020-12)이 FF가 실제로 내는 모양과 맞는지 (설계 80-75).
// 1) 예제 줄과 보고서 부록 D 상태 보고 예시가 봉투 스키마를 통과한다(종류별 payload·$ref까지) 2) 틀린 줄은 떨어진다
// 3) 스키마의 enum이 FF zod 스키마와 같다(어긋나면 실패 — 계약 표류 방지) 4) 원천으로 적은 FF 이벤트 이름이 백엔드에 실제로 있다.
// 의존성을 늘리지 않으려고 이 계약이 쓰는 키워드만 아는 작은 검사기를 둔다 — 모르는 키워드가 나오면 시험이 실패한다(조용히 건너뛰지 않음).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnomalyKind, AnomalySchema, AnomalySeverity, AnomalyStatus } from '../rules/anomaly';
import { IncidentCategory, IncidentSeverity, IncidentSource } from '../rules/ext';
import { SECURITY_EVENTS } from '../rules/security-events';
import { FaultSeverity } from '../rules/vehicle-requests';
import { loadGuide } from '../testing/fixtures';
import { ReadbackBody } from './ops';
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

/** $id → 스키마. Lake 스키마 전부 + 부록 D 상태 보고(vehicle.status가 $id로 참조) */
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

const envelope = lake('envelope.schema.json');
const errors = (line: unknown) => {
  const out: string[] = [];
  check(envelope, line, envelope.$id, '', out);
  return out;
};
const examples: any[] = lake('examples.json');
const byType = (t: string) => structuredClone(examples.find((e) => e.type === t));

describe('IF-15 Lake 이벤트 계약 (80-75)', () => {
  it('예제 줄이 모두 봉투·종류별 스키마를 통과하고, 8종류를 모두 덮는다', () => {
    for (const e of examples) expect(errors(e), `${e.type} ${e.event_id}`).toEqual([]);
    expect(new Set(examples.map((e) => e.type))).toEqual(new Set(envelope.properties.type.enum));
  });

  it('보고서 부록 D 상태 보고 예시(실제 FF 입력)를 그대로 실은 vehicle.status가 통과한다', () => {
    const report = loadGuide('schema/examples/status_disabled.ok.json');
    expect(StatusReportV2.safeParse(report).success).toBe(true);
    const line = byType('vehicle.status');
    line.payload.report = report;
    line.vehicle.pseudonym = report.vehicle_pseudonym;
    expect(errors(line)).toEqual([]);
  });

  it('받은 보고의 원문은 부록 D 스키마로 검사된다 — v1 보고·필드 누락은 떨어진다', () => {
    const line = byType('vehicle.status');
    line.payload.report = loadGuide('schema/examples/legacy_v1_status.schema_fail.json');
    expect(errors(line).length).toBeGreaterThan(0);
    const missing = byType('vehicle.status');
    delete missing.payload.report.state_auth;
    expect(errors(missing).join()).toContain('state_auth');
  });

  it('개인정보·형식 규칙 — VIN 필드, 거부 보고 원문, 범주 위반, 모르는 종류는 떨어진다', () => {
    const vin = byType('delivery.result');
    vin.payload.vin = 'KMHXX00XXXX000000';
    expect(errors(vin).join()).toContain('/payload/vin');
    const vehicleVin = byType('vehicle.fault');
    vehicleVin.vehicle.vin = 'KMHXX00XXXX000000';
    expect(errors(vehicleVin).join()).toContain('/vehicle/vin');
    const rejected = examples.find((e) => e.type === 'vehicle.status' && !e.payload.accepted);
    const leak = structuredClone(rejected);
    leak.payload.report = { type: 'status_report' };
    expect(errors(leak).join()).toContain('/payload/report');
    const cat = byType('security.alert');
    cat.data_category = 'SAFETY_OPERATION';
    expect(errors(cat).join()).toContain('/data_category');
    const unknown = byType('ff.change');
    unknown.type = 'vehicle.location';
    expect(errors(unknown).join()).toContain('/type');
    const noVehicle = byType('delivery.result');
    noVehicle.vehicle = null;
    expect(errors(noVehicle).join()).toContain('/vehicle');
  });

  it('스키마 enum·형식이 FF zod와 같다', () => {
    const payload = (name: string) => lake(`${name}.schema.json`).properties;
    expect(envelope.properties.data_category.enum).toEqual([...DATA_CATEGORIES]);
    // 차량 가명 — 상태 보고 v2의 vehicle_pseudonym과 같은 값만 받는다
    const pseudo = new RegExp(envelope.properties.vehicle.properties.pseudonym.pattern);
    for (const s of ['9f2c4a7d1e0b5c36', 'a'.repeat(64), '9F2C4A7D1E0B5C36', 'abc', 'a'.repeat(65), 'KMHXX00XXXX000000'])
      expect(pseudo.test(s), s).toBe(StatusReportV2.shape.vehicle_pseudonym.safeParse(s).success);
    const a = payload('anomaly');
    expect(a.kind.enum).toEqual(AnomalyKind.options);
    expect(a.severity.enum).toEqual(AnomalySeverity.options);
    expect(a.status.enum).toEqual(AnomalyStatus.options);
    expect(a.advice.enum).toEqual(AnomalySchema.shape.advice.options);
    const i = payload('incident');
    expect(i.source.enum).toEqual(IncidentSource.options);
    expect(i.category.enum).toEqual(IncidentCategory.options);
    expect(i.severity.enum).toEqual(IncidentSeverity.options);
    expect(payload('vehicle.fault').severity.enum).toEqual(FaultSeverity.options);
    expect(payload('delivery.result').metric_type.enum).toEqual(ReadbackBody.shape.metricType.options);
    expect(payload('security.alert').alert_id.enum).toEqual(SECURITY_EVENTS.map((e) => e.id));
    // 회신 필드 — ReadbackBody에서 vin·bootId만 뺐다(나머지는 이름만 snake_case)
    const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const kept = Object.keys(ReadbackBody.shape).filter((k) => k !== 'vin' && k !== 'bootId').map(snake);
    expect(Object.keys(payload('delivery.result')).filter((k) => k !== 'via').sort()).toEqual(kept.sort());
  });

  it('원천으로 적은 FF 이벤트가 백엔드에 실제로 있다', () => {
    const SOURCES: Record<string, string[]> = {
      'vehicle.status': ['vehicle.status.accepted', 'vehicle.status.rejected'],
      'delivery.result': ['vehicle.readback'],
      'vehicle.fault': ['vehicle.fault.reported'],
      anomaly: ['anomaly.opened', 'anomaly.escalated', 'anomaly.acknowledged', 'anomaly.mitigated', 'anomaly.dismissed'],
      incident: ['incident.received', 'incident.sotif.triggered'],
      'security.alert': ['vsoc.alert'],
      entitlement: ['entitlement.offered', 'entitlement.accepted', 'entitlement.declined', 'entitlement.converted', 'trial.expired'],
      'ff.change': lake('ff.change.schema.json').properties.source_event.enum,
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
    const missing = Object.values(SOURCES).flat().filter((n) => !names.has(n));
    expect(missing).toEqual([]);
  });

  it('OpenAPI 초안 — 3.1이고 참조한 스키마 파일이 있다', () => {
    const api = read(join(ROOT, 'docs', '80-integration', 'datalake-if15.openapi.json'));
    expect(api.openapi).toBe('3.1.0');
    const refs = JSON.stringify(api).match(/"\$ref":"(datalake-if15\/[^"#]+)"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      const file = r.replace(/^"\$ref":"/, '').replace(/"$/, '');
      expect(() => statSync(join(ROOT, 'docs', '80-integration', file))).not.toThrow();
    }
    expect(Object.keys(api.paths)).toEqual(
      expect.arrayContaining(['/v1/ingest/batches', '/v1/ingest/cursor', '/v1/health/live', '/v1/health/ready', '/v1/freshness', '/v1/metrics/delivery', '/v1/metrics/anomalies', '/v1/metrics/feature-health']),
    );
  });
});
