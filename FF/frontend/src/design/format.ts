// 큰 수 표기 — 5년 운영 규모(수백만~수천만 대)를 만·억 단위로. 1만 미만은 그대로 쉼표.
// 화면에는 짧은 값(formatCount)을, 정확한 값은 title·표(formatExact)로 함께 준다.
export const formatExact = (n: number) => Math.round(n).toLocaleString('ko-KR');

export function formatCount(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a < 10_000) return formatExact(n);
  if (a < 100_000_000) return `${sign}${trim(a / 10_000, a < 100_000 ? 1 : 0)}만`;
  return `${sign}${trim(a / 100_000_000, a < 10_000_000_000 ? 1 : 0)}억`;
}

/** 소수 자리를 반올림하되 끝의 .0은 뗀다 — 12.0만 → 12만 */
const trim = (x: number, digits: number) => {
  const r = Number(x.toFixed(digits));
  return r.toLocaleString('ko-KR', { maximumFractionDigits: digits });
};
