// ADS 변경(변경 종류·승인 영향·릴리스 비교·분류) — 데모 시드 픽스처 스키마(백엔드·도구 전용, index.ts에서만 내보낸다)
// 시각은 고정 날짜가 아니라 시드 시각 기준 상대값(…AgoHours)으로 둔다 — 시간이 지나도 데모가 깨지지 않게.
import { z } from 'zod';
import { ADS_CHANGE_KINDS, ADS_IMPACT_PATHS, DDT_IMPACTS, LIFECYCLE_OWNER_STATES } from '../rules/ads-change';

const featureId = z.string().regex(/^FEAT-\d{5}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const facts = z
  .object({
    oddWidened: z.boolean().nullable().optional(),
    oddChanged: z.boolean().nullable().optional(),
    modelChanged: z.boolean().nullable().optional(),
    swChanged: z.boolean().nullable().optional(),
    configChanged: z.boolean().nullable().optional(),
  })
  .strict();
const pathRecord = z
  .object({
    status: z.enum(['OPEN', 'DONE']),
    note: z.string().max(300).nullable().default(null),
    ref: z.string().max(80).nullable().default(null),
    closedBy: z.string().max(60).nullable().default(null),
    closedAgoHours: z.number().nonnegative().nullable().default(null),
  })
  .strict();
const oddValue = z.union([z.object({ min: z.number(), max: z.number(), unit: z.string() }).strict(), z.array(z.string()), z.boolean(), z.null()]);

export const AdsChangeImpactSeed = z
  .object({
    impactId: z.string().regex(/^CI-\d{4}$/),
    featureId,
    version,
    baseVersion: version.nullable().default(null),
    title: z.string().min(1).max(200),
    declaredKind: z.enum(ADS_CHANGE_KINDS).nullable().default(null),
    facts,
    paths: z.partialRecord(z.enum(ADS_IMPACT_PATHS), pathRecord).default({}),
    scopeStatus: z.enum(['CONFIRMED', 'REVIEW_REQUIRED']),
    assignee: z.string().max(60).nullable().default(null),
    openedAgoHours: z.number().nonnegative(),
  })
  .strict();
export type AdsChangeImpactSeed = z.infer<typeof AdsChangeImpactSeed>;

export const AdsReleaseSeed = z
  .object({
    featureId,
    version,
    odd: z.record(z.string(), oddValue),
    termination: z.object({ dc: z.string().nullable(), fallback: z.string().nullable(), mrc: z.string().nullable() }).strict(),
    /** diff로 알 수 없는 사실(모델·SW·설정 변경) — 없으면 정보 없음 */
    extra: z.object({ modelChanged: z.boolean().nullable().optional(), swChanged: z.boolean().nullable().optional(), configChanged: z.boolean().nullable().optional() }).strict().default({}),
  })
  .strict();
export type AdsReleaseSeed = z.infer<typeof AdsReleaseSeed>;

export const AdsClassificationSeed = z
  .object({
    featureId,
    version,
    adsFeature: z.boolean().nullable(),
    ddtImpact: z.enum(DDT_IMPACTS).nullable(),
    safetyRelated: z.boolean().nullable(),
    owner: z.string().max(60).nullable(),
    source: z.enum(['MANUAL', 'INFERRED', 'REPORT_EXAMPLE']),
    status: z.enum(['CONFIRMED', 'DRAFT']),
    confirmedBy: z.string().max(60).nullable().default(null),
    confirmedAgoHours: z.number().nonnegative().nullable().default(null),
    lifecycleOwners: z.partialRecord(z.enum(LIFECYCLE_OWNER_STATES), z.string().max(60).nullable()).default({}),
  })
  .strict();
export type AdsClassificationSeed = z.infer<typeof AdsClassificationSeed>;

export const MarketBaselineSeed = z
  .object({
    market: z.string().regex(/^[A-Z]{2}$/),
    featureId,
    version,
    approvalType: z.enum(['TYPE_APPROVAL', 'SELF_CERT']),
    regulations: z.array(z.object({ reg: z.string().min(1).max(40), series: z.string().min(1).max(10) }).strict()),
    oddProfileRef: z.string().regex(/^ODD-FEAT-\d{5}-v\d+$/).nullable(),
    approvalStatus: z.enum(['APPROVED', 'PENDING', 'UNKNOWN']),
    assumed: z.boolean(),
    note: z.string().max(300).nullable().default(null),
  })
  .strict();
export type MarketBaselineSeed = z.infer<typeof MarketBaselineSeed>;

export const ExpansionSeed = z
  .object({
    /** 정책은 런타임 번호(POL-)가 아니라 Feature Version으로 잇는다 */
    featureId,
    version,
    policyAllowed: z.number().int().nonnegative(),
    unconfirmed: z.number().int().nonnegative(),
    metrics: z.array(z.object({ key: z.string().min(1).max(60), observedAgoMinutes: z.number().nonnegative().nullable(), staleAfterMinutes: z.number().positive(), value: z.number(), threshold: z.number(), breached: z.boolean() }).strict()),
    combos: z.array(
      z.object({ comboId: z.string().min(1).max(40), vehicleActive: z.number().int().nonnegative(), usageConfirmed: z.number().int().nonnegative(), errors: z.number().int().nonnegative(), samples: z.number().int().nonnegative(), minSamples: z.number().int().positive(), windowHours: z.number().positive(), alert: z.boolean() }).strict(),
    ),
    frozen: z.object({ reason: z.string().max(200), scope: z.string().max(120), by: z.string().max(60), agoHours: z.number().nonnegative() }).strict().nullable(),
  })
  .strict();
export type ExpansionSeed = z.infer<typeof ExpansionSeed>;

export const AdsChangeFixture = z
  .object({
    assumed: z.literal(true),
    changeImpacts: z.array(AdsChangeImpactSeed),
    releases: z.array(AdsReleaseSeed),
    classifications: z.array(AdsClassificationSeed),
    marketBaselines: z.array(MarketBaselineSeed),
    expansions: z.array(ExpansionSeed).default([]),
  })
  .strict();
export type AdsChangeFixture = z.infer<typeof AdsChangeFixture>;
