// 개발비 산정 목록 탐색판 — 국가·차종·ASIL·T-shirt·상태 다중 선택과 분류 트리가 표·요약 수치와 같은 과제 집합을 쓴다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { exploreCostProjects, SwCostScreen } from '../screens/cost/CostList';
import type { CostListItem } from '../screens/cost/common';
import { workbook as WB } from '../copy/workbook';
import { costExplorer as E } from '../copy/cost-explorer';

const scope = (countries: string[], models: string[], asils: string[], tshirts: string[], comps: [string, string][]) => ({ countries, vehicleModels: models, asils, tshirts, domains: [...new Set(comps.map(([d]) => d))], components: comps.map(([d, c]) => `${d}\t${c}`) });
const P = (estId: string, status: CostListItem['status'], mm: number, cost: number, s: CostListItem['scope'], featureCount = 1): CostListItem => ({ estId, name: `과제 ${estId}`, target: 't', status, currency: 'KRW', basisVersion: 'v1.3', basisStale: false, featureCount, totals: { totalMm: mm, totalCost: cost }, scope: s, createdBy: 'usr-viewer', updatedAt: '2026-11-05T10:00:00Z' });
const ITEMS = [
  P('EST-0001', 'APPROVED', 10, 100e6, scope(['KR'], ['NX4'], ['QM', 'B'], ['S'], [['Body', 'BCM']]), 2),
  P('EST-0002', 'APPROVED', 20, 300e6, scope(['US'], ['MX5'], ['D'], ['M'], [['Chassis', 'Brake']]), 1),
  P('EST-0003', 'DRAFT', 5, 50e6, scope(['KR', 'US'], ['NX4'], ['D'], ['S', 'L'], [['Chassis', 'Brake'], ['Body', 'Seat']]), 3),
  P('EST-0004', 'SUBMITTED', 7, 70e6, scope(['DE'], ['GN7'], ['A'], ['XS'], [['Body', 'Seat']]), 1),
];

describe('exploreCostProjects', () => {
  it('국가 KR·US + ASIL D — 같은 축은 합집합, 축끼리는 교집합, 자기 축 수는 그대로', () => {
    const r = exploreCostProjects(ITEMS, { countries: ['KR', 'US'], asils: ['D'] });
    expect(r.rows.map((p) => p.estId)).toEqual(['EST-0002', 'EST-0003']);
    expect(r.facets.asils).toEqual({ QM: 1, B: 1, D: 2 });
    expect(r.facets.countries).toEqual({ US: 2, KR: 1 });
    expect(r.tree.domain).toEqual({ Chassis: 2, Body: 1 });
  });
});

let urls: string[] = [];
beforeEach(() => {
  localStorage.clear();
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const body = url.startsWith('/api/cost/projects') ? { items: ITEMS, view: 'FULL' } : { items: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer' }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/procurement/sw-cost']}>
        <AppProvider>
          <Routes>
            <Route path="/procurement/sw-cost" element={<SwCostScreen />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const metric = (key: string) => document.querySelector(key === 'approvedCost' ? '[data-key-message] .ds-key__value' : `[data-metric="${key}"] dd`)?.firstChild?.textContent;
const ids = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent?.match(/EST-\d{4}/)?.[0]).sort();
const chip = (axis: string, value: string) => within(screen.getByRole('complementary', { name: WB.filters })).getByRole('button', { name: new RegExp(`^${axis} ${value}( |$)`) });

describe('개발비 산정 목록 탐색판', () => {
  it('필터를 누르면 표·요약(과제 수·승인 개발비·공수·담은 Feature)이 같은 과제로 바뀌고, 트리로 더 좁힌다', async () => {
    mount();
    await waitFor(() => expect(ids()).toHaveLength(4));
    expect(metric('projects')).toBe('4');
    expect(metric('approvedCost')).toBe('400.0');
    expect(document.querySelector('[data-metric="approvedCost"]')).toBeNull(); // 금액 히어로 중복 금지
    fireEvent.click(chip(E.axis.asils, 'D'));
    await waitFor(() => expect(ids()).toEqual(['EST-0002', 'EST-0003']));
    expect(metric('projects')).toBe('2');
    expect(metric('approved')).toBe('1');
    expect(metric('approvedCost')).toBe('300.0');
    expect(metric('allMm')).toBe('25.00');
    expect(metric('features')).toBe('4');
    expect(chip(E.axis.countries, 'KR').getAttribute('aria-label')).toBe(WB.chip(E.axis.countries, 'KR', 1));
    const tree = screen.getByRole('navigation', { name: E.tree });
    fireEvent.click(within(tree).getByRole('button', { name: WB.treeItem('Body', 1) }));
    await waitFor(() => expect(ids()).toEqual(['EST-0003']));
    fireEvent.click(within(tree).getByRole('button', { name: WB.treeItem('Seat', 1) }));
    await waitFor(() => expect(ids()).toEqual(['EST-0003']));
    expect(metric('projects')).toBe('1');
    // 목록은 한 번만 받는다 — 거르기는 화면에서
    expect(urls.filter((u) => u.startsWith('/api/cost/projects'))).toHaveLength(1);
  });
});
