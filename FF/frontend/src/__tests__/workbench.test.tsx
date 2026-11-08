import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider, useAppApi } from '../store';
import { actorFor } from '../api/actor';
import Workbench, { queryStorageKey } from '../screens/data/Workbench';
import { conditionSummary, filterRows, normalizePage, validView, type Filter } from '../screens/data/workbench-data';
import { MENU, routeOf } from '../routes';

const flags = [
  { flagKey: 'park_enable', featureId: 'FEAT-00001', version: '1.0.0', featureName: '주차 제어', policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 2, controlPoint: 'Flag' }, sources: [], publication: { status: 'PARTIAL', confirmed: 2, denominator: 5 } },
  { flagKey: 'park_param', featureId: 'FEAT-00001', version: '1.0.0', featureName: '주차 파라미터', policy: { policyId: 'POL-00002', status: 'APPROVED', revision: 1, controlPoint: 'Parameter' }, sources: [], publication: null },
  { flagKey: 'park_spare', featureId: 'FEAT-00002', version: '1.0.0', featureName: '보조 제어', policy: { policyId: 'POL-00003', status: 'DRAFT', revision: 1, controlPoint: 'Flag' }, sources: [], publication: null },
];
const cost = { view: 'FULL', items: [{ estId: 'EST-00001', name: '주차 개발 산정', status: 'APPROVED', currency: 'KRW', featureCount: 2, basisVersion: 'CB-00001', totals: { totalMm: 12.5, totalCost: 8743211 }, updatedAt: '2026-11-05T01:00:00.000Z' }] };
let calls: { url: string; method: string; body?: BodyInit | null }[];
let costStatus: number;
let flagsBody: unknown;
beforeEach(() => {
  localStorage.clear(); calls = []; costStatus = 200; flagsBody = flags;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    if (url.startsWith('/api/cost/projects') && costStatus !== 200) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '산정 조회 권한 없음' } }), { status: costStatus });
    const parsed = new URL(url, 'http://localhost');
    const offset = Number(parsed.searchParams.get('offset') ?? 0);
    const body = url.startsWith('/api/feature-flags') ? flagsBody : url.startsWith('/api/cost/projects') ? cost : url.startsWith('/api/refdb/refs') ? { items: [offset + 1, offset + 2].map((n) => ({ refId: 'AD-TEST-00' + n, nameKo: '실제 기준 행 ' + n, domain: 'ADAS', component: 'Parking', asilRep: 'B', status: 'ACTIVE', benchmarkEur: 987654321, sourceIds: ['S1'] })), total: 4, offset, limit: 2, release: 'v1.3' } : { items: [{ vin: 'VIN-01', label: '실제 회신 차량', link: 'ONLINE', quality: 'TRUSTED', flags: [{ flagKey: 'park_enable' }], last: { publicationId: 'PUB-00001', kind: 'POLICY', result: 'APPLIED', at: '2026-11-05T01:00:00.000Z' } }, { vin: 'VIN-02', label: '미확인 차량', link: 'OFFLINE', quality: 'STALE', flags: [], last: null }] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function SwitchRole() { const { dispatch } = useAppApi(); return <button onClick={() => dispatch({ t: 'ROLE', role: 'author' })}>switch actor</button>; }
function mount(role = 'viewer') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><MemoryRouter><AppProvider><SwitchRole /><Workbench /></AppProvider></MemoryRouter></QueryClientProvider>);
}
const table = () => screen.getByRole('table', { name: '분석 결과' });
const filter = (field: string, op: Filter['op'], value = '', values: string[] = []): Filter => ({ id: field, field, op, value, values });

describe('분석실의 실제 데이터 투영·조건', () => {
  it('MM_ONLY와 비금액 역할은 응답에 잘못 포함된 금액도 표·상세에 전달하지 않는다', () => {
    for (const result of [normalizePage('cost', { ...cost, view: 'MM_ONLY' }), normalizePage('cost', cost, false)]) {
      expect(result.masked).toBe(true); expect(result.rows[0].values.totalMm).toBe(12.5);
      expect(result.columns.some((column) => column.key === 'totalCost')).toBe(false);
      expect(JSON.stringify(result)).not.toContain('8743211');
    }
    expect(normalizePage('cost', cost, true).rows[0].values.totalCost).toBe(8743211);
    // 프로젝트 표시 통화는 환산된 금액이 아니다. 목록 원장의 계산 원화는 그대로 둔다.
    const foreign = normalizePage('cost', { ...cost, items: [{ ...cost.items[0], currency: 'USD' }] }, true);
    expect(foreign.rows[0].values).toMatchObject({ currency: 'USD', totalCost: 8743211 });
  });
  it('같은 필드의 여러 선택은 OR, 필드 간 조건은 AND이며 SQL 모양 문자열을 실행하지 않는다', () => {
    const rows = normalizePage('flags', flags).rows;
    expect(filterRows(rows, [filter('status', 'in', '', ['DEPLOYED', 'APPROVED']), filter('controlPoint', 'eq', 'Flag')], '').map((row) => row.id)).toEqual(['park_enable@FEAT-00001@1.0.0']);
    expect(filterRows(rows, [filter('revision', 'gte', '')], '')).toEqual([]);
    expect(filterRows(rows, [filter('revision', 'gte', 'Infinity')], '')).toEqual([]);
    expect(filterRows(rows, [filter('__proto__', 'contains', '')], '')).toEqual([]);
    expect(filterRows(rows, [filter('flagKey', 'contains', "'; DROP TABLE x; --")], '')).toEqual([]);
  });
  it('회신 없음은 APPLIED로 만들지 않고 기준 행 금액은 필드 투영에 포함하지 않는다', () => {
    const replies = normalizePage('replies', { items: [{ vin: 'VIN-0', last: null, flags: [] }] });
    expect(replies.rows[0].values.result).toBeNull(); expect(replies.rows[0].links).toHaveLength(1);
    const refs = normalizePage('refs', { items: [{ refId: 'REF-1', benchmarkEur: 987654321 }], total: 10, offset: 0 });
    expect(refs.nextOffset).toBe(1); expect(JSON.stringify(refs)).not.toContain('987654321');
  });
  it('손상된 저장 조건·출처·비교 연산자는 거부하고 요약은 일반 조건을 그대로 표현한다', () => {
    expect(validView({ source: 'flags', search: '', columns: ['flagKey'], filters: [filter('status', 'eq', 'DEPLOYED')] })).toBe(true);
    expect(validView({ source: 'sql', search: '', columns: [], filters: [] })).toBe(false);
    expect(validView({ source: 'flags', search: '', columns: [], filters: [{ ...filter('status', 'eq'), op: '__proto__' }] })).toBe(false);
    expect(conditionSummary({ source: 'flags', search: '', filters: [filter('status', 'eq', 'DEPLOYED')] })).toContain('상태 같음 [DEPLOYED]');
  });
});

describe('데이터 분석실 화면', () => {
  it('원장 응답을 기다리는 동안 공통 로딩 골격을 먼저 보인다', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    mount();
    expect(document.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(screen.queryByRole('table', { name: '분석 결과' })).toBeNull();
  });

  it('운영 메뉴에서 실제 분석실 경로로 열린다', () => {
    expect(MENU.find((group) => group.key === 'ops')?.items.some((route) => route.menu === '/data/workbench')).toBe(true);
    expect(routeOf('/data/workbench')).toMatchObject({ title: '데이터 분석실', group: 'ops', v2: true });
  });
  it('복수 선택·다중 조건을 적용하고 실제 GET만 호출한다', async () => {
    mount(); await screen.findByRole('table', { name: '분석 결과' });
    fireEvent.click(screen.getByRole('button', { name: '조건 추가' }));
    fireEvent.change(screen.getByLabelText('필드 1'), { target: { value: 'status' } });
    fireEvent.change(screen.getByLabelText('비교 1'), { target: { value: 'in' } });
    fireEvent.click(screen.getByLabelText('DEPLOYED')); fireEvent.click(screen.getByLabelText('APPROVED'));
    fireEvent.click(screen.getByRole('button', { name: '조건 추가' }));
    fireEvent.change(screen.getByLabelText('필드 2'), { target: { value: 'controlPoint' } });
    fireEvent.change(screen.getByLabelText('비교 2'), { target: { value: 'eq' } });
    fireEvent.change(screen.getByLabelText('값 2'), { target: { value: 'Flag' } });
    fireEvent.click(screen.getByRole('button', { name: '조건으로 조회' }));
    await waitFor(() => expect(within(table()).getAllByRole('row')).toHaveLength(2));
    expect(within(table()).getByText('park_enable')).toBeTruthy(); expect(within(table()).queryByText('park_param')).toBeNull();
    expect(calls.every((entry) => entry.method === 'GET' && !entry.body)).toBe(true);
  });
  it('선택 행 상세와 실제 정책·차량 지도 링크를 제공하고 필드 표시를 바꾼다', async () => {
    mount(); await screen.findByRole('table', { name: '분석 결과' });
    fireEvent.click(screen.getByRole('button', { name: '1 행 선택' }));
    const detail = screen.getByRole('region', { name: '선택 행 상세' });
    expect(within(detail).getByRole('link', { name: '정책 열기' }).getAttribute('href')).toBe('/policies/POL-00001');
    expect(within(detail).getByRole('link', { name: 'Flag 적용 차량 지도' }).getAttribute('href')).toBe('/fleet/map?lens=activation&flagKey=park_enable');
    const fields = screen.getByRole('complementary', { name: '표시 필드' });
    fireEvent.click(within(fields).getByRole('checkbox', { name: /개정/ }));
    expect(within(table()).queryByRole('button', { name: '개정 정렬' })).toBeNull();
  });
  it('기준 행의 부분 조회를 명시하고 이어 읽어 실제 전체 범위를 늘린다', async () => {
    mount(); await screen.findByRole('table', { name: '분석 결과' });
    fireEvent.click(screen.getByRole('button', { name: 'Feature DB 기준 행' }));
    await screen.findByText('부분 조회 · 2/4개 행을 불러왔습니다. 조건은 이 범위에서 계산합니다.');
    fireEvent.click(screen.getByRole('button', { name: '다음 200개 불러오기' }));
    await screen.findByText('조회 응답 4개 행');
    expect(within(table()).getAllByRole('row')).toHaveLength(5);
    expect(document.body.textContent).not.toContain('987654321');
  });
  it('금액 권한 없는 계정은 FULL 응답이어도 공수만 표시하며 403은 명확히 알린다', async () => {
    mount('author'); await screen.findByRole('table', { name: '분석 결과' });
    fireEvent.click(screen.getByRole('button', { name: '개발비 산정 과제' }));
    await screen.findByText('이 조회는 공수 범위로 표시합니다. 금액 열은 표시되지 않습니다.');
    expect(document.body.textContent).not.toContain('8,743,211');
    expect(within(table()).getByText('12.5')).toBeTruthy();
    costStatus = 403; fireEvent.click(screen.getByRole('button', { name: '원장 새로 읽기' }));
    await screen.findByText('개발비 산정 조회 권한이 없습니다. 현재 계정에 허용되지 않은 금액이나 과제 값은 표시하지 않습니다.');
    expect(screen.queryByRole('table', { name: '분석 결과' })).toBeNull();
    expect(screen.queryByText('주차 개발 산정')).toBeNull();
  });
  it('실제 산정 열람 역할의 FULL 응답은 원 단위 금액을 그대로 표시한다', async () => {
    mount('viewer'); await screen.findByRole('table', { name: '분석 결과' });
    fireEvent.click(screen.getByRole('button', { name: '개발비 산정 과제' }));
    expect(await within(await screen.findByRole('table', { name: '분석 결과' })).findByText('8,743,211')).toBeTruthy();
    expect(within(table()).getByRole('button', { name: '총 개발비 (원) 정렬' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'switch actor' }));
    await screen.findByText('이 조회는 공수 범위로 표시합니다. 금액 열은 표시되지 않습니다.');
    expect(document.body.textContent).not.toContain('8,743,211');
  });
  it('금액은 기존 산정 화면처럼 정수 단위로 표시하고 원장 소수 값은 수정하지 않는다', async () => {
    const original = cost.items[0].totals.totalCost;
    cost.items[0].totals.totalCost = 8743211.497752;
    try {
      mount('viewer'); await screen.findByRole('table', { name: '분석 결과' });
      fireEvent.click(screen.getByRole('button', { name: '개발비 산정 과제' }));
      expect(await within(await screen.findByRole('table', { name: '분석 결과' })).findByText('8,743,211')).toBeTruthy();
      expect(cost.items[0].totals.totalCost).toBe(8743211.497752);
      expect(document.body.textContent).not.toContain('497752');
    } finally { cost.items[0].totals.totalCost = original; }
  });
  it('저장 조회·이력은 계정별 로컬 조건만 저장하고 다른 계정에 보여 주지 않는다', async () => {
    mount('viewer'); await screen.findByRole('table', { name: '분석 결과' });
    fireEvent.change(screen.getByLabelText('저장 조회 이름'), { target: { value: '내 검토 조건' } });
    fireEvent.click(screen.getByRole('button', { name: '조건 저장' }));
    fireEvent.click(screen.getByRole('button', { name: '조건으로 조회' }));
    await waitFor(() => expect(screen.getByRole('region', { name: '조회 이력' })).toHaveTextContent('조회 완료'));
    const saved = JSON.parse(localStorage.getItem(queryStorageKey(actorFor('viewer').id, 'viewer'))!);
    expect(saved.saved[0]).toMatchObject({ name: '내 검토 조건', source: 'flags' });
    expect(saved.history[0]).toMatchObject({ source: 'flags', count: 3 });
    expect(JSON.stringify(saved)).not.toContain('park_enable');
    expect(Object.keys(saved)).toEqual(['saved', 'history']);
    fireEvent.click(screen.getByRole('button', { name: 'switch actor' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '내 검토 조건' })).toBeNull());
  });
  it('깨진 API 응답은 빈 표 성공으로 위장하지 않는다', async () => {
    flagsBody = { items: [] }; mount();
    await screen.findByRole('alert');
    expect(screen.queryByRole('table', { name: '분석 결과' })).toBeNull();
  });
});
