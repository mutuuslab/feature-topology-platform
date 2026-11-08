// 차량 정책 캐시(P9, FR-LPC-001~003 · FR-RTE-001-003 · FR-RTE-002-004/005) — 차량이 받아 둔 서명 정책을 쓰기 전에 다시 확인하는 순수 규칙.
// 차량 시뮬레이터(vehicle-runtime.service)와 실차 런타임이 같은 판정을 쓴다. 서명·해시 계산은 호출자가 하고 결과만 넘긴다.
//  · 유효 기간: 정책 게시본(서명 payload)의 validUntil — 발행 시각 + 캐시 유효 기간(FF_POLICY_CACHE_TTL_DAYS, 기본 90일)
//  · 사용 전 확인: 서명(신뢰 앵커) 재검증·저장 해시와 재계산 해시 비교 → 손상된 캐시는 빼고 직전 정상 캐시로, 그것도 없으면 Safe Default 위임
//  · 위임은 사유·Feature·Flag·시각을 차량 기록에 남긴다(상태가 바뀔 때만 — 같은 사유를 반복 기록하지 않는다)

// @req FR-LPC-001-003
/** 정책 캐시 기본 유효 기간 */
export const POLICY_CACHE_TTL_DAYS_DEFAULT = 90;

export const policyValidUntil = (issuedAt: string, ttlMs: number) => new Date(Date.parse(issuedAt) + ttlMs).toISOString();

/** 캐시 한 건의 상태 */
export const CACHE_STATUSES = ['VALID', 'EXPIRED', 'UNVERIFIED', 'SIGNATURE_INVALID', 'INTEGRITY_MISMATCH'] as const;
export type CacheStatus = (typeof CACHE_STATUSES)[number];

/** Safe Default 위임 사유 — 차량 기록(detail)과 화면에 그대로 쓴다 */
export const CACHE_DELEGATION = {
  CACHE_EXPIRED: '정책 캐시 유효 기간이 지났습니다',
  CACHE_MISSING: '받은 정책이 없습니다',
  CACHE_REACQUIRE_REQUIRED: '서명된 정책과 유효 기간을 확인할 수 없습니다 — 정책을 다시 받으세요',
  CACHE_SIGNATURE_INVALID: '저장된 정책의 서명이 맞지 않습니다',
  CACHE_INTEGRITY_MISMATCH: '저장된 정책의 무결성 값이 다시 계산한 값과 다릅니다',
  EVALUATION_ERROR: '정책 평가 중 오류가 났습니다',
} as const;
export type CacheDelegation = keyof typeof CACHE_DELEGATION;

/**
 * 캐시 한 건 상태 — 서명 확인 결과(PKI verify reason)를 받아 무결성(해시 불일치)과 서명 실패를 나눈다. 손상이 먼저, 만료는 그다음.
 * 호출자는 검증한 서명 payload를 넘긴다. 기한을 확인할 수 없는 구형 캐시는 재취득 전 사용할 수 없다.
 */
export function cacheStatus(entry: { issuedAt?: string; validUntil?: string | null }, now: number, verifyReason: string): CacheStatus {
  if (verifyReason === 'PAYLOAD_TAMPERED') return 'INTEGRITY_MISMATCH';
  if (verifyReason !== 'SIGNATURE_VALID') return 'SIGNATURE_INVALID';
  const until = entry.validUntil ? Date.parse(entry.validUntil) : NaN;
  const issued = entry.issuedAt === undefined ? null : Date.parse(entry.issuedAt);
  if (!Number.isFinite(now) || !Number.isFinite(until) || (issued !== null && (!Number.isFinite(issued) || until <= issued))) return 'UNVERIFIED';
  if (until <= now) return 'EXPIRED';
  return 'VALID';
}

const DELEGATION_OF: Record<Exclude<CacheStatus, 'VALID'>, CacheDelegation> = {
  EXPIRED: 'CACHE_EXPIRED',
  UNVERIFIED: 'CACHE_REACQUIRE_REQUIRED',
  SIGNATURE_INVALID: 'CACHE_SIGNATURE_INVALID',
  INTEGRITY_MISMATCH: 'CACHE_INTEGRITY_MISMATCH',
};

export interface CacheChoice {
  /** 쓸 캐시 — 현재·직전 정상 캐시·Safe Default */
  use: 'CURRENT' | 'PREVIOUS' | 'SAFE_DEFAULT';
  current: CacheStatus | null;
  previous: CacheStatus | null;
  /** Safe Default로 위임하면 사유, 아니면 null */
  delegation: CacheDelegation | null;
  /** 손상돼 뺀 캐시가 있으면 그 사유(직전 캐시로 대체했어도 남긴다 — 무결성 위반 표시) */
  excluded: CacheDelegation | null;
}

/**
 * 어느 캐시로 평가할지(FR-LPC-003-003·002-003·002-004) — 손상된 현재 캐시는 빼고 직전 정상 캐시로 대체한다.
 * 만료는 손상이 아니다: 직전 캐시는 더 오래됐으므로 대체하지 않고 Safe Default로 위임한다.
 */
export function chooseCache(current: CacheStatus | null, previous: CacheStatus | null): CacheChoice {
  if (current === null) return { use: 'SAFE_DEFAULT', current, previous, delegation: 'CACHE_MISSING', excluded: null };
  if (current === 'VALID') return { use: 'CURRENT', current, previous, delegation: null, excluded: null };
  if (current === 'EXPIRED') return { use: 'SAFE_DEFAULT', current, previous, delegation: 'CACHE_EXPIRED', excluded: null };
  const excluded = DELEGATION_OF[current];
  if (previous === 'VALID') return { use: 'PREVIOUS', current, previous, delegation: null, excluded };
  return { use: 'SAFE_DEFAULT', current, previous, delegation: excluded, excluded };
}

/**
 * 수신 때 게시본 유효 기간 파싱(FR-RTE-001-003) — 형식이 틀리거나 발행 시각보다 앞서면 MALFORMED, 이미 지났으면 EXPIRED, 맞으면 null.
 * POLICY는 기한 필수다. 차단·복원은 별도 Guard validity 계약을 쓰므로 이 필드를 요구하지 않는다.
 */
export function validityProblem(payload: { kind?: string; issuedAt: string; validUntil?: string | null }, now: number): 'MALFORMED' | 'EXPIRED' | null {
  if (payload.validUntil === undefined || payload.validUntil === null) return payload.kind === 'POLICY' ? 'MALFORMED' : null;
  const until = Date.parse(payload.validUntil);
  const issued = Date.parse(payload.issuedAt);
  if (!Number.isFinite(until) || !Number.isFinite(issued) || until <= issued) return 'MALFORMED';
  return until <= now ? 'EXPIRED' : null;
}
