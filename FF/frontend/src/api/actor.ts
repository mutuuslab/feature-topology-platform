// 화면의 역할 전환기(레거시 9역할) ↔ 플랫폼 역할(상세설계서 표 6) 매핑.
// 한 사람(역할)이 여러 플랫폼 역할을 맡을 수 있다. 요청할 때는 그 경로가 허용하는 역할 중 맡은 것을 고른다.
//   데모 빌드: 행위자 ID도 화면 역할에서(데모 계정)
//   운영 빌드(SSO): 행위자는 로그인한 사용자이고, 역할은 IdP가 부여한 것 안에서만 고른다(서버도 같은 규칙으로 거부·감사)
import { DEMO_PERSONAS, type Role } from '@ff/contracts';
import { OIDC_AUTH } from '../auth-mode';
import { ssoUser } from '../auth-oidc';
import { SPEC_ROLES } from '../data/specNav';

/** 데모 계정 ↔ 플랫폼 역할 — 표는 contracts(DEMO_PERSONAS)에 있고 직무 분리 감사(FFG-PLT-016) 대상이다 */
export const PLATFORM_ROLES: Record<string, Role[]> = DEMO_PERSONAS;

export interface ActorHeaders {
  id: string;
  role: Role;
}

/** 경로가 허용하는 역할 중 이 사람이 맡은 것을 고른다. 없으면 대표 역할로 보내 서버가 거부·감사하게 한다. */
/** 이 화면 역할로 맡을 수 있는 플랫폼 역할 — SSO면 부여받은 것과의 교집합 */
export function rolesFor(legacyRole: string): Role[] {
  const persona = PLATFORM_ROLES[legacyRole] ?? ['AUDITOR'];
  if (!OIDC_AUTH) return persona;
  const granted = ssoUser()?.roles ?? [];
  const both = persona.filter((r) => granted.includes(r));
  return both.length ? both : granted;
}

/** SSO — 부여받은 역할로 쓸 수 있는 화면 역할(역할 전환기 목록) */
export function personasFor(granted: readonly Role[]): string[] {
  return Object.keys(PLATFORM_ROLES).filter((k) => PLATFORM_ROLES[k].some((r) => granted.includes(r)));
}

export function actorFor(legacyRole: string, allowed?: readonly Role[]): ActorHeaders {
  const mine = rolesFor(legacyRole);
  const role = allowed?.find((r) => mine.includes(r)) ?? mine[0] ?? 'AUDITOR';
  const id = OIDC_AUTH ? (ssoUser()?.id ?? 'anonymous') : (SPEC_ROLES.find((r) => r.key === legacyRole)?.id ?? 'usr-guest');
  return { id, role };
}

export function canAct(legacyRole: string, allowed: readonly Role[] | undefined): boolean {
  if (!allowed?.length) return true;
  return (OIDC_AUTH ? rolesFor(legacyRole) : (PLATFORM_ROLES[legacyRole] ?? [])).some((r) => allowed.includes(r));
}
