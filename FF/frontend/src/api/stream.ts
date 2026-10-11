// Platform 이벤트 스트림(SSE /api/events/stream) 구독 — 관심 있는 이벤트가 오면 관련 조회를 새로 고치고 최근 목록을 돌려준다.
// 정적 데모(읽기 전용)와 EventSource 없는 환경(테스트)에서는 아무것도 하지 않는다.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

export function usePlatformEvents(prefixes: string[], invalidate: string[], keep = 100): PlatformEvent[] {
  const qc = useQueryClient();
  const [items, setItems] = useState<PlatformEvent[]>([]);
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
  return items;
}
