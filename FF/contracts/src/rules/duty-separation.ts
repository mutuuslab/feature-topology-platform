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
  // 계정 수는 기능명세서(FP-DETAILED-1.1) 역할 9로 고정 — 겸직 0건이 되도록 9계정 안에서 직무를 나눈다(2026-10-17 결정)
  approver: ['FEATURE_APPROVER', 'PRODUCT_APPROVER', 'DOMAIN_REVIEWER', 'COST_APPROVER', 'COST_BASIS_ADMIN'], // 구성 승인 — 요구 승인만(출시는 협의 이관) · Feature DB 도메인 검토(의견만, 승인 아님) · SW 개발비 산정 승인·원가 기준 관리
  quality: ['GATE_JUDGE', 'SAFETY_OFFICER'], // 품질 검토 (Gate 판정) · Safety Manager(FSM)
  operator: ['OPERATOR'], // 차량 운영 — Kill 실행
  steward: ['BOM_APPROVER', 'VARIANT_OWNER', 'REGULATORY_OWNER', 'REFDB_ADMIN'], // PLM 기준정보 (Baseline 승인권자) · 법규 담당 · Feature DB 관리자
  commerce: ['PRODUCT_AUTHOR'], // 상품 권리
  // 시스템 연계 · 사이버보안(CSM) · 부 Safety Manager — 복원은 차단 승인자와 다른 FSM이 필요(FFG-DEAC-008). 둘 다 복원 승인 직무
  integrator: ['IMPLEMENTER', 'SECURITY_OFFICER', 'SAFETY_OFFICER'],
  coordinator: ['RELEASE_MANAGER'], // 협의와 개발 이관 · 출시(Release)
  viewer: ['AUDITOR', 'COST_ESTIMATOR', 'COST_VIEWER'], // 조회·산정 작성·열람(승인은 다른 사람)
  // 담당자 웨이브(2026-11-05 사용자 결정) — 9계정에 3계정을 더해 12계정, 겸직 0건 유지
  opslead: ['OPS_LEAD'], // 운영 리더 — 긴급 차단 승인·복원 승인의 운영 몫
  safety2: ['SAFETY_OFFICER'], // 두 번째 Safety Manager — 차단을 승인하지 않은 FSM이 복원을 승인한다
  productowner: ['PRODUCT_APPROVER'], // 상품 Owner — 구성 승인자와 다른 고객 출시 승인자
  // 시스템 관리자(D-GAP-1, 2026-11-07) — 13계정, 분리 직무 없음(겸직 0건 유지). 계정 비활성·소유자 이관만
  sysadmin: ['SYSTEM_ADMIN'],
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

/** Feature DB 변경 요청 직무 분리 규칙 ID(rules/access.ts SOD_RULES) — 화면 문구에는 쓰지 않는다 */
export type RefChangeDutyRule = 'SOD-13' | 'SOD-14' | 'SOD-15';

/**
 * Feature DB 변경 요청 직무 분리(30-95 §8.1) — 막히면 규칙 ID와 사유 문구, 아니면 null.
 *  · SOD-14: 요청자는 자기 요청을 검토할 수 없다(stage REVIEW)
 *  · SOD-13: 요청자는 자기 요청을 승인·반려할 수 없다(stage DECIDE)
 *  · SOD-15: 그 요청에 도메인 검토 의견을 낸 사람은 승인·반려할 수 없다(stage DECIDE, 2026-11-04 사용자 결정)
 * 사유 문구는 화면 버튼 이유로 그대로 보이므로 규칙 ID를 넣지 않는다.
 */
export function refChangeDuty(change: { requestedBy: string; reviews?: readonly { reviewerId: string }[] }, actorId: string, stage: 'REVIEW' | 'DECIDE'): { rule: RefChangeDutyRule; message: string } | null {
  if (actorId === change.requestedBy) return stage === 'REVIEW' ? { rule: 'SOD-14', message: '변경 요청자는 자기 요청을 검토할 수 없습니다' } : { rule: 'SOD-13', message: '변경 요청자는 자기 요청을 승인·반려할 수 없습니다' };
  if (stage === 'DECIDE' && change.reviews?.some((r) => r.reviewerId === actorId)) return { rule: 'SOD-15', message: '이 요청에 검토 의견을 낸 사람은 승인·반려할 수 없습니다' };
  return null;
}

/** refChangeDuty의 사유 문구만 — 화면이 버튼을 막을 때 쓴다 */
export function refChangeDutyBlocker(change: { requestedBy: string; reviews?: readonly { reviewerId: string }[] }, actorId: string, stage: 'REVIEW' | 'DECIDE'): string | null {
  return refChangeDuty(change, actorId, stage)?.message ?? null;
}

/**
 * 긴급 권한 사후 검토 — 검토자는 그 명령의 요청자·승인자가 아니어야 한다.
 * @rule FFG-PLT-016 — 긴급 권한 사용 100%에 사후 독립 검토 기록
 */
/** SW 개발비 산정 직무 분리(20-94 §4, SOD-16) — 과제 작성자는 자기 과제를 승인·반려할 수 없다. 막히면 사유, 아니면 null */
export function costApprovalDutyBlocker(project: { createdBy: string }, actorId: string): string | null {
  return actorId === project.createdBy ? '산정 과제 작성자는 자기 과제를 승인·반려할 수 없습니다' : null;
}
export function postReviewBlocker(cmd: { requestedBy: string; approvers: string[] }, reviewer: string): string | null {
  if (reviewer === cmd.requestedBy) return '요청자는 자기 명령을 사후 검토할 수 없습니다';
  if (cmd.approvers.includes(reviewer)) return '승인자는 자기가 승인한 명령을 사후 검토할 수 없습니다';
  return null;
}
