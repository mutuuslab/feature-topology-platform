// ADS 구성 마감(P5) 요청 본문 zod — 경로 표(routes.ts)가 쓴다. 규칙은 rules/ads-publish·eol·ota-install·lifecycle-isolation(백엔드 입구 index.ts의 rules/ads-p5).
import { z } from 'zod';

const Reason = z.string().trim().min(2).max(500);
const Vin = z.string().trim().min(3).max(64);
const Iso = z.string().min(10).max(40);

/** ODD 적용 장소 추가 요청 — 변경 영향(인증·안전 판단) 참조가 확정이어야 승인(HT02) */
export const CreateOddSiteBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    kind: z.enum(['PARKING', 'ZONE', 'ROAD_SECTION']),
    mapVersion: z.string().trim().min(1).max(20),
    infraVersion: z.string().trim().min(1).max(20),
    changeImpactRef: z.string().trim().min(3).max(60).nullable().default(null),
    reason: Reason,
  })
  .strict();
export type CreateOddSiteBody = z.infer<typeof CreateOddSiteBody>;

export const ApproveOddSiteBody = z.object({ reason: Reason }).strict();
export type ApproveOddSiteBody = z.infer<typeof ApproveOddSiteBody>;

/** 복구 결정(차량 1대) — 경로·근거·형상 참조, 이전 버전 복구는 복구 후보 게시본으로 메타데이터를 재검증 */
export const RecoveryDecisionBody = z
  .object({
    vin: Vin,
    path: z.enum(['RESTORE_PREVIOUS', 'APPLY_FIX', 'SAFE_STATE', 'SERVICE']),
    configSetRef: z.string().trim().min(3).max(60),
    candidatePublicationId: z.string().regex(/^PUB-\d{5}$/).nullable().default(null),
    rationale: Reason,
  })
  .strict();
export type RecoveryDecisionBody = z.infer<typeof RecoveryDecisionBody>;

/** Feature 분류 입력(작성자) — 확정 뒤 축 값이 바뀌면 확정이 풀린다(재확정 필요) */
const OwnerName = z.string().trim().min(1).max(80).nullable();
export const UpdateClassificationBody = z
  .object({
    adsFeature: z.boolean().nullable(),
    ddtImpact: z.enum(['NONE', 'SUPPORT', 'PARTIAL', 'FULL']).nullable(),
    safetyRelated: z.boolean().nullable(),
    owner: OwnerName,
    lifecycleOwners: z.object({ CREATE: OwnerName.optional(), OPERATE: OwnerName.optional(), SUSPEND: OwnerName.optional(), DISPOSE: OwnerName.optional() }).strict(),
    reason: Reason,
  })
  .strict();
export type UpdateClassificationBody = z.infer<typeof UpdateClassificationBody>;

export const ConfirmClassificationBody = z.object({ reason: Reason }).strict();
export type ConfirmClassificationBody = z.infer<typeof ConfirmClassificationBody>;

/** 시장 기준선 입력 — 시장별 승인 유형·규정 series·승인 ODD 프로파일·승인 상태 */
export const PutMarketBaselineBody = z
  .object({
    approvalType: z.enum(['TYPE_APPROVAL', 'SELF_CERT']),
    regulations: z.array(z.object({ reg: z.string().trim().min(2).max(40), series: z.string().trim().min(1).max(10) }).strict()).max(20),
    oddProfileRef: z.string().trim().min(3).max(60).nullable(),
    approvalStatus: z.enum(['APPROVED', 'PENDING', 'UNKNOWN']),
    note: z.string().trim().max(300).nullable().default(null),
    reason: Reason,
  })
  .strict();
export type PutMarketBaselineBody = z.infer<typeof PutMarketBaselineBody>;

/** 출고 실물 구성 수신(IF-12 공장 모의) — 주문 사양 ECU와 VIN 스캔 ECU */
const Ecu = z.object({ ecuPno: z.string().trim().min(3).max(40), hwRevision: z.string().trim().min(1).max(40) }).strict();
export const AsBuiltBody = z
  .object({
    vin: Vin,
    plant: z.string().trim().min(2).max(40),
    scannedAt: Iso,
    orderEcus: z.array(Ecu).min(1).max(40),
    builtEcus: z.array(z.object({ ecuPno: z.string().trim().min(3).max(40), hwRevision: z.string().trim().min(1).max(40).nullable() }).strict()).max(40),
  })
  .strict();
export type AsBuiltBody = z.infer<typeof AsBuiltBody>;

/** 품질 보류 결정(생산 품질) — 재대조 결과 없는 출고 근거는 서버가 거부 */
export const EolCheckBody = z
  .object({
    vin: Vin,
    decision: z.enum(['HOLD', 'REWORK', 'RELEASE']),
    cause: z.string().trim().min(2).max(300),
    reworkRef: z.string().trim().min(2).max(60).nullable().default(null),
    recheckResult: z.enum(['PASS', 'FAIL']).nullable().default(null),
    shippedEvidence: z.string().trim().min(2).max(120).nullable().default(null),
    reason: Reason,
  })
  .strict();
export type EolCheckBody = z.infer<typeof EolCheckBody>;

/** IF-05 설치 보고(OTA → FF webhook, 추가 이벤트 type install.report) — 실패는 failure_kind 필수, 보류는 사유, 정지 유지는 도달 증거 */
const InstallItem = z
  .object({
    installId: z.string().trim().min(3).max(60),
    vin: Vin,
    stage: z.enum(['NOT_STARTED', 'DOWNLOADED', 'READY', 'INSTALLING', 'INSTALLED', 'DEFERRED', 'FAILED', 'RECOVERING', 'SAFE_STATE_HELD', 'SERVICE_REQUIRED']),
    at: Iso,
    campaignId: z.string().trim().min(3).max(60).nullable().optional(),
    schedule: z.object({ windowFrom: Iso, windowTo: Iso, estDurationMin: z.number().int().min(1).max(600), driveRestriction: z.boolean() }).strict().nullable().optional(),
    deferredReason: z.enum(['POWER', 'HOLD', 'DDT']).nullable().optional(),
    failureKind: z.enum(['POWER', 'LINK', 'VERIFY']).nullable().optional(),
    recoveryResult: z.enum(['RESTORED', 'PARTIAL', 'FAILED']).nullable().optional(),
    safeState: z.object({ reachedAt: Iso, basis: z.string().trim().min(2).max(300) }).strict().nullable().optional(),
    manifest: z.object({ ecus: z.array(z.object({ ecuPno: z.string().min(3).max(40), swId: z.string().min(3).max(60), version: z.string().min(1).max(40) }).strict()).min(1).max(40) }).strict().nullable().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.stage === 'FAILED' && !r.failureKind) ctx.addIssue({ code: 'custom', path: ['failureKind'], message: '실패 보고에는 failure_kind(POWER·LINK·VERIFY)가 있어야 합니다' });
    if (r.stage === 'DEFERRED' && !r.deferredReason) ctx.addIssue({ code: 'custom', path: ['deferredReason'], message: '설치 보류 보고에는 사유(POWER·HOLD·DDT)가 있어야 합니다' });
    if (r.stage === 'SAFE_STATE_HELD' && !r.safeState) ctx.addIssue({ code: 'custom', path: ['safeState'], message: '정지 유지 보고에는 safe_state_reached_at과 근거가 있어야 합니다' });
  });
export const InstallReportEvent = z.object({
  specVersion: z.string().regex(/^\d+\.\d+$/),
  eventId: z.string().trim().min(8).max(100),
  type: z.literal('install.report'),
  occurredAt: Iso,
  installs: z.array(InstallItem).min(1).max(500),
});
export type InstallReportEvent = z.infer<typeof InstallReportEvent>;

/** 시뮬 차량 설치(시연·시험) — 차량 로컬 사전조건과 결과 경로 */
export const SimulateInstallBody = z
  .object({
    vin: Vin,
    socPct: z.number().min(0).max(100),
    parkHold: z.boolean(),
    ddtActive: z.boolean(),
    outcome: z.enum(['OK', 'POWER_LOSS', 'LINK_LOSS', 'VERIFY_FAIL', 'VERIFY_FAIL_PREVIOUS_CORRUPT', 'RECOVERY_PARTIAL']),
    campaignId: z.string().trim().min(3).max(60).nullable().default(null),
    reason: Reason,
  })
  .strict();
export type SimulateInstallBody = z.infer<typeof SimulateInstallBody>;

/** 지원 종료·서버 교체 연습 */
export const SupportDrillBody = z.object({ horizonDays: z.number().int().min(1).max(3650).default(90), reason: Reason }).strict();
export type SupportDrillBody = z.infer<typeof SupportDrillBody>;
