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

/** One EventSource per document; subscriber cleanup never closes another screen's connection. */
export function subscribePlatformStream(subscriber: Subscriber): () => void {
  if (STATIC_MODE || typeof EventSource === 'undefined') { subscriber.state('static'); return () => {}; }
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
