// Feature Topology API (D01-02) — 의존관계·그래프·사전점검·변경 영향
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateDependencyBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { TopologyService } from './topology.service';
import { RelationGuardService } from './relation-guard.service';

@Controller('api')
export class TopologyController {
  constructor(
    private readonly topology: TopologyService,
    private readonly guard: RelationGuardService,
  ) {}

  @Get('dependencies')
  list(@Query('featureId') featureId?: string, @Query('type') type?: string, @Query('verdict') verdict?: string) {
    return { items: this.topology.list({ featureId, type, verdict }) };
  }

  @Post('dependencies')
  @Roles('FEATURE_AUTHOR', 'VARIANT_OWNER')
  @AuditAction('DEPENDENCY_CREATE')
  async create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateDependencyBody)) body: CreateDependencyBody) {
    const dep = this.topology.create(actor, body);
    // excludes 동시 활성화 경고(FR-DEP-009-003) — 등록은 그대로, 정책·차량 단위 검사 결과를 함께 돌려준다
    const exclusion = await this.guard.warnOnCreate(actor, dep);
    return { ...dep, warnings: exclusion.conflict ? [exclusion] : [] };
  }

  @Get('dependencies/:id/exclusion-check')
  exclusionCheck(@Param('id') id: string) {
    return this.guard.exclusionCheck(id);
  }

  @Get('topology/graph')
  graph(@Query('featureId') featureId?: string, @Query('depth') depth?: string, @Query('types') types?: string, @Query('lifecycle') lifecycle?: string) {
    return this.topology.graph(featureId, depth ? Number(depth) : 2, { types: types ? types.split(',').filter(Boolean) : [], lifecycle: lifecycle ? lifecycle.split(',').filter(Boolean) : [] });
  }

  @Get('precheck')
  precheck() {
    return this.topology.precheck();
  }

  @Get('impact/:id/:ver')
  impact(@Param('id') id: string, @Param('ver') ver: string, @Query('changed') changed?: string) {
    if (!/^FEAT-\d{5}$/.test(id)) throw new DomainError('VALIDATION', 'Feature ID 형식은 FEAT-NNNNN입니다.');
    const r = this.topology.impact(id, ver, changed ? changed.split(',') : []);
    // 차량·정책·OTA 영향 범위(FR-DEP-003-001)
    const scope = this.guard.scope(id, r.dependents.map((d) => d.featureId));
    return { ...r, ...scope, summary: { ...r.summary, policies: scope.policies.length, livePolicies: scope.policies.filter((p) => p.live).length, vehicles: scope.vehicles.total, otaPackages: scope.ota.length } };
  }
}
