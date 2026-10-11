// 긴급 차단 상태 포트 — 긴급 기능 차단(D03-03)이 등록되면 그 저장소가 이 토큰을 대신 제공한다.
export const KILL_STATE = Symbol('KILL_STATE');
export interface KillState {
  killed(featureId: string): boolean;
}
export const NO_KILL: KillState = { killed: () => false };
