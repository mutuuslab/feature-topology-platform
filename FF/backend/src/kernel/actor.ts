// 데모 IAM — 요청 헤더 X-Actor-Id / X-Actor-Role 로 행위자를 식별한다(실 IAM·SSO는 전사 공통서비스 연동 시 교체).
// 읽기(GET)는 헤더가 없으면 감사 조회자(AUDITOR)로 본다. 쓰기는 헤더가 반드시 있어야 한다.
// @Roles로 허용 역할을 선언하고, 거부는 감사 이력에 DENIED로 남긴다(상세설계서: 실패한 승인도 기록).
import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLE_LABEL, type Role as RoleT } from '@ff/contracts';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuditService } from './audit.service';
import { DomainError } from './errors';

export interface Actor {
  id: string;
  role: RoleT;
  correlationId: string;
}

const ROLES_KEY = 'ff:roles';
const ACTION_KEY = 'ff:action';

/** 이 핸들러를 호출할 수 있는 역할 */
export const Roles = (...roles: RoleT[]) => SetMetadata(ROLES_KEY, roles);
/** 감사 이력에 남길 행위 이름 (없으면 'METHOD path') */
export const AuditAction = (action: string) => SetMetadata(ACTION_KEY, action);

export function actorOf(req: Request): Actor {
  const r = req as Request & { actor?: Actor };
  if (r.actor) return r.actor;
  const id = (req.header('x-actor-id') ?? '').trim();
  const roleRaw = (req.header('x-actor-role') ?? '').trim();
  const correlationId = (req.header('x-correlation-id') ?? '').trim() || randomUUID();
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!id || !roleRaw) {
    if (write) throw new DomainError('UNAUTHENTICATED', '변경 요청에는 X-Actor-Id와 X-Actor-Role 헤더가 필요합니다.');
    return (r.actor = { id: 'anonymous', role: 'AUDITOR', correlationId });
  }
  const role = Role.safeParse(roleRaw);
  if (!role.success) throw new DomainError('UNAUTHENTICATED', `알 수 없는 역할입니다: ${roleRaw}`, { allowed: Role.options });
  return (r.actor = { id, role: role.data, correlationId });
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext) => actorOf(ctx.switchToHttp().getRequest()));

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const actor = actorOf(req);
    const roles = this.reflector.getAllAndOverride<RoleT[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.includes(actor.role)) return true;
    const action = this.reflector.get<string | undefined>(ACTION_KEY, ctx.getHandler()) ?? `${req.method} ${req.route?.path ?? req.path}`;
    this.audit.denied(actor, action, req.path, `역할 ${ROLE_LABEL[actor.role]}은(는) 허용되지 않음 (허용: ${roles.map((x) => ROLE_LABEL[x]).join(', ')})`);
    throw new DomainError('FORBIDDEN', `${ROLE_LABEL[actor.role]} 역할로는 이 작업을 할 수 없습니다.`, { allowed: roles });
  }
}
