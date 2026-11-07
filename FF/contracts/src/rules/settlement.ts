// Feature 사용량 정산 전송(D05-04, 기능명세서 FR-BIL-001-002) — 전송 항목·주기 정의, 사용량 집계(이용 권한 원장에서), 전송 기록(실패 사유·시각 포함, 추가만).
// 사용량 원천은 플랫폼 이용 권한 원장(D01-05)이다. 권한 원천을 과금 시스템으로 둘지는 결정 대기(D7, FR-BIL-001-001) — 집계는 원장 그대로 보낸다.
// 통계용 합성 권한(SYNTHETIC)은 정산에 넣지 않는다.
import { z } from 'zod';
import type { Role } from '../enums';

/** 수동 전송·재전송 — 상품 권리 담당이 따로 없어 운영자·출시 담당(상품 운영)과 외부 스케줄러(SYSTEM) */
export const SETTLEMENT_SENDERS: Role[] = ['OPERATOR', 'RELEASE_MANAGER', 'SYSTEM'];

/** 전송 항목(명세 비고 "전송 항목 정의 필요") — 상품(Feature 판매 단위)별 */
export const SETTLEMENT_ITEMS = [
  { key: 'subscriptionVehicles', label: '구독 이용 차량 수', unit: '대', billable: true, rule: '기간과 겹치는 구독 권한의 차량(중복 없이)' },
  { key: 'subscriptionDays', label: '구독 이용 일수', unit: '일', billable: true, rule: '구독 권한 유효 기간 중 정산 기간과 겹치는 날 수의 합' },
  { key: 'purchases', label: '구매 건수', unit: '건', billable: true, rule: '기간 안에 시작한 구매 권한' },
  { key: 'conversions', label: '체험 전환 건수', unit: '건', billable: true, rule: '기간 안에 체험에서 구독·구매로 전환된 건' },
  { key: 'trialVehicles', label: '체험 이용 차량 수', unit: '대', billable: false, rule: '기간과 겹치는 체험(수락한 것) 차량 — 무상, 참고 값' },
] as const;
export type SettlementItemKey = (typeof SETTLEMENT_ITEMS)[number]['key'];

/** 전송 주기(명세 비고 "전송 주기 정의 필요") — 월 단위, 다음 달 1일에 직전 달을 보낸다. 실패하면 하루마다 다시 */
export const SETTLEMENT_CYCLE = {
  period: 'MONTHLY' as const,
  /** 전송일 — 매월 이날(UTC) 직전 달 사용량 */
  sendDay: 1,
  /** 실패 뒤 재시도 간격(시간) */
  retryHours: 24,
  description: '매월 1일 직전 달 사용량을 정산 시스템으로 보낸다. 실패하면 24시간마다 다시 보내고, 같은 달은 한 번만 성공으로 남는다.',
};

export const SettlementPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '정산 기간은 YYYY-MM');
export const SendSettlementBody = z.object({ period: SettlementPeriod, reason: z.string().trim().min(2).max(500) }).strict();
export type SendSettlementBody = z.infer<typeof SendSettlementBody>;

/** 기간 [시작, 끝) — UTC 날짜 */
export function settlementRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { from: `${period}-01`, to };
}
/** 시각 now의 직전 달 */
export function previousPeriod(now: string): string {
  const d = new Date(now);
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return p.toISOString().slice(0, 7);
}
/** 끝난 기간만 보낼 수 있다 — 진행 중인 달은 사용량이 바뀐다 */
export const periodClosed = (period: string, now: string) => settlementRange(period).to <= now.slice(0, 10);

interface GrantLike {
  vin: string;
  catalogId: string;
  kind: '구독' | '구매' | '체험';
  validFrom: string;
  validTo: string;
  status: string;
  acceptedAt: string | null;
  convertedAt: string | null;
  source: string;
}

export interface SettlementLine {
  catalogId: string;
  name: string;
  subscriptionVehicles: number;
  subscriptionDays: number;
  purchases: number;
  conversions: number;
  trialVehicles: number;
}

const DAY = 86_400_000;
const dayOf = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
/** [a1, a2] (포함) 과 [b1, b2) 가 겹치는 날 수 */
const overlapDays = (a1: string, a2: string, b1: string, b2: string) => Math.max(0, Math.min(dayOf(a2) + DAY, dayOf(b2)) - Math.max(dayOf(a1), dayOf(b1))) / DAY;

/** 상품별 사용량 — 원장 권한에서. 사용량이 없는 상품은 뺀다. 상품 이름은 names(없으면 상품 ID) */
export function settlementUsage(period: string, grants: GrantLike[], names: Map<string, string>): SettlementLine[] {
  const { from, to } = settlementRange(period);
  const inPeriod = (s: string | null) => !!s && s.slice(0, 10) >= from && s.slice(0, 10) < to;
  const by = new Map<string, { sub: Set<string>; days: number; purchases: number; conversions: number; trial: Set<string> }>();
  const at = (c: string) => by.get(c) ?? (by.set(c, { sub: new Set(), days: 0, purchases: 0, conversions: 0, trial: new Set() }), by.get(c)!);
  for (const g of grants) {
    if (g.source === 'SYNTHETIC') continue;
    if (g.kind === '구독' && g.status !== 'OFFERED' && g.status !== 'DECLINED') {
      const d = overlapDays(g.validFrom, g.validTo, from, to);
      if (d > 0) (at(g.catalogId).sub.add(g.vin), (at(g.catalogId).days += d));
    } else if (g.kind === '구매' && g.status !== 'REVOKED' && inPeriod(g.validFrom)) at(g.catalogId).purchases++;
    else if (g.kind === '체험') {
      if (g.acceptedAt && overlapDays(g.validFrom, g.validTo, from, to) > 0) at(g.catalogId).trial.add(g.vin);
      if (g.status === 'CONVERTED' && inPeriod(g.convertedAt)) at(g.catalogId).conversions++;
    }
  }
  return [...by.entries()]
    .map(([catalogId, x]) => ({ catalogId, name: names.get(catalogId) ?? catalogId, subscriptionVehicles: x.sub.size, subscriptionDays: x.days, purchases: x.purchases, conversions: x.conversions, trialVehicles: x.trial.size }))
    .filter((l) => l.subscriptionVehicles + l.purchases + l.conversions + l.trialVehicles > 0)
    .sort((a, b) => a.catalogId.localeCompare(b.catalogId));
}

/** 정산 묶음 합계(청구 대상 항목만) */
export const settlementTotals = (lines: SettlementLine[]) => ({
  lines: lines.length,
  subscriptionVehicles: lines.reduce((t, l) => t + l.subscriptionVehicles, 0),
  subscriptionDays: lines.reduce((t, l) => t + l.subscriptionDays, 0),
  purchases: lines.reduce((t, l) => t + l.purchases, 0),
  conversions: lines.reduce((t, l) => t + l.conversions, 0),
});

const Line = z.object({ catalogId: z.string(), name: z.string(), subscriptionVehicles: z.number(), subscriptionDays: z.number(), purchases: z.number(), conversions: z.number(), trialVehicles: z.number() });
export const SettlementUsageView = z.object({
  period: z.string(),
  from: z.string(),
  to: z.string(),
  closed: z.boolean(),
  items: z.array(z.object({ key: z.string(), label: z.string(), unit: z.string(), billable: z.boolean(), rule: z.string() })),
  cycle: z.object({ period: z.string(), sendDay: z.number(), retryHours: z.number(), description: z.string() }),
  lines: z.array(Line),
  totals: z.object({ lines: z.number(), subscriptionVehicles: z.number(), subscriptionDays: z.number(), purchases: z.number(), conversions: z.number() }),
  sent: z.object({ transmissionId: z.string(), at: z.string(), receiptId: z.string().nullable() }).nullable(),
});
export type SettlementUsageView = z.infer<typeof SettlementUsageView>;

export const SettlementTransmissionView = z.object({
  transmissionId: z.string(),
  period: z.string(),
  at: z.string(),
  status: z.enum(['SENT', 'FAILED']),
  trigger: z.enum(['MANUAL', 'SCHEDULE']),
  actorId: z.string(),
  attempt: z.number().int(),
  lines: z.number().int(),
  totals: z.object({ lines: z.number(), subscriptionVehicles: z.number(), subscriptionDays: z.number(), purchases: z.number(), conversions: z.number() }),
  receiptId: z.string().nullable(),
  /** 실패 사유 — 성공이면 null */
  reason: z.string().nullable(),
  errorId: z.string().nullable(),
});
export type SettlementTransmissionView = z.infer<typeof SettlementTransmissionView>;
