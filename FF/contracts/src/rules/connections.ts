// 외부 연결 상태(출시 준비 RD-UX-04) — 아직 모의인 연계(메일·과금·OTA·Data Lake)를 화면이 "실제처럼" 보이지 않게 한다.
// 백엔드 GET /api/system/connections가 설치 설정에서 상태를 계산하고, 화면은 live가 아닌 연결에 표시를 붙인다.
// 실제 어댑터가 생기면 그 연결의 liveAdapter를 true로 바꾸고 설정(FF_CONN_<KEY>=live)으로 켠다 — 그때 표시가 사라진다.

export const CONNECTION_KEYS = ['mail', 'billing', 'ota', 'datalake'] as const;
export type ConnectionKey = (typeof CONNECTION_KEYS)[number];

/** live: 실제 시스템에 연결 · mock: 모의 응답(결과가 실제가 아님) · off: 연결 없음(호출하면 거부) */
export type ConnectionMode = 'live' | 'mock' | 'off';

export interface ConnectionStatus {
  key: ConnectionKey;
  mode: ConnectionMode;
  /** 관련 외부 연계 인터페이스(manifest IF) — 없으면 null */
  ifId: string | null;
  /** 실제 어댑터가 구현돼 있는가 — false면 설정으로 live를 골라도 live가 되지 않는다 */
  liveAdapter: boolean;
}

export interface ConnectionsResponse {
  /** 설치 모드 — production이면 화면은 모의 연결을 '연결 안 됨'으로 보인다 */
  mode: 'production' | 'demo';
  items: ConnectionStatus[];
}

/** 연결 정의 — 기본 모드와 실제 어댑터 유무. 지금은 모두 실제 어댑터가 없다 */
export const CONNECTIONS: Record<ConnectionKey, { ifId: string | null; liveAdapter: boolean; defaultMode: ConnectionMode }> = {
  // 알림 메일 — 발송 기록만 남긴다(메일 서버 연결 없음)
  mail: { ifId: null, liveAdapter: false, defaultMode: 'mock' },
  // 체험 → 구독·구매 결제 — 모의 과금 시스템(if_call BILLING)
  billing: { ifId: null, liveAdapter: false, defaultMode: 'mock' },
  // 배포 캠페인 요청(CCS / OTA) — IF-05 모의
  ota: { ifId: 'IF-05', liveAdapter: false, defaultMode: 'mock' },
  // 차량 데이터 적재(Data Lake) — 설계만, 연결 없음
  datalake: { ifId: null, liveAdapter: false, defaultMode: 'off' },
};

/**
 * 설정 → 연결 상태. 환경 값: FF_CONN_<KEY>=live|mock|off (OTA는 IF_MODE_05=off도 따른다).
 * live는 실제 어댑터가 있을 때만 — 없으면 mock으로 내려간다(모의를 실제처럼 보이지 않게).
 */
export function connectionStatuses(env: Record<string, string | undefined>): ConnectionStatus[] {
  return CONNECTION_KEYS.map((key) => {
    const def = CONNECTIONS[key];
    const raw = env[`FF_CONN_${key.toUpperCase()}`];
    let mode: ConnectionMode = raw === 'live' || raw === 'mock' || raw === 'off' ? raw : def.defaultMode;
    if (key === 'ota' && env.IF_MODE_05 === 'off') mode = 'off';
    if (mode === 'live' && !def.liveAdapter) mode = def.defaultMode === 'off' ? 'off' : 'mock';
    return { key, mode, ifId: def.ifId, liveAdapter: def.liveAdapter };
  });
}

/** 화면 표시 — live면 표시 없음, 아니면 데모는 '모의(연결 전)', 운영은 '연결 안 됨' */
export type ConnectionLabel = 'none' | 'mock' | 'disconnected';
export function connectionLabel(status: Pick<ConnectionStatus, 'mode'> | null | undefined, installMode: 'production' | 'demo' | null | undefined): ConnectionLabel {
  if (status?.mode === 'live') return 'none';
  if (status?.mode === 'off' || installMode === 'production') return 'disconnected';
  return 'mock';
}
