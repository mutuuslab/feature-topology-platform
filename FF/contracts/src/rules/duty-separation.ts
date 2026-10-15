// IAM 직무 분리 (보고서 v1.1 · FFG-PLT-016) — 요구 승인·출시(Release)·Kill 실행·복원 승인 권한을 서로 다른 계정에 둔다(겸직 계정 0건).
// 같은 명령의 요청자 ≠ 승인자는 흐름마다 집행한다(SOD-01~09, rules/access.ts). 긴급 권한(원격 종료 Kill 발행)은 발행 뒤 24시간 안에
// 그 명령에 관여하지 않은 사람이 사후 검토한다(SOD-11). 데모 계정(화면 역할 전환기의 사람)과 맡은 플랫폼 역할 표도 여기 둔다 — 감사 대상이다.
import { z } from 'zod';
import type { Role } from '../enums';

export type Duty = 'REQUIREMENT_APPROVAL' | 'RELEASE' | 'KILL_EXECUTION' | 'RESTORE_APPROVAL';

/** 분리할 직무와 그 권한을 주는 플랫폼 역할 */
export const DUTY_ROLES: Record<Duty, readonly Role[]> = {
  REQUIREMENT_APPROVAL: ['FEATURE_APPROVER', 'PRODUCT_APPROVER', 'BOM_APPROVER'],
  RELEASE: ['RELEASE_MANAGER'],
  KILL_EXECUTION: ['OPERATOR', 'OPS_LEAD'],
  RESTORE_APPROVAL: ['SAFETY_OFFICER', 'SECURITY_OFFICER'],
};

export const PostReviewBody = z.object({ summary: z.string().trim().min(4).max(1000) }).strict();
export type PostReviewBody = z.infer<typeof PostReviewBody>;

/** 긴급 권한 사용(Kill 발행) 사후 독립 검토 기한 */
export const POST_REVIEW_MS = 24 * 3_600_000;

/** 데모 IAM 계정(화면 역할 전환기) ↔ 플랫폼 역할 — 프론트 actor.ts가 그대로 쓴다 */
export const DEMO_PERSONAS: Record<string, Role[]> = {
  author: ['FEATURE_AUTHOR'], // Feature 설계
  approver: ['FEATURE_APPROVER', 'PRODUCT_APPROVER', 'RELEASE_MANAGER'], // 구성 승인
  quality: ['GATE_JUDGE', 'SAFETY_OFFICER'], // 품질 검토 (Gate 판정)
  operator: ['OPERATOR'], // 차량 운영
  // PLM 기준정보 (Baseline 승인권자) · 법규 담당 · 부 Safety Manager(개발과 독립) — 복원은 차단 승인자와 다른 FSM이 필요(FFG-DEAC-008)
  steward: ['BOM_APPROVER', 'VARIANT_OWNER', 'REGULATORY_OWNER', 'SAFETY_OFFICER'],
  commerce: ['PRODUCT_AUTHOR'], // 상품 권리
  integrator: ['IMPLEMENTER', 'SECURITY_OFFICER'], // 시스템 연계 · 사이버보안(CSM)
  coordinator: ['RELEASE_MANAGER', 'OPS_LEAD'], // 협의와 개발 이관 · 운영 리더(긴급 차단 2번째 승인)
  viewer: ['AUDITOR'], // 조회
};

export const dutiesOf = (roles: readonly Role[]): Duty[] => (Object.keys(DUTY_ROLES) as Duty[]).filter((d) => DUTY_ROLES[d].some((r) => roles.includes(r)));

/**
 * 겸직 계정 감사 — 두 직무 이상을 가진 계정.
 * @rule FFG-PLT-016 — 요구 승인·출시·Kill 실행·복원 승인 권한 분리(겸직 계정 0건)
 */
export function dutyConflicts(accounts: Record<string, readonly Role[]>): { account: string; duties: Duty[]; roles: Role[] }[] {
  return Object.entries(accounts)
    .map(([account, roles]) => ({ account, duties: dutiesOf(roles), roles: roles.filter((r) => Object.values(DUTY_ROLES).some((rs) => rs.includes(r))) }))
    .filter((x) => x.duties.length > 1);
}

/**
 * 긴급 권한 사후 검토 — 검토자는 그 명령의 요청자·승인자가 아니어야 한다.
 * @rule FFG-PLT-016 — 긴급 권한 사용 100%에 사후 독립 검토 기록
 */
export function postReviewBlocker(cmd: { requestedBy: string; approvers: string[] }, reviewer: string): string | null {
  if (reviewer === cmd.requestedBy) return '요청자는 자기 명령을 사후 검토할 수 없습니다';
  if (cmd.approvers.includes(reviewer)) return '승인자는 자기가 승인한 명령을 사후 검토할 수 없습니다';
  return null;
}
