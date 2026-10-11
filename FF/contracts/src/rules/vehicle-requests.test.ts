import { describe, expect, it } from 'vitest';
import { VehicleSchema } from '../schemas/policy';
import { checkObservedSet, checkReportOrder, VEHICLE_OBSERVED_FIELDS, VehicleReportBody } from './vehicle-requests';

const seq = { bootId: 'BOOT-1', sequence: 1, observedAt: '2026-10-12T01:00:00.000Z' };

describe('차량 발신 요청 규칙', () => {
  it('차량이 바꿀 수 있는 관측 속성은 Vehicle 스키마에 실재하는 필드다', () => {
    const fields = Object.keys(VehicleSchema.shape);
    for (const k of Object.keys(VEHICLE_OBSERVED_FIELDS)) expect(fields).toContain(k);
  });

  it('신뢰 원천 속성(트림·국가·차종)과 사용 권한은 차량이 바꾸지 못한다 (UL-026)', () => {
    expect(checkObservedSet({ trim: 'Premium' })).toEqual({ ok: false, rejected: ['trim'], invalid: [] });
    expect(checkObservedSet({ quality: 'STALE', country: 'US' })).toEqual({ ok: false, rejected: ['country'], invalid: [] });
    expect(checkObservedSet({ entitlementActive: true })).toEqual({ ok: false, rejected: ['entitlementActive'], invalid: [] });
  });

  it('관측 속성은 값 형식까지 검사하고, 빈 변경은 거부한다', () => {
    expect(checkObservedSet({ quality: 'STALE', swVersion: '1.1.9' })).toEqual({ ok: true, set: { quality: 'STALE', swVersion: '1.1.9' } });
    expect(checkObservedSet({ quality: 'BAD' })).toEqual({ ok: false, rejected: [], invalid: ['quality'] });
    expect(checkObservedSet({}).ok).toBe(false);
  });

  it('보고 순서: 같은 부팅은 sequence 증가, 다른 부팅은 HELLO만 연다', () => {
    expect(checkReportOrder(null, { type: 'CONTEXT', bootId: 'B1', sequence: 5 })).toEqual({ ok: true, newBoot: true });
    const cur = { bootId: 'B1', sequence: 5 };
    expect(checkReportOrder(cur, { type: 'CONTEXT', bootId: 'B1', sequence: 6 })).toEqual({ ok: true, newBoot: false });
    expect(checkReportOrder(cur, { type: 'CONTEXT', bootId: 'B1', sequence: 4 })).toEqual({ ok: false, reason: 'OLD_SEQUENCE' });
    expect(checkReportOrder(cur, { type: 'CONTEXT', bootId: 'B1', sequence: 5 })).toEqual({ ok: false, reason: 'OLD_SEQUENCE' });
    expect(checkReportOrder(cur, { type: 'READBACK', bootId: 'B2', sequence: 1 })).toEqual({ ok: false, reason: 'BOOT_MISMATCH' });
    expect(checkReportOrder(cur, { type: 'HELLO', bootId: 'B2', sequence: 0 })).toEqual({ ok: true, newBoot: true });
  });

  it('보고 본문: 종류별 필드를 엄격히 받고, Flag 직접 변경(OVERRIDE)도 명시적으로 파싱된다', () => {
    expect(VehicleReportBody.safeParse({ type: 'CONTEXT', ...seq, set: { quality: 'STALE' } }).success).toBe(true);
    expect(VehicleReportBody.safeParse({ type: 'OVERRIDE', ...seq, flagKey: 'care_00022_param', value: true }).success).toBe(true);
    expect(VehicleReportBody.safeParse({ type: 'FAULT', ...seq, featureId: 'FEAT-00022', code: 'RADAR_BIAS', severity: 'CRITICAL' }).success).toBe(true);
    expect(VehicleReportBody.safeParse({ type: 'TRIAL_ACCEPT', ...seq, catalogId: 'CAT-00019', extra: 1 }).success).toBe(false);
    expect(VehicleReportBody.safeParse({ type: 'TOGGLE', ...seq }).success).toBe(false);
  });
});
