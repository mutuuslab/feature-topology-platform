// 운행 중 감시 지표 (D04-03 텔레메트리 수집, 보고서 v1.1 13.4·13.5 · FFG-TEL-009) — 출시(DEPLOYED 정책) Feature Version마다 13.5절 지표 6종을
// 수신 검사를 통과한 status_report v2·Kill 시간 기록·기한 감시·보안 이벤트에서 계산하고, Safety Case 경보 기준(033, 추가만 — 최신 기록이 유효)과 비교한다.
// ADS 기능은 부속서 1 항목을 정기 보고 형식(기본 최근 365일)으로 집계한다. 분기는 90일, 주는 7일로 센다.
import { Body, Controller, Get, Inject, Injectable, Param, Put, Query } from '@nestjs/common';
import { annex1Report, computeMetrics, examplePlan, metricCoverage, MetricPlanBody, SAFETY_METRICS, type Annex1Id, type MetricInput, type MetricPlan } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { PolicyGateService } from '../../d03-safety/deploy-safety/policy-gate.service';
import { KillService } from '../../d03-safety/kill-switch/kill.service';

const DAY = 86_400_000;
const TERMINAL = new Set(['DISABLED', 'INACTIVE']);

@Injectable()
@PlatformComponent('D04-03')
export class SafetyKpiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly gate: PolicyGateService,
    private readonly kills: KillService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 출시 Feature Version — 배포된 정책의 Feature·Version */
  released() {
    const seen = new Map<string, { featureId: string; version: string }>();
    for (const p of this.policies.all()) if (p.status === 'DEPLOYED') seen.set(`${p.featureId}@${p.featureVersion}`, { featureId: p.featureId, version: p.featureVersion });
    return [...seen.values()].sort((a, b) => a.featureId.localeCompare(b.featureId) || a.version.localeCompare(b.version));
  }

  plan(featureId: string, version: string): MetricPlan {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM safety_metric_plan WHERE feature_id = ? AND version = ? ORDER BY id DESC LIMIT 1', featureId, version);
    return r ? (JSON.parse(r.doc) as MetricPlan) : examplePlan(featureId, version);
  }

  /** Safety Case 경보 기준 기록 — 빠진 지표는 직전 기준(없으면 예시값)을 잇는다 */
  recordPlan(actor: Actor, featureId: string, version: string, body: MetricPlanBody): MetricPlan {
    if (!this.gate.registryEntry(featureId, version)) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const prev = this.plan(featureId, version);
    const plan: MetricPlan = { featureId, version, source: 'SAFETY_CASE', thresholds: { ...prev.thresholds, ...body.thresholds }, recordedBy: actor.id, recordedAt: this.clock.iso() };
    this.db.tx(() => {
      this.db.run('INSERT INTO safety_metric_plan (feature_id, version, doc, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?)', featureId, version, JSON.stringify(plan), actor.id, plan.recordedAt);
      this.audit.record(actor, 'SAFETY_METRIC_PLAN', `${featureId}@${version}`, { before: prev, after: plan, componentId: 'D04-03' });
      this.events.publish('safety.metric.plan', featureId, { featureId, version, thresholds: plan.thresholds }, { componentId: 'D04-03', correlationId: actor.correlationId });
    });
    return plan;
  }

  /** Kill(차단) 기록 — 이 Version, 발행된 명령, 차량별 시간 기록·기한 초과 차량 */
  private deactivations(featureId: string, version: string) {
    return this.kills
      .list()
      .filter((k) => k.featureId === featureId && k.featureVersion === version && k.command)
      .map((k) => {
        const overdue = new Set<string>();
        for (const e of this.db.all<{ payload: string }>("SELECT payload FROM events WHERE type = 'kill.overdue' AND aggregate = ?", k.killId)) for (const v of (JSON.parse(e.payload) as { vins: string[] }).vins) overdue.add(v);
        return { kill: k, issuedAt: k.command!.issuedAt, overdue, items: this.kills.timeline(k.killId).items };
      });
  }

  private input(featureId: string, version: string): MetricInput {
    const now = this.clock.now().getTime();
    const iso = (ms: number) => new Date(ms).toISOString();
    const kills = this.deactivations(featureId, version);
    const killLatencyMs: number[] = [];
    const quarter = { total: 0, incomplete: 0, prevTotal: 0, prevIncomplete: 0 };
    for (const d of kills) {
      const t = Date.parse(d.issuedAt);
      for (const i of d.items) {
        const done = i.deactivate?.completed;
        if (done && t >= now - 90 * DAY) killLatencyMs.push(Date.parse(done.at) - t);
        if (d.kill.deactClass !== 'DC2') continue;
        const incomplete = !!i.deactivate?.mrc || d.overdue.has(i.vin) ? 1 : 0;
        if (t >= now - 90 * DAY) (quarter.total++, (quarter.incomplete += incomplete));
        else if (t >= now - 180 * DAY) (quarter.prevTotal++, (quarter.prevIncomplete += incomplete));
      }
    }
    const current = this.db.all<{ vin: string; state: string; doc: string }>('SELECT vin, state, doc FROM vehicle_feature_status WHERE feature_id = ?', featureId).map((r) => ({ vin: r.vin, state: r.state, doc: JSON.parse(r.doc) as { feature?: { version?: string }; persistence?: string } }));
    const pending = new Set<string>();
    for (const d of kills) for (const v of d.overdue) if (!TERMINAL.has(current.find((c) => c.vin === v)?.state ?? '')) pending.add(v);
    const week = (from: number, to: number) => {
      const rows = this.db.all<{ vin: string; doc: string }>('SELECT vin, doc FROM status_report WHERE feature_id = ? AND accepted = 1 AND received_at >= ? AND received_at < ?', featureId, iso(from), iso(to)).map((r) => ({ vin: r.vin, d: JSON.parse(r.doc) as { feature: { version: string }; state: string; reason: { source: string } } }));
      const mine = rows.filter((r) => r.d.feature?.version === version);
      return { vehicles: new Set(mine.map((r) => r.vin)).size, disabled: new Set(mine.filter((r) => r.d.state === 'DISABLED' && r.d.reason?.source === 'ONBOARD').map((r) => r.vin)).size };
    };
    const thisWeek = week(now - 7 * DAY, now + 1);
    const prevWeek = week(now - 14 * DAY, now - 7 * DAY);
    const proof = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM security_event WHERE event_id = 'STATE_PROOF_FAILURE' AND json_extract(doc, '$.featureId') = ? AND at >= ?", featureId, iso(now - 7 * DAY))!.n;
    return {
      killLatencyMs,
      deactivation: quarter,
      pendingOverdue: pending.size,
      onboard: { disabled: thisWeek.disabled, vehicles: thisWeek.vehicles, prevDisabled: prevWeek.disabled, prevVehicles: prevWeek.vehicles },
      stateProofFailures: proof,
      persistenceFailed: current.filter((c) => c.doc.feature?.version === version && c.doc.persistence === 'FAILED').length,
    };
  }

  /** 출시 Version마다 지표·경보, 지표 계획 누락·예시값 사용 Version */
  overview() {
    const released = this.released();
    const plans = released.map((r) => this.plan(r.featureId, r.version));
    const items = released.map((r, i) => ({ ...r, ads: !!this.gate.registryEntry(r.featureId, r.version)?.ads_feature, plan: plans[i], metrics: computeMetrics(this.input(r.featureId, r.version), plans[i]) }));
    return { at: this.clock.iso(), definitions: SAFETY_METRICS, coverage: metricCoverage(released, plans), items, alerts: items.reduce((n, x) => n + x.metrics.filter((m) => m.alert).length, 0) };
  }

  /** 부속서 1 정기 보고 — ADS 기능만. 기간 [from, to) */
  annex1(featureId: string, version: string, q: { from?: string; to?: string }) {
    const entry = this.gate.registryEntry(featureId, version);
    if (!entry) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const to = q.to ?? this.clock.iso();
    const from = q.from ?? new Date(Date.parse(to) - 365 * DAY).toISOString();
    if (!entry.ads_feature) return { featureId, version, from, to, applicable: false, lines: [], missing: [] as Annex1Id[] };
    const inPeriod = (at: string) => at >= from && at < to;
    const kills = this.deactivations(featureId, version).filter((d) => inPeriod(d.issuedAt));
    let mrc = 0;
    let overLimit = 0;
    const mrcByReason: Record<string, number> = {};
    for (const d of kills)
      for (const i of d.items) {
        if (i.deactivate?.mrc) (mrc++, (mrcByReason[d.kill.reasonCategory ?? 'LEGACY'] = (mrcByReason[d.kill.reasonCategory ?? 'LEGACY'] ?? 0) + 1));
        else if (d.overdue.has(i.vin)) overLimit++;
      }
    const sec = (eventIds: string[]) =>
      Object.fromEntries(
        this.db
          .all<{ event_id: string; n: number }>(`SELECT event_id, COUNT(*) AS n FROM security_event WHERE event_id IN (${eventIds.map(() => '?').join(',')}) AND json_extract(doc, '$.featureId') = ? AND at >= ? AND at < ? GROUP BY event_id`, ...eventIds, featureId, from, to)
          .map((r) => [r.event_id, r.n]),
      ) as Record<string, number>;
    const sum = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);
    const cyber = sec(['AUTH_FAILURE', 'REPLAY_SEQUENCE', 'STATE_PROOF_FAILURE']);
    const e2e = sec(['E2E_REPEAT']).E2E_REPEAT ?? 0;
    const changes: Record<string, number> = {};
    for (const r of this.db.all<{ violation: string }>('SELECT violation FROM status_report WHERE feature_id = ? AND accepted = 0 AND violation IS NOT NULL AND received_at >= ? AND received_at < ?', featureId, from, to)) {
      const v = JSON.parse(r.violation) as { step: string; code: string };
      if (v.step === 'TARGET' || v.step === 'HISTORY') changes[v.code] = (changes[v.code] ?? 0) + 1;
    }
    const overdueVehicles = new Set(kills.flatMap((d) => [...d.overdue])).size;
    const report = annex1Report({
      DEACT_NOT_COMPLETED: { count: mrc + overLimit, detail: { MRC: mrc, OVER_LIMIT: overLimit } },
      COMMUNICATION: { count: overdueVehicles + e2e, detail: { KILL_OVERDUE_VEHICLES: overdueVehicles, E2E_REPEAT: e2e } },
      CYBERSECURITY: { count: sum(cyber), detail: cyber },
      UNAUTHORIZED_CHANGE: { count: sum(changes), detail: changes },
      MRC_MANEUVER: { count: mrc, detail: mrcByReason, note: mrc ? null : 'MRC 도달 시각은 차량(ADS) 기록 — 수신한 보고에 MRC가 없으면 0' },
      REMOTE_INTERACTION: { count: 0, detail: { FLAG_COMMANDS: kills.length }, note: '이 플랫폼에는 주행 상황 원격 개입 기능이 없다 — Flag 변경(Kill·복원)은 FLAG_COMMANDS로 따로 센다' },
    });
    return { featureId, version, from, to, applicable: true, ...report };
  }
}

@Controller('api/safety-kpi')
export class SafetyKpiController {
  constructor(private readonly kpi: SafetyKpiService) {}

  @Get()
  overview() {
    return this.kpi.overview();
  }

  @Get(':featureId/:version/annex1')
  annex1(@Param('featureId') featureId: string, @Param('version') version: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.kpi.annex1(featureId, version, { from, to });
  }

  @Put(':featureId/:version/plan')
  @Roles('SAFETY_OFFICER')
  @AuditAction('SAFETY_METRIC_PLAN')
  plan(@CurrentActor() actor: Actor, @Param('featureId') featureId: string, @Param('version') version: string, @Body(new ZodPipe(MetricPlanBody)) body: MetricPlanBody) {
    return this.kpi.recordPlan(actor, featureId, version, body);
  }
}
