// ADS 증거(ADS 사건 보고·Safety Case·요구 추적) — 데모 시드 픽스처 스키마(백엔드·도구 전용, index.ts에서만 내보낸다)
// 시각은 고정 날짜가 아니라 시드 시각 기준 분(…MinAgo)으로 둔다 — 시간이 지나도 데모 기한·경과가 그대로(Clock으로 계산)
import { z } from 'zod';

const id = z.string().min(1);
const ago = z.number().int().min(0);
const config = z.object({ policy: id, configSet: id, odd: id, hw: id, sw: id, model: id, calibration: id }).strict();

export const AdsEvidenceFixture = z
  .object({
    marketDeadlines: z.array(
      z.object({ market: id, label: id, shortTermDays: z.number().int().positive(), periodicMonths: z.number().int().positive(), status: z.enum(['APPROVED', 'DRAFT']), approvedBy: id.nullable(), approvedMinAgo: ago.nullable(), basis: id }).strict(),
    ),
    incidents: z.array(
      z
        .object({
          reportId: z.string().regex(/^ADSI-\d{4}-\d{4}$/),
          featureId: id,
          featureVersion: id,
          vin: id,
          market: id,
          summary: id,
          occurredMinAgo: ago.nullable(),
          awareMinAgo: ago,
          firstNoticeMinAgo: ago.nullable(),
          activeWindow: z.object({ value: z.enum(['IN_WINDOW', 'OUT_OF_WINDOW', 'UNDECIDABLE']), basis: id }).strict(),
          configSet: id,
          oddProfileRef: id,
          dssadCorrelationId: id.nullable(),
          shortTermSubmittedMinAgo: ago.nullable(),
          events: z.array(
            z
              .object({
                kind: z.enum(['POLICY', 'CONFIG', 'ODD', 'VERDICT', 'TRANSITION', 'INCIDENT']),
                label: id,
                vehicleMinAgo: ago.nullable(),
                vehicleSeq: z.number().int().nullable(),
                serverMinAgo: ago,
                ingestSeq: z.number().int(),
                owner: id.nullable(),
                ref: id.nullable(),
                gap: z.boolean().optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    determinations: z.array(z.object({ reportId: id, decision: z.enum(['REPORTABLE', 'NOT_REPORTABLE']), reason: id, decidedBy: id, decidedRole: id, decidedMinAgo: ago }).strict()),
    exposure: z.object({ featureId: id, featureVersion: id, basis: id, months: z.array(z.object({ monthsAgo: z.number().int().min(0), hours: z.number().nonnegative(), km: z.number().nonnegative() }).strict()) }).strict(),
    safetyCases: z.array(
      z
        .object({
          featureId: id,
          featureVersion: id,
          target: config,
          nodes: z.array(z.object({ nodeId: z.string().regex(/^C\d{2}(-A\d+(-E\d+)?)?$/), kind: z.enum(['CLAIM', 'ARGUMENT', 'EVIDENCE']), parentId: id.nullable(), text: id, manifestId: id.nullable() }).strict()),
        })
        .strict(),
    ),
    manifests: z.array(
      z
        .object({
          manifestId: z.string().regex(/^EVM-\d{4}$/),
          featureId: id,
          featureVersion: id,
          requirementIds: z.array(id),
          hazardIds: z.array(id),
          config,
          tool: z.object({ name: id, version: id, validRange: id }).strict(),
          toolValidity: z.enum(['IN_RANGE', 'OUT_OF_RANGE']),
          scenario: z.object({ id, title: id }).strict(),
          expectedTransition: id,
          actualTransition: id,
          timing: z.object({ measuredMs: z.number().nonnegative(), budgetMs: z.number().positive(), budgetStatus: z.enum(['APPROVED', 'ASSUMED']) }).strict(),
          result: z.enum(['PASS', 'FAIL']),
          resultDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
          origin: z.enum(['NEW', 'REUSED']),
          evidenceRef: id.nullable(),
          gateRecordId: id.nullable(),
          author: id,
          authoredMinAgo: ago,
          review: z.object({ status: z.enum(['APPROVED', 'PENDING']), by: id.nullable(), atMinAgo: ago.nullable() }).strict(),
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          findingId: z.string().regex(/^RF-\d{4}$/),
          featureId: id,
          manifestId: id,
          severity: z.enum(['MAJOR', 'MINOR']),
          summary: id,
          status: z.enum(['OPEN', 'CLOSED']),
          reviewer: id,
          openedMinAgo: ago,
          closedMinAgo: ago.nullable(),
          closeReason: id.nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type AdsEvidenceFixture = z.infer<typeof AdsEvidenceFixture>;
