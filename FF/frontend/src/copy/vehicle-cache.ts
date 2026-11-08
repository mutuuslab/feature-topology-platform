// 차량 정책 캐시 문구(P9) — 차량 런타임 화면 '기록' 탭. 규칙: contracts/src/rules/policy-cache.ts
export const vehicleCache = {
  title: '차량 정책 캐시',
  lead: '쓰기 전에 서명·무결성·유효 기간을 다시 봅니다. 손상되면 직전 캐시, 없으면 안전 기본값.',
  caption: '정책별 캐시 상태',
  col: { flag: 'Flag', status: '캐시 상태', validUntil: '유효 기간', use: '평가에 쓴 캐시', reason: '사유' },
  status: { VALID: '정상', EXPIRED: '유효 기간 지남', SIGNATURE_INVALID: '서명 불일치', INTEGRITY_MISMATCH: '무결성 위반' } as Record<string, string>,
  use: { CURRENT: '현재 캐시', PREVIOUS: '직전 정상 캐시', SAFE_DEFAULT: '안전 기본값' } as Record<string, string>,
  reason: {
    CACHE_EXPIRED: '정책 캐시 유효 기간이 지났습니다',
    CACHE_MISSING: '받은 정책이 없습니다',
    CACHE_SIGNATURE_INVALID: '저장된 정책의 서명이 맞지 않습니다',
    CACHE_INTEGRITY_MISMATCH: '저장된 정책의 무결성 값이 다시 계산한 값과 다릅니다',
    EVALUATION_ERROR: '정책 평가 중 오류가 났습니다',
  } as Record<string, string>,
  /** 무결성 위반 표시(FR-SDM-002-002) — 손상된 캐시를 뺐다는 사실을 운영자에게 알린다 */
  integrityAlert: (n: number) => `무결성 위반 캐시 ${n}건 — 차량이 이 캐시를 쓰지 않았습니다.`,
  ok: '모든 정책 캐시가 정상입니다.',
  killHistory: '차량 쪽 차단·복원 이력',
};
