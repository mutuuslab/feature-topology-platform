// 엔터프라이즈 Fleet — 현대차 1000만대+ 차량별 Feature 상태 (시뮬레이션·결정적 해시)
import { features, Feature } from './model';

export const fleetStats = {
  total: 10_240_000,
  byRegion: { KR: 3_120_000, EU: 2_480_000, US: 2_640_000, ETC: 2_000_000 } as Record<string, number>,
  byDeploy: { 'Policy-only': 4_900_000, Binary: 3_800_000, Calibration: 900_000, TBD: 640_000 } as Record<string, number>,
  onlineRate: 0.93,
};

export interface Vehicle { vin: string; region: string; my: number; trim: string; hw: string; sw: string; cohort: string; }
export const sampleVehicles: Vehicle[] = [
  { vin: 'KMHX001KR2027A0001', region: 'KR', my: 2027, trim: 'Premium', hw: 'Gen3', sw: '3.2.1', cohort: 'pilot_kr_01' },
  { vin: 'KMHX002EU2027A0042', region: 'EU', my: 2027, trim: 'Premium', hw: 'Gen3', sw: '3.2.0', cohort: 'eu_wave_2' },
  { vin: 'KMHX003US2027A0107', region: 'US', my: 2027, trim: 'Premium', hw: 'Gen3', sw: '3.1.9', cohort: 'us_hold' },
  { vin: 'KMHX004KR2026B0311', region: 'KR', my: 2026, trim: 'Standard', hw: 'Gen2', sw: '2.8.0', cohort: 'legacy_kr' },
  { vin: 'KMHX005EU2028A0540', region: 'EU', my: 2028, trim: 'Premium', hw: 'Gen3', sw: '3.4.0', cohort: 'eu_wave_3' },
];

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; };

export type VState = 'enabled' | 'disabled' | 'degraded' | 'blocked' | 'apply_fail' | 'n/a';
export interface FeatVState { feature: Feature; state: VState; reason: string; }

// 차량 1대의 Feature별 상태 (variant 적용성 + 결정적 해시)
export function vehicleFeatureStates(v: Vehicle): FeatVState[] {
  return features.map(f => {
    if (f.lifecycle === 'Proposed' || f.lifecycle === 'Developing') return { feature: f, state: 'n/a', reason: `${f.lifecycle} (미출시)` };
    // 구조적 적용성: BDC/Body Policy-only 예시 — region KR/EU & Gen3 & sw>=3.2
    const gen3 = v.hw === 'Gen3', sw32 = v.sw >= '3.2', regionOk = ['KR', 'EU'].includes(v.region);
    if (f.domain === 'Body' && f.deployType === 'Policy-only' && !(regionOk && gen3 && sw32))
      return { feature: f, state: 'blocked', reason: 'Variant 미충족(region/HW/SW)' };
    const r = hash(v.vin + f.id) % 100;
    if (r < 78) return { feature: f, state: 'enabled', reason: 'Variant PASS · Control ALLOW' };
    if (r < 88) return { feature: f, state: 'disabled', reason: 'Policy OFF / Entitlement 없음' };
    if (r < 94) return { feature: f, state: 'degraded', reason: 'Safe behavior (장애 저하)' };
    if (r < 98) return { feature: f, state: 'apply_fail', reason: 'ECU version mismatch' };
    return { feature: f, state: 'blocked', reason: 'Kill-switch / 법규' };
  });
}

export const STATE_COLOR: Record<VState, string> = {
  enabled: 'var(--pass)', disabled: 'var(--muted)', degraded: 'var(--pending)',
  blocked: 'var(--fail)', apply_fail: 'var(--fail)', 'n/a': 'var(--line)',
};
