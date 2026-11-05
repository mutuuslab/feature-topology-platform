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
    const r = handler(url, init) ?? (url === '/api/entitlements' ? { body: { items: [] } } : { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } });
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
const PRODUCTS = { items: [{ catalogId: 'CAT-00019', version: '1.0.0', name: '체험 상품', lifecycle: 'APPROVED', saleType: '체험', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }] };

describe('사용 권한·체험권 — 체험권 차량', () => {
  it('빈 설치에는 상품 식별자를 만들어 보이지 않고 상품 없는 체험 조회·제안을 하지 않는다', async () => {
    handler = (url) => url === '/api/products' ? { body: { items: [] } } : url.startsWith('/api/trials') ? { body: { ...PAGE, items: [], total: 0, byState: {} } } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined;
    const view = mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/products')).toBe(true));
    await waitFor(() => expect(view.container.textContent).not.toContain('CAT-00019'));
    expect(calls.some((c) => c.url.startsWith('/api/trials'))).toBe(false);
    expect(screen.queryByRole('region', { name: '체험 제안' })).toBeNull();
  });

  it('기본 체험 상품은 이 설치의 실제 목록에서 고르고 존재하지 않는 시연 번호로 조회하지 않는다', async () => {
    handler = (url) => url === '/api/products' ? { body: { items: [{ ...PRODUCTS.items[0], catalogId: 'CAT-00064', name: '고객 설치 체험' }] } } : url.startsWith('/api/trials') ? { body: PAGE } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined;
    mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/trials?catalogId=CAT-00064'))).toBe(true));
    expect(calls.some((c) => c.url.includes('CAT-00019'))).toBe(false);
    expect(screen.getByLabelText('체험 상품')).toHaveValue('CAT-00064');
  });

  it('출시 전 초안보다 실제 체험 이력이 있는 구성 승인 상품을 기본으로 고른다', async () => {
    const approved = { ...PRODUCTS.items[0], catalogId: 'CAT-00083' };
    handler = (url) => url === '/api/products' ? { body: { items: [{ ...approved, catalogId: 'CAT-00061', lifecycle: 'DEVELOPING' }, { ...approved, catalogId: 'CAT-00082' }, approved] } } : url === '/api/entitlements' ? { body: { items: [G({ catalogId: approved.catalogId, kind: '체험' })] } } : url.startsWith('/api/trials') ? { body: { ...PAGE, items: PAGE.items.map((g) => ({ ...g, catalogId: approved.catalogId })) } } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined;
    mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await screen.findByRole('table', { name: '체험권 차량' });
    expect(screen.getByLabelText('체험 상품')).toHaveValue('CAT-00083');
    expect(calls.filter((c) => c.url.startsWith('/api/trials')).every((c) => c.url.includes('catalogId=CAT-00083'))).toBe(true);
  });

  it('성공한 빈 체험 조회는 진행 중 0으로 보인다', async () => {
    handler = (url) => url === '/api/products' ? { body: PRODUCTS } : url === '/api/entitlements' ? { body: { items: [] } } : url.startsWith('/api/trials') ? { body: { ...PAGE, items: [], total: 0, byState: {} } } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined;
    const view = mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await screen.findByText('조건에 맞는 체험권이 없습니다');
    expect(view.container.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('0');
  });

  it('초안 체험만 있는 설치는 기본 체험 조회·제안을 시작하지 않는다', async () => {
    handler = (url) => url === '/api/products' ? { body: { items: [{ ...PRODUCTS.items[0], lifecycle: 'DEVELOPING' }] } } : undefined;
    const view = mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await waitFor(() => expect(view.container.querySelector('.ds-state__title')?.textContent).toBe('체험 상품을 고르세요'));
    expect(calls.some((c) => c.url.startsWith('/api/trials'))).toBe(false);
    expect(view.container.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('—');
    expect(screen.queryByRole('region', { name: '체험 제안' })).toBeNull();
  });

  it('체험 조회 오류를 진행 중 0으로 표시하지 않는다', async () => {
    handler = (url) => url === '/api/products' ? { body: PRODUCTS } : url.startsWith('/api/trials') ? { status: 503, body: { error: { code: 'UPSTREAM_DOWN', message: '체험 조회 실패' } } } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined;
    const view = mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await screen.findByRole('alert');
    expect(view.container.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('—');
  });

  it('명시한 출시 전 상품 주소는 다른 상품으로 바꾸지 않는다', async () => {
    handler = (url) => url === '/api/products' ? { body: { items: [{ ...PRODUCTS.items[0], catalogId: 'CAT-00089', lifecycle: 'DEVELOPING' }, ...PRODUCTS.items] } } : url.startsWith('/api/trials') ? { body: { ...PAGE, items: [], byState: {}, total: 0 } } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined;
    mount('/entitlements?catalog=CAT-00089', '/entitlements', <EntitlementsScreen />);
    await screen.findByText('조건에 맞는 체험권이 없습니다');
    expect(screen.getByLabelText('체험 상품')).toHaveValue('CAT-00089');
    expect(calls.filter((c) => c.url.startsWith('/api/trials')).every((c) => c.url.includes('catalogId=CAT-00089'))).toBe(true);
    expect(calls.some((c) => c.url === '/api/entitlements')).toBe(false);
  });

  it('상태·남은 일수·성향이 보이고, 제안 중이면 수락·거절, 체험한 차량은 구독 전환, 합성 차량은 처리 버튼이 없다', async () => {
    handler = (url, init) => {
      if (url === '/api/products') return { body: PRODUCTS };
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
    // 국가·지역 선택지는 설치에 등록된 고객 기준 값(RD-OPS-03)
    const REF = { items: [{ kind: 'COUNTRY', code: 'US', label: '미국', parent: null, origin: 'SEED', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z', createdBy: 'seed' }, { kind: 'REGION', code: 'West', label: 'West', parent: 'US', origin: 'SEED', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z', createdBy: 'seed' }] };
    handler = (url) => (url === '/api/products' ? { body: PRODUCTS } : url.startsWith('/api/trials') ? { body: PAGE } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : url.startsWith('/api/reference-values') ? { body: REF } : undefined);
    mount('/entitlements', '/entitlements', <EntitlementsScreen />);
    await screen.findByRole('table', { name: '체험권 차량' });
    expect(calls.some((c) => c.url === '/api/trials?catalogId=CAT-00019&source=ALL&pageSize=50')).toBe(true);
    fireEvent.change(await screen.findByLabelText('국가'), { target: { value: 'US' } });
    fireEvent.change(await screen.findByLabelText('지역'), { target: { value: 'West' } });
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'CONVERTED' } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/trials?catalogId=CAT-00019&source=ALL&state=CONVERTED&country=US&region=West&pageSize=50')).toBe(true));
  });

  it('작성자는 체험 수락을 처리할 수 없다(운영자·시스템만)', async () => {
    handler = (url) => (url === '/api/products' ? { body: PRODUCTS } : url.startsWith('/api/trials') ? { body: PAGE } : url.startsWith('/api/vehicles') ? { body: { items: [] } } : undefined);
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
    // 핵심 메시지 = 구매 전환율, 나머지는 요약 줄(3초 테스트)
    expect(document.querySelector('[data-key-message]')?.querySelector('.ds-key__value')?.textContent).toBe('31.8%');
    const sum = [...document.querySelectorAll('.ds-summary > span')].map((s) => [s.firstChild?.textContent?.trim(), s.querySelector('b')?.textContent]);
    expect(sum).toEqual([['제안', '3,005'], ['수락률', '41.2%'], ['제안 → 구매', '13.1%'], ['수락 → 구매 (중앙값)', '18']]);
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
    // 5년 운영 — 추이를 260주로
    fireEvent.click(screen.getByRole('radio', { name: '5년' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('&weeks=260'))).toBe(true));
  });
});
