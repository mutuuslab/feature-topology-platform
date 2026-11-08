// 홈 '차량 정책 수신 현황' 대시보드 — KPI 히어로·카드가 서버 요약 값과 같고, 고리(국가·차종)를 누르면 같은 조건의 차량 표로 좁히며,
// 미니 지도·흐름 띠는 지도·업무 화면으로 가고, Top 목록(살펴볼 차량·회신 대기 정책·배포 준비)은 요약에 실린 목록 그대로다.
// 첫 화면 순서 — 흐름 띠·내 차례가 맨 위, 외부 도구는 현황 아래.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppProvider } from '../store';
import { operationOverview as O } from '../copy/operation-overview';
import ReadOnlyOperationOverview from '../screens/home/dashboard/ReadOnlyOperationOverview';
import { HomeScreen } from '../screens/home/Inbox';
import { operationSummary, type OperationInput, type OperationSummary } from '../screens/home/dashboard/operation-overview-model';

const vins = Array.from({ length: 15 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
const flagRow = (value: boolean, reason = 'MATCH') => ({ flagKey: 'flag_a', publicationId: 'PUB-1', sequence: 1, local: { value, reason }, drift: false });
const INPUT: OperationInput = {
  runtime: vins.map((vin, i) => ({ vin, scope: 'x', quality: i % 6 ? 'TRUSTED' : 'UNTRUSTED', link: i % 2 ? 'ONLINE' : 'OFFLINE', flags: [i === 7 ? flagRow(false, 'KILL_SWITCH') : flagRow(i % 2 === 0)], last: { at: `2026-11-05T0${i % 9}:00:00Z`, detail: '' } })),
  vehicles: vins.map((vin, i) => ({ vin, country: i % 3 ? 'KR' : 'US', vehicleModel: i % 2 ? 'NX4' : 'GN7' })),
  policies: [{ policyId: 'POL-1', revision: 2, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_a', status: 'DEPLOYED' }, { policyId: 'POL-2', revision: 1, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_b', status: 'VALIDATED' }],
  features: [{ featureId: 'F1', version: '1.0.0', country: 'KR', vehicleModel: 'NX4' }],
  publications: [
    { publicationId: 'PUB-1', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-05T01:00:00Z', payload: { targets: vins, flagKey: 'flag_a', featureId: 'F1', policy: { policyId: 'POL-1', revision: 2 } } },
    { publicationId: 'PUB-2', kind: 'POLICY', status: 'DISPATCHED', createdAt: '2026-11-05T02:00:00Z', payload: { targets: vins.slice(5), flagKey: 'flag_b', featureId: 'F1', policy: { policyId: 'POL-2', revision: 1 } } },
  ],
  readbacks: vins.slice(0, 10).map((vin, i) => ({ vin, publicationId: 'PUB-1', at: '2026-11-05T01:05:00Z', metricType: 'READBACK', observed: i % 5 ? 'h' : 'REJECTED', ...(i % 5 ? {} : { rejectReason: 'SIGNATURE_INVALID' }) })),
  syncs: [{ at: '2026-11-05T00:50:00Z', request: { policyId: 'POL-1', revision: 2, mode: 'live' }, response: { outcome: 'SYNCED' } }],
};
const LISTS: [string, unknown[]][] = [['/api/fleet/runtime', INPUT.runtime], ['/api/vehicles', INPUT.vehicles], ['/api/policies', INPUT.policies], ['/api/features', INPUT.features], ['/api/publications', INPUT.publications], ['/api/telemetry/readbacks', INPUT.readbacks], ['/api/integrations/calls', INPUT.syncs]];
const SUMMARY = operationSummary(INPUT, '2026-11-05T03:00:00Z', true);
let body: unknown = SUMMARY;
let urls: string[] = [];

/** 지금 주소 — 고리 조각을 누르면 지도로 옮겨 가는지 본다 */
function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount() {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator', department: 'ALL' }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><ReadOnlyOperationOverview role="operator" /><Where /></AppProvider></MemoryRouter></QueryClientProvider>);
}
const metric = (key: string) => document.querySelector(`[data-metric="${key}"] dd`)?.textContent;

beforeEach(() => {
  urls = [];
  body = SUMMARY;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input);
    urls.push(url);
    const json = url.startsWith('/api/fleet/operation-summary') ? body
      : url.startsWith('/api/procedures/summary') ? { todo: 3, review: 2, overdue: 1, done: 4, total: 10, processes: [] }
      : { items: LISTS.find(([p]) => url.startsWith(p))?.[1] ?? [] };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('홈 수신 현황 대시보드', () => {
  it('KPI 히어로·카드 값은 서버 요약 값 그대로다', async () => {
    mount();
    await screen.findByRole('table', { name: O.table });
    const s = SUMMARY;
    expect(metric('vehicles')).toBe(String(s.total));
    expect(metric('received')).toBe(`${Math.round((s.received / s.total) * 100)}%${O.receivedCount(s.received, s.total)}`);
    expect([metric('deployed'), metric('unknown'), metric('safe'), metric('approvals'), metric('rejected')]).toEqual([s.deployed, s.unknown, s.safe, s.approvals, s.rejected].map(String));
    expect(s.safe).toBe(1);
    // 흐름 띠 — 단계별 기록 수는 요약의 시각 분포 합계
    const flow = screen.getByRole('region', { name: O.flow.title });
    const sum = (phase: string) => s.points.filter((p) => p.phase === phase).reduce((n, p) => n + p.count, 0);
    expect(within(flow).getByText(O.flow.sync(sum('SYNC')))).toBeTruthy();
    expect(within(flow).getByText(O.flow.deploy(sum('DEPLOY')))).toBeTruthy();
    expect(within(flow).getByText(O.flow.read(s.received, s.total))).toBeTruthy();
    expect(within(flow).getByRole('link', { name: O.flow.open.READBACK }).getAttribute('href')).toBe('/fleet/map?lens=activation');
  });

  it('첫 화면 순서 — 흐름 띠·내 차례가 KPI보다 앞이고 외부 도구는 현황 다음, 내 차례는 업무 절차 요약 값', async () => {
    const { container } = mount();
    await screen.findByRole('table', { name: O.table });
    const work = screen.getByRole('region', { name: O.work.title });
    await waitFor(() => expect(within(work).getByText('3')).toBeTruthy());
    expect([...work.querySelectorAll('[data-work] dd')].map((d) => d.textContent)).toEqual(['3', '2', '1']);
    const order = (a: Element, b: Element) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    const hero = container.querySelector('.ov-hero')!;
    expect(order(screen.getByRole('region', { name: O.flow.title }), hero)).toBeTruthy();
    expect(order(work, hero)).toBeTruthy();
    const overview = screen.getByRole('region', { name: O.title });
    expect(overview.nextElementSibling?.className ?? '').toMatch(/ext/);
  });

  it('국가 상태 막대의 이름을 누르면 같은 국가의 차량 표로 좁히고, 막대·지도 링크는 그 차량 지도로 간다', async () => {
    mount();
    await screen.findByRole('table', { name: O.table });
    const ring = screen.getByRole('region', { name: O.countryChart });
    const us = SUMMARY.countryGroups.find((g) => g.name === 'US')!;
    fireEvent.click(within(ring).getByRole('button', { name: O.group('US', us.total) }));
    await waitFor(() => expect(screen.getByText(O.showing(us.total, us.total))).toBeTruthy());
    expect((screen.getByRole('combobox', { name: O.country }) as HTMLSelectElement).value).toBe('US');
    // '지도' 링크와 막대(마우스)는 그 국가·차종 차량 지도로 간다
    expect(within(ring).getByRole('link', { name: O.donut.map('US') }).getAttribute('href')).toBe('/fleet/map?lens=activation&country=US');
    const model = screen.getByRole('region', { name: O.modelChart });
    fireEvent.click(model.querySelector('.ov-bars__bar[data-clickable]')!);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/fleet/map?lens=activation&model=${encodeURIComponent(SUMMARY.modelGroups[0].name)}`));
  });

  // 2026-11-06 대시보드 디자인 언어 — 미니 지도(거품)는 'Feature 적용 현황' 점 지도로 바뀌었다(지도가 두 개 있지 않게). 위젯 동작은 homeAdoption.test
  it('지도는 Feature 적용 현황 하나 — 요약에 적용 현황이 실리면 지연 묶음으로 그린다', async () => {
    mount();
    await screen.findByRole('table', { name: O.table });
    expect(screen.queryByRole('region', { name: O.mapMini.title })).toBeNull();
    expect(await screen.findByRole('region', { name: O.adoption.title })).toBeTruthy();
  });

  it('Top 목록은 요약에 실린 차량·회신 대기 정책·배포 준비 그대로다', async () => {
    mount();
    await screen.findByRole('table', { name: O.table });
    const att = screen.getByRole('region', { name: O.top.vehicles });
    const links = within(att).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(SUMMARY.attention!.vehicles.map((v) => `/fleet/vehicles/${v.vin}`));
    expect(SUMMARY.attention!.vehicles[0].kind).toBe('REJECTED');
    const replies = screen.getByRole('region', { name: O.top.replies });
    expect(within(replies).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(SUMMARY.replyGaps!.map((g) => `/deployments/${g.publicationId}`));
    expect(within(replies).getByText(O.top.replied(SUMMARY.replyGaps![0].replied, SUMMARY.replyGaps![0].targets))).toBeTruthy();
    expect(within(replies).queryByText(O.top.pending(SUMMARY.replyGaps![0].pending, SUMMARY.replyGaps![0].targets))).toBeNull();
    expect(screen.getByRole('region', { name: O.preparation })).toBeTruthy();
  });

  it('새 칸이 없는 옛 요약에서도 그린다 — 차단 수신은 미확인, Top 목록은 뺀다', async () => {
    const { safe: _s, attention: _a, replyGaps: _r, ...old } = SUMMARY as OperationSummary;
    body = old;
    mount();
    await screen.findByRole('table', { name: O.table });
    expect(metric('safe')).toBe('—');
    expect(screen.queryByRole('region', { name: O.top.vehicles })).toBeNull();
    expect(urls.filter((u) => LISTS.some(([p]) => u.startsWith(p)))).toEqual([]);
  });

  it('홈 전체에서 요청이 늘지 않는다 — 내 차례는 홈이 이미 받는 업무 절차 요약 한 번, 차량·회신 전체 목록은 받지 않는다', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator', department: 'ALL' }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><HomeScreen /></AppProvider></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('table', { name: O.table });
    await waitFor(() => expect(within(screen.getByRole('region', { name: O.work.title })).getByText('3')).toBeTruthy());
    expect(urls.filter((u) => u.startsWith('/api/procedures/summary'))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith('/api/fleet/operation-summary'))).toHaveLength(1);
    expect(urls.filter((u) => LISTS.some(([p]) => u.startsWith(p) && p !== '/api/policies'))).toEqual([]);
  });
});
