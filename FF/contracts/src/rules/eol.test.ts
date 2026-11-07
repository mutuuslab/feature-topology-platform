// 생산 출고(EOL) 실물 구성 대조·품질 보류(ORC-UI08, Orca B06) — 불일치 유출 0, 재대조 없는 출고 근거 거부, 결정 주체 역할
import { describe, expect, it } from 'vitest';
import { acceptanceItems, compareAsBuilt, eolCheckBlockers, eolStatus, EOL_DECIDER_ROLES } from './eol';

const order = [
  { ecuPno: '99211-NX400', hwRevision: 'Rev.B' },
  { ecuPno: '95790-NX300', hwRevision: 'Rev.C' },
];

describe('주문 사양 ↔ 실물 구성', () => {
  it('같으면 일치, 부품 누락·다른 개정은 불일치(부품별 글자), 스캔이 없거나 일부만이면 실물 미확인', () => {
    expect(compareAsBuilt(order, order)).toMatchObject({ verdict: 'MATCH', parts: [] });
    const miss = compareAsBuilt(order, [{ ecuPno: '99211-NX400', hwRevision: 'Rev.A' }]);
    expect(miss.verdict).toBe('MISMATCH');
    expect(miss.parts).toEqual([
      { ecuPno: '99211-NX400', ordered: 'Rev.B', built: 'Rev.A', kind: 'REVISION' },
      { ecuPno: '95790-NX300', ordered: 'Rev.C', built: null, kind: 'MISSING' },
    ]);
    expect(compareAsBuilt(order, null).verdict).toBe('UNCONFIRMED');
    expect(compareAsBuilt(order, [{ ecuPno: '99211-NX400', hwRevision: null }]).verdict).toBe('UNCONFIRMED');
  });
});

describe('품질 보류 결정', () => {
  const mismatch = compareAsBuilt(order, [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }]);
  it('재대조 결과 없이 출고 근거를 저장하면 거부, 결정 주체가 생산 품질(BOM 승인자 위임) 역할이 아니면 거부', () => {
    expect(eolCheckBlockers({ role: 'BOM_APPROVER', decision: 'RELEASE', recheckResult: null, shippedEvidence: 'SHIP-1', compare: mismatch }).map((b) => b.code)).toEqual(['RECHECK_MISSING']);
    expect(eolCheckBlockers({ role: 'OPERATOR', decision: 'HOLD', recheckResult: null, shippedEvidence: null, compare: mismatch }).map((b) => b.code)).toEqual(['DECIDER_ROLE']);
    expect(EOL_DECIDER_ROLES).toEqual(['BOM_APPROVER']);
  });
  it('불일치가 남은 차량은 보류 해제·출고 거부(재대조 일치일 때만) — 정책 ON으로 덮지 않는다', () => {
    expect(eolCheckBlockers({ role: 'BOM_APPROVER', decision: 'RELEASE', recheckResult: 'FAIL', shippedEvidence: 'SHIP-1', compare: mismatch }).map((b) => b.code)).toEqual(['RECHECK_FAILED']);
    expect(eolCheckBlockers({ role: 'BOM_APPROVER', decision: 'RELEASE', recheckResult: 'PASS', shippedEvidence: 'SHIP-1', compare: mismatch })).toEqual([]);
  });
  it('상태 — 불일치면 품질 보류, 재작업 기록이면 재작업 중, 재대조 통과·출고 근거면 출고', () => {
    expect(eolStatus(mismatch, [])).toBe('QUALITY_HOLD');
    expect(eolStatus(mismatch, [{ decision: 'REWORK', recheckResult: null, shippedEvidence: null }])).toBe('REWORK');
    expect(eolStatus(mismatch, [{ decision: 'REWORK', recheckResult: null, shippedEvidence: null }, { decision: 'RELEASE', recheckResult: 'PASS', shippedEvidence: 'SHIP-1' }])).toBe('SHIPPED');
    expect(eolStatus(compareAsBuilt(order, order), [])).toBe('READY');
    expect(eolStatus(compareAsBuilt(order, null), [])).toBe('UNCONFIRMED');
  });
});

describe('인도 인수 항목', () => {
  it('정차 확인 가능 항목만 인수 수에 넣고, 주행 조건 항목은 인도 후 확인 대기로 남긴다', () => {
    const r = acceptanceItems([
      { featureId: 'FEAT-00004', name: '고속도로 주행 보조 2', drivingCondition: true, reported: true },
      { featureId: 'FEAT-00003', name: '실내 조명', drivingCondition: false, reported: true },
      { featureId: 'FEAT-00010', name: '좌석 열선', drivingCondition: false, reported: false },
    ]);
    expect(r.items.map((i) => [i.featureId, i.group, i.state])).toEqual([
      ['FEAT-00004', 'DRIVING', 'POST_DELIVERY'],
      ['FEAT-00003', 'STATIONARY', 'CONFIRMED'],
      ['FEAT-00010', 'STATIONARY', 'UNCONFIRMED'],
    ]);
    expect(r.summary).toEqual({ accepted: 1, total: 3, postDelivery: 1, unconfirmed: 1 });
  });
});
