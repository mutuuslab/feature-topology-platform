// OTA 설치 계약 (IF-05 설치 보고 — ADS-OTA01 · FFP-F037·F038·F039) — 순수 규칙(zod 없음). 본문 스키마는 schemas/ota-install.ts
// OTA는 외부 위임(D7) — SW 설치 진행은 OTA 원장의 사실이고 FF는 그 보고를 받아 단계·보류·실패 원인·안전 상태 증거를 보인다.
// '설치 확인됨'은 OTA 보고만으로 정하지 않는다 — 차량 형상 보고(ATTESTATION vehicleConfig)가 설치 매니페스트와 맞아야 한다(manifest 단독 완료 0건).
// 복구 뒤에는 승인 구성 조합(ADS-BE10)으로 다시 대조해 조합 밖이면 활성 적격 '조건 부족'.

/** 선형 5단계 — 설치 전 · 다운로드됨 · 설치 준비 · 설치 중 · 설치 확인됨 */
export const INSTALL_LINEAR = ['NOT_STARTED', 'DOWNLOADED', 'READY', 'INSTALLING', 'INSTALLED'] as const;
/** 갈림 상태 — 단계가 아니라 현재 단계 옆 사유 줄(설치 보류 · 실패 · 복구 · 정지 유지 · 정비 필요) */
export const INSTALL_BRANCHES = ['DEFERRED', 'FAILED', 'RECOVERING', 'SAFE_STATE_HELD', 'SERVICE_REQUIRED'] as const;
export const INSTALL_STAGES = [...INSTALL_LINEAR, ...INSTALL_BRANCHES] as const;
export type InstallStage = (typeof INSTALL_STAGES)[number];
export type InstallBranch = (typeof INSTALL_BRANCHES)[number];
export const INSTALL_STAGE_LABEL: Record<InstallStage, string> = {
  NOT_STARTED: '설치 전',
  DOWNLOADED: '다운로드됨',
  READY: '설치 준비',
  INSTALLING: '설치 중',
  INSTALLED: '설치 확인됨',
  DEFERRED: '설치 보류',
  FAILED: '실패',
  RECOVERING: '복구',
  SAFE_STATE_HELD: '정지 유지',
  SERVICE_REQUIRED: '정비 필요',
};
export const DEFER_REASONS = ['POWER', 'HOLD', 'DDT'] as const;
export type DeferReason = (typeof DEFER_REASONS)[number];
export const DEFER_REASON_LABEL: Record<DeferReason, string> = { POWER: '전원 부족', HOLD: '정지 유지 불충족', DDT: '주행 과업 수행 중' };
export const FAILURE_KINDS = ['POWER', 'LINK', 'VERIFY'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];
export const FAILURE_KIND_LABEL: Record<FailureKind, string> = { POWER: '전원', LINK: '통신', VERIFY: '검증' };

/** 설치 보고 기준 시간 — 넘기면 현재 단계 대신 '미확인 · 마지막 보고' */
export const INSTALL_REPORT_STALE_MS = 2 * 3600_000;
/** 설치 사전조건 — 배터리 최소(%) */
export const INSTALL_MIN_SOC = 20;

export interface InstallSchedule {
  windowFrom: string;
  windowTo: string;
  estDurationMin: number;
  driveRestriction: boolean;
}
export interface InstallRecord {
  installId: string;
  vin: string;
  stage: InstallStage;
  at: string;
  source: 'OTA_SERVER' | 'SIMULATED';
  campaignId?: string | null;
  schedule?: InstallSchedule | null;
  deferredReason?: DeferReason | null;
  failureKind?: FailureKind | null;
  recoveryResult?: 'RESTORED' | 'PARTIAL' | 'FAILED' | null;
  safeState?: { reachedAt: string; basis: string } | null;
  manifest?: { ecus: { ecuPno: string; swId: string; version: string }[] } | null;
}

/** 차량 로컬 사전조건(FFP-F038) — 전원(SOC)·정지 유지·DDT 수행 여부. 하나라도 불충족이면 설치 보류 */
export function installPreconditions(v: { socPct: number; parkHold: boolean; ddtActive: boolean }, minSoc = INSTALL_MIN_SOC): { ok: boolean; reason: DeferReason | null } {
  if (v.ddtActive) return { ok: false, reason: 'DDT' };
  if (!(v.socPct >= minSoc)) return { ok: false, reason: 'POWER' };
  if (!v.parkHold) return { ok: false, reason: 'HOLD' };
  return { ok: true, reason: null };
}

export type SimInstallOutcome = 'OK' | 'POWER_LOSS' | 'LINK_LOSS' | 'VERIFY_FAIL' | 'VERIFY_FAIL_PREVIOUS_CORRUPT' | 'RECOVERY_PARTIAL';

/**
 * 시뮬 차량 설치 — 설치 직전 사전조건을 차량이 스스로 검사(실패 → INSTALL_DEFERRED{reason}), 결과별 단계 열.
 * 이전 이미지 손상(복구 불가)은 정지 유지(안전 상태)로 들어가 도달 시각·근거를 남긴다(TC18) — 재시작해도 마지막 단계가 같다(같은 입력 → 같은 열).
 */
export function simulateVehicleInstall(v: { socPct: number; parkHold: boolean; ddtActive: boolean }, outcome: SimInstallOutcome, at: string): Omit<InstallRecord, 'installId' | 'vin' | 'source'>[] {
  const pre = installPreconditions(v);
  if (!pre.ok) return [{ stage: 'DEFERRED', at, deferredReason: pre.reason }];
  const t = (s: number) => new Date(Date.parse(at) + s * 60_000).toISOString();
  const head: Omit<InstallRecord, 'installId' | 'vin' | 'source'>[] = [{ stage: 'READY', at: t(0) }, { stage: 'INSTALLING', at: t(1) }];
  switch (outcome) {
    case 'OK':
      return [...head, { stage: 'INSTALLED', at: t(25) }];
    case 'POWER_LOSS':
      return [...head, { stage: 'FAILED', at: t(9), failureKind: 'POWER' }, { stage: 'RECOVERING', at: t(10) }];
    case 'LINK_LOSS':
      return [...head, { stage: 'FAILED', at: t(5), failureKind: 'LINK' }];
    case 'VERIFY_FAIL':
      return [...head, { stage: 'FAILED', at: t(20), failureKind: 'VERIFY' }, { stage: 'RECOVERING', at: t(21), recoveryResult: 'RESTORED' }];
    case 'RECOVERY_PARTIAL':
      return [...head, { stage: 'FAILED', at: t(20), failureKind: 'VERIFY' }, { stage: 'RECOVERING', at: t(21), recoveryResult: 'PARTIAL' }];
    case 'VERIFY_FAIL_PREVIOUS_CORRUPT':
      return [
        ...head,
        { stage: 'FAILED', at: t(20), failureKind: 'VERIFY' },
        { stage: 'RECOVERING', at: t(21), recoveryResult: 'FAILED' },
        { stage: 'SAFE_STATE_HELD', at: t(22), safeState: { reachedAt: t(22), basis: '이전 이미지 손상 — 복구 불가, 정지 유지' } },
      ];
  }
}

/** 설치 보고 본문 검사 — 실패는 원인(POWER·LINK·VERIFY) 필수, 보류는 사유 필수, 정지 유지는 도달 시각·근거 필수 */
export function installRecordIssues(r: Pick<InstallRecord, 'stage' | 'failureKind' | 'deferredReason' | 'safeState' | 'schedule'>): string[] {
  const out: string[] = [];
  if (r.stage === 'FAILED' && !r.failureKind) out.push('실패 보고에는 failure_kind(POWER·LINK·VERIFY)가 있어야 합니다');
  if (r.stage === 'DEFERRED' && !r.deferredReason) out.push('설치 보류 보고에는 사유(POWER·HOLD·DDT)가 있어야 합니다');
  if (r.stage === 'SAFE_STATE_HELD' && (!r.safeState?.reachedAt || !r.safeState.basis)) out.push('정지 유지 보고에는 safe_state_reached_at과 근거가 있어야 합니다');
  if (r.stage === 'NOT_STARTED' && r.schedule && !(r.schedule.estDurationMin > 0)) out.push('설치 예정 창에는 예상 소요(est_duration)가 있어야 합니다');
  return out;
}

const branchText = (r: InstallRecord): string => {
  switch (r.stage) {
    case 'DEFERRED':
      return `설치 보류 — ${r.deferredReason ? DEFER_REASON_LABEL[r.deferredReason] : '사유 없음'}(차량 보고)`;
    case 'FAILED':
      return `실패 — ${r.failureKind ? FAILURE_KIND_LABEL[r.failureKind] : '원인 없음'} 오류`;
    case 'RECOVERING':
      return r.recoveryResult === 'PARTIAL' ? '복구 — 일부 ECU만 복구, 승인 조합 재검증 필요' : r.recoveryResult === 'FAILED' ? '복구 — 복구 실패' : '복구 — 승인 조합으로 복구 중';
    case 'SAFE_STATE_HELD':
      return `정지 유지 · 정비 필요 — ${r.safeState?.basis ?? '근거 없음'}`;
    case 'SERVICE_REQUIRED':
      return '정비 필요 — 정비 거점 입고';
    default:
      return '';
  }
};

export interface InstallViewModel {
  /** 선형 단계 번호(1~5) */
  step: number;
  of: 5;
  stage: InstallStage | null;
  label: string;
  branch: { kind: InstallBranch; text: string } | null;
  restriction: string | null;
  customerNotice: string | null;
  confirmed: boolean;
  stale: boolean;
  lastAt: string | null;
  failureKind: FailureKind | null;
  safeState: { reachedAt: string; basis: string } | null;
}

/** 단계 보기 — 기록(시간순) → 선형 단계·갈림 줄. confirmed = 차량 형상 보고가 매니페스트와 맞음 */
export function installView(records: InstallRecord[], ctx: { now: number; confirmed: boolean; staleAfterMs?: number }): InstallViewModel {
  const sorted = [...records].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted.at(-1) ?? null;
  const lastLinear = [...sorted].reverse().find((r) => (INSTALL_LINEAR as readonly string[]).includes(r.stage)) ?? null;
  const sched = [...sorted].reverse().find((r) => r.schedule)?.schedule ?? null;
  const restriction = sched?.driveRestriction ? `약 ${sched.estDurationMin}분 운행 제한(예상)` : null;
  let stage = (lastLinear?.stage ?? 'NOT_STARTED') as (typeof INSTALL_LINEAR)[number];
  // 설치됨 보고는 차량 형상 확인 전까지 '설치 확인 대기'(4단계)
  const unconfirmedInstall = stage === 'INSTALLED' && !ctx.confirmed;
  let step = INSTALL_LINEAR.indexOf(stage) + 1;
  if (unconfirmedInstall) step = 4;
  const isBranch = !!last && (INSTALL_BRANCHES as readonly string[]).includes(last.stage);
  const stale = !!last && !(ctx.now - Date.parse(last.at) <= (ctx.staleAfterMs ?? INSTALL_REPORT_STALE_MS)) && !(stage === 'INSTALLED' && ctx.confirmed);
  const failure = [...sorted].reverse().find((r) => r.failureKind)?.failureKind ?? null;
  const safe = [...sorted].reverse().find((r) => r.safeState)?.safeState ?? null;
  const baseLabel = unconfirmedInstall ? '설치 확인 대기' : INSTALL_STAGE_LABEL[stage];
  if (!last) stage = 'NOT_STARTED';
  return {
    step,
    of: 5,
    stage: last?.stage ?? null,
    label: stale ? `미확인 · 마지막 보고: ${INSTALL_STAGE_LABEL[last!.stage]}` : baseLabel,
    branch: isBranch ? { kind: last!.stage as InstallBranch, text: branchText(last!) } : null,
    restriction,
    customerNotice: restriction && !(stage === 'INSTALLED' && ctx.confirmed) ? `설치 중 운행 제한 약 ${sched!.estDurationMin}분(예상)` : null,
    confirmed: stage === 'INSTALLED' && ctx.confirmed,
    stale,
    lastAt: last?.at ?? null,
    failureKind: failure,
    safeState: safe,
  };
}

/** 6축 '구성과 설치' 요약 값 대응 — 설치 확인됨(승인 조합 대조 뒤) → 호환, 실패 → 부분 실패, 복구·정지 유지·정비 → 복구 필요, 다운로드됨은 설치로 세지 않음 */
export function installStageAxisOf(stage: InstallStage | null, confirmed: boolean): 'NOT_INSTALLED' | 'INSTALLING' | 'COMPATIBLE' | 'PARTIAL_FAILURE' | 'RECOVERY_NEEDED' {
  switch (stage) {
    case null:
    case 'NOT_STARTED':
    case 'DOWNLOADED':
    case 'DEFERRED':
      return 'NOT_INSTALLED';
    case 'READY':
    case 'INSTALLING':
      return 'INSTALLING';
    case 'INSTALLED':
      return confirmed ? 'COMPATIBLE' : 'INSTALLING';
    case 'FAILED':
      return 'PARTIAL_FAILURE';
    default:
      return 'RECOVERY_NEEDED';
  }
}

/** 실패 원인별 수 — 전원·통신·검증을 따로 센다 */
export function installFailureCounts(records: Pick<InstallRecord, 'stage' | 'failureKind'>[]): Record<FailureKind, number> {
  const c: Record<FailureKind, number> = { POWER: 0, LINK: 0, VERIFY: 0 };
  for (const r of records) if (r.stage === 'FAILED' && r.failureKind) c[r.failureKind]++;
  return c;
}

/** 매니페스트 ↔ 차량 형상 보고 — 매니페스트의 ECU SW가 모두 같은 버전으로 보고돼야 설치 확인(일부만이면 부분) */
export function manifestConfirmed(manifest: InstallRecord['manifest'], report: { reportedAt: string | null; ecus: { ecuPno: string; sw: { swId: string; version: string }[] }[] } | null, installedAt: string): { confirmed: boolean; partial: boolean; missing: string[] } {
  if (!manifest || !manifest.ecus.length || !report?.reportedAt || report.reportedAt < installedAt) return { confirmed: false, partial: false, missing: manifest?.ecus.map((e) => e.ecuPno) ?? [] };
  const missing = manifest.ecus.filter((m) => !report.ecus.find((e) => e.ecuPno === m.ecuPno)?.sw.some((s) => s.swId === m.swId && s.version === m.version)).map((m) => m.ecuPno);
  return { confirmed: missing.length === 0, partial: missing.length > 0 && missing.length < manifest.ecus.length, missing };
}
