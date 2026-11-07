// 차량 정책 캐시 규칙(P9) — 유효 기간·사용 전 서명/무결성 확인·손상 캐시 제외·직전 캐시 대체·Safe Default 위임
import { describe, expect, it } from 'vitest';
import { cacheStatus, chooseCache, policyValidUntil, validityProblem } from './policy-cache';

const NOW = Date.parse('2026-11-07T00:00:00.000Z');
const DAY = 86_400_000;

describe('정책 캐시 유효 기간(FR-LPC-001-003)', () => {
  it('발행 시각 + 유효 기간, 지나면 EXPIRED, 유효 기간 없는 옛 캐시는 만료되지 않는다', () => {
    expect(policyValidUntil('2026-11-01T00:00:00.000Z', 90 * DAY)).toBe('2027-01-30T00:00:00.000Z');
    expect(cacheStatus({ validUntil: '2026-11-08T00:00:00.000Z' }, NOW, 'SIGNATURE_VALID')).toBe('VALID');
    expect(cacheStatus({ validUntil: '2026-11-07T00:00:00.000Z' }, NOW, 'SIGNATURE_VALID')).toBe('EXPIRED');
    expect(cacheStatus({}, NOW, 'SIGNATURE_VALID')).toBe('VALID');
  });

  it('손상이 만료보다 먼저 — 해시 불일치는 INTEGRITY_MISMATCH, 그 밖의 서명 실패는 SIGNATURE_INVALID', () => {
    expect(cacheStatus({ validUntil: '2020-01-01T00:00:00.000Z' }, NOW, 'PAYLOAD_TAMPERED')).toBe('INTEGRITY_MISMATCH');
    for (const r of ['BAD_SIGNATURE', 'UNKNOWN_KEY', 'WRONG_KEY_PURPOSE', 'KEY_EXPIRED']) expect(cacheStatus({}, NOW, r), r).toBe('SIGNATURE_INVALID');
  });
});

describe('캐시 고르기(FR-LPC-003-003·002-003·002-004)', () => {
  it('정상은 현재 캐시, 없으면 CACHE_MISSING, 만료는 직전 캐시가 있어도 Safe Default', () => {
    expect(chooseCache('VALID', 'VALID')).toMatchObject({ use: 'CURRENT', delegation: null, excluded: null });
    expect(chooseCache(null, null)).toMatchObject({ use: 'SAFE_DEFAULT', delegation: 'CACHE_MISSING' });
    expect(chooseCache('EXPIRED', 'VALID')).toMatchObject({ use: 'SAFE_DEFAULT', delegation: 'CACHE_EXPIRED', excluded: null });
  });

  it('손상된 현재 캐시는 빼고 직전 정상 캐시로 — 직전도 없거나 손상이면 Safe Default(사유는 손상 종류)', () => {
    expect(chooseCache('INTEGRITY_MISMATCH', 'VALID')).toMatchObject({ use: 'PREVIOUS', delegation: null, excluded: 'CACHE_INTEGRITY_MISMATCH' });
    expect(chooseCache('SIGNATURE_INVALID', null)).toMatchObject({ use: 'SAFE_DEFAULT', delegation: 'CACHE_SIGNATURE_INVALID', excluded: 'CACHE_SIGNATURE_INVALID' });
    expect(chooseCache('INTEGRITY_MISMATCH', 'EXPIRED')).toMatchObject({ use: 'SAFE_DEFAULT', delegation: 'CACHE_INTEGRITY_MISMATCH' });
  });
});

describe('수신 때 유효 기간 파싱(FR-RTE-001-003)', () => {
  it('없으면 통과, 형식 틀림·발행 시각 이전은 MALFORMED, 이미 지났으면 EXPIRED', () => {
    expect(validityProblem({ issuedAt: '2026-11-01T00:00:00.000Z' }, NOW)).toBeNull();
    expect(validityProblem({ issuedAt: '2026-11-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z' }, NOW)).toBeNull();
    expect(validityProblem({ issuedAt: '2026-11-01T00:00:00.000Z', validUntil: 'soon' }, NOW)).toBe('MALFORMED');
    expect(validityProblem({ issuedAt: '2026-11-01T00:00:00.000Z', validUntil: '2026-10-01T00:00:00.000Z' }, NOW)).toBe('MALFORMED');
    expect(validityProblem({ issuedAt: '2026-11-01T00:00:00.000Z', validUntil: '2026-11-06T00:00:00.000Z' }, NOW)).toBe('EXPIRED');
  });
});
