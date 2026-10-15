// 보존과 삭제 (D04-03 텔레메트리 수집, 보고서 v1.1 13.7 · FFG-TEL-008) — 하루 한 번 저장소마다 보존 기간이 지난 행을 지우고 삭제 기록(032, 추가만)을 남긴다.
// 열린 Incident(OPEN·LINKED)와 열린 이상 건(OPEN·ACKNOWLEDGED)에 연결된 차량·Feature의 행은 기간이 지나도 남긴다(HOLD).
// 추가만 저장소(status_report·security_event)는 sweep 트랜잭션 안에서만 삭제 트리거가 풀린다. FF_SCHEDULER=manual(시험)이면 sweep()을 직접 부른다.
import { Controller, Get, HttpCode, Inject, Injectable, OnApplicationBootstrap, Post } from '@nestjs/common';
import { RETENTION_POLICIES, retentionCutoff, retentionVerdict, type RetentionHolds, type RetentionPolicy } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { vehiclePseudonym } from '../../../kernel/crypto';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';
import { Scheduler } from '../../../kernel/scheduler';

const SYSTEM: Actor = { id: 'system:retention', role: 'SYSTEM', correlationId: 'retention-sweep' };
const DAY_MS = 24 * 3600_000;
/** 기간을 두는 저장소의 시각·차량·Feature 열 */
const STORES: Record<string, { at: string; vehicle: string | null; feature: string | null }> = {
  status_report: { at: 'received_at', vehicle: 'vin', feature: 'feature_id' },
  readback: { at: 'at', vehicle: 'vin', feature: null },
  vehicle_request: { at: 'at', vehicle: 'vin', feature: "json_extract(doc, '$.featureId')" },
  security_event: { at: 'at', vehicle: 'vehicle', feature: "json_extract(doc, '$.featureId')" },
};
const swept = RETENTION_POLICIES.filter((p) => retentionCutoff(p, new Date(0).toISOString()) !== null);
for (const p of swept) if (!STORES[p.store]) throw new Error(`보존 기간이 있는 저장소 ${p.store}의 열 정의가 없습니다`);

interface Candidate {
  rowid: number;
  at: string;
  vehicle: string | null;
  featureId: string | null;
}

@Injectable()
@PlatformComponent('D04-03')
export class RetentionService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
  ) {}

  onApplicationBootstrap() {
    if (this.scheduler.manual || process.env.FF_RETENTION_SWEEP === 'off') return;
    const tick = () => {
      this.sweep(SYSTEM);
      this.scheduler.after(DAY_MS, tick);
    };
    tick();
  }

  /** 열린 Incident·이상 건이 묶어 둔 차량(VIN과 가명)·Feature */
  holds(): RetentionHolds {
    const vehicles = new Map<string, string[]>();
    const features = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, k: string | null | undefined, ref: string) => {
      if (k && k !== '-') m.set(k, [...(m.get(k) ?? []), ref]);
    };
    const vin = (v: string | null | undefined, ref: string) => {
      add(vehicles, v, ref);
      if (v) add(vehicles, vehiclePseudonym(v), ref);
    };
    for (const r of this.db.all<{ doc: string }>("SELECT doc FROM incident WHERE status != 'CLOSED'")) {
      const i = JSON.parse(r.doc) as { incidentId: string; vin?: string | null; featureId?: string | null };
      vin(i.vin, i.incidentId);
      add(features, i.featureId, i.incidentId);
    }
    for (const r of this.db.all<{ doc: string }>("SELECT doc FROM anomaly WHERE status IN ('OPEN', 'ACKNOWLEDGED')")) {
      const a = JSON.parse(r.doc) as { anomalyId: string; featureId: string; signals?: { vin?: string | null }[] };
      add(features, a.featureId, a.anomalyId);
      for (const s of a.signals ?? []) vin(s.vin, a.anomalyId);
    }
    return { vehicles, features };
  }

  private candidates(p: RetentionPolicy, cutoff: string): Candidate[] {
    const c = STORES[p.store];
    return this.db.all<Candidate>(`SELECT rowid AS rowid, ${c.at} AS at, ${c.vehicle ?? 'NULL'} AS vehicle, ${c.feature ?? 'NULL'} AS featureId FROM ${p.store} WHERE ${c.at} < ? ORDER BY rowid`, cutoff);
  }

  /** 저장소별 기간 초과·보존 유지(HOLD)·삭제 대상 수 */
  plan() {
    const now = this.clock.iso();
    const holds = this.holds();
    return RETENTION_POLICIES.map((p) => {
      const cutoff = retentionCutoff(p, now);
      const rows = cutoff ? this.candidates(p, cutoff) : [];
      const held = rows.filter((r) => retentionVerdict(r, p, now, holds).verdict === 'HOLD').length;
      return { ...p, cutoff, expired: rows.length, held, deletable: rows.length - held };
    });
  }

  /**
   * 보존 기간이 지난 행 삭제 — 열린 건에 연결된 행은 남기고, 저장소마다 삭제 기록을 남긴다(삭제한 행 수·남긴 행과 그 근거 건).
   * @rule FFG-TEL-008 — 기간 초과 데이터 삭제와 삭제 기록, 열린 Incident 데이터 삭제 금지
   */
  sweep(actor: Actor) {
    const at = this.clock.iso();
    const holds = this.holds();
    return this.db.tx(() => {
      const out: { store: string; cutoff: string; deleted: number; held: number }[] = [];
      this.db.run('UPDATE retention_gate SET active = 1 WHERE id = 1');
      for (const p of swept) {
        const cutoff = retentionCutoff(p, at)!;
        const rows = this.candidates(p, cutoff);
        if (!rows.length) continue;
        const heldRefs = new Set<string>();
        let deleted = 0;
        for (const r of rows) {
          const v = retentionVerdict(r, p, at, holds);
          if (v.verdict === 'HOLD') v.refs.forEach((x) => heldRefs.add(x));
          else if (v.verdict === 'DELETE') deleted += this.db.run(`DELETE FROM ${p.store} WHERE rowid = ?`, r.rowid).changes;
        }
        const held = rows.length - deleted;
        const doc = { record: p.record, category: p.category, period: p.period, basis: p.basis, heldBy: [...heldRefs].sort() };
        this.db.run('INSERT INTO retention_deletion (at, store, cutoff, deleted, held, doc) VALUES (?, ?, ?, ?, ?, ?)', at, p.store, cutoff, deleted, held, JSON.stringify(doc));
        out.push({ store: p.store, cutoff, deleted, held });
      }
      this.db.run('UPDATE retention_gate SET active = 0 WHERE id = 1');
      if (out.length) {
        this.audit.record(actor, 'RETENTION_SWEEP', 'retention', { after: { stores: out }, componentId: 'D04-03' });
        this.events.publish('retention.swept', 'retention', { at, stores: out }, { componentId: 'D04-03', correlationId: actor.correlationId });
      }
      return { at, stores: out };
    });
  }

  deletions() {
    return this.db
      .all<{ at: string; store: string; cutoff: string; deleted: number; held: number; doc: string }>('SELECT at, store, cutoff, deleted, held, doc FROM retention_deletion ORDER BY id DESC LIMIT 100')
      .map((r) => ({ at: r.at, store: r.store, cutoff: r.cutoff, deleted: r.deleted, held: r.held, ...(JSON.parse(r.doc) as { heldBy: string[] }) }));
  }
}

@Controller('api')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('retention')
  get() {
    return { policies: this.retention.plan(), deletions: this.retention.deletions() };
  }

  @Post('retention/sweep')
  @HttpCode(200)
  @Roles('REGULATORY_OWNER', 'OPS_LEAD')
  @AuditAction('RETENTION_SWEEP')
  sweep(@CurrentActor() actor: Actor) {
    return this.retention.sweep(actor);
  }
}
