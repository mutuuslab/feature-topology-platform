// ADS 증거(ADS 사건 보고·Safety Case·요구 추적) — 요청 본문 zod(경로 표가 씀, 작게) + 시드 픽스처 스키마는 schemas/ads-evidence-fixture.ts(백엔드 입구 index.ts만)
import { z } from 'zod';

/** 보고 대상 확정 — 안전·법규 담당의 기록(사유 필수) */
export const AdsDeterminationBody = z.object({ decision: z.enum(['REPORTABLE', 'NOT_REPORTABLE']), reason: z.string().trim().min(2).max(500) }).strict();
export type AdsDeterminationBody = z.infer<typeof AdsDeterminationBody>;

/** 독립 검토 발견사항 등록 — Evidence 작성자가 아닌 Safety Manager */
export const AdsReviewFindingBody = z.object({ manifestId: z.string().regex(/^EVM-\d{4}$/), severity: z.enum(['MAJOR', 'MINOR']), summary: z.string().trim().min(2).max(500) }).strict();
export type AdsReviewFindingBody = z.infer<typeof AdsReviewFindingBody>;
