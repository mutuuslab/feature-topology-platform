// 기능안전 분류·메시지 v2 열거형 — 국제표준 대응방안 보고서 v1.1(FFP-FS-STR-001) 5장 분류 체계와 부록 D 메시지 스키마 v2.
// 값의 원천은 harness/guide/schema/*.v2.schema.json (guide:sync 복사본) — 스키마와 어긋나면 safety.test.ts가 잡는다.
import { z } from 'zod';

/** 처리강도(5.2) — ASIL을 대신하지 않는다. F2 이상은 안전 관련 */
export const F_CLASSES = ['F0', 'F1', 'F2', 'F3', 'F4'] as const;
export const FClass = z.enum(F_CLASSES);
export type FClass = z.infer<typeof FClass>;

/** 비활성화 등급(5.3) — DC0 즉시 · DC1 미작동 시 · DC2 경고→인계→램프 · DC3 다음 시동 · DC4 원격 요청 금지 */
export const DEACT_CLASSES = ['DC0', 'DC1', 'DC2', 'DC3', 'DC4'] as const;
export const DeactClass = z.enum(DEACT_CLASSES);
export type DeactClass = z.infer<typeof DeactClass>;

/** 법규 등급(5.4) — R0 형식승인 무관 · R1 형식승인 시스템 영향 · R2 법정 의무 기능(DC4, Flag 제어 대상 아님) */
export const REG_CLASSES = ['R0', 'R1', 'R2'] as const;
export const RegClass = z.enum(REG_CLASSES);
export type RegClass = z.infer<typeof RegClass>;

/** Flag 유형(5.5) — Release 단기·G7 필요 / Ops(Kill) 장기·DC 따름 / Permission 안전 Kill 해제 불가 / Experiment F2+ 금지(Shadow만) */
export const FLAG_TYPES = ['RELEASE', 'OPS', 'PERMISSION', 'EXPERIMENT'] as const;
export const FlagType = z.enum(FLAG_TYPES);
export type FlagType = z.infer<typeof FlagType>;

/** kill_command v2 — 요청 유형·사유·승인 역할 */
export const KILL_REQUESTS = ['deactivate', 'restore', 'activate', 'sync'] as const;
export const KillRequestType = z.enum(KILL_REQUESTS);
export type KillRequestType = z.infer<typeof KillRequestType>;

export const REASON_CATEGORIES = ['SAFETY', 'SECURITY', 'REGULATORY', 'COMMERCIAL', 'OPERATIONAL'] as const;
export const ReasonCategory = z.enum(REASON_CATEGORIES);
export type ReasonCategory = z.infer<typeof ReasonCategory>;

export const APPROVER_ROLES = ['FSM', 'CSM', 'OPS_LEAD', 'PRODUCT_OWNER', 'QA', 'REGULATORY'] as const;
export const ApproverRole = z.enum(APPROVER_ROLES);
export type ApproverRole = z.infer<typeof ApproverRole>;

/** status_report v2 — Guard 상태(7.5 State Machine). 모르면 UNKNOWN(가정 금지) */
export const GUARD_STATES = [
  'INACTIVE',
  'ACT_PENDING',
  'ACTIVE',
  'DEACT_PENDING_IDLE',
  'DEACT_PENDING_CYCLE',
  'DEACT_WARNING',
  'DEACT_RAMP',
  'DISABLED',
  'RESTORE_PENDING',
  'FAULT',
  'UNKNOWN',
] as const;
export const GuardState = z.enum(GUARD_STATES);
export type GuardState = z.infer<typeof GuardState>;

export const REQUEST_RESULTS = ['NONE', 'ACCEPTED', 'ACCEPTED_NOT_DURABLE', 'REJECTED'] as const;
export const RequestResult = z.enum(REQUEST_RESULTS);
export type RequestResult = z.infer<typeof RequestResult>;

export const REJECT_CODES = [
  'NONE',
  'E2E_LENGTH',
  'E2E_DATA_ID',
  'E2E_CRC',
  'E2E_SEQUENCE',
  'AUTH_FAILED',
  'KEY_EPOCH_OLD',
  'REPLAY',
  'SEQ_JUMP',
  'TIME_INVALID',
  'NOT_YET_VALID',
  'EXPIRED',
  'TARGET_MISMATCH',
  'UNKNOWN_FEATURE',
  'VERSION_MISMATCH',
  'CODING_INVALID',
  'CLASS_MISMATCH',
  'DC4_REMOTE_FORBIDDEN',
  'APPROVALS_INVALID',
  'SAME_APPROVER',
  'STATE_NOT_ALLOWED',
  'NV_WRITE_FAILED',
  'SEQ_UNTRUSTED',
  'SCHEMA_VERSION',
  'SIGNATURE_INVALID',
  'AUTH_MISSING',
  'USER_CONFIRMATION_MISSING',
  'SEQUENCE_NOT_INCREASING',
  'RESPONSE_INVALID',
] as const;
export const RejectCode = z.enum(REJECT_CODES);
export type RejectCode = z.infer<typeof RejectCode>;

export const HMI_STATES = ['NONE', 'INFO_PENDING', 'WARN_TAKEOVER', 'INFO_DISABLED'] as const;
export const HmiState = z.enum(HMI_STATES);
export type HmiState = z.infer<typeof HmiState>;

export const EDR_STATES = ['ENGAGED_OR_ARMED', 'AVAILABLE', 'OFF_BY_COMMAND', 'OFF_BY_FAULT', 'OFF'] as const;
export const EdrState = z.enum(EDR_STATES);
export type EdrState = z.infer<typeof EdrState>;

export const TIME_SYNC = ['SYNCED', 'DEGRADED', 'UNSYNCED'] as const;
export const TimeSync = z.enum(TIME_SYNC);
export type TimeSync = z.infer<typeof TimeSync>;

export const PERSISTENCE = ['DURABLE', 'PENDING', 'FAILED'] as const;
export const Persistence = z.enum(PERSISTENCE);
export type Persistence = z.infer<typeof Persistence>;

export const REPORT_SOURCES = ['REMOTE', 'ONBOARD', 'STARTUP'] as const;
export const ReportSource = z.enum(REPORT_SOURCES);
export type ReportSource = z.infer<typeof ReportSource>;

/** 처리강도 순위 — "F2 이상" 판정용 */
export const fRank = (f: FClass): number => F_CLASSES.indexOf(f);
export const isSafetyRelevant = (f: FClass): boolean => fRank(f) >= 2;
