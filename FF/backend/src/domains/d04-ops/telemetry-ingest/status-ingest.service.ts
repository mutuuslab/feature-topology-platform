// 차량 상태 보고 v2 수신 (D04-03, 보고서 v1.1 13.3.1·9.3) — 6단계 검사(스키마 → state_auth → report_seq → 대상 → 명령 이력 → 영속).
// 위반 보고는 남기되 확인 집계에서 빼고 Incident(이상 징후 D06-12)로 넘긴다(FFG-TEL-003). 받아들인 보고가 명령의 끝 상태에 닿으면
// 해당 게시본의 회신(P0 readback)으로 이어 준다 — 차단은 DISABLED(상업 사유 INACTIVE), 복원은 ACTIVE에 닿아야 "적용됨".
// 기한 감시: 차단이 발행되면 등급별 예상 시간 + 여유 안에 끝 상태가 아닌 차량을 pending_overdue로 올린다(FFG-SEC-004·DEAC-013).
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { AuditAction, CurrentActor, Roles, VehicleEndpoint, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { DomainError } from '../../../kernel/errors';
import { applyWindowMs, checkStatusReport, DATA_CATEGORY_ACCESS, endState, statusAuthCanonical, type KillRequest, type StatusCheckResult, type StatusReportV2 } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { vehiclePseudonym } from '../../../kernel/crypto';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';
import { Scheduler } from '../../../kernel/scheduler';
import { FeatureRepo } from '../../d01-policy/repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { EnvelopeRepo } from '../../d03-safety/kill-switch/envelope.repo';
import { HsmService } from '../../d06-qsec/pki-kms/hsm.service';
import { PublicationRepo, RuntimeRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { TelemetryService } from './telemetry.service';

/** 기한 감시 여유 — 등급별 예상 시간에 더한다(전달 지연·회신 지연) */
const OVERDUE_MARGIN_MS = Number(process.env.FF_OVERDUE_MARGIN_MS ?? 30_000);

export interface StatusIngestResult extends StatusCheckResult {
  vin: string;
  featureId: string | null;
  reportSeq: number | null;
}

@Injectable()
@PlatformComponent('D04-03')
export class StatusIngestService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly hsm: HsmService,
    private readonly envelopes: EnvelopeRepo,
    private readonly features: FeatureRepo,
    private readonly profiles: SafetyProfileService,
    private readonly publications: PublicationRepo,
    private readonly runtime: RuntimeRepo,
    private readonly telemetry: TelemetryService,
    private readonly events: EventService,
    private readonly scheduler: Scheduler,
  ) {}

  onModuleInit() {
    this.events.stream(['kill.issued']).subscribe((e) => {
      const p = e.payload as { killId?: string; commandId?: string };
      if (p.killId && p.commandId) this.watch(p.killId);
    });
  }

  private kill(killId: string): KillRequest | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM kill_request WHERE kill_id = ?', killId);
    return r ? (JSON.parse(r.doc) as KillRequest) : null;
  }

  /** 이 차량에 전개된 Version — 마지막 명령의 Version, 없으면 RELEASED 최신 */
  /** 차량이 이 명령(vehicle_seq)을 받아들였다고 이미 보고했는가 — 수락된 보고 가운데 거부가 아닌 것의 vehicle_seq ≥ 발급 */
  private acknowledged(vin: string, featureId: string, vehicleSeq: number): boolean {
    return !!this.db.get(
      "SELECT 1 FROM status_report WHERE vin = ? AND feature_id = ? AND accepted = 1 AND json_extract(doc, '$.request_result') <> 'REJECTED' AND json_extract(doc, '$.vehicle_seq') >= ? LIMIT 1",
      vin,
      featureId,
      vehicleSeq,
    );
  }

  private expectedVersion(vin: string, featureId: string): string | null {
    const last = this.envelopes.last(vin, featureId);
    if (last) return last.version;
    return (
      this.features
        .versions(featureId)
        .filter((f) => f.lifecycle === 'RELEASED')
        .at(-1)?.version ?? null
    );
  }

  /**
   * 수신 — 검사·기록·후속(회신 연결·이상 징후 이벤트).
   * @rule FFG-TEL-003 — 증명·순번·이력 검사를 통과한 보고만 확인 집계에 넣는다
   */
  ingest(vin: string, report: unknown, via: 'IF-06' | 'SIM' | 'GLEO' = 'IF-06'): StatusIngestResult {
    const r = report as Partial<StatusReportV2>;
    const featureId = typeof r?.feature?.id === 'string' ? r.feature.id : null;
    let authOk = false;
    try {
      authOk =
        typeof r?.state_auth === 'string' &&
        typeof r.key_epoch === 'number' &&
        this.hsm.verifyCmac(vin, r.key_epoch, Buffer.from(statusAuthCanonical(report as Record<string, unknown>)), r.state_auth);
    } catch {
      authOk = false;
    }
    const lastReportSeq = this.db.get<{ s: number | null }>('SELECT max(report_seq) AS s FROM status_report WHERE vin = ? AND accepted = 1', vin)?.s ?? 0;
    const last = featureId ? this.envelopes.last(vin, featureId) : null;
    let result = checkStatusReport(report, {
      authOk,
      lastReportSeq,
      expectedVersion: featureId ? this.expectedVersion(vin, featureId) : null,
      lastCommand: last ? { request: last.request, vehicleSeq: last.vehicleSeq, acknowledged: this.acknowledged(vin, featureId!, last.vehicleSeq) } : null,
    });
    // 가명은 이 차량의 것이어야 한다(채널 인증 VIN과 보고 본문의 결합)
    if (result.accepted && r.vehicle_pseudonym !== vehiclePseudonym(vin))
      result = { accepted: false, violation: { step: 'TARGET', code: 'PSEUDONYM_MISMATCH', message: '보고의 차량 가명이 채널의 차량과 다릅니다' }, action: result.action };
    const now = this.clock.iso();
    const reportSeq = typeof r?.report_seq === 'number' ? r.report_seq : null;
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO status_report (vin, feature_id, report_seq, state, accepted, violation, via, doc, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        vin,
        featureId ?? '-',
        reportSeq ?? 0,
        typeof r?.state === 'string' ? r.state : '-',
        result.accepted ? 1 : 0,
        result.violation ? JSON.stringify(result.violation) : null,
        via,
        JSON.stringify(report),
        now,
      );
      if (result.accepted && featureId) {
        this.db.run(
          'INSERT INTO vehicle_feature_status (vin, feature_id, state, report_seq, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(vin, feature_id) DO UPDATE SET state = excluded.state, report_seq = excluded.report_seq, doc = excluded.doc, updated_at = excluded.updated_at',
          vin,
          featureId,
          r.state,
          reportSeq,
          JSON.stringify(report),
          now,
        );
        this.events.publish(
          'vehicle.status.accepted',
          vin,
          { vin, featureId, state: r.state, requestResult: r.request_result, rejectCode: r.reject_code ?? null, action: result.action.kind, timeSync: r.time_sync ?? null, keyEpoch: r.key_epoch ?? null, dtc: r.dtc ?? [] },
          { componentId: 'D04-03' },
        );
        if (result.action.kind === 'REISSUE_SAME') this.events.publish('vehicle.status.reissue', vin, { vin, featureId, commandId: last?.commandId ?? null }, { componentId: 'D04-03' });
      } else if (!result.accepted) {
        this.events.publish(
          'vehicle.status.rejected',
          vin,
          { vin, featureId, step: result.violation!.step, code: result.violation!.code, message: result.violation!.message },
          { componentId: 'D04-03' },
        );
      }
    });
    if (result.accepted && featureId && last) this.bridge(vin, r as StatusReportV2, last.killId, last.request);
    return { ...result, vin, featureId, reportSeq };
  }

  /** 받아들인 보고 → 해당 게시본 회신(P0 readback). 차량이 명령을 거부했으면 거부 사유로, 끝 상태에 닿았으면 그 상태로 */
  private bridge(vin: string, r: StatusReportV2, killId: string, request: string) {
    const k = this.kill(killId);
    const pubId = request === 'restore' ? k?.restorePublicationId : k?.publicationId;
    const pub = pubId ? this.publications.get(pubId) : undefined;
    if (!pub || !pub.payload.targets.includes(vin)) return;
    const base = {
      vin,
      publicationId: pub.publicationId,
      metricType: 'READBACK' as const,
      policyHash: pub.signature.payloadHash,
      featureVersion: pub.payload.featureVersion,
      bootId: this.runtime.get(vin).bootId,
      sequence: pub.payload.sequence,
    };
    if (r.request_result === 'REJECTED') this.telemetry.ingest({ ...base, observed: 'REJECTED', rejectReason: r.reject_code ?? 'REJECTED' });
    else if (r.state === pub.payload.desired) this.telemetry.ingest({ ...base, observed: r.state });
  }

  /** 등급별 예상 시간 — DC0 즉시, DC1 비작동 대기 상한, DC2 인계+램프, DC3 다음 시동 대기 상한 */
  expectedMs(k: KillRequest): number {
    return applyWindowMs(k.deactClass ?? 'DC0', k.reasonCategory ?? 'SAFETY', this.profiles.ensure(k.featureId, k.featureVersion));
  }

  /**
   * 기한 감시 — 예상 시간 + 여유가 지나도 끝 상태가 아닌 차량을 pending_overdue로.
   * @rule FFG-SEC-004, FFG-DEAC-013 — 전달 추적·대기 상한 초과 상위 대응(이상 징후로). 운영 조직 통보는 WP10
   */
  watch(killId: string) {
    const k = this.kill(killId);
    if (!k || k.version !== 2) return;
    const due = this.expectedMs(k) + OVERDUE_MARGIN_MS;
    this.scheduler.after(due, () => this.checkOverdue(killId, due));
  }

  checkOverdue(killId: string, afterMs: number) {
    const k = this.kill(killId);
    if (!k || k.status !== 'ACTIVE') return;
    const end = endState(k.reasonCategory ?? 'SAFETY');
    const late = k.vins.filter((vin) => this.db.get<{ state: string }>('SELECT state FROM vehicle_feature_status WHERE vin = ? AND feature_id = ?', vin, k.featureId)?.state !== end);
    if (!late.length) return;
    this.db.tx(() => this.events.publish('kill.overdue', killId, { killId, featureId: k.featureId, vins: late, end, afterMs }, { componentId: 'D04-03' }));
  }

  /** 차량·Feature 최신 상태(받아들인 보고) */
  vehicle(vin: string) {
    const items = this.db.all<{ feature_id: string; state: string; report_seq: number; doc: string; updated_at: string }>(
      'SELECT feature_id, state, report_seq, doc, updated_at FROM vehicle_feature_status WHERE vin = ? ORDER BY feature_id',
      vin,
    );
    const recent = this.db.all<{ feature_id: string; state: string; report_seq: number; accepted: number; violation: string | null; via: string; received_at: string }>(
      'SELECT feature_id, state, report_seq, accepted, violation, via, received_at FROM status_report WHERE vin = ? ORDER BY id DESC LIMIT 20',
      vin,
    );
    return {
      vin,
      features: items.map((i) => ({ featureId: i.feature_id, state: i.state, reportSeq: i.report_seq, report: JSON.parse(i.doc) as StatusReportV2, updatedAt: i.updated_at })),
      recent: recent.map((x) => ({
        featureId: x.feature_id,
        state: x.state,
        reportSeq: x.report_seq,
        accepted: !!x.accepted,
        violation: x.violation ? (JSON.parse(x.violation) as { step: string; code: string; message: string }) : null,
        via: x.via,
        at: x.received_at,
      })),
    };
  }
}

/** IF-06 차량 상태 보고 v2 — 차량 신원과 경로 VIN이 같아야 한다(기존 차량 발신 채널 규칙). 본문은 검사가 판정하므로 원문 그대로 받는다 */
@Controller('vehicle/v1/:vin')
@VehicleEndpoint()
export class VehicleStatusController {
  constructor(
    private readonly status: StatusIngestService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  @Post('status')
  @HttpCode(200)
  @AuditAction('VEHICLE_STATUS')
  report(@CurrentActor() actor: Actor, @Param('vin') vin: string, @Body() body: unknown) {
    const self = actor.id.replace(/^vehicle:/, '');
    if (self !== vin) {
      this.audit.denied(actor, 'VEHICLE_STATUS', vin, `차량 ${self}이(가) 다른 차량 ${vin}의 상태를 보고`, 'D04-03');
      throw new DomainError('FORBIDDEN', `차량 ${self}은(는) 자기 VIN으로만 보고할 수 있습니다.`, { code: 'VEHICLE_SCOPE' });
    }
    // 보안 이벤트(FFG-SEC-007) — 진위 실패 임계값을 넘은 차량은 제한 시간 동안 상태 보고 채널을 처리하지 않는다
    const limit = this.db.get<{ until: string; reason: string }>('SELECT until, reason FROM vehicle_channel_limit WHERE vin = ? AND until > ? ORDER BY until DESC LIMIT 1', vin, this.clock.iso());
    if (limit) {
      this.audit.denied(actor, 'VEHICLE_STATUS', vin, `채널 처리 제한 중 (${limit.reason}, ${limit.until}까지)`, 'D04-03');
      throw new DomainError('RATE_LIMITED', `보안 이벤트로 이 차량의 보고 채널이 ${limit.until}까지 제한됩니다.`, { code: 'CHANNEL_LIMITED', until: limit.until });
    }
    const r = this.status.ingest(vin, body, 'IF-06');
    return { accepted: r.accepted, violation: r.violation, action: r.action.kind };
  }
}

@Controller('api')
export class StatusIngestController {
  constructor(private readonly status: StatusIngestService) {}

  /** 차량 상태 보고 v2(받아들인 최신·최근 수신 20건, 위반 포함) */
  @Get('vehicles/:vin/status')
  @Roles(...DATA_CATEGORY_ACCESS.SAFETY_OPERATION)
  vehicle(@Param('vin') vin: string, @Query('limit') _limit?: string) {
    return this.status.vehicle(vin);
  }
}
