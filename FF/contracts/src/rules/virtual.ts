// vECU 가상검증 (IF-09 가상검증 공급자: C:\project\2026-10-11_vECU tools/ffval_cli.mjs, ffval 2.0) — 시나리오 목록과 Gate 반영 규칙.
// NOMINAL(정상 추종)은 차량 시나리오 검증(D06-03)을, FAULT_ONBOARD(오류 → 차량 내 감지 → 고장 램프 → BASE_ONLY, 보고서 v1.1 CS-01)는
// 안전 동작 검증(D06-06)을 결정한다. 판정은 모든 기준이 통과해야 하고(정보 항목으로 면제하지 않는다 — 알려진 실패로 G5 통과 금지, 12.7),
// 재현 정보가 없으면 근거가 아니다. BASELINE_REMOTE(같은 오류를 원격 DC2 차단만으로 처리)는 비교 기준선 — 기록·표시만 하고 검증기는 쓰지 않는다.
// 시간 한계(인계·램프·고장 램프·FTTI)는 Registry 안전 분류(safety_profile)가 패키지로 넘어가 vECU가 쓴다.
import { z } from 'zod';

/** FAULT_KILL은 ffval 1.x 기록 읽기용(오류+Kill 경로만 판정하던 방식) — 새 실행은 만들지 않는다 */
export const VirtualRole = z.enum(['NOMINAL', 'FAULT_ONBOARD', 'BASELINE_REMOTE', 'FAULT_KILL']);
export type VirtualRole = z.infer<typeof VirtualRole>;

export interface VirtualScenario {
  scenarioId: string;
  featureId: string;
  name: string;
  role: VirtualRole;
  /** 이 시나리오 결과가 결정하는 정책 검증기 — BASELINE은 결정하지 않는다(비교 표시) */
  validator: 'D06-03' | 'D06-06' | 'BASELINE';
  /** 무엇을 보이는 시험인가 — 화면·Evidence 설명 */
  purpose: string;
  /** vECU ffval 시나리오 (FF_IMP timeline.json sim 블록 호환 + ffval 2.0 onboard) */
  params: {
    name: string;
    duration_s: number;
    lead_kph: number;
    target_gap_m: number;
    fault: { at_s: number; ramp_s: number; bias_max: number } | null;
    /** 원격 비활성화(kill_command v2 deactivate) 시각 — 차량 Guard가 Registry DC 단계를 밟는다 */
    kill: { at_s: number } | null;
    /** 차량 내 타당성 감시(보고서 패키지 FdPlaus_Step) — 상대 %·절대 m 밖이 debounce_s 지속이면 감지 확정 */
    onboard?: { rel_pct: number; abs_m: number; debounce_s: number } | null;
    link_latency_ms: number;
    seed?: number;
  };
}

const FAULT = { at_s: 17, ramp_s: 8, bias_max: 2.4 };
export const VIRTUAL_SCENARIOS: VirtualScenario[] = [
  {
    scenarioId: 'SCN-FEAT00022-NOMINAL',
    featureId: 'FEAT-00022',
    name: '정상 추종 — 선행차 80 km/h, 목표 거리 40 m',
    role: 'NOMINAL',
    validator: 'D06-03',
    purpose: '오류 없이 기능이 목표 거리를 지키고 오판단·위험 단계가 없는지',
    params: { name: '정상 추종', duration_s: 70, lead_kph: 80, target_gap_m: 40, fault: null, kill: null, link_latency_ms: 300 },
  },
  {
    scenarioId: 'SCN-FEAT00022-FAULT-ONBOARD',
    featureId: 'FEAT-00022',
    name: '거리 추정 오류(17 s, ×2.4) → 차량 내 감지 → 고장 램프 → BASE_ONLY',
    role: 'FAULT_ONBOARD',
    validator: 'D06-06',
    purpose: '차량이 스스로 고장을 감지해 클라우드 없이 FTTI 안에 기능 효과를 거두는지 (보고서 CS-01: 감지 19.11 s, BASE_ONLY 20.61 s, FTTI 끝 22.00 s)',
    params: { name: '차량 내 감지', duration_s: 70, lead_kph: 80, target_gap_m: 40, fault: FAULT, kill: null, onboard: { rel_pct: 20, abs_m: 2.0, debounce_s: 0.2 }, link_latency_ms: 300 },
  },
  {
    scenarioId: 'SCN-FEAT00022-FAULT-REMOTE-DC2',
    featureId: 'FEAT-00022',
    name: '비교 기준선 — 같은 오류를 원격 차단(48 s, DC2 인계 4 s + 램프 3 s)만으로',
    role: 'BASELINE_REMOTE',
    validator: 'BASELINE',
    purpose: '원격 경로(수락 지연·단계 시간)는 지키지만 위험 구간이 남아 G5 근거가 될 수 없음을 보이는 비교 실행',
    params: { name: '원격 차단만 (기준선)', duration_s: 70, lead_kph: 80, target_gap_m: 40, fault: FAULT, kill: { at_s: 48 }, onboard: null, link_latency_ms: 300 },
  },
];

export const virtualScenariosFor = (featureId: string) => VIRTUAL_SCENARIOS.filter((s) => s.featureId === featureId);
/** 정책 검증기를 결정하는 시나리오만 (기준선 제외) — 회귀 시험 목록 등 */
export const decidingScenariosFor = (featureId: string) => virtualScenariosFor(featureId).filter((s) => s.validator !== 'BASELINE');

export const VirtualCriterion = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  op: z.string(),
  limit: z.number(),
  status: z.enum(['pass', 'fail', 'pending', 'na']),
  value: z.number().nullable(),
  at: z.number().nullable(),
  deciding: z.boolean().default(false),
});
export type VirtualCriterion = z.infer<typeof VirtualCriterion>;

/** 재현 정보 — 같은 도구·시나리오·판정 스크립트·시드로 다시 돌릴 수 있어야 근거다(보고서 12.4.1·FFG-ADS-009) */
export const VirtualRepro = z
  .object({
    ffvalVersion: z.string().min(1),
    scenarioHash: z.string().regex(/^[0-9a-f]{64}$/),
    scriptHash: z.string().regex(/^[0-9a-f]{64}$/),
    seed: z.number(),
  })
  .passthrough();
export type VirtualRepro = z.infer<typeof VirtualRepro>;

export interface VirtualRun {
  runId: string;
  policyId: string;
  policyRevision: number;
  contentHash: string;
  featureId: string;
  featureVersion: string;
  vin: string;
  scenarioId: string;
  role: VirtualRole;
  /** vecu = 시뮬레이터가 실제로 돌았다. unavailable = vECU 미연결 — Evidence로 인정하지 않는다 */
  source: 'vecu' | 'unavailable';
  simulator: string | null;
  testId: string | null;
  /** 시뮬레이터 종합 판정 (모든 기준) */
  overall: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  /** Gate 반영 판정 — 모든 기준 + 재현 정보 */
  gateResult: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  /** gateResult가 PASS가 아닌 이유(기준 실패·끝나지 않은 기준·재현 정보 없음) */
  gateReasons?: string[];
  criteria: VirtualCriterion[];
  evaluation: { value: boolean; decision: string; reason: string } | null;
  evidence: { dir: string; files: { name: string; sha256: string; bytes: number }[] } | null;
  repro?: VirtualRepro | null;
  /** 판정에 쓴 Registry 안전 분류 시간값 */
  safety?: { deactClass: string; takeoverMs: number; rampMs: number; faultRampMs: number; faultTolerantTimeMs: number } | null;
  error: string | null;
  at: string;
  by: string;
  tms: { tmsId: string; submittedAt: string; by: string } | null;
}

export const RunVirtualBody = z
  .object({
    policyId: z.string().regex(/^POL-\d{5}$/),
    /** 비우면 Feature의 모든 시나리오 */
    scenarioIds: z.array(z.string()).max(20).optional(),
    vin: z.string().default('ego-01'),
  })
  .strict();
export type RunVirtualBody = z.infer<typeof RunVirtualBody>;

/**
 * Gate 반영 판정 — 모든 기준이 통과(해당 없음 제외)해야 하고, 끝나지 않은 기준·재현 정보 없음은 PASS가 아니다(fail-closed).
 * @rule FFG-TST-009 — 알려진 실패(정보 항목 면제)로 G5 통과 금지, 재현 정보 없는 시험은 근거 아님(LCY-006 차량 내 감지 근거는 차량·조직 몫). 독립 검토·서명은 Gate 결정 기록(WP2)
 */
export function judgeVirtual(criteria: Omit<VirtualCriterion, 'deciding'>[], repro: unknown): { gateResult: 'PASS' | 'FAIL'; criteria: VirtualCriterion[]; reasons: string[] } {
  const marked = criteria.map((c) => ({ ...c, deciding: c.status !== 'na' }));
  const reasons: string[] = [];
  const bad = marked.filter((c) => c.status === 'fail' || c.status === 'pending');
  if (bad.length) reasons.push(...bad.map((c) => `${c.label} ${c.status === 'pending' ? '끝나지 않음' : `${c.value ?? '?'}${c.unit} (기준 ${OP[c.op] ?? c.op} ${c.limit})`}`));
  if (!marked.some((c) => c.deciding)) reasons.push('판정할 기준이 없습니다');
  if (!VirtualRepro.safeParse(repro).success) reasons.push('재현 정보(도구 Version·시나리오 해시·판정 스크립트 해시·시드)가 없습니다');
  return { gateResult: reasons.length ? 'FAIL' : 'PASS', criteria: marked, reasons };
}

const OP: Record<string, string> = { '<=': '≤', '>=': '≥' };

/** 정책 검증기가 쓰는 입력 — 이 정책 내용(contentHash)으로 돌린 최신 실행 */
export interface VirtualEvidence {
  scenario: VirtualScenario;
  run: (Pick<VirtualRun, 'runId' | 'source' | 'testId' | 'gateResult' | 'overall' | 'criteria' | 'contentHash'> & Partial<Pick<VirtualRun, 'gateReasons'>>) | null;
}
