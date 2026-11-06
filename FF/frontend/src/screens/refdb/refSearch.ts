// Feature DB 목록 조회(listRefs) — 실서버는 서버 검색, 정적 데모(스냅샷만)는 받아 둔 전체 목록에서 화면이 찾는다.
// 정적 데모에는 검색어(q)마다의 스냅샷이 없어 검색 칸에 글자를 넣으면 오류 상자가 떴다(하네스 리뷰 F5, 2026-11-04).
// 화면 검색은 서버 규칙(backend read-search.ts)의 기능명·별칭·ID와 FF 사내 용어(contracts REF_INTERNAL_GLOSSARY, 'SCC')를 따른다 —
// 엑셀 용어집·연결 Feature 이름 검색은 실서버에서만.
import { exploreRefs, internalGlossaryHits, REF_EXPLORE_PARAM, type RefExploreFacets, type RefExploreRow, type RefExploreSummary, type RefStatus } from '@ff/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { call, STATIC_MODE } from '../../api/client';
import { useApi } from '../../api/hooks';

/** 정적 데모 전체 목록 한 쪽 크기 — 서버 상한(REF_PAGE_MAX)과 같다. tools/snapshot-api.ts가 같은 쪽을 받아 둔다 */
export const STATIC_SEARCH_PAGE = 200;

export interface RefSearchQuery {
  q?: string;
  domain?: string;
  component?: string;
  status?: string;
  statuses?: string;
  offset?: number;
  limit?: number;
  /** 이 출처를 쓰는 행만 */
  source?: string;
  /** 다중 선택(쉼표 목록) — asils·lifecycles·swStacks·tshirts·vehicleTypes·regions(contracts REF_EXPLORE_PARAM) */
  [multi: string]: string | number | undefined;
}

/** 다중 선택 질의가 하나라도 있나(상태 포함) */
export const hasMultiQuery = (q: RefSearchQuery) => !!q.statuses || Object.values(REF_EXPLORE_PARAM).some((k) => !!q[k]);

export type RefSearchRow = RefExploreRow & {
  refId: string;
  nameKo: string;
  nameEn: string;
  aliases?: string[];
  status: RefStatus;
};

export interface RefSearchResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  /** 축별 수 — 서버·화면 검색이 같은 함수(contracts exploreRefs). 옛 응답에는 상태 축만 있을 수 있다 */
  facets?: Partial<RefExploreFacets>;
  /** 지금 조건의 요약(표·트리·필터 수와 같은 행 집합) */
  summary?: RefExploreSummary;
  release?: string | null;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 일치 순위 — 0 완전 일치, 1 앞부분, 2 부분, 3 사내 용어. 없으면 null(서버 matchRank와 같은 순서, 엑셀 용어집 제외) */
function rank(r: RefSearchRow, key: string, internal: ReadonlySet<string>): number | null {
  if (!key) return 0;
  const terms = [r.refId, r.nameKo, r.nameEn, ...(r.aliases ?? [])].map(norm);
  if (terms.includes(key)) return 0;
  if (terms.some((t) => t.startsWith(key))) return 1;
  if (terms.some((t) => t.includes(key))) return 2;
  return internal.has(r.refId) ? 3 : null;
}

/** 받은 전체 목록에서 검색·필터·쪽 — 필터·축별 수·요약은 서버와 같은 함수(exploreRefs). 순위는 서버 matchRank와 같은 순서 */
export function searchLocally<T extends RefSearchRow>(rows: readonly T[], q: RefSearchQuery): RefSearchResponse<T> {
  const key = norm(String(q.q ?? ''));
  const internal = internalGlossaryHits(key);
  const hits = rows.flatMap((r) => {
    const k = rank(r, key, internal);
    return k === null ? [] : [{ r, k }];
  });
  hits.sort((a, b) => a.k - b.k || (a.r.refId < b.r.refId ? -1 : a.r.refId > b.r.refId ? 1 : 0));
  const { rows: out, facets, summary } = exploreRefs(hits.map((h) => h.r), q as Parameters<typeof exploreRefs>[1]);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { items: out.slice(offset, offset + limit), total: out.length, offset, limit, facets, summary };
}

/** 정적 데모 — 스냅샷의 전체 목록(쪽 200개씩)을 한 번 받아 둔다 */
export async function loadAll<T>(signal: AbortSignal): Promise<T[]> {
  const first = await call<RefSearchResponse<T>>('listRefs', { query: { offset: undefined, limit: STATIC_SEARCH_PAGE }, signal });
  const rows = [...first.items];
  for (let offset = STATIC_SEARCH_PAGE; offset < first.total; offset += STATIC_SEARCH_PAGE) rows.push(...(await call<RefSearchResponse<T>>('listRefs', { query: { offset, limit: STATIC_SEARCH_PAGE }, signal })).items);
  return rows;
}

/**
 * 정적 데모 스냅샷에 이 모양의 파일이 있나 — tools/snapshot-api.ts는 전체 목록의 쪽, 상태 하나·도메인·도메인+컴포넌트의 첫 쪽만 저장한다.
 * 도메인+상태 탭, 필터의 2쪽 이후는 없다(2026-11-06 하네스 리뷰 — '데모에 없는 데이터' 오류 상자)
 */
export function staticSnapshotShape(query: RefSearchQuery): boolean {
  if (query.q || query.source || hasMultiQuery(query)) return false;
  const filters = (['status', 'domain', 'component'] as const).filter((k) => !!query[k]).join(',');
  if (!filters) return true;
  return !query.offset && (filters === 'status' || filters === 'domain' || filters === 'domain,component');
}

/** listRefs 조회 — 정적 데모에서 스냅샷에 없는 모양(검색어·출처·다중 선택·필터 조합·필터 2쪽)이면 받아 둔 전체 목록에서 찾는다 */
export function useRefSearch<T extends RefSearchRow>(query: RefSearchQuery, opts: { keepPrevious?: boolean } = {}) {
  // 실서버는 다중 선택까지 서버가 거른다. 정적 데모(스냅샷만)는 저장된 모양이 아니면 받아 둔 전체 목록에서
  const local = STATIC_MODE && !staticSnapshotShape(query);
  const server = useApi<RefSearchResponse<T>>('listRefs', { query: { ...query } }, { ...(opts.keepPrevious ? { placeholderData: keepPreviousData } : {}), enabled: !local });
  const all = useQuery<T[]>({ queryKey: ['listRefs', 'explorer-all'], queryFn: ({ signal }) => loadAll<T>(signal), enabled: local, staleTime: Infinity });
  if (!local) return server;
  return { data: all.data ? searchLocally(all.data, query) : undefined, isPending: all.isPending, isError: all.isError, error: all.error as typeof server.error, refetch: all.refetch };
}

