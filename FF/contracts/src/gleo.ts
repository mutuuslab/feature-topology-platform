// GLEO Broker 메시지 — FF_IMP `gleo/messages.py` validate()와 같은 계약(교차 언어 픽스처: gleo.fixtures.json).
// 브로커는 잘못된 메시지를 조용히 버리므로, 플랫폼은 보내기 전에 이 검사를 한다.
// policy_push(정책 캐시 알림, 회신 없음)만 GLEO 고유 형식이고, kill_command·status_report는 v2(보고서 v1.1 부록 D) — v1(safe_mode·
// SAFE_*)은 받지 않는다(FF_IMP 5a1138c와 함께 전환).
import { z } from 'zod';
import { KillCommandV2, StatusReportV2, wireErrors } from './schemas/wire';

const Scope = z.object({ vehicle_ids: z.array(z.string()) }).passthrough();

export const GleoPolicyPush = z.object({ type: z.literal('policy_push'), feature_id: z.string(), action: z.string(), scope: Scope, issued_at: z.string(), reason: z.string() }).passthrough();
export type GleoPolicyPush = z.infer<typeof GleoPolicyPush>;

export const GLEO_TYPES = ['policy_push', 'kill_command', 'status_report'] as const;

/** 브로커 메시지 검사 — 위반 문구 목록(빈 목록 = 유효) */
export function gleoMessageErrors(msg: unknown): string[] {
  const t = (msg as { type?: unknown } | null)?.type;
  if (t === 'policy_push') {
    const r = GleoPolicyPush.safeParse(msg);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  }
  if (t === 'kill_command') return wireErrors(KillCommandV2, msg);
  if (t === 'status_report') return wireErrors(StatusReportV2, msg);
  return [`알 수 없는 GLEO 메시지 type: ${JSON.stringify(t)}`];
}
