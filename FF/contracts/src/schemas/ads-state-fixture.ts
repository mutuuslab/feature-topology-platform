// ADS 상태(6축·수렴·행위별 판정·고객 상태·주문 추적) — 데모 시드 픽스처 스키마(백엔드·도구 전용, index.ts에서만 내보낸다)
// 시각은 고정 날짜가 아니라 시드 시각 기준 상대값(분) — 시간이 지나도 데모가 깨지지 않게. 게시본 ID(PUB-%05d)는 순번이라 박지 않고 match로 고른다.
import { z } from 'zod';

const Condition = z.enum(['CONFIRMED', 'FAILED', 'UNCONFIRMED']);
const Stage = z.enum(['RECEIVED', 'ACCEPTED', 'DEFERRED', 'APPLIED', 'REJECTED']);
const Axis = z.enum(['ENTITLEMENT', 'INSTALL', 'DELIVERY', 'ELIGIBILITY', 'RUNTIME', 'FRESHNESS']);

export const AdsStateFixture = z.object({
  /** 기준 시간 표 — Feature별 보고 주기(intervalMs null이면 등급별 가정값) */
  basis: z.array(
    z.object({
      featureId: z.string(),
      version: z.string(),
      featureClass: z.enum(['ADS', 'ADAS', 'QM']),
      intervalMs: z.number().int().positive().nullable(),
      status: z.enum(['ASSUMED', 'APPROVED']),
    }),
  ),
  /** 차량 상태 보고(상태 보고 계약 2.1 축약) — observedAgoMin null이면 보고 이력 없음(행을 만들지 않는다) */
  reports: z.array(
    z.object({
      vin: z.string(),
      featureId: z.string(),
      version: z.string(),
      observedAgoMin: z.number().nonnegative(),
      offlineSinceAgoMin: z.number().nonnegative().nullable(),
      runtimeState: z.enum(['INACTIVE', 'AVAILABLE', 'ACTIVE', 'IN_TRANSITION', 'MRC', 'TERMINATED', 'RECOVERY_PENDING']),
      ddtOwner: z.enum(['ADS', 'USER', 'FALLBACK', 'NONE', 'UNKNOWN']),
      otaStage: z.enum(['DOWNLOADED', 'INSTALL_READY', 'INSTALLING', 'VERIFIED', 'FAILED', 'RECOVERY', 'SAFE_STATE']).nullable(),
      configMatch: z.boolean().nullable(),
      configRef: z.string().nullable(),
      reconnect: z.object({ agoMin: z.number().nonnegative(), gapMin: z.number().positive() }).nullable(),
      restore: z.object({ integrity: z.enum(['OK', 'FAILED']), inhibitReleased: z.boolean() }).nullable(),
      changes: z.array(z.object({ axis: Axis, before: z.string(), after: z.string(), reason: z.string() })),
    }),
  ),
  /** 행위별 판정(차량 보고) */
  verdicts: z.array(
    z.object({
      vin: z.string(),
      featureId: z.string(),
      action: z.enum(['ACTIVATE', 'HANDOVER', 'INSTALL', 'MRC', 'TERMINATE_CONFIRM', 'REACTIVATE']),
      verdict: z.enum(['ALLOW', 'DENY', 'UNKNOWN']),
      reasonCodes: z.array(z.string()),
      observedAgoMin: z.number().nonnegative(),
      sessionId: z.string().nullable(),
    }),
  ),
  /** 전달 단계 회신 — 실제 게시본(가장 최근의 같은 종류·Feature)에 게시 시각 + afterSec로 붙인다. 이미 결과 회신이 있는 차량에는 넣지 않는다 */
  deliveryAcks: z.array(
    z.object({
      match: z.object({ kind: z.enum(['POLICY', 'KILL', 'RESTORE']), featureId: z.string() }),
      vin: z.string(),
      stage: Stage,
      reasonCode: z.string().nullable(),
      afterSec: z.number().int().nonnegative(),
    }),
  ),
  /** 주문(과금 모의 출처) — 기존 ENT-*·CAT-*·VIN에 연결 */
  orders: z.array(
    z.object({
      orderId: z.string().regex(/^ORDER-\d{4}$/),
      idempotencyKey: z.string(),
      vin: z.string(),
      catalogId: z.string(),
      featureId: z.string(),
      entitlementId: z.string().nullable(),
      status: z.enum(['PAID', 'CANCELLED', 'REFUNDED']),
      paidAgoMin: z.number().nonnegative(),
      entitlement: Condition,
      entitlementAgoMin: z.number().nonnegative().nullable(),
      config: Condition,
      policy: z.object({ stage: Stage, agoMin: z.number().nonnegative() }).nullable(),
      readyReport: z.object({ agoMin: z.number().nonnegative(), ok: z.boolean() }).nullable(),
      usageAgoMin: z.number().nonnegative().nullable(),
      refund: z.object({ requestedAgoMin: z.number().nonnegative(), completedAgoMin: z.number().nonnegative().nullable() }).nullable(),
    }),
  ),
});
export type AdsStateFixture = z.infer<typeof AdsStateFixture>;
