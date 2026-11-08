// 권한 범위 규칙(ADS-BE15) — 축마다 null = 제한 없음
import { describe, expect, it } from 'vitest';
import { scopeAxisText, scopeViolation } from './role-scope';

const t = { featureId: 'FEAT-00022', market: 'KR', environment: 'demo' };

describe('권한 범위', () => {
  it('범위가 없거나 모든 축이 null이면 제한 없음', () => {
    expect(scopeViolation(null, t)).toBeNull();
    expect(scopeViolation({ markets: null, featureIds: null, environments: null }, t)).toBeNull();
  });
  it('환경 → 시장 → Feature 순으로 걸린 축을 알린다', () => {
    expect(scopeViolation({ markets: ['US'], featureIds: null, environments: ['staging'] }, t)?.axis).toBe('environments');
    expect(scopeViolation({ markets: ['US'], featureIds: null, environments: null }, t)?.axis).toBe('markets');
    expect(scopeViolation({ markets: null, featureIds: ['FEAT-00004'], environments: null }, t)?.axis).toBe('featureIds');
    expect(scopeViolation({ markets: ['KR'], featureIds: ['FEAT-00022'], environments: ['demo'] }, t)).toBeNull();
  });
  it('시장을 모르면 시장 제한 계정은 거부, 빈 목록은 그 축 전체 거부', () => {
    expect(scopeViolation({ markets: ['KR'], featureIds: null, environments: null }, { ...t, market: null })?.axis).toBe('markets');
    expect(scopeViolation({ markets: [], featureIds: null, environments: null }, t)?.axis).toBe('markets');
  });
  it('표시 글자', () => {
    expect(scopeAxisText(null)).toBe('전체');
    expect(scopeAxisText([])).toBe('없음');
    expect(scopeAxisText(['KR', 'EU'])).toBe('KR, EU');
  });
});
