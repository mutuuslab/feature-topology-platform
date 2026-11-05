// 화면을 열기 전 이벤트와 구독 뒤 이벤트가 한 이력으로 이어진다 — 늦은 이력 응답이 실시간 행을 지우지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { EventsScreen } from '../screens/governance/AuditEvents';
import { usePlatformEvents, usePlatformLiveEvents, type PlatformEvent } from '../api/stream';

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../api/client', () => ({ STATIC_MODE: false, call: api.call, isPersonal: () => false }));

class Stream {
  static last: Stream;
  static instances: Stream[] = [];
  platform?: (event: MessageEvent) => void;
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() { Stream.last = this; Stream.instances.push(this); }
  addEventListener(_type: string, fn: (event: MessageEvent) => void) { this.platform = fn; }
  emit(value: PlatformEvent) { this.platform?.({ data: JSON.stringify(value) } as MessageEvent); }
}

const event = (seq: number, type = 'publication.closed'): PlatformEvent => ({ seq, id: `EV-${seq}`, type, at: '2026-11-05T00:00:00Z', aggregate: `PUB-${seq}`, componentId: 'D06-08', payload: {} });
const mount = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), prefixes = ['publication.'], invalidate: string[] = []) => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => usePlatformEvents(prefixes, invalidate), { wrapper });
};

let hidden = false;
beforeEach(() => {
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  Stream.instances = [];
  api.call.mockReset();
  vi.stubGlobal('EventSource', Stream);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Platform 이벤트 이력과 구독', () => {
  it('알림 구독과 실제 이벤트 화면도 한 연결과 최근 이력 조회를 공유한다', async () => {
    api.call.mockResolvedValue({ items: [event(1)] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function WithNotification() { usePlatformEvents(['publication.'], ['notifications']); return <EventsScreen />; }
    render(<QueryClientProvider client={client}><MemoryRouter><AppProvider><WithNotification /></AppProvider></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('table', { name: 'Platform 이벤트' });
    expect(Stream.instances).toHaveLength(1);
    expect(api.call).toHaveBeenCalledTimes(1);
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByText('SSE · 탭 숨김')).toBeTruthy();
  });

  it('동시 구독은 한 연결을 공유하고, 하나 해제해도 유지하다 마지막 해제에서 닫는다', async () => {
    api.call.mockResolvedValue({ items: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const a = mount(client), b = mount(client, ['vehicle.']);
    expect(Stream.instances).toHaveLength(1);
    const stream = Stream.last;
    a.unmount();
    expect(stream.close).not.toHaveBeenCalled();
    act(() => stream.emit(event(2, 'vehicle.readback')));
    await waitFor(() => expect(b.result.current.map((e) => e.seq)).toEqual([2]));
    b.unmount();
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it('숨김은 연결을 닫고 복귀는 한 연결과 최근500 이력·관련 조회를 갱신한다', async () => {
    let history = [event(1)];
    api.call.mockImplementation(() => Promise.resolve({ items: history }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const a = mount(client, ['publication.'], ['publications']);
    const b = mount(client, ['publication.'], ['featureFlags']);
    await waitFor(() => expect(a.result.current.map((e) => e.seq)).toEqual([1]));
    const old = Stream.last;
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    expect(old.close).toHaveBeenCalledOnce();
    history = [event(1), event(2), event(3)];
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    expect(Stream.instances).toHaveLength(2);
    act(() => Stream.last.onopen?.());
    await waitFor(() => expect(a.result.current.map((e) => e.seq)).toEqual([1, 2, 3]));
    expect(b.result.current.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(invalidate.mock.calls.map(([arg]) => arg.queryKey)).toEqual(expect.arrayContaining([['events'], ['publications'], ['featureFlags']]));
    expect(api.call.mock.calls.every(([name, opts]) => name === 'events' && opts.query.limit === 500 && opts.query.recent === '1')).toBe(true);
    act(() => old.emit(event(99)));
    expect(a.result.current.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('처음부터 숨겨진 문서는 연결을 열지 않고 복귀 때 연결하며 상태를 알린다', () => {
    hidden = true;
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => usePlatformLiveEvents([''], []), { wrapper });
    expect(Stream.instances).toHaveLength(0);
    expect(result.current.status).toBe('paused');
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    expect(Stream.instances).toHaveLength(1);
    act(() => Stream.last.onopen?.());
    expect(result.current.status).toBe('open');
    unmount();
    expect(Stream.last.close).toHaveBeenCalledOnce();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(Stream.instances).toHaveLength(1);
  });

  it('깨진 JSON·이벤트 형식은 콜백 밖으로 던지지 않고 다음 정상 이벤트를 받는다', async () => {
    api.call.mockResolvedValue({ items: [event(1), { seq: 9, type: 42 }] });
    const { result } = mount();
    await waitFor(() => expect(result.current.map((e) => e.seq)).toEqual([1]));
    for (const data of ['{broken', 'null', JSON.stringify({ ...event(2), type: 42 }), JSON.stringify({ ...event(2), seq: '2' })]) {
      expect(() => act(() => Stream.last.platform?.({ data } as MessageEvent))).not.toThrow();
    }
    act(() => Stream.last.emit(event(2)));
    expect(result.current.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('네트워크 재연결도 같은 연결 객체로 이력과 관련 조회를 갱신한다', async () => {
    let history = [event(1)];
    api.call.mockImplementation(() => Promise.resolve({ items: history }));
    const { result } = mount();
    await waitFor(() => expect(result.current.map((e) => e.seq)).toEqual([1]));
    act(() => Stream.last.onerror?.());
    history = [event(1), event(2)];
    act(() => Stream.last.onopen?.());
    await waitFor(() => expect(result.current.map((e) => e.seq)).toEqual([1, 2]));
    expect(Stream.instances).toHaveLength(1);
  });

  it('첫 화면부터 관심 있는 최근 이력을 시간 순서로 보인다', async () => {
    api.call.mockResolvedValue({ items: [event(3), event(2, 'audit.recorded'), event(1)] });
    const { result } = mount();
    await waitFor(() => expect(result.current.map((e) => e.seq)).toEqual([1, 3]));
    expect(api.call).toHaveBeenCalledWith('events', expect.objectContaining({ query: { limit: 500, recent: '1' } }));
  });

  it('이력보다 실시간 이벤트가 먼저 와도 남고, 중복 seq는 한 행이다', async () => {
    let finish!: (value: { items: PlatformEvent[] }) => void;
    api.call.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = mount();
    act(() => Stream.last.emit(event(2)));
    await waitFor(() => expect(result.current.map((e) => e.seq)).toEqual([2]));
    act(() => finish({ items: [event(2), event(1)] }));
    await waitFor(() => expect(result.current.map((e) => e.seq)).toEqual([1, 2]));
  });

  it('화면을 닫으면 진행 중 조회와 SSE를 모두 취소한다', async () => {
    let signal!: AbortSignal;
    api.call.mockImplementation((_name, opts) => { signal = opts.signal; return new Promise(() => {}); });
    const { unmount } = mount();
    await waitFor(() => expect(signal).toBeDefined());
    const stream = Stream.last;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it('실시간 구독이 없는 환경도 저장된 이력은 보인다', async () => {
    vi.stubGlobal('EventSource', undefined);
    api.call.mockResolvedValue({ items: [event(1)] });
    const { result } = mount();
    await waitFor(() => expect(result.current).toEqual([event(1)]));
  });
});
