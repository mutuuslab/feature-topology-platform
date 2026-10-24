// 메시지 v2 와이어 스키마 — JSON Schema(보고서 부록 D)와 구조 자동 대조 + 패키지 예제 (FFG-PLT-001 · TC-FF-50).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadGuide } from '../testing/fixtures';
import { KillCommandV2, StatusReportV2, wireErrors } from './wire';

const killSchema = loadGuide('schema/kill_command.v2.schema.json');
const statusSchema = loadGuide('schema/status_report.v2.schema.json');
const ex = (name: string) => loadGuide(`schema/examples/${name}`);

/** zod 래퍼(optional·nullable·pipe)를 벗긴다 — zod 4는 refine이 감싸지 않고 같은 스키마의 검사로 붙는다 */
function unwrap(t: z.ZodType): z.ZodType {
  if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) return unwrap(t.unwrap() as z.ZodType);
  if (t instanceof z.ZodPipe) return unwrap(t.in as z.ZodType);
  return t;
}
const isOptional = (t: z.ZodType): boolean => t.safeParse(undefined).success;

/** JSON Schema 노드와 zod 노드의 필드·필수·enum·const를 재귀 비교 — 차이를 "경로: 내용"으로 */
function diff(js: any, zt: z.ZodType, path = ''): string[] {
  const out: string[] = [];
  const t = unwrap(zt);
  if (js.properties) {
    if (!(t instanceof z.ZodObject)) return [`${path}: object가 아님`];
    const shape = t.shape as Record<string, z.ZodType>;
    const req = new Set<string>(js.required ?? []);
    for (const k of Object.keys(js.properties)) {
      if (!shape[k]) out.push(`${path}/${k}: zod에 없음`);
      else {
        if (req.has(k) === isOptional(shape[k])) out.push(`${path}/${k}: 필수 여부 다름(JSON ${req.has(k) ? '필수' : '선택'})`);
        out.push(...diff(js.properties[k], shape[k], `${path}/${k}`));
      }
    }
    for (const k of Object.keys(shape)) if (!js.properties[k]) out.push(`${path}/${k}: JSON Schema에 없음`);
    if (js.additionalProperties === false && !(t._zod.def.catchall instanceof z.ZodNever)) out.push(`${path}: strict 아님(additionalProperties false)`);
  }
  if (js.enum) {
    const zEnum = t instanceof z.ZodEnum ? [...t.options] : null;
    if (JSON.stringify(zEnum) !== JSON.stringify(js.enum)) out.push(`${path}: enum 다름`);
  }
  if (js.const !== undefined && !(t instanceof z.ZodLiteral && t.value === js.const)) out.push(`${path}: const 다름`);
  if (js.items && t instanceof z.ZodArray) out.push(...diff(js.items, t.element as z.ZodType, `${path}[]`));
  return out;
}

describe('JSON Schema 대조 (FFG-PLT-001)', () => {
  it('kill_command v2 — 모든 필드·필수·enum·const·strict가 같다', () => {
    expect(diff(killSchema, KillCommandV2)).toEqual([]);
  });
  it('status_report v2 — 모든 필드·필수·enum·const·strict가 같다', () => {
    expect(diff(statusSchema, StatusReportV2)).toEqual([]);
  });
  it('대조기 자체 검증 — 스키마가 바뀌면 차이를 잡는다', () => {
    const changed = structuredClone(killSchema);
    changed.properties.reason.properties.category.enum.push('MARKETING');
    changed.required = changed.required.filter((k: string) => k !== 'evidence');
    changed.properties.scope.properties.extra = { type: 'string' };
    expect(diff(changed, KillCommandV2)).toEqual(['/reason/category: enum 다름', '/scope/extra: zod에 없음', '/evidence: 필수 여부 다름(JSON 선택)']);
  });
});

describe('패키지 예제 (TC-FF-50)', () => {
  it('정상 명령·게이트 실패 예제는 스키마를 통과한다(게이트에서 걸린다)', () => {
    for (const n of [
      'kill_safety_dc2_eu.ok.json',
      'kill_dc4_aeb.gate_fail.json',
      'kill_same_approver.gate_fail.json',
      'kill_operator_chose_dc0.gate_fail.json',
      'expiry_without_notice.gate_fail.json',
      'activate_cn_missing_filing.gate_fail.json',
    ])
      expect(wireErrors(KillCommandV2, ex(n)), n).toEqual([]);
  });
  it('v1 Kill(safe_mode)은 스키마에서 거부 — 운영자가 고르는 안전 모드는 없다', () => {
    expect(wireErrors(KillCommandV2, ex('legacy_v1_kill_safe_stop.schema_fail.json')).join('\n')).toContain('safe_mode');
  });
  it('상태 보고 — 정상은 통과, state_auth 없으면 거부, v1(SAFE_DEFAULT)은 거부', () => {
    const ok = ex('status_disabled.ok.json');
    expect(wireErrors(StatusReportV2, ok)).toEqual([]);
    const { state_auth: _drop, ...unsigned } = ok;
    expect(wireErrors(StatusReportV2, unsigned).join('\n')).toContain('state_auth');
    expect(wireErrors(StatusReportV2, ex('legacy_v1_status.schema_fail.json')).join('\n')).toContain('state');
  });
  it('차량 봉투는 1대만, 서명은 원시 64바이트(DER 형식 거부)', () => {
    const cmd = ex('kill_safety_dc2_eu.ok.json');
    cmd.vehicle_auth = { key_epoch: 0, vehicle_seq: 7, approver_refs: [101, 202], cmd_auth: 'AAAAAAAAAAAAAAAAAAAAAA' };
    expect(wireErrors(KillCommandV2, cmd).join('\n')).toContain('scope/vehicle_ids');
    cmd.scope.vehicle_ids = ['VHC-000123'];
    cmd.scope.max_vehicles = 1;
    expect(wireErrors(KillCommandV2, cmd)).toEqual([]);
    cmd.signature.value = 'MEUCIQDexampleSignatureValueOnly';
    expect(wireErrors(KillCommandV2, cmd)).not.toEqual([]);
  });
});
