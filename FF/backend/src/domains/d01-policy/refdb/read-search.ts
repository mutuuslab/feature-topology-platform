// Feature DB 검색(30-95 §6.1) — 순수 함수. 한글·영문 기능명·별칭·사내 용어집·ID를 대소문자·띄어쓰기 무시로 찾고,
// 도메인·컴포넌트·상태 패싯 수를 센다. 패싯은 자기 축의 필터만 빼고 센다(도메인을 골라도 다른 도메인 수가 보이게 — 단계 선택).
import type { FeatureRefRow, RefGlossary, RefStatus } from '@ff/contracts';
import { REF_STATUSES } from '@ff/contracts';

export const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export interface RefSearchQuery {
  q?: string;
  domain?: string;
  component?: string;
  status?: RefStatus;
}

export interface RefFacets {
  domain: Record<string, number>;
  component: Record<string, number>;
  status: Record<RefStatus, number>;
}

/** 검색어 일치 순위 — 0 ID·이름·별칭 완전 일치, 1 앞부분 일치, 2 부분 일치, 3 용어집만 일치. 일치 없음은 null */
export function matchRank(r: FeatureRefRow, key: string, glossaryRefIds: ReadonlySet<string>): number | null {
  if (!key) return 0;
  const terms = [r.refId, r.nameKo, r.nameEn, ...r.aliases].map(norm);
  if (terms.includes(key)) return 0;
  if (terms.some((t) => t.startsWith(key))) return 1;
  if (terms.some((t) => t.includes(key))) return 2;
  return glossaryRefIds.has(r.refId) ? 3 : null;
}

/** 검색어에 걸리는 용어집 항목(용어·뜻)이 가리키는 기준 행 */
export function glossaryHits(glossary: readonly RefGlossary[], key: string): Set<string> {
  const out = new Set<string>();
  if (!key) return out;
  for (const g of glossary) if (norm(g.term).includes(key) || norm(g.meaning).includes(key)) for (const id of g.refIds) out.add(id);
  return out;
}

const tally = (rows: readonly FeatureRefRow[], pick: (r: FeatureRefRow) => string) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[pick(r)] = (out[pick(r)] ?? 0) + 1;
  return out;
};

/** 검색 + 필터 + 순위 정렬(순위 → ID) + 패싯 */
export function searchRefs(rows: readonly FeatureRefRow[], glossary: readonly RefGlossary[], q: RefSearchQuery): { rows: FeatureRefRow[]; facets: RefFacets } {
  const key = q.q ? norm(q.q) : '';
  const gl = glossaryHits(glossary, key);
  const hits: { r: FeatureRefRow; rank: number }[] = [];
  for (const r of rows) {
    const rank = matchRank(r, key, gl);
    if (rank !== null) hits.push({ r, rank });
  }
  const pass = (r: FeatureRefRow, skip: keyof RefSearchQuery | null) =>
    (skip === 'domain' || !q.domain || r.domain === q.domain) && (skip === 'component' || !q.component || r.component === q.component) && (skip === 'status' || !q.status || r.status === q.status);
  const matched = hits.map((h) => h.r);
  const status = Object.fromEntries(REF_STATUSES.map((s) => [s, 0])) as Record<RefStatus, number>;
  for (const r of matched) if (pass(r, 'status')) status[r.status]++;
  const facets: RefFacets = {
    domain: tally(
      matched.filter((r) => pass(r, 'domain')),
      (r) => r.domain,
    ),
    component: tally(
      matched.filter((r) => pass(r, 'component')),
      (r) => r.component,
    ),
    status,
  };
  const out = hits
    .filter((h) => pass(h.r, null))
    .sort((a, b) => a.rank - b.rank || (a.r.refId < b.r.refId ? -1 : a.r.refId > b.r.refId ? 1 : 0))
    .map((h) => h.r);
  return { rows: out, facets };
}
