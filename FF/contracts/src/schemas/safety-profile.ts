// Registry 필수 안전 속성(보고서 v1.1 5.7) — Feature Version마다 하나. 시간 단위는 ms, 0은 "해당 없음".
import { z } from 'zod';
import { DeactClass, FClass, FlagType, RegClass } from './safety';

export const SafetyProfile = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    status: z.enum(['DRAFT', 'CONFIRMED']),
    /** 값의 출처 — 추정(ASIL·SW 등급), 보고서 예시, Safety Manager 입력 */
    source: z.enum(['INFERRED', 'REPORT_EXAMPLE', 'MANUAL']),
    fClass: FClass,
    deactClass: DeactClass,
    regClass: RegClass,
    flagType: FlagType,
    adsFeature: z.boolean(),
    adsfType: z.enum(['ADSF-1', 'ADSF-2']).nullable(),
    gsrMandatory: z.boolean(),
    itemIds: z.array(z.string()),
    haraRef: z.string().nullable(),
    asilRef: z.enum(['QM', 'A', 'B', 'C', 'D']),
    safetyGoalIds: z.array(z.string()),
    safeState: z.string().nullable(),
    endState: z.enum(['DISABLED', 'INACTIVE', 'HANDOVER', 'MRC']).nullable(),
    takeoverMs: z.number().int().min(0),
    rampMs: z.number().int().min(0),
    faultRampMs: z.number().int().min(0),
    faultTolerantTimeMs: z.number().int().min(0),
    maxPendingMs: z.number().int().min(0),
    maxCycleWaitMs: z.number().int().min(0),
    maxActivationScope: z.object({ vehicles: z.number().int().min(0), perWindow: z.number().int().min(0) }).strict(),
    markets: z.array(z.string()),
    rxswin: z.array(z.string()),
    approvalProfile: z.string().nullable(),
    evidenceManifestId: z.string().nullable(),
    sbomRef: z.string().nullable(),
    rollbackTarget: z.string().nullable(),
    expiresAt: z.string().nullable(),
    retirementPlan: z.string().nullable(),
    confirmedBy: z.string().nullable(),
    confirmedAt: z.string().nullable(),
    /** Safety Manager 개인 서명(approval_sig) — 확정 값의 JCS 바이트에 */
    confirmSig: z.string().nullable(),
  })
  .strict();
export type SafetyProfile = z.infer<typeof SafetyProfile>;

/** 초안 수정 본문 — 식별자·상태·출처·확정 정보는 서버가 정한다 */
export const SafetyProfilePatch = SafetyProfile.omit({ featureId: true, version: true, status: true, source: true, confirmedBy: true, confirmedAt: true, confirmSig: true }).partial().strict();
export type SafetyProfilePatch = z.infer<typeof SafetyProfilePatch>;

export const SafetyConfirmBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type SafetyConfirmBody = z.infer<typeof SafetyConfirmBody>;
