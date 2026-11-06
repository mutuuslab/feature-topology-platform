// ADS 변경(변경 종류·승인 영향·릴리스 비교·분류) — 요청 본문 zod(경로 표가 씀, 작게) + 시드 픽스처 스키마는 schemas/ads-change-fixture.ts(백엔드 입구 index.ts만)
import { z } from 'zod';
import type { Role } from '../enums';

/** 승인 경로를 닫는 역할 — 경로 표(routes.ts)가 쓰므로 첫 화면에 드는 이 파일에 둔다(규칙 표 rules/ads-change.ts는 화면 묶음에서만) */
export const PATH_CLOSER_ROLES: Role[] = ['SAFETY_OFFICER', 'SECURITY_OFFICER'];

/** 승인 경로 종결 — 기능안전 담당자(재-HARA·Safety Case)·사이버보안 담당자(R156 영향·SUMS) */
export const CloseImpactPathBody = z.object({
  reason: z.string().trim().min(2).max(500),
  /** 근거 기록(HARA 문서·R156 영향 평가서·SUMS 기록 ID) */
  ref: z.string().trim().min(1).max(80).optional(),
});
export type CloseImpactPathBody = z.infer<typeof CloseImpactPathBody>;
