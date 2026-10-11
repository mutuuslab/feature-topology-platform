// 긴급 차단 상태 포트 — 긴급 기능 차단(D03-03)의 KillRepo가 이 토큰을 제공한다.
export const KILL_STATE = Symbol('KILL_STATE');
export interface KillState {
  /** 이 차량에서 이 Feature가 차단 중인가 */
  killed(featureId: string, vin: string): boolean;
}
export const NO_KILL: KillState = { killed: () => false };
