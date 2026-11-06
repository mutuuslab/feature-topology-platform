import { STATIC_MODE } from './client';

export interface PlatformEvent {
  seq: number;
  id: string;
  type: string;
  at: string;
  aggregate: string;
  componentId: string | null;
  payload: Record<string, unknown>;
}
export type PlatformStreamState = 'static' | 'connecting' | 'open' | 'error' | 'paused';
interface Subscriber {
  event: (event: PlatformEvent) => void;
  state: (state: PlatformStreamState) => void;
  refresh: () => void;
}

export function isPlatformEvent(value: unknown): value is PlatformEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as PlatformEvent;
  return Number.isSafeInteger(e.seq) && e.seq > 0 && typeof e.id === 'string' && typeof e.type === 'string'
    && typeof e.at === 'string' && typeof e.aggregate === 'string' && (e.componentId === null || typeof e.componentId === 'string')
    && !!e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload);
}

const subscribers = new Set<Subscriber>();
let source: EventSource | null = null;
let state: PlatformStreamState = 'connecting';
export const platformStreamState = (): PlatformStreamState => STATIC_MODE || typeof EventSource === 'undefined' ? 'static' : document.hidden ? 'paused' : state;
const notify = (next: PlatformStreamState) => { state = next; for (const subscriber of subscribers) subscriber.state(next); };
function close() {
  const previous = source;
  source = null;
  previous?.close();
}
function connect() {
  if (!subscribers.size || source) return;
  if (document.hidden) { notify('paused'); return; }
  notify('connecting');
  try {
    const current = new EventSource('/api/events/stream');
    source = current;
    current.onopen = () => {
      if (source !== current) return;
      notify('open');
      // Reopening also covers EventSource's native network retry. Recent history is the server's source of truth.
      for (const subscriber of subscribers) subscriber.refresh();
    };
    current.onerror = () => { if (source === current) notify('error'); };
    current.addEventListener('platform', (message) => {
      if (source !== current || document.hidden) return;
      let event: unknown;
      try { event = JSON.parse((message as MessageEvent).data); } catch { return; }
      if (isPlatformEvent(event)) for (const subscriber of subscribers) subscriber.event(event);
    });
  } catch { notify('error'); }
}
function visibility() {
  if (document.hidden) { close(); notify('paused'); }
  else {
    // Refresh even if the streaming connection itself is unavailable.
    for (const subscriber of subscribers) subscriber.refresh();
    connect();
  }
}

// 정적 공개 사이트 — 서버 대신 이 브라우저의 시연 데이터(api/sim)가 같은 버스로 이벤트를 흘린다(SSE처럼 화면이 새로 읽는다)
const local = new Set<Subscriber>();
export function publishLocalEvents(events: PlatformEvent[]) {
  for (const e of events) for (const subscriber of [...local, ...subscribers]) subscriber.event(e);
}
/** 시연 데이터를 처음 상태로 되돌린 뒤 — 구독 화면이 다시 읽게 */
export function refreshLocalSubscribers() {
  for (const subscriber of [...local, ...subscribers]) subscriber.refresh();
  localChanged?.();
}
/** 시연 데이터가 바뀌었을 때(쓰기·차량 회신) — 앱이 조회 캐시를 무효화한다(main.tsx) */
let localChanged: (() => void) | null = null;
export const onLocalDataChange = (fn: () => void) => void (localChanged = fn);
export const localDataChanged = () => localChanged?.();

/** One EventSource per document; subscriber cleanup never closes another screen's connection. */
export function subscribePlatformStream(subscriber: Subscriber): () => void {
  if (STATIC_MODE || typeof EventSource === 'undefined') {
    local.add(subscriber);
    subscriber.state('static');
    return () => void local.delete(subscriber);
  }
  subscribers.add(subscriber);
  subscriber.state(platformStreamState());
  if (subscribers.size === 1) document.addEventListener('visibilitychange', visibility);
  connect();
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) {
      close();
      state = 'connecting';
      document.removeEventListener('visibilitychange', visibility);
    }
  };
}
