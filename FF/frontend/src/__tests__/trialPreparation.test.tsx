import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';

const preparation = vi.hoisted(() => ({ static: true, load: vi.fn() }));
vi.mock('../api/client', async (original) => ({
  ...await original<typeof import('../api/client')>(),
  get STATIC_MODE() { return preparation.static; },
  loadSim: () => preparation.load(),
}));
import { EntitlementsScreen } from '../screens/policy/Entitlements';

const requests: { url: string; method: string }[] = [];
let rejectOffer = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'commerce' }));
  requests.length = 0;
  rejectOffer = false;
  preparation.static = true;
  preparation.load.mockReset().mockResolvedValue({ simReady: async () => undefined });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ url, method });
    if (method === 'POST') return rejectOffer
      ? json({ error: { code: 'FORBIDDEN', message: '체험 제안 권한이 없습니다.' } }, 403)
      : json({ offered: [{ grantId: 'ENT-TEST', vin: 'KMH-NX4-0001', status: 'OFFERED' }], skipped: [] }, 201);
    if (url === '/api/products') return json({ items: [{ catalogId: 'CAT-00019', version: '1.0.0', name: '체험 상품', lifecycle: 'RELEASED', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }] });
    if (url.startsWith('/api/vehicles')) return json({ items: [{ vin: 'KMH-NX4-0001', label: '고객 차량', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }] });
    if (url.startsWith('/api/trials')) return json({ items: [], today: '2026-11-10', total: 0, page: 1, pageSize: 50, byState: {} });
    return json({ items: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/entitlements?catalog=CAT-00019']}><AppProvider><EntitlementsScreen /></AppProvider></MemoryRouter></QueryClientProvider>);
}
async function submit() {
  const panel = await screen.findByRole('region', { name: '체험 제안' });
  fireEvent.click(await within(panel).findByRole('checkbox', { name: 'KMH-NX4-0001 · 고객 차량' }));
  fireEvent.click(within(panel).getByRole('button', { name: '제안 보내기' }));
  return panel;
}
describe('체험 제안 실행 준비', () => {
  it('실제 모듈 준비가 끝나기 전 제출을 노출하지 않고 준비 뒤 실제 명령 결과를 표시한다', async () => {
    const ready = deferred();
    preparation.load.mockResolvedValue({ simReady: () => ready.promise });
    mount();
    const panel = await screen.findByRole('region', { name: '체험 제안' });
    await waitFor(() => expect(preparation.load).toHaveBeenCalledOnce());
    await waitFor(() => expect(requests.some((r) => r.url.startsWith('/api/vehicles'))).toBe(true));
    expect(within(panel).getByRole('progressbar')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: '제안 보내기' })).toBeNull();
    expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
    await act(async () => ready.resolve());
    await submit();
    await waitFor(() => expect(within(panel).getByRole('status').textContent).toContain('1대에 제안'));
    expect(requests.filter((r) => r.method === 'POST')).toEqual([{ url: '/api/trials/offers', method: 'POST' }]);
  });
  it('준비 실패를 오류와 다시 시도로 표시하고 명령 성공을 만들지 않는다', async () => {
    preparation.load.mockResolvedValue({ simReady: async () => { throw new Error('module unavailable'); } });
    mount();
    const panel = await screen.findByRole('region', { name: '체험 제안' });
    expect(await within(panel).findByRole('alert')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: '다시 시도' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: '제안 보내기' })).toBeNull();
    expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
  });
  it('모듈 준비 성공은 실제 서버의 권한 거부를 대신하지 않는다', async () => {
    rejectOffer = true;
    mount();
    const panel = await submit();
    expect((await within(panel).findByRole('alert')).textContent).toContain('권한');
    expect(within(panel).queryByRole('status')).toBeNull();
  });
  it('native API에서는 시연 핸들러를 준비하지 않고 차량 조회 후 실행한다', async () => {
    preparation.static = false;
    mount();
    const panel = await submit();
    await waitFor(() => expect(within(panel).getByRole('status').textContent).toContain('1대에 제안'));
    expect(preparation.load).not.toHaveBeenCalled();
  });
});
