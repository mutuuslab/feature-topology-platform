// Feature DB 검색(30-95 §6.1) — 순수 함수. 한글·영문 기능명·별칭·사내 용어집·ID를 대소문자·띄어쓰기 무시로 찾고,
// 도메인·컴포넌트·상태·다중 선택 축의 패싯 수와 요약을 센다. 패싯은 자기 축의 필터만 빼고 센다(도메인을 골라도 다른 도메인 수가 보이게 — 단계 선택).
// 검색어는 이 행을 연결한 Registry Feature 이름('스마트 크루즈 컨트롤')과 FF 사내 용어(contracts REF_INTERNAL_GLOSSARY, 'SCC')에도 건다(P1-8).
import type { FeatureRefRow, RefExploreFacets, RefExploreSummary, RefGlossary, RefStatus } from '@ff/contracts';
import { exploreRefs, internalGlossaryHits } from '@ff/contracts';

export const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export interface RefSearchQuery {
  q?: string;
  domain?: string;
  component?: string;
  status?: RefStatus;
  /** 이 출처를 쓰는 행만(출처 점검 '개정 있음' → 영향 행) */
  source?: string;
  /** 다중 선택(쉼표 목록) — statuses·asils·lifecycles·swStacks·tshirts·vehicleTypes·regions(contracts REF_EXPLORE_PARAM) */
  [multi: string]: string | undefined;
}

/** 패싯 — 도메인·컴포넌트·상태 + 출처·분류 트리·다중 선택 축(contracts exploreRefs) */
export type RefFacets = RefExploreFacets;

/** 검색어 일치 순위 — 0 ID·이름·별칭 완전 일치, 1 앞부분 일치, 2 부분 일치, 3 용어집만 일치. 일치 없음은 null */
export function matchRank(r: FeatureRefRow, key: string, glossaryRefIds: ReadonlySet<string>): number | null {
  if (!key) return 0;
  const terms = [r.refId, r.nameKo, r.nameEn, ...r.aliases].map(norm);
  if (terms.includes(key)) return 0;
  if (terms.some((t) => t.startsWith(key))) return 1;
  if (terms.some((t) => t.includes(key))) return 2;
  return glossaryRefIds.has(r.refId) ? 3 : null;
}

/** 검색어에 걸리는 용어집 항목(용어·뜻)이 가리키는 기준 행 — 엑셀 용어집 + FF 사내 용어 */
export function glossaryHits(glossary: readonly RefGlossary[], key: string): Set<string> {
  const out = new Set<string>();
  if (!key) return out;
  for (const g of glossary) if (norm(g.term).includes(key) || norm(g.meaning).includes(key)) for (const id of g.refIds) out.add(id);
  for (const id of internalGlossaryHits(key)) out.add(id);
  return out;
}

/** 검색어가 이 행을 연결한 Registry Feature 이름에 걸리는 기준 행(두 글자 이상) */
export function featureNameHits(featureNames: ReadonlyMap<string, readonly string[]>, key: string): Set<string> {
  const out = new Set<string>();
  if (key.length < 2) return out;
  for (const [refId, names] of featureNames) if (names.some((n) => norm(n).includes(key))) out.add(refId);
  return out;
}

/** 검색 + 필터 + 순위 정렬(순위 → ID) + 패싯 + 요약. featureNames — 기준 행 → 연결한 Registry Feature 이름(용어집과 같은 순위 3) */
export function searchRefs(rows: readonly FeatureRefRow[], glossary: readonly RefGlossary[], q: RefSearchQuery, featureNames: ReadonlyMap<string, readonly string[]> = new Map()): { rows: FeatureRefRow[]; facets: RefFacets; summary: RefExploreSummary } {
  const key = q.q ? norm(q.q) : '';
  const gl = glossaryHits(glossary, key);
  for (const id of featureNameHits(featureNames, key)) gl.add(id);
  const hits: { r: FeatureRefRow; rank: number }[] = [];
  for (const r of rows) {
    const rank = matchRank(r, key, gl);
    if (rank !== null) hits.push({ r, rank });
  }
  // 필터·패싯·요약은 화면 검색(정적 데모)과 같은 함수 — 순위 순으로 넘겨 통과한 행의 순서를 그대로 쓴다
  hits.sort((a, b) => a.rank - b.rank || (a.r.refId < b.r.refId ? -1 : a.r.refId > b.r.refId ? 1 : 0));
  const { rows: out, facets, summary } = exploreRefs(hits.map((h) => h.r), q);
  return { rows: out, facets, summary };
}
