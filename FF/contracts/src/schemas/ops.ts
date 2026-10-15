// 배포·차단 전달 계층 (PoC ④⑥) — 보안 배포(D06-08)가 서명한 게시본(Publication)을 배포 파이프라인(D04-01, IF-05)이
// 차량 런타임(D02-03)으로 보내고, 차량 회신(IF-06 → 운영 데이터 수집 D04-03)을 P0 aggregate로 집계한다(BD-12).
import { z } from 'zod';
import { PolicySchema } from './policy';
import { ApproverRole, DeactClass, FClass, REASON_CATEGORIES } from './safety';

export const SafeMode = z.enum(['SAFE_DEFAULT', 'SAFE_STOP']);
export type SafeMode = z.infer<typeof SafeMode>;

export const PublicationKind = z.enum(['POLICY', 'KILL', 'RESTORE']);
export type PublicationKind = z.infer<typeof PublicationKind>;
/** 게시본 종류별 서명 키 용도 — 차량은 기대 용도의 kid로 서명된 것만 받는다(FFG-SEC-002) */
export const PUBLICATION_KEY_PURPOSE = { POLICY: 'policy', KILL: 'kill', RESTORE: 'restore' } as const satisfies Record<PublicationKind, string>;

/** SIGNED → DISPATCHED → (회신 집계) CONFIRMED | PARTIAL | DIVERGED, 기한 초과 시 TIMEOUT */
export const PublicationStatus = z.enum(['SIGNED', 'DISPATCHED', 'CONFIRMED', 'PARTIAL', 'DIVERGED', 'TIMEOUT']);
export type PublicationStatus = z.infer<typeof PublicationStatus>;

/** PKI/KMS(D06-10) 서명 봉투 — 게시본 정규 JSON의 sha256을 Ed25519로 서명 */
export const SignatureSchema = z.object({
  keyId: z.string().regex(/^KEY-\d{4}$/),
  alg: z.literal('Ed25519'),
  payloadHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  signature: z.string().min(16), // base64
});
export type Signature = z.infer<typeof SignatureSchema>;

/** 차량에 전달되는 서명 대상 본문 — 차량은 서명·순번(재전송 방지)을 확인한 뒤에만 적용한다 */
export const PublicationPayload = z.object({
  publicationId: z.string().regex(/^PUB-\d{5}$/),
  kind: PublicationKind,
  /** 같은 대상(flagKey 또는 Feature) 안에서 단조 증가 — 차량은 본 적 있는 순번 이하를 거부한다 */
  sequence: z.number().int().positive(),
  featureId: z.string(),
  featureVersion: z.string(),
  flagKey: z.string().nullable(),
  policy: PolicySchema.nullable(),
  kill: z.object({ killId: z.string(), safeMode: SafeMode, featureIds: z.array(z.string()) }).nullable(),
  targets: z.array(z.string()),
  /** 차량이 적용 후 되읽어 보고해야 하는 값 — POLICY: 정책 해시, KILL: Safe 상태, RESTORE: ACTIVE */
  desired: z.string(),
  issuedAt: z.string(),
});
export type PublicationPayload = z.infer<typeof PublicationPayload>;

export const ReadbackNodeSchema = z.object({ nodeId: z.string(), state: z.string(), reason: z.string() });

export const PublicationSchema = z.object({
  publicationId: z.string(),
  kind: PublicationKind,
  status: PublicationStatus,
  payload: PublicationPayload,
  signature: SignatureSchema,
  campaignId: z.string().nullable(),
  channel: z.enum(['OTA', 'EMERGENCY']),
  createdBy: z.string(),
  createdAt: z.string(),
  deadlineAt: z.string(),
  confirmed: z.number().int(),
  denominator: z.number().int(),
  nodes: z.array(ReadbackNodeSchema),
  /** 회신 의무가 없는 대상(예: GLEO 영상 키트는 policy_push에 회신하지 않는다) */
  ackOnly: z.array(z.string()).default([]),
  closedAt: z.string().nullable(),
});
export type Publication = z.infer<typeof PublicationSchema>;

/** IF-06 차량 회신 — 운영 데이터 수집(D04-03)이 받는다. P0 ReadbackReport와 같은 뜻 */
export const ReadbackBody = z
  .object({
    vin: z.string().min(1),
    publicationId: z.string().regex(/^PUB-\d{5}$/),
    metricType: z.enum(['READBACK', 'ACK']),
    policyHash: z.string(),
    featureVersion: z.string(),
    bootId: z.string(),
    sequence: z.number().int(),
    observed: z.string(),
    /** 차량 측 거부 사유 (서명 불일치·재전송 등) — 있으면 observed는 'REJECTED' */
    rejectReason: z.string().optional(),
  })
  .strict();
export type ReadbackBody = z.infer<typeof ReadbackBody>;

// ---- 긴급 기능 차단(D03-03) · 이전 상태 복구(D03-04) ----

/** v2: REQUESTED(승인 대기) → ACTIVE(게이트 통과·서명·전달) → RELEASED(복원), 또는 REJECTED(승인 거절·게이트 실패) · EXPIRED(승인 기한 경과). v1 레거시 행은 ACTIVE·RELEASED만 */
export const KillStatus = z.enum(['REQUESTED', 'ACTIVE', 'RELEASED', 'REJECTED', 'EXPIRED']);
export type KillStatus = z.infer<typeof KillStatus>;

/** 승인 1건 — 승인자 개인 키로 승인 대상(approvalSubject, JCS)에 서명 */
export const KillApprovalRecord = z.object({
  approverId: z.string(),
  platformRole: z.string(),
  role: ApproverRole,
  signedAt: z.string(),
  kid: z.string(),
  sig: z.string(),
  comment: z.string().nullable().default(null),
});
export type KillApprovalRecord = z.infer<typeof KillApprovalRecord>;

/** 게이트 판정 요약(명령마다) */
export const KillGateSummary = z.object({ result: z.enum(['PASS', 'FAIL', 'SCHEMA_FAIL']), failed: z.array(z.string()), at: z.string() });
/** 서명·발행된 명령(kill_command v2) 요약 — 본문 전체와 차량별 봉투는 /envelopes */
export const KillCommandRef = z.object({ commandId: z.string(), commandSeq: z.number().int(), kid: z.string(), signature: z.string(), issuedAt: z.string(), envelopes: z.number().int() });

export const RestoreRequest = z.object({
  requestedBy: z.string(),
  requestedAt: z.string(),
  reason: z.string(),
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED']),
  approvals: z.array(KillApprovalRecord),
  gate: KillGateSummary.nullable().default(null),
  command: KillCommandRef.nullable().default(null),
  rejectedBy: z.string().nullable().default(null),
  rejectReason: z.string().nullable().default(null),
});
export type RestoreRequest = z.infer<typeof RestoreRequest>;

export const KillRequestSchema = z.object({
  killId: z.string().regex(/^KILL-\d{5}$/),
  featureId: z.string(),
  featureVersion: z.string(),
  /** 차단 대상 Feature + 이를 REQUIRES하는 의존 Feature (Topology 영향 범위) */
  featureIds: z.array(z.string()),
  flagKeys: z.array(z.string()),
  vins: z.array(z.string()),
  /** v1 레거시(운영자가 고르던 안전 모드) — v2 명령에는 없다. 비활성화 방식은 Registry 등급(deactClass) */
  safeMode: SafeMode.optional(),
  reason: z.string(),
  status: KillStatus,
  // ── v2 (보고서 v1.1) — 레거시 행에는 없다 ──
  version: z.literal(2).optional(),
  reasonCategory: z.enum(REASON_CATEGORIES).optional(),
  reasonCode: z.string().optional(),
  fClass: FClass.optional(),
  deactClass: DeactClass.optional(),
  fsmRequired: z.boolean().optional(),
  approvals: z.array(KillApprovalRecord).optional(),
  expiresAt: z.string().optional(),
  recallCampaignId: z.string().nullable().optional(),
  containmentJustification: z.string().nullable().optional(),
  /** 결함 판정 시각과 대상 시장별 결함 보고 기한(FFG-DEAC-010) — F2 이상 안전 Kill만 */
  defectDeterminedAt: z.string().nullable().optional(),
  recallReports: z.array(z.object({ market: z.string(), defectDeterminedAt: z.string().nullable(), due: z.string().nullable(), basis: z.string(), note: z.string().nullable() })).optional(),
  /** 상업·운영 사유 명령의 사용자 고지 기록(예: 체험권 만료 고지 NTC-NNNNN) — 없으면 F2 이상 상업 명령은 게이트 FFG-PLT-006 FAIL */
  userNoticeRef: z.string().nullable().optional(),
  gate: KillGateSummary.nullable().optional(),
  command: KillCommandRef.nullable().optional(),
  rejectedBy: z.string().nullable().optional(),
  rejectReason: z.string().nullable().optional(),
  restoreRequest: RestoreRequest.nullable().optional(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  publicationId: z.string().nullable(),
  releasedBy: z.string().nullable(),
  releasedAt: z.string().nullable(),
  releaseReason: z.string().nullable(),
  restorePublicationId: z.string().nullable(),
  anomalyId: z.string().nullable().default(null),
});
export type KillRequest = z.infer<typeof KillRequestSchema>;

export const KillCreateBody = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    featureVersion: z.string().min(1),
    /** 비우면 영향 범위의 모든 차량 */
    vins: z.array(z.string()).max(500).optional(),
    /** 사유 분류·코드(kill_command v2 reason) — 비활성화 방식은 고르지 않는다(Registry 등급) */
    reasonCategory: z.enum(REASON_CATEGORIES).default('SAFETY'),
    reasonCode: z
      .string()
      .regex(/^[A-Z0-9_]{3,40}$/)
      .default('FIELD_FAULT'),
    reason: z.string().trim().min(2).max(500),
    /** F2 이상 안전 Kill은 리콜 캠페인 ID나 봉쇄 결정 근거 중 하나(FFG-PLT-009·DEAC-010) */
    recallCampaignId: z.string().trim().min(2).max(60).optional(),
    containmentJustification: z.string().trim().min(2).max(500).optional(),
    /** 결함 판정 시각 — 시장별 결함 보고 기한(미국 5영업일)의 기준 */
    defectDeterminedAt: z.string().datetime().optional(),
    /** type-to-confirm — 차단할 Feature ID를 그대로 입력 */
    confirm: z.string(),
    /** 이상 징후 대응(D06-12)에서 넘어온 차단 — 발령되면 그 이상 건이 조치됨(MITIGATED)이 된다 */
    anomalyId: z
      .string()
      .regex(/^ANM-\d{5}$/)
      .optional(),
  })
  .strict();
export type KillCreateBody = z.infer<typeof KillCreateBody>;

/** 승인 — 개인 서명은 서버 HSM이 승인자 키로 만든다. 의견은 선택 */
export const KillApproveBody = z.object({ comment: z.string().trim().max(500).optional() }).strict();
export type KillApproveBody = z.infer<typeof KillApproveBody>;
export const KillRejectBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type KillRejectBody = z.infer<typeof KillRejectBody>;

/** 서명 키 용도 — 용도마다 kid를 분리하고 다른 용도의 키로 서명한 명령은 무효(보고서 v1.1 FFG-SEC-002, 8.2 "kid별 알고리즘·용도 고정") */
export const KEY_PURPOSES = ['policy', 'activate', 'kill', 'restore', 'sync', 'gate'] as const;
export const KeyPurpose = z.enum(KEY_PURPOSES);
export type KeyPurpose = z.infer<typeof KeyPurpose>;

export const KeyRotateBody = z.object({ reason: z.string().trim().min(2).max(500), purpose: KeyPurpose.default('policy') }).strict();
export const EpochBumpBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type EpochBumpBody = z.infer<typeof EpochBumpBody>;
export type KeyRotateBody = z.infer<typeof KeyRotateBody>;
