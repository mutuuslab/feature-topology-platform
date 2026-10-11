// 활성화 정책 — 정책 저장·버전 관리(D01-06). Control Point 하나에 대한 Flag 정책.
// 차량 프로파일 FP-VEHICLE-BOOL-1(P0 BD-08): boolean 값, 15개 명시 연산자, 부분 롤아웃은 FP-COHORT-1 코호트(BD-09).
import { z } from 'zod';
import { ControlPointType } from '../enums';
import { CONSTRAINT_OPERATORS } from '../flags/p0';

export const ConstraintSchema = z
  .object({
    contextName: z.string().min(1).max(64),
    operator: z.enum(CONSTRAINT_OPERATORS),
    values: z.array(z.string().min(1).max(200)).min(1).max(50),
    inverted: z.boolean().default(false),
    caseInsensitive: z.boolean().default(false),
  })
  .strict();

export const StrategySchema = z.object({ name: z.string().min(1).max(80), constraints: z.array(ConstraintSchema).max(20) }).strict();

export const RolloutSchema = z
  .object({
    /** ALL: 대상 전체 · NONE: 아무도 · COHORT: FP-COHORT-1 버킷 < basisPoints */
    mode: z.enum(['ALL', 'NONE', 'COHORT']),
    basisPoints: z.number().int().min(0).max(10000).default(10000),
    salt: z.string().min(1).max(64).default('FF-COHORT-SALT-1'),
  })
  .strict();

export const PolicyStatus = z.enum(['DRAFT', 'VALIDATED', 'REJECTED', 'APPROVED', 'DEPLOYED', 'RETIRED']);
export type PolicyStatus = z.infer<typeof PolicyStatus>;

export const PolicySpec = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    featureVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    controlPoint: ControlPointType,
    /** 매핑표 규칙: <도메인>_<Feature 번호>_<제어점> 예) care_00022_param */
    flagKey: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, 'flagKey는 소문자·숫자·밑줄 3~64자 (예: care_00022_param)'),
    description: z.string().trim().min(1).max(500),
    enabled: z.boolean().default(true),
    /** 평가 오류·문맥 불명·차단 시 값 — 안전 등급 B 이상은 false(OFF)여야 한다 */
    safeDefault: z.boolean().default(false),
    /** 체험권·구독 등 사용 권한이 필요하면 상품 ID */
    entitlementCatalogId: z.string().regex(/^CAT-\d{5}$/).nullable().default(null),
    strategies: z.array(StrategySchema).max(10).default([]),
    rollout: RolloutSchema.default({ mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' }),
  })
  .strict();
export type PolicySpec = z.infer<typeof PolicySpec>;

export const PolicySchema = PolicySpec.extend({
  policyId: z.string().regex(/^POL-\d{5}$/),
  revision: z.number().int().min(1),
  status: PolicyStatus,
  contentHash: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  lastValidationId: z.string().nullable(),
  /** 단계적 기능 배포(D01-08) 현재 단계 — 승인된 내용(해시) 밖의 운영 값. null이면 정책 rollout 그대로 */
  stageBasisPoints: z.number().int().min(0).max(10000).nullable().default(null),
});
export type Policy = z.infer<typeof PolicySchema>;

export const CreatePolicyBody = PolicySpec;
export type CreatePolicyBody = z.infer<typeof CreatePolicyBody>;
export const UpdatePolicyBody = PolicySpec.partial().strict();
export type UpdatePolicyBody = z.infer<typeof UpdatePolicyBody>;
export const PolicyDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(2).max(500) }).strict();
export type PolicyDecisionBody = z.infer<typeof PolicyDecisionBody>;

/** 데모 차량 — 문맥 평가·시나리오 검증 대상 (Fleet 연계 IF-06/07의 모의) */
export const VehicleSchema = z.object({
  vin: z.string().min(3),
  label: z.string(),
  country: z.string(),
  vehicleModel: z.string(),
  trim: z.string(),
  modelYear: z.string(),
  upgVc: z.string(),
  swVersion: z.string(),
  /** 문맥 품질 — 통신 단절·오래된 신호를 흉내 낸다 */
  quality: z.enum(['TRUSTED', 'STALE', 'UNTRUSTED']).default('TRUSTED'),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const EntitlementSchema = z.object({
  grantId: z.string().regex(/^ENT-\d{5}$/),
  vin: z.string(),
  catalogId: z.string().regex(/^CAT-\d{5}$/),
  kind: z.enum(['구독', '구매', '체험']),
  validFrom: z.string(),
  validTo: z.string(),
  usesLeft: z.number().int().min(0).nullable(),
  status: z.enum(['ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED']),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

export const DecideBody = z.object({ vin: z.string().min(3), flagKey: z.string().min(3) }).strict();
export type DecideBody = z.infer<typeof DecideBody>;

export const RolloutStageBody = z.object({ basisPoints: z.number().int().min(0).max(10000), reason: z.string().trim().min(2).max(500) }).strict();
export type RolloutStageBody = z.infer<typeof RolloutStageBody>;

export const OfrepContext = z.object({ targetingKey: z.string().min(1).optional() }).passthrough();
export const OfrepBody = z.object({ context: OfrepContext.default({}) }).passthrough();
export type OfrepBody = z.infer<typeof OfrepBody>;
