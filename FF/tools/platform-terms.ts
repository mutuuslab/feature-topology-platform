// 플랫폼 용어 규칙 — 보고서 v1.1 용어(terms.json, guide:sync 사본)와 별개로 플랫폼이 정한 표기.
// 보고서 원문을 인용하는 생성물(contracts/src/generated, harness/guide)은 대상이 아니다.
// 사용자 결정 2026-10-18: Flag '은퇴' → 'Retirement' (상태 RETIRED의 '퇴역'은 다른 용어라 그대로).

export interface PlatformTerm {
  term: RegExp;
  fix: string;
  why: string;
}

export const PLATFORM_TERMS: PlatformTerm[] = [
  { term: /은퇴/, fix: 'Retirement', why: "Flag 은퇴 → 'Retirement'(사용자 결정 2026-10-18)" },
];

/** 주석이 아닌 줄에서 플랫폼 용어 위반을 찾는다 */
export function platformTermHits(line: string, terms: PlatformTerm[] = PLATFORM_TERMS): PlatformTerm[] {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return [];
  return terms.filter((x) => x.term.test(line));
}
