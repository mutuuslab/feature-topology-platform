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
const READONLY_KEY = 'ff:readonly';
const ACTION_KEY = 'ff:action';
const VEHICLE_KEY = 'ff:vehicle';

/** 이 핸들러를 호출할 수 있는 역할 */
export const Roles = (...roles: RoleT[]) => SetMetadata(ROLES_KEY, roles);
/** 상태를 바꾸지 않는 POST(예: OFREP 평가) — 행위자 헤더 없이 익명 조회로 처리 */
export const ReadOnlyEndpoint = () => SetMetadata(READONLY_KEY, true);
/** 감사 이력에 남길 행위 이름 (없으면 'METHOD path') */
export const AuditAction = (action: string) => SetMetadata(ACTION_KEY, action);
/**
 * 차량 발신 요청 창구 — 사람 행위자 헤더 대신 차량 신원으로 식별한다(역할 VEHICLE, id `vehicle:<VIN>`).
 * 데모 신원은 X-Vehicle-Id 헤더다. 실제 배치에서는 mTLS를 끝내는 게이트웨이가 검증한 인증서 주체를 이 자리에 넣는다
 * (UL-044 serviceMTLS). 헤더 값만으로 인증서 체인 검증을 마쳤다고 주장하지 않는다(C47).
 */
export const VehicleEndpoint = () => SetMetadata(VEHICLE_KEY, true);
const WEBHOOK_KEY = 'ff:webhook';
/**
 * 외부 시스템 webhook 창구(GitLab·JIRA·codeBeamer) — 사람 행위자 헤더가 없다. 서명(비밀 토큰·HMAC)은 처리 서비스가 원문으로 확인하고,
 * 맞지 않으면 401로 거부한다. 받아들인 변경이 플랫폼 상태를 바꿀 때는 매핑된 사람 행위자로 다시 가드를 탄다(ext-sync).
 */
export const WebhookEndpoint = () => SetMetadata(WEBHOOK_KEY, true);

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
    if (this.reflector.getAllAndOverride<boolean>(READONLY_KEY, [ctx.getHandler(), ctx.getClass()])) {
      (req as Request & { actor?: Actor }).actor ??= { id: (req.header('x-actor-id') ?? '').trim() || 'anonymous-sdk', role: 'AUDITOR', correlationId: randomUUID() };
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(WEBHOOK_KEY, [ctx.getHandler(), ctx.getClass()])) {
      (req as Request & { actor?: Actor }).actor = { id: `webhook:${req.params?.system ?? 'unknown'}`, role: 'SYSTEM', correlationId: (req.header('x-correlation-id') ?? '').trim() || randomUUID() };
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(VEHICLE_KEY, [ctx.getHandler(), ctx.getClass()])) {
      const vehicleId = (req.header('x-vehicle-id') ?? '').trim();
      const correlationId = (req.header('x-correlation-id') ?? '').trim() || randomUUID();
      if (!vehicleId) {
        this.audit.denied({ id: 'vehicle:unknown', role: 'VEHICLE', correlationId }, 'VEHICLE_REQUEST', req.path, '차량 신원 없음');
        throw new DomainError('VEHICLE_UNAUTHENTICATED', '차량 요청에는 차량 신원(X-Vehicle-Id)이 필요합니다.');
      }
      (req as Request & { actor?: Actor }).actor = { id: `vehicle:${vehicleId}`, role: 'VEHICLE', correlationId };
      return true;
    }
    const actor = actorOf(req);
    const roles = this.reflector.getAllAndOverride<RoleT[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.includes(actor.role)) return true;
    const action = this.reflector.get<string | undefined>(ACTION_KEY, ctx.getHandler()) ?? `${req.method} ${req.route?.path ?? req.path}`;
    this.audit.denied(actor, action, req.path, `역할 ${ROLE_LABEL[actor.role]}은(는) 허용되지 않음 (허용: ${roles.map((x) => ROLE_LABEL[x]).join(', ')})`);
    throw new DomainError('FORBIDDEN', `${ROLE_LABEL[actor.role]} 역할로는 이 작업을 할 수 없습니다.`, { allowed: roles });
  }
}
