import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppProvider, useAppApi } from '../store';
import TelemetryObservability from '../screens/ops/TelemetryObservability';
import { TelemetryScreen } from '../screens/master/Ops';

const at = ['2026-11-05T00:00:00.000Z', '2026-11-05T00:20:00.000Z'];
const metrics = '# TYPE ff_http_requests_total counter\nff_http_requests_total{method="GET",route="/vehicle",status="200"} 20\n';
const traces = { items: at.map((startTime, i) => ({ traceId: `trace-${i}`, spanId: `span-${i}`, name: 'evaluation', startTime, attributes: { 'feature_flag.key': `flag-${i}` } })) };
const events = { items: at.map((time, i) => ({ id: `evt-${i}`, seq: i, at: time, type: `EVENT-${i}`, aggregate: `policy-${i}`, componentId: 'D01-06', correlationId: `trace-${i}`, payload: {} })) };
let readbackBody: unknown;

beforeEach(() => {
  localStorage.clear();
  readbackBody = { items: [{ vin: 'VIN-PRIVATE', publicationId: 'PUB-00001', at: at[0], observed: 'ON' }] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/health/metrics') return new Response(metrics);
    if (url.includes('/telemetry/readbacks') && (init?.headers as Record<string, string> | undefined)?.['X-Actor-Id'] === 'usr-author') return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '회신 조회 권한이 없습니다.' } }), { status: 403 });
    return new Response(JSON.stringify(url.includes('/otel/spans') ? traces : url.includes('/telemetry/readbacks') ? readbackBody : events), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function SwitchRole() { const { dispatch } = useAppApi(); return <button onClick={() => dispatch({ t: 'ROLE', role: 'author' })}>담당자 변경</button>; }
function mount() {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AppProvider><SwitchRole /><TelemetryObservability /></AppProvider></MemoryRouter></QueryClientProvider>);
}

it('실제 수집 화면의 상위 관측 탭을 유지하며 Traces·Events·차량 회신을 전환한다', async () => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Location() { const location = useLocation(); return <output data-testid="observability-location">{location.search}</output>; }
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/ops/telemetry?tab=observability']}><AppProvider><TelemetryScreen /><Location /></AppProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Traces', exact: true }));
  await screen.findByRole('table', { name: '평가 요청 추적' });
  expect(screen.getByRole('tab', { name: '지표·추적·이벤트', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('observability-location')).toHaveTextContent('tab=observability');
  expect(screen.getByTestId('observability-location')).toHaveTextContent('observe=traces');
  fireEvent.click(screen.getByRole('tab', { name: 'Events', exact: true }));
  await screen.findByRole('table', { name: '이벤트 기록' });
  expect(screen.getByTestId('observability-location')).toHaveTextContent('observe=logs');
  const eventsTab = screen.getByRole('tab', { name: 'Events', exact: true });
  eventsTab.focus(); fireEvent.keyDown(eventsTab, { key: 'ArrowRight' });
  await screen.findByRole('table', { name: '차량 회신' });
  const receiptTab = screen.getByRole('tab', { name: '차량 회신', exact: true });
  expect(receiptTab).toHaveFocus();
  const panel = screen.getByRole('tabpanel', { name: '차량 회신', exact: true });
  expect(receiptTab.getAttribute('aria-controls')).toBe(panel.id);
  expect(panel.getAttribute('aria-labelledby')).toBe(receiptTab.id);
  expect(document.querySelectorAll(`[id="${receiptTab.id}"]`)).toHaveLength(1);
  expect(document.querySelectorAll(`[id="${panel.id}"]`)).toHaveLength(1);
  expect(screen.getByRole('tab', { name: '회신 (readback)', exact: true }).id).toBe('tab-readbacks');
  expect(screen.getByRole('tab', { name: '지표·추적·이벤트', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByTestId('observability-location')).toHaveTextContent('observe=readbacks');
});

it('시간 구간은 실제 기록만 필터하고 서버 누적 요청 수는 유지한다', async () => {
  mount();
  await screen.findByRole('table', { name: '처리 지표' });
  const chart = screen.getByRole('group', { name: '조회된 기록의 시간 분포' });
  await waitFor(() => expect(within(chart).getAllByRole('button').filter(b => !(b as HTMLButtonElement).disabled).length).toBe(2));
  fireEvent.click(within(chart).getAllByRole('button')[0]);
  expect(screen.getByText('HTTP 요청', { selector: '.ds-summary span' })).toHaveTextContent('20');
  fireEvent.click(screen.getByRole('tab', { name: 'Events', exact: true }));
  const table = await screen.findByRole('table', { name: '이벤트 기록' });
  expect(table).toHaveTextContent('EVENT-0'); expect(table).not.toHaveTextContent('EVENT-1');
  fireEvent.click(screen.getByRole('button', { name: '시간 선택 해제' }));
  expect(table).toHaveTextContent('EVENT-1');
});

it('손상된 차량 회신 응답은 정상·빈 기록으로 표시하지 않는다', async () => {
  readbackBody = { items: [{ vin: 'VIN-PRIVATE', publicationId: 'PUB-00001', observed: 'ON', at: 'not-a-date' }] };
  mount(); fireEvent.click(screen.getByRole('tab', { name: '차량 회신', exact: true }));
  await screen.findByText('수집 기록의 형식이 올바르지 않습니다. 원장을 다시 확인하세요.');
  expect(screen.queryByRole('table', { name: '차량 회신' })).toBeNull();
  expect(screen.queryByText('조회된 기록이 없습니다.')).toBeNull();
});

it('권한이 없는 담당자로 바뀌면 이전 차량 회신과 열린 상세를 지운다', async () => {
  mount(); fireEvent.click(screen.getByRole('tab', { name: '차량 회신', exact: true }));
  const table = await screen.findByRole('table', { name: '차량 회신' });
  fireEvent.click(within(table).getAllByRole('row')[1]);
  await screen.findByRole('dialog', { name: '차량 회신' });
  fireEvent.click(screen.getByRole('button', { name: '담당자 변경' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '차량 회신' })).toBeNull());
  await screen.findByText('역할을 바꾸거나 권한 담당자에게 요청하세요.');
  expect(screen.queryByText('VIN-PRIVATE')).toBeNull();
});
