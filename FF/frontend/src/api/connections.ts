// 외부 연결 상태 조회(출시 준비 RD-UX-04) — 화면은 이 표시로 모의 연계를 실제처럼 보이지 않게 한다.
// 상태를 아직 못 읽었거나 읽지 못하면 '모의'로 본다(실제처럼 보이는 쪽으로 틀리지 않게).
import type { ConnectionKey, ConnectionMode, ConnectionsResponse } from '@ff/contracts';
import { useApi } from './hooks';

/** 화면 표시 — none(실제 연결, 표시 없음)·mock(데모 설치 '모의(연결 전)')·disconnected(운영 설치·꺼짐 '연결 안 됨') */
export type ConnectionLabel = 'none' | 'mock' | 'disconnected';

export function connectionLabel(status: { mode: ConnectionMode } | null | undefined, installMode: ConnectionsResponse['mode'] | null | undefined): ConnectionLabel {
  if (status?.mode === 'live') return 'none';
  if (status?.mode === 'off' || installMode === 'production') return 'disconnected';
  return 'mock';
}

export function useConnections() {
  return useApi<ConnectionsResponse>('systemConnections', {}, { staleTime: 5 * 60_000, retry: false });
}

/** 연결 하나의 화면 표시 */
export function useConnectionLabel(key: ConnectionKey): ConnectionLabel {
  const q = useConnections();
  return connectionLabel(q.data?.items.find((i) => i.key === key), q.data?.mode);
}
