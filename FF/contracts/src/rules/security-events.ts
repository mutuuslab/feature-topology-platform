// 보안 이벤트 정의와 모니터링 (보고서 v1.1 14.4 · FFG-SEC-007) — 차량 Guard·플랫폼이 낸 결과 코드를 IdsM 이벤트로 묶고 임계값을 넘으면
// SECURITY_MONITORING 범주로 VSOC에 보낸다. 진위 실패가 임계값을 넘으면 그 차량의 채널 처리를 제한한다. 포렌식 값(보고 해시·kid·key epoch·
// 시간 품질·결과 코드)을 보존하고 개인정보는 넣지 않는다(VIN은 가명으로). 임계값은 보고서 표의 예시값이다.

export type SecurityEventId = 'AUTH_FAILURE' | 'REPLAY_SEQUENCE' | 'APPROVAL_VIOLATION' | 'UNTRUSTED_TIME_KILL' | 'E2E_REPEAT' | 'STATE_PROOF_FAILURE';

export interface SecurityEventDef {
  id: SecurityEventId;
  label: string;
  /** 이 이벤트로 셀 원천 결과 코드 */
  codes: string[];
  /** 같은 차량에서 windowMs 안에 count건이면 경보 — fleetRatio면 Fleet 비율 */
  threshold: { count: number; windowMs: number; perVehicle: boolean; fleetRatio?: number };
  response: string;
  /** 넘으면 그 차량의 채널 처리를 제한 */
  limitChannel: boolean;
}

const MIN = 60_000;
export const SECURITY_EVENTS: SecurityEventDef[] = [
  { id: 'AUTH_FAILURE', label: '진위 실패', codes: ['AUTH_FAILED', 'TARGET_MISMATCH', 'SIGNATURE_INVALID', 'REQUEST_AUTH_MISSING', 'REQUEST_AUTH_MALFORMED', 'REQUEST_MAC_INVALID', 'REQUEST_KEY_EPOCH', 'REQUEST_IDENTITY_MISMATCH', 'REQUEST_PROXY_UNTRUSTED'], threshold: { count: 3, windowMs: 10 * MIN, perVehicle: true }, response: 'IdsM 보고, 채널 처리 제한, VSOC 경보', limitChannel: true },
  { id: 'REPLAY_SEQUENCE', label: '재전송·순번 이상', codes: ['REPLAY', 'SEQ_JUMP', 'KEY_EPOCH_OLD', 'SEQ_AHEAD', 'REQUEST_REPLAY', 'REQUEST_TIME_SKEW'], threshold: { count: 1, windowMs: 10 * MIN, perVehicle: true }, response: 'IdsM 보고, 보고 해시 보존', limitChannel: false },
  { id: 'APPROVAL_VIOLATION', label: '승인 위반', codes: ['APPROVALS_INVALID', 'SAME_APPROVER', 'CLASS_MISMATCH', 'DESIGN_CLASS', 'FFG-PLT-005'], threshold: { count: 1, windowMs: 10 * MIN, perVehicle: false }, response: '내부자 오남용 조사(TS-06)', limitChannel: false },
  { id: 'UNTRUSTED_TIME_KILL', label: '신뢰 시간 없는 Kill', codes: ['FF_EV_TIME_UNVERIFIED'], threshold: { count: 1, windowMs: 60 * MIN, perVehicle: false, fleetRatio: 0.01 }, response: '시간 동기 장애 또는 시간 조작 조사(TS-12)', limitChannel: false },
  { id: 'E2E_REPEAT', label: 'E2E 오류 반복', codes: ['E2E_CRC', 'E2E_DATA_ID'], threshold: { count: 10, windowMs: MIN, perVehicle: true }, response: '통신 장애와 공격 구분', limitChannel: false },
  { id: 'STATE_PROOF_FAILURE', label: '상태 증명 실패', codes: ['STATE_AUTH_FAILED', 'REPORT_SEQ_REGRESSION'], threshold: { count: 1, windowMs: 10 * MIN, perVehicle: true }, response: 'TS-07 조사, 적용 확인 보류', limitChannel: false },
];
/** 진위 실패로 채널을 제한하는 시간 */
export const CHANNEL_LIMIT_MS = 30 * MIN;

export const securityEventOf = (code: string): SecurityEventDef | null => SECURITY_EVENTS.find((e) => e.codes.includes(code)) ?? null;

export interface SecurityObservation {
  at: string;
  code: string;
  /** 차량 가명(개인정보 아님) — 플랫폼 이벤트는 null */
  vehicle: string | null;
}

export interface SecurityAlert {
  eventId: SecurityEventId;
  category: 'SECURITY_MONITORING';
  vehicle: string | null;
  count: number;
  threshold: SecurityEventDef['threshold'];
  response: string;
  limitChannel: boolean;
}

/**
 * 새 관측 하나를 넣었을 때 경보가 나는가 — 같은 이벤트·(차량별이면 같은 차량)의 창 안 건수가 임계값에 닿는 순간 한 번.
 * @rule FFG-SEC-007 — 이벤트 정의·임계값·VSOC 경보·진위 실패 채널 제한(플랫폼 쪽). 차량 IdsM 보고 자체와 VSOC 상관 분석 도구는 차량·운영
 */
export function securityAlert(obs: SecurityObservation, history: SecurityObservation[], fleetSize = 0): SecurityAlert | null {
  const def = securityEventOf(obs.code);
  if (!def) return null;
  const t = Date.parse(obs.at);
  const inWindow = [...history, obs].filter((h) => {
    const e = securityEventOf(h.code);
    return e?.id === def.id && (!def.threshold.perVehicle || h.vehicle === obs.vehicle) && t - Date.parse(h.at) < def.threshold.windowMs && Date.parse(h.at) <= t;
  });
  const need = def.threshold.fleetRatio ? Math.max(def.threshold.count, Math.ceil(fleetSize * def.threshold.fleetRatio)) : def.threshold.count;
  if (inWindow.length !== need) return null; // 닿는 순간에만(넘친 뒤 매 건마다 다시 울리지 않는다)
  return { eventId: def.id, category: 'SECURITY_MONITORING', vehicle: def.threshold.perVehicle ? obs.vehicle : null, count: inWindow.length, threshold: def.threshold, response: def.response, limitChannel: def.limitChannel };
}
