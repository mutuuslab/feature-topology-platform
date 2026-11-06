// 주문 추적(ORC-BE01 읽기·ORC-UI01) — 주문 → 권리 → 정책 적용 → 사용 준비 확인 → 실사용 확인(선택). 판정은 contracts isReadyConfirmed 하나.
// 주문 원장은 order_link(주문 키당 권리 1건). 과금 모의(billing.controller)는 고치지 않고, 데모 주문(가상 데이터)을 기존 ENT-*·CAT-*·VIN에 잇는다.
import { Controller, Get, Injectable, Param, Query } from '@nestjs/common';
import { classifyOrder, ORDER_BINS, READY_DEADLINE_DEFAULT_MS, type OrderBin, type OrderRow, type OrdersView, type OrderTimelineView } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { AdsStateService, type OrderDoc } from '../../d02-runtime/vehicle-runtime/ads-state.service';

@Injectable()
@PlatformComponent('D05-04')
export class AdsOrderService {
  constructor(
    private readonly state: AdsStateService,
    private readonly clock: Clock,
  ) {}

  private row(o: OrderDoc): OrderRow {
    const fresh = this.state.freshness(o.vin, o.featureId);
    const c = classifyOrder({ status: o.status, paidAt: o.paidAt, entitlement: o.entitlement, config: o.config, policyStage: o.policy?.stage ?? null, readyReport: o.readyReport, freshness: fresh.state }, this.clock.now().getTime(), READY_DEADLINE_DEFAULT_MS);
    const cat = this.state.catalog(o.catalogId);
    return {
      orderId: o.orderId,
      vin: o.vin,
      catalogId: o.catalogId,
      catalogName: cat?.name ?? null,
      featureId: o.featureId,
      entitlementId: o.entitlementId,
      status: o.status,
      paidAt: o.paidAt,
      bin: c.bin,
      overdue: c.overdue,
      overdueMs: c.overdueMs,
      deadlineAt: c.deadlineAt,
      justPaid: c.justPaid,
      preOrderReport: c.preOrderReport,
      conditions: c.conditions,
      stages: [
        { key: 'ORDER', at: o.paidAt, state: 'CONFIRMED', optional: false },
        { key: 'ENTITLEMENT', at: o.entitlementAt, state: c.conditions.entitlement, optional: false },
        { key: 'POLICY', at: o.policy?.at ?? null, state: c.conditions.policyApplied, optional: false },
        { key: 'READY', at: c.conditions.vehicleReady === 'UNCONFIRMED' ? null : (o.readyReport?.at ?? null), state: c.conditions.vehicleReady, optional: false },
        { key: 'USAGE', at: o.usageAt, state: o.usageAt ? 'CONFIRMED' : 'UNCONFIRMED', optional: true },
      ],
      refund: o.refund,
      simulated: o.source === 'SIMULATED',
    };
  }

  /** 주문 목록 — 구간(status = OrderBin)으로 거르고, 분포·기한 넘김은 언제나 전체 주문 기준 */
  list(status?: string): OrdersView {
    const all = this.state.orderDocs().map((o) => this.row(o));
    if (status && !ORDER_BINS.includes(status as OrderBin)) throw new DomainError('VALIDATION', `알 수 없는 주문 구간입니다: ${status}`);
    const counts = Object.fromEntries(ORDER_BINS.map((b) => [b, all.filter((r) => r.bin === b).length])) as Record<OrderBin, number>;
    const over = (b: OrderBin) => all.filter((r) => r.bin === b && r.overdue).length;
    const overdueBreakdown = { UNCONFIRMED: over('UNCONFIRMED'), OFFLINE: over('OFFLINE'), PARTIAL: over('PARTIAL') };
    return {
      now: this.clock.iso(),
      deadlineMs: READY_DEADLINE_DEFAULT_MS,
      assumed: true,
      total: all.length,
      counts,
      overdueUnready: overdueBreakdown.UNCONFIRMED + overdueBreakdown.OFFLINE + overdueBreakdown.PARTIAL,
      overdueBreakdown,
      simulated: all.some((r) => r.simulated),
      items: status ? all.filter((r) => r.bin === status) : all,
    };
  }

  /** 주문 하나의 단계 기록 — 차량 시각과 서버 시각을 나눠, 주문 전 보고는 경고 행 */
  timeline(id: string): OrderTimelineView {
    const o = this.state.orderDocs().find((x) => x.orderId === id);
    if (!o) throw new DomainError('NOT_FOUND', `주문 ${id}을(를) 찾을 수 없습니다.`);
    const order = this.row(o);
    const ev: OrderTimelineView['events'] = [{ key: 'paid', kind: 'PAID', vehicleAt: null, serverAt: o.paidAt, detail: o.orderId, preOrder: false, warn: false }];
    if (o.entitlementAt) ev.push({ key: 'ent', kind: 'ENTITLEMENT', vehicleAt: null, serverAt: o.entitlementAt, detail: o.entitlementId, preOrder: false, warn: false });
    if (o.policy) ev.push({ key: 'policy', kind: 'POLICY', vehicleAt: o.policy.at, serverAt: null, detail: o.policy.stage, preOrder: false, warn: o.policy.stage === 'REJECTED' });
    if (o.readyReport) ev.push({ key: 'ready', kind: 'READY_REPORT', vehicleAt: o.readyReport.at, serverAt: null, detail: o.readyReport.ok ? 'OK' : 'NOT_READY', preOrder: order.preOrderReport, warn: order.preOrderReport || !o.readyReport.ok });
    if (o.usageAt) ev.push({ key: 'usage', kind: 'USAGE', vehicleAt: o.usageAt, serverAt: null, detail: null, preOrder: false, warn: false });
    if (o.refund) {
      ev.push({ key: 'refundReq', kind: 'REFUND_REQUESTED', vehicleAt: null, serverAt: o.refund.requestedAt, detail: null, preOrder: false, warn: false });
      if (o.refund.completedAt) ev.push({ key: 'refundDone', kind: 'REFUND_COMPLETED', vehicleAt: null, serverAt: o.refund.completedAt, detail: null, preOrder: false, warn: false });
    }
    const t = (e: OrderTimelineView['events'][number]) => Date.parse(e.vehicleAt ?? e.serverAt ?? '');
    return { order, events: ev.sort((a, b) => t(a) - t(b)) };
  }
}

@Controller('api/orders')
export class AdsOrderController {
  constructor(private readonly orders: AdsOrderService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.orders.list(status || undefined);
  }

  @Get(':id/timeline')
  timeline(@Param('id') id: string) {
    return this.orders.timeline(id);
  }
}
