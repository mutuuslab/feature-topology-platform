// Platform 이벤트 스트림(SSE /api/events/stream) 구독 — 관심 있는 이벤트가 오면 관련 조회를 새로 고치고 최근 목록을 돌려준다.
// 최근 이력부터 보인 뒤 SSE를 이어 붙인다. 정적 데모·EventSource 없는 환경도 이력은 읽는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from './client';
import { isPlatformEvent, platformStreamState, subscribePlatformStream, type PlatformEvent } from './shared-event-source';
export type { PlatformEvent } from './shared-event-source';

export function usePlatformEvents(prefixes: string[], invalidate: string[], keep = 100): PlatformEvent[] {
  const { items } = usePlatformLiveEvents(prefixes, invalidate, keep);
  const history = useQuery<{ items: PlatformEvent[] }>({
    queryKey: ['events', {}, { limit: 500, recent: '1' }],
    queryFn: ({ signal }) => call('events', { query: { limit: 500, recent: '1' }, signal }),
    staleTime: 30_000,
    retry: false,
  });
  const prefixKey = prefixes.join('\0');
  return useMemo(() => {
    const past = Array.isArray(history.data?.items) ? history.data.items.filter(isPlatformEvent) : [];
    const merged = new Map<number, PlatformEvent>();
    for (const e of [...past, ...items]) if (prefixes.some((p) => e.type.startsWith(p))) merged.set(e.seq, e);
    return [...merged.values()].sort((a, b) => a.seq - b.seq).slice(-keep);
  }, [history.data, items, prefixKey, keep]);
}

export function usePlatformLiveEvents(prefixes: string[], invalidate: string[], keep = 100) {
  const qc = useQueryClient();
  const [items, setItems] = useState<PlatformEvent[]>([]);
  const [status, setStatus] = useState(platformStreamState);
  const cfg = useRef({ prefixes, invalidate, keep });
  cfg.current = { prefixes, invalidate, keep };
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      for (const k of new Set(['events', ...cfg.current.invalidate])) void qc.invalidateQueries({ queryKey: [k] }, { cancelRefetch: false });
    };
    const unsubscribe = subscribePlatformStream({
      state: (value) => {
        setStatus(value);
        if (value === 'paused' && pending) { clearTimeout(pending); pending = null; }
      },
      refresh,
      event: (e) => {
        if (!cfg.current.prefixes.some((p) => e.type.startsWith(p))) return;
        setItems((xs) => [...new Map([...xs, e].map((item) => [item.seq, item])).values()].sort((a, b) => a.seq - b.seq).slice(-cfg.current.keep));
        if (!pending) pending = setTimeout(() => { pending = null; refresh(); }, 150);
      },
    });
    return () => {
      if (pending) clearTimeout(pending);
      unsubscribe();
    };
  }, [qc]);
  return { items, status };
}
