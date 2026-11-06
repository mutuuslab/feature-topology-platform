// ADS 상태(6축·수렴·행위별 판정·고객 상태·주문 추적) — 순수 규칙·표·타입(첫 화면에 들어가므로 zod 최상위 호출 금지, 본문 스키마는 schemas/ads-state.ts)
// 판정 함수는 여기 하나 — 백엔드 집계와 화면이 같은 함수를 쓴다(설계 harness/ads/design.json stateModel·ADS-UI01·ADS-UI06·ORC-UI01·ORC-UI03).

// ───────────── 기준 시간(관측 신선도) ─────────────

/** 기준 시간 등급 — Feature별 보고 주기 기본값은 등급별 가정값 */
export type FeatureClass = 'ADS' | 'ADAS' | 'QM';
/** Feature별 expected_report_interval 기본값(가정값) — 승인된 값이 생기면 기준 시간 표가 덮어쓴다 */
export const REPORT_INTERVAL_DEFAULT_MS: Readonly<Record<FeatureClass, number>> = { ADS: 15 * 60_000, ADAS: 30 * 60_000, QM: 24 * 3600_000 };
/** 사용 준비 확인 기한 — 결제 후 24시간(가정값) */
export const READY_DEADLINE_DEFAULT_MS = 24 * 3600_000;

export type FreshnessState = 'FRESH' | 'DELAYED' | 'OFFLINE' | 'UNOBSERVED';

/**
 * 관측 신선도 — 보고 이력 없음 → 미확인, 연결 끊김(offline_since가 마지막 관측 이후) → 오프라인,
 * 기준 시간 초과(연결 끊김 기록 없음) → 지연, 그 밖 → 최신 확인. 서버가 계산하고 화면은 낱말만 바꾼다.
 */
export function freshnessOf(i: { observedAt?: string | null; offlineSince?: string | null; staleAfterMs: number; now: number }): FreshnessState {
  if (!i.observedAt) return 'UNOBSERVED';
  const obs = Date.parse(i.observedAt);
  if (i.offlineSince && Date.parse(i.offlineSince) >= obs) return 'OFFLINE';
  return i.now - obs > i.staleAfterMs ? 'DELAYED' : 'FRESH';
}

/** 차량 보고값(활성 적격·실제 실행)은 최신 확인일 때만 현재 값 — 그 밖에는 현재 값 없음(미확인)과 과거 값(회색 보조) */
export function reportedValue<T>(value: T | null | undefined, freshness: FreshnessState): { current: T | null; past: T | null } {
  const v = value ?? null;
  return freshness === 'FRESH' ? { current: v, past: null } : { current: null, past: v };
}

// ───────────── 6축 값 ─────────────

export type EntitlementAxis = 'NONE' | 'TRIAL' | 'PURCHASED' | 'EXPIRED' | 'TRANSFER_REVIEW' | 'NOT_LINKED';
export type InstallAxis = 'NOT_INSTALLED' | 'INSTALLING' | 'COMPATIBLE' | 'PARTIAL_FAILURE' | 'RECOVERY_NEEDED' | 'NOT_LINKED';
export type EligibilityValue = 'ALLOW' | 'ODD_OUT' | 'FORBIDDEN' | 'CONDITION_MISSING' | 'UNKNOWN';
export type RuntimeState = 'INACTIVE' | 'AVAILABLE' | 'ACTIVE' | 'IN_TRANSITION' | 'MRC' | 'TERMINATED' | 'RECOVERY_PENDING';
export const RUNTIME_STATES: readonly RuntimeState[] = ['INACTIVE', 'AVAILABLE', 'ACTIVE', 'IN_TRANSITION', 'MRC', 'TERMINATED', 'RECOVERY_PENDING'];
export type DdtOwner = 'ADS' | 'USER' | 'FALLBACK' | 'NONE' | 'UNKNOWN';
export type OtaStage = 'DOWNLOADED' | 'INSTALL_READY' | 'INSTALLING' | 'VERIFIED' | 'FAILED' | 'RECOVERY' | 'SAFE_STATE';
export const OTA_STAGES: readonly OtaStage[] = ['DOWNLOADED', 'INSTALL_READY', 'INSTALLING', 'VERIFIED', 'FAILED', 'RECOVERY', 'SAFE_STATE'];

/** 상품 권리 축 — 결제 상태(PAID)는 이 칸에 쓰지 않는다. 체험 ACTIVE → 체험, 그 밖 ACTIVE → 구매, 끝난 권리만 있으면 만료 */
export function entitlementAxisOf(grants: readonly { kind: string; status: string }[]): EntitlementAxis {
  const active = grants.filter((g) => g.status === 'ACTIVE');
  if (active.some((g) => g.kind !== '체험')) return 'PURCHASED';
  if (active.length) return 'TRIAL';
  if (grants.some((g) => g.status === 'EXPIRED' || g.status === 'REVOKED' || g.status === 'CONVERTED')) return 'EXPIRED';
  return 'NONE';
}

/** 구성과 설치 축 = OTA 단계 × 승인 조합 대조. OTA 기록이 없거나 대조할 수 없으면 미확인(연동 전) — 호환으로 세지 않는다 */
export function installAxisOf(ota: OtaStage | null | undefined, configMatch: boolean | null | undefined): InstallAxis {
  switch (ota) {
    case 'DOWNLOADED':
    case 'INSTALL_READY':
      return 'NOT_INSTALLED';
    case 'INSTALLING':
      return 'INSTALLING';
    case 'VERIFIED':
      return configMatch === true ? 'COMPATIBLE' : configMatch === false ? 'PARTIAL_FAILURE' : 'NOT_LINKED';
    case 'FAILED':
    case 'RECOVERY':
    case 'SAFE_STATE':
      return 'RECOVERY_NEEDED';
    default:
      return 'NOT_LINKED';
  }
}

// ───────────── 행위별 판정(차량 보고) ─────────────

export const VERDICT_ACTIONS = ['ACTIVATE', 'HANDOVER', 'INSTALL', 'MRC', 'TERMINATE_CONFIRM', 'REACTIVATE'] as const;
export type VerdictAction = (typeof VERDICT_ACTIONS)[number];
export type VerdictValue = 'ALLOW' | 'DENY' | 'UNKNOWN';
export const VERDICT_ACTION_LABEL: Readonly<Record<VerdictAction, string>> = { ACTIVATE: '활성화', HANDOVER: '인계', INSTALL: '설치', MRC: 'MRC', TERMINATE_CONFIRM: '종료 확인', REACTIVATE: '재활성화' };
export const VERDICT_LABEL: Readonly<Record<VerdictValue, string>> = { ALLOW: '허용', DENY: '거부', UNKNOWN: '판단 불가' };

/**
 * 사유 코드 사전 — 차량 판정 보고서 사유 18개 + 운행 조건(ODD) 2개. group은 6축 활성 적격 칸의 낱말(거부 사유를 ODD 밖·금지·조건 부족으로).
 * 사전에 없는 코드(기존 reject_code 등)는 reasonLabel이 '차량 보고 사유'로 두고 코드를 보조 글자로 보인다.
 */
export const VERDICT_REASON_CODES: Readonly<Record<string, { label: string; group: Exclude<EligibilityValue, 'ALLOW'> }>> = {
  ODD_OUT: { label: '현재 운행 조건 밖', group: 'ODD_OUT' },
  ODD_UNKNOWN: { label: '운행 조건 판단 불가', group: 'UNKNOWN' },
  INPUT_INVALID_OR_STALE: { label: '입력 신호 이상·오래됨', group: 'UNKNOWN' },
  ALREADY_ACTIVE: { label: '이미 실행 중', group: 'CONDITION_MISSING' },
  CONFIG_NOT_APPROVED: { label: '승인되지 않은 구성', group: 'FORBIDDEN' },
  DDT_ACTIVE: { label: '자동 주행 수행 중', group: 'CONDITION_MISSING' },
  DDT_STILL_ACTIVE: { label: '자동 주행이 아직 수행 중', group: 'CONDITION_MISSING' },
  FEATURE_HEALTH_NOT_READY: { label: '기능 건전성 미충족', group: 'CONDITION_MISSING' },
  HOLD_NOT_CONFIRMED: { label: '정지 유지 수단 미확인', group: 'CONDITION_MISSING' },
  NOT_STOPPED: { label: '정지 상태 아님', group: 'CONDITION_MISSING' },
  NO_ACTIVE_DDT_TO_HANDOVER: { label: '인계할 자동 주행 없음', group: 'CONDITION_MISSING' },
  NO_TERMINATION_INHIBIT: { label: '종료 차단 기록 없음', group: 'CONDITION_MISSING' },
  POLICY_OR_ENTITLEMENT_DENIED: { label: '정책·이용 권한 불허', group: 'FORBIDDEN' },
  PROPOSED_NOT_VEHICLE_VALIDATED: { label: '차량 검증 전 제안', group: 'FORBIDDEN' },
  RECOVERY_POWER_NOT_READY: { label: '설치·복구 전원 부족', group: 'CONDITION_MISSING' },
  RISK_MITIGATION_NOT_CONFIRMED: { label: '위험 저감 근거 미확인', group: 'CONDITION_MISSING' },
  TERMINATION_INHIBIT: { label: '종료 차단 중', group: 'FORBIDDEN' },
  UPDATE_PATH_NOT_HEALTHY: { label: '업데이트 경로 이상', group: 'CONDITION_MISSING' },
  USER_NOT_READY: { label: '운전자 준비 안 됨', group: 'CONDITION_MISSING' },
  USER_PROCEDURE_NOT_READY: { label: '사용자 절차 미완료', group: 'CONDITION_MISSING' },
};

/** 사유 코드 → 한국어 사유(주 글자). 코드는 보조 글자로 따로 보인다 */
export function reasonLabel(code: string | null | undefined): string {
  if (!code) return '';
  return VERDICT_REASON_CODES[code]?.label ?? '차량 보고 사유';
}

/** 행위 판정 → 활성 적격 낱말 — 허용=ALLOW, 거부=DENY(첫 사유의 무리: ODD 밖·금지·조건 부족), 판단 불가=UNKNOWN */
export function eligibilityOf(verdict: VerdictValue, reasonCodes: readonly string[] = []): EligibilityValue {
  if (verdict === 'ALLOW') return 'ALLOW';
  if (verdict === 'UNKNOWN') return 'UNKNOWN';
  const g = reasonCodes.map((c) => VERDICT_REASON_CODES[c]?.group).find((x) => x && x !== 'UNKNOWN');
  return g ?? 'CONDITION_MISSING';
}

// ───────────── 정책 전달·수렴(배포 상세 7구간) ─────────────

export type DeliveryStage = 'RECEIVED' | 'ACCEPTED' | 'DEFERRED' | 'APPLIED' | 'REJECTED';
export type ConvergenceBin = 'APPLIED' | 'ACCEPTED' | 'DEFERRED' | 'RECEIVED_ONLY' | 'NOT_RECEIVED' | 'REJECTED' | 'UNCONFIRMED';
/** 배타 7구간 — 적용 확인 · 수락(실행 대기) · 전달 보류 · 수신만 됨 · 미수신 · 로컬 거부 · 미확인. 합 = 대상 차량 */
export const CONVERGENCE_BINS: readonly ConvergenceBin[] = ['APPLIED', 'ACCEPTED', 'DEFERRED', 'RECEIVED_ONLY', 'NOT_RECEIVED', 'REJECTED', 'UNCONFIRMED'];

export interface DeliveryEvent {
  stage: DeliveryStage;
  /** 차량 관측 시각 */
  at: string;
  reasonCode?: string | null;
}

/**
 * 차량 한 대의 구간 — 결과 보고(적용·거부)가 있으면 그것, 없으면 마지막 중간 보고(수신·수락·전달 보류)가 기준 시간 안일 때만 그 구간,
 * 기준 시간을 넘기면 미확인(마지막 보고는 last로 남겨 회색 보조 글자). 보고가 하나도 없으면 미수신. 한 차량은 한 구간에만.
 */
export function classifyDelivery(events: readonly DeliveryEvent[], staleAfterMs: number, now: number): { bin: ConvergenceBin; last: DeliveryEvent | null } {
  const latest = (xs: readonly DeliveryEvent[]) => xs.reduce<DeliveryEvent | null>((a, e) => (!a || Date.parse(e.at) >= Date.parse(a.at) ? e : a), null);
  const applied = latest(events.filter((e) => e.stage === 'APPLIED'));
  if (applied) return { bin: 'APPLIED', last: applied };
  const rejected = latest(events.filter((e) => e.stage === 'REJECTED'));
  if (rejected) return { bin: 'REJECTED', last: rejected };
  const last = latest(events);
  if (!last) return { bin: 'NOT_RECEIVED', last: null };
  if (now - Date.parse(last.at) > staleAfterMs) return { bin: 'UNCONFIRMED', last };
  return { bin: last.stage === 'ACCEPTED' ? 'ACCEPTED' : last.stage === 'DEFERRED' ? 'DEFERRED' : 'RECEIVED_ONLY', last };
}

/** 구간별 차량 수 — 모든 구간을 0으로 채운다 */
export function convergenceCounts(bins: readonly ConvergenceBin[]): Record<ConvergenceBin, number> {
  const out = Object.fromEntries(CONVERGENCE_BINS.map((b) => [b, 0])) as Record<ConvergenceBin, number>;
  for (const b of bins) out[b]++;
  return out;
}

/** 누적 보조 줄 — 수신(어떤 보고든 있음) · 수락(수락 또는 적용 보고) */
export function cumulativeDelivery(perVehicle: readonly (readonly DeliveryEvent[])[]): { received: number; accepted: number } {
  return {
    received: perVehicle.filter((xs) => xs.length > 0).length,
    accepted: perVehicle.filter((xs) => xs.some((e) => e.stage === 'ACCEPTED' || e.stage === 'APPLIED')).length,
  };
}

// ───────────── 주문 추적(사용 준비 확인) ─────────────

export type ConditionState = 'CONFIRMED' | 'FAILED' | 'UNCONFIRMED';
/** 사용 준비 4조건 — 권리 ACTIVE · 형상 호환 · 정책 적용 ACK(수신 아님) · 차량 준비 보고(관측 신선도 최신 확인, 주문 이후 보고) */
export interface ReadyConditions {
  entitlement: ConditionState;
  config: ConditionState;
  policyApplied: ConditionState;
  vehicleReady: ConditionState;
}
export const READY_CONDITION_KEYS: readonly (keyof ReadyConditions)[] = ['entitlement', 'config', 'policyApplied', 'vehicleReady'];

/** 사용 준비 확인 판정 — 이 함수 하나(주문 추적·지표 계약이 같이 쓴다). 네 조건이 모두 확인일 때만 */
export function isReadyConfirmed(c: ReadyConditions): boolean {
  return READY_CONDITION_KEYS.every((k) => c[k] === 'CONFIRMED');
}

/** 정책 전달 단계 → 정책 적용 조건 — 적용 회신만 확인, 수신·수락은 미확인, 거부는 실패 */
export function policyAppliedOf(stage: DeliveryStage | null | undefined): ConditionState {
  return stage === 'APPLIED' ? 'CONFIRMED' : stage === 'REJECTED' ? 'FAILED' : 'UNCONFIRMED';
}

export type OrderStatus = 'PAID' | 'CANCELLED' | 'REFUNDED';
export type OrderBin = 'READY' | 'UNCONFIRMED' | 'OFFLINE' | 'PARTIAL' | 'CANCELLED' | 'REFUNDED';
/** 배타 6구간 — 사용 준비 확인 · 미확인 · 오프라인 · 부분 실패 · 취소 · 환불. 합 = 주문 수 */
export const ORDER_BINS: readonly OrderBin[] = ['READY', 'UNCONFIRMED', 'OFFLINE', 'PARTIAL', 'CANCELLED', 'REFUNDED'];

export interface OrderFacts {
  status: OrderStatus;
  paidAt: string;
  /** 차량 보고와 무관한 조건(권리·형상) */
  entitlement: ConditionState;
  config: ConditionState;
  policyStage: DeliveryStage | null;
  /** 차량 준비 보고 — 시각과 결과(준비됨/실패) */
  readyReport: { at: string; ok: boolean } | null;
  /** 그 차량·Feature의 관측 신선도 */
  freshness: FreshnessState;
}

/** 차량 준비 조건 — 주문 이후 보고 ∧ 최신 확인일 때만 확인. 주문 전 보고는 준비로 세지 않는다 */
export function orderConditions(o: OrderFacts): { conditions: ReadyConditions; preOrderReport: boolean } {
  const r = o.readyReport;
  const preOrderReport = !!r && Date.parse(r.at) < Date.parse(o.paidAt);
  const vehicleReady: ConditionState = !r || preOrderReport || o.freshness !== 'FRESH' ? 'UNCONFIRMED' : r.ok ? 'CONFIRMED' : 'FAILED';
  return { conditions: { entitlement: o.entitlement, config: o.config, policyApplied: policyAppliedOf(o.policyStage), vehicleReady }, preOrderReport };
}

/**
 * 주문 구간 — 취소·환불 → 그 구간, 4조건 확인 → 사용 준비 확인, 차량 오프라인 → 오프라인,
 * 조건 하나라도 실패 보고(나머지 일부 확인) → 부분 실패, 그 밖 → 미확인. 기한 초과는 구간이 아니라 따로(overdue).
 */
export function classifyOrder(o: OrderFacts, now: number, deadlineMs: number = READY_DEADLINE_DEFAULT_MS) {
  const { conditions, preOrderReport } = orderConditions(o);
  const ready = isReadyConfirmed(conditions);
  const bin: OrderBin =
    o.status === 'CANCELLED' ? 'CANCELLED' : o.status === 'REFUNDED' ? 'REFUNDED' : ready ? 'READY' : o.freshness === 'OFFLINE' ? 'OFFLINE' : READY_CONDITION_KEYS.some((k) => conditions[k] === 'FAILED') ? 'PARTIAL' : 'UNCONFIRMED';
  const deadlineAt = Date.parse(o.paidAt) + deadlineMs;
  const open = bin === 'UNCONFIRMED' || bin === 'OFFLINE' || bin === 'PARTIAL';
  const overdueMs = open && now > deadlineAt ? now - deadlineAt : 0;
  /** 결제 직후 차량 보고가 아직 없음 — '주문 성공 · 활성 미확인' */
  const justPaid = bin === 'UNCONFIRMED' && !o.readyReport && overdueMs === 0;
  return { bin, conditions, ready, preOrderReport, overdue: overdueMs > 0, overdueMs, deadlineAt: new Date(deadlineAt).toISOString(), justPaid };
}

// ───────────── 고객에게 보이는 상태(운영자 상태 → 고객 문구 대응표, 고객 API·미리보기 공용) ─────────────

/** KST 월-일 시:분 — 고객 문구의 시각 */
export function kstShort(at: string): string {
  const d = new Date(Date.parse(at) + 9 * 3600_000).toISOString();
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
}

export const CUSTOMER_TEXT = {
  offline: (at: string) => `오프라인 — 마지막 확인 ${at}, 현재 상태 미확인`,
  stale: (at: string) => `마지막 확인 ${at}, 현재 상태 미확인`,
  never: '차량 보고 이력이 없어 현재 상태 미확인',
  canUse: {
    READY: '지금 사용할 수 있습니다',
    ODD_OUT: (owned: string) => `${owned} · 현재 운행 조건에서 사용 불가`,
    RESTRICTED: '안전 점검으로 지금은 사용이 제한됩니다',
    NOT_OWNED: '아직 이용 권한이 없습니다',
    EXPIRED: '이용 기간이 끝났습니다',
    NOT_READY: '사용 준비 확인 전입니다',
    UNDECIDABLE: '차량이 지금 사용 가능 여부를 판단하지 못했습니다',
    CONDITION: (owned: string) => `${owned} · 현재 사용 조건이 맞지 않아 사용 불가`,
  },
  restriction: (reason: string) => `사용 제한 사유: ${reason} · 대체 이용: 운전자 직접 운전`,
  when: {
    NOW: '지금',
    CONDITIONAL: '예정 · 조건부 — 차량 설치 확인과 사용 준비 확인 뒤',
    AFTER_CHECK: '차량 확인 뒤 알려 드립니다',
    INSTALL_NOT_LINKED: '설치 상태 연동 전',
  },
  price: {
    owned: (product: string, kind: string, until: string | null) => `${product} · ${kind}${until ? ` · ${until}까지` : ''}`,
    none: (product: string) => `구매 전 · ${product}`,
    unknown: '연결된 상품 정보 없음',
  },
  support: {
    GUIDE: '원격 확인 후 가까운 정비 거점으로 안내합니다',
    ROUTE_ONLY: '지원 경로 안내만',
  },
  notify: (at: string) => `사용 가능 알림 근거: 차량 준비 확인 ${at}`,
} as const;

export type CustomerAxis = 'ENTITLEMENT' | 'INSTALL' | 'DELIVERY' | 'ELIGIBILITY' | 'RUNTIME' | 'FRESHNESS';
export const CUSTOMER_AXES: readonly CustomerAxis[] = ['ENTITLEMENT', 'INSTALL', 'DELIVERY', 'ELIGIBILITY', 'RUNTIME', 'FRESHNESS'];

export interface CustomerInput {
  freshness: FreshnessState;
  observedAt: string | null;
  entitlement: EntitlementAxis;
  install: InstallAxis;
  /** 최신 확인일 때만 값(그 밖 null) */
  eligibility: EligibilityValue | null;
  eligibilityReason: string | null;
  runtime: RuntimeState | null;
  /** 원격 종료(긴급 차단) 대상 */
  restricted: boolean;
  product: { name: string; kind: string; until: string | null } | null;
}

export interface CustomerAnswer {
  text: string;
  /** 자리 고정 보조 줄(제한 사유·대체 이용 / 설치 칸 / 지원 경로) */
  sub: string | null;
  basis: CustomerAxis[];
}

/**
 * 6축 → 고객 4질문 — 미확인은 단정하지 않는다. 오프라인·기준 시간 초과면 답 대신 한 줄(unconfirmedLine)만.
 * 원격 종료 대상은 제한 문구와 시각 없는 조건만 — 종료 끝·재사용 시각을 약속하지 않는다.
 */
export function customerProjection(i: CustomerInput): { unconfirmedLine: string | null; canUse: CustomerAnswer; when: CustomerAnswer; price: CustomerAnswer; support: CustomerAnswer } {
  const T = CUSTOMER_TEXT;
  const at = i.observedAt ? kstShort(i.observedAt) : null;
  const unconfirmedLine = i.freshness === 'FRESH' ? null : i.freshness === 'UNOBSERVED' || !at ? T.never : i.freshness === 'OFFLINE' ? T.offline(at) : T.stale(at);
  const owned = i.entitlement === 'TRIAL' || i.entitlement === 'PURCHASED';
  const ownedWord = i.entitlement === 'TRIAL' ? '체험 중' : '구매됨';
  const ready = i.freshness === 'FRESH' && i.eligibility === 'ALLOW' && (i.runtime === 'AVAILABLE' || i.runtime === 'ACTIVE') && owned;
  let canUse: CustomerAnswer;
  if (i.restricted) canUse = { text: T.canUse.RESTRICTED, sub: T.restriction('안전 점검'), basis: ['DELIVERY', 'RUNTIME'] };
  else if (i.entitlement === 'NONE' || i.entitlement === 'NOT_LINKED') canUse = { text: T.canUse.NOT_OWNED, sub: null, basis: ['ENTITLEMENT'] };
  else if (i.entitlement === 'EXPIRED') canUse = { text: T.canUse.EXPIRED, sub: null, basis: ['ENTITLEMENT'] };
  else if (ready) canUse = { text: T.canUse.READY, sub: null, basis: ['ENTITLEMENT', 'ELIGIBILITY', 'RUNTIME'] };
  else if (i.eligibility === 'ODD_OUT') canUse = { text: T.canUse.ODD_OUT(ownedWord), sub: T.restriction(i.eligibilityReason ?? '현재 운행 조건 밖'), basis: ['ENTITLEMENT', 'ELIGIBILITY'] };
  else if (i.eligibility === 'UNKNOWN') canUse = { text: T.canUse.UNDECIDABLE, sub: null, basis: ['ELIGIBILITY'] };
  else if (i.eligibility === 'FORBIDDEN' || i.eligibility === 'CONDITION_MISSING') canUse = { text: T.canUse.CONDITION(ownedWord), sub: i.eligibilityReason ? T.restriction(i.eligibilityReason) : null, basis: ['ENTITLEMENT', 'ELIGIBILITY'] };
  else canUse = { text: T.canUse.NOT_READY, sub: null, basis: ['ENTITLEMENT', 'INSTALL', 'RUNTIME'] };
  const when: CustomerAnswer = i.restricted
    ? { text: T.when.AFTER_CHECK, sub: null, basis: ['RUNTIME'] }
    : ready
      ? { text: T.when.NOW, sub: null, basis: ['RUNTIME', 'FRESHNESS'] }
      : { text: T.when.CONDITIONAL, sub: i.install === 'NOT_LINKED' ? T.when.INSTALL_NOT_LINKED : null, basis: ['INSTALL', 'RUNTIME'] };
  const p = i.product;
  const price: CustomerAnswer = { text: !p ? T.price.unknown : owned ? T.price.owned(p.name, p.kind, p.until) : T.price.none(p.name), sub: null, basis: ['ENTITLEMENT'] };
  const support: CustomerAnswer = { text: T.support.GUIDE, sub: T.support.ROUTE_ONLY, basis: ['FRESHNESS'] };
  return { unconfirmedLine, canUse, when, price, support };
}

/**
 * 상태 조합 문구(판정 탭·고객 대응표가 같은 문구) — 복구 기록이 있으면 '복구 검증 완료 · 종료 차단 해제', 없으면 권리 낱말, 끝에 활성화 판정.
 * '복구 완료'(사용 가능으로 오해)는 쓰지 않는다. 판정 보고가 기준 시간을 넘겼으면 '현재 활성화 미확인'.
 */
export function stateComboText(i: {
  entitlement: EntitlementAxis;
  restore: { integrity: 'OK' | 'FAILED'; inhibitReleased: boolean } | null;
  activation: { verdict: VerdictValue; reasonCodes: readonly string[]; stale: boolean } | null;
}): string {
  const ent: Record<EntitlementAxis, string | null> = { PURCHASED: '구매됨', TRIAL: '체험 중', EXPIRED: '이용 기간 끝남', NONE: '이용 권한 없음', TRANSFER_REVIEW: '이전 심사', NOT_LINKED: null };
  const head = i.restore ? (i.restore.integrity === 'OK' ? (i.restore.inhibitReleased ? '복구 검증 완료 · 종료 차단 해제' : '복구 검증 완료') : '복구 검증 대기') : ent[i.entitlement];
  const a = i.activation;
  const tail = !a || a.stale ? '현재 활성화 미확인' : a.verdict === 'ALLOW' ? '현재 활성화 가능' : a.verdict === 'UNKNOWN' ? '현재 활성화 판단 불가' : eligibilityOf('DENY', a.reasonCodes) === 'ODD_OUT' ? '현재 운행 조건에서 사용 불가' : '현재 활성화 불가';
  return head ? `${head} · ${tail}` : tail;
}

// ───────────── 응답 타입(화면은 TS 타입으로 읽는다) ─────────────

export interface FreshnessView {
  state: FreshnessState;
  observedAt: string | null;
  receivedAt: string | null;
  offlineSince: string | null;
  staleAfterMs: number;
  /** 기준 시간이 가정값인가 */
  assumed: boolean;
  /** 재연결 직후 — 미확인 기간과 재연결 시각 */
  reconnect: { at: string; gapMs: number } | null;
}

export interface VehicleFeatureAxes {
  featureId: string;
  version: string;
  name: string;
  featureClass: FeatureClass;
  simulated: boolean;
  freshness: FreshnessView;
  entitlement: { value: EntitlementAxis; grantId: string | null; catalogId: string | null; orderId: string | null };
  install: { value: InstallAxis; otaStage: OtaStage | null; configMatch: boolean | null; configRef: string | null };
  delivery: { stage: DeliveryStage | 'PUBLISHED' | null; bin: ConvergenceBin | null; publicationId: string | null; at: string | null; reasonCode: string | null };
  eligibility: { current: EligibilityValue | null; past: EligibilityValue | null; reasonCode: string | null; at: string | null };
  runtime: { current: RuntimeState | null; past: RuntimeState | null; ddtOwner: DdtOwner | null };
}
export interface VehicleFeatureStateView {
  vin: string;
  now: string;
  features: VehicleFeatureAxes[];
  /** 현재 상태 미확인 기능(관측 신선도가 최신 확인이 아님) */
  unconfirmed: number;
}

export interface ConvergenceVehicle {
  vin: string;
  bin: ConvergenceBin;
  lastStage: DeliveryStage | null;
  at: string | null;
  reasonCode: string | null;
}
export interface ConvergenceView {
  publicationId: string;
  kind: string;
  featureId: string;
  featureName: string | null;
  flagKey: string | null;
  status: string;
  total: number;
  staleAfterMs: number;
  assumed: boolean;
  bins: Record<ConvergenceBin, number>;
  /** 적용 확인 안 된 차량 = 대상 − 적용 확인 */
  notApplied: number;
  cumulative: { received: number; accepted: number };
  vehicles: ConvergenceVehicle[];
}

export interface VerdictRow {
  featureId: string;
  featureName: string;
  action: VerdictAction;
  verdict: VerdictValue;
  reasonCodes: string[];
  observedAt: string;
  receivedAt: string;
  /** 판정 보고가 기준 시간을 넘김 — 행 전체 미확인 */
  stale: boolean;
  staleAfterMs: number;
  simulated: boolean;
  sessionId: string | null;
}
export interface VehicleVerdictsView {
  vin: string;
  now: string;
  items: VerdictRow[];
  /** 상태 조합 문구 — Feature별 */
  combos: { featureId: string; text: string }[];
  /** 범위 안인데 판정 보고가 하나도 없는 Feature — 빈 목록이 아니라 '판정 미확인'으로 따로(허용으로 세지 않음) */
  unreported: { featureId: string; featureName: string; staleAfterMs: number }[];
}

export interface AxisDistribution {
  featureId: string;
  version: string;
  name: string;
  featureClass: FeatureClass;
  total: number;
  staleAfterMs: number;
  assumed: boolean;
  /** 축별 배타 분포(값 → 차량 수, 미확인 포함 합 = total). 미확인 키는 'UNCONFIRMED' */
  axes: Record<CustomerAxis, Record<string, number>>;
  /** 실제 실행 미확인 차량 */
  unconfirmedRuntime: number;
  /** 활성화 판정 사유 분포(배타, 합 = total) — 거부·판단 불가 사유 코드 · 허용 · 미확인 */
  reasons: { key: string; code: string | null; verdict: VerdictValue | 'NONE'; count: number }[];
}
export interface FleetAxisView {
  now: string;
  features: { featureId: string; version: string; name: string; featureClass: FeatureClass; total: number; unconfirmedRuntime: number }[];
  defaultFeatureId: string | null;
  selected: AxisDistribution | null;
}

export interface CustomerFeatureState {
  featureId: string;
  name: string;
  lastConfirmedAt: string | null;
  freshness: FreshnessState;
  unconfirmedLine: string | null;
  answers: { canUse: CustomerAnswer; when: CustomerAnswer; price: CustomerAnswer; support: CustomerAnswer };
  notifyBasis: string | null;
  /** 지난 확인 이후 바뀐 점 — 국가 이동·소유권 이전은 그 기능 전 null */
  changes: { axis: CustomerAxis; before: string; after: string; reason: string }[];
  entitlement: null;
  marketChange: null;
  ownershipTransfer: null;
  restricted: boolean;
  killId: string | null;
}
export interface CustomerStateView {
  vin: string;
  now: string;
  features: CustomerFeatureState[];
}

export type OrderStageKey = 'ORDER' | 'ENTITLEMENT' | 'POLICY' | 'READY' | 'USAGE';
export interface OrderStage {
  key: OrderStageKey;
  at: string | null;
  state: ConditionState;
  optional: boolean;
}
export interface OrderRow {
  orderId: string;
  vin: string;
  catalogId: string;
  catalogName: string | null;
  featureId: string;
  entitlementId: string | null;
  status: OrderStatus;
  paidAt: string;
  bin: OrderBin;
  overdue: boolean;
  overdueMs: number;
  deadlineAt: string;
  justPaid: boolean;
  preOrderReport: boolean;
  conditions: ReadyConditions;
  stages: OrderStage[];
  refund: { requestedAt: string; completedAt: string | null } | null;
  simulated: boolean;
}
export interface OrdersView {
  now: string;
  deadlineMs: number;
  assumed: boolean;
  total: number;
  counts: Record<OrderBin, number>;
  /** 기한 넘긴 사용 준비 미확인(미확인·오프라인·부분 실패) */
  overdueUnready: number;
  overdueBreakdown: { UNCONFIRMED: number; OFFLINE: number; PARTIAL: number };
  simulated: boolean;
  items: OrderRow[];
}
export type OrderEventKind = 'PAID' | 'ENTITLEMENT' | 'POLICY' | 'READY_REPORT' | 'USAGE' | 'REFUND_REQUESTED' | 'REFUND_COMPLETED';
export interface OrderTimelineView {
  order: OrderRow;
  /** 차량 시각과 서버 시각을 나눈 단계 기록 — detail: 정책 전달 단계·근거 ID, preOrder: 주문 전 보고(준비로 세지 않음) */
  events: { key: string; kind: OrderEventKind; vehicleAt: string | null; serverAt: string | null; detail: string | null; preOrder: boolean; warn: boolean }[];
}
