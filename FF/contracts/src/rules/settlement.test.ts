// Feature 사용량 정산(FR-BIL-001-002) — 기간·주기, 항목별 집계(합성 권한 제외), 합계
import { describe, expect, it } from 'vitest';
import { periodClosed, previousPeriod, SendSettlementBody, SETTLEMENT_ITEMS, settlementRange, settlementTotals, settlementUsage } from './settlement';

const g = (o: Partial<Parameters<typeof settlementUsage>[1][number]>) => ({ vin: 'V1', catalogId: 'CAT-00001', kind: '구독' as const, validFrom: '2026-10-01', validTo: '2027-09-30', status: 'ACTIVE', acceptedAt: null, convertedAt: null, source: 'DEMO', ...o });

describe('정산 기간·주기', () => {
  it('기간 [1일, 다음 달 1일), 직전 달, 끝난 달만 전송', () => {
    expect(settlementRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(settlementRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(previousPeriod('2026-11-07T01:00:00Z')).toBe('2026-10');
    expect(previousPeriod('2027-01-01T00:00:00Z')).toBe('2026-12');
    expect(periodClosed('2026-10', '2026-11-01T00:00:00Z')).toBe(true);
    expect(periodClosed('2026-11', '2026-11-07T00:00:00Z')).toBe(false);
    expect(SendSettlementBody.safeParse({ period: '2026-13', reason: '재전송' }).success).toBe(false);
  });
  it('항목 표 — 청구 항목 4개 + 참고 1개', () => {
    expect(SETTLEMENT_ITEMS.filter((i) => i.billable).map((i) => i.key)).toEqual(['subscriptionVehicles', 'subscriptionDays', 'purchases', 'conversions']);
  });
});

describe('사용량 집계', () => {
  it('구독 차량·일수, 구매, 전환, 체험 — 합성 권한·기간 밖은 뺀다', () => {
    const lines = settlementUsage(
      '2026-10',
      [
        g({ vin: 'V1', validFrom: '2026-10-11', validTo: '2027-10-10' }), // 21일
        g({ vin: 'V1', validFrom: '2026-09-01', validTo: '2026-10-05', status: 'EXPIRED' }), // 같은 차량, 5일
        g({ vin: 'V2', validFrom: '2026-01-01', validTo: '2026-12-31' }), // 31일
        g({ vin: 'V3', kind: '구매', validFrom: '2026-10-20', validTo: '2099-12-31' }),
        g({ vin: 'V4', kind: '구매', validFrom: '2026-09-20', validTo: '2099-12-31' }), // 기간 밖
        g({ vin: 'V5', kind: '체험', validFrom: '2026-10-01', validTo: '2026-10-14', status: 'CONVERTED', acceptedAt: '2026-10-01T00:00:00Z', convertedAt: '2026-10-10T00:00:00Z' }),
        g({ vin: 'V6', kind: '체험', validFrom: '2026-10-25', validTo: '2026-11-08', status: 'OFFERED' }), // 수락 안 함
        g({ vin: 'V7', source: 'SYNTHETIC' }),
        g({ vin: 'V8', catalogId: 'CAT-00002', validFrom: '2026-11-01', validTo: '2027-10-31' }), // 기간 뒤
      ],
      new Map([['CAT-00001', '원격 시동 구독']]),
    );
    expect(lines).toEqual([{ catalogId: 'CAT-00001', name: '원격 시동 구독', subscriptionVehicles: 2, subscriptionDays: 57, purchases: 1, conversions: 1, trialVehicles: 1 }]);
    expect(settlementTotals(lines)).toEqual({ lines: 1, subscriptionVehicles: 2, subscriptionDays: 57, purchases: 1, conversions: 1 });
  });
});
