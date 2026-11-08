// 사건 범위 종료 차단·선택 해제(ADS-BE02)·영향 차량 산정(ADS-BE21) — D03-03/D03-04 위의 사건 단위 기록(P11a).
// · 차단 발행(kill.issued)마다 차량·Feature·사건별 종료 차단(termination_inhibit, 추가만)을 남기고, 복원 단계·해제(kill.restore-staged·kill.released)는
//   그 차단의 사건 행만 해제 행(추가만)으로 닫는다. 다른 사건의 차단이 남은 차량은 해제 뒤에도 차단 유지.
// · 선택 해제(rescind)는 지정 사건이 이 차단의 사건일 때만 — 다른 사건은 409(TC12). 해제 절차 자체는 복원 요청·2인 승인 그대로.
// · 영향 차량 산정: 사건의 차단 차량을 후보·구성 미확인·통신 미수신으로 나눈 스냅샷(고정, 추가만), 재평가는 새 스냅샷·이력, 확정 영향군은 분석 근거 필수.
// 차량 쪽 2.1 상태 보고의 inhibits[]·제어 책임(ddt_owner) 대조는 와이어 2.1 묶음 뒤에 붙인다.
import { Body, Controller, Get, Inject, Injectable, Logger, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import {
  classifyImpact,
  impactAccuracy,
  ImpactConfirmBody,
  ImpactReevaluateBody,
  inhibitSummary,
  RescindBody,
  type ImpactClass,
  type InhibitRow,
  type KillRequest,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { RestoreService } from '../restore/restore.service';
import { KILL_ROLES } from './kill.service';
import { KillRepo } from './kill.repo';

interface InhibitDbRow {
  id: number;
  vin: string;
  feature_id: string;
  incident_id: string;
  kill_id: string;
  set_at: string;
  released_at: string | null;
}
const incidentOf = (k: Pick<KillRequest, 'incidentId' | 'killId'>) => k.incidentId ?? k.killId;

@Injectable()
@PlatformComponent('D03-03')
export class TerminationService implements OnModuleInit {
  private readonly log = new Logger('Termination');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly kills: KillRepo,
    private readonly restore: RestoreService,
  ) {}

  onModuleInit() {
    this.events.stream(['kill.issued', 'kill.restore-staged', 'kill.released']).subscribe((e) => {
      try {
        const id = String((e.payload as { killId?: string }).killId ?? e.aggregate);
        if (e.type === 'kill.issued') this.set(id);
        else this.release(id);
      } catch (err) {
        this.log.error(`종료 차단 기록 실패: ${(err as Error).message}`);
      }
    });
  }

  /** 발행된 차단 — 차량 × 대상 Feature(의존 포함)마다 이 사건의 종료 차단 */
  set(killId: string) {
    const k = this.kills.get(killId);
    if (!k || k.status !== 'ACTIVE') return;
    const by = k.approvals?.at(-1)?.approverId ?? k.requestedBy;
    const at = this.clock.iso();
    this.db.tx(() => {
      for (const featureId of k.featureIds)
        for (const vin of k.vins)
          if (!this.db.get('SELECT 1 FROM termination_inhibit WHERE kill_id = ? AND vin = ? AND feature_id = ?', killId, vin, featureId))
            this.db.run('INSERT INTO termination_inhibit (vin, feature_id, incident_id, kill_id, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)', vin, featureId, incidentOf(k), killId, at, by);
    });
  }

  /** 복원한 차량의 이 사건 차단만 해제 — 다른 사건 행은 그대로 */
  release(killId: string) {
    const k = this.kills.get(killId);
    if (!k) return;
    const done = new Set(k.status === 'RELEASED' ? k.vins : (k.restoredVins ?? []));
    const rows = this.db.all<{ id: number; vin: string }>(
      'SELECT i.id, i.vin FROM termination_inhibit i WHERE i.kill_id = ? AND NOT EXISTS (SELECT 1 FROM termination_inhibit_release r WHERE r.inhibit_id = i.id)',
      killId,
    );
    const by = k.restoreRequest?.approvals.at(-1)?.approverId ?? k.releasedBy ?? 'system';
    const reason = k.restoreRequest?.reason ?? k.releaseReason ?? '복원';
    const at = this.clock.iso();
    this.db.tx(() => {
      for (const r of rows.filter((x) => done.has(x.vin)))
        this.db.run('INSERT INTO termination_inhibit_release (inhibit_id, incident_id, kill_id, released_at, released_by, reason) VALUES (?, ?, ?, ?, ?, ?)', r.id, incidentOf(k), killId, at, by, reason);
    });
  }

  rows(q: { featureId?: string; incidentId?: string }): InhibitRow[] {
    const where = q.featureId ? 'WHERE i.feature_id = ?' : q.incidentId ? 'WHERE i.incident_id = ?' : '';
    return this.db
      .all<InhibitDbRow>(
        `SELECT i.id, i.vin, i.feature_id, i.incident_id, i.kill_id, i.set_at, r.released_at FROM termination_inhibit i LEFT JOIN termination_inhibit_release r ON r.inhibit_id = i.id ${where} ORDER BY i.id LIMIT 20000`,
        ...(q.featureId ? [q.featureId] : q.incidentId ? [q.incidentId] : []),
      )
      .map((r) => ({ id: r.id, vin: r.vin, featureId: r.feature_id, incidentId: r.incident_id, killId: r.kill_id, setAt: r.set_at, releasedAt: r.released_at }));
  }

  /** 사건별 종료 차단 집합 + 차량별 남은 사건(ADS-UI02 목록) */
  inhibits(q: { featureId?: string; incidentId?: string }) {
    return inhibitSummary(this.rows(q));
  }

  /** 지정 사건 말고 다른 사건 차단이 남는 차량 */
  heldByOther(k: KillRequest, vins: readonly string[]) {
    const mine = incidentOf(k);
    const s = inhibitSummary(this.rows({ featureId: k.featureId }));
    const want = new Set(vins);
    return s.vehicles.filter((v) => want.has(v.vin)).map((v) => ({ vin: v.vin, incidents: v.incidents.filter((i) => i !== mine) })).filter((v) => v.incidents.length);
  }

  /** 선택 해제 — 이 차단의 사건만. 해제 절차는 복원 요청(확인 항목·Evidence·Cohort)·다른 2인 승인 그대로 */
  rescind(actor: Actor, killId: string, body: RescindBody) {
    const k = this.kills.get(killId);
    if (!k) throw new DomainError('NOT_FOUND', `차단 요청 ${killId}을(를) 찾을 수 없습니다.`);
    const { incidentId, ...restore } = body;
    if (incidentId !== incidentOf(k)) {
      throw new DomainError('CONFLICT', `다른 사건(${incidentId})의 차단은 이 차단(${killId}, 사건 ${incidentOf(k)})으로 해제할 수 없습니다.`, { code: 'OTHER_INCIDENT', incidentId: incidentOf(k) });
    }
    const detail = this.restore.request(actor, killId, restore);
    return { ...detail, heldByOther: this.heldByOther(k, restore.cohort) };
  }
}

interface ImpactSnapshot {
  setId: string;
  incidentId: string;
  kind: 'CANDIDATE' | 'CONFIRMED';
  calcId: string;
  configAsOf: string | null;
  vins: Record<ImpactClass, string[]> | string[];
  counts?: Record<ImpactClass, number>;
  createdBy: string;
  createdAt: string;
  reason: string | null;
  confirmedBy?: string;
  analysisRef?: string;
}

/** 영향 차량 산정(ADS-BE21) — 사건마다 고정 스냅샷(차단 발행 때 첫 산정)·재평가 이력·확정 영향군·식별 정확도 */
@Injectable()
@PlatformComponent('D03-03')
export class ImpactSetService implements OnModuleInit {
  private readonly log = new Logger('ImpactSet');
  constructor(
    private readonly events: EventService,
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly kills: KillRepo,
    private readonly fleet: FleetRepo,
  ) {}

  onModuleInit() {
    this.events.stream(['kill.issued']).subscribe((e) => {
      try {
        const k = this.kills.get(String((e.payload as { killId?: string }).killId ?? e.aggregate));
        if (k && !this.snapshots(incidentOf(k)).some((s) => s.kind === 'CANDIDATE')) this.compute({ id: 'system', role: 'SYSTEM', correlationId: 'impact-set' }, incidentOf(k), k.requestedAt, null);
      } catch (err) {
        this.log.error(`영향 차량 첫 산정 실패: ${(err as Error).message}`);
      }
    });
  }

  private incidentKills(incidentId: string): KillRequest[] {
    return this.kills.list().filter((k) => incidentOf(k) === incidentId && k.version === 2 && k.status !== 'REJECTED' && k.status !== 'REQUESTED' && k.status !== 'EXPIRED');
  }

  private snapshots(incidentId: string): ImpactSnapshot[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM impact_set WHERE incident_id = ? ORDER BY id', incidentId).map((r) => JSON.parse(r.doc) as ImpactSnapshot);
  }

  /** 마지막 연락 시각 — 게시본 회신·상태 보고 중 가장 늦은 것 */
  private lastContact(vin: string): string | null {
    const a = this.db.get<{ at: string | null }>('SELECT max(at) AS at FROM readback WHERE vin = ?', vin)?.at ?? null;
    const b = this.db.get<{ at: string | null }>('SELECT max(received_at) AS at FROM status_report WHERE vin = ?', vin)?.at ?? null;
    return [a, b].filter(Boolean).sort().at(-1) ?? null;
  }

  private compute(actor: Actor, incidentId: string, configAsOf: string, reason: string | null): ImpactSnapshot {
    const ks = this.incidentKills(incidentId);
    const vins = [...new Set(ks.flatMap((k) => k.vins))];
    const quality = new Map(this.fleet.vehiclesByVin(vins).map((v) => [v.vin, v.quality]));
    const classes = classifyImpact(vins, (vin) => ({ lastContactAt: this.lastContact(vin), quality: quality.get(vin) ?? 'UNTRUSTED' }), configAsOf);
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM impact_set')!.n + 1;
    const snap: ImpactSnapshot = {
      setId: `IMP-${String(n).padStart(5, '0')}`,
      incidentId,
      kind: 'CANDIDATE',
      calcId: `CALC-${String(n).padStart(5, '0')}`,
      configAsOf,
      vins: classes,
      counts: { CANDIDATE: classes.CANDIDATE.length, CONFIG_UNKNOWN: classes.CONFIG_UNKNOWN.length, NO_CONTACT: classes.NO_CONTACT.length },
      createdBy: actor.id,
      createdAt: this.clock.iso(),
      reason,
    };
    this.db.tx(() => {
      this.db.run('INSERT INTO impact_set (set_id, incident_id, kind, calc_id, created_by, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', snap.setId, incidentId, snap.kind, snap.calcId, snap.createdBy, snap.createdAt, JSON.stringify(snap));
      this.audit.record(actor, 'IMPACT_SET', incidentId, { after: { setId: snap.setId, counts: snap.counts, configAsOf }, reason: reason ?? '첫 산정', componentId: 'D03-03' });
    });
    return snap;
  }

  private view(incidentId: string) {
    const all = this.snapshots(incidentId);
    const cands = all.filter((s) => s.kind === 'CANDIDATE');
    const confirmed = all.filter((s) => s.kind === 'CONFIRMED').at(-1) ?? null;
    // 정확도의 기준 — 확정 때 본 후보 산정(그때의 마지막 스냅샷)
    const basis = (confirmed && cands.find((s) => s.setId === (confirmed as ImpactSnapshot & { basisSetId?: string }).basisSetId)) ?? null;
    return {
      incidentId,
      killIds: this.incidentKills(incidentId).map((k) => k.killId),
      current: cands.at(-1) ?? null,
      history: cands.map((s) => ({ setId: s.setId, calcId: s.calcId, configAsOf: s.configAsOf, counts: s.counts, createdBy: s.createdBy, createdAt: s.createdAt, reason: s.reason })),
      confirmed,
      accuracy: impactAccuracy(basis ? (basis.vins as Record<ImpactClass, string[]>).CANDIDATE : null, confirmed ? (confirmed.vins as string[]) : null),
    };
  }

  /** 조회(변경 없음) — 첫 산정은 차단 발행 때 고정된다 */
  get(incidentId: string) {
    if (!this.incidentKills(incidentId).length && !this.snapshots(incidentId).length) throw new DomainError('NOT_FOUND', `발행된 차단이 있는 사건 ${incidentId}을(를) 찾을 수 없습니다.`);
    return this.view(incidentId);
  }

  reevaluate(actor: Actor, incidentId: string, body: ImpactReevaluateBody) {
    this.get(incidentId);
    this.compute(actor, incidentId, body.configAsOf, body.reason);
    return this.view(incidentId);
  }

  confirm(actor: Actor, incidentId: string, body: ImpactConfirmBody) {
    const v = this.get(incidentId);
    if (body.calcId && v.history.some((h) => h.calcId === body.calcId)) {
      this.audit.failed(actor, 'IMPACT_CONFIRM', incidentId, `후보 산정 ${body.calcId} 복사로 확정 시도`, 'D03-03');
      throw new DomainError('CONFLICT', '후보 산정 결과를 그대로 확정 영향군으로 저장할 수 없습니다 — 원인 분석으로 확인한 차량을 근거와 함께 저장하세요.', { code: 'COPIED_CANDIDATE' });
    }
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM impact_set')!.n + 1;
    const snap: ImpactSnapshot = {
      setId: `IMP-${String(n).padStart(5, '0')}`,
      incidentId,
      kind: 'CONFIRMED',
      calcId: `CONF-${String(n).padStart(5, '0')}`,
      configAsOf: null,
      vins: [...new Set(body.vins)],
      createdBy: actor.id,
      createdAt: this.clock.iso(),
      reason: body.reason ?? null,
      confirmedBy: actor.id,
      analysisRef: body.analysisRef,
      ...(v.current ? { basisSetId: v.current.setId } : {}),
    };
    this.db.tx(() => {
      this.db.run('INSERT INTO impact_set (set_id, incident_id, kind, calc_id, created_by, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', snap.setId, incidentId, snap.kind, snap.calcId, snap.createdBy, snap.createdAt, JSON.stringify(snap));
      this.audit.record(actor, 'IMPACT_CONFIRM', incidentId, { after: { setId: snap.setId, vins: (snap.vins as string[]).length, analysisRef: body.analysisRef }, reason: body.reason ?? '확정 영향군', componentId: 'D03-03' });
    });
    return this.view(incidentId);
  }
}

const IMPACT_ROLES = ['SAFETY_OFFICER', 'OPS_LEAD', 'OPERATOR'] as const;

@Controller('api/termination')
export class TerminationController {
  constructor(private readonly term: TerminationService) {}

  @Get('inhibits')
  inhibits(@Query('featureId') featureId?: string, @Query('incidentId') incidentId?: string) {
    return this.term.inhibits({ featureId, incidentId });
  }
}

@Controller('api/kill-requests')
export class RescindController {
  constructor(private readonly term: TerminationService) {}

  @Post(':id/rescind')
  @Roles(...KILL_ROLES)
  @AuditAction('RESTORE_REQUEST')
  rescind(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RescindBody)) body: RescindBody) {
    return this.term.rescind(actor, id, body);
  }
}

@Controller('api/incidents')
export class ImpactSetController {
  constructor(private readonly impact: ImpactSetService) {}

  @Get(':id/impact-set')
  get(@Param('id') id: string) {
    return this.impact.get(id);
  }

  @Post(':id/impact-set/reevaluate')
  @Roles(...IMPACT_ROLES)
  @AuditAction('IMPACT_SET')
  reevaluate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ImpactReevaluateBody)) body: ImpactReevaluateBody) {
    return this.impact.reevaluate(actor, id, body);
  }

  @Post(':id/impact-set/confirm')
  @Roles('SAFETY_OFFICER', 'OPS_LEAD')
  @AuditAction('IMPACT_CONFIRM')
  confirm(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ImpactConfirmBody)) body: ImpactConfirmBody) {
    return this.impact.confirm(actor, id, body);
  }
}
