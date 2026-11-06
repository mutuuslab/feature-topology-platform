// ADS 상태 규칙 — 관측 신선도 경계·수렴 7구간 배타·판정 → 활성 적격·사용 준비 확인·고객 문구(미확인 단정 금지)
import { describe, expect, it } from 'vitest';
import {
  classifyDelivery,
  classifyOrder,
  CONVERGENCE_BINS,
  convergenceCounts,
  cumulativeDelivery,
  customerProjection,
  eligibilityOf,
  entitlementAxisOf,
  freshnessOf,
  installAxisOf,
  isReadyConfirmed,
  reasonLabel,
  reportedValue,
  stateComboText,
  VERDICT_REASON_CODES,
  type DeliveryEvent,
  type OrderFacts,
} from './ads-state';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const BASIS = 15 * 60_000;

describe('관측 신선도 — 경계 3건', () => {
  it('기준 시간 초과·offline_since 없음 → 지연, offline_since 있음 → 오프라인, 보고 이력 없음 → 미확인', () => {
    expect(freshnessOf({ observedAt: ago(16), staleAfterMs: BASIS, now: NOW })).toBe('DELAYED');
    expect(freshnessOf({ observedAt: ago(16), offlineSince: ago(10), staleAfterMs: BASIS, now: NOW })).toBe('OFFLINE');
    expect(freshnessOf({ observedAt: null, staleAfterMs: BASIS, now: NOW })).toBe('UNOBSERVED');
    expect(freshnessOf({ observedAt: ago(14), staleAfterMs: BASIS, now: NOW })).toBe('FRESH');
    // 재연결 뒤 새 보고 — 옛 끊김 기록은 오프라인으로 만들지 않는다
    expect(freshnessOf({ observedAt: ago(2), offlineSince: ago(200), staleAfterMs: BASIS, now: NOW })).toBe('FRESH');
  });
  it('기준 시간을 넘긴 차량 보고값은 현재 값이 없고 과거 값만 — 허용(ALLOW)으로 보이지 않는다', () => {
    expect(reportedValue('ALLOW', 'DELAYED')).toEqual({ current: null, past: 'ALLOW' });
    expect(reportedValue('ACTIVE', 'FRESH')).toEqual({ current: 'ACTIVE', past: null });
  });
});

describe('수렴 7구간 — 배타, 합 = 대상', () => {
  const ev = (stage: DeliveryEvent['stage'], min: number, reasonCode?: string): DeliveryEvent => ({ stage, at: ago(min), reasonCode });
  it('수신 ACK만 있는 차량은 적용으로 세지 않는다 — 기준 시간 안 수신만 됨, 넘기면 미확인(한 구간)', () => {
    expect(classifyDelivery([ev('RECEIVED', 5)], BASIS, NOW).bin).toBe('RECEIVED_ONLY');
    expect(classifyDelivery([ev('RECEIVED', 16)], BASIS, NOW).bin).toBe('UNCONFIRMED');
  });
  it('DEFERRED 보고 차량은 전달 보류 한 구간에만, 기준 시간 넘긴 DEFERRED는 미확인(마지막 보고 사유 유지)', () => {
    const fresh = classifyDelivery([ev('RECEIVED', 6), ev('DEFERRED', 5, 'DDT_ACTIVE')], BASIS, NOW);
    expect(fresh.bin).toBe('DEFERRED');
    const old = classifyDelivery([ev('RECEIVED', 40), ev('DEFERRED', 30, 'DDT_ACTIVE')], BASIS, NOW);
    expect(old.bin).toBe('UNCONFIRMED');
    expect(old.last).toMatchObject({ stage: 'DEFERRED', reasonCode: 'DDT_ACTIVE' });
  });
  it('결과 보고(적용·거부)가 중간 보고보다 앞선다, 보고 없음 = 미수신', () => {
    expect(classifyDelivery([ev('RECEIVED', 50), ev('APPLIED', 40)], BASIS, NOW).bin).toBe('APPLIED');
    expect(classifyDelivery([ev('RECEIVED', 50), ev('REJECTED', 40, 'SIGNATURE_INVALID')], BASIS, NOW).bin).toBe('REJECTED');
    expect(classifyDelivery([], BASIS, NOW).bin).toBe('NOT_RECEIVED');
  });
  it('구간 수 합은 대상 차량 수, 미수신과 로컬 거부는 다른 차량 집합, 누적은 보조', () => {
    const per: DeliveryEvent[][] = [[ev('APPLIED', 3)], [ev('ACCEPTED', 3)], [ev('DEFERRED', 3)], [ev('RECEIVED', 3)], [], [ev('REJECTED', 3)], [ev('RECEIVED', 30)]];
    const bins = per.map((e) => classifyDelivery(e, BASIS, NOW).bin);
    expect(bins).toEqual([...CONVERGENCE_BINS]);
    const counts = convergenceCounts(bins);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(per.length);
    expect(cumulativeDelivery(per)).toEqual({ received: 6, accepted: 2 });
  });
});

describe('판정 → 활성 적격·사유 사전', () => {
  it('허용=ALLOW, 거부=ODD 밖·금지·조건 부족, 판단 불가=UNKNOWN', () => {
    expect(eligibilityOf('ALLOW')).toBe('ALLOW');
    expect(eligibilityOf('DENY', ['ODD_OUT'])).toBe('ODD_OUT');
    expect(eligibilityOf('DENY', ['TERMINATION_INHIBIT'])).toBe('FORBIDDEN');
    expect(eligibilityOf('DENY', ['NOT_STOPPED'])).toBe('CONDITION_MISSING');
    expect(eligibilityOf('UNKNOWN', ['INPUT_INVALID_OR_STALE'])).toBe('UNKNOWN');
  });
  it('ODD_OUT과 INPUT_INVALID_OR_STALE는 다른 한국어 사유, 보고서 사유 18개 + ODD 2개', () => {
    expect(reasonLabel('ODD_OUT')).toBe('현재 운행 조건 밖');
    expect(reasonLabel('INPUT_INVALID_OR_STALE')).not.toBe(reasonLabel('ODD_OUT'));
    expect(Object.keys(VERDICT_REASON_CODES)).toHaveLength(20);
    expect(reasonLabel('E2E_CRC')).toBe('차량 보고 사유');
  });
  it('상태 조합 문구 — 복구 검증 완료 · 종료 차단 해제 · 현재 활성화 불가, 구매됨 · 현재 운행 조건에서 사용 불가', () => {
    expect(stateComboText({ entitlement: 'TRIAL', restore: { integrity: 'OK', inhibitReleased: true }, activation: { verdict: 'DENY', reasonCodes: ['FEATURE_HEALTH_NOT_READY'], stale: false } })).toBe('복구 검증 완료 · 종료 차단 해제 · 현재 활성화 불가');
    expect(stateComboText({ entitlement: 'PURCHASED', restore: null, activation: { verdict: 'DENY', reasonCodes: ['ODD_OUT'], stale: false } })).toBe('구매됨 · 현재 운행 조건에서 사용 불가');
    expect(stateComboText({ entitlement: 'PURCHASED', restore: null, activation: { verdict: 'ALLOW', reasonCodes: [], stale: true } })).toBe('구매됨 · 현재 활성화 미확인');
  });
});

describe('6축 값', () => {
  it('상품 권리 — 체험·구매·만료, 결제 상태는 쓰지 않는다', () => {
    expect(entitlementAxisOf([{ kind: '체험', status: 'ACTIVE' }])).toBe('TRIAL');
    expect(entitlementAxisOf([{ kind: '구독', status: 'ACTIVE' }])).toBe('PURCHASED');
    expect(entitlementAxisOf([{ kind: '체험', status: 'EXPIRED' }])).toBe('EXPIRED');
    expect(entitlementAxisOf([])).toBe('NONE');
  });
  it('구성과 설치 — 검증됨이지만 승인 조합 불일치는 부분 실패(호환 아님), OTA 기록 없으면 미확인', () => {
    expect(installAxisOf('VERIFIED', false)).toBe('PARTIAL_FAILURE');
    expect(installAxisOf('VERIFIED', true)).toBe('COMPATIBLE');
    expect(installAxisOf('DOWNLOADED', null)).toBe('NOT_INSTALLED');
    expect(installAxisOf(null, null)).toBe('NOT_LINKED');
  });
});

describe('사용 준비 확인 — isReadyConfirmed 하나', () => {
  const base: OrderFacts = { status: 'PAID', paidAt: ago(60 * 30), entitlement: 'CONFIRMED', config: 'CONFIRMED', policyStage: 'APPLIED', readyReport: { at: ago(60 * 29), ok: true }, freshness: 'FRESH' };
  it('네 조건 모두 확인 → 사용 준비 확인, 정책 ACK가 수신(RECEIVED)만이면 미확인 유지', () => {
    expect(classifyOrder(base, NOW).bin).toBe('READY');
    const r = classifyOrder({ ...base, policyStage: 'RECEIVED' }, NOW);
    expect(r.bin).toBe('UNCONFIRMED');
    expect(isReadyConfirmed(r.conditions)).toBe(false);
  });
  it('결제 성공 + 오프라인 → 활성 미확인(오프라인 구간), 결제 직후 보고 없음 → 주문 성공 · 활성 미확인', () => {
    expect(classifyOrder({ ...base, freshness: 'OFFLINE', readyReport: null }, NOW).bin).toBe('OFFLINE');
    const just = classifyOrder({ ...base, paidAt: ago(10), policyStage: null, readyReport: null }, NOW);
    expect(just).toMatchObject({ bin: 'UNCONFIRMED', justPaid: true, overdue: false });
  });
  it('재연결 뒤 보고 시각이 주문 이전이면 준비로 세지 않음(주문 전 보고), 주문 이후 보고로 4조건 충족이면 전이', () => {
    const pre = classifyOrder({ ...base, readyReport: { at: ago(60 * 31), ok: true } }, NOW);
    expect(pre).toMatchObject({ bin: 'UNCONFIRMED', preOrderReport: true, overdue: true });
    expect(classifyOrder({ ...base, readyReport: { at: ago(1), ok: true } }, NOW).bin).toBe('READY');
  });
  it('조건 하나라도 실패 보고면 부분 실패, 취소·환불은 그 구간, 기한은 구간이 아니다', () => {
    expect(classifyOrder({ ...base, config: 'FAILED', readyReport: null }, NOW)).toMatchObject({ bin: 'PARTIAL', overdue: true });
    expect(classifyOrder({ ...base, status: 'REFUNDED' }, NOW)).toMatchObject({ bin: 'REFUNDED', overdue: false });
  });
});

describe('고객 문구 — 미확인은 단정하지 않는다', () => {
  const input = { freshness: 'FRESH' as const, observedAt: ago(2), entitlement: 'PURCHASED' as const, install: 'COMPATIBLE' as const, eligibility: 'ALLOW' as const, eligibilityReason: null, runtime: 'AVAILABLE' as const, restricted: false, product: { name: 'Highway Driving Package', kind: '구매', until: null } };
  it('오프라인이면 한 줄 — 오프라인 — 마지막 확인 {시각}, 현재 상태 미확인', () => {
    const p = customerProjection({ ...input, freshness: 'OFFLINE', eligibility: null, runtime: null, observedAt: '2026-11-06T03:00:00Z' });
    expect(p.unconfirmedLine).toBe('오프라인 — 마지막 확인 11-06 12:00, 현재 상태 미확인');
    expect(customerProjection({ ...input, freshness: 'DELAYED', observedAt: '2026-11-06T03:00:00Z' }).unconfirmedLine).toBe('마지막 확인 11-06 12:00, 현재 상태 미확인');
  });
  it('원격 종료 대상은 제한 문구와 시각 없는 조건만, 준비되지 않으면 예정 · 조건부', () => {
    const k = customerProjection({ ...input, restricted: true });
    expect(k.canUse.text).toBe('안전 점검으로 지금은 사용이 제한됩니다');
    expect(k.when.text).toBe('차량 확인 뒤 알려 드립니다');
    expect(customerProjection({ ...input, runtime: 'INACTIVE', install: 'NOT_LINKED' }).when).toMatchObject({ text: '예정 · 조건부 — 차량 설치 확인과 사용 준비 확인 뒤', sub: '설치 상태 연동 전' });
    expect(customerProjection(input).canUse.text).toBe('지금 사용할 수 있습니다');
    expect(customerProjection({ ...input, eligibility: 'ODD_OUT', eligibilityReason: '현재 운행 조건 밖' }).canUse.text).toBe('구매됨 · 현재 운행 조건에서 사용 불가');
  });
});
