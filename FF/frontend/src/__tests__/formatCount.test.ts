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
