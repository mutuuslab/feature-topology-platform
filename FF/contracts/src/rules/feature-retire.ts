// Feature 반려·재작업 기록과 즉시 폐기 (P10, D01-01) — 상세설계서 표 10을 넓히지 않고 기록·요청을 더한다.
//  · 정의 승인 반려(FR-REG-002-010·011): PROPOSED에 머물고 반려 사유·반려자·일시·이슈 항목·재작업 사유를 반려 기록으로 남긴다.
//  · 검증 이슈(FR-REG-002-013): VERIFIED → DEVELOPING 되돌림에 이슈 항목(1개 이상)·재작업 사유·판정 일시.
//  · 즉시 폐기(FR-REG-002-014~016): 어느 단계에서든 RETIRED로 — 요청자 ≠ 승인자(그 Version 작성자도 승인 불가), 사유 필수.
//  · Retired 전이 관문(FR-REG-005-017·018): 출시된 적 있는(RELEASED·DEPRECATED) Version은 Flag Retirement가 Registry 퇴역까지 끝나야 RETIRED.
import { z } from 'zod';
import { type Lifecycle, type Role } from '../enums';
import { FEATURE_RETIRE_APPROVERS } from './lifecycle-gate-roles';
export { FEATURE_REJECTERS, FEATURE_RETIRE_APPROVERS, FEATURE_RETIRE_REQUESTERS } from './lifecycle-gate-roles';

// ── 반려·재작업 기록 ─────────────────────────────────────────────
export const IssueItem = z.object({ item: z.string().trim().min(2, '이슈 항목을 2자 이상 입력하세요.').max(200), detail: z.string().trim().max(500).default('') }).strict();
export type IssueItem = z.infer<typeof IssueItem>;

/** 정의 승인 반려 — PROPOSED Version만, 작성자 본인은 반려할 수 없다(승인자와 같은 직무 분리) */
export const RejectFeatureBody = z
  .object({
    reason: z.string().trim().min(2, '반려 사유를 2자 이상 입력하세요.').max(500),
    issues: z.array(IssueItem).min(1, '이슈 항목을 1개 이상 입력하세요.').max(20),
    reworkReason: z.string().trim().min(2, '재작업 사유를 2자 이상 입력하세요.').max(500),
  })
  .strict();
export type RejectFeatureBody = z.infer<typeof RejectFeatureBody>;


export type FeatureReviewKind = 'REJECT' | 'REWORK';
export interface FeatureReviewRecord {
  recordId: string;
  featureId: string;
  version: string;
  kind: FeatureReviewKind;
  /** 기록 시점 Lifecycle(반려 PROPOSED · 재작업 VERIFIED) → 결과 Lifecycle */
  from: Lifecycle;
  to: Lifecycle;
  reason: string;
  issues: IssueItem[];
  reworkReason: string;
  by: string;
  role: string;
  at: string;
}
export const FEATURE_REVIEW_KIND_LABEL: Record<FeatureReviewKind, string> = { REJECT: '정의 승인 반려', REWORK: '검증 이슈 — 개발로 되돌림' };

// ── 즉시 폐기 ─────────────────────────────────────────────

export const RetireFeatureBody = z.object({ reason: z.string().trim().min(5, '폐기 사유를 5자 이상 입력하세요.').max(500) }).strict();
export type RetireFeatureBody = z.infer<typeof RetireFeatureBody>;
export const RetireDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500) }).strict();
export type RetireDecisionBody = z.infer<typeof RetireDecisionBody>;

export type RetireRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface FeatureRetireRequest {
  requestId: string;
  featureId: string;
  version: string;
  /** 요청 시점 Lifecycle */
  from: Lifecycle;
  reason: string;
  status: RetireRequestStatus;
  requestedBy: string;
  requestedRole: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedRole: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

/** 출시된 적 있는 단계 — 차량에 Flag가 나갔을 수 있어 Retirement 관문을 본다 */
export const FIELD_EXPOSED: readonly Lifecycle[] = ['RELEASED', 'DEPRECATED'];

export interface RetirementGateFacts {
  /** 이 Version의 배포 중(DEPLOYED) 정책 Flag */
  deployedFlags: string[];
  /** 이 Version Flag의 Retirement 건 중 Registry 퇴역 전(REQUESTED·APPROVED) */
  openRetirements: { retirementId: string; flagKey: string; status: string }[];
}

/** Retired 전이 관문 — 막힌 사유 목록(통과면 빈 배열). 출시 전 Version(현장 Flag 없음)은 대상 아님 */
export function retirementGateBlockers(from: Lifecycle, x: RetirementGateFacts): string[] {
  if (!FIELD_EXPOSED.includes(from)) return [];
  const out: string[] = [];
  for (const k of x.deployedFlags) out.push(`Flag ${k}가 아직 배포 중입니다 — Flag Retirement를 Registry 퇴역(5단계)까지 마친 뒤 폐기합니다.`);
  for (const r of x.openRetirements) if (!x.deployedFlags.includes(r.flagKey)) out.push(`Flag Retirement ${r.retirementId}(${r.flagKey})가 ${r.status} 상태입니다 — Registry 퇴역까지 마친 뒤 폐기합니다.`);
  return out;
}

export interface ImmediateRetireInput {
  lifecycle: Lifecycle;
  request: Pick<FeatureRetireRequest, 'requestedBy' | 'status'>;
  actor: { id: string; role: Role | string };
  /** 그 Version 작성자 */
  createdBy: string | null;
  gate: RetirementGateFacts;
}

/** 즉시 폐기 승인 가능 여부 — 막힌 사유 전부(FR-REG-002-016 승인자 확인·직무 분리, FR-REG-005-018) */
export function immediateRetireBlockers(i: ImmediateRetireInput): { code: 'NO_RULE' | 'ROLE' | 'SEPARATION_OF_DUTY' | 'RETIREMENT_INCOMPLETE' | 'CONFLICT'; message: string }[] {
  const out: { code: 'NO_RULE' | 'ROLE' | 'SEPARATION_OF_DUTY' | 'RETIREMENT_INCOMPLETE' | 'CONFLICT'; message: string }[] = [];
  if (i.lifecycle === 'RETIRED') out.push({ code: 'NO_RULE', message: '이미 RETIRED 버전입니다.' });
  if (i.request.status !== 'PENDING') out.push({ code: 'CONFLICT', message: `이미 ${i.request.status} 처리된 폐기 요청입니다.` });
  if (!(FEATURE_RETIRE_APPROVERS as string[]).includes(i.actor.role)) out.push({ code: 'ROLE', message: '폐기 승인은 Feature 승인자·Feature 출시 담당자가 합니다.' });
  if (i.actor.id === i.request.requestedBy) out.push({ code: 'SEPARATION_OF_DUTY', message: '폐기를 요청한 사람은 같은 요청을 승인할 수 없습니다.' });
  else if (i.createdBy && i.actor.id === i.createdBy) out.push({ code: 'SEPARATION_OF_DUTY', message: '그 Version 작성자는 폐기를 승인할 수 없습니다.' });
  for (const m of retirementGateBlockers(i.lifecycle, i.gate)) out.push({ code: 'RETIREMENT_INCOMPLETE', message: m });
  return out;
}
