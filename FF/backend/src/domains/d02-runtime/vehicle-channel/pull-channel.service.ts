// 차량 당겨받기 채널(vehicle-pull HTTPS, 출시 준비 RD-OPS-04 · IF-07) — 운영 모드의 기본 차량 전달 경로.
// 플랫폼은 차량에 연결을 열지 않는다. 게시본을 만들 때 대상 차량마다 전달함(vehicle_delivery, 046)에 넣고,
// 차량이 서명한 요청(RD-SEC-08 CMAC 또는 mTLS)으로 받아 간다:
//   GET  /vehicle/v1/:vin/inbox                    — 확인하지 않은 전달(서명된 게시본 + 차단·복원이면 이 차량의 kill_command v2 봉투)
//   POST /vehicle/v1/:vin/inbox/:deliveryId/ack    — 적용(APPLIED)/거부(REJECTED) 확인 → 회신(IF-06 readback)으로 넘긴다
// 차량은 서명(신뢰 앵커)·순번을 스스로 검증한 뒤 적용한다 — 플랫폼 전달함은 "보낼 것" 목록일 뿐 진위의 근거가 아니다.
// 차단·복원 봉투(v2)는 확인과 별도로 서명된 status_report v2(POST /vehicle/v1/:vin/status)가 끝 상태를 알린다.
// 규격: docs/80-integration/80-40-vehicle-channel.md
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { DATA_CATEGORY_ACCESS, VEHICLE_INBOX_LIMIT, VehicleDeliveryAck, type KillCommandV2, type Publication } from '@ff/contracts';
import { randomBytes } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, VehicleEndpoint, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { EnvelopeRepo } from '../../d03-safety/kill-switch/envelope.repo';
import { TelemetryService } from '../../d04-ops/telemetry-ingest/telemetry.service';
import { PublicationRepo, RuntimeRepo } from '../../d06-qsec/secure-deploy/publication.repo';
import { VehicleChannelRegistry } from './vehicle-channel';

const COMPONENT = 'D02-03';
/** 다음 조회까지 권하는 간격(초) — 차량 텔레매틱스 주기와 맞춘다 */
const POLL_AFTER_SEC = Number(process.env.FF_VEHICLE_POLL_SEC ?? 30);

interface DeliveryRow {
  delivery_id: string;
  vin: string;
  publication_id: string;
  queued_at: string;
  fetched_at: string | null;
  fetch_count: number;
  acked_at: string | null;
  ack_doc: string | null;
}

@Injectable()
@PlatformComponent(COMPONENT)
export class PullChannelService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly registry: VehicleChannelRegistry,
    private readonly publications: PublicationRepo,
    private readonly envelopes: EnvelopeRepo,
    private readonly telemetry: TelemetryService,
    private readonly runtime: RuntimeRepo,
    private readonly fleet: FleetRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {
    this.registry.register({
      id: 'pull',
      description: '차량 당겨받기 HTTPS — 차량이 서명한 요청으로 전달함을 받아 가고 서명한 확인을 보낸다',
      deliver: (pub, vins) => this.enqueue(pub, vins),
      status: () => ({ pending: this.db.get<{ n: number }>('SELECT count(*) AS n FROM vehicle_delivery WHERE acked_at IS NULL')!.n }),
    });
  }

  /** 전달함에 넣는다 — 같은 게시본은 차량마다 한 번(재전송 요청은 기존 행을 그대로 둔다). 회신 의무는 그대로(ackOnly 없음) */
  enqueue(pub: Publication, vins: string[]): { ackOnly: string[] } {
    const now = this.clock.iso();
    for (const vin of vins) this.db.run("INSERT OR IGNORE INTO vehicle_delivery (delivery_id, vin, publication_id, channel, queued_at) VALUES (?, ?, ?, 'pull', ?)", `DLV-${randomBytes(9).toString('base64url')}`, vin, pub.publicationId, now);
    if (vins.length) this.events.publish('vehicle.delivery.queued', pub.publicationId, { publicationId: pub.publicationId, kind: pub.kind, vehicles: vins.length, channel: 'pull' }, { componentId: COMPONENT });
    return { ackOnly: [] };
  }

  /** 차량 신원과 경로 VIN이 같아야 하고, 등록된 차량이어야 한다 */
  private admit(actor: Actor, vin: string, action: string) {
    const self = actor.id.replace(/^vehicle:/, '');
    if (self !== vin) {
      this.audit.denied(actor, action, vin, `차량 ${self}이(가) 다른 차량 ${vin}의 전달함에 접근`, COMPONENT);
      throw new DomainError('VEHICLE_SCOPE', `차량 ${self}은(는) 자기 VIN의 전달함만 받을 수 있습니다.`, { vehicle: self, target: vin });
    }
    if (!this.fleet.vehicle(vin)) {
      this.audit.denied(actor, action, vin, '등록되지 않은 차량', COMPONENT);
      throw new DomainError('VEHICLE_UNAUTHENTICATED', `등록되지 않은 차량 ${vin}의 요청은 받지 않습니다.`);
    }
  }

  private envelopeOf(vin: string, pub: Publication): KillCommandV2 | null {
    const p = pub.payload;
    if ((pub.kind === 'KILL' || pub.kind === 'RESTORE') && p.kill) return this.envelopes.forVehicle(p.kill.killId, vin, pub.kind === 'KILL' ? 'deactivate' : 'restore');
    return null;
  }

  /** 확인하지 않은 전달 — 오래된 것부터. 받아 가도 확인 전까지는 다음 조회에 다시 나온다(차량 재시작·통신 끊김에도 잃지 않는다) */
  inbox(actor: Actor, vin: string) {
    this.admit(actor, vin, 'VEHICLE_INBOX');
    const rows = this.db.all<DeliveryRow>('SELECT * FROM vehicle_delivery WHERE vin = ? AND acked_at IS NULL ORDER BY queued_at, rowid LIMIT ?', vin, VEHICLE_INBOX_LIMIT + 1);
    const now = this.clock.iso();
    const items = rows.slice(0, VEHICLE_INBOX_LIMIT).flatMap((r) => {
      const pub = this.publications.get(r.publication_id);
      if (!pub) return [];
      return [{ deliveryId: r.delivery_id, queuedAt: r.queued_at, fetchCount: r.fetch_count + 1, publication: { publicationId: pub.publicationId, kind: pub.kind, payload: pub.payload, signature: pub.signature }, envelope: this.envelopeOf(vin, pub) }];
    });
    if (items.length)
      this.db.tx(() => {
        for (const it of items) this.db.run('UPDATE vehicle_delivery SET fetched_at = coalesce(fetched_at, ?), fetch_count = fetch_count + 1 WHERE delivery_id = ?', now, it.deliveryId);
      });
    return { vin, items, more: rows.length > VEHICLE_INBOX_LIMIT, pollAfterSec: POLL_AFTER_SEC };
  }

  /** 차량의 적용·거부 확인 — 같은 확인 재시도는 같은 응답, 다른 내용이면 409 */
  ack(actor: Actor, vin: string, deliveryId: string, body: VehicleDeliveryAck) {
    this.admit(actor, vin, 'VEHICLE_DELIVERY_ACK');
    const row = this.db.get<DeliveryRow>('SELECT * FROM vehicle_delivery WHERE delivery_id = ? AND vin = ?', deliveryId, vin);
    if (!row) throw new DomainError('NOT_FOUND', `전달 ${deliveryId}을(를) 찾을 수 없습니다.`);
    const doc = JSON.stringify(body);
    if (row.acked_at) {
      if (row.ack_doc !== doc) throw new DomainError('CONFLICT', `전달 ${deliveryId}은(는) 이미 다른 내용으로 확인되었습니다.`, { ackedAt: row.acked_at });
      return { deliveryId, publicationId: row.publication_id, outcome: 'DUPLICATE' as const, ackedAt: row.acked_at };
    }
    const pub = this.publications.get(row.publication_id)!;
    const envelope = this.envelopeOf(vin, pub);
    const at = this.clock.iso();
    return this.db.tx(() => {
      this.db.run('UPDATE vehicle_delivery SET acked_at = ?, ack_doc = ? WHERE delivery_id = ?', at, doc, deliveryId);
      // 회신 집계는 차량의 부팅 식별자를 기준으로 본다 — 실제 차량이 알려 준 부팅으로 맞춘다
      const s = this.runtime.get(vin);
      if (s.bootId !== body.bootId) this.runtime.save({ ...s, bootId: body.bootId });
      // 차단·복원 봉투(v2)는 끝 상태를 서명된 status_report v2가 알린다 — 확인만 남기고 회신은 상태 보고로
      const readback = envelope
        ? null
        : this.telemetry.ingest(
            {
              vin,
              publicationId: pub.publicationId,
              metricType: 'READBACK',
              policyHash: body.policyHash,
              featureVersion: pub.payload.featureVersion,
              bootId: body.bootId,
              sequence: pub.payload.sequence,
              observed: body.result === 'APPLIED' ? body.observed! : 'REJECTED',
              ...(body.result === 'REJECTED' ? { rejectReason: body.rejectReason } : {}),
            },
            'IF-06',
            actor.correlationId,
          );
      this.audit.record(actor, 'VEHICLE_DELIVERY_ACK', pub.publicationId, { after: { deliveryId, result: body.result, rejectReason: body.rejectReason ?? null, channel: 'pull' }, componentId: COMPONENT });
      this.events.publish('vehicle.delivery.acked', vin, { deliveryId, publicationId: pub.publicationId, result: body.result, channel: 'pull' }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return { deliveryId, publicationId: pub.publicationId, outcome: 'ACCEPTED' as const, ackedAt: at, readback: readback ? { observed: readback.observed, at: readback.at } : null, statusReport: envelope ? ('REQUIRED' as const) : ('NONE' as const) };
    });
  }
}

@Controller('vehicle/v1/:vin/inbox')
@VehicleEndpoint()
export class VehicleInboxController {
  constructor(private readonly pull: PullChannelService) {}

  @Get()
  inbox(@CurrentActor() actor: Actor, @Param('vin') vin: string) {
    return this.pull.inbox(actor, vin);
  }

  @Post(':deliveryId/ack')
  @HttpCode(200)
  @AuditAction('VEHICLE_DELIVERY_ACK')
  ack(@CurrentActor() actor: Actor, @Param('vin') vin: string, @Param('deliveryId') deliveryId: string, @Body(new ZodPipe(VehicleDeliveryAck)) body: VehicleDeliveryAck) {
    return this.pull.ack(actor, vin, deliveryId, body);
  }
}

@Controller('api/vehicle-channel')
export class VehicleChannelController {
  constructor(private readonly registry: VehicleChannelRegistry) {}

  /** 차량 전달 채널 — 고른 어댑터·등록된 어댑터·대기 중 전달 */
  @Get()
  @Roles(...DATA_CATEGORY_ACCESS.SAFETY_OPERATION)
  view() {
    return this.registry.view();
  }
}
