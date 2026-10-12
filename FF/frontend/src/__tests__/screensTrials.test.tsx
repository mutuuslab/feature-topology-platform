// 기간형 체험권 — 사용 권한·체험권 화면(D01-05·D05-04)과 체험 전환 분석 화면(D05-06). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { EntitlementsScreen } from '../screens/policy/Entitlements';
import { TrialAnalyticsScreen } from '../screens/biz/TrialAnalytics';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path: string, routePath: string, el: JSX.Element, role = 'operator') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={routePath} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const P = { country: 'KR', region: '수도권', vehicleModel: 'NX4 PE', trim: 'Premium', ageBand: '40대', drivingStyle: '고속도로', adasUsage: '높음' };
const G = (o: Record<string, unknown>) => ({ catalogId: 'CAT-00019', kind: '체험', status: 'ACTIVE', effective: false, daysLeft: null, offeredAt: '2026-09-28', acceptedAt: null, convertedAt: null, convertedPlan: null, fromTrial: null, source: 'DEMO', note: null, validFrom: '2026-10-01', validTo: '2026-10-30', profile: P, ...o });
const PAGE = {
  today: '2026-10-12',
  total: 4,
  page: 1,
  pageSize: 50,
  byState: { ACTIVE: 1, OFFERED: 1, CONVERTED: 1, EXPIRED: 1 },
  items: [
    G({ grantId: 'ENT-00001', vin: 'ego-01', state: 'ACTIVE', effective: true, daysLeft: 19, acceptedAt: '2026-10-01' }),
    G({ grantId: 'ENT-00003', vin: 'lead-01', state: 'OFFERED', status: 'OFFERED', daysLeft: 12 }),
    G({ grantId: 'ENT-S00007', vin: 'SYN-US-00007', state: 'CONVERTED', status: 'CONVERTED', source: 'SYNTHETIC', acceptedAt: '2026-08-01', convertedAt: '2026-08-20', convertedPlan: '구매', profile: { ...P, country: 'US', region: 'West' } }),
    G({ grantId: 'ENT-00007', vin: 'TMA-NX4-0001', state: 'EXPIRED', acceptedAt: '2026-08-13' }),
  ],
};

describe('사용 권한·체험권 — 체험권 차량', () => {
  it('상태·남은 일수·성향이 보이고, 제안 중이면 수락·거절, 체험한 차량은 구독 전환, 합성 차량은 처리 버튼이 없다', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { body: PAGE.items[0] };
      if (url.startsWith('/api/trials')) return { body: PAGE };
      if (url.startsWith('/api/vehicles')) return { body: { items: [{ vin: 'ego-01', label: 'x' }] } };
    };
    mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    const table = await screen.findByRole('table', { name: '체험권 차량' });
    const row = (id: string) => within(table).getByText(id).closest('tr')!;
    expect(within(row('ENT-00001')).getByText('체험 중')).toBeTruthy();
    expect(within(row('ENT-00001')).getByText('19일')).toBeTruthy();
    expect(within(row('ENT-00001')).getByText('KR · 수도권')).toBeTruthy();
    expect(within(row('ENT-S00007')).getByText('합성')).toBeTruthy();
    expect(within(row('ENT-S00007')).queryAllByRole('button')).toHaveLength(0);
    expect(within(row('ENT-00007')).getByRole('button', { name: '구독 전환' })).toBeTruthy();
    fireEvent.click(within(row('ENT-00003')).getByRole('button', { name: '수락' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/trials/ENT-00003/accept' && c.init?.method === 'POST')).toBe(true));
    fireEvent.click(within(row('ENT-00007')).getByRole('button', { name: '구독 전환' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/trials/ENT-00007/purchase')?.init?.body).toBe(JSON.stringify({ plan: '구독' })));
  });

  it('필터를 바꾸면 같은 질의 순서로 다시 묻는다 (정적 스냅샷과 같은 키)', async () => {
    handler = (url) => (url.startsWith('/api/trials') ? { body: PAGE } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined);
    mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await screen.findByRole('table', { name: '체험권 차량' });
    expect(calls.some((c) => c.url === '/api/trials?catalogId=CAT-00019&source=ALL&pageSize=50')).toBe(true);
    fireEvent.change(screen.getByLabelText('국가'), { target: { value: 'US' } });
    fireEvent.change(await screen.findByLabelText('지역'), { target: { value: 'West' } });
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'CONVERTED' } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/trials?catalogId=CAT-00019&source=ALL&state=CONVERTED&country=US&region=West&pageSize=50')).toBe(true));
  });

  it('작성자는 체험 수락을 처리할 수 없다(운영자·시스템만)', async () => {
    handler = (url) => (url.startsWith('/api/trials') ? { body: PAGE } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined);
    mount('/entitlements', '/entitlements', <EntitlementsScreen />, 'author');
    const table = await screen.findByRole('table', { name: '체험권 차량' });
    expect((within(table).getByRole('button', { name: '수락' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const GROUP = (key: string, offered: number, acceptRate: number | null, conversionRate: number | null, suppressed = false) => ({ key, offered, accepted: 0, active: 0, converted: 0, declined: 0, expired: 0, pending: 0, acceptRate, conversionRate, overallRate: null, medianDaysToConvert: null, suppressed });
const ANALYTICS = {
  today: '2026-10-12',
  catalogId: 'CAT-00019',
  source: 'ALL',
  groupBy: 'drivingStyle',
  k: 5,
  counts: { demo: 5, synthetic: 3000 },
  total: { ...GROUP('전체', 3005, 0.412, 0.318), accepted: 1238, converted: 394, active: 120, pending: 80, overallRate: 0.131, medianDaysToConvert: 18 },
  groups: [GROUP('고속도로', 900, 0.52, 0.35), GROUP('도심', 1050, 0.3, 0.28), GROUP('미상', 3, null, null, true)],
  // 월요일 주 26개 — 마지막(2026-10-12 주)은 진행 중
  trend: Array.from({ length: 26 }, (_, i) => ({ week: new Date(Date.parse('2026-10-12T00:00:00Z') - (25 - i) * 7 * 86400_000).toISOString().slice(0, 10), offered: 100 + i, accepted: 40 + i, converted: 10 + i })),
};

describe('체험 전환 분석', () => {
  it('KPI·깔때기·성향별·주별 추이, 5대 미만 집단은 가리고, 나눠 보기 기준을 바꾸면 다시 묻는다', async () => {
    handler = (url) => (url.startsWith('/api/biz/trials') ? { body: ANALYTICS } : undefined);
    mount('/biz/trials', '/biz/trials', <TrialAnalyticsScreen />);
    expect(await screen.findByRole('group', { name: '제안 → 수락 → 구매: 제안 3,005, 수락 1,238, 구매 394' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '체험 전환 분석' })).toBeTruthy();
    const kpis = [...document.querySelectorAll('.ds-kpi')].map((k) => [k.querySelector('.ds-kpi__label')?.textContent, k.querySelector('.ds-kpi__value')?.textContent]);
    expect(kpis).toEqual([['제안', '3,005'], ['수락률', '41.2%'], ['구매 전환율', '31.8%'], ['제안 → 구매', '13.1%'], ['수락 → 구매 (중앙값)', '18']]);
    expect(screen.getByRole('group', { name: '제안 → 수락 → 구매: 제안 3,005, 수락 1,238, 구매 394' })).toBeTruthy();
    const seg = screen.getByRole('table', { name: '주행 성향별 수락률·구매 전환율' });
    expect(within(within(seg).getByText('미상').closest('tr')!).getAllByText('가림 (5대 미만)')).toHaveLength(3);
    expect(within(within(seg).getByText('고속도로').closest('tr')!).getByText('52.0%')).toBeTruthy();
    // 십자선 툴팁은 키보드로도 — 진행 중인 주는 그래프에서 빠지므로 마지막은 끝난 주(10-05)
    expect(screen.getByText('그래프는 끝난 주까지 — 진행 중인 이번 주(2026-10-12~)는 표에만 있습니다.')).toBeTruthy();
    const trend = screen.getByRole('img', { name: '주별 추이 — 제안·수락·구매 (주 시작 월요일)' });
    fireEvent.keyDown(trend, { key: 'ArrowLeft' });
    const tip = await screen.findByRole('status');
    expect(within(tip).getByText('2026-10-05 주')).toBeTruthy();
    expect(within(tip).getByText('124')).toBeTruthy();
    expect(within(tip).getByText('34')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('나눠 보기'), { target: { value: 'adasUsage' } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/biz/trials?catalogId=CAT-00019&source=ALL&groupBy=adasUsage')).toBe(true));
  });
});
