// SW 개발비 산정 API(D07-01) — 경로는 contracts ROUTES(cost*). 읽기는 모든 역할이지만 금액은 산정 역할만(서버 투영, 20-94 §4).
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  AddCostFeatureBody,
  AddCostReferenceBody,
  UpdateCostReferenceBody,
  COST_MONEY_ROLES,
  CostBasisDraftBody,
  CostTransitionBody,
  CreateCostProjectBody,
  PutCostCheckBody,
  PutCostActualBody,
  PutCostMbdBody,
  UpdateCostLineBody,
  UpdateCostProjectBody,
} from '@ff/contracts';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { CostService } from './cost.service';

const ReasonBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();

@Controller('api/cost')
export class CostController {
  constructor(private readonly s: CostService) {}

  @Get('projects')
  list(@CurrentActor() actor: Actor) {
    return this.s.list(actor);
  }

  @Put('projects/:estId/actuals/:refId')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_ACTUAL_PUT')
  putActual(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Param('refId') refId: string, @Body(new ZodPipe(PutCostActualBody)) body: PutCostActualBody) {
    return this.s.putActual(actor, estId, refId, body);
  }

  @Get('calibration')
  @Roles('COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN')
  calibration(@CurrentActor() actor: Actor) {
    return this.s.calibration(actor);
  }

  @Post('projects')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_PROJECT_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateCostProjectBody)) body: CreateCostProjectBody) {
    return this.s.create(actor, body);
  }

  @Get('projects/:estId')
  detail(@CurrentActor() actor: Actor, @Param('estId') estId: string) {
    return this.s.detail(actor, estId);
  }

  @Patch('projects/:estId')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_PROJECT_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Body(new ZodPipe(UpdateCostProjectBody)) body: UpdateCostProjectBody) {
    return this.s.update(actor, estId, body);
  }

  @Get('references/:refId')
  @Roles(...COST_MONEY_ROLES)
  reference(@CurrentActor() actor:Actor,@Param('refId') refId:string,@Query('basisVersion') basisVersion?:string) {return this.s.reference(actor,refId,basisVersion);}

  @Get('projects/:estId/lines/:lineNo/sources/:revision')
  referenceHistory(@CurrentActor() actor:Actor,@Param('estId') estId:string,@Param('lineNo',ParseIntPipe) lineNo:number,@Param('revision',ParseIntPipe) revision:number) {return this.s.referenceHistory(actor,estId,lineNo,revision);}

  @Post('projects/:estId/references')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_REFERENCE_ADD')
  addReference(@CurrentActor() actor:Actor,@Param('estId') estId:string,@Body(new ZodPipe(AddCostReferenceBody)) body:AddCostReferenceBody) {return this.s.addReference(actor,estId,body);}

  @Patch('projects/:estId/lines/:lineNo/source')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_REFERENCE_UPDATE')
  updateReference(@CurrentActor() actor:Actor,@Param('estId') estId:string,@Param('lineNo',ParseIntPipe) lineNo:number,@Body(new ZodPipe(UpdateCostReferenceBody)) body:UpdateCostReferenceBody) {return this.s.updateReference(actor,estId,lineNo,body);}

  @Delete('projects/:estId/lines/:lineNo')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_LINE_REMOVE')
  removeLine(@CurrentActor() actor:Actor,@Param('estId') estId:string,@Param('lineNo',ParseIntPipe) lineNo:number) {return this.s.removeLine(actor,estId,lineNo);}

  @Post('projects/:estId/features')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_FEATURE_ADD')
  addFeature(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Body(new ZodPipe(AddCostFeatureBody)) body: AddCostFeatureBody) {
    return this.s.addFeature(actor, estId, body);
  }

  @Delete('projects/:estId/features/:featureId/:version')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_FEATURE_REMOVE')
  removeFeature(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Param('featureId') featureId: string, @Param('version') version: string) {
    return this.s.removeFeature(actor, estId, featureId, version);
  }

  @Patch('projects/:estId/lines/:lineNo')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_LINE_UPDATE')
  updateLine(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Param('lineNo', ParseIntPipe) lineNo: number, @Body(new ZodPipe(UpdateCostLineBody)) body: UpdateCostLineBody) {
    return this.s.updateLine(actor, estId, lineNo, body);
  }

  @Put('projects/:estId/mbd/:refId')
  @Roles('COST_ESTIMATOR')
  @AuditAction('COST_MBD_PUT')
  putMbd(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Param('refId') refId: string, @Body(new ZodPipe(PutCostMbdBody)) body: PutCostMbdBody) {
    return this.s.putMbd(actor, estId, refId, body);
  }

  @Post('projects/:estId/transitions')
  @Roles('COST_ESTIMATOR', 'COST_APPROVER')
  @AuditAction('COST_PROJECT_TRANSITION')
  transition(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Body(new ZodPipe(CostTransitionBody)) body: CostTransitionBody) {
    return this.s.transition(actor, estId, body);
  }

  @Put('projects/:estId/checks/:no')
  @Roles('COST_ESTIMATOR', 'COST_APPROVER')
  @AuditAction('COST_CHECK_PUT')
  putCheck(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Param('no', ParseIntPipe) no: number, @Body(new ZodPipe(PutCostCheckBody)) body: PutCostCheckBody) {
    return this.s.putCheck(actor, estId, no, body);
  }

  /** 엑셀 내보내기 — 경고(양식과 다른 계수 표·합친 줄)는 머리글 X-Cost-Export-Warnings(URI 인코딩 JSON 배열) */
  @Get('projects/:estId/export')
  @Roles('COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN')
  export(@CurrentActor() actor: Actor, @Param('estId') estId: string, @Res({ passthrough: true }) res: Response) {
    const r = this.s.export(actor, estId);
    res.setHeader('X-Cost-Export-Warnings', encodeURIComponent(JSON.stringify(r.warnings)));
    return new StreamableFile(r.buf, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="${r.filename}"`, length: r.buf.length });
  }

  @Get('basis')
  basisList() {
    return this.s.basisList();
  }

  @Get('basis/:version')
  @Roles('COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN')
  basis(@CurrentActor() actor: Actor, @Param('version') version: string) {
    return this.s.basisDetail(actor, version);
  }

  @Post('basis')
  @Roles('COST_BASIS_ADMIN')
  @AuditAction('COST_BASIS_DRAFT')
  basisDraft(@CurrentActor() actor: Actor, @Body(new ZodPipe(CostBasisDraftBody)) body: CostBasisDraftBody) {
    return this.s.basisDraft(actor, body);
  }

  @Post('basis/:version/publish')
  @Roles('COST_BASIS_ADMIN')
  @AuditAction('COST_BASIS_PUBLISH')
  basisPublish(@CurrentActor() actor: Actor, @Param('version') version: string, @Body(new ZodPipe(ReasonBody)) body: { reason: string }) {
    return this.s.basisPublish(actor, version, body.reason);
  }
}
