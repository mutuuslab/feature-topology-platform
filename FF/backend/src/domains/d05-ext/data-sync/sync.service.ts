// 데이터 동기화 (D05-02) — 외부 원천(IF-02 기준정보 · IF-03 MDM/DW · IF-12 해외공장)과 플랫폼 데이터를 대사한다.
// 플랫폼이 원천을 덮어쓰지 않는다: 차이(없음·불일치)를 실행 기록으로 남기고, 원천 수정은 각 시스템 담당이 한다.
// 대상마다 시장을 적고, CN 데이터를 국외로 내보내는 동기화는 이전 심사 전까지 보류한다(FFG-TEL-005 — 심사 로직은 WP10).
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query } from '@nestjs/common';
import { reconcile, RunSyncBody, syncGate, type SyncDiff, type SyncTarget } from '@ff/contracts';
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
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';

/**
 * 동기화 대상 — 시장 구분은 대상마다 고정(@rule FFG-TEL-005 보조: CN은 현지 처리, 국외 이전은 보류)
 */
export const SYNC_TARGETS: SyncTarget[] = [
  { targetId: 'SYNC-IF02-ECU', ifId: 'IF-02', name: 'ECU 기준정보', system: 'PLM 기준정보', market: 'KR', direction: 'INBOUND', key: 'ecuPno', fields: ['name', 'hwRevision', 'supplier', 'asil'], localProcessing: false },
  { targetId: 'SYNC-IF02-VEH', ifId: 'IF-02', name: '차량 사양(UPG-VC·트림)', system: 'PLM 기준정보', market: 'KR', direction: 'INBOUND', key: 'vin', fields: ['vehicleModel', 'trim', 'upgVc'], localProcessing: false },
  { targetId: 'SYNC-IF03-DW', ifId: 'IF-03', name: 'Feature Lifecycle → DW', system: 'MDM · DW/DM', market: 'KR', direction: 'OUTBOUND', key: 'key', fields: ['lifecycle', 'baselineId'], localProcessing: false },
  { targetId: 'SYNC-IF12-TMA', ifId: 'IF-12', name: '유럽공장(TMA) 생산 차량', system: 'Overseas Plant TMA', market: 'EU', direction: 'INBOUND', key: 'vin', fields: ['vehicleModel'], localProcessing: false },
  { targetId: 'SYNC-IF12-HMA', ifId: 'IF-12', name: '미국공장(HMA) 생산 차량', system: 'Overseas Plant HMA', market: 'US', direction: 'INBOUND', key: 'vin', fields: ['vehicleModel'], localProcessing: false },
  { targetId: 'SYNC-IF12-HMGC-IN', ifId: 'IF-12', name: '중국공장(HMGC) 생산 차량', system: 'Overseas Plant HMGC', market: 'CN', direction: 'INBOUND', key: 'vin', fields: ['vehicleModel'], localProcessing: true },
  { targetId: 'SYNC-IF12-HMGC-OUT', ifId: 'IF-12', name: '중국 운영 데이터 → 본사', system: 'Overseas Plant HMGC', market: 'CN', direction: 'OUTBOUND', key: 'vin', fields: ['vehicleModel'], localProcessing: true },
];

export interface SyncRun {
  runId: string;
  targetId: string;
  ifId: string;
  market: string;
  status: 'SUCCEEDED' | 'HELD' | 'FAILED';
  at: string;
  by: string;
  records: { platform: number; external: number };
  diffs: SyncDiff[];
  reason: string | null;
}

@Injectable()
@PlatformComponent('D05-02')
export class SyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ext: ExternalSystems,
    private readonly topology: TopologyRepo,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  targets() {
    return SYNC_TARGETS.map((t) => {
      const last = this.runs(t.targetId)[0] ?? null;
      return { ...t, gate: syncGate(t), last: last ? { runId: last.runId, status: last.status, at: last.at, diffs: last.diffs.length } : null };
    });
  }

  runs(targetId?: string): SyncRun[] {
    const rows = targetId ? this.db.all<{ doc: string }>('SELECT doc FROM sync_run WHERE target_id = ? ORDER BY run_id DESC', targetId) : this.db.all<{ doc: string }>('SELECT doc FROM sync_run ORDER BY run_id DESC LIMIT 100');
    return rows.map((r) => JSON.parse(r.doc));
  }

  run(actor: Actor, targetId: string): SyncRun {
    const t = SYNC_TARGETS.find((x) => x.targetId === targetId);
    if (!t) throw new DomainError('NOT_FOUND', `${targetId} 동기화 대상을 찾을 수 없습니다.`);
    const runId = this.nextId();
    const base = { runId, targetId, ifId: t.ifId, market: t.market, at: this.clock.iso(), by: actor.id };
    const gate = syncGate(t);
    let run: SyncRun;
    if (!gate.allowed) run = { ...base, status: 'HELD', records: { platform: 0, external: 0 }, diffs: [], reason: gate.reason };
    else {
      try {
        const { platform, external } = this.sides(t, runId);
        run = { ...base, status: 'SUCCEEDED', records: { platform: platform.length, external: external.length }, diffs: reconcile(platform, external, t.key, t.fields), reason: null };
      } catch (e) {
        run = { ...base, status: 'FAILED', records: { platform: 0, external: 0 }, diffs: [], reason: (e as Error).message };
      }
    }
    this.db.tx(() => {
      this.db.run('INSERT INTO sync_run (run_id, target_id, at, doc) VALUES (?, ?, ?, ?)', run.runId, run.targetId, run.at, JSON.stringify(run));
      this.audit.record(actor, 'SYNC_RUN', run.runId, { after: { targetId, status: run.status, diffs: run.diffs.length, market: t.market }, componentId: 'D05-02' });
      this.events.publish('sync.completed', run.runId, { targetId, ifId: t.ifId, status: run.status, diffs: run.diffs.length, market: t.market, reason: run.reason }, { componentId: 'D05-02', correlationId: actor.correlationId });
    });
    return run;
  }

  /** 대상별 양쪽 데이터 — 플랫폼 쪽과 외부 원천 쪽을 같은 키·필드 모양으로 */
  private sides(t: SyncTarget, runId: string): { platform: Record<string, unknown>[]; external: Record<string, unknown>[] } {
    switch (t.targetId) {
      case 'SYNC-IF02-ECU':
        return { platform: this.topology.allEcu() as unknown as Record<string, unknown>[], external: this.ext.ecuMaster(runId) };
      case 'SYNC-IF02-VEH':
        return { platform: this.fleet.vehicles().filter((v) => !v.vin.startsWith('ego-') && !v.vin.startsWith('lead-')).map((v) => ({ vin: v.vin, vehicleModel: v.vehicleModel, trim: v.trim, upgVc: v.upgVc })), external: this.ext.vehicleSpecs(runId) };
      case 'SYNC-IF03-DW':
        return { platform: this.features.all().map((f) => ({ key: `${f.featureId}@${f.version}`, lifecycle: f.lifecycle, baselineId: f.baselineId })), external: this.ext.dwFeatures(runId) };
      default: {
        const plant = t.targetId.split('-')[2];
        const prefix = `${plant}-`;
        return { platform: this.fleet.vehicles().filter((v) => v.vin.startsWith(prefix)).map((v) => ({ vin: v.vin, vehicleModel: v.vehicleModel })), external: this.ext.plantVehicles(plant, runId) };
      }
    }
  }

  private nextId() {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_run')!.n + 1;
    return `SYNC-RUN-${String(n).padStart(5, '0')}`;
  }
}

@Controller('api/sync')
export class SyncController {
  constructor(private readonly svc: SyncService) {}

  @Get('targets')
  targets() {
    return { items: this.svc.targets() };
  }

  @Get('runs')
  runs(@Query('targetId') targetId?: string) {
    return { items: this.svc.runs(targetId) };
  }

  @Post('runs')
  @HttpCode(201)
  @Roles('OPERATOR', 'SYSTEM', 'VARIANT_OWNER')
  @AuditAction('SYNC_RUN')
  run(@CurrentActor() actor: Actor, @Body(new ZodPipe(RunSyncBody)) body: z.infer<typeof RunSyncBody>) {
    return this.svc.run(actor, body.targetId);
  }
}
