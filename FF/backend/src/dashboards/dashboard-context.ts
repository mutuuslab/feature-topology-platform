import { DEPARTMENT_IDS, departmentPersonas } from '@ff/contracts';
import type { Request } from 'express';
import type { Actor } from '../kernel/actor';
import { AuthService } from '../kernel/auth/auth.service';
import { DomainError } from '../kernel/errors';

export type DashboardActor = Actor & { departmentId?: string };
export const dashboardRoles = (actor: Actor) => actor.roles?.length ? actor.roles : [actor.role];
export const dashboardAdmin = (actor: Actor) => dashboardRoles(actor).includes('SYSTEM_ADMIN');
export function checkDashboardDepartment(id: string) {
  if (!DEPARTMENT_IDS.includes(id)) throw new DomainError('VALIDATION', '업무 모델에 없는 부서입니다.');
}

/** Department is presentation scope, never an IAM role. OIDC headers/query cannot grant it. */
export async function dashboardContext(auth: AuthService, req: Request, actor: Actor, requested?: string): Promise<DashboardActor> {
  if (requested) checkDashboardDepartment(requested);
  if (auth.mode === 'oidc') {
    const user = await auth.identify(req);
    const departmentId = user?.id === actor.id && user.department && DEPARTMENT_IDS.includes(user.department) ? user.department : undefined;
    if (requested && requested !== departmentId && !dashboardAdmin(actor)) throw new DomainError('FORBIDDEN', '확인된 소속 부서의 대시보드만 열 수 있습니다.');
    return { ...actor, departmentId: dashboardAdmin(actor) && requested ? requested : departmentId };
  }
  const persona = actor.id.startsWith('usr-') ? actor.id.slice(4) : '';
  const departments = DEPARTMENT_IDS.map((id) => ({ id, personas: departmentPersonas(id) })).filter((d) => d.personas.includes(persona));
  if (requested && !departments.some((d) => d.id === requested) && !dashboardAdmin(actor)) throw new DomainError('FORBIDDEN', '이 데모 계정의 소속 부서가 아닙니다.');
  return { ...actor, departmentId: requested ?? departments.find((d) => d.personas[0] === persona)?.id ?? departments[0]?.id };
}
