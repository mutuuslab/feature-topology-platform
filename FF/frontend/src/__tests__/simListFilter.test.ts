// 정적 공개 사이트 — 필터를 고른 질의의 스냅샷이 없으면 시연 엔진이 기본 목록을 서버 규칙으로 거른다(api/sim/list-filter.ts).
// 회귀(2026-11-06 하네스 리뷰): /ops/incidents 출처·/arch/topology 유형·판정·영향 분석 변경 속성·SW 마스터 검색어를 고르면 오류 상자가 떴다.
// 서버와 같은 결과인지는 backend/test/d01/sim-list-filter.spec.ts가 실제 컨트롤러와 대조한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeUrl, snapshotFile } from '@ff/contracts';
import { applyQuerySpec, baseQuery, QUERY_SPECS, type ListFilterSpec } from '../api/sim/list-filter';

const INC = [
  { incidentId: 'INC-00003', source: 'VOC', status: 'OPEN', featureId: 'FEAT-00001' },
  { incidentId: 'INC-00002', source: 'FIELD', status: 'LINKED', featureId: 'FEAT-00002' },
  { incidentId: 'INC-00001', source: 'VOC', status: 'LINKED', featureId: null },
];
const IMPACT = { feature: { featureId: 'FEAT-00001', version: '2.1.0', lifecycle: 'RELEASED' }, dependents: [], rejudge: [], summary: { dependents: 0, products: 1, releasedProducts: 1, rejudgeGates: 0 } };
const SNAP: Record<string, unknown> = {
  [routeUrl('incidents')]: { items: INC },
  [routeUrl('impact', { id: 'FEAT-00001', ver: '2.1.0' })]: IMPACT,
  // 정확한 질의 스냅샷이 있으면 그것이 먼저(거르기는 없을 때만)
  [routeUrl('incidents', {}, { source: 'FIELD' })]: { items: [INC[1]], fromSnapshot: true },
};
const byFile = new Map(Object.entries(SNAP).map(([u, v]) => ['/' + snapshotFile(u), v]));
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });

let call: typeof import('../api/client').call;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (byFile.has(u) ? json(byFile.get(u)) : html())));
  localStorage.clear();
  ({ call } = await import('../api/client'));
});
afterEach(async () => {
  (await import('../api/sim/engine')).__resetSimForTest();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('정적 데모 — 필터 질의', () => {
  it('출처를 고르면(스냅샷 없음) 기본 목록을 같은 규칙으로 거른다 — 오류가 아니다', async () => {
    const r = await call('incidents', { query: { source: 'VOC' } });
    expect(r.items.map((i: { incidentId: string }) => i.incidentId)).toEqual(['INC-00003', 'INC-00001']);
    expect((await call('incidents', { query: { status: 'LINKED', source: 'VOC' } })).items.map((i: { incidentId: string }) => i.incidentId)).toEqual(['INC-00001']);
    expect((await call('incidents', { query: { source: 'NONE' } })).items).toEqual([]);
  });
  it('정확한 질의 스냅샷이 있으면 그것을 읽는다', async () => {
    expect(await call('incidents', { query: { source: 'FIELD' } })).toMatchObject({ fromSnapshot: true });
  });
  it('영향 분석 변경 속성 — 재판정 Gate와 요약 건수를 서버 규칙(gatesToRejudge)으로 다시 계산', async () => {
    const r = await call('impact', { params: { id: 'FEAT-00001', ver: '2.1.0' }, query: { changed: 'controlPoints' } });
    expect(r.rejudge.length).toBeGreaterThan(0);
    expect(r.summary).toMatchObject({ products: 1, rejudgeGates: r.rejudge.length });
  });
  it('기본 목록 스냅샷도 없으면 예전처럼 스냅샷 없음 404', async () => {
    await expect(call('dependencies', { query: { type: 'REQUIRES' } })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('거르기 규칙(순수 함수)', () => {
  it('필터 키가 없거나 빈 값이면 거를 것이 없다(null), 있으면 나머지 키만 순서대로', () => {
    expect(baseQuery(QUERY_SPECS.incidents, {})).toBeNull();
    expect(baseQuery(QUERY_SPECS.incidents, { source: '' })).toBeNull();
    expect(baseQuery(QUERY_SPECS.masterSw, { limit: '5', q: 'bcm' })).toEqual({ limit: '5' });
  });
  it('같음·원천 또는 대상·검색어(소문자 부분 일치)', () => {
    const deps = { items: [{ type: 'REQUIRES', verdict: 'PASS', sourceFeatureId: 'A', targetFeatureId: 'B' }, { type: 'EXCLUDES', verdict: 'FAIL', sourceFeatureId: 'B', targetFeatureId: 'C' }] };
    expect(applyQuerySpec(QUERY_SPECS.dependencies, deps, { featureId: 'B' }).items).toHaveLength(2);
    expect(applyQuerySpec(QUERY_SPECS.dependencies, deps, { type: 'EXCLUDES', verdict: 'PASS' }).items).toHaveLength(0);
    const sw = { items: [{ swId: 'SW-BCM-01', name: 'Body Ctl', supplier: 'MOBIS' }, { swId: 'SW-ADAS-02', name: 'Lane', supplier: 'Bosch' }] };
    expect(applyQuerySpec(QUERY_SPECS.masterSw, sw, { q: 'bcm' }).items.map((s: { swId: string }) => s.swId)).toEqual(['SW-BCM-01']);
    expect(applyQuerySpec(QUERY_SPECS.masterSw, sw, { q: 'BOSCH' }).items).toHaveLength(1);
  });
  it('다중 값·배열 포함·앞부분·정렬·쪽 나누기(건수는 거른 뒤 전체)', () => {
    const spec: ListFilterSpec = {
      kind: 'list',
      keys: { status: { kind: 'in', field: 'status' }, tag: { kind: 'has', field: 'tags' }, id: { kind: 'prefix', field: 'id' } },
      page: { limit: 'limit', offset: 'offset' },
      sort: { param: 'sort', by: { id: (a, b) => String(a.id).localeCompare(String(b.id)) } },
    };
    const base = { total: 4, items: [{ id: 'X-3', status: 'A', tags: ['t'] }, { id: 'X-1', status: 'B', tags: ['t'] }, { id: 'Y-2', status: 'A', tags: [] }, { id: 'X-2', status: 'C', tags: ['t'] }] };
    const r = applyQuerySpec(spec, base, { status: 'A,B', tag: 't', id: 'X', sort: 'id', offset: '1', limit: '1' });
    expect(r).toEqual({ total: 2, items: [{ id: 'X-3', status: 'A', tags: ['t'] }] });
  });
});
