// ADS 구성(ODD 프로파일·호환 형상·VIN 지원 판정) — 데모 시드 픽스처 스키마(백엔드·도구 전용, index.ts에서만 내보낸다)
// 시각은 시드 시각 기준 상대값(분·시간·일)으로 두고 백엔드 Clock으로 계산한다 — 시간이 지나도 데모가 깨지지 않게.
import { z } from 'zod';

const Ver = z.string().regex(/^\d+\.\d+\.\d+$/);
const Ref = z.object({ id: z.string(), version: z.string() }).strict();
const OddConditionFx = z
  .object({
    key: z.string(),
    axis: z.enum(['EXCLUSION', 'GEOGRAPHY', 'ROAD', 'ENVIRONMENT', 'DYNAMIC']),
    label: z.string(),
    op: z.enum(['LE', 'LT', 'GE', 'GT', 'IN', 'NOT_IN']),
    value: z.union([z.number(), z.array(z.string()), z.null()]),
    unit: z.string().nullable(),
  })
  .strict();
/** 상대 시각 — 시드 시각에서 뺄 분·시간·일(합) */
const Ago = z.object({ minutes: z.number().int().min(0).optional(), hours: z.number().int().min(0).optional(), days: z.number().int().min(0).optional() }).strict();

export const AdsConfigFixture = z
  .object({
    oddProfiles: z.array(
      z
        .object({
          profileId: z.string().regex(/^ODD-FEAT-\d{5}-v\d+$/),
          featureId: z.string().regex(/^FEAT-\d{5}$/),
          featureVersion: Ver,
          version: z.number().int().positive(),
          status: z.enum(['DRAFT', 'APPROVED']),
          basedOn: z.string().nullable(),
          conditions: z.array(OddConditionFx),
          envelope: z.array(OddConditionFx),
          mapVersions: z.array(z.string()),
          infraVersions: z.array(z.string()),
          sites: z.array(z.object({ siteId: z.string(), name: z.string(), kind: z.enum(['PARKING', 'ZONE', 'ROAD_SECTION']), mapVersion: z.string(), infraVersion: z.string(), impactConfirmed: z.boolean() }).strict()),
          createdBy: z.string(),
          createdAgo: Ago,
          approvedBy: z.string().nullable(),
          approvedAgo: Ago.nullable(),
          approvalReason: z.string().nullable(),
        })
        .strict(),
    ),
    deploySettings: z.array(
      z
        .object({
          settingId: z.string(),
          featureId: z.string(),
          featureVersion: Ver,
          flagKey: z.string(),
          key: z.string(),
          label: z.string(),
          op: z.enum(['LE', 'LT', 'GE', 'GT', 'IN', 'NOT_IN']),
          value: z.union([z.number(), z.array(z.string()), z.null()]),
          unit: z.string().nullable(),
        })
        .strict(),
    ),
    configSets: z.array(
      z
        .object({
          setId: z.string().regex(/^CFG-FEAT-\d{5}-\d{2}$/),
          featureId: z.string(),
          featureVersion: Ver,
          hw: z.array(z.object({ ecuPno: z.string(), hwRevision: z.string() }).strict()),
          ecuSw: z.array(z.object({ ecuPno: z.string(), swId: z.string(), version: Ver }).strict()),
          model: Ref.nullable(),
          calibration: Ref.nullable(),
          oddProfileId: z.string().nullable(),
          flagKey: z.string().nullable(),
          securityMin: z.array(z.object({ swId: z.string(), version: Ver }).strict()),
          approvedBy: z.string(),
          approvedAgo: Ago,
        })
        .strict(),
    ),
    vehicleConfigs: z.array(
      z
        .object({
          vin: z.string(),
          reportedAgo: Ago.nullable(),
          ecus: z.array(z.object({ ecuPno: z.string(), hwRevision: z.string(), sw: z.array(z.object({ swId: z.string(), version: Ver }).strict()) }).strict()),
          model: Ref.nullable(),
          calibration: Ref.nullable(),
          recovery: z.object({ targets: z.array(z.string()), recovered: z.array(z.string()) }).strict().nullable(),
          recoveryCandidate: z.object({ swId: z.string(), version: Ver }).strict().nullable(),
        })
        .strict(),
    ),
    productMarketApprovals: z.array(z.object({ catalogId: z.string().regex(/^CAT-\d{5}$/), market: z.string(), approvedBy: z.string(), approvedAgo: Ago, rationale: z.string() }).strict()),
  })
  .strict();
export type AdsConfigFixture = z.infer<typeof AdsConfigFixture>;
