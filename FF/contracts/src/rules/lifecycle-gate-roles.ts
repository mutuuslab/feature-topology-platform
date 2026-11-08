// Lifecycle·Gate API 권한 — 초기 브라우저 경로 표에서 서버 본문 검증기를 함께 싣지 않도록 작은 선언만 둔다.
import type { Role } from '../enums';

export const FEATURE_REJECTERS: Role[] = ['FEATURE_APPROVER'];
export const FEATURE_RETIRE_REQUESTERS: Role[] = ['FEATURE_AUTHOR', 'FEATURE_APPROVER', 'RELEASE_MANAGER'];
/** 요청자·작성자 외 Feature 승인자 또는 출시 담당자 */
export const FEATURE_RETIRE_APPROVERS: Role[] = ['FEATURE_APPROVER', 'RELEASE_MANAGER'];
/** N/A 요청 — Gate 판정자·기능안전 담당자 */
export const GATE_NA_REQUESTERS: Role[] = ['GATE_JUDGE', 'SAFETY_OFFICER'];
/** N/A 승인 — 요청자와 다른 기능안전 담당자 */
export const GATE_NA_APPROVERS: Role[] = ['SAFETY_OFFICER'];
