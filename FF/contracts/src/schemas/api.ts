// API 요청 본문 스키마 — 백엔드 ZodPipe와 프론트 폼 검증이 공유한다.
import { z } from 'zod';
import { patchOf } from './patch';
import { Asil, CatalogType, ControlPointType, GateId, GateResult, Lifecycle, RelationType, SaleType } from '../enums';
import { AsilDeviation, FeatureRefLinkInputs } from './refdb';

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
  /** 기준 기능(Feature DB) 연결 — 필수, 대표 정확히 1 + 포함 N, 같은 행 중복 금지(30-95 §5.3·§6.2, D-REF-3) */
  featureRefs: FeatureRefLinkInputs,
  /** 대표 기준 행의 대표 ASIL과 다른 ASIL — 다르면 사유 필수(서버가 대표 행과 비교, §6.3) */
  asilDeviation: AsilDeviation.optional(),
  /** 기준 행의 규제·표준 조항 — 요구사항 ID가 아니므로 따로 보존(사람이 요구사항 연결을 확정) */
  refRegulations: z.array(z.string().trim().min(1).max(500)).optional(),
  /** 같은 국가·차종·트림에 같은 대표 기준 행이 이미 있을 때(409 REFDB_DUPLICATE_IN_SCOPE) 사유와 함께 확인 */
  confirmDuplicate: z.boolean().optional(),
  duplicateReason: z.string().trim().min(2).max(500).optional(),
});
export type CreateFeatureBody = z.infer<typeof CreateFeatureBody>;

/**
 * PROPOSED 초안 수정 — 국가·차종·트림은 바꿀 수 없다(새 Feature ID). 기준 행 연결(featureRefs)은 바꿀 수 있다(§5.3).
 * 대표 기준 행을 같은 범위 다른 Feature가 쓰는 행으로 바꾸면 등록과 같이 409 — confirmDuplicate와 사유를 함께 보낸다(D-REF-13).
 */
export const UpdateDraftBody = patchOf(CreateFeatureBody.omit({ country: true, vehicleModel: true, trim: true }))
  .extend({
    // 구현 연결 — 새 기능은 이름만 보내면 서버가 FUNC 번호를 매긴다. SW·Version·제어기 P/N은 기준정보(SW·ECU 마스터)에 있는 짝만 받는다
    functions: z.array(z.object({ functionId: z.string().regex(/^FUNC-\d{6}$/).optional(), label: z.string().trim().min(1).max(200) })).optional(),
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
  // 같은 Feature ID의 새 Version은 중복 확인 칸이 없다(같은 범위 중복은 경고만)
  changes: UpdateDraftBody.omit({ confirmDuplicate: true, duplicateReason: true }).extend({ country: z.string().optional(), vehicleModel: z.string().optional(), trim: z.string().optional() }).strict().default({}),
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
    /** G2 — 대표 ASIL 변경 사유를 판정자가 검토했다는 확인(P3-1). ASIL을 바꾼 Version의 G2 PASS에 필요 */
    asilReasonReviewed: z.boolean().optional(),
  })
  .refine((b) => b.inputResult !== 'PASS' || !!b.evidenceRef, { message: '증거(Evidence Ref) 없는 PASS는 등록할 수 없습니다.', path: ['evidenceRef'] });
export type JudgeGateBody = z.infer<typeof JudgeGateBody>;

export const BaselineRequestBody = z.object({
  featureId: z.string().regex(/^FEAT-\d{5}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  reason,
});
export type BaselineRequestBody = z.infer<typeof BaselineRequestBody>;

/** Baseline 확정 요청 상태 — 대기(PENDING) → 확정(APPROVED)·반려(REJECTED). 목록 조회 status 질의도 이 값만(화면이 'REQUESTED'로 묻던 결함, P2-1) */
export const BaselineRequestStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type BaselineRequestStatus = z.infer<typeof BaselineRequestStatus>;

export const BaselineDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason });
export type BaselineDecisionBody = z.infer<typeof BaselineDecisionBody>;

// ── Topology (D01-02) ─────────────────────────────────────────────

/** 의존관계 등록 — 원천 Version이 PROPOSED일 때만 (의존관계도 Feature 속성이므로 APPROVED 이후는 새 Version) */
export const CreateDependencyBody = z
  .object({
    type: RelationType,
    sourceFeatureId: z.string().regex(/^FEAT-\d{5}$/),
    sourceVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    targetFeatureId: z.string().regex(/^FEAT-\d{5}$/),
    targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/).nullable().default(null),
  })
  .strict();
export type CreateDependencyBody = z.infer<typeof CreateDependencyBody>;

// ── Catalog (D01-03) ──────────────────────────────────────────────
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const baselineIds = z.array(z.string().regex(/^BL-\d{5}$/)).min(1, '구성 Baseline을 1개 이상 선택하세요.');

export const CreateProductBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    country: z.string().trim().min(1).max(8),
    vehicleModel: z.string().trim().min(1).max(80),
    trim: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(80)).default([]),
    saleType: SaleType,
    type: CatalogType,
    baselineIds,
    validFrom: date.nullable().default(null),
    validTo: date.nullable().default(null),
    ownerId: z.string().trim().min(1).max(100),
  })
  .strict();
export type CreateProductBody = z.infer<typeof CreateProductBody>;

export const UpdateProductDraftBody = patchOf(CreateProductBody.omit({ country: true, vehicleModel: true, trim: true })).strict();
export type UpdateProductDraftBody = z.infer<typeof UpdateProductDraftBody>;

/** 구성·기간 변경 = 새 Catalog Version (PROPOSED부터) */
export const CreateProductVersionBody = z
  .object({
    baseVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    bump: z.enum(['major', 'minor', 'patch']).default('minor'),
    reason: z.string().trim().min(2).max(500),
    changes: UpdateProductDraftBody.default({}),
  })
  .strict();
export type CreateProductVersionBody = z.infer<typeof CreateProductVersionBody>;

export const ValidateCompositionBody = z
  .object({
    country: z.string(),
    vehicleModel: z.string(),
    trim: z.string(),
    type: CatalogType,
    baselineIds: z.array(z.string()),
    validFrom: date.nullable().default(null),
    validTo: date.nullable().default(null),
    carriedOver: z.array(z.string()).default([]),
  })
  .strict();
export type ValidateCompositionBody = z.infer<typeof ValidateCompositionBody>;

export const ProductTransitionBody = z.object({ to: Lifecycle, reason: z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500) }).strict();
export type ProductTransitionBody = z.infer<typeof ProductTransitionBody>;
