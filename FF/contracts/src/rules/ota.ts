// OTA 서버 연동 규격 IF-05 v1 — FF(서명·대상 결정) ↔ 고객 OTA 서버(차량 전달·진행 추적·결과 통보).
// 규격 문서: docs/80-integration/80-45-ota-server-if05.md · OpenAPI: docs/80-integration/ota-if05.openapi.json
// 여기에는 양쪽이 같이 쓰는 값(판 번호·결과 값·오류 코드·webhook 본문 형식)만 둔다 — 서명·HTTP는 백엔드 어댑터(adapters/ota)에.
// 호환 규칙: 필드는 추가만 한다(이름·뜻·형식을 바꾸거나 빼지 않는다). 받는 쪽은 모르는 필드를 무시한다(z.object 기본 strip).
import { z } from 'zod';

/** 규격 판 — 요청·응답 머리글 OTA-Spec-Version. 주 번호가 같으면 서로 맞는다(부 번호는 추가만) */
export const OTA_SPEC_VERSION = '1.0';
export const OTA_SPEC_HEADER = 'ota-spec-version';

/**
 * 차량별 전달 결과(OTA 서버의 전달 기록) — DELIVERED만 중간 경과, 나머지는 그 차량의 끝 결과.
 * 회신 집계(IF-06)에는 들어가지 않는다: 차량 자신의 회신(적용 readback·서명된 status_report v2·확인)은 차량 → Data Lake → FF로 오고,
 * 그것이 끝 상태를 정한다(80-45 §7.5). OTA 결과는 전달 진행·차량 회신이 없을 때의 사유 표시에만 쓴다.
 */
export const OTA_VEHICLE_OUTCOMES = ['DELIVERED', 'APPLIED', 'REFUSED', 'SIGNATURE_FAILED', 'NO_RESPONSE', 'CANCELLED', 'NOT_ELIGIBLE'] as const;
export type OtaVehicleOutcome = (typeof OTA_VEHICLE_OUTCOMES)[number];
/** 차량이 OTA 서버에 알린 결과 — OTA 서버가 추정한 결과(NO_RESPONSE·CANCELLED·NOT_ELIGIBLE)보다 앞선다(OTA 전달 기록 안에서) */
export const OTA_VEHICLE_REPORTED: readonly OtaVehicleOutcome[] = ['APPLIED', 'REFUSED', 'SIGNATURE_FAILED'];

/** OTA 서버의 작업 상태(조회 응답·job.state 이벤트) */
export const OTA_SERVER_JOB_STATES = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'] as const;
export type OtaServerJobState = (typeof OTA_SERVER_JOB_STATES)[number];

/**
 * FF 쪽 전달 상태 — 게시본은 서명된 채 남고 전달만 이 상태를 가진다.
 * RETRY_WAIT = 전달 실패(재시도 가능, 자동 재시도 대기) · FAILED = 전달 실패(자동 재시도 끝 또는 고칠 수 없는 오류 — 수동 재시도)
 */
export const OTA_DELIVERY_STATES = ['QUEUED', 'SUBMITTED', 'RETRY_WAIT', 'FAILED', 'EXPIRED', 'CANCELLED', 'COMPLETED'] as const;
export type OtaDeliveryState = (typeof OTA_DELIVERY_STATES)[number];
/** 수동 재시도를 받는 상태 */
export const OTA_RETRYABLE_STATES: readonly OtaDeliveryState[] = ['RETRY_WAIT', 'FAILED'];

/** OTA 서버 오류 코드(본문 {error:{code,message,retryable}}) — FF가 재시도할지 정하는 표(규격 8장) */
export const OTA_ERROR_CODES = {
  VALIDATION: { status: 400, retryable: false },
  UNSUPPORTED_SPEC_VERSION: { status: 400, retryable: false },
  UNAUTHENTICATED: { status: 401, retryable: true },
  FORBIDDEN: { status: 403, retryable: false },
  JOB_NOT_FOUND: { status: 404, retryable: false },
  IDEMPOTENCY_CONFLICT: { status: 409, retryable: false },
  JOB_FINAL: { status: 409, retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false },
  DEADLINE_PASSED: { status: 422, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  INTERNAL: { status: 500, retryable: true },
  UNAVAILABLE: { status: 503, retryable: true },
} as const;
export type OtaErrorCode = keyof typeof OTA_ERROR_CODES;

/** webhook 서명 허용 시각 차(초) — 이보다 오래되거나 앞선 서명은 재전송으로 보고 401 */
export const OTA_WEBHOOK_TOLERANCE_SEC = 300;

const vin = z.string().trim().min(1).max(64);

/** 차량 1대의 전달 결과(webhook results[]) — 전달 기록. 차량 회신(readback·상태 보고)은 싣지 않는다(차량 → Lake → FF) */
export const OtaVehicleResult = z.object({
  vin,
  outcome: z.enum(OTA_VEHICLE_OUTCOMES),
  /** OTA 서버가 결과를 안 시각(ISO 8601) */
  at: z.string().min(1).max(40),
  /** REFUSED·SIGNATURE_FAILED — 차량이 OTA 서버에 알린 거부 코드(그대로) */
  rejectReason: z.string().trim().min(1).max(60).optional(),
  /** 사람이 읽을 설명(선택) */
  detail: z.string().max(500).optional(),
});
export type OtaVehicleResult = z.infer<typeof OtaVehicleResult>;

/** OTA → FF webhook 본문(POST /api/ota/v1/events) — type은 vehicle.results·job.state, 모르는 type은 받기만 한다 */
export const OtaEvent = z.object({
  specVersion: z.string().regex(/^\d+\.\d+$/),
  eventId: z.string().trim().min(8).max(100),
  type: z.string().trim().min(1).max(60),
  jobId: z.string().trim().min(1).max(100),
  otaJobId: z.string().trim().min(1).max(100).optional(),
  occurredAt: z.string().min(1).max(40),
  results: z.array(OtaVehicleResult).max(1000).optional(),
  state: z.enum(OTA_SERVER_JOB_STATES).optional(),
});
export type OtaEvent = z.infer<typeof OtaEvent>;

/** 수동 재시도·취소 본문 */
export const OtaJobActionBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type OtaJobActionBody = z.infer<typeof OtaJobActionBody>;

/** 같은 주 번호면 맞는다 */
export const otaSpecCompatible = (v: string | null | undefined) => !!v && /^\d+\.\d+$/.test(v) && v.split('.')[0] === OTA_SPEC_VERSION.split('.')[0];
