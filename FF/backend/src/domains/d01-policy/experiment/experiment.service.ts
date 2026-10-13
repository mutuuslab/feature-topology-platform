// 실험·효과 검증 관리 (D01-07) — 정책 하나를 대상으로 A/B(처리군만 적용) 또는 Shadow(판단만 계산, 적용 안 함) 실험을 등록·시작·종료하고 효과를 추정한다.
// 안전 관련(F2 이상) Feature는 Shadow만(FFG-CLS-006). 효과 수치는 모의 운영 데이터(실험 ID로 결정적)이고,
// Shadow는 실제 Fleet 차량마다 대상 정책(배포 가정)과 현재 배포 정책의 판단을 평가기로 대조한 일치율을 함께 낸다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { ConcludeExperimentBody, CreateExperimentBody, EXPERIMENT_METRICS, effectEstimate, effectVerdict, evaluateFlag, experimentAllowed, type Experiment, type ExperimentMetric, type Policy } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import { EntitlementService } from '../entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { FeatureRepo } from '../repos';

/** 모의 운영 데이터의 기준 비율 — 실험 ID로 정한 처리 효과를 더한다 */
const BASE: Record<ExperimentMetric, number> = { FAULT_RATE: 0.012, HARSH_DECEL_RATE: 0.04, ENGAGEMENT: 0.55, DECISION_AGREEMENT: 0.985 };
/** 실행 중 하루에 모이는 표본(차량-일) — 실험 기간이 짧으면 표본 부족(INSUFFICIENT)이 된다 */
const SAMPLES_PER_DAY = 900;

@Injectable()
export class ExperimentRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  get(id: string): Experiment | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM experiment WHERE experiment_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(q: { policyId?: string; status?: string } = {}): Experiment[] {
    return this.db
      .all<{ doc: string }>('SELECT doc FROM experiment ORDER BY experiment_id DESC')
      .map((r) => JSON.parse(r.doc) as Experiment)
      .filter((e) => (!q.policyId || e.policyId === q.policyId) && (!q.status || e.status === q.status));
  }
  save(e: Experiment) {
    this.db.run('INSERT INTO experiment (experiment_id, policy_id, status, doc) VALUES (?, ?, ?, ?) ON CONFLICT(experiment_id) DO UPDATE SET status = excluded.status, doc = excluded.doc', e.experimentId, e.policyId, e.status, JSON.stringify(e));
  }
  nextId() {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM experiment')!.n + 1;
    return `EXP-${String(n).padStart(5, '0')}`;
  }
}

@Injectable()
@PlatformComponent('D01-07')
export class ExperimentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExperimentRepo,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly safety: SafetyProfileService,
    private readonly fleet: FleetRepo,
    private readonly entitlements: EntitlementService,
    private readonly kills: KillRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  list(q: { policyId?: string; status?: string }) {
    return this.repo.list(q);
  }

  async detail(id: string) {
    const e = this.must(id);
    return { ...e, results: await this.results(e) };
  }

  /** @rule FFG-CLS-006 — 실험 등록 시 안전 분류(fClass)를 보고 F2 이상 A/B를 거부(Shadow만) */
  create(actor: Actor, body: CreateExperimentBody) {
    const p = this.policies.get(body.policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${body.policyId} 정책을 찾을 수 없습니다.`);
    const profile = this.safety.ensure(p.featureId, p.featureVersion);
    const allowed = experimentAllowed(body.type, profile.fClass, body.metric);
    if ('rule' in allowed) {
      this.audit.failed(actor, 'EXPERIMENT_CREATE', body.policyId, `${allowed.rule}: ${allowed.message}`, 'D01-07');
      throw new DomainError('GUARD_FAILED', allowed.message, { rule: allowed.rule, fClass: profile.fClass });
    }
    if (this.repo.list({ policyId: p.policyId }).some((e) => e.status === 'RUNNING' || e.status === 'DRAFT')) throw new DomainError('CONFLICT', `${p.policyId}에 진행 중인 실험이 있습니다.`);
    return this.db.tx(() => {
      const e: Experiment = {
        experimentId: this.repo.nextId(),
        policyId: p.policyId,
        flagKey: p.flagKey,
        featureId: p.featureId,
        featureVersion: p.featureVersion,
        fClass: profile.fClass,
        type: body.type,
        hypothesis: body.hypothesis,
        metric: body.metric,
        treatmentBp: body.treatmentBp,
        minSamples: body.minSamples,
        status: 'DRAFT',
        createdBy: actor.id,
        createdAt: this.clock.iso(),
        startedAt: null,
        concludedAt: null,
        decision: null,
        reason: null,
      };
      this.repo.save(e);
      this.audit.record(actor, 'EXPERIMENT_CREATE', e.experimentId, { after: { policyId: e.policyId, type: e.type, fClass: e.fClass, metric: e.metric }, componentId: 'D01-07' });
      this.events.publish('experiment.created', e.experimentId, { policyId: e.policyId, type: e.type, featureId: e.featureId }, { componentId: 'D01-07', correlationId: actor.correlationId });
      return e;
    });
  }

  start(actor: Actor, id: string) {
    const e = this.must(id);
    if (e.status !== 'DRAFT') throw new DomainError('GUARD_FAILED', `${id}은(는) ${e.status} — 초안만 시작할 수 있습니다.`);
    return this.transition(actor, { ...e, status: 'RUNNING', startedAt: this.clock.iso() }, 'EXPERIMENT_START', 'experiment.started');
  }

  async conclude(actor: Actor, id: string, body: z.infer<typeof ConcludeExperimentBody>) {
    const e = this.must(id);
    if (e.status !== 'RUNNING') throw new DomainError('GUARD_FAILED', `${id}은(는) ${e.status} — 실행 중인 실험만 종료할 수 있습니다.`);
    const r = await this.results(e);
    if (body.decision === 'ADOPT' && r && r.verdict !== 'BETTER' && r.verdict !== 'CONSISTENT') throw new DomainError('GUARD_FAILED', `효과가 확인되지 않아 채택할 수 없습니다 (${r.verdict}).`, { verdict: r.verdict });
    return this.transition(actor, { ...e, status: 'CONCLUDED', concludedAt: this.clock.iso(), decision: body.decision, reason: body.reason }, 'EXPERIMENT_CONCLUDE', 'experiment.concluded');
  }

  /** 효과 — 실행 일수만큼 모인 모의 표본으로 두 군 비교, Shadow는 실제 Fleet 판단 대조를 더한다 */
  async results(e: Experiment) {
    if (!e.startedAt) return null;
    const end = e.concludedAt ?? this.clock.iso();
    const days = Math.max(0, (Date.parse(end) - Date.parse(e.startedAt)) / 86400_000);
    const total = Math.floor(days * SAMPLES_PER_DAY);
    const treatN = Math.floor((total * e.treatmentBp) / 10000);
    const controlN = total - treatN;
    const seed = createHash('sha256').update(e.experimentId + e.policyId).digest().readUInt32BE(0);
    const effect = (((seed % 7) - 3) / 3) * BASE[e.metric] * 0.25; // ±25% 이내 처리 효과
    const rate = (p: number, salt: number) => (n: number) => Math.round(n * Math.min(0.999, Math.max(0.001, p + (((seed >> salt) % 5) - 2) * 0.0005)));
    const control = { n: controlN, events: rate(BASE[e.metric], 3)(controlN) };
    const treatment = { n: treatN, events: rate(BASE[e.metric] + effect, 7)(treatN) };
    const est = effectEstimate(control, treatment, e.minSamples);
    if (e.type === 'AB') return { days: Math.round(days * 10) / 10, metric: e.metric, metricKo: EXPERIMENT_METRICS[e.metric].ko, ...est, verdict: effectVerdict(e.metric, est), fleet: null };
    // Shadow — 처리군 판단 일치율 + 실제 Fleet 대조
    const fleet = await this.shadowFleet(e);
    const agreement = treatN ? treatment.events / treatN : 0;
    const verdict = treatN < e.minSamples ? 'INSUFFICIENT' : agreement >= 0.99 && fleet.agreement === 1 ? 'CONSISTENT' : 'DIVERGENT';
    return { days: Math.round(days * 10) / 10, metric: e.metric, metricKo: EXPERIMENT_METRICS[e.metric].ko, ...est, agreement: Math.round(agreement * 10000) / 10000, verdict, fleet };
  }

  /** Shadow 대조 — 실험 대상 정책을 배포 가정으로 평가한 값과 지금 그 flag의 배포 정책 값이 차량마다 같은가 */
  private async shadowFleet(e: Experiment) {
    const candidate = this.policies.get(e.policyId)!;
    const deployed = this.policies.all().find((p) => p.flagKey === candidate.flagKey && p.status === 'DEPLOYED' && p.policyId !== candidate.policyId) ?? null;
    const f = this.features.get(candidate.featureId, candidate.featureVersion)!;
    const scope = { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim };
    const rows = [];
    for (const vehicle of this.fleet.vehicles()) {
      const ent = this.entitlements.activeFor(vehicle.vin, candidate.featureId).active;
      const evalWith = (p: Policy | null) => (p ? evaluateFlag({ policy: { ...p, status: 'DEPLOYED' } as Policy, scope, killed: this.kills.killed(p.featureId, vehicle.vin), vehicle, entitlementActive: p.entitlementCatalogId ? ent : null }) : null);
      const shadow = await evalWith(candidate);
      const current = await evalWith(deployed);
      rows.push({ vin: vehicle.vin, shadow: shadow?.value ?? null, current: current?.value ?? null, same: !current || shadow?.value === current.value });
    }
    const same = rows.filter((r) => r.same).length;
    return { deployedPolicyId: deployed?.policyId ?? null, vehicles: rows.length, agreement: rows.length ? same / rows.length : 1, diverged: rows.filter((r) => !r.same) };
  }

  private must(id: string) {
    const e = this.repo.get(id);
    if (!e) throw new DomainError('NOT_FOUND', `${id} 실험을 찾을 수 없습니다.`);
    return e;
  }

  private async transition(actor: Actor, next: Experiment, action: string, event: string) {
    this.db.tx(() => {
      this.repo.save(next);
      this.audit.record(actor, action, next.experimentId, { after: { status: next.status, decision: next.decision }, componentId: 'D01-07' });
      this.events.publish(event, next.experimentId, { policyId: next.policyId, status: next.status, decision: next.decision }, { componentId: 'D01-07', correlationId: actor.correlationId });
    });
    return { ...next, results: await this.results(next) };
  }
}

@Controller('api/experiments')
export class ExperimentController {
  constructor(private readonly svc: ExperimentService) {}

  @Get()
  list(@Query('policyId') policyId?: string, @Query('status') status?: string) {
    return { items: this.svc.list({ policyId, status }) };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  @HttpCode(201)
  @Roles('FEATURE_AUTHOR', 'RELEASE_MANAGER')
  @AuditAction('EXPERIMENT_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateExperimentBody)) body: CreateExperimentBody) {
    return this.svc.create(actor, body);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER')
  @AuditAction('EXPERIMENT_START')
  start(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(z.object({}).strict())) _b: object) {
    return this.svc.start(actor, id);
  }

  @Post(':id/conclude')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER')
  @AuditAction('EXPERIMENT_CONCLUDE')
  conclude(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ConcludeExperimentBody)) body: z.infer<typeof ConcludeExperimentBody>) {
    return this.svc.conclude(actor, id, body);
  }
}
