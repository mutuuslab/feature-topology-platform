// Feature DB 목록 탐색판 — 오른쪽 다중 선택 필터를 누르면 표 행·요약 수치·트리 수·다른 필터 수가 같은 조건으로 함께 바뀐다.
// 모의 서버는 서버와 같은 함수(contracts exploreRefs — searchLocally 경유)로 응답한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { FeatureDbScreen } from '../screens/refdb/RefList';
import { searchLocally } from '../screens/refdb/refSearch';
import { workbook as WB } from '../copy/workbook';
import { refExplorer as E } from '../copy/ref-explorer';

const base = { status: 'ACTIVE' as const, aliases: [], swStack: 'Application', vehicleType: '공통', region: '글로벌', sizeEvidenceGrade: 'C' as const, tshirt: 'S', lifecycle: 'Commodity' };
const ROWS = [
  { ...base, refId: 'CH-BRK-001', nameKo: '제동 1', nameEn: 'Brake 1', domain: 'Chassis', component: 'Brake', asilRep: 'D', sourceIds: ['S01'], sizeEvidenceGrade: 'D' as const },
  { ...base, refId: 'CH-BRK-002', nameKo: '제동 2', nameEn: 'Brake 2', domain: 'Chassis', component: 'Brake', asilRep: 'C', sourceIds: ['S02'], lifecycle: 'Innovation' },
  { ...base, refId: 'CH-STR-001', nameKo: '조향 1', nameEn: 'Steer 1', domain: 'Chassis', component: 'Steering', asilRep: 'D', sourceIds: ['S01', 'S02'], status: 'REVIEW' as const },
  { ...base, refId: 'BC-SEAT-001', nameKo: '시트 1', nameEn: 'Seat 1', domain: 'Body', component: 'Seat', asilRep: 'QM', sourceIds: ['S03'] },
  { ...base, refId: 'BC-SEAT-002', nameKo: '시트 2', nameEn: 'Seat 2', domain: 'Body', component: 'Seat', asilRep: 'QM', sourceIds: ['S03'], tshirt: 'M' },
  { ...base, refId: 'BC-LMP-001', nameKo: '램프 1', nameEn: 'Lamp 1', domain: 'Body', component: 'Lamp', asilRep: 'B', sourceIds: ['S01'], swStack: 'Platform' },
];
const TAXONOMY = [
  { nodeId: 'CH', level: 'DOMAIN', parentId: null, nameEn: 'Chassis', nameKo: '섀시', abbr: 'CH', status: 'ACTIVE' },
  { nodeId: 'BC', level: 'DOMAIN', parentId: null, nameEn: 'Body', nameKo: '바디', abbr: 'BC', status: 'ACTIVE' },
  { nodeId: 'CH/Brake', level: 'COMPONENT', parentId: 'CH', nameEn: 'Brake', nameKo: '제동', abbr: 'BRK', status: 'ACTIVE' },
  { nodeId: 'CH/Steering', level: 'COMPONENT', parentId: 'CH', nameEn: 'Steering', nameKo: '조향', abbr: 'STR', status: 'ACTIVE' },
  { nodeId: 'BC/Seat', level: 'COMPONENT', parentId: 'BC', nameEn: 'Seat', nameKo: '시트', abbr: 'SEAT', status: 'ACTIVE' },
  { nodeId: 'BC/Lamp', level: 'COMPONENT', parentId: 'BC', nameEn: 'Lamp', nameKo: '램프', abbr: 'LMP', status: 'ACTIVE' },
];

let urls: string[] = [];
beforeEach(() => {
  localStorage.clear();
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const u = new URL(url, 'http://x');
    let body: unknown = { items: [] };
    if (u.pathname === '/api/refdb/refs') {
      const q = Object.fromEntries(u.searchParams) as Record<string, string | number>;
      body = searchLocally(ROWS, { ...q, offset: Number(q.offset ?? 0), limit: Number(q.limit ?? 50) });
    } else if (u.pathname === '/api/refdb/taxonomy') body = { items: TAXONOMY };
    else if (u.pathname === '/api/refdb/quality') body = { total: 6, published: 6, byStatus: { ACTIVE: 5, REVIEW: 1 }, noSource: 0, evidenceStale: 0, sizeGradeDShare: 1 / 6, awaitingPublish: 0, latestRelease: 'v1.0' };
    else if (u.pathname === '/api/refdb/sources') body = { items: [{ sourceId: 'S01', title: '표준 문서', publisher: 'ISO' }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path = '/master/feature-db') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer' }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/master/feature-db" element={<FeatureDbScreen />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const metric = (key: string) => document.querySelector(`[data-metric="${key}"] dd`)?.firstChild?.textContent;
const tableIds = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '').map((t) => t.match(/[A-Z]{2}-[A-Z]+-\d{3}/)?.[0]);
const filters = () => screen.getByRole('complementary', { name: WB.filters });
const chip = (axis: string, value: string) => within(filters()).getByRole('button', { name: new RegExp(`^${axis} ${value}( |$)`) });

describe('Feature DB 탐색판 — 필터 연동', () => {
  it('ASIL D를 고르면 표·요약 수치·트리 수·다른 필터 수가 같은 조건으로 바뀌고, 자기 축의 다른 값 수는 그대로다', async () => {
    mount();
    await waitFor(() => expect(tableIds()).toHaveLength(6));
    expect(metric('rows')).toBe('6');
    expect(chip(E.axis.asilRep, 'D').getAttribute('aria-label')).toBe(WB.chip(E.axis.asilRep, 'D', 2));

    fireEvent.click(chip(E.axis.asilRep, 'D'));
    await waitFor(() => expect(urls.some((u) => u.includes('asils=D'))).toBe(true));
    await waitFor(() => expect(tableIds().sort()).toEqual(['CH-BRK-001', 'CH-STR-001']));
    // 요약 = 표 행
    expect(metric('rows')).toBe('2');
    expect(metric('asilCD')).toBe('2');
    expect(metric('sources')).toBe('2');
    expect(metric('review')).toBe('1');
    expect(metric('scope')).toBe('1 · 2');
    expect(chip(E.axis.asilRep, 'D').getAttribute('aria-pressed')).toBe('true');
    // 자기 축(ASIL)의 다른 값 수는 그대로, 다른 축은 걸러진 행으로
    expect(chip(E.axis.asilRep, 'QM').getAttribute('aria-label')).toBe(WB.chip(E.axis.asilRep, 'QM', 2));
    expect(chip(E.axis.tshirt, 'M').getAttribute('aria-label')).toBe(WB.chip(E.axis.tshirt, 'M', 0));
    // 트리 수도 같은 조건(섀시 2, 바디 0)
    const tree = screen.getByRole('navigation', { name: WB.tree });
    expect(within(tree).getByRole('button', { name: WB.treeItem('섀시', 2) })).toBeTruthy();
    expect(within(tree).getByRole('button', { name: WB.treeItem('바디', 0) })).toBeTruthy();

    // 다른 축을 더하면 교집합 — 같은 축은 합집합
    fireEvent.click(chip(E.axis.asilRep, 'C'));
    await waitFor(() => expect(tableIds()).toHaveLength(3));
    fireEvent.click(chip(E.axis.lifecycle, E.value.lifecycle!.Innovation));
    await waitFor(() => expect(tableIds()).toEqual(['CH-BRK-002']));
    expect(metric('rows')).toBe('1');

    // 적용한 조건 — 모두 지우면 처음으로
    const applied = screen.getByRole('group', { name: WB.applied });
    fireEvent.click(within(applied).getByRole('button', { name: WB.clearAll }));
    await waitFor(() => expect(tableIds()).toHaveLength(6));
    expect(metric('rows')).toBe('6');
  });

  it('주소의 다중 선택으로 열면 같은 조건으로 시작하고, 트리에서 도메인을 고르면 그 안에서 거른다', async () => {
    mount('/master/feature-db?asils=QM,B');
    await waitFor(() => expect(tableIds().sort()).toEqual(['BC-LMP-001', 'BC-SEAT-001', 'BC-SEAT-002']));
    const tree = screen.getByRole('navigation', { name: WB.tree });
    fireEvent.click(within(tree).getByRole('button', { name: WB.treeItem('바디', 3) }));
    await waitFor(() => expect(within(tree).getByRole('button', { name: WB.treeItem('시트', 2) })).toBeTruthy());
    fireEvent.click(within(tree).getByRole('button', { name: WB.treeItem('램프', 1) }));
    await waitFor(() => expect(tableIds()).toEqual(['BC-LMP-001']));
    expect(metric('rows')).toBe('1');
    expect(urls.some((u) => u.includes('component=Lamp') && u.includes('asils=QM%2CB'))).toBe(true);
  });
});
