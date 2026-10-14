// 재-HARA 조건 자동 검출 — FFG-LCY-003 수용 기준: 6개 조건 모두(조건별 변경 1건씩) 재-HARA 요청이 생성된다, 무관한 변경은 0건
import { describe, expect, it } from 'vitest';
import { REHARA_CONDITIONS, reharaFindings, type ReharaChange } from './rehara';

const feat = { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', controlPoints: ['Parameter'] as ('Parameter' | 'Signal')[] };
const prof = { fClass: 'F3' as const, deactClass: 'DC2' as const, takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, safeState: 'BASE_ONLY', markets: ['KR'], adsFeature: false };
const version = (after: { feature?: object; profile?: object }): ReharaChange => ({ kind: 'VERSION', before: { feature: feat, profile: prof as any }, after: { feature: { ...feat, ...after.feature } as typeof feat, profile: { ...prof, ...after.profile } as any } });
const cond = (c: ReharaChange) => reharaFindings(c).map((f) => f.condition);

describe('재-HARA 조건 (보고서 6.4)', () => {
  it('조건별 변경 1건씩 → 6개 조건이 모두 검출된다', () => {
    const cases: [ReharaChange, string][] = [
      [version({ profile: { markets: ['KR', 'EU'] } }), 'SCOPE'],
      [version({ profile: { takeoverMs: 2000 } }), 'CONTROL'],
      [{ kind: 'DEPENDENCY', dependency: { dependencyId: 'DEP-00099', type: 'REQUIRES', sourceFeatureId: 'FEAT-00022', targetFeatureId: 'FEAT-00145' } }, 'TOPOLOGY'],
      [{ kind: 'ANOMALY', anomalyId: 'ANM-00001', anomalyKind: 'FIELD_SOTIF' }, 'FIELD'],
      [{ kind: 'ANOMALY', anomalyId: 'ANM-00002', anomalyKind: 'SECURITY' }, 'TARA'],
      [{ kind: 'TOOL', adsFeature: true, from: { tool: 'ausfahrt-ffval/1', limits: { kill_latency: 1 } }, to: { tool: 'ausfahrt-ffval/2', limits: { kill_latency: 1 } } }, 'ADS_TOOL'],
    ];
    for (const [c, want] of cases) expect(cond(c), want).toEqual([want]);
    expect(new Set(cases.map(([, w]) => w))).toEqual(new Set(REHARA_CONDITIONS));
  });

  it('제어 권한: Control Point 변경, 등급·Safe State 변경도 CONTROL — 내용 설명과 중복 방지 참조', () => {
    const f = reharaFindings(version({ feature: { controlPoints: ['Parameter', 'Signal'] }, profile: { deactClass: 'DC3', safeState: 'OFF' } }));
    expect(f).toEqual([{ condition: 'CONTROL', detail: expect.stringMatching(/Control Point.*deactClass DC2 → DC3.*safeState BASE_ONLY → OFF/), ref: expect.any(String) }]);
  });

  it('무관한 변경은 요청 0건 — 설명만 바꾼 Version, ADS가 아닌 Feature의 도구 변경, 배달 이상 징후', () => {
    expect(reharaFindings(version({}))).toEqual([]);
    expect(reharaFindings({ kind: 'TOOL', adsFeature: false, from: { tool: 'a', limits: {} }, to: { tool: 'b', limits: {} } })).toEqual([]);
    expect(reharaFindings({ kind: 'ANOMALY', anomalyId: 'ANM-1', anomalyKind: 'DELIVERY' })).toEqual([]);
  });

  it('ADS 검증 임계값만 바뀌어도 ADS_TOOL', () => {
    expect(cond({ kind: 'TOOL', adsFeature: true, from: { tool: 't', limits: { ftti_margin: 0 } }, to: { tool: 't', limits: { ftti_margin: -0.5 } } })).toEqual(['ADS_TOOL']);
  });
});
