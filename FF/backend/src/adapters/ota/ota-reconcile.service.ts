// OTA 전달 대사(P9) — 80-45 §14의 두 한계를 메운다. 규격: docs/80-integration/80-45-ota-server-if05.md 5.2(작업 조회)·7.5(끝 상태는 차량 결과만)
//  1) webhook 유실: webhook이 기준 시간(FF_OTA_RECONCILE_MS, 기본 2분) 넘게 오지 않은 SUBMITTED 작업을 GET /ota/v1/jobs/{jobId}로 조회해
//     차량별 OTA 사실·작업 끝 상태를 채운다(webhook과 같은 규칙 — 끝 결과를 되돌리지 않고, 같은 결과는 다시 쓰지 않는다). 수동 대사도 같은 함수.
//  2) OTA 사실 ↔ 차량 결과 불일치: 게시본이 닫히면(publication.closed) 차량별로 대사해 어긋난 차량을 전달 이상(DELIVERY) 신호로 올린다.
//     회신 집계·끝 상태는 바꾸지 않는다 — 운영자가 "차량이 안 한 것"과 "보고가 안 온 것"을 구별하게 할 뿐이다.
// 제출·webhook(ota-server.adapter.ts)은 그대로 두고 이 파일만 둔다(P9 대사 · LKF M08과 파일 분리).
import { Body, Controller, HttpCode, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit, Param, Post } from '@nestjs/common';
import { isOtaVehicleOutcome, OTA_MISMATCH, OTA_RECONCILE_AFTER_MS, OtaJobActionBody, otaMismatches, type OtaDeliveryState, type OtaServerJobState, type OtaVehicleOutcome } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../kernel/actor';
import { AuditService } from '../../kernel/audit.service';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';
import { DomainError } from '../../kernel/errors';
import { EventService } from '../../kernel/event.service';
import { otaConfigOf } from '../../kernel/ota-config';
import { Scheduler } from '../../kernel/scheduler';
import { ZodPipe } from '../../kernel/zod.pipe';
import { AnomalyService } from '../../domains/d06-qsec/anomaly-response/anomaly.service';
import { PublicationRepo } from '../../domains/d06-qsec/secure-deploy/publication.repo';
import { OtaCallError, OtaClient } from './ota-client';
import { isFinalOutcome, OtaJobRepo } from './ota-job.repo';

const COMPONENT = 'D04-01';
const SYSTEM: Actor = { id: 'ota-reconcile', role: 'SYSTEM', correlationId: 'ota-reconcile' };
const FINAL_FROM_SERVER: Partial<Record<OtaServerJobState, OtaDeliveryState>> = { COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', FAILED: 'FAILED' };
const CLOSED: readonly OtaDeliveryState[] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];
/** 대사 기준 시간 — webhook 없이 이만큼 지난 SUBMITTED 작업만 조회한다 */
const RECONCILE_AFTER_MS = Number(process.env.FF_OTA_RECONCILE_MS ?? OTA_RECONCILE_AFTER_MS);

interface JobView {
  state?: OtaServerJobState;
  otaJobId?: string;
  vehicles?: { vin: string; outcome: string; at?: string }[];
}

export interface ReconcileResult {
  jobId: string;
  filled: number;
  state: OtaDeliveryState;
  serverState: string | null;
}

@Injectable()
export class OtaReconcileService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('OtaReconcile');
  private readonly client: OtaClient | null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly jobs: OtaJobRepo,
    private readonly publications: PublicationRepo,
    private readonly anomalies: AnomalyService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {
    const cfg = otaConfigOf();
    this.client = cfg ? new OtaClient(cfg, () => this.clock.now().getTime()) : null;
  }

  onModuleInit() {
    // 게시본이 닫히면 OTA 사실과 차량 결과를 대사한다(OTA 작업이 있는 게시본만)
    this.events.stream(['publication.closed']).subscribe((e) => {
      try {
        this.mismatches((e.payload as { publicationId: string }).publicationId);
      } catch (err) {
        this.log.error(`불일치 대사 실패: ${(err as Error).message}`);
      }
    });
  }

  /** 주기 대사 — 기준 시간의 절반마다(최소 15초). 수동 시계(시험)에서는 시험이 sweep()을 직접 부른다 */
  onApplicationBootstrap() {
    if (!this.client || this.scheduler.manual) return;
    const every = Math.max(15_000, Math.floor(RECONCILE_AFTER_MS / 2));
    const tick = () => {
      void this.sweep().catch((e) => this.log.warn(`주기 대사 실패: ${(e as Error).message}`));
      this.scheduler.after(every, tick);
    };
    this.scheduler.after(every, tick);
  }

  /** webhook 없이 기준 시간이 지난 SUBMITTED 작업을 조회로 대사한다 */
  async sweep(): Promise<ReconcileResult[]> {
    if (!this.client) return [];
    const before = new Date(this.clock.now().getTime() - RECONCILE_AFTER_MS).toISOString();
    const due = this.jobs.list({ state: 'SUBMITTED' }).filter((j) => j.updated_at <= before);
    const out: ReconcileResult[] = [];
    for (const j of due) {
      try {
        out.push(await this.reconcile(j.job_id, SYSTEM, '정기 대사 — webhook 미수신'));
      } catch (e) {
        this.log.warn(`${j.job_id} 대사 실패: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /** 작업 하나를 OTA 서버 조회로 대사 — 새로 채운 차량 수와 바뀐 상태 */
  async reconcile(jobId: string, actor: Actor, reason: string): Promise<ReconcileResult> {
    if (!this.client) throw new DomainError('GUARD_FAILED', 'OTA 서버 연동이 설정되지 않았습니다(FF_OTA_URL).');
    const row = this.jobs.get(jobId);
    if (!row) throw new DomainError('NOT_FOUND', `OTA 작업 ${jobId}을(를) 찾을 수 없습니다.`);
    let view: JobView;
    try {
      view = (await this.client.job<JobView>(jobId)).body;
    } catch (e) {
      const err = e instanceof OtaCallError ? e : new OtaCallError('INTERNAL', String(e), null, true);
      throw new DomainError('GUARD_FAILED', `OTA 서버 작업 조회 실패 — ${err.message}`, { ota: err.toJSON() });
    }
    const targets = new Set(JSON.parse(row.targets) as string[]);
    const now = this.clock.iso();
    const source = `reconcile:${now}`;
    return this.db.tx(() => {
      const cur = this.jobs.get(jobId)!;
      const known = new Map(this.jobs.vehicles(jobId).map((v) => [v.vin, v.outcome]));
      let filled = 0;
      for (const v of view.vehicles ?? []) {
        // 대상 밖·모르는 값(PENDING·차량 결과 APPLIED 등)은 쓰지 않는다(webhook과 같은 규칙, 80-45 7.1)
        if (!targets.has(v.vin) || !isOtaVehicleOutcome(v.outcome) || known.get(v.vin) === v.outcome) continue;
        if (this.jobs.setVehicle(jobId, v.vin, v.outcome as OtaVehicleOutcome, 'OTA 작업 조회로 대사', v.at ?? now, source)) filled++;
      }
      const patch: Parameters<OtaJobRepo['update']>[1] = { updated_at: now };
      if (view.otaJobId && !cur.ota_job_id) patch.ota_job_id = view.otaJobId;
      if (view.state) {
        patch.server_state = view.state;
        const final = FINAL_FROM_SERVER[view.state];
        if (final && !CLOSED.includes(cur.state)) patch.state = final;
      }
      const done = this.jobs.vehicles(jobId).filter((v) => isFinalOutcome(v.outcome)).length;
      if ((patch.state ?? cur.state) === 'SUBMITTED' && done >= targets.size) patch.state = 'COMPLETED';
      this.jobs.update(jobId, patch);
      const state = patch.state ?? cur.state;
      const serverState = patch.server_state ?? cur.server_state;
      this.audit.record(actor, 'OTA_JOB_RECONCILE', jobId, { before: { state: cur.state, vehicles: known.size }, after: { state, serverState, filled }, reason, componentId: COMPONENT });
      this.events.publish('ota.job.reconciled', jobId, { jobId, publicationId: row.publication_id, filled, state, serverState }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return { jobId, filled, state, serverState };
    });
  }

  /** 닫힌 게시본의 차량별 OTA 사실 ↔ 차량 결과 — 어긋난 차량마다 전달 이상 신호(판정은 그대로) */
  mismatches(publicationId: string) {
    const pub = this.publications.get(publicationId);
    if (!pub || !this.jobs.forPublication(publicationId)) return [];
    const found = otaMismatches(pub.nodes ?? [], this.jobs.outcomes(publicationId));
    if (!found.length) return found;
    const at = this.clock.iso();
    for (const m of found) this.anomalies.signal({ kind: 'DELIVERY', featureId: pub.payload.featureId, vin: m.vin, code: m.code, severity: 'WARNING', at, ref: publicationId });
    this.events.publish('ota.vehicle.mismatch', publicationId, { publicationId, featureId: pub.payload.featureId, counts: Object.fromEntries(Object.keys(OTA_MISMATCH).map((k) => [k, found.filter((m) => m.code === k).length])), vehicles: found.length }, { componentId: COMPONENT });
    return found;
  }
}

@Controller('api/ota')
export class OtaReconcileController {
  constructor(private readonly reconcile: OtaReconcileService) {}

  @Post('jobs/:jobId/reconcile')
  @HttpCode(200)
  @Roles('RELEASE_MANAGER', 'OPS_LEAD', 'OPERATOR')
  @AuditAction('OTA_JOB_RECONCILE')
  run(@CurrentActor() actor: Actor, @Param('jobId') jobId: string, @Body(new ZodPipe(OtaJobActionBody)) body: OtaJobActionBody) {
    return this.reconcile.reconcile(jobId, actor, body.reason);
  }
}
