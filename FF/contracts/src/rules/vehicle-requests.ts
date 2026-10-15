// 차량 발신 요청 (D02-03 차량 런타임 · D05-01 API Gateway) — 차량이 먼저 플랫폼을 부르는 창구의 규칙.
// 조회는 IF-10 원격 평가(OFREP 응답 형식), 업데이트는 IF-06 차량 보고(관측값·회신·오류·체험 수락·재부팅/재연결 대사).
// 설계 근거: UL-026(사용자가 market/trim/entitlementValid를 변조해도 신뢰 원천을 우회하지 못함)·UL-AC-060(HMI 입력이 안전 제어점 인가를 우회하지 않음)
//   → 차량은 Flag 값을 직접 바꾸지 못하고, 신뢰 원천 속성(국가·차종·트림 등)도 바꾸지 못한다.
// UL-DD-09(노드 identity는 인증된 OEM 경로와 결속)·UL-029(targetingKey는 차량 단위 식별자) → 차량은 자기 VIN만 조회·보고한다.
// UL-DD-10·C23-AC01(낮은 sequence·과거 boot 보고가 최신 상태를 덮어쓰지 않음)·UL-065(재부팅 후 재연결 시 먼저 대사) → 멱등·부팅 규칙.
import { z } from 'zod';
import { ReadbackBody } from '../schemas/ops';
import { AttestationEntry } from './attestation';

/** 차량이 보고로 바꿀 수 있는 관측 속성 — 나머지 Vehicle 속성은 신뢰 원천(제조·판매 기준 정보)이라 거부 */
export const VEHICLE_OBSERVED_FIELDS = {
  swVersion: z.string().trim().min(1).max(40),
  quality: z.enum(['TRUSTED', 'STALE', 'UNTRUSTED']),
  link: z.enum(['ONLINE', 'OFFLINE']),
} as const;
export type VehicleObservedField = keyof typeof VEHICLE_OBSERVED_FIELDS;
export type VehicleObservedSet = { [K in VehicleObservedField]?: z.infer<(typeof VEHICLE_OBSERVED_FIELDS)[K]> };

export const FaultSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);

const Seq = {
  /** 차량 부팅 식별자 — 바뀌면 HELLO로 먼저 대사한다 */
  bootId: z.string().trim().min(1).max(80),
  /** 부팅 안에서 단조 증가하는 보고 번호 — (vin, bootId, sequence)가 멱등 키 */
  sequence: z.number().int().min(0),
  observedAt: z.string().min(10),
};

export const VehicleReportBody = z.discriminatedUnion('type', [
  /** 재부팅·재연결 — 차량이 가진 정책 범위별 최고 sequence를 알려 주면 빠진 서명 게시본을 돌려준다 */
  z.object({ type: z.literal('HELLO'), ...Seq, highest: z.record(z.string(), z.number().int().min(0)).default({}) }).strict(),
  /** 관측값 변경 후 재평가 요청 — set의 키는 VEHICLE_OBSERVED_FIELDS만 (검사는 checkObservedSet: 거부 사유를 TRUST_SOURCE_FIELD로 알려 주려고 스키마는 열어 둔다) */
  z.object({ type: z.literal('CONTEXT'), ...Seq, set: z.record(z.string(), z.unknown()) }).strict(),
  /** IVI 사용자의 체험 수락 — 서버의 체험권 사용 처리(1회권 소진)를 거친다. 차량이 사용 권한을 직접 켜지 못한다 */
  z.object({ type: z.literal('TRIAL_ACCEPT'), ...Seq, catalogId: z.string().regex(/^CAT-\d{5}$/) }).strict(),
  /** 차량 애플리케이션·제어기 오류 이벤트 (오류 코드·심각도·발생 시각) */
  z.object({ type: z.literal('FAULT'), ...Seq, featureId: z.string().regex(/^FEAT-\d{5}$/), code: z.string().trim().min(1).max(60), severity: FaultSeverity, detail: z.string().max(500).optional() }).strict(),
  /** 적용 결과 회신 — IF-06 수집으로 넘긴다 (vin·bootId는 보고 봉투 값을 쓴다) */
  z.object({ type: z.literal('READBACK'), ...Seq, readback: ReadbackBody.omit({ vin: true, bootId: true }) }).strict(),
  /** Flag 값 직접 변경 — 항상 거부한다. 스키마에 두는 이유는 차량이 VALIDATION이 아니라 명시적인 거부 사유를 받게 하려는 것 */
  // 실제 구성 Attestation(FFG-VEH-007) — 적용 중인 정책 해시·Feature Version·BOM 식별자(Flag 정책 단위)
  z.object({ type: z.literal('ATTESTATION'), ...Seq, configs: z.array(AttestationEntry).max(64) }).strict(),
  z.object({ type: z.literal('OVERRIDE'), ...Seq, flagKey: z.string().min(1), value: z.unknown() }).strict(),
]);
export type VehicleReportBody = z.infer<typeof VehicleReportBody>;
export type VehicleReportType = VehicleReportBody['type'];

/** 차량 채널 거부 사유 → HTTP 상태 (백엔드 오류 봉투 code와 같은 이름) */
export const VEHICLE_REJECT = {
  VEHICLE_UNAUTHENTICATED: 401,
  VEHICLE_SCOPE: 403,
  VEHICLE_OVERRIDE_FORBIDDEN: 403,
  TRUST_SOURCE_FIELD: 400,
  OLD_SEQUENCE: 409,
  BOOT_MISMATCH: 409,
  RATE_LIMITED: 429,
} as const;
export type VehicleReject = keyof typeof VEHICLE_REJECT;

/** 관측 속성만 바꾸는지 — 신뢰 원천 속성·알 수 없는 키·값 형식 오류를 구분해 돌려준다 */
export function checkObservedSet(set: Record<string, unknown>): { ok: true; set: VehicleObservedSet } | { ok: false; rejected: string[]; invalid: string[] } {
  const rejected: string[] = [];
  const invalid: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) {
    if (!(k in VEHICLE_OBSERVED_FIELDS)) {
      rejected.push(k);
      continue;
    }
    const r = VEHICLE_OBSERVED_FIELDS[k as VehicleObservedField].safeParse(v);
    if (r.success) out[k] = r.data;
    else invalid.push(k);
  }
  if (rejected.length || invalid.length || Object.keys(out).length === 0) return { ok: false, rejected, invalid };
  return { ok: true, set: out as VehicleObservedSet };
}

/** 차량별 마지막 보고 위치 */
export interface VehicleChannelCursor {
  bootId: string;
  sequence: number;
}

/**
 * 보고 순서 판정 — 같은 (bootId, sequence)는 저장된 응답을 그대로 돌려주므로 여기 오기 전에 걸러진다.
 * - 처음 보는 차량: 받아들이고 그 부팅을 기준으로 삼는다.
 * - 같은 부팅: sequence가 커야 한다(낮으면 OLD_SEQUENCE — 지연된 보고가 최신 상태를 덮어쓰지 않게).
 * - 다른 부팅: HELLO만 새 부팅을 열 수 있다(재부팅 후 먼저 대사). 그 밖의 보고는 BOOT_MISMATCH.
 */
export function checkReportOrder(cursor: VehicleChannelCursor | null, report: Pick<VehicleReportBody, 'type' | 'bootId' | 'sequence'>): { ok: true; newBoot: boolean } | { ok: false; reason: 'OLD_SEQUENCE' | 'BOOT_MISMATCH' } {
  if (!cursor) return { ok: true, newBoot: true };
  if (report.bootId !== cursor.bootId) return report.type === 'HELLO' ? { ok: true, newBoot: true } : { ok: false, reason: 'BOOT_MISMATCH' };
  return report.sequence > cursor.sequence ? { ok: true, newBoot: false } : { ok: false, reason: 'OLD_SEQUENCE' };
}

/** 차량별 요청 빈도 한도 (고정 창) — 넘으면 429 + Retry-After */
export const VEHICLE_RATE_LIMIT = { requests: 30, windowMs: 10_000 } as const;

/** 차량 요청 기록 (화면·감사) */
export interface VehicleRequestRecord {
  requestId: string;
  vin: string;
  at: string;
  channel: 'QUERY' | 'REPORT';
  type: VehicleReportType | 'QUERY';
  bootId: string | null;
  sequence: number | null;
  outcome: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  reason: VehicleReject | string | null;
  /** 요청 요약 (조회 flag, 바꾼 관측값, 오류 코드 등) */
  summary: string;
  /** 응답에 실은 재평가 결과 */
  flags: { key: string; value: unknown; reason: string }[];
}
