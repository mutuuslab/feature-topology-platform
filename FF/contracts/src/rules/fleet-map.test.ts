import { describe, expect, it } from 'vitest';
import { EntitlementSchema, type Entitlement } from '../schemas/policy';
import { activationState, coarsen, locationConsent, mockPosition, regionPoint, subscriptionState, summarize, type FleetMapVehicle } from './fleet-map';

const G = (o: Partial<Entitlement>): Entitlement => EntitlementSchema.parse({ grantId: 'ENT-00001', vin: 'v', catalogId: 'CAT-00019', kind: '체험', validFrom: '2026-10-01', validTo: '2026-10-30', status: 'ACTIVE', ...o });
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

describe('전세계 차량 지도 — 모의 위치', () => {
  it('같은 VIN·시각이면 같은 위치, 지역 도시에서 20 km 안', () => {
    const a = mockPosition('KMH-NX4-0001', 'KR', '영남', 1_000_000, true)!;
    expect(mockPosition('KMH-NX4-0001', 'KR', '영남', 1_000_000, true)).toEqual(a);
    expect(['부산', '대구', '울산']).toContain(a.city);
    const city = { 부산: [35.1796, 129.0756], 대구: [35.8714, 128.6014], 울산: [35.5384, 129.3114] }[a.city as '부산']!;
    expect(km(a, { lat: city[0], lng: city[1] })).toBeLessThan(20);
  });

  it('움직이는 차량은 시간이 지나면 위치가 바뀌고, 정지 차량은 그대로이며 방향이 없다', () => {
    const t0 = mockPosition('ego-01', 'KR', '수도권', 0, true)!;
    const t1 = mockPosition('ego-01', 'KR', '수도권', 60_000, true)!;
    expect(km(t0, t1)).toBeGreaterThan(0.2);
    expect(t1.heading).toBeGreaterThanOrEqual(0);
    const p0 = mockPosition('SYN-KR-00001', 'KR', '수도권', 0, false)!;
    expect(mockPosition('SYN-KR-00001', 'KR', '수도권', 9_999_999, false)).toEqual(p0);
    expect(p0.heading).toBeNull();
  });

  it('지도에 없는 국가는 위치가 없다', () => {
    expect(mockPosition('X', 'JP', '도쿄', 0, true)).toBeNull();
  });

  it('정밀도를 낮추면 소수 자릿수가 잘린다 — 부동소수 꼬리 없음', () => {
    expect(coarsen(37.56789, 126.97812, 0.01)).toEqual([37.57, 126.98]);
    expect(coarsen(37.56789, 126.97812, 0.0001)).toEqual([37.5679, 126.9781]);
    expect(regionPoint('KR', '수도권')).toEqual({ lat: 37.6, lng: 127, city: '서울' });
  });

  it('위치 공유 미동의 — 데모 통신 지연 차량과 합성 약 5%', () => {
    expect(locationConsent('KMH-NX4-0003')).toBe(false);
    expect(locationConsent('KMH-NX4-0001')).toBe(true);
    const n = Array.from({ length: 2000 }, (_, i) => `SYN-KR-${String(i + 1).padStart(5, '0')}`).filter((v) => !locationConsent(v)).length;
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(160);
  });
});

describe('전세계 차량 지도 — 상태', () => {
  const today = '2026-10-12';
  it('구독 상태 — 구독·구매 > 체험 중 > 제안 > 종료 > 없음, 상품 필터', () => {
    expect(subscriptionState([], today)).toBe('NONE');
    expect(subscriptionState([G({ status: 'EXPIRED' })], today)).toBe('ENDED');
    expect(subscriptionState([G({ status: 'OFFERED', validFrom: '2026-10-10', validTo: '2026-10-23' })], today)).toBe('OFFERED');
    expect(subscriptionState([G({ status: 'OFFERED', validFrom: '2026-10-10', validTo: '2026-10-23' }), G({})], today)).toBe('TRIAL');
    expect(subscriptionState([G({}), G({ kind: '구독', catalogId: 'CAT-00002', validTo: '2027-10-01' })], today)).toBe('PAID');
    expect(subscriptionState([G({}), G({ kind: '구독', catalogId: 'CAT-00002', validTo: '2027-10-01' })], today, 'CAT-00019')).toBe('TRIAL');
    expect(subscriptionState([G({ kind: '구독', validTo: '2026-10-01' })], today)).toBe('ENDED');
  });

  it('기능 활성 — 차단 > 미확인(오프라인·불일치) > 켜짐/꺼짐, 게시본 없으면 꺼짐', () => {
    const on = { flagKey: 'a', local: { value: true, reason: 'TARGETING_MATCH' }, drift: false };
    const off = { flagKey: 'b', local: { value: false, reason: 'DEFAULT' }, drift: false };
    expect(activationState({ link: 'ONLINE', kills: [], flags: [on, off] })).toBe('ON');
    expect(activationState({ link: 'ONLINE', kills: [], flags: [on, off] }, 'b')).toBe('OFF');
    expect(activationState({ link: 'ONLINE', kills: ['FEAT-00022'], flags: [on] })).toBe('DISABLED');
    expect(activationState({ link: 'ONLINE', kills: [], flags: [{ ...on, local: { value: false, reason: 'KILL_SWITCH' } }] }, 'a')).toBe('DISABLED');
    expect(activationState({ link: 'OFFLINE', kills: [], flags: [on] })).toBe('UNKNOWN');
    expect(activationState({ link: 'ONLINE', kills: [], flags: [{ ...on, drift: true }] })).toBe('UNKNOWN');
    expect(activationState({ link: 'ONLINE', kills: [], flags: [on] }, 'zzz')).toBe('OFF');
    expect(activationState({ link: 'ONLINE', kills: [], flags: [] })).toBe('OFF');
  });

  it('국가별 집계 — 위치 있는 차량 수, 상태별 수, 많은 국가 먼저', () => {
    const v = (country: string, o: Partial<FleetMapVehicle> = {}): FleetMapVehicle => ({ vin: 'x', label: null, source: 'DEMO', country, region: '', vehicleModel: '', trim: '', position: { lat: 0, lng: 0, precision: 'COARSE', accuracyM: 1100, city: '', heading: null }, moving: false, stale: false, link: 'ONLINE', subscription: 'TRIAL', activation: 'ON', kills: [], ...o });
    const rows = summarize([v('US'), v('KR'), v('KR', { position: null, subscription: 'PAID', activation: null })]);
    expect(rows.map((r) => r.country)).toEqual(['KR', 'US']);
    expect(rows[0]).toMatchObject({ total: 2, located: 1, subscription: { TRIAL: 1, PAID: 1 }, activation: { ON: 1 } });
  });
});
