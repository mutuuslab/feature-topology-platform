// 장애·VOC 이력 연계 (D04-05) — 현장 장애(정비망·딜러)와 고객센터 VOC를 차량·Feature 단위 이력으로 모은다.
// 기능 불충분(SOTIF) 트리거면 'incident.sotif.triggered' 이벤트로 이상 징후(D06-12)에 넘긴다 — 이상 건 판정·차단 권고는 그쪽 규칙,
// 실제 차단은 사람의 요청과 2인 승인(Kill v2)이 한다. 장애 이력은 이상 건을 신호 ref(장애 ID)로 거꾸로 찾는다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query } from '@nestjs/common';
import { classifyVoc, CreateIncidentBody, sotifTrigger, type Incident } from '@ff/contracts';
import { z } from 'zod';
import { ExternalSystems } from '../../../adapters/if-mocks/external-systems';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';
import { AnomalyService } from '../../d06-qsec/anomaly-response/anomaly.service';

@Injectable()
@PlatformComponent('D04-05')
export class IncidentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ext: ExternalSystems,
    private readonly features: FeatureRepo,
    private readonly anomalies: AnomalyService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  list(q: { status?: string; featureId?: string; source?: string } = {}) {
    const rows = this.db.all<{ doc: string }>('SELECT doc FROM incident ORDER BY incident_id DESC').map((r) => JSON.parse(r.doc) as Incident);
    const field = this.anomalies.list({ kind: 'FIELD_SOTIF' });
    return rows
      .map((i) => {
        const a = field.find((x) => x.signals.some((s) => s.ref === i.incidentId));
        return a ? { ...i, anomalyId: a.anomalyId, status: i.status === 'OPEN' ? ('LINKED' as const) : i.status, anomaly: { severity: a.severity, advice: a.advice, status: a.status } } : { ...i, anomaly: null };
      })
      .filter((i) => (!q.status || i.status === q.status) && (!q.featureId || i.featureId === q.featureId) && (!q.source || i.source === q.source));
  }

  /** 접수 — SOTIF 트리거면 이상 징후로 넘긴다 (@rule FFG-SOT-003 운영 단계 SOTIF 모니터링) */
  create(actor: Actor, body: CreateIncidentBody, externalRef: string | null = null): Incident {
    if (body.featureId && !this.features.versions(body.featureId).length) throw new DomainError('NOT_FOUND', `${body.featureId}을(를) 찾을 수 없습니다.`);
    const sotif = sotifTrigger(body);
    const i: Incident = {
      incidentId: this.nextId(),
      source: body.source,
      externalRef,
      vin: body.vin,
      featureId: body.featureId,
      category: body.category,
      severity: body.severity,
      summary: body.summary,
      occurredAt: body.occurredAt ?? this.clock.iso(),
      receivedAt: this.clock.iso(),
      receivedBy: actor.id,
      sotif,
      anomalyId: null,
      status: 'OPEN',
    };
    this.db.tx(() => {
      this.db.run('INSERT INTO incident (incident_id, feature_id, status, source, external_ref, doc) VALUES (?, ?, ?, ?, ?, ?)', i.incidentId, i.featureId, i.status, i.source, externalRef, JSON.stringify(i));
      this.audit.record(actor, 'INCIDENT_RECEIVE', i.incidentId, { after: { source: i.source, featureId: i.featureId, category: i.category, severity: i.severity, sotif: sotif.trigger }, componentId: 'D04-05' });
      this.events.publish('incident.received', i.incidentId, { source: i.source, vin: i.vin, featureId: i.featureId, category: i.category, severity: i.severity }, { componentId: 'D04-05', correlationId: actor.correlationId });
      if (sotif.trigger)
        this.events.publish('incident.sotif.triggered', i.incidentId, { incidentId: i.incidentId, featureId: i.featureId, vin: i.vin, category: i.category, severity: i.severity, reason: sotif.reason }, { componentId: 'D04-05', correlationId: actor.correlationId });
    });
    return this.list().find((x) => x.incidentId === i.incidentId) ?? i;
  }

  /** 고객센터 VOC 가져오기 — 원문으로 범주를 추정하고 기능 이름으로 Feature를 찾는다(차량 국가 기준). 이미 가져온 VOC는 건너뛴다 */
  importVoc(actor: Actor) {
    const created: Incident[] = [];
    let skipped = 0;
    for (const v of this.ext.vocFeed()) {
      if (this.db.get('SELECT 1 FROM incident WHERE source = ? AND external_ref = ?', 'VOC', v.ref)) {
        skipped++;
        continue;
      }
      const featureId = v.featureName ? (this.features.all().find((f) => f.name.includes(v.featureName!) && f.country === 'KR')?.featureId ?? null) : null;
      created.push(this.create(actor, { source: 'VOC', vin: v.vin, featureId, category: classifyVoc(v.text), severity: v.severity, summary: v.text, occurredAt: null }, v.ref));
    }
    return { created, skipped };
  }

  private nextId() {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM incident')!.n + 1;
    return `INC-${String(n).padStart(5, '0')}`;
  }
}

@Controller('api/incidents')
export class IncidentController {
  constructor(private readonly svc: IncidentService) {}

  @Get()
  list(@Query('status') status?: string, @Query('featureId') featureId?: string, @Query('source') source?: string) {
    return { items: this.svc.list({ status, featureId, source }) };
  }

  @Post()
  @HttpCode(201)
  @Roles('OPERATOR', 'SYSTEM')
  @AuditAction('INCIDENT_RECEIVE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateIncidentBody)) body: CreateIncidentBody) {
    return this.svc.create(actor, body);
  }

  @Post('import-voc')
  @HttpCode(200)
  @Roles('OPERATOR', 'SYSTEM')
  @AuditAction('VOC_IMPORT')
  importVoc(@CurrentActor() actor: Actor, @Body(new ZodPipe(z.object({}).strict())) _b: object) {
    return this.svc.importVoc(actor);
  }
}
