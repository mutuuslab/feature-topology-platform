// 외부 연결 상태(출시 준비 RD-UX-04) — 설치 설정 → 연결별 live·mock·off. 형식은 @ff/contracts ConnectionStatus.
// 실제 어댑터가 생기면 그 연결의 liveAdapter를 true로 바꾸고 설정(FF_CONN_<KEY>=live)으로 켠다 — 그때 화면 표시가 사라진다.
import type { ConnectionKey, ConnectionMode, ConnectionStatus } from '@ff/contracts';
import { otaConfigured } from './ota-config';
import { lakeMode } from '../adapters/lake/lake-reader';

/** 표시 방식(80-50 D-ALM-17) — 운영은 항상 labeled. 데모는 기본 seamless, FF_DEMO_LABELS=on이면 labeled */
export function connectionPresentation(production: boolean, env: Record<string, string | undefined> = process.env): 'seamless' | 'labeled' {
  if (production) return 'labeled';
  return env.FF_DEMO_LABELS === 'on' ? 'labeled' : 'seamless';
}

export const CONNECTION_KEYS: readonly ConnectionKey[] = ['billing', 'ota', 'datalake'];

/** 연결 정의 — 기본 모드와 실제 어댑터 유무. OTA(IF-05)만 실제 어댑터가 있다(adapters/ota, 80-45). 알림은 화면 알림만 — 메일 연결 없음(D-RD-7) */
export const CONNECTIONS: Record<ConnectionKey, { ifId: string | null; liveAdapter: boolean; defaultMode: ConnectionMode }> = {
  // 체험 → 구독·구매 결제 — 모의 과금 시스템(if_call BILLING)
  billing: { ifId: null, liveAdapter: false, defaultMode: 'mock' },
  // 배포 캠페인 요청(CCS / OTA) — IF-05. OTA 서버 설정(FF_OTA_URL, 채널 ota)이 있으면 실제 연결, 없으면 모의
  ota: { ifId: 'IF-05', liveAdapter: true, defaultMode: 'mock' },
  // 차량 데이터 Data Lake — IF-15(80-70·80-75). 데모는 모의 Lake(adapters/lake), 운영은 실제 어댑터(TL-X01)가 생기기 전까지 연결 없음
  datalake: { ifId: 'IF-15', liveAdapter: false, defaultMode: 'mock' },
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
    // Data Lake는 조회 어댑터와 같은 규칙(IF_MODE_15·운영 기본 off) — 화면 표시와 실제 조회가 어긋나지 않게
    if (key === 'datalake') mode = lakeMode(env);
    if (mode === 'live' && !def.liveAdapter) mode = def.defaultMode;
    return { key, mode, ifId: def.ifId, liveAdapter: def.liveAdapter };
  });
}
