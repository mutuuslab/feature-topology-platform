// P10 — 실험·효과(D01-07) · 장애·VOC(D04-05) · 데이터 동기화(D05-02) · Legacy 연계(D05-03) · 현장 지원 포털(D05-05) · Legacy-SDV(D05-07)
// 그리고 외부 연계 모의 어댑터(IF-01 ALM·02 기준정보·03 MDM/DW·08 Supplier·11 OTel·12 해외공장)의 계약과 순수 규칙.
// 규칙은 화면·백엔드·시험이 같이 쓴다. 표준 보고서 규칙 표식(@rule)은 하네스(npm run standards)가 추적한다.
import { z } from 'zod';
import { fRank, type FClass } from '../schemas/safety';
import type { Market } from '../schemas/wire';

// ───────────────────────── D01-07 실험·효과 검증 관리 ─────────────────────────

export const ExperimentType = z.enum(['AB', 'SHADOW']);
export type ExperimentType = z.infer<typeof ExperimentType>;
export const ExperimentStatus = z.enum(['DRAFT', 'RUNNING', 'CONCLUDED', 'ABORTED']);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;
/** 효과 지표 — 낮을수록 좋은 사고성 지표와 높을수록 좋은 사용 지표 */
export const EXPERIMENT_METRICS = {
  FAULT_RATE: { ko: '고장 보고율', better: 'lower' },
  HARSH_DECEL_RATE: { ko: '급감속 발생률', better: 'lower' },
  ENGAGEMENT: { ko: '기능 사용률', better: 'higher' },
  DECISION_AGREEMENT: { ko: '판단 일치율(Shadow)', better: 'higher' },
} as const;
export type ExperimentMetric = keyof typeof EXPERIMENT_METRICS;

export const CreateExperimentBody = z
  .object({
    policyId: z.string().regex(/^POL-\d{5}$/),
    type: ExperimentType,
    hypothesis: z.string().trim().min(5).max(300),
    metric: z.enum(['FAULT_RATE', 'HARSH_DECEL_RATE', 'ENGAGEMENT', 'DECISION_AGREEMENT']),
    /** 처리군 비율(만분율) — Shadow는 판단만 계산하고 적용하지 않으므로 비율은 관측 범위 */
    treatmentBp: z.number().int().min(100).max(5000),
    minSamples: z.number().int().min(100).max(100000).default(1000),
  })
  .strict();
export type CreateExperimentBody = z.infer<typeof CreateExperimentBody>;
export const ConcludeExperimentBody = z.object({ decision: z.enum(['ADOPT', 'REJECT', 'EXTEND']), reason: z.string().trim().min(2).max(500) }).strict();

export interface Experiment {
  experimentId: string;
  policyId: string;
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: FClass;
  type: ExperimentType;
  hypothesis: string;
  metric: ExperimentMetric;
  treatmentBp: number;
  minSamples: number;
  status: ExperimentStatus;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  concludedAt: string | null;
  decision: 'ADOPT' | 'REJECT' | 'EXTEND' | null;
  reason: string | null;
}

/**
 * 실험 유형 허용 — 안전 관련(F2 이상) Feature는 차량 동작을 갈라 보는 A/B를 할 수 없고 Shadow(판단만 계산, 적용 안 함)만 허용.
 * Shadow는 판단 일치율로만 본다(차량 동작이 같으므로 사고성 지표는 의미가 없다).
 * @rule FFG-CLS-006 — F2 이상 Experiment(A/B) 금지, Shadow만
 */
export function experimentAllowed(type: ExperimentType, fClass: FClass, metric: ExperimentMetric): { ok: true } | { ok: false; rule: string; message: string } {
  if (type === 'AB' && fRank(fClass) >= 2) return { ok: false, rule: 'FFG-CLS-006', message: `${fClass}(안전 관련) Feature는 A/B 실험을 할 수 없습니다 — Shadow 실험만 허용됩니다.` };
  if (type === 'SHADOW' && metric !== 'DECISION_AGREEMENT') return { ok: false, rule: 'EXP-SHADOW-METRIC', message: 'Shadow 실험은 판단 일치율(DECISION_AGREEMENT)로만 평가합니다.' };
  if (type === 'AB' && metric === 'DECISION_AGREEMENT') return { ok: false, rule: 'EXP-AB-METRIC', message: '판단 일치율은 Shadow 실험 지표입니다.' };
  return { ok: true };
}

export interface ArmStats {
  n: number;
  events: number;
}
/** 두 비율의 차이(처리 − 대조)와 95% 신뢰구간(정규 근사), 표본이 최소 표본 이상이고 구간이 0을 지나지 않으면 유의 */
export function effectEstimate(control: ArmStats, treatment: ArmStats, minSamples: number) {
  const p1 = control.n ? control.events / control.n : 0;
  const p2 = treatment.n ? treatment.events / treatment.n : 0;
  const se = Math.sqrt((p1 * (1 - p1)) / Math.max(control.n, 1) + (p2 * (1 - p2)) / Math.max(treatment.n, 1));
  const diff = p2 - p1;
  const r = (x: number) => Math.round(x * 10000) / 10000;
  const enough = control.n >= minSamples && treatment.n >= minSamples;
  const lo = diff - 1.96 * se;
  const hi = diff + 1.96 * se;
  return { control: r(p1), treatment: r(p2), diff: r(diff), ci95: [r(lo), r(hi)] as [number, number], enough, significant: enough && (lo > 0 || hi < 0) };
}

/** 효과 판정 — 지표 방향을 반영해 처리군이 낫다/나쁘다/차이 없음 */
export function effectVerdict(metric: ExperimentMetric, e: ReturnType<typeof effectEstimate>): 'BETTER' | 'WORSE' | 'NO_DIFFERENCE' | 'INSUFFICIENT' {
  if (!e.enough) return 'INSUFFICIENT';
  if (!e.significant) return 'NO_DIFFERENCE';
  const up = e.diff > 0;
  return (EXPERIMENT_METRICS[metric].better === 'higher') === up ? 'BETTER' : 'WORSE';
}

// ───────────────────────── D04-05 장애·VOC 이력 연계 ─────────────────────────

export const IncidentSource = z.enum(['FIELD', 'VOC', 'DEALER']);
export const IncidentCategory = z.enum(['UNEXPECTED_ACTIVATION', 'NO_ACTIVATION', 'PERFORMANCE', 'HMI', 'OTHER']);
export type IncidentCategory = z.infer<typeof IncidentCategory>;
export const IncidentSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export const CreateIncidentBody = z
  .object({
    source: IncidentSource,
    vin: z.string().min(3).nullable().default(null),
    featureId: z.string().regex(/^FEAT-\d{5}$/).nullable().default(null),
    category: IncidentCategory,
    severity: IncidentSeverity,
    summary: z.string().trim().min(4).max(500),
    occurredAt: z.string().nullable().default(null),
  })
  .strict();
export type CreateIncidentBody = z.infer<typeof CreateIncidentBody>;

export interface Incident {
  incidentId: string;
  source: z.infer<typeof IncidentSource>;
  externalRef: string | null;
  vin: string | null;
  featureId: string | null;
  category: IncidentCategory;
  severity: z.infer<typeof IncidentSeverity>;
  summary: string;
  /** 발생 시각 — 신고에 없으면 null(미상). 수신 시각(receivedAt)으로 채우지 않는다(ORCA-HT06 시각 신뢰도) */
  occurredAt: string | null;
  receivedAt: string;
  receivedBy: string;
  sotif: { trigger: boolean; reason: string };
  anomalyId: string | null;
  status: 'OPEN' | 'LINKED' | 'CLOSED';
}

/** 기능 불충분(SOTIF)로 볼 범주 — 의도하지 않은 작동·필요할 때 미작동·성능 미달 */
const SOTIF_CATEGORIES: IncidentCategory[] = ['UNEXPECTED_ACTIVATION', 'NO_ACTIVATION', 'PERFORMANCE'];

/**
 * 운영 단계 SOTIF 모니터링 — Feature가 지정된 현장 장애·VOC 중 기능 불충분 범주이거나 CRITICAL이면 이상 징후(D06-12)로 넘긴다.
 * 차단 판단은 이상 징후 쪽 규칙과 사람의 요청·2인 승인(WP4)이 한다 — 여기서는 넘기기만 한다.
 * @rule FFG-SOT-003 — 운영 단계 SOTIF 모니터링(현장 장애·VOC → 이상 징후)
 */
export function sotifTrigger(i: Pick<Incident, 'featureId' | 'category' | 'severity'>): { trigger: boolean; reason: string } {
  if (!i.featureId) return { trigger: false, reason: 'Feature가 지정되지 않아 이상 징후로 넘기지 않음 — 분류 후 연결' };
  if (SOTIF_CATEGORIES.includes(i.category)) return { trigger: true, reason: `기능 불충분 범주(${i.category}) — SOTIF 운영 모니터링 트리거` };
  if (i.severity === 'CRITICAL') return { trigger: true, reason: 'CRITICAL 현장 장애 — SOTIF 운영 모니터링 트리거' };
  return { trigger: false, reason: `${i.category}·${i.severity} — 이력만 남김` };
}

/** VOC 원문 → 범주 추정 (고객센터 VOC는 분류 없이 들어온다) */
export function classifyVoc(text: string): IncidentCategory {
  if (/갑자기|스스로|의도치|원하지 않|급제동|혼자/.test(text)) return 'UNEXPECTED_ACTIVATION';
  if (/작동하지 않|안 켜|꺼져|안 됨|동작 안/.test(text)) return 'NO_ACTIVATION';
  if (/늦|느리|약하|거리.*(짧|길)|반응/.test(text)) return 'PERFORMANCE';
  if (/화면|표시|알림|소리|안내/.test(text)) return 'HMI';
  return 'OTHER';
}

// ───────────────────────── D05-02 데이터 동기화 ─────────────────────────

/** 시장 구분은 메시지 v2 와이어 스키마(MARKETS)와 같은 값 */

export interface SyncTarget {
  targetId: string;
  ifId: 'IF-02' | 'IF-03' | 'IF-12';
  name: string;
  system: string;
  market: Market;
  direction: 'INBOUND' | 'OUTBOUND';
  /** 대사 기준 키와 비교 필드 */
  key: string;
  fields: string[];
  /** 중국 시장 데이터는 현지 처리 대상 — 국외 이전(OUTBOUND)은 심사 전 보류 */
  localProcessing: boolean;
}

/**
 * 동기화 대상의 시장 구분 — CN 데이터는 현지 처리, 국외로 내보내는 동기화는 이전 심사 전까지 보류(HELD).
 * 심사·현지 처리 로직은 WP10(표준 보고서 세션)이 이어 받는다.
 * @rule FFG-TEL-005 — 중국 데이터 현지 처리·국외 이전 심사(보조: 시장 구분과 보류)
 */
export function syncGate(t: Pick<SyncTarget, 'market' | 'direction'>): { allowed: boolean; reason: string | null } {
  if (t.market === 'CN' && t.direction === 'OUTBOUND') return { allowed: false, reason: 'CN 시장 데이터 국외 이전 — 이전 심사 전 보류 (FFG-TEL-005)' };
  return { allowed: true, reason: null };
}

export interface SyncDiff {
  key: string;
  field: string;
  platform: string | null;
  external: string | null;
  kind: 'MISSING_IN_PLATFORM' | 'MISSING_IN_EXTERNAL' | 'MISMATCH';
}
/** 대사 — 플랫폼과 외부 원천을 키로 맞춰 없는 항목·다른 값을 낸다 (덮어쓰지 않는다: 원천 수정은 각 시스템 담당) */
export function reconcile(platform: Record<string, unknown>[], external: Record<string, unknown>[], key: string, fields: string[]): SyncDiff[] {
  const s = (v: unknown) => (v === undefined || v === null ? null : Array.isArray(v) ? v.join('|') : String(v));
  const P = new Map(platform.map((r) => [s(r[key])!, r]));
  const E = new Map(external.map((r) => [s(r[key])!, r]));
  const out: SyncDiff[] = [];
  for (const [k, e] of E) {
    const p = P.get(k);
    if (!p) {
      out.push({ key: k, field: key, platform: null, external: k, kind: 'MISSING_IN_PLATFORM' });
      continue;
    }
    for (const f of fields) if (s(p[f]) !== s(e[f])) out.push({ key: k, field: f, platform: s(p[f]), external: s(e[f]), kind: 'MISMATCH' });
  }
  for (const k of P.keys()) if (!E.has(k)) out.push({ key: k, field: key, platform: k, external: null, kind: 'MISSING_IN_EXTERNAL' });
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.field.localeCompare(b.field));
}

export const RunSyncBody = z.object({ targetId: z.string().regex(/^SYNC-[A-Z0-9-]+$/) }).strict();

// ───────────────────────── D05-03 Legacy 시스템 연계 ─────────────────────────

export interface LegacyMapping {
  legacyCode: string;
  system: 'PLANT-ERP' | 'DEALER-DMS';
  description: string;
  featureId: string;
  note: string | null;
}
export interface PlantOrder {
  orderId: string;
  plant: string;
  market: Market;
  vin: string;
  vehicleModel: string;
  options: string[];
}
/** 해외공장 주문의 레거시 옵션 코드 → FEAT 해석 — 매핑 없는 코드는 그대로 남겨 담당자가 매핑을 추가하게 한다 */
export function resolveOrder(order: PlantOrder, mappings: LegacyMapping[]) {
  const by = new Map(mappings.map((m) => [m.legacyCode, m]));
  const resolved = order.options.filter((o) => by.has(o)).map((o) => ({ legacyCode: o, featureId: by.get(o)!.featureId }));
  const unresolved = order.options.filter((o) => !by.has(o));
  return { orderId: order.orderId, vin: order.vin, plant: order.plant, market: order.market, resolved, unresolved };
}
export const ImportOrdersBody = z.object({ plant: z.enum(['TMA', 'HMA', 'HMGC']) }).strict();

// ───────────────────────── D05-07 Legacy-SDV Interface ─────────────────────────

export interface LegacyVehicle {
  vin: string;
  vehicleModel: string;
  modelYear: string;
  market: Market;
  architecture: 'LEGACY';
  codingUnit: string;
}
export const TranslateLegacyBody = z.object({ vin: z.string().min(3), featureId: z.string().regex(/^FEAT-\d{5}$/), enable: z.boolean() }).strict();

/**
 * 비SDV(레거시) 차량 전달 계획 — 런타임 Flag 평가·긴급 차단·Safe Default가 없으므로 딜러 코딩으로만 켜고 끈다.
 * 그래서 안전 관련(F2 이상) Feature는 레거시 차량에 내보내지 않는다(현장에서 원격 차단이 불가능).
 */
export function legacyPlan(v: LegacyVehicle, f: { featureId: string; fClass: FClass; controlPoints: string[] }, enable: boolean) {
  if (fRank(f.fClass) >= 2) return { supported: false as const, reason: `${f.fClass}(안전 관련) — 원격 긴급 차단이 없는 레거시 차량에는 내보내지 않습니다`, commands: [] };
  if (!f.controlPoints.includes('Parameter') && !f.controlPoints.includes('Signal')) return { supported: false as const, reason: '코딩으로 바꿀 제어점(Parameter·Signal)이 없습니다', commands: [] };
  const did = `F1${f.featureId.slice(-3)}`;
  return {
    supported: true as const,
    reason: null,
    commands: [{ unit: v.codingUnit, did, value: enable ? '01' : '00', note: `${f.featureId} ${enable ? '켜기' : '끄기'} — 딜러 진단기 코딩(재시동 후 반영)` }],
  };
}

// ───────────────────────── D05-05 현장 지원 포털 ─────────────────────────

export const FieldCaseBody = z
  .object({
    vin: z.string().min(3),
    featureId: z.string().regex(/^FEAT-\d{5}$/).nullable().default(null),
    category: IncidentCategory,
    severity: IncidentSeverity,
    summary: z.string().trim().min(4).max(500),
    dealer: z.string().trim().min(2).max(80),
  })
  .strict();
export type FieldCaseBody = z.infer<typeof FieldCaseBody>;

// ───────────────────────── 외부 연계 모의 어댑터 ─────────────────────────

/** P10에서 모의 어댑터를 둔 IF — 연결 방식은 환경 변수(IF_MODE_<번호>)로 mock|off, 기본 mock */
export const MOCK_IFS = ['IF-01', 'IF-02', 'IF-03', 'IF-08', 'IF-11', 'IF-12'] as const;
export type MockIf = (typeof MOCK_IFS)[number];

export interface IfSystemStatus {
  ifId: string;
  name: string;
  /** 어댑터 종류 — 모의·실연동·꺼짐, 또는 다른 경로(GLEO·CARLA·Unleash) */
  mode: 'mock' | 'live' | 'off' | 'internal' | 'ws' | 'cli';
  adapter: string;
  components: string[];
  calls: number;
  lastAt: string | null;
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTime: string;
  attributes: Record<string, string | number | boolean>;
}
