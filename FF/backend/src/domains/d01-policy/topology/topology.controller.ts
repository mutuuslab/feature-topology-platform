// Feature Topology API (D01-02) — 의존관계·그래프·사전점검·변경 영향
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateDependencyBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { TopologyService } from './topology.service';

@Controller('api')
export class TopologyController {
  constructor(private readonly topology: TopologyService) {}

  @Get('dependencies')
  list(@Query('featureId') featureId?: string, @Query('type') type?: string, @Query('verdict') verdict?: string) {
    return { items: this.topology.list({ featureId, type, verdict }) };
  }

  @Post('dependencies')
  @Roles('FEATURE_AUTHOR', 'VARIANT_OWNER')
  @AuditAction('DEPENDENCY_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateDependencyBody)) body: CreateDependencyBody) {
    return this.topology.create(actor, body);
  }

  @Get('topology/graph')
  graph(@Query('featureId') featureId?: string, @Query('depth') depth?: string) {
    return this.topology.graph(featureId, depth ? Number(depth) : 2);
  }

  @Get('precheck')
  precheck() {
    return this.topology.precheck();
  }

  @Get('impact/:id/:ver')
  impact(@Param('id') id: string, @Param('ver') ver: string, @Query('changed') changed?: string) {
    if (!/^FEAT-\d{5}$/.test(id)) throw new DomainError('VALIDATION', 'Feature ID 형식은 FEAT-NNNNN입니다.');
    return this.topology.impact(id, ver, changed ? changed.split(',') : []);
  }
}
