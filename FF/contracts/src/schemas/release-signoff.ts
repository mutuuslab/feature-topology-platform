// Release Sign-off(출시 책임 확인) — 보고서 6.1 G7(출시·활성화) 승인자 중 Feature Owner의 승인 수단(사용자 결정 2026-10-18).
// Safety Manager는 Operations Gate(G9) 판정으로 승인하고, Feature Owner는 G8·G9 PASS 뒤 이 개인 서명으로 출시 책임을 확인한다.
// 서명은 그 시점의 G8·G9 판정 기록에 묶인다 — 다시 판정되면 이전 서명은 효력이 없고 새로 서명해야 한다.
import { z } from 'zod';

export const ReleaseSignoffBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type ReleaseSignoffBody = z.infer<typeof ReleaseSignoffBody>;

export const ReleaseSignoff = z.object({
  featureId: z.string(),
  version: z.string(),
  /** 소유 조직(Feature Registry ownerId) — 서명자는 이 조직을 대표하는 Feature Owner(FEATURE_AUTHOR) */
  ownerId: z.string(),
  signedBy: z.string(),
  signedRole: z.literal('FEATURE_AUTHOR'),
  signedAt: z.string(),
  /** 서명 시점의 G8·G9 판정 기록 ID — 이 기록이 최신일 때만 유효 */
  gateRecords: z.object({ G8: z.string(), G9: z.string() }),
  reason: z.string(),
  kid: z.string(),
  /** 개인 서명(approval_sig) — sig를 null로 둔 본문의 JCS 바이트에 대한 서명 */
  sig: z.string().nullable(),
});
export type ReleaseSignoff = z.infer<typeof ReleaseSignoff>;

/** 조회 결과 — 서명 기록과 현재 효력 */
export const ReleaseSignoffView = z.object({
  signoff: ReleaseSignoff.nullable(),
  /** 현재 G8·G9 판정에 묶여 있고 서명이 검증되는가 */
  valid: z.boolean(),
  /** 서명이 있지만 이후 G8·G9가 다시 판정되어 효력이 없는가 */
  stale: z.boolean(),
});
export type ReleaseSignoffView = z.infer<typeof ReleaseSignoffView>;
