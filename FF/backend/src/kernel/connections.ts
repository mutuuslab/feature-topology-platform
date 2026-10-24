// 외부 연결 상태(출시 준비 RD-UX-04) — 설치 설정 → 연결별 live·mock·off. 형식은 @ff/contracts ConnectionStatus.
// 실제 어댑터가 생기면 그 연결의 liveAdapter를 true로 바꾸고 설정(FF_CONN_<KEY>=live)으로 켠다 — 그때 화면 표시가 사라진다.
import type { ConnectionKey, ConnectionMode, ConnectionStatus } from '@ff/contracts';
import { otaConfigured } from './ota-config';

export const CONNECTION_KEYS: readonly ConnectionKey[] = ['mail', 'billing', 'ota', 'datalake'];

/** 연결 정의 — 기본 모드와 실제 어댑터 유무. OTA(IF-05)만 실제 어댑터가 있다(adapters/ota, 80-45) */
export const CONNECTIONS: Record<ConnectionKey, { ifId: string | null; liveAdapter: boolean; defaultMode: ConnectionMode }> = {
  // 알림 메일 — 발송 기록만 남긴다(메일 서버 연결 없음)
  mail: { ifId: null, liveAdapter: false, defaultMode: 'mock' },
  // 체험 → 구독·구매 결제 — 모의 과금 시스템(if_call BILLING)
  billing: { ifId: null, liveAdapter: false, defaultMode: 'mock' },
  // 배포 캠페인 요청(CCS / OTA) — IF-05. OTA 서버 설정(FF_OTA_URL, 채널 ota)이 있으면 실제 연결, 없으면 모의
  ota: { ifId: 'IF-05', liveAdapter: true, defaultMode: 'mock' },
  // 차량 데이터 적재(Data Lake) — 설계만, 연결 없음
  datalake: { ifId: null, liveAdapter: false, defaultMode: 'off' },
};

/**
 * 설정 → 연결 상태. 환경 값: FF_CONN_<KEY>=live|mock|off (OTA는 FF_OTA_URL 설정이 live를 정하고, IF_MODE_05=off도 따른다).
 * live는 실제 어댑터가 있을 때만 — 없으면 기본 모드로 내려간다(모의를 실제처럼 보이지 않게).
 */
export function connectionStatuses(env: Record<string, string | undefined> = process.env): ConnectionStatus[] {
  return CONNECTION_KEYS.map((key) => {
    const def = CONNECTIONS[key];
    const raw = env[`FF_CONN_${key.toUpperCase()}`];
    let mode: ConnectionMode = raw === 'live' || raw === 'mock' || raw === 'off' ? raw : def.defaultMode;
    if (key === 'ota') {
      // OTA는 설정이 정한다 — 설정이 있으면 실제 호출이므로 FF_CONN_OTA로 모의라고 표시하지 않는다. 설정 없이 live를 골라도 모의
      if (otaConfigured(env)) mode = 'live';
      else if (mode === 'live') mode = def.defaultMode;
      if (env.IF_MODE_05 === 'off') mode = 'off';
    }
    if (mode === 'live' && !def.liveAdapter) mode = def.defaultMode;
    return { key, mode, ifId: def.ifId, liveAdapter: def.liveAdapter };
  });
}
