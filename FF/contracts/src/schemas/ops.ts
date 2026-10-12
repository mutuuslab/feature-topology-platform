// 배포·차단 전달 계층 (PoC ④⑥) — 보안 배포(D06-08)가 서명한 게시본(Publication)을 배포 파이프라인(D04-01, IF-05)이
// 차량 런타임(D02-03)으로 보내고, 차량 회신(IF-06 → 운영 데이터 수집 D04-03)을 P0 aggregate로 집계한다(BD-12).
import { z } from 'zod';
import { PolicySchema } from './policy';

export const SafeMode = z.enum(['SAFE_DEFAULT', 'SAFE_STOP']);
export type SafeMode = z.infer<typeof SafeMode>;

export const PublicationKind = z.enum(['POLICY', 'KILL', 'RESTORE']);
export type PublicationKind = z.infer<typeof PublicationKind>;

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

export const KillStatus = z.enum(['ACTIVE', 'RELEASED']);

export const KillRequestSchema = z.object({
  killId: z.string().regex(/^KILL-\d{5}$/),
  featureId: z.string(),
  featureVersion: z.string(),
  /** 차단 대상 Feature + 이를 REQUIRES하는 의존 Feature (Topology 영향 범위) */
  featureIds: z.array(z.string()),
  flagKeys: z.array(z.string()),
  vins: z.array(z.string()),
  safeMode: SafeMode,
  reason: z.string(),
  status: KillStatus,
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
    safeMode: SafeMode.default('SAFE_DEFAULT'),
    reason: z.string().trim().min(2).max(500),
    /** type-to-confirm — 차단할 Feature ID를 그대로 입력 */
    confirm: z.string(),
    /** 이상 징후 대응(D06-12)에서 넘어온 차단 — 발령되면 그 이상 건이 조치됨(MITIGATED)이 된다 */
    anomalyId: z.string().regex(/^ANM-\d{5}$/).optional(),
  })
  .strict();
export type KillCreateBody = z.infer<typeof KillCreateBody>;

export const KeyRotateBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type KeyRotateBody = z.infer<typeof KeyRotateBody>;
