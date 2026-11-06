// 수신자 규칙(D04-04) — 알림 규칙표(NOTIFICATION_RULES)의 기본 수신자를 화면에 보이는 표와, 운영자가 이벤트마다 더하는
// 추가 수신자(개인·역할·팀), 직접 보내기 본문. 기본 수신자는 규칙이 정하고 끌 수 없다 — 추가 수신자는 더하기만 한다.
// 기능명세서 공통 비고 "알림 대상 정의 필요"를 이 표 + 추가 수신자 설정으로 정한다.
import { z } from 'zod';
import { ROLE_LABEL, type Role } from '../enums';
import type { Recipient } from './notification';
import type { NotificationCategory } from './notification-keys';
import { APP_PATH_PATTERN, NOTIFICATION_SENT_EVENT, RecipientSchema } from './notification-keys';

/** 규칙이 맥락에서 고르는 수신자(사람·팀) — 역할은 플랫폼 역할 그대로 */
export const RECIPIENT_TOKEN_LABEL = {
  OWNER_TEAM: 'Feature Owner 팀',
  REQUESTER: '요청자',
  AUTHOR: '작성자',
  DEPLOYER: '배포자',
  NAMED_APPROVERS: '지정 승인대상자',
  NEXT_ROLES: '다음 활동 담당 역할',
  ACTOR: '실행한 사람',
  CHOSEN: '보낸 사람이 고른 수신자',
} as const;
export type RecipientToken = keyof typeof RECIPIENT_TOKEN_LABEL | Role;

export interface NotificationRuleSpec {
  event: string;
  name: string;
  category: NotificationCategory;
  /** 기본 수신자 — 규칙이 정한다(끌 수 없다) */
  recipients: RecipientToken[];
  /** 기본으로 빼는 계정 */
  excludes?: string;
  requirementIds: string[];
  /** 추가 수신자를 둘 수 없다 — 직접 보낸 알림은 보낸 사람이 고른 사람만 받는다(규칙으로 남의 직접 알림을 받아 보지 못하게) */
  fixed?: true;
}

/** 긴급 차단·복원 승인 칸 역할(access KILL_APPROVER_ROLES와 같다 — 순환 import를 피해 값으로 둔다, 시험이 맞춘다) */
export const KILL_APPROVER_SPEC: Role[] = ['SAFETY_OFFICER', 'SECURITY_OFFICER', 'OPS_LEAD', 'PRODUCT_APPROVER', 'GATE_JUDGE', 'REGULATORY_OWNER'];
const K = KILL_APPROVER_SPEC;

/** 이벤트별 기본 수신자 — NOTIFICATION_RULES와 같은 이벤트 목록(시험이 맞춘다) */
export const NOTIFICATION_RULE_SPECS: NotificationRuleSpec[] = [
  { event: 'gate.judged', name: 'Gate 판정', category: 'GATE', recipients: ['OWNER_TEAM', 'FEATURE_APPROVER'], excludes: '판정자 본인', requirementIds: ['FR-REG-005-014'] },
  { event: 'policy.validated', name: '정책 검증 — 승인 요청(GO)·배포 차단(NO-GO)', category: 'DEPLOY', recipients: ['FEATURE_APPROVER', 'OWNER_TEAM', 'AUTHOR'], excludes: '승인 요청은 작성자 본인', requirementIds: ['FR-CRC-002-009', 'FR-DSV-001-011'] },
  { event: 'policy.conflict.detected', name: '정책 충돌 탐지', category: 'DEPLOY', recipients: ['OWNER_TEAM', 'FEATURE_APPROVER', 'AUTHOR'], requirementIds: ['FR-CON-001-003'] },
  { event: 'quality.gate.failed', name: '품질 Gate 실패', category: 'GATE', recipients: ['OWNER_TEAM', 'GATE_JUDGE', 'AUTHOR'], requirementIds: ['FR-QGV-003-005'] },
  { event: 'policy.deployed', name: 'Control Point 상태 변경(정책 배포)', category: 'DEPLOY', recipients: ['OWNER_TEAM', 'OPERATOR'], excludes: '배포자 본인', requirementIds: [] },
  { event: 'rollout.halt-required', name: '배포 중단 필요', category: 'DEPLOY', recipients: ['OWNER_TEAM', 'DEPLOYER', 'REQUESTER'], requirementIds: ['FR-DSV-003-005'] },
  { event: 'kill.requested', name: '긴급 차단 승인 요청', category: 'APPROVAL', recipients: [...K], excludes: '요청자 본인', requirementIds: [] },
  { event: 'kill.issued', name: '긴급 차단 실행', category: 'SAFETY', recipients: ['OWNER_TEAM', 'OPERATOR', 'OPS_LEAD', 'AUDITOR'], requirementIds: ['FR-KSW-003-003'] },
  { event: 'kill.restore-requested', name: '차단 해제(복원) 승인 요청', category: 'APPROVAL', recipients: [...K], excludes: '요청자·직전 차단 승인자', requirementIds: ['FR-KSW-004-005'] },
  { event: 'kill.restore-blocked', name: '복원 승인자 부족', category: 'SAFETY', recipients: ['OPS_LEAD', 'SAFETY_OFFICER'], requirementIds: [] },
  { event: 'rollback.plan.requested', name: 'Rollback Plan 승인 요청', category: 'APPROVAL', recipients: ['NAMED_APPROVERS'], excludes: '요청자 본인', requirementIds: ['FR-RBK-001-007'] },
  { event: 'rollback.requested', name: '수동 롤백 승인 요청', category: 'APPROVAL', recipients: ['NAMED_APPROVERS'], excludes: '요청자 본인', requirementIds: ['FR-RBK-004-005'] },
  { event: 'rollback.completed', name: '롤백 완료', category: 'DEPLOY', recipients: ['REQUESTER', 'NAMED_APPROVERS', 'DEPLOYER', 'OWNER_TEAM', 'RELEASE_MANAGER'], requirementIds: ['FR-RBK-005-003'] },
  { event: 'rollback.failed', name: '롤백 실패', category: 'DEPLOY', recipients: ['REQUESTER', 'NAMED_APPROVERS', 'DEPLOYER', 'OWNER_TEAM', 'RELEASE_MANAGER'], requirementIds: ['FR-RBK-005-004'] },
  { event: 'anomaly.opened', name: '이상 이벤트 발생', category: 'OPS', recipients: ['OWNER_TEAM', 'OPERATOR', 'OPS_LEAD', 'SAFETY_OFFICER'], requirementIds: ['FR-EVT-003-003'] },
  { event: 'anomaly.escalated', name: '이상 이벤트 격상', category: 'OPS', recipients: ['OWNER_TEAM', 'OPERATOR', 'OPS_LEAD', 'SAFETY_OFFICER'], requirementIds: ['FR-EVT-003-003'] },
  { event: 'sync.completed', name: '데이터 동기화 실패', category: 'INTEGRATION', recipients: ['IMPLEMENTER'], requirementIds: ['FR-DSYN-001-004'] },
  { event: 'pipeline.run.failed', name: '파이프라인 실패', category: 'INTEGRATION', recipients: ['OWNER_TEAM', 'IMPLEMENTER', 'RELEASE_MANAGER'], requirementIds: ['FR-CICD-001-006'] },
  { event: 'legacy.import.failed', name: 'Legacy 연계 오류', category: 'INTEGRATION', recipients: ['IMPLEMENTER', 'OPERATOR'], requirementIds: ['FR-LGCY-001-008'] },
  { event: 'billing.call.failed', name: '과금 시스템 연계 오류', category: 'INTEGRATION', recipients: ['PRODUCT_AUTHOR', 'OPERATOR'], requirementIds: ['FR-BIL-001-004'] },
  { event: 'signing.failed', name: '정책 서명 실패', category: 'INTEGRATION', recipients: ['SECURITY_OFFICER', 'ACTOR'], requirementIds: [] },
  { event: 'procedure.activity.completed', name: '업무 절차 인계', category: 'PROCEDURE', recipients: ['NEXT_ROLES'], excludes: '완료자 본인', requirementIds: [] },
  { event: 'procedure.activity.overdue', name: '업무 절차 기한 초과', category: 'PROCEDURE', recipients: ['NEXT_ROLES'], requirementIds: [] },
  { event: 'refdb.source.review-due', name: 'Feature DB 출처 정기 점검 기한', category: 'PROCEDURE', recipients: ['REFDB_ADMIN'], requirementIds: [] },
  { event: 'refdb.ref.rejected', name: '기준 기능 추가 요청 반려', category: 'APPROVAL', recipients: ['OWNER_TEAM'], requirementIds: [] },
  { event: 'baseline.requested', name: 'Baseline 확정 요청', category: 'APPROVAL', recipients: ['BOM_APPROVER'], excludes: '요청자 본인', requirementIds: [] },
  { event: 'refdb.change.created', name: 'Feature DB 변경 요청', category: 'APPROVAL', recipients: ['DOMAIN_REVIEWER', 'REFDB_ADMIN'], excludes: '요청자 본인', requirementIds: [] },
  { event: 'refdb.change.reviewed', name: 'Feature DB 변경 요청 검토 의견', category: 'APPROVAL', recipients: ['REFDB_ADMIN', 'REQUESTER'], requirementIds: [] },
  { event: 'release.signed', name: 'Release Sign-off 완료', category: 'APPROVAL', recipients: ['OWNER_TEAM', 'RELEASE_MANAGER', 'PRODUCT_APPROVER', 'AUDITOR'], excludes: '서명자 본인', requirementIds: [] },
  { event: 'pki.key.rotated', name: '서명 키 교체', category: 'DEPLOY', recipients: ['GATE_JUDGE', 'SAFETY_OFFICER', 'OPERATOR'], excludes: '교체한 본인', requirementIds: [] },
  { event: NOTIFICATION_SENT_EVENT, name: '직접 보낸 알림', category: 'DIRECT', recipients: ['CHOSEN'], excludes: '보낸 사람 본인', requirementIds: [], fixed: true },
];

/** 수신자 표시 이름 — 규칙 토큰·역할 */
export const recipientTokenLabel = (t: RecipientToken): string => (t in RECIPIENT_TOKEN_LABEL ? RECIPIENT_TOKEN_LABEL[t as keyof typeof RECIPIENT_TOKEN_LABEL] : (ROLE_LABEL[t as Role] ?? t));

/** 수신자 표시 이름 — 저장된 수신자(개인은 계정, 역할은 이름, 팀은 팀 이름) */
export const recipientLabel = (r: Recipient): string => (r.kind === 'user' ? r.id : r.kind === 'role' ? (ROLE_LABEL[r.role] ?? r.role) : `${r.team} 팀`);

/** 추가 수신자 설정 — 이벤트 하나에 개인·역할·팀을 20명까지 더한다(빈 목록이면 추가 수신자 없음). 바꾼 사유는 감사에 남는다 */
export const NotificationRuleBody = z
  .object({
    recipients: z.array(RecipientSchema).max(20),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type NotificationRuleBody = z.infer<typeof NotificationRuleBody>;

/** 직접 보내기 — 사람·역할·팀을 골라 화면 알림 하나를 보낸다(본인은 받지 않는다) */
export const NotificationSendBody = z
  .object({
    title: z.string().trim().min(2).max(120),
    message: z.string().trim().min(2).max(1000),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'),
    link: z
      .string()
      .trim()
      .max(200)
      .regex(APP_PATH_PATTERN, '앱 안 경로(/로 시작, // 또는 역슬래시 없이)만 넣을 수 있습니다')
      .optional(),
    recipients: z.array(RecipientSchema).min(1).max(20),
  })
  .strict();
export type NotificationSendBody = z.infer<typeof NotificationSendBody>;

/** 직접 보내기 한도 — 보낸 사람마다 최근 1시간에 이만큼(역할·팀 수신자는 여러 사람에게 퍼진다 — 알림함을 덮는 대량 발송 차단) */
export const NOTIFICATION_SEND_LIMIT_PER_HOUR = 20;

/** 수신자 규칙 화면 한 줄 — 기본 수신자(규칙) + 추가 수신자(설정) */
export interface NotificationRuleView extends NotificationRuleSpec {
  added: Recipient[];
  updatedBy: string | null;
  updatedAt: string | null;
}

