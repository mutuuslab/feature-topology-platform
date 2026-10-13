// 차량 상태 보고 v2 — 수신 검사(보고서 v1.1 13.3.1)와 차량 Guard 검증 순서(9.3)의 순수 규칙.
// 플랫폼(D04-03)과 차량 시뮬레이터(D02-03)가 같은 판정을 쓴다. 해시·CMAC 계산은 호출자(백엔드)가 하고 결과만 넘긴다.
import type { GuardState, RejectCode } from '../schemas/safety';
import { StatusReportV2, wireErrors } from '../schemas/wire';
import { jcs } from './jcs';
import { reasonAction, type ReasonAction } from './deactivation';

/** state_auth 대상 — state_auth를 뺀 보고의 JCS(RFC 8785) UTF-8 바이트(ICD 선택). 차량 키 AES-CMAC-128 */
export function statusAuthCanonical(report: Record<string, unknown>): string {
  const { state_auth: _drop, ...rest } = report;
  return jcs(rest);
}

/** report_seq = 시동 참조(상위 16비트) ‖ 시동 안 순번(하위 16비트) — 9.5절 resync_ref가 상위 16비트를 쓴다 */
export const reportSeqOf = (boot: number, counter: number) => (((boot & 0xffff) << 16) | (counter & 0xffff)) >>> 0;
export const bootRefOf = (reportSeq: number) => reportSeq >>> 16;

export type StatusCheckStep = 'SCHEMA' | 'AUTH' | 'SEQUENCE' | 'TARGET' | 'HISTORY' | 'PERSISTENCE';
export const STATUS_CHECK_STEPS: StatusCheckStep[] = ['SCHEMA', 'AUTH', 'SEQUENCE', 'TARGET', 'HISTORY', 'PERSISTENCE'];

export interface StatusCheckContext {
  /** 2 — 차량 키로 state_auth 검증 결과(호출자가 계산) */
  authOk: boolean;
  /** 3 — 이 차량에서 받아들인 마지막 report_seq(없으면 0) */
  lastReportSeq: number;
  /** 4 — 이 차량에 전개된 Feature Version(없으면 null) */
  expectedVersion: string | null;
  /** 5 — 이 차량·Feature에 마지막으로 발급한 명령(봉투) */
  lastCommand: { request: 'deactivate' | 'restore' | 'activate' | 'sync'; vehicleSeq: number } | null;
}

export interface StatusCheckResult {
  accepted: boolean;
  /** 위반 — 걸린 단계·코드·설명. 위반 보고는 확인 집계에서 빼고 Incident로 넘긴다(FFG-TEL-003) */
  violation: { step: StatusCheckStep; code: string; message: string } | null;
  /** 받아들였지만 후속 조치가 필요한 경우(9.3 표) — 재발행·보안 이벤트 등 */
  action: ReasonAction;
}

const DEACT_STATES: GuardState[] = ['DEACT_PENDING_IDLE', 'DEACT_PENDING_CYCLE', 'DEACT_WARNING', 'DEACT_RAMP', 'DISABLED'];

/**
 * 수신 검사 6단계 — 스키마 → state_auth → report_seq 증가 → 대상 → 명령 이력 일관성 → 영속성.
 * @rule FFG-TEL-003, FFG-DEAC-007, FFG-ADS-004 — 플랫폼 쪽: 증명 없는 보고 불인정, 해제 명령 없이 ACTIVE 보고는 Incident(차량 쪽 영속·재부팅 유지는 차량 SW)
 */
export function checkStatusReport(report: unknown, ctx: StatusCheckContext): StatusCheckResult {
  const fail = (step: StatusCheckStep, code: string, message: string): StatusCheckResult => ({
    accepted: false,
    violation: { step, code, message },
    action: reasonAction('REJECTED', code === 'AUTH_FAILED' || code === 'REPLAY' ? (code as RejectCode) : 'RESPONSE_INVALID'),
  });
  const errors = wireErrors(StatusReportV2, report);
  if (errors.length) return fail('SCHEMA', 'SCHEMA', `상태 보고 v2 스키마 위반: ${errors.slice(0, 3).join('; ')}`);
  const r = report as StatusReportV2;
  if (!ctx.authOk) return fail('AUTH', 'AUTH_FAILED', 'state_auth가 차량 키로 검증되지 않습니다 — 위조·변조 보고');
  if (r.report_seq <= ctx.lastReportSeq) return fail('SEQUENCE', 'REPLAY', `report_seq ${r.report_seq} ≤ 마지막 ${ctx.lastReportSeq} — 재전송`);
  if (ctx.expectedVersion === null) return fail('TARGET', 'UNKNOWN_FEATURE', `${r.feature.id}은(는) 이 차량에 전개되지 않았습니다`);
  if (r.feature.version !== ctx.expectedVersion) return fail('TARGET', 'VERSION_MISMATCH', `보고 Version ${r.feature.version} ≠ 전개 Version ${ctx.expectedVersion}`);
  const last = ctx.lastCommand;
  if (r.reason.source === 'REMOTE') {
    if (DEACT_STATES.includes(r.state) && last?.request !== 'deactivate') return fail('HISTORY', 'STATE_WITHOUT_COMMAND', `${r.state}을(를) 원격 사유로 보고했지만 이 차량에 비활성화 명령이 없습니다`);
    if (last && r.vehicle_seq > last.vehicleSeq) return fail('HISTORY', 'SEQ_AHEAD', `vehicle_seq ${r.vehicle_seq} > 발급 ${last.vehicleSeq} — 플랫폼이 보내지 않은 명령`);
  }
  // 해제(restore) 없이 ACTIVE — 재부팅·SW 업데이트로 Kill이 풀렸다(FFG-ADS-004·DEAC-007)
  if (r.state === 'ACTIVE' && last?.request === 'deactivate') return fail('HISTORY', 'ACTIVE_WITHOUT_RESTORE', '비활성화 뒤 복원 명령 없이 ACTIVE를 보고했습니다 — 안전 Kill이 풀림');
  const action = r.persistence === 'FAILED' ? reasonAction('REJECTED', 'NV_WRITE_FAILED') : reasonAction(r.request_result, r.reject_code ?? 'NONE');
  return { accepted: true, violation: null, action };
}

// ── 차량 Guard 검증 순서(9.3) — 시뮬레이터가 쓴다 ─────────────────────
export interface GuardCheckInput {
  jwsOk: boolean;
  cmdAuthOk: boolean;
  keyEpoch: number;
  currentEpoch: number;
  vehicleSeq: number;
  lastVehicleSeq: number;
  now: number;
  notBefore: number;
  expiresAt: number;
  designClass: string;
  commandClass: string;
  approverRefs: readonly [number, number];
}

/**
 * 받으면 NONE, 아니면 거부 코드 — 서명 → 인증 → epoch → 순번 창(+1~+1024) → 시각 → 등급 → 승인자.
 * @rule FFG-VEH-013 — 차량 쪽 순번 창·epoch 판정(시뮬레이터 기준 구현, 실차는 Guard C 코드)
 */
export function guardCheck(i: GuardCheckInput): RejectCode {
  if (!i.jwsOk) return 'SIGNATURE_INVALID';
  if (!i.cmdAuthOk) return 'AUTH_FAILED';
  if (i.keyEpoch < i.currentEpoch) return 'KEY_EPOCH_OLD';
  if (i.vehicleSeq <= i.lastVehicleSeq) return 'REPLAY';
  if (i.vehicleSeq > i.lastVehicleSeq + 1024) return 'SEQ_JUMP';
  if (i.now < i.notBefore) return 'NOT_YET_VALID';
  if (i.now >= i.expiresAt) return 'EXPIRED';
  if (i.commandClass === 'DC4' || i.designClass === 'DC4') return 'DC4_REMOTE_FORBIDDEN';
  if (i.commandClass !== i.designClass) return 'CLASS_MISMATCH';
  if (i.approverRefs[0] === i.approverRefs[1]) return 'SAME_APPROVER';
  return 'NONE';
}
