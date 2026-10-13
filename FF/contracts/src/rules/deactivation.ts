// 안전 Feature 비활성화 규칙 — 보고서 v1.1 7장. 화면(타임라인 미리보기·요청 작성기)과 백엔드(게이트·차량 시뮬레이터)가 같은 표를 쓴다.
import type { DeactClass, GuardState, ReasonCategory, RejectCode } from '../schemas/safety';

/**
 * 7.2 사유별 유효 등급 — 상업·운영 사유는 DC0·DC4가 아니면 DC3(다음 시동), 최종 상태 INACTIVE. 차량 Guard ff_effective_class와 같다.
 * @rule FFG-DEAC-004 — 등급·끝 상태 판정. 사전 고지와 진행 중 Kill 덮어쓰기 금지는 체험권 단계(F4)에서 집행한다
 */
export function effectiveClass(designClass: DeactClass, reason: ReasonCategory): DeactClass {
  const commercial = reason === 'COMMERCIAL' || reason === 'OPERATIONAL';
  return commercial && designClass !== 'DC0' && designClass !== 'DC4' ? 'DC3' : designClass;
}

/** 원격 비활성화 끝 상태 — 상업·운영 사유는 INACTIVE(다시 권한으로 켤 수 있음), 안전·보안·법규는 DISABLED(RESTORE로만 해제) */
export function endState(reason: ReasonCategory): GuardState {
  return reason === 'COMMERCIAL' || reason === 'OPERATIONAL' ? 'INACTIVE' : 'DISABLED';
}

export type StageId = 'REQUESTED' | 'WAIT_IDLE' | 'WARNING' | 'TAKEOVER' | 'RAMP' | 'WAIT_CYCLE' | 'OFF' | 'REJECTED';

export interface DeactStage {
  id: StageId;
  /** 이 구간에서 차량이 보고하는 Guard 상태(7.5) */
  state: GuardState | null;
  /** 구간 길이 — Registry 시간값 키(없으면 사건으로 끝남) */
  durationKey?: 'takeover_ms' | 'ramp_ms' | 'max_pending_ms' | 'max_cycle_wait_ms';
}

/** 7.3 등급별 동작 — 기능이 작동 중일 때의 단계(작동 중이 아니면 DC1·DC2는 바로 OFF). DC4는 원격 요청 자체를 거부(FFG-PLT-004) */
export const DEACT_STAGES: Record<DeactClass, DeactStage[]> = {
  DC0: [
    { id: 'REQUESTED', state: null },
    { id: 'OFF', state: 'DISABLED' },
  ],
  DC1: [
    { id: 'REQUESTED', state: null },
    {
      id: 'WAIT_IDLE',
      state: 'DEACT_PENDING_IDLE',
      durationKey: 'max_pending_ms',
    },
    { id: 'OFF', state: 'DISABLED' },
  ],
  DC2: [
    { id: 'REQUESTED', state: null },
    { id: 'WARNING', state: 'DEACT_WARNING' },
    { id: 'TAKEOVER', state: 'DEACT_WARNING', durationKey: 'takeover_ms' },
    { id: 'RAMP', state: 'DEACT_RAMP', durationKey: 'ramp_ms' },
    { id: 'OFF', state: 'DISABLED' },
  ],
  DC3: [
    { id: 'REQUESTED', state: null },
    {
      id: 'WAIT_CYCLE',
      state: 'DEACT_PENDING_CYCLE',
      durationKey: 'max_cycle_wait_ms',
    },
    { id: 'OFF', state: 'DISABLED' },
  ],
  DC4: [
    { id: 'REQUESTED', state: null },
    { id: 'REJECTED', state: null },
  ],
};

/** 단계 목록 — 끝 상태는 사유에 따라 DISABLED 또는 INACTIVE */
export function deactStages(designClass: DeactClass, reason: ReasonCategory): DeactStage[] {
  const eff = effectiveClass(designClass, reason);
  const end = endState(reason);
  return DEACT_STAGES[eff].map((s) => (s.id === 'OFF' ? { ...s, state: end } : s));
}

/** 차량이 보고한 상태가 단계 목록의 어디까지 왔는지 — 화면 단계 줄의 진행 위치. 모르면(UNKNOWN·null) -1 */
export function stageIndexOf(stages: DeactStage[], state: GuardState | null | undefined, opts: { takeoverElapsed?: boolean } = {}): number {
  if (!state || state === 'UNKNOWN') return -1;
  let idx = -1;
  stages.forEach((s, i) => {
    if (s.state === state) idx = i;
  });
  // DEACT_WARNING은 경고·인계 두 단계에 걸친다 — 인계 시간이 지났다는 사건이 있으면 뒤 단계로
  if (state === 'DEACT_WARNING' && !opts.takeoverElapsed) idx = stages.findIndex((s) => s.id === 'WARNING');
  return idx;
}

/** 9.3 결과 코드 → 플랫폼이 보여 줄 조치 분류 */
export type ReasonActionKind = 'APPLIED' | 'REISSUE_SAME' | 'LINK_RETRY' | 'SECURITY_EVENT' | 'AFTER_TIME_SYNC' | 'NEW_COMMAND' | 'REPORT_ONLY' | 'RETRY_AFTER_NVM' | 'RESYNC' | 'DISCARD_UNKNOWN';

export interface ReasonAction {
  kind: ReasonActionKind;
  /** 같은 명령을 다시 보내는가 */
  retry: boolean;
  /** 보안 이벤트(IdsM·VSOC, FFG-SEC-007)로 올리는가 */
  security: boolean;
}

const A = (kind: ReasonActionKind, retry = false, security = false): ReasonAction => ({ kind, retry, security });

/** 보고서 9.3 결과 코드 표 + 9.4 응답 검사(RESPONSE_INVALID → UNKNOWN). 거부 코드가 없으면(NONE) 요청 결과로 판단 */
export const REASON_ACTIONS: Record<RejectCode, ReasonAction> = {
  NONE: A('APPLIED'),
  E2E_LENGTH: A('LINK_RETRY', true),
  E2E_DATA_ID: A('LINK_RETRY', true),
  E2E_CRC: A('LINK_RETRY', true),
  E2E_SEQUENCE: A('LINK_RETRY', true),
  AUTH_FAILED: A('SECURITY_EVENT', false, true),
  KEY_EPOCH_OLD: A('SECURITY_EVENT', false, true),
  REPLAY: A('SECURITY_EVENT', false, true),
  SEQ_JUMP: A('SECURITY_EVENT', false, true),
  TARGET_MISMATCH: A('SECURITY_EVENT', false, true),
  CLASS_MISMATCH: A('SECURITY_EVENT', false, true),
  APPROVALS_INVALID: A('SECURITY_EVENT', false, true),
  SAME_APPROVER: A('SECURITY_EVENT', false, true),
  TIME_INVALID: A('AFTER_TIME_SYNC', true),
  NOT_YET_VALID: A('NEW_COMMAND'),
  EXPIRED: A('NEW_COMMAND'),
  UNKNOWN_FEATURE: A('REPORT_ONLY'),
  VERSION_MISMATCH: A('REPORT_ONLY'),
  CODING_INVALID: A('REPORT_ONLY'),
  DC4_REMOTE_FORBIDDEN: A('REPORT_ONLY'),
  STATE_NOT_ALLOWED: A('REPORT_ONLY'),
  NV_WRITE_FAILED: A('RETRY_AFTER_NVM', true),
  SEQ_UNTRUSTED: A('RESYNC'),
  // LPC(QM) 2차 검증 거부 — 서명·스키마·승인·사용자 확인은 플랫폼이 고칠 문제(재발행)
  SCHEMA_VERSION: A('NEW_COMMAND'),
  SIGNATURE_INVALID: A('SECURITY_EVENT', false, true),
  AUTH_MISSING: A('SECURITY_EVENT', false, true),
  USER_CONFIRMATION_MISSING: A('NEW_COMMAND'),
  SEQUENCE_NOT_INCREASING: A('SECURITY_EVENT', false, true),
  RESPONSE_INVALID: A('DISCARD_UNKNOWN'),
};

/** 요청 결과와 거부 코드로 조치를 고른다 — ACCEPTED_NOT_DURABLE은 같은 명령 재발행(9.3) */
export function reasonAction(result: 'NONE' | 'ACCEPTED' | 'ACCEPTED_NOT_DURABLE' | 'REJECTED', code: RejectCode = 'NONE'): ReasonAction {
  if (result === 'ACCEPTED_NOT_DURABLE') return A('REISSUE_SAME', true);
  if (result === 'ACCEPTED' || result === 'NONE') return A('APPLIED');
  return REASON_ACTIONS[code];
}
