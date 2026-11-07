// JIRA·codeBeamer 연계(80-50) API — 대사 실행·기록. 기존 연계 API(ext-sync.controller)와 나눠 둔다(병합 충돌을 줄이려고).
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RunReconcileBody } from '@ff/contracts';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../../kernel/actor';
import { ZodPipe } from '../../../../kernel/zod.pipe';
import { AlmReconcileService } from './alm-reconcile.service';
import { AlmWorkProductsService } from './alm-workproducts.service';

const EmptyBody = z.object({}).strict();

@Controller()
export class AlmController {
  constructor(
    private readonly reconcile: AlmReconcileService,
    private readonly wp: AlmWorkProductsService,
  ) {}

  /** codeBeamer 산출물 8종 — 작성률·승인·누락·의심(80-50 §5.4). 저장된 결과가 없으면 지금 읽는다 */
  @Get('api/alm/features/:id/:ver/work-products')
  workProducts(@Param('id') id: string, @Param('ver') ver: string) {
    return this.wp.get(id, ver);
  }

  @Post('api/alm/features/:id/:ver/work-products/refresh')
  @HttpCode(200)
  @Roles('SYSTEM', 'IMPLEMENTER', 'GATE_JUDGE', 'FEATURE_AUTHOR')
  refreshWorkProducts(@Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(EmptyBody)) _body: unknown) {
    return this.wp.refresh(id, ver);
  }

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
