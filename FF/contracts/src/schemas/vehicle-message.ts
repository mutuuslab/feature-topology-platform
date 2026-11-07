// 차량 서명 메시지(FFV1-MSG)·Lake 중계 기록·중계 검증 결과 계약 (TL-M01) — 차량 → Data Lake → FF 안전 메시지 중계.
// 설계: docs/80-integration/80-75-data-lake-server.md 3.2·4장, JSON Schema: docs/80-integration/datalake-if15/{vehicle-message,relay-record,relay.verdict}.schema.json
// (zod ↔ JSON Schema 대조는 vehicle-message.test.ts). 차량·Lake·FF가 같은 정규 문자열과 시험 벡터(vehicle-message.vectors.ts)를 쓴다.
// 서명: AES-CMAC-128(K_r, 정규 문자열) — K_r은 FFV1-REQ와 같은 요청 키(rules/vehicle-auth.ts). 머리말이 달라 두 서명을 서로 옮겨 쓸 수 없다.
// 정규 문자열(UTF-8, 줄바꿈 \n): FFV1-MSG / kind / ref(없으면 -) / 차량 가명 / key epoch / 시각(차량 시계 ms) / nonce / 본문 원문 SHA-256(소문자 hex)
import { z } from 'zod';
import { STATUS_CHECK_STEPS } from '../rules/status-v2';

export const VEHICLE_MESSAGE_SCHEMA = 'ff.vehicle.msg/1';
export const VEHICLE_MESSAGE_VERSION = 'FFV1-MSG';
export const VEHICLE_MESSAGE_KINDS = ['STATUS_REPORT', 'INBOX_ACK', 'VEHICLE_REPORT'] as const;
export type VehicleMessageKind = (typeof VEHICLE_MESSAGE_KINDS)[number];
export const RELAY_STREAMS = ['SAFETY', 'NORMAL'] as const;
export type RelayStream = (typeof RELAY_STREAMS)[number];
/** 종류 → 흐름 — 차단·복원·배포 확인(상태 보고·전달 확인)은 safety, 차량 보고는 normal(80-75 4.2) */
export const relayStreamOf = (kind: VehicleMessageKind): RelayStream => (kind === 'VEHICLE_REPORT' ? 'NORMAL' : 'SAFETY');

/** 미래 허용 — 차량 시각이 FF 시계보다 이만큼 넘게 앞서면 거부(FFV1-REQ 허용 시각 차와 같다) */
export const VEHICLE_MESSAGE_FUTURE_MS = 5 * 60_000;
/** 받아 주는 최대 나이 — 넘으면 STALE(결정 U-15: 차량 보관 기간 72시간과 같게) */
export const VEHICLE_MESSAGE_MAX_AGE_MS = 72 * 3600_000;
/** nonce 창 — 이 안에 같은 nonce가 있으면 같은 본문 = DUPLICATE, 다른 본문 = REQUEST_REPLAY */
export const VEHICLE_MESSAGE_NONCE_WINDOW_MS = VEHICLE_MESSAGE_MAX_AGE_MS;
/** 본문 원문 최대 크기(64 KiB) */
export const VEHICLE_MESSAGE_MAX_BODY_BYTES = 64 * 1024;

export const VEHICLE_MESSAGE_FORMAT = {
  pseudonym: /^[a-f0-9]{16,64}$/,
  nonce: /^[A-Za-z0-9_-]{16,64}$/,
  messageId: /^[a-f0-9]{16,64}:[A-Za-z0-9_-]{16,64}$/,
  timestamp: /^\d{10,16}$/,
  mac: /^[A-Za-z0-9_-]{22}$/,
  bodyB64: /^[A-Za-z0-9+/]*={0,2}$/,
  sha256: /^[a-f0-9]{64}$/,
} as const;

export interface VehicleMessageParts {
  kind: VehicleMessageKind;
  /** INBOX_ACK의 deliveryId, 그 밖에는 null(정규 문자열에서는 '-') */
  ref: string | null;
  pseudonym: string;
  keyEpoch: number;
  /** 차량 시계 유닉스 ms 10진 문자열 — 서명한 글자 그대로 */
  timestamp: string;
  nonce: string;
  /** 본문 원문 바이트 SHA-256 소문자 hex */
  bodySha256: string;
}

export const vehicleMessageCanonical = (p: VehicleMessageParts) => [VEHICLE_MESSAGE_VERSION, p.kind, p.ref ?? '-', p.pseudonym, String(p.keyEpoch), p.timestamp, p.nonce, p.bodySha256].join('\n');

/** 멱등 키 — <가명>:<nonce> */
export const vehicleMessageIdOf = (pseudonym: string, nonce: string) => `${pseudonym}:${nonce}`;

/** 차량 서명 메시지 v1(ff.vehicle.msg/1) — vehicle-message.schema.json과 같은 모양 */
export const VehicleMessage = z
  .object({
    schema: z.literal(VEHICLE_MESSAGE_SCHEMA),
    message_id: z.string().regex(VEHICLE_MESSAGE_FORMAT.messageId),
    pseudonym: z.string().regex(VEHICLE_MESSAGE_FORMAT.pseudonym),
    kind: z.enum(VEHICLE_MESSAGE_KINDS),
    ref: z.string().max(80).nullable(),
    auth: z
      .object({
        scheme: z.literal(VEHICLE_MESSAGE_VERSION),
        key_epoch: z.number().int().min(1).max(999_999_999),
        timestamp: z.string().regex(VEHICLE_MESSAGE_FORMAT.timestamp),
        nonce: z.string().regex(VEHICLE_MESSAGE_FORMAT.nonce),
        mac: z.string().regex(VEHICLE_MESSAGE_FORMAT.mac),
      })
      .strict(),
    body_b64: z.string().max(87_384).regex(VEHICLE_MESSAGE_FORMAT.bodyB64),
    body_sha256: z.string().regex(VEHICLE_MESSAGE_FORMAT.sha256),
  })
  .strict()
  // JSON Schema if/then/else — INBOX_ACK는 전달 ID가 있어야 하고, 그 밖에는 null
  .refine((m) => (m.kind === 'INBOX_ACK' ? typeof m.ref === 'string' && m.ref.length >= 1 : m.ref === null), { message: 'INBOX_ACK는 ref(전달 ID)가 있어야 하고, 그 밖의 종류는 ref가 null이어야 합니다', path: ['ref'] });
export type VehicleMessage = z.infer<typeof VehicleMessage>;

/** 중계 기록 v1 — Lake가 받은 메시지를 바꾸지 않고 relay_seq·stream·received_at만 덧붙인다 */
export const RelayRecord = z
  .object({
    relay_seq: z.number().int().min(1),
    stream: z.enum(RELAY_STREAMS),
    received_at: z.iso.datetime({ offset: true }),
    message: VehicleMessage,
  })
  .strict()
  .refine((r) => relayStreamOf(r.message.kind) === r.stream, { message: 'SAFETY 흐름은 STATUS_REPORT·INBOX_ACK, NORMAL 흐름은 VEHICLE_REPORT만 싣습니다', path: ['stream'] });
export type RelayRecord = z.infer<typeof RelayRecord>;

export const RELAY_OUTCOMES = ['ACCEPTED', 'DUPLICATE', 'REJECTED', 'STALE'] as const;
export type RelayOutcome = (typeof RELAY_OUTCOMES)[number];
export const RELAY_CHECK_LAYERS = ['MESSAGE_AUTH', 'STATUS_CHECK', 'HANDLER'] as const;
export type RelayCheckLayer = (typeof RELAY_CHECK_LAYERS)[number];

/** 바깥 서명(FFV1-MSG) 층에서 떨어지는 코드 — 재전송·서명 불일치·시각은 FFV1-REQ와 같은 코드(보안 이벤트 분류가 같다) */
export const VEHICLE_MESSAGE_FAILURES = {
  MESSAGE_SCHEMA_INVALID: '메시지 형식(ff.vehicle.msg/1)이 맞지 않습니다',
  MESSAGE_ID_MISMATCH: 'message_id가 <가명>:<nonce>가 아닙니다',
  BODY_HASH_MISMATCH: '본문 원문의 SHA-256이 body_sha256과 다릅니다',
  UNKNOWN_VEHICLE: '등록되지 않은 차량 가명입니다',
  REQUEST_KEY_EPOCH: '차량 키 epoch를 찾을 수 없습니다',
  REQUEST_MAC_INVALID: '메시지 서명(CMAC)이 맞지 않습니다',
  REQUEST_TIME_SKEW: '차량 시각이 플랫폼 시계보다 5분 넘게 앞섭니다',
  MESSAGE_STALE: '받을 수 있는 나이(72시간)를 넘었습니다',
  REQUEST_REPLAY: '같은 nonce로 다른 본문이 왔습니다(재전송 공격 의심)',
} as const;
export type VehicleMessageFailure = keyof typeof VEHICLE_MESSAGE_FAILURES;

/** relay.verdict v1 — FF가 중계받은 메시지마다 Lake에 돌려주는 검증·처리 결과(80-75 4.6) */
export const RelayVerdict = z
  .object({
    message_id: z.string().regex(VEHICLE_MESSAGE_FORMAT.messageId),
    relay_seq: z.number().int().min(1),
    stream: z.enum(RELAY_STREAMS),
    kind: z.enum(VEHICLE_MESSAGE_KINDS),
    outcome: z.enum(RELAY_OUTCOMES),
    check: z
      .object({
        layer: z.enum(RELAY_CHECK_LAYERS),
        step: z.enum(STATUS_CHECK_STEPS as [string, ...string[]]).nullable(),
        code: z.string().regex(/^[A-Z0-9_]+$/).max(60),
      })
      .strict()
      .nullable(),
    relay_latency_ms: z.number().int().nullable(),
  })
  .strict();
export type RelayVerdict = z.infer<typeof RelayVerdict>;
