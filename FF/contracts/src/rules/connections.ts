// 외부 연결 상태(출시 준비 RD-UX-04) — 아직 모의인 연계(메일·과금·OTA·Data Lake)를 화면이 "실제처럼" 보이지 않게 한다.
// 백엔드 GET /api/system/connections(backend/src/kernel/connections.ts)가 설치 설정에서 상태를 계산하고, 화면은 live가 아닌 연결에 표시를 붙인다.
// 형식만 둔다 — 첫 화면 묶음에 실행 코드를 더하지 않게(contracts는 프론트 첫 화면에 통째로 들어간다).

export type ConnectionKey = 'mail' | 'billing' | 'ota' | 'datalake';

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
