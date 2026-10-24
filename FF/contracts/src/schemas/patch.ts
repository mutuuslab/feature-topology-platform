// 수정(PATCH) 본문 — 모든 필드를 선택으로 바꾸되, 보내지 않은 필드에 기본값을 채우지 않는다.
// zod 4의 .partial()(그리고 .default(…).optional())은 빠진 필드에 안쪽 기본값을 채운다(zod 3은 비워 뒀다).
// 수정 본문에서 그러면 보내지 않은 tags·strategies 같은 값이 기본값([])으로 덮어써진다 — 이 함수로만 수정 본문을 만든다.
import { z } from 'zod';

/** 안쪽 기본값을 떼어 낸 뒤 선택으로 — 빠지면 undefined(기본값 없음) */
export const optionalNoDefault = <T extends z.ZodType>(t: T) => (t instanceof z.ZodDefault ? (t.unwrap() as z.ZodType) : t).optional();

/** obj.partial()과 같은 모양(엄격함 설정 포함)에서 기본값 있는 필드만 기본값 없는 선택 필드로 바꾼다 */
export function patchOf<S extends z.ZodRawShape, C extends z.core.$ZodObjectConfig>(obj: z.ZodObject<S, C>) {
  const partial = obj.partial();
  const undefaulted = Object.fromEntries(Object.entries(obj.shape).filter(([, t]) => t instanceof z.ZodDefault).map(([k, t]) => [k, optionalNoDefault(t as z.ZodType)]));
  return (Object.keys(undefaulted).length ? partial.extend(undefaulted) : partial) as unknown as typeof partial;
}
