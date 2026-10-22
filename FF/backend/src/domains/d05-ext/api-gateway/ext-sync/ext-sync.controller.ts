// 양방향 연계 API — 현황·추적·CR·충돌·보낼 함/받은 함, 정책 ↔ CR 연결, 외부 webhook 수신, 모의 외부 시스템.
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { EXT_SYSTEMS, HUMAN_ROLES, LinkChangeRequestBody, MockExtActionBody, MockExtCreateBody, ResolveConflictBody, type ExtKind, type ExtSystem } from '@ff/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, WebhookEndpoint, type Actor } from '../../../../kernel/actor';
import { DomainError } from '../../../../kernel/errors';
import { ZodPipe } from '../../../../kernel/zod.pipe';
import { ExtSyncService } from './ext-sync.service';

const systemOf = (s: string): ExtSystem => {
  const up = s.toUpperCase() as ExtSystem;
  if (!(EXT_SYSTEMS as readonly string[]).includes(up)) throw new DomainError('NOT_FOUND', `알 수 없는 외부 시스템입니다: ${s} (gitlab·jira·codebeamer)`);
  return up;
};
const EmptyBody = z.object({}).strict();

@Controller()
export class ExtSyncController {
  constructor(private readonly s: ExtSyncService) {}

  @Get('api/integrations/sync')
  summary() {
    return { items: this.s.summary(), ownership: this.s.ownership() };
  }

  @Get('api/integrations/sync/features/:id/:ver')
  trace(@Param('id') id: string, @Param('ver') ver: string) {
    return this.s.featureTrace(id, ver);
  }

  @Get('api/integrations/sync/epics')
  epics() {
    return { items: this.s.featureEpics() };
  }

  @Get('api/integrations/sync/change-requests')
  changeRequests() {
    return { items: this.s.changeRequests() };
  }

  @Get('api/integrations/sync/conflicts')
  conflicts(@Query('status') status?: string) {
    return { items: this.s.conflicts(status === 'OPEN' || status === 'RESOLVED' ? status : undefined) };
  }

  @Post('api/integrations/sync/conflicts/:id/resolve')
  @HttpCode(200)
  @Roles('IMPLEMENTER', 'RELEASE_MANAGER', 'FEATURE_APPROVER')
  @AuditAction('EXT_SYNC_CONFLICT_RESOLVE')
  resolve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ResolveConflictBody)) body: ResolveConflictBody) {
    return this.s.resolve(actor, Number(id), body.choose, body.reason);
  }

  @Get('api/integrations/sync/outbox')
  outbox(@Query('system') system?: string, @Query('status') status?: string) {
    return { items: this.s.jobs({ system: system ? systemOf(system) : undefined, status: (status as never) || undefined }) };
  }

  @Get('api/integrations/sync/inbox')
  inbox(@Query('system') system?: string, @Query('outcome') outcome?: string) {
    return { items: this.s.inbox({ system: system ? systemOf(system) : undefined, outcome: (outcome as never) || undefined }) };
  }

  @Post('api/integrations/sync/drain')
  @HttpCode(200)
  @Roles('SYSTEM', 'IMPLEMENTER')
  drain(@Body(new ZodPipe(EmptyBody)) _body: unknown) {
    return this.s.drain();
  }

  @Get('api/policies/:id/ext-links')
  policyLinks(@Param('id') id: string) {
    return { items: this.s.links('POLICY', id) };
  }

  @Post('api/policies/:id/change-request')
  @HttpCode(200)
  @Roles('FEATURE_AUTHOR', 'RELEASE_MANAGER')
  @AuditAction('EXT_CR_LINK')
  async linkCr(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(LinkChangeRequestBody)) body: LinkChangeRequestBody) {
    return { items: await this.s.linkChangeRequest(actor, id, body.crKey) };
  }

  /** 외부 시스템이 부른다 — 행위자 헤더 대신 서명으로 확인(서비스가 검증) */
  @Post('api/webhooks/:system')
  @HttpCode(202)
  @WebhookEndpoint()
  webhook(@Param('system') system: string, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    return this.s.ingest(systemOf(system), req.headers as Record<string, string | undefined>, req.body, raw);
  }

  @Get('api/integrations/mock/:system/items')
  mockItems(@Param('system') system: string, @Query('kind') kind?: string) {
    return { items: this.s.mockItems(systemOf(system), (kind as ExtKind) || undefined) };
  }

  @Post('api/integrations/mock/:system/act')
  @HttpCode(200)
  @Roles(...HUMAN_ROLES)
  mockAct(@Param('system') system: string, @Body(new ZodPipe(MockExtActionBody)) body: MockExtActionBody) {
    return this.s.mockAct(systemOf(system), body);
  }

  @Post('api/integrations/mock/:system/items')
  @HttpCode(201)
  @Roles(...HUMAN_ROLES)
  mockCreate(@Param('system') system: string, @Body(new ZodPipe(MockExtCreateBody)) body: MockExtCreateBody) {
    return this.s.mockCreate(systemOf(system), body);
  }
}
