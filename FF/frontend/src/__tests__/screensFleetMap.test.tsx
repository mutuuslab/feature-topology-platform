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
      const body = url.startsWith('/api/fleet/map/vehicles/') ? DETAIL : url.startsWith('/api/fleet/map') ? MAP : { items: [] };
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

  it('위치 열람 역할 밖이면 지도·표 대신 안내만 보인다', async () => {
    status = 403;
    mount('author');
    expect(await screen.findByText(/위치 열람은 운영·운영 책임·안전·감사 역할만/)).toBeTruthy();
    expect(screen.queryByRole('table', { name: '차량 목록' })).toBeNull();
  });
});
