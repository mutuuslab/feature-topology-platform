// Flag 코드 연결 API(20-97 §4.2) — 20개 경로. 저장소 설정은 출시 담당, PR·재스캔은 구현 담당, 해제 결정은 Feature 승인자·Safety Manager.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  CreateFlagPrBody,
  CreateFlagRemovalPrBody,
  CreateFlagRepositoryBody,
  FlagCoverageQuery,
  FlagGateWaiverBody,
  FlagGateWaiverDecisionBody,
  GithubWebhookBody,
  RescanFlagRepositoryBody,
  UpdateFlagRepositoryBody,
  UploadFlagScanBody,
} from '@ff/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, WebhookEndpoint, type Actor } from '../../../kernel/actor';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FlagCodeService } from './flag-code.service';
import { FlagCoverageService } from './flag-coverage.service';

const EmptyBody = z.object({}).strict();
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;

@Controller('api')
export class FlagCodeController {
  constructor(
    private readonly code: FlagCodeService,
    private readonly coverage: FlagCoverageService,
  ) {}

  // ── 대사·출시 관문 ──
  @Get('flag-code/coverage')
  flagCoverage(@Query(new ZodPipe(FlagCoverageQuery)) q: FlagCoverageQuery) {
    return this.coverage.coverage(q);
  }

  @Get('flag-code/coverage/:flagKey')
  flagCoverageDetail(@Param('flagKey') flagKey: string) {
    return this.coverage.detail(flagKey);
  }

  @Get('features/:id/versions/:ver/flag-code-gate')
  flagReleaseGate(@Param('id') id: string, @Param('ver') ver: string) {
    return this.coverage.gate(id, ver);
  }

  // ── 저장소 ──
  @Get('flag-code/repositories')
  repositories() {
    return this.code.repositories();
  }

  @Post('flag-code/repositories')
  @Roles('RELEASE_MANAGER')
  @AuditAction('FLAG_REPO_CREATE')
  createRepository(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateFlagRepositoryBody)) body: CreateFlagRepositoryBody) {
    return this.code.createRepository(actor, body);
  }

  @Patch('flag-code/repositories/:id')
  @Roles('RELEASE_MANAGER')
  @AuditAction('FLAG_REPO_UPDATE')
  updateRepository(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(UpdateFlagRepositoryBody)) body: UpdateFlagRepositoryBody) {
    return this.code.updateRepository(actor, id, body);
  }

  @Post('flag-code/repositories/:id/scans')
  @Roles('IMPLEMENTER', 'RELEASE_MANAGER')
  @AuditAction('FLAG_SCAN_REQUEST')
  rescan(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RescanFlagRepositoryBody)) body: RescanFlagRepositoryBody) {
    return this.code.rescan(actor, id, body);
  }

  // ── 스캔 ──
  @Get('flag-code/scans')
  scans(@Query() q: Record<string, unknown>) {
    const limit = one(q.limit);
    return this.code.scans({ repoId: one(q.repoId), status: one(q.status), trigger: one(q.trigger), limit: limit ? Number(limit) || undefined : undefined, cursor: one(q.cursor) });
  }

  @Get('flag-code/scans/:id')
  scanDetail(@Param('id') id: string) {
    return this.code.scanDetail(id);
  }

  @Post('flag-code/scans/upload')
  @Roles('IMPLEMENTER')
  @AuditAction('FLAG_SCAN_UPLOAD')
  upload(@CurrentActor() actor: Actor, @Body(new ZodPipe(UploadFlagScanBody)) body: UploadFlagScanBody) {
    return this.code.upload(actor, body);
  }

  /** GitHub App webhook — 행위자 헤더 대신 X-Hub-Signature-256(원문 바이트)으로 확인 */
  @Post('flag-code/webhooks/github')
  @WebhookEndpoint()
  async githubWebhook(@Req() req: Request & { rawBody?: Buffer }, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(GithubWebhookBody)) body: GithubWebhookBody) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const out = await this.code.webhook(req.headers, raw, body);
    res.status(out.status);
    return out.body;
  }

  // ── Flag PR ──
  @Get('flag-code/pull-requests')
  pullRequests(@Query() q: Record<string, unknown>) {
    return this.code.pullRequests({ repoId: one(q.repoId), featureId: one(q.featureId), kind: one(q.kind), state: one(q.state) });
  }

  @Post('flag-code/pull-requests')
  @Roles('IMPLEMENTER')
  @AuditAction('FLAG_PR_CREATE')
  createPr(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateFlagPrBody)) body: CreateFlagPrBody) {
    return this.code.createPr(actor, body);
  }

  @Post('flag-code/removal-pull-requests')
  @Roles('IMPLEMENTER')
  @AuditAction('FLAG_PR_CREATE')
  createRemovalPr(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateFlagRemovalPrBody)) body: CreateFlagRemovalPrBody) {
    return this.code.createRemovalPr(actor, body);
  }

  @Post('flag-code/pull-requests/:id/demo-merge')
  @HttpCode(200)
  @Roles('IMPLEMENTER')
  @AuditAction('FLAG_PR_DEMO_MERGE')
  demoMerge(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(EmptyBody)) _body: Record<string, never>) {
    return this.code.demoMerge(actor, id);
  }

  // ── 출시 차단 해제 ──
  @Get('flag-code/waivers')
  waivers(@Query() q: Record<string, unknown>) {
    return this.code.waivers({ featureId: one(q.featureId), state: one(q.state) });
  }

  @Post('flag-code/waivers')
  @Roles('IMPLEMENTER', 'RELEASE_MANAGER')
  @AuditAction('FLAG_WAIVER_REQUEST')
  requestWaiver(@CurrentActor() actor: Actor, @Body(new ZodPipe(FlagGateWaiverBody)) body: FlagGateWaiverBody) {
    return this.code.requestWaiver(actor, body);
  }

  @Post('flag-code/waivers/:id/decision')
  @HttpCode(200)
  @Roles('FEATURE_APPROVER', 'SAFETY_OFFICER')
  @AuditAction('FLAG_WAIVER_DECIDE')
  decideWaiver(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(FlagGateWaiverDecisionBody)) body: FlagGateWaiverDecisionBody) {
    return this.code.decideWaiver(actor, id, body);
  }

  // ── 평가 모니터링 ──
  @Get('flag-code/evaluations')
  evaluations(@Query() q: Record<string, unknown>) {
    return this.code.evaluations({ window: one(q.window), featureId: one(q.featureId), flagKey: one(q.flagKey), source: one(q.source) });
  }

  @Get('flag-code/evaluations/:flagKey')
  evaluationSeries(@Param('flagKey') flagKey: string, @Query('window') window?: string) {
    return this.code.evaluationSeries(flagKey, window);
  }
}
