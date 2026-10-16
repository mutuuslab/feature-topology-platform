// 품질 피드백 반영 (D04-06, PoC ⑥ → ① 되먹임) — 조치된 현장 이상(고장·보안)을 Feature 품질 피드백(FB)으로 남긴다.
// 피드백은 다음 Version이 해야 할 일(G5·G7 재판정, 가상검증 회귀 시나리오)을 적고, 문제난 Version보다 높은 Version이
// G5 Verification Gate PASS를 받으면 자동으로 해소된다. 상품·설계 담당은 피드백을 수용(ACCEPTED)해 작업으로 가져간다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { decidingScenariosFor, FeedbackAcceptBody, feedbackActions, versionAfter, type AnomalyKind, type QualityFeedback } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService, type PlatformEvent } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';
import { AnomalyRepo } from '../../d06-qsec/anomaly-response/anomaly.service';

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'quality-feedback' };

@Injectable()
@PlatformComponent('D04-06')
export class FeedbackService implements OnModuleInit {
  private readonly log = new Logger('QualityFeedback');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly anomalies: AnomalyRepo,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  onModuleInit() {
    this.events.stream(['anomaly.mitigated', 'gate.judged']).subscribe((e) => {
      try {
        this.on(e);
      } catch (err) {
        this.log.error(`${e.type} 처리 실패: ${(err as Error).message}`);
      }
    });
  }

  on(e: PlatformEvent) {
    const p = e.payload as Record<string, any>;
    if (e.type === 'anomaly.mitigated') return this.fromAnomaly(p.anomalyId);
    // gate.judged — aggregate는 'FEAT-xxxxx@ver'. 문제난 Version보다 높은 Version의 G5 PASS면 해소
    if (e.type === 'gate.judged' && p.gate === 'G5' && p.status === 'PASS') {
      const [featureId, version] = e.aggregate.split('@');
      for (const fb of this.list({ featureId }).filter((f) => f.status !== 'RESOLVED' && versionAfter(version, f.featureVersion))) this.resolve(fb, `${version} G5 PASS (${p.gateRecordId})`);
    }
  }

  /** 문제가 난 Version — 이 Feature의 배포(DEPLOYED) 정책이 가리키는 Version, 없으면 최신 Version */
  private fieldVersion(featureId: string): string | null {
    const deployed = this.policies.all().filter((x) => x.featureId === featureId && x.status === 'DEPLOYED');
    if (deployed.length) return deployed.map((x) => x.featureVersion).sort((a, b) => (versionAfter(a, b) ? -1 : 1))[0];
    return this.features.versions(featureId).at(-1)?.version ?? null;
  }

  fromAnomaly(anomalyId: string): QualityFeedback | null {
    const a = this.anomalies.get(anomalyId);
    if (!a || a.kind === 'DELIVERY') return null; // 전달 이상은 운영 조치로 끝난다
    const version = this.fieldVersion(a.featureId);
    if (!version) return null;
    const asil = this.features.get(a.featureId, version)?.asil ?? null;
    return this.db.tx(() => {
      const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM quality_feedback')!.n + 1;
      const fb: QualityFeedback = {
        feedbackId: `FB-${String(n).padStart(5, '0')}`,
        featureId: a.featureId,
        featureVersion: version,
        anomalyId,
        kind: a.kind as AnomalyKind,
        summary: `${a.kind === 'FEATURE_FAULT' ? '현장 고장' : '보안 이상'} — 차량 ${a.vins.length}대 · ${a.reasons.join(' / ')}${a.killId ? ` · 긴급 차단 ${a.killId}` : ''}`,
        actions: feedbackActions(a, { asil, virtualScenarios: decidingScenariosFor(a.featureId).map((s) => s.scenarioId) }),
        status: 'OPEN',
        createdAt: this.clock.iso(),
        acceptedBy: null,
        acceptedAt: null,
        resolvedAt: null,
        resolvedBy: null,
        note: null,
      };
      this.db.run('INSERT INTO quality_feedback (feedback_id, feature_id, status, doc) VALUES (?, ?, ?, ?)', fb.feedbackId, fb.featureId, fb.status, JSON.stringify(fb));
      this.audit.record(SYSTEM, 'QUALITY_FEEDBACK', fb.feedbackId, { after: { featureId: fb.featureId, featureVersion: fb.featureVersion, anomalyId, actions: fb.actions.map((x) => x.ref) }, componentId: 'D04-06' });
      this.events.publish('quality.feedback.created', fb.feedbackId, { feedbackId: fb.feedbackId, featureId: fb.featureId, featureVersion: fb.featureVersion, anomalyId, actions: fb.actions.map((x) => x.ref) }, { componentId: 'D04-06' });
      return fb;
    });
  }

  private save(fb: QualityFeedback) {
    this.db.run('UPDATE quality_feedback SET status = ?, doc = ? WHERE feedback_id = ?', fb.status, JSON.stringify(fb), fb.feedbackId);
  }

  private resolve(fb: QualityFeedback, note: string) {
    this.db.tx(() => {
      const next: QualityFeedback = { ...fb, status: 'RESOLVED', resolvedAt: this.clock.iso(), resolvedBy: SYSTEM.id, note };
      this.save(next);
      this.audit.record(SYSTEM, 'QUALITY_FEEDBACK_RESOLVE', fb.feedbackId, { before: { status: fb.status }, after: { status: 'RESOLVED' }, reason: note, componentId: 'D04-06' });
      this.events.publish('quality.feedback.resolved', fb.feedbackId, { feedbackId: fb.feedbackId, featureId: fb.featureId, note }, { componentId: 'D04-06' });
    });
  }

  accept(actor: Actor, id: string, reason: string) {
    const fb = this.get(id);
    if (fb.status !== 'OPEN') throw new DomainError('GUARD_FAILED', `열린(OPEN) 피드백만 수용할 수 있습니다 (현재 ${fb.status}).`);
    return this.db.tx(() => {
      const next: QualityFeedback = { ...fb, status: 'ACCEPTED', acceptedBy: actor.id, acceptedAt: this.clock.iso(), note: reason };
      this.save(next);
      this.audit.record(actor, 'QUALITY_FEEDBACK_ACCEPT', id, { before: { status: fb.status }, after: { status: 'ACCEPTED' }, reason, componentId: 'D04-06' });
      this.events.publish('quality.feedback.accepted', id, { feedbackId: id, featureId: fb.featureId }, { componentId: 'D04-06', correlationId: actor.correlationId });
      return next;
    });
  }

  get(id: string): QualityFeedback {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM quality_feedback WHERE feedback_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `품질 피드백 ${id}을(를) 찾을 수 없습니다.`);
    return JSON.parse(r.doc);
  }

  list(q: { featureId?: string; status?: string } = {}): QualityFeedback[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.featureId) (where.push('feature_id = ?'), params.push(q.featureId));
    if (q.status) (where.push('status = ?'), params.push(q.status));
    return this.db.all<{ doc: string }>(`SELECT doc FROM quality_feedback ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY feedback_id DESC`, ...params).map((r) => JSON.parse(r.doc));
  }
}

@Controller('api/quality-feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(@Query('featureId') featureId?: string, @Query('status') status?: string) {
    return { items: this.feedback.list({ featureId, status }) };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.feedback.get(id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Roles('FEATURE_AUTHOR', 'GATE_JUDGE', 'SAFETY_OFFICER')
  @AuditAction('QUALITY_FEEDBACK_ACCEPT')
  accept(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(FeedbackAcceptBody)) body: FeedbackAcceptBody) {
    return this.feedback.accept(actor, id, body.reason);
  }
}
