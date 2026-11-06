// Data Lake 연계(IF-15)·Closed loop 공용 규칙 — 설계 80-70(0·4·5·6·9장), 응답 형식 80-75 8장(datalake-if15.openapi.json).
// Lake가 주인: 원천·집계·신선도·모델. FF가 주인: 4축 판정·점검 결과(Finding)·조치·수집 정책·모델 사용 승인·중단 기준.
// 자동으로 바꾸는 것은 규칙(① 중단 기준·신선도 초과 HOLD)뿐이다 — 모델 점수는 권고(Evidence)로만 쓴다(INV-17).
// 형식·표만 둔다(zod 없음) — 화면 첫 묶음에 실행 코드를 더하지 않게. 요청 본문 검증기는 schemas/lake.ts.

/** 판정 4축(80-70 9.1) — Lake Indicator.axis와 같은 값 */
export const HEALTH_AXES = ['OPERATION', 'PROBLEM', 'IMPROVEMENT', 'RISK'] as const;
export type HealthAxis = (typeof HEALTH_AXES)[number];

/** 축 상태 — 판단 불가(UNKNOWN)는 정상으로 보지 않는다. 순서 = 심각도(앞이 더 급함) */
export const HEALTH_STATES = ['ACTION', 'WATCH', 'UNKNOWN', 'OK'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** IF-15 Indicator.name(80-75 8장) */
export const LAKE_INDICATORS = [
  'delivery_success_rate', 'status_rejected_rate', 'dtc_vehicle_rate', 'fault_rate_per_1k', 'safety_event_rate_per_1k',
  'usage_rate', 'manual_off_rate', 'incident_count', 'anomaly_open_count', 'security_alert_count', 'disabled_share',
  'trial_conversion_rate', 'data_missing_rate',
] as const;
export type LakeIndicatorName = (typeof LAKE_INDICATORS)[number];

/** 지표 판정 기준 — worse: 커질수록 나쁜가(up)·작아질수록 나쁜가(down). watch·action은 절대값 경계, rise는 앞 창 대비 배수(주의) */
export interface IndicatorRule {
  axis: HealthAxis;
  worse: 'up' | 'down';
  watch: number;
  action: number;
  rise?: number;
}

/** @rule 80-70 9.1 — 축별 근거 지표와 경계(사전 등록 값, Lake 집계 기준). 비율은 0~1 */
export const INDICATOR_RULES: Record<LakeIndicatorName, IndicatorRule> = {
  delivery_success_rate: { axis: 'OPERATION', worse: 'down', watch: 0.97, action: 0.92 },
  status_rejected_rate: { axis: 'OPERATION', worse: 'up', watch: 0.01, action: 0.03 },
  disabled_share: { axis: 'OPERATION', worse: 'up', watch: 0.05, action: 0.15 },
  dtc_vehicle_rate: { axis: 'PROBLEM', worse: 'up', watch: 0.004, action: 0.008, rise: 1.5 },
  fault_rate_per_1k: { axis: 'PROBLEM', worse: 'up', watch: 2, action: 5, rise: 1.5 },
  safety_event_rate_per_1k: { axis: 'PROBLEM', worse: 'up', watch: 0.8, action: 1.5, rise: 1.5 },
  incident_count: { axis: 'PROBLEM', worse: 'up', watch: 3, action: 8 },
  anomaly_open_count: { axis: 'PROBLEM', worse: 'up', watch: 2, action: 5 },
  usage_rate: { axis: 'IMPROVEMENT', worse: 'down', watch: 0.35, action: 0.15 },
  manual_off_rate: { axis: 'IMPROVEMENT', worse: 'up', watch: 0.12, action: 0.3 },
  trial_conversion_rate: { axis: 'IMPROVEMENT', worse: 'down', watch: 0.08, action: 0.03 },
  security_alert_count: { axis: 'RISK', worse: 'up', watch: 1, action: 4 },
  data_missing_rate: { axis: 'RISK', worse: 'up', watch: 0.05, action: 0.2 },
};

/** 판단에 필요한 최소 표본(차량 수) — 미만이면 판단 불가. k-익명 5대(80-75 8.2)와 별개의 판정 기준 */
export const MIN_SAMPLE_VEHICLES = 200;

/** 신선도 SLA(초) — 안전 지표 10분(80-70 8장 제안), 사업 지표 1일 */
export const FRESHNESS_SLA = { SAFETY: 600, BUSINESS: 86_400 } as const;

/** FF 화면용 신선도 — 출처 데이터셋·기준 시각·지연. stale이면 그 지표로 내리는 판단은 보류(HOLD) */
export interface Freshness {
  dataset: string;
  asOf: string | null;
  lagSeconds: number | null;
  slaSeconds: number;
  stale: boolean;
}

export interface IndicatorValue {
  name: LakeIndicatorName;
  axis: HealthAxis;
  current: number | null;
  previous: number | null;
  sampleVehicles: number | null;
  suppressed: boolean;
}

/** 지표 하나 판정 — 값이 없거나 가려졌거나 표본이 적으면 UNKNOWN */
export function judgeIndicator(v: Pick<IndicatorValue, 'name' | 'current' | 'previous' | 'sampleVehicles' | 'suppressed'>): HealthState {
  const r = INDICATOR_RULES[v.name];
  if (v.suppressed || v.current == null || v.sampleVehicles == null || v.sampleVehicles < MIN_SAMPLE_VEHICLES) return 'UNKNOWN';
  const beyond = (edge: number) => (r.worse === 'up' ? v.current! >= edge : v.current! <= edge);
  if (beyond(r.action)) return 'ACTION';
  if (beyond(r.watch)) return 'WATCH';
  if (r.rise && v.previous != null && v.previous > 0 && v.current! / v.previous >= r.rise) return 'WATCH';
  return 'OK';
}

/** 축 판정 — 조치 필요 > 주의 > 판단 불가 > 정상. 데이터가 늦으면(stale) 정상 대신 판단 불가 */
export function judgeAxis(values: IndicatorValue[], stale: boolean): { state: HealthState; cause: LakeIndicatorName | null } {
  let best: { state: HealthState; cause: LakeIndicatorName | null } = { state: 'OK', cause: null };
  const rank = (s: HealthState) => HEALTH_STATES.indexOf(s);
  for (const v of values) {
    const s = judgeIndicator(v);
    if (rank(s) < rank(best.state)) best = { state: s, cause: v.name };
  }
  if (stale && best.state === 'OK') return { state: 'UNKNOWN', cause: null };
  if (!values.length) return { state: 'UNKNOWN', cause: null };
  return best;
}

/** 점검 결과(Finding) 상태 흐름(80-70 9.3) */
export const FINDING_STATUSES = ['DETECTED', 'ANALYZING', 'ACTING', 'VERIFYING', 'CLOSED', 'REOPENED'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const FINDING_FLOW: Record<FindingStatus, FindingStatus[]> = {
  DETECTED: ['ANALYZING'],
  ANALYZING: ['ACTING'],
  ACTING: ['VERIFYING'],
  VERIFYING: ['CLOSED', 'REOPENED'],
  CLOSED: [],
  REOPENED: ['ANALYZING'],
};
/** 열린 점검 결과 — 닫힘만 아니면 열림 */
export const findingOpen = (s: FindingStatus) => s !== 'CLOSED';

/** 조치 종류 — 기존 연계 재사용(정책 HOLD·롤백·차단은 기존 2인 승인 경로) */
export const FINDING_ACTIONS = ['JIRA', 'CODEBEAMER', 'POLICY_HOLD', 'ROLLBACK', 'KILL', 'COLLECTION'] as const;
export type FindingActionKind = (typeof FINDING_ACTIONS)[number];

/** 축별 담당 역할·기한(일) — 조치 필요는 3일, 주의는 14일 */
export const AXIS_OWNER: Record<HealthAxis, string> = { OPERATION: 'OPERATOR', PROBLEM: 'SAFETY_OFFICER', IMPROVEMENT: 'FEATURE_AUTHOR', RISK: 'OPS_LEAD' };
export const FINDING_DUE_DAYS: Record<'ACTION' | 'WATCH', number> = { ACTION: 3, WATCH: 14 };

/** 상태 이동 판정 — 조치 없이 '조치 중' 불가, 효과 확인 없이 닫기 불가(INV-20), 효과 미달은 다시 열림만 */
export function findingTransitionProblem(f: { status: FindingStatus; actions: unknown[]; effect: { met: boolean | null } | null }, to: FindingStatus, addsAction: boolean): string | null {
  if (!FINDING_FLOW[f.status].includes(to)) return `지금 상태에서 갈 수 없습니다`;
  if (to === 'ACTING' && !f.actions.length && !addsAction) return '조치를 먼저 연결해야 합니다';
  if (to === 'CLOSED' && f.effect?.met !== true) return '효과가 확인되어야 닫을 수 있습니다';
  if (to === 'REOPENED' && f.effect?.met === true) return '효과가 확인되어 다시 열 수 없습니다';
  return null;
}

/** Canary 판정(규칙 ①) — 자동 HOLD는 ABORT·HOLD_STALE만. 모델 점수는 판정에 쓰지 않는다 */
export type CanaryVerdict = 'OK' | 'ABORT' | 'HOLD_STALE' | 'INSUFFICIENT';
export const CANARY_METRICS = ['apply_failure_rate', 'dtc_per_1k', 'safety_event_per_1k'] as const;
export type CanaryMetric = (typeof CANARY_METRICS)[number];

/** 중단 기준(사전 등록, FR-ROL-002-006) — 상대위험 경계·신뢰수준·관측 시간·신선도 */
export interface AbortCriteria {
  policyId: string;
  metrics: { metric: CanaryMetric; maxRelativeRisk: number }[];
  confidence: number;
  observeHours: number;
  maxLagMinutes: number;
  registeredBy: string;
  registeredAt: string;
}
export const DEFAULT_ABORT: Omit<AbortCriteria, 'policyId' | 'registeredBy' | 'registeredAt'> = {
  metrics: [
    { metric: 'apply_failure_rate', maxRelativeRisk: 1.5 },
    { metric: 'dtc_per_1k', maxRelativeRisk: 1.5 },
    { metric: 'safety_event_per_1k', maxRelativeRisk: 1.3 },
  ],
  confidence: 0.95,
  observeHours: 24,
  maxLagMinutes: 10,
};
/** 판정에 필요한 적용군 최소 차량 수 */
export const CANARY_MIN_VEHICLES = 300;

export interface CanaryArmStat {
  metric: CanaryMetric;
  treatment: number;
  control: number;
  /** 상대위험과 신뢰구간(적용군/대조군) */
  relativeRisk: number;
  ci: [number, number];
}

/** @rule 80-70 4장 ① — 신선도 초과 → HOLD_STALE, 표본 부족 → INSUFFICIENT, 신뢰구간 하한이 경계를 넘으면 ABORT */
export function judgeCanary(i: { lagMinutes: number | null; vehicles: number; stats: CanaryArmStat[]; criteria: Pick<AbortCriteria, 'metrics' | 'maxLagMinutes'> }): { verdict: CanaryVerdict; breached: CanaryMetric[] } {
  if (i.lagMinutes == null || i.lagMinutes > i.criteria.maxLagMinutes) return { verdict: 'HOLD_STALE', breached: [] };
  if (i.vehicles < CANARY_MIN_VEHICLES) return { verdict: 'INSUFFICIENT', breached: [] };
  const breached = i.criteria.metrics.filter((m) => {
    const s = i.stats.find((x) => x.metric === m.metric);
    return !!s && s.ci[0] > m.maxRelativeRisk;
  }).map((m) => m.metric);
  return { verdict: breached.length ? 'ABORT' : 'OK', breached };
}

/** 모델 사용 승인(FF 쪽, 80-70 4장) — 2인·직무 분리. 드리프트·미승인 점수는 '참고 불가' */
export const MODEL_USE_APPROVERS = ['SAFETY_OFFICER', 'OPS_LEAD'] as const;
export const MODEL_USE_REQUIRED = 2;
export type ModelUseStatus = 'APPROVED' | 'PENDING' | 'REJECTED';
export type ModelPurpose = 'CANARY_RULE' | 'ANOMALY' | 'DEPLOY_RISK' | 'TRIAL_PROPENSITY';

/** 모델 점수를 판단 화면에 쓸 수 있는가 — 사용 승인 + 드리프트 없음 */
export const modelUsable = (m: { use: ModelUseStatus; drift: boolean }) => m.use === 'APPROVED' && !m.drift;

/** 수집 정책 상태 — 서명 게시본 경로(기존 배포 흐름) 재사용 */
export type CollectionPolicyStatus = 'DRAFT' | 'APPROVED' | 'DEPLOYED' | 'HELD';
/** 데이터 범주(80-70 3장) */
export type LakeDataCategory = 'SAFETY_OPS' | 'COMMERCIAL_USE' | 'SECURITY_WATCH';

// ── FF API 응답 형식(화면 ↔ 백엔드) ─────────────────────────────────────────

/** 연결 — connected=false면 화면은 '연결 안 됨'을 보이고 판단에 Lake 값을 쓰지 않는다 */
export interface LakeLink {
  connected: boolean;
  asOf: string | null;
}

export interface LakeStatusResponse extends LakeLink {
  datasets: Freshness[];
  stale: number;
  /** FF 이벤트 중 Lake가 아직 받지 않은 수(라벨 지연) */
  labelBacklog: number;
  /** 최근 24시간 조회 실패 수 */
  failures24h: number;
}

export interface DataContractRow {
  dataset: string;
  title: string;
  owner: string;
  schemaVersion: string;
  category: LakeDataCategory;
  markets: string[];
  basis: 'LAW' | 'CONSENT' | 'CONTRACT';
  basisNote: string;
  retention: string;
  pseudonymization: string;
  quality: { missingRate: number; duplicateRate: number; rangeViolations: number; passed: boolean };
  lastLoadedAt: string | null;
  rowsLastLoad: number;
  freshness: Freshness;
  /** CN 국외 이전 보류(k≥5 집계·점수만 반출) */
  transferHold: boolean;
}

export interface ModelApproval {
  by: string;
  role: string;
  at: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

export interface LakeModelRow {
  modelId: string;
  version: string;
  purpose: ModelPurpose;
  title: string;
  technique: string;
  owner: string;
  lakeApprovedBy: string;
  trainedAt: string;
  datasetHash: string;
  metrics: { precision: number | null; recall: number | null; calibration: number | null; fairnessGap: number | null };
  drift: boolean;
  driftNote: string | null;
  use: ModelUseStatus;
  approvals: ModelApproval[];
  usable: boolean;
}

export interface LabelFeedRow {
  kind: string;
  title: string;
  sent: number;
  lastAt: string | null;
}

export interface LabelFeedResponse extends LakeLink {
  ffSeq: number;
  lakeCursor: number;
  backlog: number;
  excluded: string[];
  items: LabelFeedRow[];
}

export interface HealthFindingAction {
  kind: FindingActionKind;
  ref: string;
  title: string;
  at: string;
  by: string;
}

export interface HealthFinding {
  findingId: string;
  featureId: string;
  version: string;
  featureName: string;
  axis: HealthAxis;
  cause: LakeIndicatorName;
  severity: 'ACTION' | 'WATCH';
  status: FindingStatus;
  ownerRole: string;
  dueAt: string;
  overdue: boolean;
  detectedAt: string;
  updatedAt: string;
  repeats: number;
  evidence: { freshness: Freshness; indicators: IndicatorValue[] };
  actions: HealthFindingAction[];
  effect: { indicator: LakeIndicatorName; target: number; before: number | null; after: number | null; samples: number | null; ci: [number, number] | null; met: boolean | null } | null;
  history: { at: string; from: FindingStatus | null; to: FindingStatus; by: string; note: string }[];
}

export interface FeatureHealthRow {
  featureId: string;
  version: string;
  name: string;
  market: string;
  activeVehicles: number | null;
  axes: Record<HealthAxis, { state: HealthState; cause: LakeIndicatorName | null }>;
  worst: HealthState;
  openFindings: number;
  overdue: number;
  freshness: Freshness;
  indicators: IndicatorValue[];
}

export interface FeatureHealthResponse extends LakeLink {
  rows: FeatureHealthRow[];
  findings: HealthFinding[];
}

export interface FeatureOpsVersion {
  version: string;
  activeVehicles: number | null;
  usageRate: number | null;
  failureRate: number | null;
  dtcRate: number | null;
  vocAfterDeploy: number;
  rollbacks: number;
  freshness: Freshness;
}

export interface FeatureOpsMetrics extends LakeLink {
  featureId: string;
  versions: FeatureOpsVersion[];
  history: { date: string; version: string; axes: Record<HealthAxis, HealthState> }[];
  findings: HealthFinding[];
}

export interface CanaryPoint {
  at: string;
  treatment: Record<CanaryMetric, number>;
  control: Record<CanaryMetric, number>;
}

export interface CanaryRisk {
  modelId: string;
  version: string;
  score: number;
  factors: { name: string; weight: number }[];
  usable: boolean;
}

export interface CanaryObservation {
  policyId: string;
  featureId: string;
  version: string;
  flagKey: string;
  stageBasisPoints: number;
  nextBasisPoints: number | null;
  vehicles: { treatment: number; control: number };
  series: CanaryPoint[];
  stats: CanaryArmStat[];
  criteria: Omit<AbortCriteria, 'policyId' | 'registeredBy' | 'registeredAt'> & { registered: boolean; registeredBy: string | null; registeredAt: string | null };
  verdict: CanaryVerdict;
  breached: CanaryMetric[];
  freshness: Freshness;
  risk: CanaryRisk | null;
}

export interface CanaryOverviewResponse extends LakeLink {
  items: CanaryObservation[];
}

export interface CollectionPolicyRow {
  collectionId: string;
  title: string;
  signals: string[];
  target: string;
  trigger: string;
  category: LakeDataCategory;
  basis: 'LAW' | 'CONSENT' | 'CONTRACT';
  basisNote: string;
  gbPerDay: number;
  vehicles: number;
  markets: string[];
  status: CollectionPolicyStatus;
  publicationId: string | null;
  replies: { accepted: number; rejected: number; pending: number };
  approvedBy: string | null;
  updatedAt: string;
  holdReason: string | null;
}

export interface LakeAnomalyEvidence {
  anomalyId: string;
  source: 'RULE' | 'MODEL';
  model: { modelId: string; version: string; score: number; usable: boolean } | null;
  snapshot: { dataset: string; asOf: string; ref: string };
  label: 'SENT' | 'PENDING' | 'NONE';
}

export interface LakeExperimentEffect {
  experimentId: string;
  metric: string;
  effect: number | null;
  ci: [number, number] | null;
  samples: { treatment: number; control: number };
  decidable: boolean;
  freshness: Freshness;
}

export interface LakeTrialInsight extends LakeLink {
  freshness: Freshness;
  usage: { band: string; vehicles: number; conversion: number }[];
  model: LakeModelRow | null;
  targets: { segment: string; vehicles: number; propensity: number }[];
  fairness: { group: string; rate: number; gap: number; pass: boolean }[];
}
