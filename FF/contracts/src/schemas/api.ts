// API 요청 본문 스키마 — 백엔드 ZodPipe와 프론트 폼 검증이 공유한다.
import { z } from 'zod';
import { Asil, ControlPointType, GateId, GateResult, Lifecycle } from '../enums';

const reason = z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500);

/** 신규 Feature 등록 — PROPOSED 0.1.0으로 생성 (상세설계서 표 20 'ID 등록, 중복 확인') */
export const CreateFeatureBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  requirementIds: z.array(z.string().trim().min(1)).default([]),
  country: z.string().trim().min(1).max(8),
  vehicleModel: z.string().trim().min(1).max(80),
  trim: z.string().trim().min(1).max(80),
  ownerId: z.string().trim().min(1).max(100),
  asil: Asil,
  tags: z.array(z.string().trim().min(1).max(80)).default([]),
  upgVc: z.array(z.string().trim().min(1)).default([]),
  controlPoints: z.array(ControlPointType).default([]),
});
export type CreateFeatureBody = z.infer<typeof CreateFeatureBody>;

/** PROPOSED 초안 수정 — 국가·차종·트림은 바꿀 수 없다(새 Feature ID). */
export const UpdateDraftBody = CreateFeatureBody.omit({ country: true, vehicleModel: true, trim: true })
  .partial()
  .extend({
    functions: z.array(z.object({ functionId: z.string().regex(/^FUNC-\d{6}$/), label: z.string() })).optional(),
    swIds: z.array(z.string()).optional(),
    swVersions: z.array(z.string()).optional(),
    ecuPnos: z.array(z.string()).optional(),
  })
  .strict(); // 알 수 없는 필드를 조용히 버리지 않는다 (예: 국가 변경 시도)
export type UpdateDraftBody = z.infer<typeof UpdateDraftBody>;

/** 새 Version 생성 (APPROVED 이후 속성 변경은 모두 새 Version) */
export const CreateVersionBody = z.object({
  baseVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  bump: z.enum(['major', 'minor', 'patch']).default('minor'),
  reason,
  // 국가·차종·트림은 받아서 서비스가 '새 Feature ID 필요'로 명확히 거부한다
  changes: UpdateDraftBody.extend({ country: z.string().optional(), vehicleModel: z.string().optional(), trim: z.string().optional() }).strict().default({}),
});
export type CreateVersionBody = z.infer<typeof CreateVersionBody>;

export const TransitionBody = z.object({ to: Lifecycle, reason: z.string().trim().max(500).default('') });
export type TransitionBody = z.infer<typeof TransitionBody>;

/** Gate 판정 등록 — PASS는 Evidence Ref 필수 (증거 없는 PASS 금지) */
export const JudgeGateBody = z
  .object({
    gate: GateId,
    inputResult: GateResult,
    rationale: z.string().trim().min(2).max(512),
    evidenceRef: z.string().trim().max(512).nullable().default(null),
  })
  .refine((b) => b.inputResult !== 'PASS' || !!b.evidenceRef, { message: '증거(Evidence Ref) 없는 PASS는 등록할 수 없습니다.', path: ['evidenceRef'] });
export type JudgeGateBody = z.infer<typeof JudgeGateBody>;

export const BaselineRequestBody = z.object({
  featureId: z.string().regex(/^FEAT-\d{5}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  reason,
});
export type BaselineRequestBody = z.infer<typeof BaselineRequestBody>;

export const BaselineDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason });
export type BaselineDecisionBody = z.infer<typeof BaselineDecisionBody>;
