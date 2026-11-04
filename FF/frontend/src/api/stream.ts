// Platform 이벤트 스트림(SSE /api/events/stream) 구독 — 관심 있는 이벤트가 오면 관련 조회를 새로 고치고 최근 목록을 돌려준다.
// 최근 이력부터 보인 뒤 SSE를 이어 붙인다. 정적 데모·EventSource 없는 환경도 이력은 읽는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call, STATIC_MODE } from './client';

export interface PlatformEvent {
  seq: number;
  id: string;
  type: string;
  at: string;
  aggregate: string;
  componentId: string | null;
  payload: Record<string, unknown>;
}

export function usePlatformEvents(prefixes: string[], invalidate: string[], keep = 100): PlatformEvent[] {
  const qc = useQueryClient();
  const [items, setItems] = useState<PlatformEvent[]>([]);
  const history = useQuery<{ items: PlatformEvent[] }>({
    queryKey: ['events', {}, { limit: 500, recent: '1' }],
    queryFn: ({ signal }) => call('events', { query: { limit: 500, recent: '1' }, signal }),
    staleTime: 30_000,
    retry: false,
  });
  const cfg = useRef({ prefixes, invalidate, keep });
  cfg.current = { prefixes, invalidate, keep };
  useEffect(() => {
    if (STATIC_MODE || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events/stream');
    let pending: ReturnType<typeof setTimeout> | null = null;
    es.addEventListener('platform', (m) => {
      const e = JSON.parse((m as MessageEvent).data) as PlatformEvent;
      if (!cfg.current.prefixes.some((p) => e.type.startsWith(p))) return;
      setItems((xs) => [...xs, e].slice(-cfg.current.keep));
      // 회신이 몰려와도 조회는 묶어서 한 번만 새로 고친다
      if (!pending)
        pending = setTimeout(() => {
          pending = null;
          for (const k of cfg.current.invalidate) void qc.invalidateQueries({ queryKey: [k] });
        }, 150);
    });
    return () => {
      if (pending) clearTimeout(pending);
      es.close();
    };
  }, [qc]);
  const prefixKey = prefixes.join('\0');
  return useMemo(() => {
    const past = Array.isArray(history.data?.items) ? history.data.items : [];
    const merged = new Map<number, PlatformEvent>();
    for (const e of [...past, ...items]) if (prefixes.some((p) => e.type?.startsWith(p))) merged.set(e.seq, e);
    return [...merged.values()].sort((a, b) => a.seq - b.seq).slice(-keep);
  }, [history.data, items, prefixKey, keep]);
}
