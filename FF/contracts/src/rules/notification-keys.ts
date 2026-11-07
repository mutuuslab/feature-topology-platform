// 알림 범주·심각도·수신자 스키마·알림 이벤트 목록 — notification.ts(규칙표)와 notification-rules.ts·상단바 종이 함께 쓴다.
// 규칙표(notification.ts)를 읽지 않고도 쓸 수 있게 따로 둔다 — 서로 읽는 순환을 피하고, 첫 화면 묶음에 규칙표가 실리지 않는다.
import { z } from 'zod';
import { ROLES, type Role } from '../enums';

/** 수신자 역할 — 사람 역할만(차량·시스템 역할에는 알림을 받는 계정이 없다). access HUMAN_ROLES와 같다 — 첫 화면 묶음에 access를 싣지 않게 값으로 */
const RECIPIENT_ROLES = ROLES.filter((r) => r !== 'VEHICLE' && r !== 'SYSTEM') as [Role, ...Role[]];

/** 수신자 스키마 — 직접 보내기·수신자 규칙 화면이 쓴다(개인 계정·사람 역할·Feature Owner 팀) */
export const RecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string().trim().min(2).max(80) }).strict(),
  z.object({ kind: z.literal('role'), role: z.enum(RECIPIENT_ROLES) }).strict(),
  z.object({ kind: z.literal('team'), team: z.string().trim().min(1).max(80) }).strict(),
]);
/** 이벤트 payload에서 온 수신자 확인(직접 보낸 알림) */
export const isRecipient = (r: unknown): r is z.infer<typeof RecipientSchema> => RecipientSchema.safeParse(r).success;

/**
 * 앱 안 경로인가 — '/'로 시작하고, 브라우저가 다른 사이트로 읽는 '//'·'/\'와 역슬래시·공백·제어 글자가 없다(열린 리다이렉트 차단).
 * 직접 보내기 본문 검사·알림 만들기·화면의 링크 그리기가 함께 쓴다.
 */
export const APP_PATH_PATTERN = /^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/;
export const isAppPath = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && APP_PATH_PATTERN.test(v);

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

/** Feature DB 알림 이벤트 — 출처 정기 점검 기한 지남 · 추가 요청 반려(요청 중 행 폐기) */
export const REFDB_REVIEW_DUE_EVENT = 'refdb.source.review-due';
export const REFDB_REF_REJECTED_EVENT = 'refdb.ref.rejected';

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
  REFDB_REVIEW_DUE_EVENT,
  REFDB_REF_REJECTED_EVENT,
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
  'compliance.rule.expired',
  'compliance.rule.approval-requested',
  'exception.requested',
  'exception.reverted',
];

// ─── 읽음 처리 — API 경로 표(routes.ts)가 규칙표 없이 읽는다(첫 화면 예산) ───

export const NotificationReadAllBody = z.object({ category: NotificationCategory.optional() }).strict();
export type NotificationReadAllBody = z.infer<typeof NotificationReadAllBody>;
