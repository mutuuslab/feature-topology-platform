// 이상 징후 대응 (D06-12, PoC ⑥ 이상 확인) — 플랫폼 이벤트에서 현장 이상 신호를 모아 Feature별 이상 건(ANM)으로 묶는다.
//   차량 고장 보고(vehicle.fault.reported) → FEATURE_FAULT · 서명 게시본 거부 회신(vehicle.readback rejectReason) → SECURITY
//   · 배포 회신 이상(publication.closed DIVERGED/TIMEOUT/PARTIAL) → DELIVERY
// 심각도·권고는 contracts 규칙 표(classifyAnomaly). 긴급 차단이 이 이상 건을 가리켜 발령되면(kill.issued.anomalyId) 조치됨으로 닫는다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { AnomalyActionBody, classifyAnomaly, DELIVERY_STATUS, SECURITY_REJECT, STATUS_VIOLATION_SEVERITY, type Anomaly, type AnomalyKind, type AnomalySignal } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService, type PlatformEvent } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';
import { PublicationRepo } from '../secure-deploy/publication.repo';

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'anomaly-detector' };
const OPS_ROLES = ['OPERATOR', 'SAFETY_OFFICER'] as const;
const MAX_SIGNALS = 100;

@Injectable()
export class AnomalyRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  nextId() {
    return `ANM-${String(this.db.get<{ n: number }>('SELECT count(*) AS n FROM anomaly')!.n + 1).padStart(5, '0')}`;
  }
  get(id: string): Anomaly | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM anomaly WHERE anomaly_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  /** 같은 (종류, Feature)의 열린 이상 건 — 새 신호는 여기에 쌓는다 */
  open(kind: AnomalyKind, featureId: string): Anomaly | undefined {
    const r = this.db.get<{ doc: string }>("SELECT doc FROM anomaly WHERE kind = ? AND feature_id = ? AND status IN ('OPEN','ACKNOWLEDGED') ORDER BY anomaly_id DESC LIMIT 1", kind, featureId);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(q: { status?: string; kind?: string; featureId?: string } = {}): Anomaly[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.status) (where.push('status = ?'), params.push(q.status));
    if (q.kind) (where.push('kind = ?'), params.push(q.kind));
    if (q.featureId) (where.push('feature_id = ?'), params.push(q.featureId));
    return this.db.all<{ doc: string }>(`SELECT doc FROM anomaly ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY anomaly_id DESC`, ...params).map((r) => JSON.parse(r.doc));
  }
  save(a: Anomaly, insert: boolean) {
    if (insert) this.db.run('INSERT INTO anomaly (anomaly_id, kind, feature_id, status, doc) VALUES (?, ?, ?, ?, ?)', a.anomalyId, a.kind, a.featureId, a.status, JSON.stringify(a));
    else this.db.run('UPDATE anomaly SET status = ?, doc = ? WHERE anomaly_id = ?', a.status, JSON.stringify(a), a.anomalyId);
  }
}

@Injectable()
@PlatformComponent('D06-12')
export class AnomalyService implements OnModuleInit {
  private readonly log = new Logger('Anomaly');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly repo: AnomalyRepo,
    private readonly features: FeatureRepo,
    private readonly publications: PublicationRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  onModuleInit() {
    this.events.stream(['vehicle.fault.reported', 'vehicle.readback', 'publication.closed', 'kill.issued', 'vehicle.status.rejected', 'kill.overdue']).subscribe((e) => {
      try {
        this.on(e);
      } catch (err) {
        this.log.error(`${e.type} 처리 실패: ${(err as Error).message}`);
      }
    });
  }

  /** 이벤트 → 이상 신호 (관심 없는 이벤트는 무시) */
  on(e: PlatformEvent) {
    const p = e.payload as Record<string, any>;
    if (e.type === 'kill.issued') {
      if (p.anomalyId) this.close(SYSTEM, p.anomalyId, 'MITIGATED', `긴급 차단 ${p.killId} 발령`, p.killId);
      return;
    }
    // 상태 보고 v2 수신 검사 위반(D04-03) — 위조·재전송·해제 없는 ACTIVE 등(FFG-TEL-003·ADS-004)
    if (e.type === 'vehicle.status.rejected')
      return this.signal({ kind: 'SECURITY', featureId: p.featureId ?? '-', vin: p.vin ?? e.aggregate, code: p.code, severity: STATUS_VIOLATION_SEVERITY[p.code] ?? 'WARNING', at: e.at, ref: `STATUS:${p.step}` });
    // 차단 기한 초과 — 끝 상태에 닿지 않은 차량(FFG-SEC-004·DEAC-013)
    if (e.type === 'kill.overdue') {
      for (const vin of p.vins as string[]) this.signal({ kind: 'DELIVERY', featureId: p.featureId, vin, code: 'PENDING_OVERDUE', severity: 'WARNING', at: e.at, ref: p.killId });
      return;
    }
    if (e.type === 'vehicle.fault.reported') return this.signal({ kind: 'FEATURE_FAULT', featureId: p.featureId, vin: e.aggregate, code: p.code, severity: p.severity, at: e.at, ref: e.id });
    const pub = p.publicationId ? this.publications.get(p.publicationId) : undefined;
    if (!pub) return;
    if (e.type === 'vehicle.readback' && p.rejectReason)
      return this.signal({ kind: 'SECURITY', featureId: pub.payload.featureId, vin: e.aggregate, code: p.rejectReason, severity: SECURITY_REJECT[p.rejectReason] ?? 'WARNING', at: e.at, ref: pub.publicationId });
    if (e.type === 'publication.closed' && DELIVERY_STATUS[p.status])
      return this.signal({ kind: 'DELIVERY', featureId: pub.payload.featureId, vin: null, code: p.status, severity: DELIVERY_STATUS[p.status], at: e.at, ref: pub.publicationId });
  }

  private asil(featureId: string) {
    return this.features.versions(featureId).at(-1)?.asil ?? null;
  }

  signal(s: AnomalySignal) {
    this.db.tx(() => {
      const prev = this.repo.open(s.kind, s.featureId);
      const now = this.clock.iso();
      const base: Anomaly = prev ?? {
        anomalyId: this.repo.nextId(),
        kind: s.kind,
        featureId: s.featureId,
        status: 'OPEN',
        severity: 'INFO',
        advice: 'MONITOR',
        reasons: [],
        vins: [],
        signals: [],
        openedAt: now,
        updatedAt: now,
        acknowledgedBy: null,
        closedBy: null,
        closedAt: null,
        closeReason: null,
        killId: null,
      };
      const signals = [...base.signals, s].slice(-MAX_SIGNALS);
      const c = classifyAnomaly(s.kind, signals, { asil: this.asil(s.featureId) });
      const next: Anomaly = { ...base, signals, vins: [...new Set([...base.vins, ...(s.vin ? [s.vin] : [])])].sort(), severity: c.severity, advice: c.advice, reasons: c.reasons, updatedAt: now };
      this.repo.save(next, !prev);
      if (!prev || prev.severity !== next.severity) {
        this.audit.record(SYSTEM, prev ? 'ANOMALY_ESCALATE' : 'ANOMALY_OPEN', next.anomalyId, { before: prev ? { severity: prev.severity } : undefined, after: { kind: next.kind, featureId: next.featureId, severity: next.severity, advice: next.advice }, componentId: 'D06-12' });
        this.events.publish(prev ? 'anomaly.escalated' : 'anomaly.opened', next.anomalyId, { anomalyId: next.anomalyId, kind: next.kind, featureId: next.featureId, severity: next.severity, advice: next.advice, vins: next.vins.length }, { componentId: 'D06-12' });
      }
    });
  }

  require(id: string) {
    const a = this.repo.get(id);
    if (!a) throw new DomainError('NOT_FOUND', `이상 건 ${id}을(를) 찾을 수 없습니다.`);
    return a;
  }

  acknowledge(actor: Actor, id: string, reason: string) {
    const a = this.require(id);
    if (a.status !== 'OPEN') throw new DomainError('GUARD_FAILED', `열린(OPEN) 이상 건만 확인할 수 있습니다 (현재 ${a.status}).`);
    return this.db.tx(() => {
      const next: Anomaly = { ...a, status: 'ACKNOWLEDGED', acknowledgedBy: actor.id, updatedAt: this.clock.iso() };
      this.repo.save(next, false);
      this.audit.record(actor, 'ANOMALY_ACK', id, { before: { status: a.status }, after: { status: next.status }, reason, componentId: 'D06-12' });
      this.events.publish('anomaly.acknowledged', id, { anomalyId: id, featureId: a.featureId }, { componentId: 'D06-12', correlationId: actor.correlationId });
      return next;
    });
  }

  /** 조치됨(MITIGATED) 또는 기각(DISMISSED) — 조치된 고장·보안 이상은 품질 피드백(D04-06)으로 이어진다 */
  close(actor: Actor, id: string, status: 'MITIGATED' | 'DISMISSED', reason: string, killId: string | null = null) {
    const a = this.require(id);
    if (a.status !== 'OPEN' && a.status !== 'ACKNOWLEDGED') throw new DomainError('GUARD_FAILED', `이미 닫힌 이상 건입니다 (${a.status}).`);
    return this.db.tx(() => {
      const now = this.clock.iso();
      const next: Anomaly = { ...a, status, closedBy: actor.id, closedAt: now, closeReason: reason, killId: killId ?? a.killId, updatedAt: now };
      this.repo.save(next, false);
      this.audit.record(actor, status === 'MITIGATED' ? 'ANOMALY_MITIGATE' : 'ANOMALY_DISMISS', id, { before: { status: a.status }, after: { status, killId: next.killId }, reason, componentId: 'D06-12' });
      this.events.publish(status === 'MITIGATED' ? 'anomaly.mitigated' : 'anomaly.dismissed', id, { anomalyId: id, kind: a.kind, featureId: a.featureId, killId: next.killId }, { componentId: 'D06-12', correlationId: actor.correlationId });
      return next;
    });
  }

  list(q: { status?: string; kind?: string; featureId?: string }) {
    return this.repo.list(q);
  }
}

@Controller('api/anomalies')
export class AnomalyController {
  constructor(private readonly anomalies: AnomalyService) {}

  @Get()
  list(@Query('status') status?: string, @Query('kind') kind?: string, @Query('featureId') featureId?: string) {
    return { items: this.anomalies.list({ status, kind, featureId }) };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.anomalies.require(id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @Roles(...OPS_ROLES)
  @AuditAction('ANOMALY_ACK')
  acknowledge(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AnomalyActionBody)) body: AnomalyActionBody) {
    return this.anomalies.acknowledge(actor, id, body.reason);
  }

  @Post(':id/mitigate')
  @HttpCode(200)
  @Roles(...OPS_ROLES)
  @AuditAction('ANOMALY_MITIGATE')
  mitigate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AnomalyActionBody)) body: AnomalyActionBody) {
    return this.anomalies.close(actor, id, 'MITIGATED', body.reason);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @Roles(...OPS_ROLES)
  @AuditAction('ANOMALY_DISMISS')
  dismiss(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(AnomalyActionBody)) body: AnomalyActionBody) {
    return this.anomalies.close(actor, id, 'DISMISSED', body.reason);
  }
}
