// Canary 관측(D01-08, 80-70 6장 2·3, BACKLOG TL-UI02·UI03·B01·B02) — Lake 집계(IF-15)로 적용군·대조군을 비교하고 사전 등록 중단 기준(규칙 ①)으로 판정한다.
// 자동으로 막는 것은 규칙뿐: 지표 지연(신선도 초과) → 확대 보류, 등록한 경계 초과 → 확대 중단. 모델 ③ 점수는 권고(Evidence)로만 붙인다(INV-17).
import { Body, Controller, Get, Inject, Injectable, Param, Put } from '@nestjs/common';
import {
  AbortCriteriaBody, CANARY_METRICS, DEFAULT_ABORT, effectiveBasisPoints, judgeCanary, modelUsable, type AbortCriteria, type CanaryArmStat, type CanaryObservation,
  type CanaryOverviewResponse, type CanaryRisk, type Policy,
} from '@ff/contracts';
import { abortCriteriaOf, modelUseOf } from '../../../adapters/lake/ff-lake-records';
import { LakeLink, type LakeCanaryDoc } from '../../../adapters/lake/lake-reader';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../policy-repos';
import { FeatureRepo } from '../repos';

/** 다음 확대 단계 — Canary 5% → 20% → 50% → 100% */
const STEPS = [500, 2000, 5000, 10000];
const r = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

@Injectable()
@PlatformComponent('D01-08')
export class CanaryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly lake: LakeLink,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 정책 하나의 관측 — Lake가 연결되지 않았거나 그 시장 집계가 Lake 계약에 없으면 null(판정 없음) */
  observe(p: Policy): CanaryObservation | null {
    const reader = this.lake.reader();
    const f = this.features.get(p.featureId, p.featureVersion);
    if (!reader || !f) return null;
    const market = f.country ?? 'KR';
    const bp = effectiveBasisPoints(p);
    const doc = reader.canary({ policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId, version: p.featureVersion, market, basisPoints: bp });
    if (!reader.datasets().some((d) => d.dataset === doc.meta.freshness.type)) return null;
    const registered = abortCriteriaOf(this.db, p.policyId);
    const criteria = registered ?? { ...DEFAULT_ABORT };
    const stats = this.stats(doc);
    const lag = doc.meta.freshness.lag_seconds;
    const lagMinutes = lag == null ? null : Math.round(lag / 60);
    const j = judgeCanary({ lagMinutes, vehicles: doc.vehicles.treatment, stats, criteria });
    const ceiling = effectiveBasisPoints({ ...p, stageBasisPoints: null });
    const next = STEPS.find((s) => s > bp && s <= ceiling) ?? null;
    return {
      policyId: p.policyId, featureId: p.featureId, version: p.featureVersion, flagKey: p.flagKey,
      stageBasisPoints: bp, nextBasisPoints: next, vehicles: doc.vehicles,
      series: doc.series.map((s) => ({ at: s.start, treatment: s.treatment, control: s.control })),
      stats,
      criteria: { metrics: criteria.metrics, confidence: criteria.confidence, observeHours: criteria.observeHours, maxLagMinutes: criteria.maxLagMinutes, registered: !!registered, registeredBy: registered?.registeredBy ?? null, registeredAt: registered?.registeredAt ?? null },
      verdict: j.verdict, breached: j.breached,
      freshness: LakeLink.freshness(doc.meta.freshness),
      risk: this.risk(doc),
    };
  }

  /** 상대위험(적용군/대조군 평균 비율)과 95% 신뢰구간 — 창 전체 사건 수의 로그 정규 근사 */
  private stats(doc: LakeCanaryDoc): CanaryArmStat[] {
    const avg = (arm: 'treatment' | 'control', m: (typeof CANARY_METRICS)[number]) => (doc.series.length ? doc.series.reduce((s, x) => s + x[arm][m], 0) / doc.series.length : 0);
    return CANARY_METRICS.map((m) => {
      const t = doc.events.treatment[m];
      const c = doc.events.control[m];
      const rt = avg('treatment', m);
      const rc = avg('control', m);
      const rr = rc > 0 ? rt / rc : 1;
      const se = t > 0 && c > 0 ? Math.sqrt(1 / t + 1 / c) : 2;
      return { metric: m, treatment: r(rt, 4), control: r(rc, 4), relativeRisk: r(rr, 2), ci: [r(rr * Math.exp(-1.96 * se), 2), r(rr * Math.exp(1.96 * se), 2)] };
    });
  }

  /** 모델 ③ 점수 — FF가 사용 승인한 판 중 최신, 없으면 최신 판을 '참고 불가'로 */
  private risk(doc: LakeCanaryDoc): CanaryRisk | null {
    const models = this.lake.reader()?.models() ?? [];
    const rows = doc.risks.map((x) => {
      const m = models.find((y) => y.model_id === x.model_id && y.version === x.version);
      const u = modelUseOf(this.db, x.model_id, x.version);
      return { modelId: x.model_id, version: x.version, score: x.score, factors: x.factors, usable: modelUsable({ use: u.use, drift: !!m?.drift }) };
    });
    return rows.find((x) => x.usable) ?? rows[0] ?? null;
  }

  /** 배포 중 정책 전부 */
  overview(): CanaryOverviewResponse {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, asOf: null, items: [] };
    const items = this.policies.all().filter((p) => p.status === 'DEPLOYED').map((p) => this.observe(p)).filter((x): x is CanaryObservation => !!x);
    return { connected: true, asOf: this.clock.iso(), items };
  }

  /** 중단 기준 사전 등록 — 추가만(이전 기준은 감사·표에 남는다) */
  register(actor: Actor, policyId: string, body: AbortCriteriaBody): AbortCriteria {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    if (p.status !== 'DEPLOYED' && p.status !== 'APPROVED') throw new DomainError('GUARD_FAILED', `승인·배포된 정책만 중단 기준을 등록합니다 (현재 ${p.status}).`);
    const before = abortCriteriaOf(this.db, policyId);
    const c: AbortCriteria = { policyId, metrics: body.metrics, confidence: body.confidence, observeHours: body.observeHours, maxLagMinutes: body.maxLagMinutes, registeredBy: actor.id, registeredAt: this.clock.iso() };
    this.db.tx(() => {
      this.db.run('INSERT INTO policy_abort_criteria (policy_id, doc, registered_by, registered_at) VALUES (?, ?, ?, ?)', policyId, JSON.stringify(c), actor.id, c.registeredAt);
      this.audit.record(actor, 'ABORT_CRITERIA', policyId, { before, after: c, reason: body.reason, componentId: 'D01-08' });
      this.events.publish('rollout.abort_criteria', policyId, { flagKey: p.flagKey, metrics: c.metrics, maxLagMinutes: c.maxLagMinutes }, { componentId: 'D01-08', correlationId: actor.correlationId });
    });
    return c;
  }
}

@Controller('api')
export class CanaryController {
  constructor(private readonly canary: CanaryService) {}

  @Get('canary')
  overview() {
    return this.canary.overview();
  }

  @Put('policies/:id/abort-criteria')
  @Roles('RELEASE_MANAGER', 'SAFETY_OFFICER')
  @AuditAction('ABORT_CRITERIA')
  register(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AbortCriteriaBody)) body: AbortCriteriaBody) {
    return this.canary.register(actor, id, body);
  }
}
