// 전세계 차량 지도(D02-03) — 표·범례·국가별 현황, 보기 전환, 차량 상세(정밀 위치·감사 안내), 열람 역할 밖 403. jsdom에는 WebGL이 없어 지도 대신 안내가 보인다. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { summarize, type FleetMapVehicle } from '@ff/contracts';
import { AppProvider } from '../store';
import { FleetMapScreen } from '../screens/ops/FleetMap';

let calls: { url: string; headers: Record<string, string> }[];
let status = 200;

const V = (vin: string, o: Partial<FleetMapVehicle>): FleetMapVehicle => ({
  vin,
  label: `차량 ${vin}`,
  source: 'DEMO',
  country: 'KR',
  region: '수도권',
  vehicleModel: 'NX4 PE',
  trim: 'Premium',
  position: { lat: 37.57, lng: 126.98, precision: 'COARSE', accuracyM: 1100, city: '서울', heading: 90 },
  moving: true,
  stale: false,
  link: 'ONLINE',
  subscription: 'TRIAL',
  activation: 'ON',
  kills: [],
  ...o,
});
const ITEMS = [
  V('KMH-NX4-0001', { subscription: 'PAID', activation: 'DISABLED', kills: ['FEAT-00022'] }),
  V('KMH-NX4-0003', { position: { lat: 35.2, lng: 126.9, precision: 'REGION', accuracyM: 50000, city: '광주', heading: null }, region: '호남', link: 'OFFLINE', moving: false, stale: true, subscription: 'NONE', activation: 'UNKNOWN' }),
  V('TMA-NX4-0001', { country: 'EU', region: 'DE', position: { lat: 48.14, lng: 11.58, precision: 'COARSE', accuracyM: 1100, city: 'München', heading: 10 } }),
];
const MAP = { generatedAt: '2026-10-17T04:00:00.000Z', source: 'DEMO', catalogId: null, flagKey: null, flagKeys: ['care_00022_param'], catalogs: [{ catalogId: 'CAT-00019', name: '전방 안전거리 체험' }], precision: { level: 'COARSE', label: '약 1 km', degrees: 0.01 }, provider: '데모 모의 위치 공급자', privacy: '위치는 데모용 모의 좌표입니다.', audited: true, items: ITEMS, summary: summarize(ITEMS) };
// 5년 운영 표본 — 범위 안 표본이 많아 점 대신 가중 격자·요약만 온다
const SYN_SUMMARY = [{ country: 'KR', total: 9_607_629, located: 9_607_629, subscription: { PAID: 96_800, TRIAL: 26_003, OFFERED: 1, ENDED: 594_008, NONE: 8_890_817 }, activation: { ON: 0, OFF: 0, DISABLED: 0, UNKNOWN: 0 } }];
const SYN = { ...MAP, source: 'SYNTHETIC', items: [], pointsOmitted: 48_041, represented: 9_607_629, clusters: [{ id: '2:6', lat: 37.5, lng: 127, count: 9_607_629, sample: 48_041, subscription: SYN_SUMMARY[0].subscription }], summary: SYN_SUMMARY };
const DETAIL = { vehicle: { ...ITEMS[0], position: { ...ITEMS[0].position!, lat: 37.5712, lng: 126.9803, precision: 'PRECISE', accuracyM: 11 } }, grants: [{ grantId: 'ENT-00001', catalogId: 'CAT-00002', kind: '구독', state: 'ACTIVE', validFrom: '2026-01-01', validTo: '2027-01-01', effective: true }], runtime: { featureState: {}, flags: [{ flagKey: 'care_00022_param', local: { value: false, reason: 'KILL_SWITCH' }, drift: false }], quality: 'GOOD', last: null }, audited: true };

beforeEach(() => {
  localStorage.clear();
  calls = [];
  status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (status !== 200) return new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Feature 작성자 역할로는 이 작업을 할 수 없습니다.' }), { status, headers: { 'Content-Type': 'application/json' } });
      const body = url.startsWith('/api/fleet/map/vehicles/') ? DETAIL : url.startsWith('/api/fleet/map') ? (url.includes('source=SYNTHETIC') ? SYN : MAP) : { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path = '/fleet/map') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/fleet/map" element={<FleetMapScreen />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('전세계 차량 지도 화면', () => {
  it('지도를 그릴 수 없는 환경이면 안내하고, 표·범례·국가별 현황·개인정보 안내가 보인다', async () => {
    mount('operator');
    expect(await screen.findByText(/WebGL 없음/)).toBeTruthy();
    const table = await screen.findByRole('table', { name: '차량 목록' });
    expect(await within(table).findByText('KMH-NX4-0001')).toBeTruthy();
    expect(within(table).getByText('지역 대표점(위치 공유 미동의)')).toBeTruthy();
    expect(within(table).getByText('오프라인 — 마지막 보고 위치')).toBeTruthy();
    const legend = screen.getByRole('list', { name: '범례' });
    expect(within(legend).getByText('구독·구매')).toBeTruthy();
    const summary = screen.getByRole('table', { name: '국가별 현황' });
    expect(within(summary).getByText('KR')).toBeTruthy();
    expect(screen.getByText('위치는 데모용 모의 좌표입니다.')).toBeTruthy();
    expect(screen.getByText('이번 열람이 감사에 기록되었습니다.')).toBeTruthy();
    // 위치 열람은 계정 단위 감사라 actor 헤더를 싣는다
    const map = calls.find((c) => c.url.startsWith('/api/fleet/map?'))!;
    expect(map.url).toContain('source=DEMO');
    expect(map.headers['X-Actor-Id']).toBe('usr-operator');
  });

  it('기능 활성 보기로 바꾸면 범례가 활성 상태로 바뀌고 플래그를 고를 수 있다', async () => {
    mount('operator');
    await screen.findByRole('table', { name: '차량 목록' });
    fireEvent.click(screen.getByRole('radio', { name: '기능 활성' }));
    const legend = screen.getByRole('list', { name: '범례' });
    expect(within(legend).getByText('긴급 차단')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '플래그' }), { target: { value: 'care_00022_param' } });
    await waitFor(() => expect(calls.some((c) => c.url.includes('flagKey=care_00022_param'))).toBe(true));
  });

  it('차량 행을 열면 정밀 위치·권한·플래그 적용이 보이고 열람 감사를 안내한다', async () => {
    mount('viewer');
    const table = await screen.findByRole('table', { name: '차량 목록' });
    fireEvent.click(await within(table).findByText('KMH-NX4-0001'));
    const detail = await screen.findByTestId('fleet-map-detail');
    expect(within(detail).getByText('37.5712, 126.9803')).toBeTruthy();
    expect(within(detail).getByText('정밀 위치 열람은 매번 감사에 남습니다.')).toBeTruthy();
    expect(within(detail).getByText('ENT-00001')).toBeTruthy();
    expect(within(detail).getByText('KILL_SWITCH')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/fleet/map/vehicles/KMH-NX4-0001')!.headers['X-Actor-Role']).toBe('AUDITOR');
  });

  it('대상 차량(가중 표본)을 켜면 국가별 현황·범례가 대표 대수(만 단위)로, 지도는 묶음으로 안내한다', async () => {
    mount('operator');
    await screen.findByRole('table', { name: '차량 목록' });
    fireEvent.click(screen.getByRole('radio', { name: '시연 + 대상 차량(가중 표본)' }));
    expect(await screen.findByText(/표본 48,041대가 대상 차량 961만대를 대표합니다/)).toBeTruthy();
    const summary = screen.getByRole('table', { name: '국가별 현황' });
    // KR = 시연 2대 + 표본 대표 9,607,629대
    expect(within(summary).getByTitle('9,607,631')).toBeTruthy();
    expect(within(summary).getByTitle('9,607,631').textContent).toBe('961만');
    const legend = screen.getByRole('list', { name: '범례' });
    expect(within(legend).getByText('대상 차량 묶음 — 숫자는 대표 대수')).toBeTruthy();
    // 지도 범위를 모르면(WebGL 없음) 범위 없이 — 서버 기본(확대 1·세계)이고 정적 데모 스냅샷 URL과 같다
    expect(calls.some((c) => c.url === '/api/fleet/map?source=SYNTHETIC')).toBe(true);
  });

  it('핵심 메시지 행동이 긴급 차단 차량을 먼저 고르고, 다시 누르면 다음 미확인 차량으로 — 상세가 열린다(UX3-05)', async () => {
    mount('operator');
    const key = await screen.findByText('긴급 차단·미확인 차량');
    const box = key.closest('[data-key-message]') as HTMLElement;
    await waitFor(() => expect(within(box).getByText('2')).toBeTruthy());
    expect(box.getAttribute('data-tone')).toBe('danger');
    fireEvent.click(within(box).getByRole('button', { name: '지도에서 보기' }));
    expect(within(await screen.findByTestId('fleet-map-detail')).getByText('37.5712, 126.9803')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/fleet/map/vehicles/KMH-NX4-0001')).toBe(true);
    // 고른 뒤에는 다음 차량(미확인) — 누를 때마다 돌아간다
    fireEvent.click(within(box).getByRole('button', { name: '다음 차량 보기' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/fleet/map/vehicles/KMH-NX4-0003')).toBe(true));
  });

  it('국가별 현황은 접힌 보조 정보 — 국가 수만 보이고 펼치면 같은 표(UX3-05)', async () => {
    mount('operator');
    await screen.findByRole('table', { name: '차량 목록' });
    const fold = screen.getByTestId('fleet-map-summary') as HTMLDetailsElement;
    expect(fold.tagName).toBe('DETAILS');
    expect(fold.open).toBe(false);
    expect(await within(fold).findByText('국가별 현황 · 2개국')).toBeTruthy();
    expect(within(fold).getByRole('table', { name: '국가별 현황' })).toBeTruthy();
  });

  it('위치 열람이 거부되면(차량 신원 등) 지도·표 대신 안내만 보인다', async () => {
    status = 403;
    mount('author');
    expect(await screen.findByText(/사람 역할이면 누구나 볼 수 있고/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: '차량 목록' })).toBeNull();
  });
});
