// 외부 연결 상태 조회(출시 준비 RD-UX-04) — 화면은 이 표시로 모의 연계를 실제처럼 보이지 않게 한다.
// 상태를 아직 못 읽었거나 읽지 못하면 '모의'로 본다(실제처럼 보이는 쪽으로 틀리지 않게).
import { connectionLabel, type ConnectionKey, type ConnectionLabel, type ConnectionsResponse } from '@ff/contracts';
import { useApi } from './hooks';

export function useConnections() {
  return useApi<ConnectionsResponse>('systemConnections', {}, { staleTime: 5 * 60_000, retry: false });
}

/** 연결 하나의 화면 표시 — none(실제 연결)·mock·disconnected */
export function useConnectionLabel(key: ConnectionKey): ConnectionLabel {
  const q = useConnections();
  return connectionLabel(q.data?.items.find((i) => i.key === key), q.data?.mode);
}
