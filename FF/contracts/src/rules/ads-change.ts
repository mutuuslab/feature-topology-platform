// ADS 변경(변경 종류·승인 영향·릴리스 비교·분류) — 순수 규칙·표·타입(첫 화면에 들어가므로 zod 최상위 호출 금지, 본문 스키마는 schemas/ads-change.ts)
// ADS-BE08 변경 종류·유형별 영향 경로, ADS-UI09 릴리스 비교, ADS-BE16 분류 완결성·시장 기준선, ADS-BE12 확대 판정(읽기), ADS-UI03 미리보기 계약.
// 표의 값은 규제 담당 승인 전 '가정값'이다(ADS_CHANGE_ASSUMED). 서버와 화면이 같은 함수를 쓴다.
import type { Role } from '../enums';

/* ───────────────────────── 변경 종류 → 필수 영향 경로 (ADS-BE08) ───────────────────────── */

/** 변경 종류 — UNKNOWN은 판정할 정보(어느 ECU·모델이 바뀌었는지)가 없을 때. 정책 변경으로 가볍게 분류하지 않는다 */
export const ADS_CHANGE_KINDS = ['POLICY', 'CONFIG', 'SW', 'MODEL', 'ODD', 'UNKNOWN'] as const;
export type AdsChangeKind = (typeof ADS_CHANGE_KINDS)[number];

/** 승인 경로 — 재-HARA · R156 §7.1.1.9~11 영향 평가 · SUMS 기록 · Safety Case 갱신(ADS-BE14 전에는 기능안전 담당자 수동 확인) */
export const ADS_IMPACT_PATHS = ['REHARA', 'R156', 'SUMS', 'SAFETY_CASE'] as const;
export type AdsImpactPath = (typeof ADS_IMPACT_PATHS)[number];

/** 종류별 필수 경로(가정값) — 다섯 종류가 서로 다른 집합. 복수 종류 개정은 합집합, 판단 불가는 모든 경로 */
export const CHANGE_KIND_PATHS: Record<AdsChangeKind, readonly AdsImpactPath[]> = {
  POLICY: ['SUMS'],
  CONFIG: ['R156', 'SUMS'],
  SW: ['R156', 'SUMS', 'SAFETY_CASE'],
  MODEL: ['REHARA', 'R156', 'SUMS', 'SAFETY_CASE'],
  ODD: ['REHARA', 'R156', 'SAFETY_CASE'],
  UNKNOWN: ['REHARA', 'R156', 'SUMS', 'SAFETY_CASE'],
};

/** 표 값은 규제 담당 승인 전 가정값 */
export const ADS_CHANGE_ASSUMED = true;

/** 경로 종결 역할 — 재-HARA·Safety Case는 기능안전 담당자, R156 영향·SUMS는 사이버보안 담당자 */
export const PATH_CLOSER: Record<AdsImpactPath, Role> = {
  REHARA: 'SAFETY_OFFICER',
  R156: 'SECURITY_OFFICER',
  SUMS: 'SECURITY_OFFICER',
  SAFETY_CASE: 'SAFETY_OFFICER',
};

/** 무게 — 선언값보다 무거운 종류가 나오면 승격(escalated) */
const KIND_WEIGHT: Record<AdsChangeKind, number> = { POLICY: 1, CONFIG: 2, SW: 3, MODEL: 4, ODD: 5, UNKNOWN: 6 };

/** diff에서 읽은 변경 사실 — null·undefined는 '정보 없음' */
export interface AdsChangeFacts {
  /** 허용 기능·ODD·속도 범위가 넓어졌다 */
  oddWidened?: boolean | null;
  /** ODD가 바뀌었다(좁아짐 포함) */
  oddChanged?: boolean | null;
  /** 인식·판단 모델이 바뀌었다 */
  modelChanged?: boolean | null;
  /** ECU SW가 바뀌었다 */
  swChanged?: boolean | null;
  /** 파라미터·설정이 바뀌었다 */
  configChanged?: boolean | null;
}

export interface AdsChangeClass {
  /** 해당하는 종류(무거운 순) — 판단 불가면 ['UNKNOWN'] */
  kinds: AdsChangeKind[];
  /** 가장 무거운 종류 */
  primary: AdsChangeKind;
  /** 선언값보다 무거운 경로로 강제 승격됐는가 */
  escalated: boolean;
  /** 필수 경로(합집합) */
  paths: AdsImpactPath[];
}

const FACT_KEYS: (keyof AdsChangeFacts)[] = ['oddWidened', 'oddChanged', 'modelChanged', 'swChanged', 'configChanged'];

/**
 * 변경 종류 분류 — 선언값이 아니라 diff 사실로 정한다. 사실이 하나도 없으면 판단 불가(선언이 POLICY라도).
 * 사실이 모두 '아님'이면 정책만 바뀐 개정(POLICY).
 */
export function classifyChange(facts: AdsChangeFacts | null | undefined, declared?: AdsChangeKind | null): AdsChangeClass {
  const f = facts ?? {};
  const known = FACT_KEYS.some((k) => f[k] === true || f[k] === false);
  if (!known) return { kinds: ['UNKNOWN'], primary: 'UNKNOWN', escalated: !!declared && declared !== 'UNKNOWN', paths: [...CHANGE_KIND_PATHS.UNKNOWN] };
  const kinds: AdsChangeKind[] = [];
  if (f.oddWidened || f.oddChanged) kinds.push('ODD');
  if (f.modelChanged) kinds.push('MODEL');
  if (f.swChanged) kinds.push('SW');
  if (f.configChanged) kinds.push('CONFIG');
  if (!kinds.length) kinds.push('POLICY');
  kinds.sort((a, b) => KIND_WEIGHT[b] - KIND_WEIGHT[a]);
  const primary = kinds[0];
  return { kinds, primary, escalated: !!declared && KIND_WEIGHT[declared] < KIND_WEIGHT[primary], paths: requiredPaths(kinds) };
}

/** 여러 종류의 필수 경로 합집합(표 순서) */
export function requiredPaths(kinds: readonly AdsChangeKind[]): AdsImpactPath[] {
  const set = new Set(kinds.flatMap((k) => CHANGE_KIND_PATHS[k]));
  return ADS_IMPACT_PATHS.filter((p) => set.has(p));
}

export type AdsPathStatus = 'OPEN' | 'DONE' | 'NOT_REQUIRED';

export interface AdsImpactPathItem {
  path: AdsImpactPath;
  status: AdsPathStatus;
  /** 종결할 역할 */
  closer: Role;
  /** 남은 항목·근거 글자 */
  note: string | null;
  /** 연결(재-HARA 요청 ID·SUMS 기록 ID 등) */
  ref: string | null;
  closedBy: string | null;
  closedAt: string | null;
}

/** 변경 영향 한 건 — GET /api/change-impacts */
export interface AdsChangeImpactView {
  impactId: string;
  featureId: string;
  version: string;
  baseVersion: string | null;
  name: string;
  lifecycle: string | null;
  policyId: string | null;
  title: string;
  declaredKind: AdsChangeKind | null;
  facts: AdsChangeFacts;
  cls: AdsChangeClass;
  paths: AdsImpactPathItem[];
  scopeStatus: 'CONFIRMED' | 'REVIEW_REQUIRED';
  assignee: string | null;
  openedAt: string;
  /** 출시(RELEASED) 뒤 열린 재-HARA 경로가 있는가 — 배포·서명을 막아야 하는 사유(서버 거부는 ADS-BE06) */
  reharaOpenAfterRelease: boolean;
  /** 같은 Feature Version의 열린 재-HARA 요청(기존 /api/rehara-requests) ID */
  reharaRequestIds: string[];
  /** 이 변경으로 다시 판정할 Gate */
  rejudgeGates: string[];
}

export interface AdsOpenPathCounts {
  REHARA: number;
  R156: number;
  SUMS: number;
  SAFETY_CASE: number;
  /** 종류가 정해진 변경의 끝나지 않은 경로 합 */
  total: number;
  /** 변경 종류 판단 불가 건수 — 경로 수에 섞지 않고 따로 */
  undecidable: number;
}

/** GET /api/change-impacts */
export interface AdsChangeImpactList {
  items: AdsChangeImpactView[];
  counts: AdsOpenPathCounts;
  /** 다시 판정할 Gate 수(중복 없이, 변경 건별 합) */
  rejudgeGates: number;
  assumed: boolean;
}

/** 끝나지 않은 승인 경로 집계 — 판단 불가 변경은 경로 수가 아니라 undecidable로 따로 센다 */
export function openPathCounts(rows: readonly Pick<AdsChangeImpactView, 'cls' | 'paths'>[]): AdsOpenPathCounts {
  const c: AdsOpenPathCounts = { REHARA: 0, R156: 0, SUMS: 0, SAFETY_CASE: 0, total: 0, undecidable: 0 };
  for (const r of rows) {
    if (r.cls.primary === 'UNKNOWN') {
      c.undecidable++;
      continue;
    }
    for (const p of r.paths) {
      if (p.status !== 'OPEN') continue;
      c[p.path]++;
      c.total++;
    }
  }
  return c;
}

/** 경로 상태 — 필수가 아니면 NOT_REQUIRED, 필수인데 종결 기록이 없으면 OPEN */
export function pathItems(cls: AdsChangeClass, recorded: Partial<Record<AdsImpactPath, Partial<Omit<AdsImpactPathItem, 'path' | 'closer'>>>>): AdsImpactPathItem[] {
  return ADS_IMPACT_PATHS.map((path) => {
    const r = recorded[path] ?? {};
    const required = cls.paths.includes(path);
    return {
      path,
      status: required ? (r.status === 'DONE' ? 'DONE' : 'OPEN') : 'NOT_REQUIRED',
      closer: PATH_CLOSER[path],
      note: r.note ?? null,
      ref: r.ref ?? null,
      closedBy: r.closedBy ?? null,
      closedAt: r.closedAt ?? null,
    };
  });
}

/* ───────────────────────── 릴리스 비교 (ADS-UI09) ───────────────────────── */

/** 운행 조건 축 값 — 수치 범위·목록·참거짓 */
export type OddAxisValue = { min: number; max: number; unit: string } | string[] | boolean | null;

/** 릴리스 스냅샷 — 대상·의존 Feature·운행 조건(축별)·종료 동작 */
export interface ReleaseSnapshot {
  featureId: string;
  version: string;
  /** 대상(시장·차종·트림) */
  targets: string[];
  /** 의존 Feature(FEAT-xxxxx@ver) */
  dependencies: string[];
  /** 운행 조건 축 — 키는 축 이름(speedKmh·roadType·weather …) */
  odd: Record<string, OddAxisValue>;
  /** 종료 동작 — DC 등급·대체 동작·MRC 계약 */
  termination: { dc: string | null; fallback: string | null; mrc: string | null };
}

export type DiffDirection = 'WIDEN' | 'NARROW' | 'CHANGED' | 'SAME';
export type DiffGroup = 'TARGET' | 'DEPENDENCY' | 'ODD' | 'TERMINATION';

export interface ReleaseDiffRow {
  group: DiffGroup;
  /** 필드 키 — 화면이 이름을 붙인다(targets·dependencies·odd.<축>·dc·fallback·mrc) */
  field: string;
  before: unknown;
  after: unknown;
  direction: DiffDirection;
}

const isRange = (v: OddAxisValue): v is { min: number; max: number; unit: string } => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 목록 방향 — 늘어난 값이 있으면 확대(줄어든 값이 섞여도 위험 쪽인 확대), 줄기만 하면 축소 */
function setDirection(a: readonly string[], b: readonly string[]): DiffDirection {
  const A = new Set(a);
  const B = new Set(b);
  const added = [...B].some((x) => !A.has(x));
  const removed = [...A].some((x) => !B.has(x));
  if (added) return 'WIDEN';
  return removed ? 'NARROW' : 'SAME';
}

/** 운행 조건 한 축의 방향 — 범위가 넓어지거나 목록이 늘거나 false→true(허용)면 확대 */
export function oddAxisDirection(before: OddAxisValue, after: OddAxisValue): DiffDirection {
  if (same(before, after)) return 'SAME';
  if (before == null || after == null) return after == null ? 'NARROW' : 'WIDEN';
  if (isRange(before) && isRange(after)) {
    if (before.unit !== after.unit) return 'CHANGED';
    if (after.min < before.min || after.max > before.max) return 'WIDEN';
    return after.min > before.min || after.max < before.max ? 'NARROW' : 'SAME';
  }
  if (Array.isArray(before) && Array.isArray(after)) return setDirection(before, after);
  if (typeof before === 'boolean' && typeof after === 'boolean') return after ? 'WIDEN' : 'NARROW';
  return 'CHANGED';
}

const DIR_ORDER: Record<DiffDirection, number> = { WIDEN: 0, CHANGED: 1, NARROW: 2, SAME: 3 };

/** 릴리스 전후 비교 — 필드별 행, 확대 방향 먼저(같은 필드는 맨 뒤) */
export function releaseDiff(before: ReleaseSnapshot, after: ReleaseSnapshot): ReleaseDiffRow[] {
  const rows: ReleaseDiffRow[] = [
    { group: 'TARGET', field: 'targets', before: before.targets, after: after.targets, direction: setDirection(before.targets, after.targets) },
    { group: 'DEPENDENCY', field: 'dependencies', before: before.dependencies, after: after.dependencies, direction: same([...before.dependencies].sort(), [...after.dependencies].sort()) ? 'SAME' : 'CHANGED' },
  ];
  const axes = [...new Set([...Object.keys(before.odd), ...Object.keys(after.odd)])].sort();
  for (const a of axes) rows.push({ group: 'ODD', field: `odd.${a}`, before: before.odd[a] ?? null, after: after.odd[a] ?? null, direction: oddAxisDirection(before.odd[a] ?? null, after.odd[a] ?? null) });
  for (const k of ['dc', 'fallback', 'mrc'] as const) {
    const b = before.termination[k];
    const x = after.termination[k];
    rows.push({ group: 'TERMINATION', field: k, before: b, after: x, direction: same(b, x) ? 'SAME' : 'CHANGED' });
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((p, q) => DIR_ORDER[p.r.direction] - DIR_ORDER[q.r.direction] || p.i - q.i)
    .map((p) => p.r);
}

export interface ReleaseDiffSummary {
  widened: number;
  narrowed: number;
  changed: number;
  /** 종료 동작 묶음 요약 — DC·대체 동작·MRC 계약 각각 바뀐 수 */
  termination: { dc: number; fallback: number; mrc: number };
}

export function diffSummary(rows: readonly ReleaseDiffRow[]): ReleaseDiffSummary {
  const t = (f: string) => rows.filter((r) => r.group === 'TERMINATION' && r.field === f && r.direction !== 'SAME').length;
  return {
    widened: rows.filter((r) => r.direction === 'WIDEN').length,
    narrowed: rows.filter((r) => r.direction === 'NARROW').length,
    changed: rows.filter((r) => r.direction === 'CHANGED').length,
    termination: { dc: t('dc'), fallback: t('fallback'), mrc: t('mrc') },
  };
}

/** 릴리스 ID — Feature Version 쌍의 뒤쪽 Version: 'FEAT-00004-4.1.0'(경로에 그대로 쓰도록 '@' 대신 '-'). 비교 기준은 직전 Version 또는 ?base= */
export const releaseId = (featureId: string, version: string) => `${featureId}-${version}`;
export function parseReleaseId(id: string): { featureId: string; version: string } | null {
  const m = /^(FEAT-\d{5})-(\d+\.\d+\.\d+)$/.exec(id);
  return m ? { featureId: m[1], version: m[2] } : null;
}

/** GET /api/releases/:id/diff */
export interface ReleaseDiffView {
  releaseId: string;
  featureId: string;
  name: string;
  before: ReleaseSnapshot;
  after: ReleaseSnapshot;
  rows: ReleaseDiffRow[];
  summary: ReleaseDiffSummary;
  /** 이 릴리스의 변경 종류(diff에서 산출) */
  cls: AdsChangeClass;
  assumed: boolean;
}

/** GET /api/releases */
export interface ReleaseListItem {
  releaseId: string;
  featureId: string;
  version: string;
  baseVersion: string;
  name: string;
  primaryKind: AdsChangeKind;
}

/** 릴리스 diff에서 변경 사실을 뽑는다 — 종류 분류의 입력 */
export function factsFromDiff(rows: readonly ReleaseDiffRow[], extra: Pick<AdsChangeFacts, 'modelChanged' | 'swChanged' | 'configChanged'> = {}): AdsChangeFacts {
  const odd = rows.filter((r) => r.group === 'ODD');
  return {
    oddWidened: odd.some((r) => r.direction === 'WIDEN'),
    oddChanged: odd.some((r) => r.direction !== 'SAME'),
    modelChanged: extra.modelChanged ?? null,
    swChanged: extra.swChanged ?? null,
    configChanged: extra.configChanged ?? null,
  };
}

/* ───────────────────────── Feature 분류·시장 기준선 (ADS-BE16) ───────────────────────── */

/** DDT(동적 운전 과업) 영향 — 없음 · 보조(운전자가 감독) · 일부 수행 · 전부 수행 */
export const DDT_IMPACTS = ['NONE', 'SUPPORT', 'PARTIAL', 'FULL'] as const;
export type DdtImpact = (typeof DDT_IMPACTS)[number];

/** Lifecycle 상태별 책임자 칸 — 생성·운영·중단·폐기 */
export const LIFECYCLE_OWNER_STATES = ['CREATE', 'OPERATE', 'SUSPEND', 'DISPOSE'] as const;
export type LifecycleOwnerState = (typeof LIFECYCLE_OWNER_STATES)[number];
/** Lifecycle 값 → 책임자 칸 */
export const LIFECYCLE_TO_OWNER_STATE: Record<string, LifecycleOwnerState> = {
  PROPOSED: 'CREATE',
  APPROVED: 'CREATE',
  DEVELOPING: 'CREATE',
  VERIFIED: 'CREATE',
  RELEASED: 'OPERATE',
  DEPRECATED: 'SUSPEND',
  RETIRED: 'DISPOSE',
};

export type ClassSource = 'MANUAL' | 'INFERRED' | 'REPORT_EXAMPLE';

/** Feature Version 분류 — ADS 여부·DDT 영향·안전 관련성·담당 */
export interface AdsClassification {
  featureId: string;
  version: string;
  adsFeature: boolean | null;
  ddtImpact: DdtImpact | null;
  safetyRelated: boolean | null;
  owner: string | null;
  /** 출처 — 판정에 쓰지 않는다(추정은 '추정 — 확정 전' 배지) */
  source: ClassSource;
  status: 'CONFIRMED' | 'DRAFT';
  confirmedBy: string | null;
  confirmedAt: string | null;
  lifecycleOwners: Partial<Record<LifecycleOwnerState, string | null>>;
  /** 확정 서명 — 확정 대상 필드(축 값·담당·상태별 책임자)의 정규 문자열(rules/ads-publish classificationConfirmHash). 바뀌면 재확정 */
  confirmHash?: string | null;
}

/** 분류 빈 축 — ADS 여부·DDT 영향·안전 관련성·담당·상태별 책임자·확정 */
export const CLASS_GAPS = ['ADS', 'DDT', 'SAFETY', 'OWNER', 'LIFECYCLE_OWNER', 'CONFIRM'] as const;
export type ClassGap = (typeof CLASS_GAPS)[number];

export interface ClassCompleteness {
  classified: boolean;
  gaps: ClassGap[];
  /** 추정값이 있다 — 확정 전이므로 미분류로 센다 */
  inferred: boolean;
}

/**
 * 분류 완결성 — 확정(CONFIRMED) 여부와 네 축·상태별 책임자만 본다. 출처(INFERRED 등)는 판정에 쓰지 않는다.
 * 행이 없으면 모든 축이 빈칸(미분류) — 'ADS 아님'으로 보지 않는다.
 */
export function classificationCompleteness(c: AdsClassification | null | undefined): ClassCompleteness {
  if (!c) return { classified: false, gaps: [...CLASS_GAPS], inferred: false };
  const gaps: ClassGap[] = [];
  if (c.adsFeature == null) gaps.push('ADS');
  if (c.ddtImpact == null) gaps.push('DDT');
  if (c.safetyRelated == null) gaps.push('SAFETY');
  if (!c.owner) gaps.push('OWNER');
  if (LIFECYCLE_OWNER_STATES.some((s) => !c.lifecycleOwners?.[s])) gaps.push('LIFECYCLE_OWNER');
  if (c.status !== 'CONFIRMED') gaps.push('CONFIRM');
  return { classified: gaps.length === 0, gaps, inferred: c.source === 'INFERRED' && c.status !== 'CONFIRMED' };
}

/** 미분류 목록 행 — GET /api/classification/unclassified */
export interface UnclassifiedRow {
  featureId: string;
  version: string;
  name: string;
  lifecycle: string;
  ownerId: string;
  gaps: ClassGap[];
  inferred: boolean;
}
export interface UnclassifiedView {
  items: UnclassifiedRow[];
  /** 점검 범위 — 출시 전 Feature(최신 Version, RELEASED·DEPRECATED·RETIRED 제외) */
  scope: number;
  /** 거부 규칙은 아직 켜지 않았다(목록·사유만) */
  ruleEnabled: false;
}

/** 시장 기준선 — 시장별 승인 유형·규정 series·승인 ODD 프로파일 */
export interface MarketBaseline {
  market: string;
  featureId: string;
  version: string;
  approvalType: 'TYPE_APPROVAL' | 'SELF_CERT';
  regulations: { reg: string; series: string }[];
  oddProfileRef: string | null;
  /** UNKNOWN이면 화면은 '판단 불가' */
  approvalStatus: 'APPROVED' | 'PENDING' | 'UNKNOWN';
  assumed: boolean;
  note: string | null;
}

/** GET /api/features/:id/versions/:ver/classification */
export interface ClassificationView {
  featureId: string;
  version: string;
  lifecycle: string | null;
  classification: AdsClassification | null;
  completeness: ClassCompleteness;
  baselines: MarketBaseline[];
  /** 안전 분류(보고서 v1.1) 확정 상태 — 참고 */
  safetyProfileStatus: string | null;
  /** 출시 전이 거부 규칙 — 분류 행이 있는 Version(분류 대상 등록)에서 켜진다(ADS-BE16) */
  ruleEnabled: boolean;
  /** 상태별 책임자 지정 이력(추가만) */
  ownerHistory?: { state: string; ownerId: string | null; assignedAt: string; assignedBy: string }[];
}

/* ───────────────────────── 확대 판정 (ADS-BE12 — 읽기) ───────────────────────── */

export type ExpansionVerdict = 'EXPAND' | 'STOP' | 'HOLD' | 'FROZEN';
export type ExpansionReason = 'OK' | 'METRIC_ALERT' | 'METRIC_DELAY' | 'INSUFFICIENT' | 'FROZEN';

export interface ExpansionMetric {
  key: string;
  observedAt: string | null;
  staleAfterMs: number;
  value: number;
  threshold: number;
  /** 임계 초과 */
  breached: boolean;
}
export interface ExpansionCombo {
  comboId: string;
  /** 차량 보고 Active */
  vehicleActive: number;
  /** 실사용 확인 */
  usageConfirmed: number;
  errors: number;
  samples: number;
  minSamples: number;
  windowHours: number;
  alert: boolean;
}
export type ComboVerdict = 'OK' | 'ALERT' | 'INSUFFICIENT';

export interface ExpansionInput {
  frozen: { reason: string; scope: string; by: string; at: string } | null;
  metrics: ExpansionMetric[];
  combos: ExpansionCombo[];
  now: number;
}
export interface ExpansionResult {
  verdict: ExpansionVerdict;
  reason: ExpansionReason;
  combos: { comboId: string; verdict: ComboVerdict }[];
  staleMetrics: string[];
  /** 가장 오래된 감시 지표 지연(ms) */
  maxDelayMs: number;
}

export function comboVerdict(c: ExpansionCombo): ComboVerdict {
  if (c.alert) return 'ALERT';
  return c.samples < c.minSamples ? 'INSUFFICIENT' : 'OK';
}

/**
 * 확대 판정 — 동결 > 중단(지표 경보·조합 경보) > 확대 보류(지표 지연·표본 부족) > 확대 가능.
 * 미확인 차량은 입력에 넣지 않는다(노출량은 차량 보고 Active만). 지표가 기준 시간을 넘기면 '확대 가능'을 내지 않는다.
 */
export function expansionVerdict(i: ExpansionInput): ExpansionResult {
  const combos = i.combos.map((c) => ({ comboId: c.comboId, verdict: comboVerdict(c) }));
  const delay = (m: ExpansionMetric) => (m.observedAt ? i.now - Date.parse(m.observedAt) : Number.POSITIVE_INFINITY);
  const staleMetrics = i.metrics.filter((m) => delay(m) > m.staleAfterMs).map((m) => m.key);
  const maxDelayMs = i.metrics.reduce((a, m) => Math.max(a, delay(m)), 0);
  const base = { combos, staleMetrics, maxDelayMs };
  if (i.frozen) return { verdict: 'FROZEN', reason: 'FROZEN', ...base };
  if (i.metrics.some((m) => m.breached) || combos.some((c) => c.verdict === 'ALERT')) return { verdict: 'STOP', reason: 'METRIC_ALERT', ...base };
  if (staleMetrics.length) return { verdict: 'HOLD', reason: 'METRIC_DELAY', ...base };
  if (!combos.some((c) => c.verdict === 'OK')) return { verdict: 'HOLD', reason: 'INSUFFICIENT', ...base };
  return { verdict: 'EXPAND', reason: 'OK', ...base };
}

/** GET /api/policies/:id/expansion */
export interface ExpansionView {
  policyId: string;
  featureId: string;
  featureVersion: string;
  result: ExpansionResult;
  /** 차량 보고 Active 합 — 미확인은 빼고 따로 */
  vehicleActive: number;
  unconfirmed: number;
  /** 정책이 허용한 차량 수(의도) — 실제 Active와 따로 */
  policyAllowed: number;
  metrics: ExpansionMetric[];
  combos: ExpansionCombo[];
  frozen: ExpansionInput['frozen'];
  assumed: boolean;
}

/* ───────────────────────── 일괄 명령 미리보기 계약 (ADS-UI03) ───────────────────────── */

/**
 * GET /api/kill-requests/preview 응답에 더해질 선택 필드 — 서버 대상 검증(ADS-BE05)이 채운다.
 * 없으면 화면은 '서명 대상 digest는 서버 대상 검증 뒤 표시'.
 */
export interface BulkTargetDigestFields {
  /** 미리보기 대상(차량 목록·제외 선택)의 서명 대상 digest */
  targetDigest?: string | null;
  /** 서명 직전 서버가 다시 센 digest — 다르면 서명 버튼 대신 차이 */
  serverDigest?: string | null;
}
