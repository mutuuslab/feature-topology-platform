// ADS 구성(ODD 프로파일·호환 형상·VIN 지원 판정) — 요청 본문 zod(경로 표가 씀, 작게) + 시드 픽스처 스키마는 schemas/ads-config-fixture.ts(백엔드 입구 index.ts만)
import { z } from 'zod';

/** ODD 프로파일 승인(기능안전 담당) — 사유 필수 */
export const ApproveOddProfileBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type ApproveOddProfileBody = z.infer<typeof ApproveOddProfileBody>;

/** x.y.z — 앞자리 0은 받지 않는다(semverCompare가 비교하지 못해 보안 최소 버전 검사를 지나가던 결함) */
const Ver = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const Ref = z.object({ id: z.string().min(1).max(80), version: z.string().min(1).max(40) }).strict();

/** 승인 조합 등록(차량 사양·Variant 담당) — ECU SW가 보안 최소 버전보다 낮으면 서버가 거부 */
export const CreateConfigSetBody = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    featureVersion: Ver,
    hw: z.array(z.object({ ecuPno: z.string().min(3).max(40), hwRevision: z.string().min(1).max(40) }).strict()).min(1).max(20),
    ecuSw: z.array(z.object({ ecuPno: z.string().min(3).max(40), swId: z.string().min(3).max(60), version: Ver }).strict()).min(1).max(40),
    model: Ref.nullable().default(null),
    calibration: Ref.nullable().default(null),
    oddProfileId: z.string().max(60).nullable().default(null),
    flagKey: z.string().max(120).nullable().default(null),
    securityMin: z.array(z.object({ swId: z.string().min(3).max(60), version: Ver }).strict()).max(40).default([]),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type CreateConfigSetBody = z.infer<typeof CreateConfigSetBody>;
