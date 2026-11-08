import { Body, Controller, Get, Inject, Injectable, Param, Put, Req } from '@nestjs/common';
import { DashboardDepartmentDefaultBody, type DashboardDepartmentDefault } from '@ff/contracts';
import type { Request } from 'express';
import { CurrentActor, Roles, type Actor } from '../kernel/actor';
import { AuthService } from '../kernel/auth/auth.service';
import { AuditService } from '../kernel/audit.service';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { ZodPipe } from '../kernel/zod.pipe';
import { checkDashboardDepartment, dashboardAdmin, dashboardContext, type DashboardActor } from './dashboard-context';

@Injectable()
export class DashboardDefaultService {
  constructor(@Inject(DB) private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService) {}
  get(actor: DashboardActor, departmentId: string): DashboardDepartmentDefault {
    checkDashboardDepartment(departmentId);
    if (actor.departmentId !== departmentId && !dashboardAdmin(actor)) throw new DomainError('FORBIDDEN', '확인된 소속 부서의 기본판만 열 수 있습니다.');
    const row = this.db.get<{ department_id: string; mode: 'ROLE' | 'DEPARTMENT'; dashboard_id: string | null; version: number }>('SELECT * FROM dashboard_department_default WHERE department_id = ?', departmentId);
    return row ? { departmentId, mode: row.mode, dashboardId: row.dashboard_id, version: row.version } : { departmentId, mode: 'ROLE', dashboardId: null, version: 0 };
  }
  put(actor: DashboardActor, departmentId: string, body: DashboardDepartmentDefaultBody): DashboardDepartmentDefault {
    checkDashboardDepartment(departmentId);
    if (!dashboardAdmin(actor)) throw new DomainError('FORBIDDEN', '부서 기본판 배정은 시스템 관리자만 변경할 수 있습니다.');
    return this.db.tx(() => {
      const current = this.get(actor, departmentId);
      if (current.version !== body.version) throw new DomainError('PRECONDITION_FAILED', '다른 곳에서 부서 기본판이 바뀌었습니다. 다시 불러오세요.', { version: current.version });
      if (body.dashboardId) {
        const row = this.db.get<{ department_id: string | null }>('SELECT department_id FROM dashboard WHERE id = ?', body.dashboardId);
        if (!row || row.department_id !== departmentId) throw new DomainError('VALIDATION', '해당 부서에 공유한 대시보드만 기본판으로 지정할 수 있습니다.');
      }
      this.db.run('INSERT INTO dashboard_department_default (department_id, mode, dashboard_id, version, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (department_id) DO UPDATE SET mode=excluded.mode, dashboard_id=excluded.dashboard_id, version=excluded.version, updated_at=excluded.updated_at', departmentId, body.mode, body.dashboardId, current.version + 1, this.clock.iso());
      this.audit.record(actor, 'DASHBOARD_DEPARTMENT_DEFAULT', departmentId, { before: current, after: { ...body, version: current.version + 1 }, componentId: 'KERNEL' });
      return this.get(actor, departmentId);
    });
  }
}

@Controller('api/dashboard-departments')
export class DashboardDefaultController {
  constructor(private readonly defaults: DashboardDefaultService, private readonly auth: AuthService) {}
  @Get(':departmentId')
  async get(@CurrentActor() actor: Actor, @Req() req: Request, @Param('departmentId') id: string) { return this.defaults.get(await dashboardContext(this.auth, req, actor, id), id); }
  @Put(':departmentId')
  @Roles('SYSTEM_ADMIN')
  async put(@CurrentActor() actor: Actor, @Req() req: Request, @Param('departmentId') id: string, @Body(new ZodPipe(DashboardDepartmentDefaultBody)) body: DashboardDepartmentDefaultBody) { return this.defaults.put(await dashboardContext(this.auth, req, actor, id), id, body); }
}
