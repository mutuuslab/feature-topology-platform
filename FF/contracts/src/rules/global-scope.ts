// 정책 글로벌 적용 조건 규칙(B7 (b)) — 등록 역할, 수정 권한(Feature Owner·시스템 관리자, FR-GLB-001-004), 조건 조회(브랜드·권역·법규).
import type { Role } from '../enums';
import type { Brand, PolicyGlobalScope } from '../schemas/global-scope';

/**
 * 시스템 관리자 역할 ID(D-GAP-1) — 역할 추가는 F0 묶음 몫이라 여기서는 이름으로만 비교한다(F0 병합 뒤 enums ROLES를 쓴다).
 * 역할 목록에 없는 동안에는 이 역할을 가진 계정이 없으므로 수정은 Feature Owner 본인만 된다.
 */
export const SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN';
/** 등록 — 정책을 쓰는 역할(정책 등록 역할과 같다). 수정은 역할이 아니라 Owner·시스템 관리자로 본다 */
export const GLOBAL_SCOPE_AUTHOR_ROLES: Role[] = ['FEATURE_AUTHOR', 'IMPLEMENTER'];

export type GlobalScopeEdit = { ok: true } | { ok: false; reason: string };
/** 수정 권한 — 해당 Feature의 Owner 또는 시스템 관리자 @req FR-GLB-001-004 */
export function canEditGlobalScope(actor: { id: string; roles: readonly string[] }, feature: { ownerId: string }): GlobalScopeEdit {
  if (actor.id === feature.ownerId || actor.roles.includes(SYSTEM_ADMIN_ROLE)) return { ok: true };
  return { ok: false, reason: `브랜드·권역 조건은 해당 Feature의 Owner(${feature.ownerId}) 또는 시스템 관리자만 수정할 수 있습니다.` };
}

export interface GlobalScopeQuery {
  brand?: Brand | string;
  regionCode?: string;
  ruleId?: string;
}
/** 조건으로 연계 정책 찾기 — 주어진 조건을 모두 만족(없는 조건은 무시), 정책 ID 순 @req FR-GLB-001-001 FR-GLB-001-003 */
export function matchGlobalScopes(all: readonly PolicyGlobalScope[], q: GlobalScopeQuery): PolicyGlobalScope[] {
  return all
    .filter((s) => (!q.brand || (s.brands as string[]).includes(q.brand)) && (!q.regionCode || s.regionCodes.includes(q.regionCode)) && (!q.ruleId || s.complianceRuleIds.includes(q.ruleId)))
    .sort((a, b) => a.policyId.localeCompare(b.policyId));
}
