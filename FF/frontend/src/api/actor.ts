// 데모 IAM — 화면의 역할 전환기(레거시 9역할) ↔ 플랫폼 역할(상세설계서 표 6) 매핑.
// 한 사람(역할)이 여러 플랫폼 역할을 맡을 수 있다. 요청할 때는 그 경로가 허용하는 역할 중 맡은 것을 고른다.
import { DEMO_PERSONAS, type Role } from '@ff/contracts';
import { SPEC_ROLES } from '../data/specNav';

/** 데모 계정 ↔ 플랫폼 역할 — 표는 contracts(DEMO_PERSONAS)에 있고 직무 분리 감사(FFG-PLT-016) 대상이다 */
export const PLATFORM_ROLES: Record<string, Role[]> = DEMO_PERSONAS;

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
