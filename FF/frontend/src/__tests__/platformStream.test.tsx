// 화면을 열기 전 이벤트와 구독 뒤 이벤트가 한 이력으로 이어진다 — 늦은 이력 응답이 실시간 행을 지우지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePlatformEvents, type PlatformEvent } from '../api/stream';

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../api/client', () => ({ STATIC_MODE: false, call: api.call }));

class Stream {
  static last: Stream;
  platform?: (event: MessageEvent) => void;
  close = vi.fn();
  constructor() { Stream.last = this; }
  addEventListener(_type: string, fn: (event: MessageEvent) => void) { this.platform = fn; }
  emit(value: PlatformEvent) { this.platform?.({ data: JSON.stringify(value) } as MessageEvent); }
}

const event = (seq: number, type = 'publication.closed'): PlatformEvent => ({ seq, id: `EV-${seq}`, type, at: '2026-11-05T00:00:00Z', aggregate: `PUB-${seq}`, componentId: 'D06-08', payload: {} });
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => usePlatformEvents(['publication.'], []), { wrapper });
};

beforeEach(() => {
  api.call.mockReset();
  vi.stubGlobal('EventSource', Stream);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Platform 이벤트 이력과 구독', () => {
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
