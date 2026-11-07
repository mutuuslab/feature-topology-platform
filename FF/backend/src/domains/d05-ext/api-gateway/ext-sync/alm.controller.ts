// JIRA·codeBeamer 연계(80-50) API — 대사 실행·기록. 기존 연계 API(ext-sync.controller)와 나눠 둔다(병합 충돌을 줄이려고).
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { RunReconcileBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../../kernel/actor';
import { ZodPipe } from '../../../../kernel/zod.pipe';
import { AlmReconcileService } from './alm-reconcile.service';

@Controller()
export class AlmController {
  constructor(private readonly reconcile: AlmReconcileService) {}

  @Get('api/integrations/sync/reconcile-runs')
  runs() {
    return { items: this.reconcile.runs(30) };
  }

  @Post('api/integrations/sync/reconcile')
  @HttpCode(200)
  @Roles('SYSTEM', 'IMPLEMENTER')
  @AuditAction('EXT_SYNC_RECONCILE')
  run(@CurrentActor() actor: Actor, @Body(new ZodPipe(RunReconcileBody)) body: RunReconcileBody) {
    return this.reconcile.run(body.system, body.kind, actor);
  }
}
