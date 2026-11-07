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
  REJECT_CODES_V2_1,
  REPORT_SOURCES,
  REQUEST_RESULTS,
  TIME_SYNC,
} from './safety';
import { VERDICT_ACTIONS } from '../rules/ads-state';

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

// ── 상태 보고 2.1 (ADS-BE01·BE07·FFP-F031, D-ADS-1) — 2.0 필드 그대로 + 판정·전달 단계·제어 책임·차단·MRC·복구·Feature epoch ──
// 플랫폼은 2.0과 2.1을 함께 받는다(schema_version으로 고른다). 정본 JSON Schema 초안: harness/wire/status_report.v2_1.schema.json
// (FF_IMP gleo/schema 반영은 ADS-SIM04, 사용자 확인 뒤 별도 커밋). 판정 입력(decision.inputs)에 상업 상태는 넣지 않는다 — commercial 블록은 따로.

/** 실제 실행 상태(6축 실제 실행) — rules/ads-state RUNTIME_STATES와 같은 목록(시험이 대조) */
export const RUNTIME_STATES_V2_1 = ['INACTIVE', 'AVAILABLE', 'ACTIVE', 'IN_TRANSITION', 'MRC', 'TERMINATED', 'RECOVERY_PENDING'] as const;
/** 동적 운전 작업(DDT) 수행 주체 */
export const DDT_OWNERS = ['ADS', 'USER', 'FALLBACK', 'NONE', 'UNKNOWN'] as const;
export const ODD_STATES = ['IN', 'OUT', 'UNKNOWN'] as const;
/** 판정 입력 출처 — 상업(권리·결제)은 판정 입력이 아니다(commercial 블록) */
export const DECISION_INPUT_SOURCES = ['SENSOR', 'VEHICLE_BUS', 'LOCALIZATION', 'MAP', 'HMI', 'DIAGNOSTIC'] as const;
export const INPUT_TRUST = ['TRUSTED', 'DEGRADED', 'UNTRUSTED'] as const;
export const INPUT_QUALITY = ['OK', 'DEGRADED', 'INVALID'] as const;
export const VERDICT_VALUES = ['ALLOW', 'DENY', 'UNKNOWN'] as const;
export const DELIVERY_SUBJECT_KINDS = ['POLICY', 'KILL', 'RESTORE', 'RESCIND'] as const;
export const DELIVERY_STAGES = ['RECEIVED', 'ACCEPTED', 'DEFERRED', 'APPLIED', 'REJECTED'] as const;
/** MRC 정지 유지 수단 */
export const MRC_HOLD_MEANS = ['EPB', 'P_LOCK', 'SERVICE_BRAKE_HOLD', 'OTHER'] as const;
export const COMMERCIAL_STATES = ['NONE', 'TRIAL', 'ACTIVE', 'EXPIRED', 'REVOKED'] as const;

const Sha256Ref = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const WireRef = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
/** 종료 차단 참조 — 사건 ID(incident_id) 또는 명령 ID */
export const InhibitRef = z.string().regex(/^[A-Za-z0-9_.:-]{3,64}$/);

export const DecisionInput = z
  .object({
    signal: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/),
    source: z.enum(DECISION_INPUT_SOURCES),
    valid: z.boolean(),
    trust: z.enum(INPUT_TRUST),
    local_ts: DateTime,
    max_age_ms: z.number().int().min(1),
  })
  .strict();
export type DecisionInput = z.infer<typeof DecisionInput>;

/** 차량 안전 판정(행위별) — decision_id는 실행·설치 보고가 참조한다. valid_until 뒤에는 그 판정을 다시 쓰지 않는다 */
export const SafetyDecision = z
  .object({
    decision_id: z.string().uuid(),
    action: z.enum(VERDICT_ACTIONS),
    verdict: z.enum(VERDICT_VALUES),
    reason_codes: z.array(z.string().regex(/^[A-Z0-9_]{3,40}$/)).max(16),
    session_id: WireRef.optional(),
    sample_ref: WireRef.optional(),
    config_ref: WireRef.optional(),
    odd_ref: WireRef.optional(),
    input_quality: z.enum(INPUT_QUALITY),
    odd_state: z.enum(ODD_STATES),
    odd_input_valid_until: DateTime.optional(),
    odd_exit_forecast: z.object({ expected_exit_at: DateTime, required_transition_ms: z.number().int().min(0), plan_started_at: DateTime.nullable() }).strict().optional(),
    inputs: z.array(DecisionInput).min(1).max(64),
    valid_until: DateTime,
    evaluated_state_digest: Sha256Ref,
  })
  .strict();
export type SafetyDecision = z.infer<typeof SafetyDecision>;

/** 전달 단계 — 정책 게시본·차단·복원·선택 해제를 받았는지·수락했는지·보류했는지·적용했는지(수신만으로 적용으로 세지 않는다) */
export const DeliveryReport = z
  .object({
    subject_kind: z.enum(DELIVERY_SUBJECT_KINDS),
    subject_id: WireRef,
    stage: z.enum(DELIVERY_STAGES),
    reason_code: z.string().regex(/^[A-Z0-9_]{3,40}$/).optional(),
    decision_id: z.string().uuid().optional(),
  })
  .strict();
export type DeliveryReport = z.infer<typeof DeliveryReport>;

export const StatusReportV2_1 = z
  .object({
    ...StatusReportV2.shape,
    schema_version: z.literal('2.1'),
    reject_code: z.enum(REJECT_CODES_V2_1).optional(),
    /** 차량이 이 보고를 만든 시각(관측 시각 observed_at과 다를 수 있다) */
    reported_at: DateTime,
    runtime_state: z.enum(RUNTIME_STATES_V2_1),
    ddt_owner: z.enum(DDT_OWNERS).optional(),
    /** 차량이 적용한 Feature epoch — 이보다 낮은 정책 게시본은 차량이 STALE_EPOCH로 거부한다(ADS-BE07) */
    feature_epoch: z.number().int().min(0),
    /** 차량이 지금 걸고 있는 종료 차단 */
    inhibits: z.array(InhibitRef).max(64),
    decision: SafetyDecision.optional(),
    delivery: DeliveryReport.optional(),
    /** MRC 도달 — 정지 유지 수단·위험 저감 근거가 비면 플랫폼은 MRC 미달성으로 기록한다(FFP-F031) */
    mrc: z.object({ reached_at: DateTime, hold_means: z.enum(MRC_HOLD_MEANS).nullable(), risk_mitigation_ref: WireRef.nullable() }).strict().optional(),
    /** 재시동 뒤 복구 확인 — 무결성과 다시 건 종료 차단 */
    restore: z.object({ booted_at: DateTime, integrity: z.enum(['OK', 'FAILED']), inhibits_restored: z.array(InhibitRef).max(64) }).strict().optional(),
    /** 상품 권리 — 판정 입력이 아니다(decision.inputs와 분리) */
    commercial: z.object({ entitlement_state: z.enum(COMMERCIAL_STATES), effective_at: DateTime }).strict().optional(),
  })
  .strict();
export type StatusReportV2_1 = z.infer<typeof StatusReportV2_1>;

/** 2.0 또는 2.1 — 수신 검사·GLEO 수신이 schema_version으로 고른다 */
export type StatusReport = StatusReportV2 | StatusReportV2_1;
export const STATUS_SCHEMA_VERSIONS = ['2.0', '2.1'] as const;
export const statusReportSchemaOf = (report: unknown) => ((report as { schema_version?: unknown } | null)?.schema_version === '2.1' ? StatusReportV2_1 : StatusReportV2);
/** 경로 본문(OpenAPI) — 2.0 또는 2.1 */
export const StatusReportBody = z.union([StatusReportV2, StatusReportV2_1]);

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
