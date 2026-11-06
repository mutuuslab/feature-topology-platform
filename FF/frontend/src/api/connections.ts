// 외부 연결 상태 조회(출시 준비 RD-UX-04) — 화면은 이 표시로 모의 연계를 실제처럼 보이지 않게 한다.
// 상태를 아직 못 읽었거나 읽지 못하면 '모의'로 본다(실제처럼 보이는 쪽으로 틀리지 않게).
// 데모 설치의 표시 방식이 seamless(80-50 D-ALM-17, 기본)면 모의 연계도 표시 없이 실제 연결처럼 보인다 — 운영 설치는 항상 표시한다.
import type { ConnectionKey, ConnectionMode, ConnectionsResponse } from '@ff/contracts';
import { STATIC_MODE } from './client';
import { useApi } from './hooks';

/**
 * 화면 표시 — none(실제 연결, 표시 없음)·mock(설치 모드를 아직 모름 '모의(연결 전)')·disconnected(운영 설치·꺼짐 '연결 안 됨').
 * 데모 설치(정적 공개본 포함)의 모의 연계는 색·배지·문구로 드러내지 않는다(사용자 결정 D-ALM-17, 2026-11-05) — 운영 설치는 그대로 '연결 안 됨'.
 */
export type ConnectionLabel = 'none' | 'mock' | 'disconnected';

export function connectionLabel(
  status: { mode: ConnectionMode } | null | undefined,
  installMode: ConnectionsResponse['mode'] | null | undefined,
  presentation?: ConnectionsResponse['presentation'] | null,
): ConnectionLabel {
  if (status?.mode === 'live') return 'none';
  if (installMode === 'demo' && presentation === 'seamless') return 'none';
  if (status?.mode === 'off' || installMode === 'production') return 'disconnected';
  // 데모 설치는 모의 표시 없음이 기본(D-ALM-17) — 서버가 'labeled'(FF_DEMO_LABELS=on)일 때만 드러낸다. 공개 정적 사이트도 표시 없음
  if ((installMode === 'demo' && presentation !== 'labeled') || STATIC_MODE) return 'none';
  return 'mock';
}

export function useConnections() {
  return useApi<ConnectionsResponse>('systemConnections', {}, { staleTime: 5 * 60_000, retry: false });
}

/** 연결 하나의 화면 표시 */
export function useConnectionLabel(key: ConnectionKey): ConnectionLabel {
  const q = useConnections();
  return connectionLabel(q.data?.items.find((i) => i.key === key), q.data?.mode, q.data?.presentation);
}

/** 데모 설치에서 모의 표시를 숨기는가(seamless) — 서버 응답을 읽기 전·운영 설치는 false(표시한다) */
export function useSeamless(): boolean {
  return isSeamless(useConnections().data);
}

/** 응답만으로 판정(앱 셸 밖 — 외부 도구 창) */
export const isSeamless = (d: ConnectionsResponse | null | undefined) => d?.mode === 'demo' && d.presentation === 'seamless';

/** 연계 방식 표시 — seamless면 모의(mock)를 실제 연결(live)로 보인다. 꺼짐·내장 등 다른 값은 그대로 */
export const shownMode = (mode: string, seamless: boolean) => (seamless && mode === 'mock' ? 'live' : mode);
