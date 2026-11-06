// 알림 범주·심각도·이벤트 종류 — 규칙표(notification.ts의 NOTIFICATION_RULES)와 따로 둔다.
// 화면 첫 묶음(상단바 알림 종·API 경로 표)은 이 가벼운 정의만 쓴다 — 규칙표(문구·수신자 함수)는 서버만 쓴다(첫 화면 예산, 2026-11-06).
import { z } from 'zod';

export const NOTIFICATION_CATEGORIES = ['APPROVAL', 'SAFETY', 'DEPLOY', 'GATE', 'OPS', 'INTEGRATION', 'PROCEDURE'] as const;
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
};

export const NotificationSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export type NotificationSeverity = z.infer<typeof NotificationSeverity>;

/** Feature DB 알림 이벤트 — 출처 정기 점검 기한 지남 · 추가 요청 반려(요청 중 행 폐기) */
export const REFDB_REVIEW_DUE_EVENT = 'refdb.source.review-due';
export const REFDB_REF_REJECTED_EVENT = 'refdb.ref.rejected';

/** 알림을 만드는 이벤트 종류 — NOTIFICATION_RULES의 키와 같다(notification.test.ts가 맞춰 본다). 상단바 종이 이 이벤트가 오면 다시 읽는다 */
export const NOTIFICATION_EVENT_TYPES = [
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
] as const;

// ─── 읽음 처리 ───────────────────────────────────────────────

export const NotificationReadAllBody = z.object({ category: NotificationCategory.optional() }).strict();
export type NotificationReadAllBody = z.infer<typeof NotificationReadAllBody>;
