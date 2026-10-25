// 행위자 식별 — 두 방식(FF_AUTH, kernel/auth/auth-config.ts).
//  · demo(운영 모드가 아닐 때 기본): 요청 헤더 X-Actor-Id / X-Actor-Role. 읽기(GET)는 헤더가 없으면 감사 조회자(AUDITOR). 쓰기는 헤더 필수.
//  · oidc(운영 모드): 신원은 세션 쿠키(BFF) 또는 Bearer 접근 토큰에서만. X-Actor-Id는 무시하고, X-Actor-Role은 부여된 역할 중
//    하나를 고르는 데만 쓴다(부여되지 않은 역할 → 403·DENIED). 신원 없으면 401 — 익명 AUDITOR는 데모에만 있다(출시 준비 RD-SEC-01·04).
// @Roles로 허용 역할을 선언하고, 거부는 감사 이력에 DENIED로 남긴다(상세설계서: 실패한 승인도 기록).
import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLE_LABEL, type Role as RoleT } from '@ff/contracts';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuditService } from './audit.service';
import { authModeOf } from './auth/auth-config';
import { AuthService } from './auth/auth.service';
import { DomainError } from './errors';
import { VehicleAuthService } from './vehicle-auth';

export interface Actor {
  id: string;
  /** 이 요청에서 맡은 역할 */
  role: RoleT;
  /** 부여된 역할 전체 — oidc 세션·토큰에서(데모 헤더 인증·시스템 행위자는 비어 있을 수 있다) */
  roles?: RoleT[];
  correlationId: string;
}

const ROLES_KEY = 'ff:roles';
const READONLY_KEY = 'ff:readonly';
const ACTION_KEY = 'ff:action';
const VEHICLE_KEY = 'ff:vehicle';
const PUBLIC_KEY = 'ff:public';

/** 이 핸들러를 호출할 수 있는 역할 */
export const Roles = (...roles: RoleT[]) => SetMetadata(ROLES_KEY, roles);
/** 상태를 바꾸지 않는 POST(예: OFREP 평가) — 행위자 헤더 없이 익명 조회로 처리 */
export const ReadOnlyEndpoint = () => SetMetadata(READONLY_KEY, true);
/** 감사 이력에 남길 행위 이름 (없으면 'METHOD path') */
export const AuditAction = (action: string) => SetMetadata(ACTION_KEY, action);
/**
 * 차량 발신 요청 창구 — 사람 행위자 헤더 대신 차량 신원으로 식별한다(역할 VEHICLE, id `vehicle:<VIN>`).
 * 신원은 VehicleAuthService(RD-SEC-08)가 정한다: 차량 키에서 파생한 요청 CMAC(본문·시각·nonce 포함) 또는
 * mTLS를 끝내는 게이트웨이가 검증한 인증서 주체(신뢰 프록시 머리글, UL-044 serviceMTLS). 운영 모드는 둘 중 하나가 필수,
 * 데모 모드는 X-Vehicle-Id만 와도 받는다(서명 머리글이 있으면 확인). 머리글 값만으로 인증서 체인 검증을 마쳤다고 주장하지 않는다(C47).
 */
export const VehicleEndpoint = () => SetMetadata(VEHICLE_KEY, true);
const WEBHOOK_KEY = 'ff:webhook';
/**
 * 외부 시스템 webhook 창구(GitLab·JIRA·codeBeamer) — 사람 행위자 헤더가 없다. 서명(비밀 토큰·HMAC)은 처리 서비스가 원문으로 확인하고,
 * 맞지 않으면 401로 거부한다. 받아들인 변경이 플랫폼 상태를 바꿀 때는 매핑된 사람 행위자로 다시 가드를 탄다(ext-sync).
 */
export const WebhookEndpoint = () => SetMetadata(WEBHOOK_KEY, true);
/** 신원 없이 여는 창구 — 상태 점검(/api/health*)·로그인(/api/auth/*). oidc 모드에서도 401로 막지 않는다 */
export const PublicEndpoint = () => SetMetadata(PUBLIC_KEY, true);

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export function actorOf(req: Request): Actor {
  const r = req as Request & { actor?: Actor };
  if (r.actor) return r.actor;
  // oidc — 신원은 가드(RolesGuard)가 세션·토큰에서 정한다. 여기까지 왔으면 신원이 없는 것이다(헤더로 대신하지 않는다)
  if (authModeOf() === 'oidc') throw new DomainError('UNAUTHENTICATED', '로그인이 필요합니다. 회사 계정(SSO)으로 로그인하세요.');
  const id = (req.header('x-actor-id') ?? '').trim();
  const roleRaw = (req.header('x-actor-role') ?? '').trim();
  const correlationId = (req.header('x-correlation-id') ?? '').trim() || randomUUID();
  const write = !SAFE_METHODS.includes(req.method);
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
    private readonly auth: AuthService,
    private readonly vehicleAuth: VehicleAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
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
      const correlationId = (req.header('x-correlation-id') ?? '').trim() || randomUUID();
      const who = this.vehicleAuth.authenticate(req);
      (req as Request & { actor?: Actor; vehicleAuth?: string }).vehicleAuth = who.via;
      (req as Request & { actor?: Actor }).actor = { id: `vehicle:${who.vin}`, role: 'VEHICLE', correlationId };
      return true;
    }
    const roles = this.reflector.getAllAndOverride<RoleT[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (this.auth.mode === 'oidc') {
      if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
      await this.oidcActor(req, roles, ctx);
    }
    const actor = actorOf(req);
    if (!roles || roles.includes(actor.role)) return true;
    const action = this.reflector.get<string | undefined>(ACTION_KEY, ctx.getHandler()) ?? `${req.method} ${req.route?.path ?? req.path}`;
    this.audit.denied(actor, action, req.path, `역할 ${ROLE_LABEL[actor.role]}은(는) 허용되지 않음 (허용: ${roles.map((x) => ROLE_LABEL[x]).join(', ')})`);
    throw new DomainError('FORBIDDEN', `${ROLE_LABEL[actor.role]} 역할로는 이 작업을 할 수 없습니다.`, { allowed: roles });
  }

  /**
   * oidc — 세션·Bearer에서 신원을 정하고 맡을 역할을 고른다.
   *  · X-Actor-Role이 있으면 부여된 역할이어야 한다(아니면 403·DENIED). 없으면 이 경로가 허용하는 부여 역할 중 첫째
   *  · 쿠키로 인증한 변경 요청은 Origin이 설치 출처여야 한다(CSRF — 아니면 403)
   */
  private async oidcActor(req: Request, routeRoles: RoleT[] | undefined, ctx: ExecutionContext) {
    const correlationId = (req.header('x-correlation-id') ?? '').trim() || randomUUID();
    const who = await this.auth.identify(req);
    if (!who) throw new DomainError('UNAUTHENTICATED', '로그인이 필요합니다. 회사 계정(SSO)으로 로그인하세요.');
    const action = this.reflector.get<string | undefined>(ACTION_KEY, ctx.getHandler()) ?? `${req.method} ${req.route?.path ?? req.path}`;
    const base: Actor = { id: who.id, role: who.roles[0] ?? 'AUDITOR', roles: who.roles, correlationId };
    if (!who.roles.length) {
      this.audit.denied(base, action, req.path, '부여된 플랫폼 역할 없음(IdP 그룹이 OIDC_ROLE_MAP에 없음)');
      throw new DomainError('FORBIDDEN', '이 플랫폼의 역할이 없습니다. 관리자에게 IdP 그룹(역할) 부여를 요청하세요.');
    }
    if (who.via === 'session' && !SAFE_METHODS.includes(req.method) && !this.auth.originAllowed(req)) {
      this.audit.denied(base, action, req.path, '출처(Origin) 확인 실패 — 다른 사이트에서 보낸 변경 요청(CSRF)');
      throw new DomainError('FORBIDDEN', '요청 출처를 확인할 수 없습니다. 플랫폼 화면에서 다시 시도하세요.');
    }
    const asked = (req.header('x-actor-role') ?? '').trim();
    let role: RoleT;
    if (asked) {
      const parsed = Role.safeParse(asked);
      if (!parsed.success || !who.roles.includes(parsed.data)) {
        this.audit.denied(base, action, req.path, `부여되지 않은 역할 주장(${parsed.success ? ROLE_LABEL[parsed.data] : '알 수 없는 역할'})`);
        throw new DomainError('FORBIDDEN', '부여받지 않은 역할로는 요청할 수 없습니다.', { granted: who.roles });
      }
      role = parsed.data;
    } else role = (routeRoles && who.roles.find((r) => routeRoles.includes(r))) || who.roles[0];
    (req as Request & { actor?: Actor }).actor = { ...base, role };
  }
}
