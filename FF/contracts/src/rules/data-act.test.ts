// EU Data Act — FFG-TEL-006: 사용자·제3자 요청 판정, Art.3(1) 직접 접근 대상(2026-09-12 이후 EU 출시)
import { describe, expect, it } from 'vitest';
import { DataAccessRequestBody, dataActDecision, directAccessStatus } from './data-act';

const req = (b: Record<string, unknown>) => DataAccessRequestBody.parse({ vin: 'TMA-NX4-0001', ...b });
const codes = (v: { country: string } | null, b: Record<string, unknown>) => dataActDecision(v, req(b)).map((x) => x.code);

describe('EU Data Act 접근권 (FFG-TEL-006)', () => {
  it('FFG-TEL-006 사용자 요청은 EU 차량이면 제공, 범위 기본값은 상태·이력', () => {
    expect(codes({ country: 'EU' }, { requester: 'USER' })).toEqual([]);
    expect(req({ requester: 'USER' }).scope).toEqual(['FEATURE_STATE', 'FEATURE_HISTORY']);
    expect(codes({ country: 'KR' }, { requester: 'USER' })).toEqual(['NOT_EU_VEHICLE']);
    expect(codes(null, { requester: 'USER' })).toEqual(['UNKNOWN_VEHICLE']);
  });

  it('FFG-TEL-006 제3자 — 수령자·사용자 위임 근거 필수, gatekeeper 제외', () => {
    const tp = { id: 'TP-1', name: '독립 정비사' };
    expect(codes({ country: 'EU' }, { requester: 'THIRD_PARTY' })).toEqual(['THIRD_PARTY_MISSING', 'AUTHORIZATION_MISSING']);
    expect(codes({ country: 'EU' }, { requester: 'THIRD_PARTY', thirdParty: tp })).toEqual(['AUTHORIZATION_MISSING']);
    expect(codes({ country: 'EU' }, { requester: 'THIRD_PARTY', thirdParty: { ...tp, gatekeeper: true }, userAuthorizationRef: 'C-1' })).toEqual(['GATEKEEPER']);
    expect(codes({ country: 'EU' }, { requester: 'THIRD_PARTY', thirdParty: tp, userAuthorizationRef: 'C-1' })).toEqual([]);
  });

  it('FFG-TEL-006 Art.3(1) 직접 접근 — 2026-09-12 이후 EU 출시만 대상, 출시일이 없으면 판정 불가', () => {
    expect(directAccessStatus({ country: 'EU', placedOnMarketAt: '2026-09-12' })).toBe('REQUIRED');
    expect(directAccessStatus({ country: 'EU', placedOnMarketAt: '2026-09-11T23:59:59Z' })).toBe('NOT_REQUIRED');
    expect(directAccessStatus({ country: 'EU', placedOnMarketAt: null })).toBe('UNKNOWN');
    expect(directAccessStatus({ country: 'KR', placedOnMarketAt: '2027-01-01' })).toBe('NOT_EU');
  });
});
