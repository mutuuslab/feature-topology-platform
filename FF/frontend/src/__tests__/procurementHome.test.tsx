import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PortalHome from '../screens/workspaces/Portal';
import { AppProvider } from '../store';
import { departmentById } from '../data/departments';

const item = (id: string, status: string, extra: object = {}) => ({ estId: id, name: `산정 ${id}`, status, target: '대상', currency: 'KRW', basisVersion: 'v1', basisStale: false, featureCount: 1, totals: { totalMm: 2, totalCost: 1000 }, createdBy: 'usr-other', updatedAt: '2026-11-08T00:00:00Z', ...extra });
let cost: unknown;
let deliveries: unknown;
let costStatus: number;
let supplierStatus: number;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
const requests: { url: string; method: string }[] = [];
function mount(dept = 'DEP-PUR', role = 'viewer') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role, department: dept }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><PortalHome dept={departmentById(dept)!} /></AppProvider></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear(); requests.length = 0; costStatus = 200; supplierStatus = 200;
  cost = { items: [], view: 'FULL' }; deliveries = { items: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' });
    if (String(url).startsWith('/api/cost/projects')) return json(costStatus === 200 ? cost : { error: { code: 'INTERNAL', message: '비용 원천 실패' } }, costStatus);
    if (String(url).startsWith('/api/integrations/supplier/deliveries')) return json(supplierStatus === 200 ? deliveries : { error: { code: 'FORBIDDEN', message: '납품 조회 권한 없음' } }, supplierStatus);
    return json({ items: [], total: 0, open: 0, overdue: 0 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const section = async (key: string) => { await waitFor(() => expect(document.querySelector(`[data-procurement-section="${key}"]`)).not.toBeNull()); return document.querySelector(`[data-procurement-section="${key}"]`) as HTMLElement; };

describe('구매 홈의 실제 업무 원천', () => {
  it('실제 산정·검토·납품 링크를 연결하고 승인 합계를 목록 계약의 원화로만 표시한다', async () => {
    cost = { view: 'FULL', items: [item('EST-K', 'APPROVED'), item('EST-U', 'APPROVED', { currency: 'USD', totals: { totalMm: 3, totalCost: 2000 } }), item('EST-P', 'SUBMITTED'), item('EST-D', 'DRAFT')] };
    deliveries = { items: [{ supplier: '동해 SW', swId: 'SW-A', version: '1.0.0', artifactId: 'ART-A', checksum: 'abc', ecuPno: 'ECU-A', lifecycle: 'VALID' }] };
    mount();
    const summary = await section('cost');
    await waitFor(() => expect(summary.querySelector('[data-approved-cost-krw]')?.textContent).toContain('3,000'));
    expect(summary.querySelector('[data-approved-cost-krw]')?.textContent).toContain('원');
    expect(summary.querySelector('[data-approved-cost-krw]')?.textContent).not.toContain('USD');
    expect(within(summary).getByRole('link', { name: /EST-P/ }).getAttribute('href')).toBe('/procurement/sw-cost/EST-P');
    expect(within(summary).getByRole('link', { name: /EST-D/ }).getAttribute('href')).toBe('/procurement/sw-cost/EST-D');
    const supplier = await section('supplier');
    expect(await within(supplier).findByRole('link', { name: /동해 SW/ })).toHaveAttribute('href', '/supplier/portal?supplier=%EB%8F%99%ED%95%B4%20SW');
    expect(requests.some((r) => r.url.startsWith('/api/cost/projects'))).toBe(true);
    expect(requests.some((r) => r.url.startsWith('/api/integrations/supplier/deliveries'))).toBe(true);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('공수 전용 응답은 잔존 금액 필드가 있어도 금액을 표시하지 않는다', async () => {
    cost = { view: 'MM_ONLY', items: [item('EST-MM', 'APPROVED', { totals: { totalMm: 12.5, totalCost: 987654321 } })] };
    mount(); const summary = await section('cost');
    await waitFor(() => expect(summary.querySelector('[data-approved-mm]')?.textContent).toContain('12.50'));
    expect(summary.querySelector('[data-approved-cost-krw]')).toBeNull();
    expect(summary.textContent).not.toContain('987');
  });

  it('계산 누락·비정상 수치는 0원으로 합산하지 않고 누락 건을 표시한다', async () => {
    cost = { view: 'FULL', items: [item('EST-NONE', 'APPROVED', { totals: null }), item('EST-BAD', 'APPROVED', { totals: { totalMm: -1, totalCost: -100 } })] };
    mount(); const summary = await section('cost');
    await waitFor(() => expect(summary.querySelector('[data-cost-incomplete]')?.textContent).toContain('2'));
    expect(summary.querySelector('[data-approved-cost-krw]')?.textContent).toBe('—');
    expect(summary.querySelector('[data-approved-mm]')?.textContent).toBe('—');
  });

  it('부분 계산 결과는 알려진 합계와 제외 건을 함께 표시하고 성공한 빈 목록만 0으로 표시한다', async () => {
    cost = { view: 'FULL', items: [item('EST-KNOWN', 'APPROVED'), item('EST-MISSING', 'APPROVED', { totals: null })] };
    mount(); let summary = await section('cost');
    await waitFor(() => expect(summary.querySelector('[data-approved-cost-krw]')?.textContent).toBe('1,000원'));
    expect(summary.querySelector('[data-cost-incomplete]')?.textContent).toContain('1');
    cleanup(); cost = { view: 'FULL', items: [] }; mount(); summary = await section('cost');
    await waitFor(() => expect(summary.querySelector('[data-approved-cost-krw]')?.textContent).toBe('0원'));
    expect(summary.querySelector('[data-cost-incomplete]')).toBeNull();
  });

  it('성공 코드의 잘못된 응답도 빈 과제로 오인하지 않는다', async () => {
    cost = { view: 'FULL', items: [{ estId: 'EST-BROKEN', name: '오류', status: 'UNRECOGNIZED' }] };
    mount(); const summary = await section('cost');
    expect(await within(summary).findByRole('alert')).toBeTruthy();
    expect(summary.querySelector('[data-approved-cost-krw]')).toBeNull();
    expect(within(summary).getByRole('button', { name: /다시/ })).toBeTruthy();
  });

  it('작성자 자신의 제출은 승인할 일에서 빼고 다른 사람의 건만 검토 링크로 연결한다', async () => {
    cost = { view: 'FULL', items: [item('EST-SELF', 'SUBMITTED', { createdBy: 'usr-approver' }), item('EST-OTHER', 'SUBMITTED')] };
    mount('DEP-PUR', 'approver'); const summary = await section('cost');
    await waitFor(() => expect(summary.querySelector('[data-cost-reviewable]')).not.toBeNull());
    const queue = summary.querySelector('[data-cost-reviewable]') as HTMLElement;
    expect(within(queue).queryByRole('link', { name: /EST-SELF/ })).toBeNull();
    expect(within(queue).getByRole('link', { name: /EST-OTHER/ })).toHaveAttribute('href', '/procurement/sw-cost/EST-OTHER');
    expect(summary.querySelector('button[data-ui="costTransition"]')).toBeNull();
  });

  it('조회 실패/권한 거부를 0건으로 단정하지 않고 각 원천의 재시도를 분리한다', async () => {
    costStatus = 503; supplierStatus = 403; mount();
    const summary = await section('cost'); const supplier = await section('supplier');
    expect(await within(summary).findByRole('button', { name: /다시/ })).toBeTruthy();
    expect(summary.querySelector('[data-approved-cost-krw]')).toBeNull();
    expect(await within(supplier).findByText(/권한/)).toBeTruthy();
    costStatus = 200; cost = { items: [item('EST-RECOVERED', 'DRAFT')], view: 'FULL' };
    fireEvent.click(within(summary).getByRole('button', { name: /다시/ }));
    expect(await within(summary).findByRole('link', { name: /EST-RECOVERED/ })).toBeTruthy();
    expect(requests.filter((r) => r.url.startsWith('/api/integrations/supplier/deliveries'))).toHaveLength(1);
  });

  for (const dept of ['DEP-LEG', 'DEP-DPO']) it(`${dept}에는 구매 전용 데이터·카드를 주입하지 않는다`, async () => {
    mount(dept); await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(requests.some((r) => r.url.startsWith('/api/consultations'))).toBe(true));
    expect(document.querySelector('[data-procurement-section]')).toBeNull();
    expect(requests.some((r) => r.url.startsWith('/api/cost/') || r.url.includes('/supplier/'))).toBe(false);
  });
});
