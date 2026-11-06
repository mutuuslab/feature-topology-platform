// 시연 엔진 — 일반 목록 거르기 읽기(설계 20-60). 정적 스냅샷은 화면 기본 상태의 질의만 받아 두므로 화면에서 필터(출처·유형·판정·검색어…)를
// 고르면 그 질의 파일이 없어 '스냅샷에 없음' 오류 상자가 떴다(2026-11-06 하네스 리뷰). 질의 파일이 없으면 같은 경로의 기본 목록(필터 키를 뺀 질의)을
// 오버레이까지 덮어 읽고, 서버 컨트롤러와 같은 규칙으로 거른다. 경로마다 서버 규칙(필드 대응)을 여기 적고 경로별 시험(simListFilter.test.ts)으로 맞춘다.
// 순수 모듈(엔진·화면 상태를 읽지 않는다) — tools/snapshot-coverage.ts가 이 표의 경로·키를 '시연 엔진 계산'으로 센다.
import { gatesToRejudge, type FeatureVersionRow, type Lifecycle } from '@ff/contracts';

/** 질의 키 하나의 서버 규칙 */
export type ListMatch =
  /** 칸 값이 질의 값과 같다 */
  | { kind: 'eq'; field: string }
  /** 칸 여럿 중 하나라도 같다(예: 의존관계 featureId — 원천 또는 대상) */
  | { kind: 'anyOf'; fields: string[] }
  /** 질의가 쉼표로 여러 값 — 칸 값이 그중 하나 */
  | { kind: 'in'; field: string; sep?: string }
  /** 배열 칸에 질의 값이 들어 있다 */
  | { kind: 'has'; field: string }
  /** 칸 앞부분 */
  | { kind: 'prefix'; field: string }
  /** 검색어 — 칸들을 공백으로 이어 소문자로 바꾼 글에 질의(소문자)가 들어 있다 */
  | { kind: 'text'; fields: string[] };

export interface ListFilterSpec {
  kind: 'list';
  /** 응답의 배열 칸(기본 items) */
  listKey?: string;
  keys: Record<string, ListMatch>;
  /** 쪽 나누기 질의 키 — 서버가 거른 뒤 자른다 */
  page?: { limit?: string; offset?: string };
  /** 정렬 질의 키 — 값 → 비교 함수(없는 값은 순서 그대로) */
  sort?: { param: string; by: Record<string, (a: any, b: any) => number> };
}

/** 목록이 아닌 계산 응답 — 기본 응답(질의 키를 뺀 것)에서 질의에 따라 바뀌는 부분만 서버와 같은 순수 함수로 다시 계산 */
export interface DeriveSpec {
  kind: 'derive';
  keys: string[];
  derive: (base: any, query: Record<string, string>) => any;
}

export type QuerySpec = ListFilterSpec | DeriveSpec;

/**
 * 경로별 서버 규칙 — 백엔드 컨트롤러·서비스와 같은 뜻.
 *  · incidents: d04-ops/incident-voc IncidentService.list — status·featureId·source 같음(status는 이상 징후 연결 뒤 LINKED로 바뀐 값, 목록 응답에 이미 반영)
 *  · dependencies: d01-policy/topology TopologyService.list — featureId는 원천 또는 대상, type·verdict 같음
 *  · masterSw: d01-policy/topology MasterDataService.sw — ecuPno 같음, q는 `swId name supplier` 소문자 부분 일치
 *  · impact: TopologyService.impact — changed(쉼표)는 재판정 Gate(gatesToRejudge)와 요약 건수만 바꾼다
 *  · rollbacks: d03-safety/restore RollbackService.history — 배포·Feature·계획·요청·상태·결과 같음, 대상 유형·VIN은 배열 포함(기간 from·to는 화면에 없다)
 */
export const QUERY_SPECS: Record<string, QuerySpec> = {
  incidents: {
    kind: 'list',
    keys: { status: { kind: 'eq', field: 'status' }, featureId: { kind: 'eq', field: 'featureId' }, source: { kind: 'eq', field: 'source' } },
  },
  dependencies: {
    kind: 'list',
    keys: { featureId: { kind: 'anyOf', fields: ['sourceFeatureId', 'targetFeatureId'] }, type: { kind: 'eq', field: 'type' }, verdict: { kind: 'eq', field: 'verdict' } },
  },
  masterSw: {
    kind: 'list',
    keys: { ecuPno: { kind: 'eq', field: 'ecuPno' }, q: { kind: 'text', fields: ['swId', 'name', 'supplier'] } },
  },
  rollbacks: {
    kind: 'list',
    keys: {
      deploymentId: { kind: 'eq', field: 'deploymentId' },
      featureId: { kind: 'eq', field: 'featureId' },
      planId: { kind: 'eq', field: 'planId' },
      requestId: { kind: 'eq', field: 'requestId' },
      targetType: { kind: 'has', field: 'targetTypes' },
      vin: { kind: 'has', field: 'vins' },
      status: { kind: 'eq', field: 'status' },
      result: { kind: 'eq', field: 'result' },
    },
  },
  impact: {
    kind: 'derive',
    keys: ['changed'],
    derive: (base, q) => {
      const rejudge = gatesToRejudge((q.changed ? q.changed.split(',') : []) as (keyof FeatureVersionRow)[], base.feature.lifecycle as Lifecycle);
      return { ...base, rejudge, summary: { ...base.summary, rejudgeGates: rejudge.length } };
    },
  },
};

/** 이 질의에서 필터 키를 뺀 질의(키 순서 그대로) — 그 바탕 응답을 읽는다. 걸러야 할 키가 없으면 null */
export function baseQuery(spec: QuerySpec, query: Record<string, string>): Record<string, string> | null {
  const own = spec.kind === 'list' ? [...Object.keys(spec.keys), ...Object.values(spec.page ?? {}), ...(spec.sort ? [spec.sort.param] : [])] : spec.keys;
  if (!Object.keys(query).some((k) => own.includes(k) && query[k] !== '')) return null;
  return Object.fromEntries(Object.entries(query).filter(([k]) => !own.includes(k)));
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function matches(m: ListMatch, item: any, value: string): boolean {
  switch (m.kind) {
    case 'eq':
      return text(item?.[m.field]) === value;
    case 'anyOf':
      return m.fields.some((f) => text(item?.[f]) === value);
    case 'in':
      return value.split(m.sep ?? ',').includes(text(item?.[m.field]));
    case 'has':
      return Array.isArray(item?.[m.field]) && item[m.field].map(text).includes(value);
    case 'prefix':
      return text(item?.[m.field]).startsWith(value);
    case 'text':
      return m.fields.map((f) => text(item?.[f])).join(' ').toLowerCase().includes(value.toLowerCase());
  }
}

/** 바탕 응답 + 질의 → 서버와 같은 결과 */
export function applyQuerySpec(spec: QuerySpec, base: any, query: Record<string, string>): any {
  if (spec.kind === 'derive') return spec.derive(base, query);
  const key = spec.listKey ?? 'items';
  let items: any[] = Array.isArray(base?.[key]) ? base[key] : [];
  for (const [k, m] of Object.entries(spec.keys)) {
    const v = query[k];
    if (v === undefined || v === '') continue;
    items = items.filter((it) => matches(m, it, v));
  }
  const cmp = spec.sort && spec.sort.by[query[spec.sort.param] ?? ''];
  if (cmp) items = [...items].sort(cmp);
  const total = items.length;
  const offset = spec.page?.offset ? Math.max(0, Number(query[spec.page.offset]) || 0) : 0;
  const limit = spec.page?.limit && query[spec.page.limit] ? Math.max(0, Number(query[spec.page.limit]) || 0) : undefined;
  if (offset || limit !== undefined) items = items.slice(offset, limit === undefined ? undefined : offset + limit);
  const out = { ...base, [key]: items };
  for (const k of ['total', 'count']) if (typeof base?.[k] === 'number') out[k] = total;
  return out;
}
