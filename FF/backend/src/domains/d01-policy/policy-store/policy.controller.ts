// 정책·검증·권한·대상·활성화·단계 배포 API (PoC ②③)
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CreatePolicyBody, DeclineTrialBody, OfferTrialsBody, PolicyDecisionBody, RestorePolicyRevisionBody, RolloutStageBody, SEGMENT_DIMENSIONS, UpdatePolicyBody } from '@ff/contracts';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { decodeCursor, encodeCursor, pageLimit } from '../../../kernel/paging';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { ActivationService } from '../activation/activation.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { StagedRolloutService } from '../staged-rollout/staged-rollout.service';
import { TargetingService } from '../targeting/targeting.service';
import { PolicyService } from './policy.service';

const ReasonBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();

@Controller('api/policies')
export class PolicyController {
  constructor(
    private readonly policies: PolicyService,
    private readonly rollout: StagedRolloutService,
  ) {}

  @Get()
  list(@Query('featureId') featureId?: string, @Query('status') status?: string, @Query('flagKey') flagKey?: string) {
    return { items: this.policies.list({ featureId, status, flagKey }) };
  }

  @Post()
  @Roles('FEATURE_AUTHOR', 'IMPLEMENTER')
  @AuditAction('POLICY_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreatePolicyBody)) body: CreatePolicyBody) {
    return this.policies.create(actor, body);
  }

  @Get('validations')
  validations(@Query('policyId') policyId?: string) {
    return { items: this.policies.history(policyId) };
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.policies.detail(id, actor);
  }

  @Patch(':id')
  @Roles('FEATURE_AUTHOR', 'IMPLEMENTER')
  @AuditAction('POLICY_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(UpdatePolicyBody)) body: UpdatePolicyBody) {
    return this.policies.update(actor, id, body);
  }

  @Get(':id/revisions')
  revisions(@Param('id') id: string) {
    return this.policies.revisions(id);
  }

  @Get(':id/revisions/:revision')
  revision(@Param('id') id: string, @Param('revision') revision: string) {
    return this.policies.revision(id, /^\d+$/.test(revision) ? Number(revision) : NaN);
  }

  @Post(':id/revisions/:revision/restore')
  @HttpCode(200)
  @Roles('FEATURE_AUTHOR', 'IMPLEMENTER')
  @AuditAction('POLICY_RESTORE')
  restore(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('revision') revision: string, @Body(new ZodPipe(RestorePolicyRevisionBody)) body: RestorePolicyRevisionBody) {
    return this.policies.restore(actor, id, /^\d+$/.test(revision) ? Number(revision) : NaN, body.reason);
  }

  @Get(':id/changes')
  changes(@Param('id') id: string) {
    return this.policies.changes(id);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @Roles('FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE')
  @AuditAction('POLICY_VALIDATE')
  validate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(z.object({}).strict())) _b: object) {
    return this.policies.validate(actor, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles('FEATURE_APPROVER')
  @AuditAction('POLICY_DECISION')
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(PolicyDecisionBody)) body: PolicyDecisionBody) {
    return this.policies.decide(actor, id, body);
  }

  @Post(':id/deploy')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER', 'OPERATOR')
  @AuditAction('POLICY_DEPLOY')
  deploy(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ReasonBody)) body: { reason: string }) {
    return this.policies.deploy(actor, id, body.reason);
  }

  @Post(':id/rollout')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER', 'OPERATOR')
  @AuditAction('ROLLOUT_STAGE')
  stage(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RolloutStageBody)) body: RolloutStageBody) {
    return this.rollout.stage(actor, id, body);
  }
}

@Controller('api')
export class RuntimeController {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly targeting: TargetingService,
    private readonly activation: ActivationService,
  ) {}

  /** limit을 주면 VIN 순 한 페이지(cursor = 이전 응답 nextCursor), 없으면 전체(뒤 호환). total·sample(5년 재생 표본 차량 수)은 늘 함께 —
   *  대시보드 가젯은 limit=1로 수만 읽는다(차량 10만 대 전체 목록이 24 MiB·요청당 수 초였다, 출시 준비 RD-P2-01) */
  @Get('vehicles')
  vehicles(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const counts = this.targeting.vehicleCounts();
    const n = pageLimit(limit);
    if (n === undefined) return { items: this.targeting.vehicles(), ...counts, nextCursor: null };
    let after: string | undefined;
    if (cursor) {
      const c = decodeCursor(cursor);
      if (!c || typeof c.v !== 'string') throw new DomainError('VALIDATION', '목록 커서를 읽을 수 없습니다. 처음 페이지부터 다시 불러오세요.', { field: 'cursor' });
      after = c.v;
    }
    const items = this.targeting.vehiclePage(n, after);
    return { items, ...counts, nextCursor: items.length === n ? encodeCursor({ v: items[items.length - 1].vin }) : null };
  }

  @Get('entitlements')
  grants(@Query('vin') vin?: string, @Query('source') source?: string) {
    return { items: this.entitlements.grants(vin, source) };
  }

  @Get('trials')
  trials(@Query() q: Record<string, string | undefined>) {
    const segment = Object.fromEntries(SEGMENT_DIMENSIONS.map((d) => [d, q[d]]));
    return this.entitlements.trials({ catalogId: q.catalogId, state: q.state, source: q.source, q: q.q, page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined, segment });
  }

  @Post('trials/offers')
  @HttpCode(201)
  @Roles('PRODUCT_AUTHOR', 'OPERATOR', 'SYSTEM')
  @AuditAction('TRIAL_OFFER')
  offerTrials(@CurrentActor() actor: Actor, @Body(new ZodPipe(OfferTrialsBody)) body: OfferTrialsBody) {
    return this.entitlements.offer(actor, body);
  }

  @Post('trials/:grantId/accept')
  @HttpCode(200)
  @Roles('OPERATOR', 'SYSTEM')
  @AuditAction('TRIAL_ACCEPT')
  acceptTrial(@CurrentActor() actor: Actor, @Param('grantId') grantId: string, @Body(new ZodPipe(z.object({}).strict())) _b: object) {
    return this.entitlements.accept(actor, grantId);
  }

  @Post('trials/:grantId/decline')
  @HttpCode(200)
  @Roles('OPERATOR', 'SYSTEM')
  @AuditAction('TRIAL_DECLINE')
  declineTrial(@CurrentActor() actor: Actor, @Param('grantId') grantId: string, @Body(new ZodPipe(DeclineTrialBody)) b: { reason?: string }) {
    return this.entitlements.decline(actor, grantId, b.reason);
  }

  @Get('targeting/cohort')
  cohort(@Query('flagKey') flagKey?: string, @Query('basisPoints') bp?: string) {
    if (!flagKey) throw new DomainError('VALIDATION', 'flagKey를 지정하세요.');
    return this.targeting.cohort(flagKey, bp ? Number(bp) : undefined);
  }

  @Get('activation/decide')
  decide(@Query('vin') vin?: string, @Query('flagKey') flagKey?: string) {
    if (!vin || !flagKey) throw new DomainError('VALIDATION', 'vin과 flagKey를 지정하세요.');
    return this.activation.decide(vin, flagKey);
  }
}
