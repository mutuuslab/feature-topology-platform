// Feature 사용량 정산 전송(D05-04, FR-BIL-001-002) — 끝난 달의 상품별 사용량(이용 권한 원장, contracts settlementUsage)을 정산 시스템(모의 어댑터)으로 보낸다.
// 시도마다 전송 기록 한 줄(추가만, migration 163) — 실패면 사유·시각·연계 오류 ID. 같은 달 성공은 한 번(409). 매월 1일 직전 달을 보내고 실패하면 24시간마다 다시.
import { Body, Controller, Get, Inject, Injectable, Logger, OnApplicationBootstrap, Post, Query } from '@nestjs/common';
import {
  periodClosed,
  previousPeriod,
  SendSettlementBody,
  SETTLEMENT_CYCLE,
  SETTLEMENT_ITEMS,
  SETTLEMENT_SENDERS,
  SettlementPeriod,
  settlementRange,
  settlementTotals,
  settlementUsage,
  type SettlementTransmissionView,
  type SettlementUsageView,
} from '@ff/contracts';
import { SettlementSystem } from '../../../adapters/if-mocks/settlement.adapter';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { singleQuery } from '../../../kernel/paging';
import { Scheduler } from '../../../kernel/scheduler';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { ProductRepo } from '../../d01-policy/repos';
import { IntegrationErrorService } from '../../d04-ops/event-history/integration-error.service';

const SCHEDULE_ACTOR = (correlationId: string): Actor => ({ id: 'system:settlement', role: 'SYSTEM', correlationId });
const HOUR_MS = 3_600_000;

@Injectable()
@PlatformComponent('D05-04')
export class SettlementService implements OnApplicationBootstrap {
  private readonly log = new Logger('Settlement');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly errors: IntegrationErrorService,
    private readonly fleet: FleetRepo,
    private readonly products: ProductRepo,
    private readonly system: SettlementSystem,
  ) {}

  /** 매시 점검 — 시험(FF_SCHEDULER=manual)은 runDue()를 직접 부른다 */
  onApplicationBootstrap() {
    if (this.scheduler.manual) return;
    const tick = () => {
      try {
        const t = this.runDue();
        if (t) this.log.log(`정산 주기 전송 ${t.period} ${t.status}`);
      } catch (e) {
        this.log.error(`정산 주기 점검 실패: ${(e as Error).message}`);
      }
      this.scheduler.after(HOUR_MS, tick);
    };
    this.scheduler.after(90_000, tick);
  }

  private period(raw: string | undefined): string {
    if (!raw) return previousPeriod(this.clock.iso());
    const p = SettlementPeriod.safeParse(raw);
    if (!p.success) throw new DomainError('VALIDATION', '정산 기간은 YYYY-MM 형식입니다.', { period: raw });
    return p.data;
  }

  private lines(period: string) {
    const names = new Map<string, string>();
    for (const p of this.products.all()) names.set(p.catalogId, p.name);
    return settlementUsage(period, this.fleet.grants(undefined, 'FLEET'), names);
  }

  transmissions(period?: string): SettlementTransmissionView[] {
    const rows = period ? this.db.all<{ doc: string }>('SELECT doc FROM settlement_transmission WHERE period = ? ORDER BY id DESC', period) : this.db.all<{ doc: string }>('SELECT doc FROM settlement_transmission ORDER BY id DESC LIMIT 200');
    return rows.map((r) => JSON.parse(r.doc));
  }

  private sent(period: string): SettlementTransmissionView | undefined {
    return this.transmissions(period).find((t) => t.status === 'SENT');
  }

  /**
   * 기간 사용량 — 전송 항목·주기 정의와 상품별 집계(합성 권한 제외)
   * @req FR-BIL-001-002
   */
  usage(raw?: string): SettlementUsageView {
    const period = this.period(raw);
    const lines = this.lines(period);
    const s = this.sent(period);
    return {
      period,
      ...settlementRange(period),
      closed: periodClosed(period, this.clock.iso()),
      items: SETTLEMENT_ITEMS.map((i) => ({ ...i })),
      cycle: { ...SETTLEMENT_CYCLE },
      lines,
      totals: settlementTotals(lines),
      sent: s ? { transmissionId: s.transmissionId, at: s.at, receiptId: s.receiptId } : null,
    };
  }

  private insert(t: Omit<SettlementTransmissionView, 'transmissionId'>): SettlementTransmissionView {
    const n = (this.db.get<{ n: number | null }>('SELECT max(id) AS n FROM settlement_transmission')?.n ?? 0) + 1;
    const row: SettlementTransmissionView = { transmissionId: `STL-${String(n).padStart(5, '0')}`, ...t };
    this.db.run('INSERT INTO settlement_transmission (transmission_id, period, at, status, doc) VALUES (?, ?, ?, ?, ?)', row.transmissionId, row.period, row.at, row.status, JSON.stringify(row));
    return row;
  }

  /**
   * 정산 시스템으로 보내기 — 끝난 달만, 성공은 달마다 한 번. 실패는 사유·시각을 남기고(연계 오류 이력·알림) 422
   * @req FR-BIL-001-002
   */
  send(actor: Actor, period: string, trigger: 'MANUAL' | 'SCHEDULE', reason: string): SettlementTransmissionView {
    const now = this.clock.iso();
    if (!periodClosed(period, now)) throw new DomainError('GUARD_FAILED', `${period}은(는) 아직 끝나지 않은 기간입니다 — 사용량이 바뀌므로 다음 달에 보냅니다.`, { period });
    const done = this.sent(period);
    if (done) throw new DomainError('CONFLICT', `${period} 사용량은 이미 보냈습니다(${done.transmissionId}, 영수 ${done.receiptId}).`, { transmissionId: done.transmissionId });
    const lines = this.lines(period);
    const totals = settlementTotals(lines);
    const attempt = this.transmissions(period).length + 1;
    const base = { period, at: now, trigger, actorId: actor.id, attempt, lines: lines.length, totals };
    try {
      return this.db.tx(() => {
        const receipt = this.system.send(period, lines);
        const t = this.insert({ ...base, status: 'SENT', receiptId: receipt.receiptId, reason: null, errorId: null });
        this.audit.record(actor, 'SETTLEMENT_SEND', `SETTLEMENT:${period}`, { after: { transmissionId: t.transmissionId, receiptId: t.receiptId, totals, trigger }, reason, componentId: 'D05-04' });
        this.events.publish('settlement.sent', period, { transmissionId: t.transmissionId, period, receiptId: t.receiptId, totals }, { componentId: 'D05-04', correlationId: actor.correlationId });
        return t;
      });
    } catch (err) {
      if (!(err instanceof DomainError) || (err.details as { connection?: string } | undefined)?.connection !== 'settlement') throw err;
      // 전송 실패 — 보낸 것이 없다. 연계 오류 이력(알림)과 전송 기록에 사유·시각을 남긴다(독립 트랜잭션)
      const errorType = (err.details as { errorType?: 'CONNECTION_OFF' | 'NOT_CONNECTED' }).errorType ?? 'UNKNOWN';
      const e = this.errors.record(actor, { system: 'BILLING', errorType, target: `SETTLEMENT:${period}`, message: err.message, detail: { attempt, trigger } });
      this.db.tx(() => this.insert({ ...base, status: 'FAILED', receiptId: null, reason: err.message, errorId: e.errorId }));
      this.audit.failed(actor, 'SETTLEMENT_SEND', `SETTLEMENT:${period}`, err.message, 'D05-04');
      throw err;
    }
  }

  /** 주기 전송 — 직전 달을 아직 못 보냈고, 마지막 실패에서 재시도 간격이 지났으면 보낸다. 보낸(시도한) 기록, 할 일 없으면 null */
  runDue(): SettlementTransmissionView | null {
    const now = this.clock.iso();
    if (new Date(now).getUTCDate() < SETTLEMENT_CYCLE.sendDay) return null;
    const period = previousPeriod(now);
    const tries = this.transmissions(period);
    if (tries.some((t) => t.status === 'SENT')) return null;
    const last = tries[0];
    if (last && Date.parse(now) - Date.parse(last.at) < SETTLEMENT_CYCLE.retryHours * HOUR_MS) return null;
    try {
      return this.send(SCHEDULE_ACTOR(`settlement-${period}-${now}`), period, 'SCHEDULE', `주기 전송(매월 ${SETTLEMENT_CYCLE.sendDay}일)`);
    } catch {
      return this.transmissions(period)[0] ?? null;
    }
  }
}

@Controller('api/settlement')
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Get('usage')
  usage(@Query('period') period?: unknown) {
    return this.svc.usage(singleQuery(period, 'period') || undefined);
  }

  @Get('transmissions')
  transmissions(@Query('period') period?: unknown) {
    return { items: this.svc.transmissions(singleQuery(period, 'period') || undefined) };
  }

  @Post('transmissions')
  @Roles(...SETTLEMENT_SENDERS)
  @AuditAction('SETTLEMENT_SEND')
  send(@CurrentActor() actor: Actor, @Body(new ZodPipe(SendSettlementBody)) body: SendSettlementBody) {
    return this.svc.send(actor, body.period, 'MANUAL', body.reason);
  }
}
