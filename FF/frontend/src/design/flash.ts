// 값이 바뀌었다는 신호 — 한 번만 짧게 깜빡인다(모션 체계 v1: 장식 대신 상태 변화에만).
// 첫 렌더에는 절대 움직이지 않는다 — 화면을 연 순간 읽는 3초를 빼앗지 않는다.
// 표식(data-changed)은 'a'↔'b'로 번갈아 바뀐다. CSS 키프레임 이름이 바뀌어야 같은 요소에서 한 번 재생이 다시 시작되기 때문이다.
// 모양·시간은 design.css [data-changed] 한 곳(calc(var(--t-slow) * 2), 움직임 줄이기·실시간 모션 끔이면 재생하지 않음).
import { useState } from 'react';

export type FlashMark = 'a' | 'b';
type Primitive = string | number | boolean | null | undefined;

/**
 * 값이 바뀌면 깜빡임 표식을 돌려준다 — 요소에 `data-changed={mark}`로 단다.
 * skip(prev, next)가 참이면 그 변화는 첫 등장으로 보고 표식을 만들지 않는다(불러오는 중 → 첫 값 등).
 */
export function useChangeFlash(value: Primitive, skip?: (prev: Primitive, next: Primitive) => boolean): FlashMark | undefined {
  const [prev, setPrev] = useState<Primitive>(value);
  const [n, setN] = useState(0);
  // 렌더 중 상태 조정(React 권장 패턴) — 효과를 기다리지 않아 바뀐 값과 표식이 같은 그림에 나온다
  if (!Object.is(prev, value)) {
    setPrev(value);
    if (!skip?.(prev, value)) setN(n + 1);
  }
  return n === 0 ? undefined : n % 2 ? 'a' : 'b';
}
