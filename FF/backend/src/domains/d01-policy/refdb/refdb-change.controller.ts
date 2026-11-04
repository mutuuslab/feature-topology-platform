// Feature DB 변경 요청 API(D01-01 확장, 30-95 §8) — 경로·역할·본문은 contracts ROUTES(listRefChanges·refChangeDetail·createRefChange·
// reviewRefChange·decideRefChange·publishRefRelease). 추가 요청(requestRefAdd)은 등록 담당 컨트롤러(request-add.controller).
// 목록 질의: status·kind·refId + domain(요청이 다루는 도메인). 조회 응답의 벤치마크 필드는 산정 역할만(read-view).
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateRefChangeBody, DecideRefChangeBody, PublishRefReleaseBody, ReviewRefChangeBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { singleQuery } from '../../../kernel/paging';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { RefdbChangeService } from './refdb-change.service';

const one = (raw: unknown, field: string) => singleQuery(raw, field)?.trim() || undefined;

@Controller('api/refdb')
export class RefdbChangeController {
  constructor(private readonly changes: RefdbChangeService) {}

  @Get('changes')
  list(@CurrentActor() actor: Actor, @Query('status') status?: unknown, @Query('kind') kind?: unknown, @Query('refId') refId?: unknown, @Query('domain') domain?: unknown) {
    return this.changes.list(actor, { status: one(status, 'status'), kind: one(kind, 'kind'), refId: one(refId, 'refId'), domain: one(domain, 'domain') });
  }

  @Get('changes/:id')
  detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.changes.detail(actor, id);
  }

  @Post('changes')
  @Roles('FEATURE_AUTHOR', 'FEATURE_APPROVER', 'PRODUCT_AUTHOR', 'IMPLEMENTER', 'VARIANT_OWNER', 'REFDB_ADMIN', 'DOMAIN_REVIEWER')
  @AuditAction('REFDB_CHANGE_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateRefChangeBody)) body: CreateRefChangeBody) {
    return this.changes.create(actor, body);
  }

  @Post('changes/:id/reviews')
  @Roles('DOMAIN_REVIEWER')
  @AuditAction('REFDB_CHANGE_REVIEW')
  review(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ReviewRefChangeBody)) body: ReviewRefChangeBody) {
    return this.changes.review(actor, id, body);
  }

  @Post('changes/:id/decision')
  @Roles('REFDB_ADMIN')
  @AuditAction('REFDB_CHANGE_DECIDE')
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(DecideRefChangeBody)) body: DecideRefChangeBody) {
    return this.changes.decide(actor, id, body);
  }

  @Post('releases')
  @Roles('REFDB_ADMIN')
  @AuditAction('REFDB_RELEASE_PUBLISH')
  publish(@CurrentActor() actor: Actor, @Body(new ZodPipe(PublishRefReleaseBody)) body: PublishRefReleaseBody) {
    return this.changes.publish(actor, body);
  }
}
