import { describe, expect, it } from 'vitest';
import { formatCount, formatExact } from '../design/format';

describe('큰 수 표기 — 만·억', () => {
  it('1만 미만은 쉼표 그대로', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(9_999)).toBe('9,999');
  });
  it('만 단위 — 10만 미만은 소수 한 자리, 이상은 정수', () => {
    expect(formatCount(12_345)).toBe('1.2만');
    expect(formatCount(20_000)).toBe('2만');
    expect(formatCount(892_336)).toBe('89만');
    expect(formatCount(9_607_641)).toBe('961만');
    expect(formatCount(35_019_444)).toBe('3,502만');
  });
  it('억 단위', () => {
    expect(formatCount(123_456_789)).toBe('1.2억');
    expect(formatCount(-20_000)).toBe('-2만');
  });
  it('정확한 값', () => expect(formatExact(9_607_641.4)).toBe('9,607,641'));
});

import { niceMax } from '../screens/biz/charts';
describe('추이 축 최댓값 — 눈금 4칸이 둥근 수', () => {
  // 회귀: 2.5배 단계로 2.5만이 되면 눈금이 6,250·1.3만·1.9만으로 고르지 않았다
  it.each([
    [23_000, 40_000],
    [9_000, 20_000],
    [37, 40],
    [0, 4],
  ])('%d → %d', (v, max) => {
    expect(niceMax(v)).toBe(max);
    expect(niceMax(v)).toBeGreaterThanOrEqual(v);
  });
});
