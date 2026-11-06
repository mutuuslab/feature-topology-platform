// 로그인 직후 홈 성능 회귀 — ① 절차 지도 가젯의 '오른쪽에 더 있음' 표시(useMoreRight)가 렌더마다
// 강제 레이아웃(scrollWidth 읽기)과 ResizeObserver 생성을 되풀이해 CPU 4배 느림에서 0.7초를 먹던 결함,
// ② 홈 수신 현황이 차량·회신·게시본 전체 목록(공개 데모 압축 전 약 1 MB)을, ③ 활동 가젯이 감사 이력 500건을 받던 결함.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { operationOverview as O } from '../copy/operation-overview';
import { useMoreRight } from '../screens/home/dashboard/Dashboard';
import { HomeScreen } from '../screens/home/Inbox';
import ReadOnlyOperationOverview from '../screens/home/dashboard/ReadOnlyOperationOverview';
import ListBody from '../screens/home/dashboard/bodies-lists';
import { OPERATION_PAGE, operationSummary, type OperationInput } from '../screens/home/dashboard/operation-overview-model';

let created = 0;
let reads = 0;
let wide = 500;
class CountingRO {
  constructor(public cb: ResizeObserverCallback) {
    created++;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

function Probe({ on, n }: { on: boolean; n: number }) {
  const ref = useMoreRight(on);
  return (
    <div ref={ref} data-testid="body">
      <div>{n}</div>
    </div>
  );
}

beforeEach(() => {
  created = 0;
  reads = 0;
  wide = 500;
  vi.stubGlobal('ResizeObserver', CountingRO);
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => (reads++, wide) });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('홈 가젯 본문 — 오른쪽 넘침 표시', () => {
  it('데이터가 여러 번 와서 렌더가 반복돼도 옵저버는 한 번만 만들고 크기는 프레임에 한 번만 읽는다', async () => {
    const { rerender, getByTestId } = render(<Probe on n={0} />);
    for (let n = 1; n <= 26; n++) rerender(<Probe on n={n} />);
    await frame();
    expect(created).toBe(1);
    expect(reads).toBe(1);
    expect(getByTestId('body').hasAttribute('data-more')).toBe(true);
  });

  it('크기가 바뀌면 다음 프레임에 한 번 읽어 표시를 고친다', async () => {
    const { getByTestId } = render(<Probe on n={0} />);
    await frame();
    wide = 100;
    getByTestId('body').dispatchEvent(new Event('scroll'));
    getByTestId('body').dispatchEvent(new Event('scroll'));
    await frame();
    expect(reads).toBe(2);
    expect(getByTestId('body').hasAttribute('data-more')).toBe(false);
  });

  it('끄면 옵저버를 정리하고 표시를 뗀다', async () => {
    const { rerender, getByTestId } = render(<Probe on n={0} />);
    await frame();
    rerender(<Probe on={false} n={1} />);
    expect(getByTestId('body').hasAttribute('data-more')).toBe(false);
    expect(created).toBe(1);
  });
});

// ───────── 홈 수신 현황 — 요약 하나만 받고, 숫자는 전체 기준 ─────────
const vins = Array.from({ length: 15 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
const flagRow = (value: boolean) => ({ flagKey: 'flag_a', publicationId: 'PUB-1', sequence: 1, local: { value, reason: 'MATCH' }, drift: false });
const INPUT: OperationInput = {
  runtime: vins.map((vin, i) => ({ vin, scope: 'x', quality: i % 6 ? 'TRUSTED' : 'UNTRUSTED', link: i % 2 ? 'ONLINE' : 'OFFLINE', flags: [flagRow(i % 2 === 0)], last: null })),
  vehicles: vins.map((vin, i) => ({ vin, country: i % 3 ? 'KR' : 'US', vehicleModel: 'NX4' })),
  policies: [{ policyId: 'POL-1', revision: 2, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_a', status: 'DEPLOYED' }],
  features: [{ featureId: 'F1', version: '1.0.0', country: 'KR', vehicleModel: 'NX4' }],
  publications: [{ publicationId: 'PUB-1', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-05T01:00:00Z', payload: { targets: vins, flagKey: 'flag_a', featureId: 'F1', policy: { policyId: 'POL-1', revision: 2 } } }],
  readbacks: vins.map((vin, i) => ({ vin, publicationId: 'PUB-1', at: '2026-11-05T01:05:00Z', metricType: 'READBACK', observed: i % 5 ? 'h' : 'REJECTED', ...(i % 5 ? {} : { rejectReason: 'SIGNATURE_INVALID' }) })),
  syncs: [{ at: '2026-11-05T00:50:00Z', request: { policyId: 'POL-1', revision: 2, mode: 'live' }, response: { outcome: 'SYNCED' } }],
};
const LISTS: [string, unknown[]][] = [['/api/fleet/runtime', INPUT.runtime], ['/api/vehicles', INPUT.vehicles], ['/api/policies', INPUT.policies], ['/api/features', INPUT.features], ['/api/publications', INPUT.publications], ['/api/telemetry/readbacks', INPUT.readbacks], ['/api/integrations/calls', INPUT.syncs]];
let urls: string[] = [];
let summaryStatus = 200;
const metricText = () => [...document.querySelectorAll('[data-metric] dd')].map((d) => d.textContent);

function mountOverview() {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator', department: 'ALL' }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><ReadOnlyOperationOverview role="operator" /></AppProvider></MemoryRouter></QueryClientProvider>);
}

describe('홈 수신 현황 — 서버 요약', () => {
  beforeEach(() => {
    urls = [];
    summaryStatus = 200;
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('/api/fleet/operation-summary')) return new Response(JSON.stringify(summaryStatus === 200 ? operationSummary(INPUT, '2026-11-05T03:00:00Z', true) : { error: { code: 'NOT_FOUND' } }), { status: summaryStatus, headers: { 'Content-Type': 'application/json' } });
      const hit = LISTS.find(([p]) => url.startsWith(p));
      return new Response(JSON.stringify({ items: hit ? hit[1] : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  it('첫 화면은 요약 하나만 받는다 — 차량·회신·게시본 전체 목록은 받지 않는다', async () => {
    mountOverview();
    await screen.findByRole('table', { name: O.table });
    expect(urls).toContain('/api/fleet/operation-summary');
    expect(urls.filter((u) => LISTS.some(([p]) => u.startsWith(p)))).toEqual([]);
    expect(screen.getAllByRole('row')).toHaveLength(1 + OPERATION_PAGE);
    expect(screen.getByText(O.showing(OPERATION_PAGE, 15))).toBeTruthy();
  });

  it('요약 숫자는 전체 목록으로 센 화면과 같다(요약이 없으면 예전처럼 전체를 받아 센다)', async () => {
    mountOverview();
    await screen.findByRole('table', { name: O.table });
    const fromSummary = metricText();
    cleanup();
    summaryStatus = 404;
    mountOverview();
    await screen.findByRole('table', { name: O.table });
    await waitFor(() => expect(metricText()).toEqual(fromSummary));
    expect(urls).toContain('/api/fleet/runtime');
    expect(fromSummary[0]).toBe('15');
  });

  it('거르거나 더 보면 그때 전체 목록을 받아 화면에서 센다', async () => {
    mountOverview();
    await screen.findByRole('table', { name: O.table });
    fireEvent.change(screen.getByRole('combobox', { name: O.country }), { target: { value: 'US' } });
    await waitFor(() => expect(screen.getByText(O.showing(5, 5))).toBeTruthy());
    expect(urls).toContain('/api/fleet/runtime');
    expect(urls).toContain('/api/telemetry/readbacks');
  });
});

describe('홈 활동 가젯 — 보이는 줄만큼만 읽는다', () => {
  it('감사 이력은 줄 수 상한(20)만 받는다 — 감사 화면처럼 500건을 받지 않는다', async () => {
    urls = [];
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: 100 - i, at: '2026-11-05T01:00:00Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'POLICY_CREATE', target: `POL-${i}`, result: 'ALLOWED' }));
    vi.stubGlobal('fetch', vi.fn(async (input: string) => (urls.push(String(input)), new Response(JSON.stringify({ items: rows, nextCursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author', department: 'ALL' }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><ListBody role="author" wide={false} gadget={{ id: 'activity', type: 'activity', configured: true, config: { rows: 10 }, refresh: 0, minimized: false } as never} /></AppProvider></MemoryRouter></QueryClientProvider>);
    await screen.findByText('POL-9');
    expect(screen.queryByText('POL-10')).toBeNull();
    expect(urls.filter((u) => u.startsWith('/api/audit'))).toEqual(['/api/audit?limit=20']);
  });
});

describe('홈 첫 화면 — 코드와 데이터를 함께 받기 시작한다', () => {
  it('운영 현황 요약은 운영 현황 묶음을 기다리지 않고 먼저 요청하고, 미리 받은 것을 그대로 써 한 번만 받는다', async () => {
    urls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      urls.push(url);
      const body = url.startsWith('/api/fleet/operation-summary') ? operationSummary(INPUT, '2026-11-05T03:00:00Z', true) : { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><HomeScreen /></AppProvider></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('table', { name: O.table });
    const summary = urls.filter((u) => u.startsWith('/api/fleet/operation-summary'));
    expect(summary).toHaveLength(1);
    // 예전: 홈 묶음 → 운영 현황 묶음 → 요약 순이라 검토함 대기열(홈 묶음이 바로 읽는 조회)보다 늦었다
    expect(urls.indexOf(summary[0])).toBeLessThan(urls.findIndex((u) => u.startsWith('/api/work-queues')));
  });
});
