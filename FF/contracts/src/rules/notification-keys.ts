// 알림 범주·심각도·수신자 스키마·알림 이벤트 목록 — notification.ts(규칙표)와 notification-rules.ts·상단바 종이 함께 쓴다.
// 규칙표(notification.ts)를 읽지 않고도 쓸 수 있게 따로 둔다 — 서로 읽는 순환을 피하고, 첫 화면 묶음에 규칙표가 실리지 않는다.
import { z } from 'zod';
import { ROLES } from '../enums';

/** 수신자 스키마 — 직접 보내기·수신자 규칙 화면이 쓴다(개인 계정·플랫폼 역할·Feature Owner 팀) */
export const RecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string().trim().min(2).max(80) }).strict(),
  z.object({ kind: z.literal('role'), role: z.enum(ROLES) }).strict(),
  z.object({ kind: z.literal('team'), team: z.string().trim().min(1).max(80) }).strict(),
]);
/** 이벤트 payload에서 온 수신자 확인(직접 보낸 알림) */
export const isRecipient = (r: unknown): r is z.infer<typeof RecipientSchema> => RecipientSchema.safeParse(r).success;

/** 직접 보낸 알림 이벤트 — 보낸 사람이 고른 수신자(payload.recipients) */
export const NOTIFICATION_SENT_EVENT = 'notification.sent';

export const NOTIFICATION_CATEGORIES = ['APPROVAL', 'SAFETY', 'DEPLOY', 'GATE', 'OPS', 'INTEGRATION', 'PROCEDURE', 'DIRECT'] as const;
export const NotificationCategory = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  APPROVAL: '승인 요청',
  SAFETY: '긴급 차단·복원',
  DEPLOY: '정책 배포',
  GATE: 'Gate 판정',
  OPS: '이상 징후',
  INTEGRATION: '외부 연계',
  PROCEDURE: '업무 절차',
  DIRECT: '직접 보낸 알림',
};

export const NotificationSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export type NotificationSeverity = z.infer<typeof NotificationSeverity>;

/** 알림을 만드는 이벤트 — NOTIFICATION_RULES의 키와 같다(시험이 맞춘다). 상단바 종이 실시간 구독에 쓴다 */
export const NOTIFICATION_EVENT_TYPES: readonly string[] = [
  'gate.judged',
  'policy.validated',
  'policy.deployed',
  'kill.requested',
  'kill.issued',
  'kill.restore-requested',
  'rollback.plan.requested',
  'rollback.requested',
  'rollback.completed',
  'rollback.failed',
  'anomaly.opened',
  'anomaly.escalated',
  'sync.completed',
  'procedure.activity.completed',
  'procedure.activity.overdue',
  'refdb.source.review-due',
  'refdb.ref.rejected',
  'baseline.requested',
  'refdb.change.created',
  'refdb.change.reviewed',
  'release.signed',
  'kill.restore-blocked',
  'pki.key.rotated',
  'policy.conflict.detected',
  'quality.gate.failed',
  'rollout.halt-required',
  'pipeline.run.failed',
  'legacy.import.failed',
  'billing.call.failed',
  'signing.failed',
  NOTIFICATION_SENT_EVENT,
];
