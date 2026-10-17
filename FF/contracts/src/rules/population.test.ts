// 5년 운영 모집단 — 판매된 차가 모두 대상은 아니다(사용자 2026-10-17). 깔때기는 단계마다 줄고, 표본 가중 합계가 모델과 맞는다.
import { describe, expect, it } from 'vitest';
import { cohorts, inService, isSampleVin, platformStart, populationAt, POPULATION_ASSUMPTIONS, sampleVehicles } from './population';
import { weightOf } from './trial';

const TODAY = '2026-10-17';
const START = platformStart(TODAY);

describe('5년 운영 모집단', () => {
  it('개시일은 5년 전, 윤일은 2월 28일로', () => {
    expect(START).toBe('2021-10-17');
    expect(platformStart('2028-02-29')).toBe('2023-02-28');
  });

  it('깔때기 — 전 세계 판매 > 서비스 시장 > 탑재 > 커넥티드 > 운행 중, 대상은 판매의 일부', () => {
    const p = populationAt(START, TODAY);
    const f = p.funnel;
    expect(f.soldWorldwide).toBeGreaterThan(f.soldServed);
    expect(f.soldServed).toBeGreaterThan(f.platform);
    expect(f.platform).toBeGreaterThan(f.connected);
    expect(f.connected).toBeGreaterThan(f.active);
    // 연 700만 × 5년 ≈ 3,500만 판매 중 대상은 수백만~1,000만대 규모
    expect(f.soldWorldwide).toBeGreaterThan(34_000_000);
    expect(f.soldWorldwide).toBeLessThan(36_500_000);
    expect(f.active).toBeGreaterThan(5_000_000);
    expect(f.active).toBeLessThan(15_000_000);
    expect(f.active / f.soldWorldwide).toBeLessThan(0.5);
  });

  it('분해 합계가 총계와 같다 — 국가·차종·연차', () => {
    const p = populationAt(START, TODAY);
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(5);
    near(Object.values(p.byCountry).reduce((a, b) => a + b, 0), p.funnel.active);
    near(Object.values(p.byModel).reduce((a, b) => a + b, 0), p.funnel.active);
    near(p.byOpsYear.reduce((a, b) => a + b, 0), p.funnel.active);
    expect(p.byCountry.US).toBeGreaterThan(p.byCountry.EU);
  });

  it('탑재율이 해마다 늘어 후년 판매분이 더 많다', () => {
    const y = populationAt(START, TODAY).byOpsYear;
    for (let i = 1; i < y.length; i++) expect(y[i]).toBeGreaterThan(y[i - 1]);
    expect(POPULATION_ASSUMPTIONS.platformShareByYear.every((s) => s > 0 && s <= 1)).toBe(true);
  });

  it('개시 시점에는 대상이 거의 없고 시간이 갈수록 늘어난다', () => {
    const a = populationAt(START, '2022-10-17').funnel.active;
    const b = populationAt(START, '2024-10-17').funnel.active;
    const c = populationAt(START, TODAY).funnel.active;
    expect(populationAt(START, START).funnel.active).toBeLessThan(a / 10);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(cohorts(START, '2022-10-17').every((x) => x.soldMonth <= '2022-10')).toBe(true);
  });

  it('가중 표본 — 결정적, VIN 고유, 운행 중 가중 합계가 모델 운행 대수와 ±3%', () => {
    const s = sampleVehicles(20_000, START, TODAY);
    expect(sampleVehicles(20_000, START, TODAY).slice(0, 50)).toEqual(s.slice(0, 50));
    expect(new Set(s.map((v) => v.vin)).size).toBe(s.length);
    expect(s.every((v) => isSampleVin(v.vin) && v.source === 'SYNTHETIC' && weightOf(v) > 1)).toBe(true);
    expect(s.length).toBeGreaterThan(19_000);
    const live = s.filter((v) => inService(v, TODAY)).reduce((t, v) => t + weightOf(v), 0);
    const model = populationAt(START, TODAY).funnel.active;
    expect(Math.abs(live / model - 1)).toBeLessThan(0.03);
  });

  it('표본 차량은 판매월 전에는 운행하지 않고 말소 뒤에는 빠진다', () => {
    const v = { soldMonth: '2024-03', retiredAt: '2026-01-10' };
    expect(inService(v, '2024-02-28')).toBe(false);
    expect(inService(v, '2024-03-01')).toBe(true);
    expect(inService(v, '2026-01-10')).toBe(false);
    expect(inService({}, '2020-01-01')).toBe(true); // 표본이 아닌 차량(데모·합성)은 항상
  });
});
