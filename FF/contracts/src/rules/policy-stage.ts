// 정책 생애주기 값 — 기능명세서 단계값(Draft·Review·Approved·Deployed·Monitored)과 저장 상태의 대응표(P10, FR-PVER-003-001).
// 저장 상태(PolicyStatus)는 그대로 두고, 화면·조회는 명세 단계값 목록에서 고른다. 반려(REJECTED)는 다시 고치는 초안, 종료(RETIRED)는 명세 단계 밖.
// Deployed와 Monitored는 같은 DEPLOYED — 배포 범위가 아직 전체가 아니면 Deployed(단계 배포 중), 전체면 운영 감시 단계 Monitored.
import type { Policy, PolicyStatus } from '../schemas/policy';

export const POLICY_SPEC_STAGES = ['Draft', 'Review', 'Approved', 'Deployed', 'Monitored'] as const;
export type PolicySpecStage = (typeof POLICY_SPEC_STAGES)[number];

export const POLICY_SPEC_STAGE_LABEL: Record<PolicySpecStage, string> = { Draft: '초안', Review: '검토', Approved: '승인', Deployed: '배포(단계 진행)', Monitored: '운영 감시(전체 배포)' };
/** 명세 단계 → 저장 상태 */
export const POLICY_SPEC_STAGE_STATUSES: Record<PolicySpecStage, PolicyStatus[]> = { Draft: ['DRAFT', 'REJECTED'], Review: ['VALIDATED'], Approved: ['APPROVED'], Deployed: ['DEPLOYED'], Monitored: ['DEPLOYED'] };

/** 지금 효력 범위(만분율) — 단계 배포 값이 있으면 그것, 없으면 정책 rollout */
import { effectiveBasisPoints } from '../flags/evaluate';

// @req FR-PVER-003-001
/** 저장 상태 → 명세 단계값(종료 RETIRED는 null) */
export function policySpecStage(p: Pick<Policy, 'status' | 'stageBasisPoints' | 'rollout'>): PolicySpecStage | null {
  switch (p.status) {
    case 'DRAFT':
    case 'REJECTED':
      return 'Draft';
    case 'VALIDATED':
      return 'Review';
    case 'APPROVED':
      return 'Approved';
    case 'DEPLOYED':
      return effectiveBasisPoints(p) >= 10000 ? 'Monitored' : 'Deployed';
    default:
      return null;
  }
}
