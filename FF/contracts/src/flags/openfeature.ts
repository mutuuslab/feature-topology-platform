// OpenFeature 평가 문맥 (OF-4) — 앱·차량 SDK가 보내는 EvaluationContext와 FF 차량 등록 정보의 대응.
// targetingKey = VIN(vehicleKey). 국가·차종·트림·SW 같은 속성은 등록 정보가 신뢰 원천이다 — SDK가 보낸 값은 판단에 쓰지 않고,
// 등록 정보와 다르면 응답 metadata(ignoredContext)로 알린다(차량 발신 요청의 TRUST_SOURCE 규칙과 같다).
import type { Vehicle } from '../schemas/policy';

/** OpenFeature 문맥 속성 → 차량 등록 필드 */
export const OPENFEATURE_CONTEXT: Record<string, keyof Vehicle> = {
  country: 'country',
  vehicleModel: 'vehicleModel',
  vehicleTrim: 'trim',
  modelYear: 'modelYear',
  upgVc: 'upgVc',
  swVersion: 'swVersion',
};

/** SDK가 보낸 속성 중 등록 정보와 다른 것 (판단에는 등록 정보를 쓴다) */
export function ignoredContext(ctx: Record<string, unknown> | undefined, v: Vehicle): string[] {
  if (!ctx) return [];
  return Object.entries(OPENFEATURE_CONTEXT)
    .filter(([attr, field]) => ctx[attr] !== undefined && String(ctx[attr]) !== String(v[field]))
    .map(([attr]) => attr);
}
