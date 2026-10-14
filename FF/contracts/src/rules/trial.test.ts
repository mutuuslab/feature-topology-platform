// 기간형 체험권 상태·전환 분석·합성 모집단 (2026-10-13 결정)
import { describe, expect, it } from 'vitest';
import { EntitlementSchema, type Entitlement } from '../schemas/policy';
import { addDays, grantState, noticeOf, syntheticTrials, trialFunnel, trialSweepPlan, trialTrend, type VehicleProfile } from './trial';

const T = (o: Partial<Entitlement>): Entitlement => EntitlementSchema.parse({ grantId: 'ENT-00001', vin: 'v', catalogId: 'CAT-00019', kind: '체험', validFrom: '2026-10-01', validTo: '2026-10-30', status: 'ACTIVE', ...o });

describe('체험권 상태 — 기간형', () => {
  it.each([
    ['체험 기간 안 → ON, 남은 일수', T({}), '2026-10-12', 'ACTIVE', true, 19],
    ['체험 기간 끝 → 만료·OFF', T({}), '2026-10-31', 'EXPIRED', false, null],
    ['제안 중(수락 전) → OFF', T({ status: 'OFFERED', validFrom: '2026-10-10', validTo: '2026-10-23' }), '2026-10-12', 'OFFERED', false, 12],
    ['제안 유효기간 지남 → 만료', T({ status: 'OFFERED', validFrom: '2026-09-01', validTo: '2026-09-14' }), '2026-10-12', 'EXPIRED', false, null],
    ['구매 전환 → 체험 권한 자체는 OFF(구매 권한이 따로 생김)', T({ status: 'CONVERTED' }), '2026-10-12', 'CONVERTED', false, null],
  ] as const)('%s', (_n, g, today, state, effective, daysLeft) => {
    expect(grantState(g, today)).toEqual({ state, effective, daysLeft });
  });
});

describe('체험 전환 분석', () => {
  const P = (vin: string, o: Partial<VehicleProfile> = {}): VehicleProfile => ({ vin, country: 'KR', region: '수도권', vehicleModel: 'NX4 PE', trim: 'Premium', ageBand: '40대', drivingStyle: '고속도로', adasUsage: '높음', source: 'SYNTHETIC', ...o });
  it('수락률 = 수락/제안, 전환율 = 구매/수락, 5대 미만 집단은 가린다', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => ({ grant: T({ grantId: `ENT-0001${i}`, vin: `a${i}`, acceptedAt: '2026-10-01', status: i < 2 ? 'CONVERTED' : 'ACTIVE', convertedAt: i < 2 ? '2026-10-11' : null }), profile: P(`a${i}`) })),
      ...Array.from({ length: 4 }, (_, i) => ({ grant: T({ grantId: `ENT-0002${i}`, vin: `b${i}`, status: 'DECLINED' }), profile: P(`b${i}`, { country: 'US' }) })),
    ];
    const f = trialFunnel(rows, 'country', '2026-10-12');
    expect(f.total).toMatchObject({ offered: 10, accepted: 6, converted: 2, declined: 4, acceptRate: 0.6, conversionRate: 0.333, overallRate: 0.2, medianDaysToConvert: 10 });
    expect(f.groups.find((g) => g.key === 'KR')).toMatchObject({ offered: 6, acceptRate: 1, suppressed: false });
    expect(f.groups.find((g) => g.key === 'US')).toMatchObject({ offered: 4, declined: 0, acceptRate: null, suppressed: true });
  });

  it('주별 추이 — 제안·수락·구매가 해당 주(월요일 시작)에 쌓인다', () => {
    const w = trialTrend([T({ offeredAt: '2026-10-05', acceptedAt: '2026-10-06', convertedAt: '2026-10-12' })], '2026-10-12', 3);
    expect(w.map((x) => x.week)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(w.map((x) => [x.offered, x.accepted, x.converted])).toEqual([[0, 0, 0], [1, 1, 0], [0, 0, 1]]);
  });

  it('합성 모집단은 결정적이고, 성향에 따라 수락률이 다르다(ADAS 높음 > 낮음)', () => {
    const a = syntheticTrials(3000, '2026-10-12');
    expect(syntheticTrials(3000, '2026-10-12').grants).toEqual(a.grants);
    expect(a.grants.every((g) => EntitlementSchema.safeParse(g).success)).toBe(true);
    expect(a.grants.every((g) => g.offeredAt! <= '2026-10-12' && g.offeredAt! >= addDays('2026-10-12', -180))).toBe(true);
    const profiles = new Map(a.profiles.map((p) => [p.vin, p]));
    const f = trialFunnel(a.grants.map((g) => ({ grant: g, profile: profiles.get(g.vin) })), 'adasUsage', '2026-10-12');
    const r = Object.fromEntries(f.groups.map((g) => [g.key, g.acceptRate!]));
    expect(r['높음']).toBeGreaterThan(r['보통']);
    expect(r['보통']).toBeGreaterThan(r['낮음']);
    expect(f.total.converted).toBeGreaterThan(100);
  });
});

describe('만료 sweep 계획 (FFG-LCY-010 사전 고지)', () => {
  const A = (o: Partial<Entitlement> = {}) => T({ acceptedAt: '2026-10-01', ...o });
  it.each([
    ['만료 4일 전 → 아직 없음', A(), '2026-10-26', null],
    ['만료 3일 전 → 고지', A(), '2026-10-27', 'NOTICE'],
    ['고지한 뒤 같은 만료일 → 다시 고지하지 않음', A({ noticeId: 'NTC-00001', noticeFor: '2026-10-30' }), '2026-10-29', null],
    ['연장되어 만료일이 바뀜 → 새 만료일로 다시 고지', A({ noticeId: 'NTC-00001', noticeFor: '2026-10-30', validTo: '2026-11-02' }), '2026-10-30', 'NOTICE'],
    ['만료일 당일까지는 ON → 만료 아님', A({ noticeId: 'NTC-00001', noticeFor: '2026-10-30' }), '2026-10-30', null],
    ['만료일 다음 날 → 만료 확정', A({ noticeId: 'NTC-00001', noticeFor: '2026-10-30' }), '2026-10-31', 'EXPIRE'],
    ['고지 없이 기간이 지났어도 만료는 확정(고지 없음으로 실린다)', A(), '2026-11-05', 'EXPIRE'],
    ['고지 뒤 구매 전환 → 만료를 내지 않는다', A({ status: 'CONVERTED', noticeId: 'NTC-00001', noticeFor: '2026-10-30' }), '2026-10-31', null],
    ['거절·이미 만료 확정 → 대상 아님', A({ status: 'EXPIRED' }), '2026-11-05', null],
    ['수락 전 제안 → 대상 아님', A({ status: 'OFFERED', acceptedAt: null }), '2026-10-29', null],
    ['구독 → 대상 아님', A({ kind: '구독' }), '2026-10-31', null],
  ] as const)('%s', (_n, g, today, plan) => {
    expect(trialSweepPlan(g, today)).toBe(plan);
  });

  it('만료에 실리는 고지는 지금 만료일에 대해 낸 것만', () => {
    expect(noticeOf(A({ noticeId: 'NTC-00001', noticeAt: '2026-10-27T00:00:00Z', noticeFor: '2026-10-30' }))).toEqual({ noticeId: 'NTC-00001', noticeAt: '2026-10-27T00:00:00Z' });
    expect(noticeOf(A({ noticeId: 'NTC-00001', noticeAt: 'x', noticeFor: '2026-10-30', validTo: '2026-11-02' }))).toEqual({ noticeId: null, noticeAt: null });
    expect(noticeOf(A())).toEqual({ noticeId: null, noticeAt: null });
  });
});
