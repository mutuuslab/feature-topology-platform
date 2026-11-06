// Feature DB 목록 탐색(30-95 §6.1 확장) — 왼쪽 분류·출처 트리, 오른쪽 다중 선택 필터, 위의 요약 수치가 같은 행 집합에서 나온다.
// 서버 검색(backend read-search.ts)과 정적 데모 화면 검색(frontend refSearch.ts)이 이 함수를 같이 쓴다.
import { REF_STATUSES, type FeatureRefRow, type RefStatus } from '../../schemas/refdb';
import { facetFilter, facetList } from '../facets';

/** 오른쪽 다중 선택 필터 축(행 필드) — 순서가 화면 순서 */
export const REF_EXPLORE_AXES = ['asilRep', 'lifecycle', 'swStack', 'tshirt', 'vehicleType', 'region'] as const;
export type RefExploreAxis = (typeof REF_EXPLORE_AXES)[number];

/** 축 → URL·조회 질의 이름(쉼표 목록) */
export const REF_EXPLORE_PARAM: Record<RefExploreAxis, string> = { asilRep: 'asils', lifecycle: 'lifecycles', swStack: 'swStacks', tshirt: 'tshirts', vehicleType: 'vehicleTypes', region: 'regions' };

/** 값 순서가 정해진 축 — 나머지는 많은 순 */
export const REF_EXPLORE_ORDER: Partial<Record<RefExploreAxis, readonly string[]>> = {
  asilRep: ['QM', 'A', 'B', 'C', 'D'],
  lifecycle: ['Commodity', 'Differentiating', 'Innovation'],
  swStack: ['Application', 'Platform', 'Back-end'],
  tshirt: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
};

/** 탐색에 쓰는 행 필드 */
export type RefExploreRow = Pick<FeatureRefRow, 'domain' | 'component' | 'status'> & Partial<Pick<FeatureRefRow, 'sourceIds' | 'sizeEvidenceGrade' | RefExploreAxis>>;

export interface RefExploreQuery {
  domain?: string;
  component?: string;
  /** 상태 하나(탭) — statuses가 있으면 그쪽 */
  status?: string;
  /** 이 출처를 쓰는 행만 */
  source?: string;
  /** 쉼표 목록 질의 — statuses·asils·lifecycles … */
  [param: string]: string | number | undefined;
}

/** 분류 트리 키 — 도메인과 컴포넌트를 탭으로 잇는다 */
export const refTreeKey = (domain: string, component: string) => `${domain}\t${component}`;

/** 필터 결과 요약 — 표·트리·필터 수와 같은 행 집합에서 센다(수집하지 않은 값은 만들지 않는다) */
export interface RefExploreSummary {
  rows: number;
  domains: number;
  components: number;
  /** 근거로 쓴 출처 수(중복 없이) */
  sources: number;
  /** 대표 ASIL C·D 행 */
  asilCD: number;
  /** 규모 근거 D 등급 행 */
  gradeD: number;
  /** 검토 중 행 */
  review: number;
}

export function refExploreSummary(rows: readonly RefExploreRow[]): RefExploreSummary {
  const sources = new Set<string>();
  for (const r of rows) for (const s of r.sourceIds ?? []) sources.add(s);
  return {
    rows: rows.length,
    domains: new Set(rows.map((r) => r.domain)).size,
    components: new Set(rows.map((r) => `${r.domain}\t${r.component}`)).size,
    sources: sources.size,
    asilCD: rows.filter((r) => r.asilRep === 'C' || r.asilRep === 'D').length,
    gradeD: rows.filter((r) => r.sizeEvidenceGrade === 'D').length,
    review: rows.filter((r) => r.status === 'REVIEW').length,
  };
}

export type RefExploreFacets = { domain: Record<string, number>; component: Record<string, number>; status: Record<RefStatus, number>; source: Record<string, number>; tree: Record<string, number> } & Record<RefExploreAxis, Record<string, number>>;

/**
 * 검색어로 고른 행(순위 순) → 필터를 통과한 행 + 축별 수 + 요약.
 * 트리 수(tree)는 도메인·컴포넌트 선택만 빼고 센다 — 도메인을 골라도 다른 도메인·컴포넌트 수가 보인다.
 */
export function exploreRefs<T extends RefExploreRow>(rows: readonly T[], q: RefExploreQuery): { rows: T[]; facets: RefExploreFacets; summary: RefExploreSummary } {
  const statuses = facetList(String(q.statuses ?? ''));
  const multi = Object.fromEntries(REF_EXPLORE_AXES.map((a) => [a, facetList(String(q[REF_EXPLORE_PARAM[a]] ?? ''))]));
  const one = (v: unknown) => (typeof v === 'string' && v ? [v] : []);
  const axes = {
    domain: (r: T) => r.domain,
    component: (r: T) => r.component,
    status: (r: T) => r.status,
    source: (r: T) => r.sourceIds ?? [],
    ...Object.fromEntries(REF_EXPLORE_AXES.map((a) => [a, (r: T) => (r[a] as string | undefined) ?? ''])),
  } as unknown as Record<'domain' | 'component' | 'status' | 'source' | RefExploreAxis, (r: T) => string | readonly string[]>;
  const selected = { domain: one(q.domain), component: one(q.component), status: statuses.length ? statuses : one(q.status), source: one(q.source), ...multi };
  const main = facetFilter(rows, axes, selected);
  // 트리 — 도메인·컴포넌트 선택을 뺀 같은 조건
  const treeRows = selected.domain.length || selected.component.length ? facetFilter(rows, axes, { ...selected, domain: [], component: [] }).rows : main.rows;
  const tree = facetFilter(treeRows, { tree: (r: T) => refTreeKey(r.domain, r.component) }, {}).facets.tree;
  const status = Object.fromEntries(REF_STATUSES.map((s) => [s, main.facets.status[s] ?? 0])) as Record<RefStatus, number>;
  return {
    rows: main.rows,
    facets: { ...main.facets, status, tree },
    summary: refExploreSummary(main.rows),
  };
}
