// Feature Registry·Lifecycle·Gate·BOM Baseline API (D01-01, D01-02)
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  BaselineDecisionBody,
  BaselineRequestBody,
  CreateFeatureBody,
  CreateVersionBody,
  JudgeGateBody,
  pageLimit,
  TransitionBody,
  UpdateDraftBody,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { GateService } from '../topology/gate.service';
import { BaselineService } from './baseline.service';
import { LifecycleService } from './lifecycle.service';
import { RegistryService } from './registry.service';

@Controller('api/features')
export class RegistryController {
  constructor(
    private readonly registry: RegistryService,
    private readonly lifecycle: LifecycleService,
    private readonly gates: GateService,
    private readonly baselines: BaselineService,
  ) {}

  @Get()
  list(@Query('q') q?: string, @Query('lifecycle') lifecycle?: string, @Query('country') country?: string, @Query('vehicleModel') vehicleModel?: string, @Query('latestOnly') latestOnly?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.registry.list({ q, lifecycle, country, vehicleModel, latestOnly: latestOnly === 'true', limit: pageLimit(limit), cursor });
  }

  @Post()
  @Roles('FEATURE_AUTHOR')
  @AuditAction('FEATURE_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateFeatureBody)) body: CreateFeatureBody) {
    return this.registry.create(actor, body);
  }

  @Get(':id')
  versions(@Param('id') id: string) {
    return this.registry.versions(id);
  }

  @Post(':id/versions')
  @Roles('FEATURE_AUTHOR')
  @AuditAction('FEATURE_VERSION_CREATE')
  createVersion(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(CreateVersionBody)) body: CreateVersionBody) {
    return this.registry.createVersion(actor, id, body);
  }

  @Get(':id/versions/:ver')
  detail(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string) {
    return this.registry.detail(id, ver, actor);
  }

  @Patch(':id/versions/:ver')
  @Roles('FEATURE_AUTHOR', 'SAFETY_OFFICER', 'VARIANT_OWNER', 'IMPLEMENTER')
  @AuditAction('FEATURE_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(UpdateDraftBody)) body: UpdateDraftBody) {
    return this.registry.updateDraft(actor, id, ver, body);
  }

  @Post(':id/versions/:ver/transitions')
  @HttpCode(200)
  @Roles('FEATURE_APPROVER', 'RELEASE_MANAGER', 'GATE_JUDGE')
  @AuditAction('FEATURE_TRANSITION')
  transition(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(TransitionBody)) body: TransitionBody) {
    return this.lifecycle.transition(actor, id, ver, body.to, body.reason);
  }

  @Get(':id/versions/:ver/gates')
  gateView(@Param('id') id: string, @Param('ver') ver: string) {
    return this.gates.view(id, ver);
  }

  @Post(':id/versions/:ver/gates')
  @Roles('GATE_JUDGE', 'SAFETY_OFFICER')
  @AuditAction('GATE_JUDGE')
  judge(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(JudgeGateBody)) body: JudgeGateBody) {
    return this.gates.judge(actor, id, ver, body);
  }

  @Get(':id/versions/:ver/baseline-checklist')
  checklist(@Param('id') id: string, @Param('ver') ver: string) {
    return { items: this.baselines.checklist(id, ver) };
  }
}

@Controller('api/baselines')
export class BaselineController {
  constructor(private readonly baselines: BaselineService) {}

  // 'requests' 경로를 ':id'보다 먼저 선언한다 (라우트 매칭 순서).
  @Get('requests')
  requests(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return { items: this.baselines.requests(status) };
  }

  @Post('requests')
  @Roles('FEATURE_AUTHOR')
  @AuditAction('BASELINE_REQUEST')
  request(@CurrentActor() actor: Actor, @Body(new ZodPipe(BaselineRequestBody)) body: BaselineRequestBody) {
    return this.baselines.request(actor, body);
  }

  @Get('requests/:rid')
  requestDetail(@Param('rid') rid: string) {
    return this.baselines.requestDetail(rid);
  }

  @Post('requests/:rid/decision')
  @HttpCode(200)
  @Roles('BOM_APPROVER')
  @AuditAction('BASELINE_DECISION')
  decide(@CurrentActor() actor: Actor, @Param('rid') rid: string, @Body(new ZodPipe(BaselineDecisionBody)) body: BaselineDecisionBody) {
    return this.baselines.decide(actor, rid, body);
  }

  @Get()
  list() {
    return { items: this.baselines.list() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.baselines.get(id);
  }
}
