// 보안 이벤트 모니터링 (D06-12 이상 징후 대응, 보고서 v1.1 14.4 · FFG-SEC-007) — 차량 Guard 거부 코드(수락된 status_report v2의 reject_code),
// 플랫폼 수신 검사 위반(state_auth·report_seq), 정책 게이트 승인 위반을 IdsM 이벤트로 기록하고(031, 추가만, 차량은 가명), 임계값에 닿으면
// SECURITY_MONITORING 범주로 VSOC에 경보(vsoc.alert)를 낸다. 진위 실패 경보는 그 차량의 상태 보고 채널을 일정 시간 제한한다.
import { Controller, Get, Inject, Injectable, Logger, OnModuleInit, Query } from '@nestjs/common';
import { CHANNEL_LIMIT_MS, DATA_CATEGORY_ACCESS, securityAlert, securityEventOf, SECURITY_EVENTS, type SecurityObservation } from '@ff/contracts';
import { Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { vehiclePseudonym } from '../../../kernel/crypto';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo } from '../../d01-policy/policy-repos';

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'vsoc-monitor' };
/** 플랫폼 수신 검사 위반 → 14.4 '상태 증명 실패' 원천 코드 */
const STATUS_VIOLATION_CODE: Record<string, string> = { AUTH_FAILED: 'STATE_AUTH_FAILED', REPLAY: 'REPORT_SEQ_REGRESSION' };

@Injectable()
@PlatformComponent('D06-12')
export class SecurityEventService implements OnModuleInit {
  private readonly log = new Logger('SecurityEvents');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly fleet: FleetRepo,
  ) {}

  onModuleInit() {
    this.events.stream(['vehicle.status.accepted', 'vehicle.status.rejected', 'kill.rejected']).subscribe((e) => {
      try {
        const p = e.payload as Record<string, any>;
        if (e.type === 'vehicle.status.accepted') {
          if (p.rejectCode) this.observe(p.rejectCode, p.vin, { source: e.type, featureId: p.featureId, state: p.state, timeSync: p.timeSync ?? null, keyEpoch: p.keyEpoch ?? null, reportHash: p.reportHash ?? null });
          // 신뢰 시간 없이 받아들인 비활성화(TS-12)
          if (p.requestResult === 'ACCEPTED' && p.timeSync && p.timeSync !== 'SYNCED' && /^DEACT_|^DISABLED$|^INACTIVE$/.test(p.state ?? ''))
            this.observe('FF_EV_TIME_UNVERIFIED', p.vin, { source: e.type, featureId: p.featureId, timeSync: p.timeSync });
        } else if (e.type === 'vehicle.status.rejected') {
          const code = STATUS_VIOLATION_CODE[p.code];
          if (code) this.observe(code, p.vin, { source: e.type, featureId: p.featureId, step: p.step });
        } else if (e.type === 'kill.rejected' && Array.isArray(p.failed)) {
          for (const rule of p.failed as string[]) if (securityEventOf(rule)) this.observe(rule, null, { source: e.type, killId: p.killId, featureId: p.featureId });
        }
      } catch (err) {
        this.log.error(`${e.type} 처리 실패: ${(err as Error).message}`);
      }
    });
  }

  /**
   * 관측 기록 → 임계값 판정 → VSOC 경보·채널 제한.
   * @rule FFG-SEC-007 — 플랫폼 쪽 IdsM 이벤트 기록·임계값·VSOC 경보·채널 제한·포렌식 보존(개인정보 없음)
   */
  observe(code: string, vin: string | null, forensic: Record<string, unknown>) {
    const def = securityEventOf(code);
    if (!def) return null;
    const at = this.clock.iso();
    const vehicle = vin ? vehiclePseudonym(vin) : null;
    const since = new Date(Date.parse(at) - Math.max(...SECURITY_EVENTS.map((x) => x.threshold.windowMs))).toISOString();
    const history = this.db
      .all<{ at: string; code: string; vehicle: string | null }>('SELECT at, code, vehicle FROM security_event WHERE event_id = ? AND at >= ? ORDER BY id', def.id, since)
      .map((r): SecurityObservation => ({ at: r.at, code: r.code, vehicle: r.vehicle }));
    const obs: SecurityObservation = { at, code, vehicle };
    const alert = securityAlert(obs, history, this.fleet.vehicles().length);
    return this.db.tx(() => {
      this.db.run('INSERT INTO security_event (at, event_id, code, vehicle, doc) VALUES (?, ?, ?, ?, ?)', at, def.id, code, vehicle, JSON.stringify({ ...forensic, code, vehicle }));
      if (!alert) return null;
      this.audit.record(SYSTEM, 'VSOC_ALERT', def.id, { after: { ...alert }, componentId: 'D06-12' });
      this.events.publish('vsoc.alert', def.id, { ...alert, at }, { componentId: 'D06-12' });
      if (alert.limitChannel && vin) {
        const until = new Date(Date.parse(at) + CHANNEL_LIMIT_MS).toISOString();
        this.db.run('INSERT INTO vehicle_channel_limit (vin, until, reason, at) VALUES (?, ?, ?, ?)', vin, until, `${def.label} ${alert.count}건 / ${alert.threshold.windowMs / 60_000}분`, at);
        this.events.publish('vehicle.channel.limited', vin, { vehicle, until, eventId: def.id }, { componentId: 'D06-12' });
      }
      return alert;
    });
  }

  list(q: { eventId?: string }) {
    return this.db
      .all<{ at: string; event_id: string; code: string; vehicle: string | null; doc: string }>(`SELECT at, event_id, code, vehicle, doc FROM security_event ${q.eventId ? 'WHERE event_id = ?' : ''} ORDER BY id DESC LIMIT 200`, ...(q.eventId ? [q.eventId] : []))
      .map((r) => ({ at: r.at, eventId: r.event_id, code: r.code, vehicle: r.vehicle, forensic: JSON.parse(r.doc) }));
  }
}

@Controller('api')
export class SecurityEventController {
  constructor(private readonly sec: SecurityEventService) {}

  @Get('security-events')
  @Roles(...DATA_CATEGORY_ACCESS.SECURITY_MONITORING)
  list(@Query('eventId') eventId?: string) {
    return { items: this.sec.list({ eventId }), definitions: SECURITY_EVENTS };
  }
}
