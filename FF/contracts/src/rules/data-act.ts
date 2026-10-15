// EU Data Act 접근권 (보고서 v1.1 13.6 · FFG-TEL-006, EU 2023/2854) — EU 차량의 사용자(Art.4)·사용자가 지정한 제3자(Art.5)가 요청하면
// Feature 상태·이력 데이터를 제공하고, 처리(제공·거부) 기록을 남긴다. 제3자 제공은 사용자 위임 근거가 있어야 하고, 지정 gatekeeper에는 제공하지 않는다(Art.5(3)).
// 2026-09-12 이후 EU 시장 출시 차량은 설계 단계 직접 접근(Art.3(1))이 필요하다 — 차량 설계 몫이라 플랫폼은 출시일로 대상 여부만 표시한다.
// OEM이 비개인 데이터를 쓰려면 사용자와의 계약 근거가 있어야 한다 — 법무가 등록한 근거 문서 ID만 기록한다(문서 내용은 플랫폼 밖).
import { z } from 'zod';

export const DATA_ACT_DIRECT_ACCESS_FROM = '2026-09-12';
export const DATA_ACT_SCOPES = ['FEATURE_STATE', 'FEATURE_HISTORY'] as const;

export const DataAccessRequestBody = z
  .object({
    vin: z.string().min(3),
    requester: z.enum(['USER', 'THIRD_PARTY']),
    /** 제3자(Art.5) — 사용자가 지정한 데이터 수령자 */
    thirdParty: z.object({ id: z.string().trim().min(2).max(80), name: z.string().trim().min(2).max(120), gatekeeper: z.boolean().default(false) }).strict().nullable().default(null),
    /** 사용자 위임 근거(동의서·요청서 ID) — 제3자 제공에 필수 */
    userAuthorizationRef: z.string().trim().min(2).max(80).nullable().default(null),
    scope: z.array(z.enum(DATA_ACT_SCOPES)).min(1).default(['FEATURE_STATE', 'FEATURE_HISTORY']),
  })
  .strict();
export type DataAccessRequestBody = z.infer<typeof DataAccessRequestBody>;

export const ContractBasisBody = z.object({ ref: z.string().trim().min(2).max(80), note: z.string().trim().min(2).max(500) }).strict();
export type ContractBasisBody = z.infer<typeof ContractBasisBody>;

export type DataActRejection = 'NOT_EU_VEHICLE' | 'UNKNOWN_VEHICLE' | 'THIRD_PARTY_MISSING' | 'AUTHORIZATION_MISSING' | 'GATEKEEPER';

/**
 * 요청 판정 — 거부 사유가 없으면 제공. EU 밖 차량은 Data Act 절차 대상이 아니다.
 * @rule FFG-TEL-006 — 사용자·제3자 접근 요청 처리 절차(Art.4·5)와 처리 기록, 제3자 위임 근거·gatekeeper 제외
 */
export function dataActDecision(vehicle: { country: string } | null, body: DataAccessRequestBody): { code: DataActRejection; message: string }[] {
  const out: { code: DataActRejection; message: string }[] = [];
  if (!vehicle) return [{ code: 'UNKNOWN_VEHICLE', message: `${body.vin} 차량을 찾을 수 없습니다` }];
  if (vehicle.country !== 'EU') out.push({ code: 'NOT_EU_VEHICLE', message: `${vehicle.country} 차량은 EU Data Act 절차 대상이 아닙니다` });
  if (body.requester === 'THIRD_PARTY') {
    if (!body.thirdParty) out.push({ code: 'THIRD_PARTY_MISSING', message: '제3자 요청에는 수령자(제3자) 정보가 필요합니다' });
    else if (body.thirdParty.gatekeeper) out.push({ code: 'GATEKEEPER', message: `${body.thirdParty.name}은(는) 지정 gatekeeper — 제3자 제공 대상이 될 수 없습니다(Art.5(3))` });
    if (!body.userAuthorizationRef) out.push({ code: 'AUTHORIZATION_MISSING', message: '제3자 제공에는 사용자 위임 근거(동의·요청서 ID)가 필요합니다' });
  }
  return out;
}

/** Art.3(1) 설계 단계 직접 접근 대상 — 시장 출시일이 없으면 판정 불가로 남긴다 */
export function directAccessStatus(vehicle: { country: string; placedOnMarketAt?: string | null }): 'NOT_EU' | 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN' {
  if (vehicle.country !== 'EU') return 'NOT_EU';
  if (!vehicle.placedOnMarketAt) return 'UNKNOWN';
  return vehicle.placedOnMarketAt.slice(0, 10) >= DATA_ACT_DIRECT_ACCESS_FROM ? 'REQUIRED' : 'NOT_REQUIRED';
}
