// 예외 정책 요청·승인·회수 본문(GX) — API 경로 표(routes.ts)가 읽는 스키마만 둔다. 판정 규칙·검사 이름은 rules/exception-policy.ts
import { z } from 'zod';
import { GateId, type Role } from '../enums';

export const EXCEPTION_KINDS = ['BYPASS', 'GATE_PENDING'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
export const EXCEPTION_RESTRICTIONS = ['LIMITED', 'PILOT', 'SHADOW'] as const;
export type ExceptionRestriction = (typeof EXCEPTION_RESTRICTIONS)[number];
/** 예외 층이 보는 배포 검사 ID — 이름·우회 가능 여부는 rules/exception-policy EXCEPTION_CHECKS */
export const EXCEPTION_CHECK_IDS = ['COMPLIANCE_RULE', 'FLAG_CODE', 'ADS_PUBLISH', 'RELEASE_GATE', 'SIGNATURE_INTEGRITY', 'KILL_TWO_PERSON', 'SEPARATION_OF_DUTY', 'STOP_ALWAYS'] as const;
export type ExceptionCheckId = (typeof EXCEPTION_CHECK_IDS)[number];
/** 적용 기간 상한 — 무기한 예외는 없다(7일) */
export const EXCEPTION_MAX_HOURS = 7 * 24;
export const EXCEPTION_REQUEST_ROLES: Role[] = ['RELEASE_MANAGER', 'OPERATOR'];
export const EXCEPTION_APPROVER_ROLES: Role[] = ['SAFETY_OFFICER', 'OPS_LEAD', 'SECURITY_OFFICER', 'GATE_JUDGE'];

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), '일시 형식이 아닙니다');

export const CreateExceptionBody = z
  .object({
    kind: z.enum(EXCEPTION_KINDS),
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    featureVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    /** 임시 우회 대상 배포 정책 */
    policyId: z.string().regex(/^POL-\d{5}$/).nullable().default(null),
    /** 우회할 검사(정책) — 임시 우회 */
    checks: z.array(z.enum(EXCEPTION_CHECK_IDS)).max(8).default([]),
    /** 우회할 컴플라이언스 룰 ID */
    ruleIds: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
    /** PENDING Gate — Gate 예외 */
    gates: z.array(GateId).max(9).default([]),
    restriction: z.enum(EXCEPTION_RESTRICTIONS),
    /** 긴급 사유 */
    reason: z.string().trim().min(4).max(1000),
    /** 적용 기간(시간) — 적용 시각부터 */
    periodHours: z.number().int().min(1).max(EXCEPTION_MAX_HOURS),
    /** 완료 예정일 — Gate 예외 */
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    /** 잔여 리스크 — Gate 예외 */
    residualRisk: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();
export type CreateExceptionBody = z.infer<typeof CreateExceptionBody>;

export const ExceptionDecisionBody = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    /** 승인 의견 또는 반려 사유 */
    reason: z.string().trim().min(2).max(1000),
    /** 승인자가 지정하는 만료 일시 — 승인에는 필수 */
    expiresAt: iso.optional(),
  })
  .strict()
  .refine((b) => b.decision !== 'APPROVE' || !!b.expiresAt, { message: '승인에는 만료 일시를 지정해야 합니다', path: ['expiresAt'] });
export type ExceptionDecisionBody = z.infer<typeof ExceptionDecisionBody>;

export const ExceptionRevokeBody = z.object({ reason: z.string().trim().min(2).max(1000) }).strict();
export type ExceptionRevokeBody = z.infer<typeof ExceptionRevokeBody>;
