// vECU 가상검증 (IF-09 가상검증 공급자: C:\project\2026-10-11_vECU tools/ffval_cli.mjs) — 시나리오 목록과 Gate 반영 규칙.
// NOMINAL(정상 추종)은 차량 시나리오 검증(D06-03)을, FAULT_KILL(오류 주입 후 긴급 차단)은 안전 동작 검증(D06-06)을 결정한다.
// FAULT_KILL은 Kill 경로(지연·복귀·감속)와 최소 TTC만 판정 기준이고(vECU Gate 시험 계획과 같다), 오류 주입 구간의 위험·오판단은 의도된 결과라 알림(INFO)으로 남긴다.
import { z } from 'zod';

export const VirtualRole = z.enum(['NOMINAL', 'FAULT_KILL']);
export type VirtualRole = z.infer<typeof VirtualRole>;

export interface VirtualScenario {
  scenarioId: string;
  featureId: string;
  name: string;
  role: VirtualRole;
  /** 이 시나리오 결과가 결정하는 정책 검증기 */
  validator: 'D06-03' | 'D06-06';
  /** 판정에 쓰는 기준 ID — 'ALL'이면 모든 기준 */
  deciding: 'ALL' | string[];
  /** vECU ffval 시나리오 (FF_IMP timeline.json sim 블록 호환) */
  params: { name: string; duration_s: number; lead_kph: number; target_gap_m: number; fault: { at_s: number; ramp_s: number; bias_max: number } | null; kill: { at_s: number; safe_mode: 'SAFE_DEFAULT' | 'SAFE_STOP' } | null; link_latency_ms: number };
}

export const VIRTUAL_SCENARIOS: VirtualScenario[] = [
  {
    scenarioId: 'SCN-FEAT00022-NOMINAL',
    featureId: 'FEAT-00022',
    name: '정상 추종 — 선행차 80 km/h, 목표 거리 40 m',
    role: 'NOMINAL',
    validator: 'D06-03',
    deciding: 'ALL',
    params: { name: '정상 추종', duration_s: 70, lead_kph: 80, target_gap_m: 40, fault: null, kill: null, link_latency_ms: 300 },
  },
  {
    scenarioId: 'SCN-FEAT00022-FAULT-KILL',
    featureId: 'FEAT-00022',
    name: '거리 추정 오류(17 s, ×2.4) → 긴급 차단(48 s) → Safe Default',
    role: 'FAULT_KILL',
    validator: 'D06-06',
    deciding: ['kill_latency', 'recovery', 'max_decel', 'min_ttc'],
    params: { name: 'FF_IMP PoC1 — 오류 후 긴급 차단', duration_s: 70, lead_kph: 80, target_gap_m: 40, fault: { at_s: 17, ramp_s: 8, bias_max: 2.4 }, kill: { at_s: 48, safe_mode: 'SAFE_DEFAULT' }, link_latency_ms: 300 },
  },
];

export const virtualScenariosFor = (featureId: string) => VIRTUAL_SCENARIOS.filter((s) => s.featureId === featureId);

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
  /** Gate 반영 판정 (시나리오의 판정 기준만) */
  gateResult: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  criteria: VirtualCriterion[];
  evaluation: { value: boolean; decision: string; reason: string } | null;
  evidence: { dir: string; files: { name: string; sha256: string; bytes: number }[] } | null;
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

/** 시나리오의 판정 기준만으로 Gate 반영 결과를 낸다. 기준이 끝나지 않았으면(pending) PASS가 아니다. */
export function judgeVirtual(criteria: Omit<VirtualCriterion, 'deciding'>[], scenario: Pick<VirtualScenario, 'deciding'>): { gateResult: 'PASS' | 'FAIL'; criteria: VirtualCriterion[] } {
  const marked = criteria.map((c) => ({ ...c, deciding: scenario.deciding === 'ALL' || scenario.deciding.includes(c.id) }));
  const decisive = marked.filter((c) => c.deciding);
  const fail = decisive.some((c) => c.status === 'fail' || c.status === 'pending') || !decisive.length;
  return { gateResult: fail ? 'FAIL' : 'PASS', criteria: marked };
}

/** 정책 검증기가 쓰는 입력 — 이 정책 내용(contentHash)으로 돌린 최신 실행 */
export interface VirtualEvidence {
  scenario: VirtualScenario;
  run: Pick<VirtualRun, 'runId' | 'source' | 'testId' | 'gateResult' | 'overall' | 'criteria' | 'contentHash'> | null;
}
