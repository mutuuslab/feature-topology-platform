// Feature 추적 연결 API(D01-02, P3) — 요구·설계 요소·인터페이스·Test Case·OTA 패키지 연결, Test Evidence, 커버리지
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateTestEvidenceBody, CreateTraceLinkBody, relationTypeCatalog, TEST_EVIDENCE_ROLES, TRACE_LINK_ROLES, UnlinkTraceLinkBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { TraceLinkService } from './trace-link.service';

@Controller('api')
export class TraceLinkController {
  constructor(private readonly trace: TraceLinkService) {}

  @Get('relation-types')
  relationTypes() {
    return { items: relationTypeCatalog() };
  }

  @Get('trace-links')
  list(@Query('featureId') featureId?: string, @Query('kind') kind?: string, @Query('elementType') elementType?: string, @Query('sourceSystem') sourceSystem?: string, @Query('status') status?: string) {
    return this.trace.list({ featureId, kind, elementType, sourceSystem, status });
  }

  @Post('trace-links')
  @Roles(...TRACE_LINK_ROLES)
  @AuditAction('TRACE_LINK_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateTraceLinkBody)) body: CreateTraceLinkBody) {
    return this.trace.create(actor, body);
  }

  @Post('trace-links/:id/unlink')
  @Roles(...TRACE_LINK_ROLES)
  @AuditAction('TRACE_LINK_UNLINK')
  unlink(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(UnlinkTraceLinkBody)) body: UnlinkTraceLinkBody) {
    return this.trace.unlink(actor, id, body);
  }

  @Post('trace-links/:id/evidence')
  @Roles(...TEST_EVIDENCE_ROLES)
  @AuditAction('TEST_EVIDENCE_CREATE')
  evidence(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(CreateTestEvidenceBody)) body: CreateTestEvidenceBody) {
    return this.trace.addEvidence(actor, id, body);
  }

  @Get('trace-sources/lookup')
  lookup(@Query('kind') kind?: string, @Query('elementId') elementId?: string, @Query('elementVersion') elementVersion?: string) {
    if (!kind || !elementId) throw new DomainError('VALIDATION', 'kind와 elementId가 필요합니다.');
    return this.trace.lookup(kind, elementId, elementVersion);
  }

  @Get('features/:id/trace-links')
  feature(@Param('id') id: string) {
    if (!/^FEAT-\d{5}$/.test(id)) throw new DomainError('VALIDATION', 'Feature ID 형식은 FEAT-NNNNN입니다.');
    return this.trace.featureSummary(id);
  }

  @Get('trace-coverage')
  coverage(@Query('filter') filter?: string) {
    return this.trace.coverage(filter || undefined);
  }
}
