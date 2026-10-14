// 시장별 Compliance Profile — FFG-GEN-001(버전 관리·명령 기록) · FFG-GEN-003 합격: 미확인 시장 + F2 활성화는 FAIL, 미확인 시장 + 안전 Kill은 PASS
import { describe, expect, it } from 'vitest';
import { MARKETS } from '../schemas/wire';
import { COMPLIANCE_PROFILES, profileFinding, profileOf } from './compliance-profile';

describe('Compliance Profile (보고서 2.3)', () => {
  it('Profile마다 ID·Version이 있고 한 시장은 하나의 Profile에만 속한다', () => {
    for (const p of COMPLIANCE_PROFILES) expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
    const markets = COMPLIANCE_PROFILES.flatMap((p) => p.markets);
    expect(new Set(markets).size).toBe(markets.length);
    expect(profileOf('CA')?.profileId).toBe('NA-CA');
    expect(['IN', 'AU', 'OTHER'].map((m) => profileOf(m))).toEqual([null, null, null]); // Profile 없음
    expect(markets.every((m) => (MARKETS as readonly string[]).includes(m))).toBe(true);
  });

  it('보고서 2.3 예: 캐나다(검증 필요)에서 FEAT-00022(F3) 활성화는 FAIL, 같은 상태의 안전 Kill은 PASS', () => {
    expect(profileFinding({ market: 'CA', request: 'activate', fClass: 'F3', adsFeature: false })).toMatchObject({ ok: false, detail: expect.stringMatching(/NA-CA 검증 필요/), profiles: [{ profileId: 'NA-CA', version: '1.0.0', status: 'VERIFY_REQUIRED' }] });
    expect(profileFinding({ market: 'CA', request: 'deactivate', fClass: 'F3', adsFeature: false }).ok).toBe(true);
    expect(profileFinding({ market: 'CA', request: 'restore', fClass: 'F3', adsFeature: false }).ok).toBe(false);
  });

  it('확인된 시장은 통과, F0·F1은 미확인 시장도 통과, Profile 없는 시장·ADS Profile 미확인은 F2 이상 활성화 차단', () => {
    expect(profileFinding({ market: 'KR', request: 'activate', fClass: 'F3', adsFeature: false }).ok).toBe(true);
    expect(profileFinding({ market: 'BR', request: 'activate', fClass: 'F1', adsFeature: false }).ok).toBe(true);
    expect(profileFinding({ market: 'IN', request: 'activate', fClass: 'F2', adsFeature: false })).toMatchObject({ ok: false, detail: expect.stringMatching(/IN Profile 없음/) });
    expect(profileFinding({ market: 'EU', request: 'activate', fClass: 'F3', adsFeature: true })).toMatchObject({ ok: false, profiles: [{ profileId: 'EU' }, { profileId: 'ADS' }] });
  });
});
