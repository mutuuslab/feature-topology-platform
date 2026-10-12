// 플랫폼 인증·권한 관리 (D06-09) — 역할·권한표(ROUTES에서 파생)·직무 분리 규칙·거부 이력. 데모 인증은 X-Actor-* 헤더(실제는 전사 IAM/SSO).
// 권한 검사 자체는 커널 RolesGuard가 하고(거부는 DENIED 감사), 이 컴포넌트는 그 규칙과 결과를 보여 준다.
import { Controller, Get, Injectable, Query, Req } from '@nestjs/common';
import { HUMAN_ROLES, permissions, ROLE_LABEL, rolesView, SOD_RULES } from '@ff/contracts';
import type { Request } from 'express';
import { actorOf } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';

@Injectable()
@PlatformComponent('D06-09')
export class IamService {
  constructor(private readonly audit: AuditService) {}

  roles() {
    return { roles: rolesView(), humanRoles: HUMAN_ROLES, permissions: permissions(), sod: SOD_RULES };
  }

  /** 역할 밖 시도(DENIED) — 최근 순, 역할별 집계 */
  denials(limit = 100) {
    const items = this.audit.list({ result: 'DENIED', limit });
    const byRole: Record<string, number> = {};
    for (const d of items) byRole[d.actorRole] = (byRole[d.actorRole] ?? 0) + 1;
    return { items, byRole };
  }

  me(req: Request) {
    const a = actorOf(req);
    return { id: a.id, role: a.role, label: ROLE_LABEL[a.role], allowed: rolesView().find((r) => r.role === a.role)?.allowed ?? [] };
  }
}

@Controller('api/iam')
export class IamController {
  constructor(private readonly iam: IamService) {}

  @Get('roles')
  roles() {
    return this.iam.roles();
  }

  @Get('denials')
  denials(@Query('limit') limit?: string) {
    return this.iam.denials(limit ? Math.min(500, Number(limit) || 100) : 100);
  }

  @Get('me')
  me(@Req() req: Request) {
    return this.iam.me(req);
  }
}
