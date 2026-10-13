// 데모 IAM — 화면의 역할 전환기(레거시 9역할) ↔ 플랫폼 역할(상세설계서 표 6) 매핑.
// 한 사람(역할)이 여러 플랫폼 역할을 맡을 수 있다. 요청할 때는 그 경로가 허용하는 역할 중 맡은 것을 고른다.
import type { Role } from '@ff/contracts';
import { SPEC_ROLES } from '../data/specNav';

export const PLATFORM_ROLES: Record<string, Role[]> = {
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

export interface ActorHeaders {
  id: string;
  role: Role;
}

/** 경로가 허용하는 역할 중 이 사람이 맡은 것을 고른다. 없으면 대표 역할로 보내 서버가 거부·감사하게 한다. */
export function actorFor(legacyRole: string, allowed?: readonly Role[]): ActorHeaders {
  const mine = PLATFORM_ROLES[legacyRole] ?? ['AUDITOR'];
  const role = allowed?.find((r) => mine.includes(r)) ?? mine[0];
  const id = SPEC_ROLES.find((r) => r.key === legacyRole)?.id ?? 'usr-guest';
  return { id, role };
}

export function canAct(legacyRole: string, allowed: readonly Role[] | undefined): boolean {
  if (!allowed?.length) return true;
  return (PLATFORM_ROLES[legacyRole] ?? []).some((r) => allowed.includes(r));
}
