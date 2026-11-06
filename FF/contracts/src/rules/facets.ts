// 다중 선택 필터 + 축별 수(패싯) — 같은 축의 선택은 합집합, 다른 축끼리는 교집합.
// 축마다의 수는 자기 축 선택만 빼고 센다(값을 골라도 같은 축의 다른 값 수가 그대로 보여 더 고를 수 있다).
// Feature DB 목록(서버 검색·정적 데모 화면 검색)과 개발비 산정 목록이 같은 함수를 쓴다.

/** 행 → 축 값(여러 값이면 배열). 빈 값은 세지 않는다 */
export type FacetPick<T> = (row: T) => string | readonly string[] | null | undefined;

const values = (v: string | readonly string[] | null | undefined): readonly string[] => (v == null ? [] : typeof v === 'string' ? (v ? [v] : []) : v.filter(Boolean));

/** 쉼표 목록 질의('A,B') → 값 목록. 빈 값·중복 제거 */
export const facetList = (raw: string | null | undefined): string[] => [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];

export function facetFilter<T, K extends string>(rows: readonly T[], axes: Record<K, FacetPick<T>>, selected: Partial<Record<K, readonly string[]>>): { rows: T[]; facets: Record<K, Record<string, number>> } {
  const keys = Object.keys(axes) as K[];
  const active = keys.flatMap((k) => (selected[k]?.length ? [[k, new Set(selected[k])] as const] : []));
  // 행마다 축 값은 한 번만 뽑고, 통과하지 못한 축 수를 센다 — 0이면 통과, 1이면 그 축의 패싯에만 들어간다
  const facets = Object.fromEntries(keys.map((k) => [k, {} as Record<string, number>])) as Record<K, Record<string, number>>;
  const out: T[] = [];
  for (const row of rows) {
    const picked = new Map(keys.map((k) => [k, values(axes[k](row))]));
    const missed = active.filter(([k, want]) => !picked.get(k)!.some((v) => want.has(v))).map(([k]) => k);
    if (missed.length > 1) continue;
    if (!missed.length) out.push(row);
    for (const k of keys) {
      if (missed.length && missed[0] !== k) continue;
      const tally: Record<string, number> = facets[k];
      for (const v of new Set(picked.get(k))) tally[v] = (tally[v] ?? 0) + 1;
    }
  }
  return { rows: out, facets };
}
