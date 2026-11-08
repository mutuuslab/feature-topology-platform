// '운영'(/fleet/live) 성능 회귀 — 차량 × flag 표가 수백 대(공개 데모 480대 × flag 5개 ≈ 4천 칸)를 한 번에 그려
// CPU 4배 느림에서 메뉴를 열 때 3초 멈췄다. 앞쪽 60대만 그리고, 서버 판단과 다른·미확인 차량을 위에 둔다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { FleetLive } from '../screens/ops/FleetLive';
import { ko } from '../copy/ko';
import { fleetSearch as FS } from '../copy/fleet-search';

const flag = (flagKey: string, drift = false) => ({ flagKey, publicationId: 'PUB-1', sequence: 1, local: { value: true, reason: 'MATCH' }, server: { value: !drift, reason: 'MATCH' }, drift });
const row = (i: number) => ({ vin: `V${String(i).padStart(3, '0')}`, label: `차량 ${i}`, scope: 'KR/NX4/P', link: 'ONLINE', quality: 'TRUSTED', gleo: false, featureState: {}, kills: [], flags: [flag('a', i === 150), flag('b')], last: null });
const ROWS = Array.from({ length: 200 }, (_, i) => row(i + 1));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.startsWith('/api/fleet/runtime') ? { items: ROWS, gleo: 'internal' } : url.startsWith('/api/gleo') ? { mode: 'internal', connected: true, lastError: null, messages: [] } : { items: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('운영 — 차량 × flag 표', () => {
  it('수백 대여도 앞쪽 60대만 그리고, 서버 판단과 다른 차량을 맨 위에 둔다', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/fleet/live?tab=match']}><AppProvider><FleetLive /></AppProvider></MemoryRouter></QueryClientProvider>);
    const table = await screen.findByRole('table', { name: ko.fleet.matrix });
    const body = () => within(table).getAllByRole('row').slice(1);
    expect(body()).toHaveLength(60);
    expect(within(body()[0]).getByRole('link').textContent).toBe('V150');
    expect(screen.getByText(ko.fleet.showing(60, 200))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ko.fleet.more }));
    expect(body()).toHaveLength(120);
  });
});


it('finds a vehicle beyond the initial page without rendering the whole fleet or changing global counts',async()=>{
  localStorage.setItem('fp.state.v2',JSON.stringify({role:'operator'}));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/fleet/live?tab=match']}><AppProvider><FleetLive /></AppProvider></MemoryRouter></QueryClientProvider>);
  const table=await screen.findByRole('table',{name:ko.fleet.matrix});
  const search=screen.getByRole('searchbox',{name:FS.label});
  expect(within(table).queryByRole('link',{name:'V199'})).toBeNull();
  fireEvent.change(search,{target:{value:'v199'}});
  expect(within(table).getAllByRole('link')).toHaveLength(1);
  expect(within(table).getByRole('link',{name:'V199'})).toBeTruthy();
  expect(screen.getByText(FS.matches(1,200))).toBeTruthy();
  expect(screen.getByText('200/200')).toBeTruthy();
  fireEvent.change(search,{target:{value:'차량 199'}});
  expect(within(table).getByRole('link',{name:'V199'})).toBeTruthy();
  fireEvent.change(search,{target:{value:'unknown-vin'}});
  expect(screen.getByText(FS.empty)).toBeTruthy();
  expect(within(table).queryAllByRole('link')).toHaveLength(0);
  fireEvent.change(search,{target:{value:''}});
  expect(within(table).getAllByRole('link')).toHaveLength(60);
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('V150');
});
