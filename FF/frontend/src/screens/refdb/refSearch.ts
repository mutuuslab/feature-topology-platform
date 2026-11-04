// Feature DB 목록 조회(listRefs) — 실서버는 서버 검색, 정적 데모(스냅샷만)는 받아 둔 전체 목록에서 화면이 찾는다.
// 정적 데모에는 검색어(q)마다의 스냅샷이 없어 검색 칸에 글자를 넣으면 오류 상자가 떴다(하네스 리뷰 F5, 2026-11-04).
// 화면 검색은 서버 규칙(backend read-search.ts)의 기능명·별칭·ID 부분만 따른다 — 사내 용어집 검색은 실서버에서만.
import { REF_STATUSES, type RefStatus } from '@ff/contracts';
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
  offset?: number;
  limit?: number;
}

export interface RefSearchRow {
  refId: string;
  nameKo: string;
  nameEn: string;
  aliases?: string[];
  domain: string;
  component: string;
  status: RefStatus;
}

export interface RefSearchResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  facets?: { status?: Partial<Record<RefStatus, number>> } & Record<string, unknown>;
  release?: string | null;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 일치 순위 — 0 완전 일치, 1 앞부분, 2 부분. 없으면 null(서버 matchRank와 같은 순서, 용어집 제외) */
function rank(r: RefSearchRow, key: string): number | null {
  if (!key) return 0;
  const terms = [r.refId, r.nameKo, r.nameEn, ...(r.aliases ?? [])].map(norm);
  if (terms.includes(key)) return 0;
  if (terms.some((t) => t.startsWith(key))) return 1;
  return terms.some((t) => t.includes(key)) ? 2 : null;
}

/** 받은 전체 목록에서 검색·필터·쪽 — 상태 패싯은 상태 필터만 빼고 센다(서버와 같다) */
export function searchLocally<T extends RefSearchRow>(rows: readonly T[], q: RefSearchQuery): RefSearchResponse<T> {
  const key = norm(q.q ?? '');
  const hits = rows.flatMap((r) => {
    const k = rank(r, key);
    return k === null || (q.domain && r.domain !== q.domain) || (q.component && r.component !== q.component) ? [] : [{ r, k }];
  });
  const status = Object.fromEntries(REF_STATUSES.map((s) => [s, 0])) as Record<RefStatus, number>;
  for (const h of hits) status[h.r.status] = (status[h.r.status] ?? 0) + 1;
  const out = hits
    .filter((h) => !q.status || h.r.status === q.status)
    .sort((a, b) => a.k - b.k || (a.r.refId < b.r.refId ? -1 : a.r.refId > b.r.refId ? 1 : 0))
    .map((h) => h.r);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 50;
  return { items: out.slice(offset, offset + limit), total: out.length, offset, limit, facets: { status } };
}

/** 정적 데모 — 스냅샷의 전체 목록(쪽 200개씩)을 한 번 받아 둔다 */
async function loadAll<T>(signal: AbortSignal): Promise<T[]> {
  const first = await call<RefSearchResponse<T>>('listRefs', { query: { offset: undefined, limit: STATIC_SEARCH_PAGE }, signal });
  const rows = [...first.items];
  for (let offset = STATIC_SEARCH_PAGE; offset < first.total; offset += STATIC_SEARCH_PAGE) rows.push(...(await call<RefSearchResponse<T>>('listRefs', { query: { offset, limit: STATIC_SEARCH_PAGE }, signal })).items);
  return rows;
}

/** listRefs 조회 — 정적 데모에서 검색어가 있으면 받아 둔 전체 목록에서 찾는다(서버 검색 스냅샷이 없다) */
export function useRefSearch<T extends RefSearchRow>(query: RefSearchQuery, opts: { keepPrevious?: boolean } = {}) {
  const local = STATIC_MODE && !!query.q;
  const server = useApi<RefSearchResponse<T>>('listRefs', { query: { ...query } }, { ...(opts.keepPrevious ? { placeholderData: keepPreviousData } : {}), enabled: !local });
  const all = useQuery<T[]>({ queryKey: ['listRefs', 'static-all'], queryFn: ({ signal }) => loadAll<T>(signal), enabled: local, staleTime: Infinity });
  if (!local) return server;
  return { data: all.data ? searchLocally(all.data, query) : undefined, isPending: all.isPending, isError: all.isError, error: all.error as typeof server.error, refetch: all.refetch };
}

