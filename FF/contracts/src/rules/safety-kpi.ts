// 운행 중 감시 지표와 부속서 1 집계 (보고서 v1.1 13.4·13.5 · FFG-TEL-009) — Feature Version마다 13.5절 지표 6종을 계산하고 경보 기준과 비교한다.
// 경보 기준은 Feature별 Safety Case에서 정한다 — 기록 전에는 13.5절 예시값을 쓰고 'EXAMPLE'로 표시한다(지표 없는 출시 Version은 0, 미기록은 발견으로 보인다).
// ADS 기능은 부속서 1의 Feature Flag 관련 6항목을 정기 보고 형식으로 집계한다(항목 누락 0건 — 값이 없으면 누락으로 표시).
import { z } from 'zod';

export type MetricId = 'KILL_LATENCY_P95' | 'INCOMPLETE_DEACTIVATION' | 'PENDING_OVERDUE' | 'ONBOARD_FAULT_RATIO' | 'STATE_PROOF_FAILURE' | 'PERSISTENCE_FAILED';
/** §5.1.8.5.7 유형 — 일상 측정·초과 탐지·통계 */
export type MetricType = 'ROUTINE' | 'EXCEEDANCE' | 'STATISTICAL';

export interface MetricDef {
  id: MetricId;
  label: string;
  definition: string;
  type: MetricType;
  unit: 'ms' | 'ratio' | 'count';
  /** ABOVE: 값 > 기준 · AT_LEAST: 값 ≥ 기준 · RISE: 직전 기간 대비 증가 · FACTOR: 직전 기간의 기준배 이상 */
  alert: { op: 'ABOVE' | 'AT_LEAST' | 'RISE' | 'FACTOR'; example: number; text: string };
}

const HOUR = 3_600_000;
export const SAFETY_METRICS: MetricDef[] = [
  { id: 'KILL_LATENCY_P95', label: 'Kill 적용 지연', definition: '명령 발행부터 DISABLED·DURABLE 보고까지, 연결된 차량의 95번째 백분위', type: 'ROUTINE', unit: 'ms', alert: { op: 'ABOVE', example: 24 * HOUR, text: '정책 상한 초과(예시: 24시간)' } },
  { id: 'INCOMPLETE_DEACTIVATION', label: '미완료 비활성화', definition: 'DC2 종료 중 상한 초과 또는 MRC로 끝난 비율', type: 'EXCEEDANCE', unit: 'ratio', alert: { op: 'RISE', example: 0, text: '직전 분기 대비 증가(예시)' } },
  { id: 'PENDING_OVERDUE', label: 'pending_overdue', definition: '대기 상한을 넘은 차량 수', type: 'EXCEEDANCE', unit: 'count', alert: { op: 'AT_LEAST', example: 1, text: '1대 이상(예시)' } },
  { id: 'ONBOARD_FAULT_RATIO', label: 'on-board 고장 비율', definition: 'Feature Version별 ONBOARD 사유 DISABLED 비율', type: 'STATISTICAL', unit: 'ratio', alert: { op: 'FACTOR', example: 2, text: '같은 Version의 이전 주 대비 2배(예시)' } },
  { id: 'STATE_PROOF_FAILURE', label: '상태 증명 실패', definition: 'state_auth·report_seq 검사 실패 건수', type: 'EXCEEDANCE', unit: 'count', alert: { op: 'AT_LEAST', example: 1, text: '1건 이상(예시)' } },
  { id: 'PERSISTENCE_FAILED', label: '영속 실패', definition: 'persistence FAILED 차량 수', type: 'ROUTINE', unit: 'count', alert: { op: 'AT_LEAST', example: 1, text: '1대 이상(예시)' } },
];

/** Safety Case 경보 기준 기록 본문 — 빠진 지표는 직전 기준을 잇는다 */
export const MetricPlanBody = z.object({ thresholds: z.partialRecord(z.enum(['KILL_LATENCY_P95', 'INCOMPLETE_DEACTIVATION', 'PENDING_OVERDUE', 'ONBOARD_FAULT_RATIO', 'STATE_PROOF_FAILURE', 'PERSISTENCE_FAILED']), z.number().min(0)) }).strict();
export type MetricPlanBody = z.infer<typeof MetricPlanBody>;

/** Feature Version의 경보 기준 — SAFETY_CASE면 FSM이 기록한 값, EXAMPLE이면 13.5절 예시값 */
export interface MetricPlan {
  featureId: string;
  version: string;
  source: 'SAFETY_CASE' | 'EXAMPLE';
  thresholds: Record<MetricId, number>;
  recordedBy: string | null;
  recordedAt: string | null;
}

export function examplePlan(featureId: string, version: string): MetricPlan {
  return { featureId, version, source: 'EXAMPLE', thresholds: Object.fromEntries(SAFETY_METRICS.map((m) => [m.id, m.alert.example])) as Record<MetricId, number>, recordedBy: null, recordedAt: null };
}

/** 근접 순위(nearest-rank) 백분위 — 값이 없으면 null */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length))) - 1];
}

/** 지표 계산 입력 — 현재 기간과 직전 기간(비교형 지표) */
export interface MetricInput {
  /** 연결된 차량별 명령 발행 → DISABLED·DURABLE 보고 시간 */
  killLatencyMs: number[];
  /** DC2 종료 차량 수·상한 초과 또는 MRC로 끝난 수 — 이번 분기와 직전 분기 */
  deactivation: { total: number; incomplete: number; prevTotal: number; prevIncomplete: number };
  pendingOverdue: number;
  /** ONBOARD 사유 DISABLED 차량 수 / 보고 차량 수 — 이번 주와 이전 주 */
  onboard: { disabled: number; vehicles: number; prevDisabled: number; prevVehicles: number };
  stateProofFailures: number;
  persistenceFailed: number;
}

export interface MetricValue {
  id: MetricId;
  value: number | null;
  previous: number | null;
  threshold: number;
  alert: boolean;
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

/**
 * 13.5절 지표 6종의 값과 경보 — 값이 없으면(분모 0·표본 없음) 경보 없이 null.
 * @rule FFG-TEL-009 — Feature Version별 13.5 지표·경보 기준(Safety Case 기록, 미기록은 예시값 표시)
 */
export function computeMetrics(input: MetricInput, plan: MetricPlan): MetricValue[] {
  const raw: Record<MetricId, [number | null, number | null]> = {
    KILL_LATENCY_P95: [percentile(input.killLatencyMs, 95), null],
    INCOMPLETE_DEACTIVATION: [ratio(input.deactivation.incomplete, input.deactivation.total), ratio(input.deactivation.prevIncomplete, input.deactivation.prevTotal)],
    PENDING_OVERDUE: [input.pendingOverdue, null],
    ONBOARD_FAULT_RATIO: [ratio(input.onboard.disabled, input.onboard.vehicles), ratio(input.onboard.prevDisabled, input.onboard.prevVehicles)],
    STATE_PROOF_FAILURE: [input.stateProofFailures, null],
    PERSISTENCE_FAILED: [input.persistenceFailed, null],
  };
  return SAFETY_METRICS.map((m) => {
    const [value, previous] = raw[m.id];
    const threshold = plan.thresholds[m.id];
    const alert =
      value === null
        ? false
        : m.alert.op === 'ABOVE'
          ? value > threshold
          : m.alert.op === 'AT_LEAST'
            ? value >= threshold
            : m.alert.op === 'RISE'
              ? previous !== null && value > previous + threshold
              : previous !== null && previous > 0 ? value >= previous * threshold : previous === 0 && value > 0;
    return { id: m.id, value, previous, threshold, alert };
  });
}

/** 지표 계획이 없거나 Safety Case에 기준이 기록되지 않은 출시 Version */
export function metricCoverage(released: { featureId: string; version: string }[], plans: MetricPlan[]) {
  const plan = (r: { featureId: string; version: string }) => plans.find((p) => p.featureId === r.featureId && p.version === r.version);
  return {
    missing: released.filter((r) => !plan(r)),
    exampleOnly: released.filter((r) => plan(r)?.source === 'EXAMPLE'),
  };
}

// ── 부속서 1 (UN ADS GTR 제안문) — Feature Flag 관련 정기 보고 항목 ──

export type Annex1Id = 'DEACT_NOT_COMPLETED' | 'COMMUNICATION' | 'CYBERSECURITY' | 'UNAUTHORIZED_CHANGE' | 'MRC_MANEUVER' | 'REMOTE_INTERACTION';

export const ANNEX1_ITEMS: { id: Annex1Id; label: string; data: string }[] = [
  { id: 'DEACT_NOT_COMPLETED', label: '시스템이 시작한 비활성화 절차가 수동 운전으로 완료되지 않음', data: '원격 종료 후 인계 실패로 MRC에 간 건수, 종료 절차 중 상한 초과 건수' },
  { id: 'COMMUNICATION', label: 'ADS 안전에 영향을 준 통신 문제', data: 'Kill 미도달·지연, E2E 오류 급증, 응답 손실' },
  { id: 'CYBERSECURITY', label: 'ADS 안전에 영향을 준 사이버보안 문제', data: 'AUTH_FAILED·REPLAY 급증, state_auth 검증 실패' },
  { id: 'UNAUTHORIZED_CHANGE', label: 'ADS 기능에 영향을 줄 수 있는 무단 변경', data: 'target_hash·policy_hash 불일치, 승인되지 않은 구성' },
  { id: 'MRC_MANEUVER', label: 'MRC 도달을 위한 조작', data: '원격 종료로 시작된 MRC 건수(사유별)' },
  { id: 'REMOTE_INTERACTION', label: '주행 상황 처리를 위한 원격 상호작용', data: '원격 개입 이벤트와 Flag 변경의 구분' },
];

export interface Annex1Line {
  id: Annex1Id;
  label: string;
  count: number | null;
  /** 세부 내역(사유별 등) */
  detail: Record<string, number>;
  note: string | null;
}

/**
 * 부속서 1 정기 보고 — 항목마다 건수와 세부. 집계값이 없는 항목은 count null(누락)로 남겨 보고 전에 드러낸다.
 * @rule FFG-TEL-009 — ADS 기능의 부속서 1 항목 정기 보고 집계(항목 누락 0건)
 */
export function annex1Report(counts: Partial<Record<Annex1Id, { count: number; detail?: Record<string, number>; note?: string }>>): { lines: Annex1Line[]; missing: Annex1Id[] } {
  const lines = ANNEX1_ITEMS.map((i) => ({ id: i.id, label: i.label, count: counts[i.id]?.count ?? null, detail: counts[i.id]?.detail ?? {}, note: counts[i.id]?.note ?? null }));
  return { lines, missing: lines.filter((l) => l.count === null).map((l) => l.id) };
}
