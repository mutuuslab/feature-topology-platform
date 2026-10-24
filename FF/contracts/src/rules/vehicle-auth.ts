// 차량 요청 인증(출시 준비 RD-SEC-08)과 차량 당겨받기 채널(RD-OPS-04)의 계약 — 차량·플랫폼이 같은 정규 문자열과 머리글을 쓴다.
// 서명: AES-CMAC-128(RFC 4493), 키 = HKDF(차량 키, "ffp-request-auth", "ffp-vehicle-request-key|v1") 16바이트.
//   차량 키 = HKDF(epoch 루트, "epoch:<n>", "ffp-vehicle-key|<VIN>") — 봉투 cmd_auth·상태 증명 state_auth(SecOC)와 같은 차량 키에서 용도만 나눈다.
// 정규 문자열(UTF-8, 줄바꿈 \n): FFV1-REQ / 메서드 / 경로(쿼리 포함, 보낸 그대로) / VIN / key epoch / 시각(유닉스 ms) / nonce / 본문 SHA-256(소문자 hex, 빈 본문도)
// 재전송 방지: 시각은 플랫폼 시계 ±VEHICLE_AUTH_SKEW_MS 안, nonce는 VIN마다 창 안에서 한 번만.
// 프로토콜 문서: docs/80-integration/80-40-vehicle-channel.md
import { z } from 'zod';

export const VEHICLE_AUTH_VERSION = 'FFV1-REQ';

/** 요청 머리글(소문자) */
export const VEHICLE_AUTH_HEADERS = {
  vin: 'x-vehicle-id',
  epoch: 'x-vehicle-key-epoch',
  timestamp: 'x-vehicle-timestamp',
  nonce: 'x-vehicle-nonce',
  mac: 'x-vehicle-mac',
} as const;

/** 허용 시각 차(±) — 지나면 REQUEST_TIME_SKEW */
export const VEHICLE_AUTH_SKEW_MS = 5 * 60_000;

/** 요청 인증 실패 원천 코드 — 보안 이벤트(14.4)로 센다(security-events.ts) */
export const VEHICLE_AUTH_FAILURES = {
  REQUEST_AUTH_MISSING: '서명 머리글이 없습니다',
  REQUEST_AUTH_MALFORMED: '서명 머리글 형식이 맞지 않습니다',
  REQUEST_MAC_INVALID: '요청 서명(CMAC)이 맞지 않습니다',
  REQUEST_KEY_EPOCH: '차량 키 epoch가 현재가 아닙니다',
  REQUEST_TIME_SKEW: '요청 시각이 허용 범위 밖입니다',
  REQUEST_REPLAY: '이미 받은 요청(nonce)입니다',
  REQUEST_IDENTITY_MISMATCH: '인증서 주체와 차량 신원이 다릅니다',
  REQUEST_PROXY_UNTRUSTED: '신뢰하지 않는 경로에서 온 인증서 주체 머리글입니다',
} as const;
export type VehicleAuthFailure = keyof typeof VEHICLE_AUTH_FAILURES;

export interface VehicleRequestParts {
  method: string;
  /** 요청 대상 그대로(경로 + 쿼리) — 예: /vehicle/v1/KMH-NX4-0002/inbox?limit=10 */
  path: string;
  vin: string;
  keyEpoch: number;
  /** 유닉스 시각(ms) 10진 문자열 */
  timestamp: string;
  nonce: string;
  /** 본문 원문 바이트의 SHA-256 소문자 hex */
  bodySha256: string;
}

export const vehicleRequestCanonical = (p: VehicleRequestParts) => [VEHICLE_AUTH_VERSION, p.method.toUpperCase(), p.path, p.vin, String(p.keyEpoch), p.timestamp, p.nonce, p.bodySha256].join('\n');

export const VEHICLE_AUTH_FORMAT = {
  vin: /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/,
  epoch: /^[1-9]\d{0,8}$/,
  timestamp: /^\d{10,16}$/,
  nonce: /^[A-Za-z0-9_-]{16,64}$/,
  /** 16바이트 태그 base64url */
  mac: /^[A-Za-z0-9_-]{22}$/,
} as const;

// ── 차량 당겨받기 채널(vehicle-pull HTTPS) ─────────────────────

/** 차량 전달 채널 — sim(내부 시뮬레이터, 데모 기본) | pull(차량이 HTTPS로 당겨받기, 운영 기본) | 고객 게이트웨이 어댑터 이름 */
export const VEHICLE_CHANNELS = ['sim', 'pull'] as const;

/** 차량이 받은 전달에 대한 확인 — 적용(APPLIED) 또는 차량 Guard 거부(REJECTED, 사유 코드) */
export const VehicleDeliveryAck = z
  .object({
    /** 차량 부팅 식별자 — 회신 집계가 같은 부팅의 회신인지 본다 */
    bootId: z.string().trim().min(1).max(80),
    result: z.enum(['APPLIED', 'REJECTED']),
    /** 적용 후 되읽은 값(정책 contentHash·차단 safe mode 등). 거부면 생략 가능 */
    observed: z.string().trim().min(1).max(200).optional(),
    /** 차량이 검증한 게시본 서명의 payloadHash — 차량이 실제로 적용한 본문 */
    policyHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    rejectReason: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .refine((a) => a.result === 'REJECTED' || !!a.observed, { message: 'APPLIED에는 observed(되읽은 값)가 필요합니다', path: ['observed'] })
  .refine((a) => a.result === 'APPLIED' || !!a.rejectReason, { message: 'REJECTED에는 rejectReason이 필요합니다', path: ['rejectReason'] });
export type VehicleDeliveryAck = z.infer<typeof VehicleDeliveryAck>;

/** 한 번에 내주는 전달 수 상한 — 더 있으면 more: true */
export const VEHICLE_INBOX_LIMIT = 50;
