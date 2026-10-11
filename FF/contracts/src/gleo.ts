// GLEO Broker 메시지 — FF_IMP `gleo/messages.py`와 같은 계약(교차 언어 픽스처: gleo.fixtures.json).
// 브로커는 잘못된 메시지를 조용히 버리므로, 플랫폼은 보내기 전에 이 스키마로 검사한다.
import { z } from 'zod';

export const GLEO_STATES = ['ACTIVE', 'FAULT_REPORTED', 'SAFE_DEFAULT', 'SAFE_STOP', 'DISABLED'] as const;
const Scope = z.object({ vehicle_ids: z.array(z.string()) }).passthrough();

export const GleoPolicyPush = z.object({ type: z.literal('policy_push'), feature_id: z.string(), action: z.string(), scope: Scope, issued_at: z.string(), reason: z.string() }).passthrough();
export const GleoKillCommand = z
  .object({
    type: z.literal('kill_command'),
    feature_id: z.string(),
    scope: Scope,
    issued_at: z.string(),
    issued_by: z.string(),
    /** 선택 — 없으면 차량 어댑터 기본(SAFE_DEFAULT). FF_IMP decision_engine이 반영한다 */
    safe_mode: z.enum(['SAFE_DEFAULT', 'SAFE_STOP']).optional(),
  })
  .passthrough();
export const GleoStatusReport = z
  .object({ type: z.literal('status_report'), vehicle_id: z.string(), feature_id: z.string(), state: z.string(), received_at: z.string(), applied_at: z.string(), offline: z.boolean() })
  .passthrough();

export const GleoMessage = z.discriminatedUnion('type', [GleoPolicyPush, GleoKillCommand, GleoStatusReport]);
export type GleoMessage = z.infer<typeof GleoMessage>;
export type GleoStatusReport = z.infer<typeof GleoStatusReport>;
