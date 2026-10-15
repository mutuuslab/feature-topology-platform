// ODD 축소 정책 — FFG-SOT-002 합격: 등급 없는 ODD 축소 정책의 배포 0건 (새 Feature Version·확정 등급·축소 전보다 낮지 않은 등급)
import { describe, expect, it } from 'vitest';
import { PolicySpec } from '../schemas/policy';
import { oddRestrictionFindings, type OddRestrictionInput } from './odd-restriction';

const ok: OddRestrictionInput = {
  featureVersion: '1.1.0',
  restriction: { triggerId: 'TRG-FOG-CUTIN', basisRef: 'ANM-00001', baseVersion: '1.0.0' },
  baseExists: true,
  profile: { confirmed: true, fClass: 'F3' },
  baseProfile: { fClass: 'F3' },
};
const codes = (i: OddRestrictionInput) => oddRestrictionFindings(i).map((f) => f.code);

describe('ODD 축소 정책 (FFG-SOT-002)', () => {
  it('FFG-SOT-002 새 Version·확정 등급·같은 등급이면 발견 없음', () => {
    expect(codes(ok)).toEqual([]);
    expect(codes({ ...ok, profile: { confirmed: true, fClass: 'F4' } })).toEqual([]); // 더 엄격한 등급은 허용
  });

  it('FFG-SOT-002 같거나 낮은 Version·없는 축소 전 Version·미확정 등급·낮아진 등급은 배포 금지', () => {
    expect(codes({ ...ok, featureVersion: '1.0.0' })).toEqual(['NOT_NEW_VERSION']);
    expect(codes({ ...ok, featureVersion: '0.9.0' })).toEqual(['NOT_NEW_VERSION']);
    expect(codes({ ...ok, featureVersion: '1.10.0', restriction: { ...ok.restriction, baseVersion: '1.9.0' } })).toEqual([]); // 숫자 비교
    expect(codes({ ...ok, baseExists: false, baseProfile: null })).toEqual(['BASE_UNKNOWN']);
    expect(codes({ ...ok, profile: { confirmed: false, fClass: 'F3' } })).toEqual(['CLASS_UNCONFIRMED']);
    expect(codes({ ...ok, profile: null })).toEqual(['CLASS_UNCONFIRMED']);
    expect(codes({ ...ok, profile: { confirmed: true, fClass: 'F2' } })).toEqual(['CLASS_DOWNGRADE']);
  });

  it('FFG-SOT-002 정책 내용에 트리거 조건이 들어간다 — 축소 정책이 아닌 기존 정책은 그대로', () => {
    const base = { featureId: 'FEAT-00022', featureVersion: '1.1.0', controlPoint: 'Signal', flagKey: 'care_00022_signal', description: '안개 조건 제한' };
    expect(PolicySpec.parse(base)).not.toHaveProperty('oddRestriction');
    expect(PolicySpec.parse({ ...base, oddRestriction: { triggerId: 'TRG-FOG-CUTIN', baseVersion: '1.0.0' } }).oddRestriction).toEqual({ triggerId: 'TRG-FOG-CUTIN', basisRef: null, baseVersion: '1.0.0' });
    expect(PolicySpec.safeParse({ ...base, oddRestriction: { triggerId: 'X', baseVersion: '1.0' } }).success).toBe(false);
  });
});
