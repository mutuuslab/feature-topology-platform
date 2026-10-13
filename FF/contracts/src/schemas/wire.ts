// 차량 메시지 v2 — kill_command·status_report (보고서 v1.1 부록 D, 코드 패키지 schema/*.v2.schema.json).
// JSON Schema와 같은 제약을 zod strict로 옮긴다. 대조 시험(wire.test.ts)이 JSON Schema의 필드·필수·enum과 이 스키마를 자동 비교한다.
// v1(safe_mode·SAFE_DEFAULT)은 받지 않는다 — 모르는 필드는 strict가 거부한다.
import { z } from 'zod';
import {
  APPROVER_ROLES,
  DEACT_CLASSES,
  EDR_STATES,
  F_CLASSES,
  GUARD_STATES,
  HMI_STATES,
  KILL_REQUESTS,
  PERSISTENCE,
  REASON_CATEGORIES,
  REJECT_CODES,
  REPORT_SOURCES,
  REQUEST_RESULTS,
  TIME_SYNC,
} from './safety';

export const MARKETS = ['UNECE', 'EU', 'UK', 'CN', 'US', 'CA', 'MX', 'BR', 'KR', 'JP', 'IN', 'AU', 'OTHER'] as const;
export type Market = (typeof MARKETS)[number];
export const TYPE_APPROVAL_IMPACTS = ['NONE', 'INFO_PACKAGE_UPDATE', 'EXTENSION_REQUIRED'] as const;
export const DATA_CATEGORIES = ['SAFETY_OPERATION', 'SECURITY_MONITORING', 'COMMERCIAL_USAGE'] as const;

/** RFC 3339 시각(UTC 또는 오프셋) */
const DateTime = z.string().datetime({ offset: true });
/** base64url — 길이 하한·고정 */
const b64url = (min: number, exact = false) => z.string().regex(exact ? new RegExp(`^[A-Za-z0-9_-]{${min}}$`) : new RegExp(`^[A-Za-z0-9_-]{${min},}$`));

export const KillApproval = z
  .object({
    approver_id: z.string(),
    role: z.enum(APPROVER_ROLES),
    signed_at: DateTime,
    approval_sig: b64url(64),
  })
  .strict();
export type KillApproval = z.infer<typeof KillApproval>;

/** 차량별 봉투 — cmd_auth = 차량 명령 키(key_epoch)로 만든 AES-CMAC-128(9.2절 32바이트 블록) */
export const VehicleAuth = z
  .object({
    key_epoch: z.number().int().min(0).max(255),
    vehicle_seq: z.number().int().min(1).max(4294967295),
    approver_refs: z.array(z.number().int().min(1).max(65535)).length(2),
    cmd_auth: b64url(22, true),
    resync_ref: z.number().int().min(0).max(65535).optional(),
  })
  .strict();
export type VehicleAuth = z.infer<typeof VehicleAuth>;

export const KillCommandV2 = z
  .object({
    type: z.literal('kill_command'),
    schema_version: z.literal('2.0'),
    command_id: z.string().uuid(),
    command_seq: z.number().int().min(1),
    request: z.enum(KILL_REQUESTS),
    feature: z
      .object({
        id: z.string().regex(/^FEAT-[0-9]{5}$/),
        version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
        f_class: z.enum(F_CLASSES),
        deact_class: z.enum(DEACT_CLASSES),
      })
      .strict(),
    reason: z
      .object({
        category: z.enum(REASON_CATEGORIES),
        code: z.string().regex(/^[A-Z0-9_]{3,40}$/),
        incident_id: z.string().optional(),
      })
      .strict(),
    scope: z
      .object({
        vehicle_ids: z
          .array(z.string().regex(/^[A-Za-z0-9_-]{4,64}$/))
          .min(1)
          .max(10000),
        cohort_id: z.string().optional(),
        max_vehicles: z.number().int().min(1),
      })
      .strict(),
    target: z
      .object({
        market: z.enum(MARKETS),
        ecu_id: z.string(),
        sw_id: z.string(),
        sw_version: z.string(),
        rxswin: z.string(),
      })
      .strict(),
    validity: z.object({ not_before: DateTime, expires_at: DateTime }).strict(),
    approvals: z.array(KillApproval).min(2),
    regulatory: z
      .object({
        type_approval_impact: z.enum(TYPE_APPROVAL_IMPACTS),
        r156_assessment_id: z.string(),
        cn_filing_id: z.string().optional(),
        recall_campaign_id: z.string().optional(),
        containment_justification: z.string().optional(),
      })
      .strict(),
    user_notice: z
      .object({
        required: z.boolean(),
        text_ref: z.string().optional(),
        user_confirmation_required: z.boolean().optional(),
      })
      .strict(),
    evidence: z
      .object({
        evidence_manifest_id: z.string(),
        bom_baseline_id: z.string().optional(),
        sbom_ref: z.string().optional(),
      })
      .strict(),
    issued_by: z.string(),
    issued_at: DateTime,
    // JWS(RFC 7515) 분리 서명 — 원시 r‖s 64바이트(base64url 86자). DER 형식은 받지 않는다
    signature: z
      .object({
        alg: z.enum(['ES256', 'EdDSA']),
        kid: z.string(),
        value: b64url(86, true),
      })
      .strict(),
    vehicle_auth: VehicleAuth.optional(),
  })
  .strict()
  // dependentSchemas: 차량 봉투는 차량 1대
  .refine((c) => !c.vehicle_auth || c.scope.vehicle_ids.length <= 1, { message: '차량 봉투(vehicle_auth)는 차량 1대만 담는다', path: ['scope', 'vehicle_ids'] });
export type KillCommandV2 = z.infer<typeof KillCommandV2>;

export const StatusReportV2 = z
  .object({
    type: z.literal('status_report'),
    schema_version: z.literal('2.0'),
    vehicle_pseudonym: z.string().regex(/^[a-f0-9]{16,64}$/),
    feature: z.object({ id: z.string().regex(/^FEAT-[0-9]{5}$/), version: z.string() }).strict(),
    state: z.enum(GUARD_STATES),
    reason: z.object({ category: z.enum(REASON_CATEGORIES), source: z.enum(REPORT_SOURCES) }).strict(),
    request_result: z.enum(REQUEST_RESULTS),
    reject_code: z.enum(REJECT_CODES).optional(),
    vehicle_seq: z.number().int().min(0),
    durable: z.boolean(),
    hmi: z.enum(HMI_STATES),
    feature_weight_permille: z.number().int().min(0).max(1000),
    policy_hash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    dtc: z.array(z.string().regex(/^[0-9A-F]{6}$/)).optional(),
    edr_aligned_state: z.enum(EDR_STATES),
    received_at: DateTime.nullable().optional(),
    applied_at: DateTime.nullable().optional(),
    observed_at: DateTime,
    time_sync: z.enum(TIME_SYNC),
    offline_since: DateTime.nullable().optional(),
    data_category: z.enum(DATA_CATEGORIES),
    key_epoch: z.number().int().min(0).max(255),
    report_seq: z.number().int().min(1).max(4294967295),
    state_auth: b64url(22, true),
    persistence: z.enum(PERSISTENCE),
  })
  .strict();
export type StatusReportV2 = z.infer<typeof StatusReportV2>;

/** 스키마 오류를 "경로: 메시지" 목록으로 — 게이트의 FFG-PLT-001 판정과 화면 표시에 쓴다 */
export function wireErrors(schema: z.ZodTypeAny, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const path = i.path.join('/') || '<root>';
    const keys = i.code === 'unrecognized_keys' ? ` (${i.keys.join(', ')})` : '';
    return `${path}: ${i.message}${keys}`;
  });
}
