// 차량 상태 보고 2.1 — 수신 검사에 더하는 계약 검사, 실제 실행 투영, 제어 책임 공백·복구 미검증 판정, Feature epoch, 서버 의도 대조(ADS-BE01·BE07·FFP-F031).
// 플랫폼(D04-03)과 내부 차량 시뮬레이터(D02-03)가 같은 규칙을 쓴다. 기준값(보고 간격 예산)은 차량 팀 확정 전 가정값(D-ADS-5)이고 승인되면 기능별 상태 프로필이 덮어쓴다.
import type { GuardState } from '../schemas/safety';
import type { SafetyDecision, StatusReportV2_1 } from '../schemas/wire';
import type { DdtOwner, FeatureClass, RuntimeState } from './ads-state';

// ───────────── 기능별 상태 프로필 ─────────────

/** 종료 진행 중 보고 간격 예산 기본값(가정값) — ADS-BE14 위험 시간 예산이 승인되면 그 값으로 바꾼다 */
export const REPORT_BUDGET_DEFAULT_MS: Readonly<Record<FeatureClass, number>> = { ADS: 2000, ADAS: 5000, QM: 60_000 };
const ALL_STATES: readonly RuntimeState[] = ['INACTIVE', 'AVAILABLE', 'ACTIVE', 'IN_TRANSITION', 'MRC', 'TERMINATED', 'RECOVERY_PENDING'];

export interface FeatureStateProfile {
  featureClass: FeatureClass;
  /** 이 기능이 보고할 수 있는 실제 실행 상태 — 밖이면 수신 검사에서 거부 */
  allowedStates: readonly RuntimeState[];
  reportBudgetMs: number;
  budgetStatus: 'ASSUMED' | 'APPROVED';
  /** PROFILE = 기능별 상태 프로필 표, DEFAULT = 등급 기본값 */
  source: 'PROFILE' | 'DEFAULT';
}

/** 등급 기본 프로필 — MRC는 ADS 기능만(비 ADS 기능의 MRC 보고는 거부) */
export function defaultStateProfile(featureClass: FeatureClass): FeatureStateProfile {
  return { featureClass, allowedStates: featureClass === 'ADS' ? ALL_STATES : ALL_STATES.filter((s) => s !== 'MRC'), reportBudgetMs: REPORT_BUDGET_DEFAULT_MS[featureClass], budgetStatus: 'ASSUMED', source: 'DEFAULT' };
}

// ───────────── 계약 검사(스키마 다음) ─────────────

/** 상업 상태 신호 — 판정 입력(decision.inputs)에 넣지 않는다(commercial 블록만) */
export const COMMERCIAL_SIGNAL = /^(entitlement|commercial|subscription|purchase|billing|payment)/;

/** 판정 입력 중 무효(valid=false·UNTRUSTED)와 노후(관측 시각 − 입력 시각 > 허용 나이) 신호 */
export function inputProblems(d: Pick<SafetyDecision, 'inputs'>, observedAt: string): { invalid: string[]; stale: string[] } {
  const at = Date.parse(observedAt);
  const invalid = d.inputs.filter((i) => !i.valid || i.trust === 'UNTRUSTED').map((i) => i.signal);
  const stale = d.inputs.filter((i) => at - Date.parse(i.local_ts) > i.max_age_ms).map((i) => i.signal);
  return { invalid, stale };
}

export interface V21Violation {
  code: 'COMMERCIAL_INPUT' | 'ALLOW_WITH_INVALID_INPUT' | 'ALLOW_OUTSIDE_ODD' | 'REASON_CODE_INCONSISTENT' | 'MRC_NOT_ALLOWED' | 'STATE_NOT_IN_PROFILE';
  message: string;
}

/**
 * 2.1 계약 검사 — 하나라도 노후·무효 입력이면 ALLOW 금지, ODD 밖 ALLOW 금지, 거부 사유는 ODD 밖(ODD_OUT)과 입력 이상(INPUT_INVALID_OR_STALE)을 따로 적는다,
 * 상업 상태는 판정 입력이 아니다. 걸리면 수신 검사의 스키마 단계 위반(확인 집계 제외·이상 징후).
 */
export function contractViolationV21(r: StatusReportV2_1): V21Violation | null {
  const d = r.decision;
  if (!d) return null;
  const commercial = d.inputs.filter((i) => COMMERCIAL_SIGNAL.test(i.signal)).map((i) => i.signal);
  if (commercial.length) return { code: 'COMMERCIAL_INPUT', message: `상업 상태(${commercial.join(', ')})를 판정 입력에 넣었습니다 — commercial 블록으로만 보고합니다` };
  const p = inputProblems(d, r.observed_at);
  const bad = [...new Set([...p.invalid, ...p.stale])];
  const oddInputExpired = !!d.odd_input_valid_until && Date.parse(d.odd_input_valid_until) < Date.parse(r.observed_at);
  if (d.verdict === 'ALLOW') {
    if (bad.length || d.input_quality === 'INVALID' || oddInputExpired)
      return { code: 'ALLOW_WITH_INVALID_INPUT', message: `노후·무효 입력(${bad.join(', ') || (oddInputExpired ? 'ODD 입력 유효 기간 지남' : '입력 품질 INVALID')})이 있는데 허용으로 판정했습니다` };
    if (d.odd_state !== 'IN') return { code: 'ALLOW_OUTSIDE_ODD', message: `운행 조건 ${d.odd_state}에서 허용으로 판정했습니다` };
    return null;
  }
  if (d.verdict === 'DENY' && !d.reason_codes.length) return { code: 'REASON_CODE_INCONSISTENT', message: '거부 판정에 사유 코드가 없습니다' };
  if (d.odd_state === 'OUT' && !d.reason_codes.includes('ODD_OUT')) return { code: 'REASON_CODE_INCONSISTENT', message: '운행 조건 밖(odd_state OUT)인데 사유에 ODD_OUT이 없습니다' };
  if ((bad.length || d.input_quality === 'INVALID') && !d.reason_codes.includes('INPUT_INVALID_OR_STALE'))
    return { code: 'REASON_CODE_INCONSISTENT', message: `입력 이상(${bad.join(', ') || '입력 품질 INVALID'})인데 사유에 INPUT_INVALID_OR_STALE가 없습니다` };
  return null;
}

/** 기능 프로필 검사(대상 단계) — MRC는 ADS 기능만, 실제 실행 상태는 프로필 안 값만 */
export function profileViolationV21(r: StatusReportV2_1, profile: FeatureStateProfile): V21Violation | null {
  if ((r.mrc || r.runtime_state === 'MRC' || r.decision?.action === 'MRC') && profile.featureClass !== 'ADS')
    return { code: 'MRC_NOT_ALLOWED', message: `${profile.featureClass} 기능은 MRC를 보고하지 않습니다 — MRC는 ADS 기능만` };
  if (!profile.allowedStates.includes(r.runtime_state)) return { code: 'STATE_NOT_IN_PROFILE', message: `실제 실행 상태 ${r.runtime_state}은(는) 이 기능의 상태 프로필에 없습니다` };
  return null;
}

/** STALE_EPOCH 거부 코드의 조치 — 보안 사건이 아니라 새 게시본이 필요(늦게 도착한 과거 게시본) */
export const STALE_EPOCH_ACTION = { kind: 'NEW_COMMAND', retry: false, security: false } as const;

// ───────────── 실제 실행 투영 ─────────────

/** MRC 달성 = 도달 시각 + 정지 유지 수단 + 위험 저감 근거. 하나라도 비면 미달성(종료 완료와 MRC는 따로 센다) */
export function mrcAchieved(r: Pick<StatusReportV2_1, 'mrc'>): boolean {
  return !!r.mrc && !!r.mrc.hold_means && !!r.mrc.risk_mitigation_ref;
}

/** 읽기 모델에 기록할 실제 실행 상태 — MRC 미달성 보고는 MRC로 세지 않고 전환 중으로 둔다 */
export function projectedRuntime(r: Pick<StatusReportV2_1, 'runtime_state' | 'mrc'>): RuntimeState {
  return r.runtime_state === 'MRC' && !mrcAchieved(r) ? 'IN_TRANSITION' : r.runtime_state;
}

/** 차량 Guard 상태 → 실제 실행 상태(시뮬레이터가 2.1 보고에 쓴다) */
export function guardRuntimeState(s: GuardState): RuntimeState {
  switch (s) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'INACTIVE':
    case 'FAULT':
    case 'UNKNOWN':
      return 'INACTIVE';
    case 'DISABLED':
      return 'TERMINATED';
    case 'RESTORE_PENDING':
      return 'RECOVERY_PENDING';
    default:
      return 'IN_TRANSITION';
  }
}

// ───────────── 제어 책임 공백(RESPONSIBILITY_GAP) ─────────────

export interface OwnerObservation {
  at: string;
  ddtOwner: DdtOwner | null;
  runtimeState: RuntimeState;
}
export interface ResponsibilityGap {
  /** 공백을 드러낸 보고의 위치(입력 순서) */
  index: number;
  kind: 'OWNER_GAP' | 'REPORT_INTERVAL';
  at: string;
  episodeStart: string;
  intervalMs: number | null;
}

const ENDED: readonly RuntimeState[] = ['MRC', 'TERMINATED', 'INACTIVE'];

/**
 * 종료 진행(ADS가 DDT를 넘기기 시작한 뒤 끝 상태까지) 중 — 주체가 NONE·UNKNOWN인 보고(끝 상태 보고 제외)면 OWNER_GAP, 보고 간격이 예산을 넘으면 REPORT_INTERVAL.
 * 한 진행 구간에 종류마다 1건. ADS→UNKNOWN→MRC = 1건, ADS→FALLBACK→MRC = 0건. 운전자 인계(USER)·ADS 복귀·끝 상태에서 구간이 끝난다.
 */
export function responsibilityGaps(seq: readonly OwnerObservation[], budgetMs: number): ResponsibilityGap[] {
  const xs = seq.map((o, index) => ({ ...o, index })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.index - b.index);
  const out: ResponsibilityGap[] = [];
  let episode: { start: string; owner: boolean; interval: boolean } | null = null;
  let prev: (typeof xs)[number] | null = null;
  for (const x of xs) {
    const starts = !episode && prev?.ddtOwner === 'ADS' && (x.ddtOwner !== 'ADS' || x.runtimeState === 'IN_TRANSITION');
    if (starts) episode = { start: x.at, owner: false, interval: false };
    if (episode) {
      const ended = ENDED.includes(x.runtimeState);
      if (!episode.owner && !ended && (x.ddtOwner === 'NONE' || x.ddtOwner === 'UNKNOWN' || x.ddtOwner === null)) {
        episode.owner = true;
        out.push({ index: x.index, kind: 'OWNER_GAP', at: x.at, episodeStart: episode.start, intervalMs: null });
      }
      // 간격은 구간 시작 보고 뒤부터 — 시작 보고와 그 앞 ADS 보고 사이는 정상 운행 간격
      if (!starts && !episode.interval && prev && Date.parse(x.at) - Date.parse(prev.at) > budgetMs) {
        episode.interval = true;
        out.push({ index: x.index, kind: 'REPORT_INTERVAL', at: x.at, episodeStart: episode.start, intervalMs: Date.parse(x.at) - Date.parse(prev.at) });
      }
      if (ended || x.ddtOwner === 'USER' || (x.ddtOwner === 'ADS' && x.runtimeState === 'ACTIVE')) episode = null;
    }
    prev = x;
  }
  return out;
}

// ───────────── 재시동 복구 검증(RESTORE_UNVERIFIED) ─────────────

export interface RestoreVerdict {
  /** 이전 보고 뒤 재시동했는가 — 그러면 restore 블록이 필요하다 */
  required: boolean;
  verified: boolean;
  code: null | 'RESTORE_MISSING' | 'INTEGRITY_FAILED' | 'INHIBIT_NOT_RESTORED';
  /** 서버가 건 종료 차단 중 차량이 다시 걸지 않은 것 */
  missing: string[];
}

/** 재시동 뒤 복구 — restore 누락·무결성 실패·서버 차단 ⊄ 다시 건 차단이면 미검증(활성 집계 제외·사건) */
export function restoreVerdict(i: { newBoot: boolean; restore: StatusReportV2_1['restore'] | undefined; serverInhibits: readonly string[] }): RestoreVerdict {
  if (!i.newBoot) return { required: false, verified: true, code: null, missing: [] };
  if (!i.restore) return { required: true, verified: false, code: 'RESTORE_MISSING', missing: [...i.serverInhibits] };
  const restored = i.restore.inhibits_restored;
  const missing = i.serverInhibits.filter((x) => !restored.includes(x));
  if (i.restore.integrity !== 'OK') return { required: true, verified: false, code: 'INTEGRITY_FAILED', missing };
  if (missing.length) return { required: true, verified: false, code: 'INHIBIT_NOT_RESTORED', missing };
  return { required: true, verified: true, code: null, missing: [] };
}

// ───────────── Feature epoch(ADS-BE07) ─────────────

/** 차량이 본 Feature epoch보다 낮은 게시본 = 늦게 도착한 과거 게시본(KILL 뒤 과거 ON 등) — 차단 상태와 무관하게 거부 */
export function staleEpoch(publicationEpoch: number | undefined, seenEpoch: number | undefined): boolean {
  return (publicationEpoch ?? 0) < (seenEpoch ?? 0);
}

// ───────────── 서버 의도 ↔ 차량 보고 대조 ─────────────

export interface ReconcileIntent {
  /** 서버의 Feature epoch(긴급 차단마다 하나씩 올라간다) */
  epoch: number;
  /** 서버가 이 차량·Feature에 건 종료 차단 */
  inhibits: readonly string[];
}
export interface ReconcileReported {
  featureEpoch: number;
  inhibits: readonly string[];
  observedAt: string;
  offlineSince: string | null;
}
export type ReconcileMismatchKind = 'NOT_REPORTED' | 'EPOCH_BEHIND' | 'INHIBIT_MISSING' | 'INHIBIT_EXTRA';
export interface ReconcileMismatch {
  kind: ReconcileMismatchKind;
  ref: string | null;
  expected: string | number | null;
  reported: string | number | null;
}

/**
 * 재연결 대조 — 서버 의도(차단·epoch)와 차량의 마지막 2.1 보고. 보고가 오프라인 기간 뒤면 미확인 기간 = 오프라인 시작 ~ 재연결 보고 관측 시각.
 * 서버 의도가 없고(epoch 0·차단 없음) 보고도 없으면 불일치가 없다.
 */
export function reconcileFeature(intent: ReconcileIntent, reported: ReconcileReported | null): { mismatches: ReconcileMismatch[]; unconfirmed: { from: string; to: string } | null } {
  if (!reported) return { mismatches: intent.epoch > 0 || intent.inhibits.length ? [{ kind: 'NOT_REPORTED', ref: null, expected: intent.epoch, reported: null }] : [], unconfirmed: null };
  const out: ReconcileMismatch[] = [];
  if (reported.featureEpoch < intent.epoch) out.push({ kind: 'EPOCH_BEHIND', ref: null, expected: intent.epoch, reported: reported.featureEpoch });
  for (const x of intent.inhibits) if (!reported.inhibits.includes(x)) out.push({ kind: 'INHIBIT_MISSING', ref: x, expected: x, reported: null });
  for (const x of reported.inhibits) if (!intent.inhibits.includes(x)) out.push({ kind: 'INHIBIT_EXTRA', ref: x, expected: null, reported: x });
  const unconfirmed = reported.offlineSince && Date.parse(reported.offlineSince) < Date.parse(reported.observedAt) ? { from: reported.offlineSince, to: reported.observedAt } : null;
  return { mismatches: out, unconfirmed };
}
