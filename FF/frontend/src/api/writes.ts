// 성공한 쓰기 알림 — 따라하기 판정이 "이 단계에서 실제로 조작했는가"를 본다(앞서 남은 상태로 미리 통과하지 않게, contracts StepCheck.write).
// 쓰기 경로가 하나(api/client.ts call)라 성공한 쓰기는 모두 여기로 온다. 정적 데모는 쓰기를 받지 않아 알림이 없다 — 직접 하기를 열지 않는다(Learn.tsx).
type Listener = (name: string) => void;
const listeners = new Set<Listener>();

/** 쓰기 성공을 구독한다 — 해제 함수를 돌려준다 */
export function onWrite(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 쓰기가 성공했다(API 이름) */
export function notifyWrite(name: string) {
  for (const l of listeners) l(name);
}
