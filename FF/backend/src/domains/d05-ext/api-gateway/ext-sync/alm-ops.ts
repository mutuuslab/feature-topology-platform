// 80-50 연계 확장의 보낼 일(sync_outbox) 모양 — 처리기는 alm-*.service.ts가 ExtSyncService.extend로 등록한다.
// 기존 보낼 일(ext-sync.repo OutboxOp)과 같은 표·같은 재시도·같은 중복 키를 쓴다.
export type AlmOp =
  /** Feature 기능(FUNC)마다 Epic 아래 Story — 없으면 만들고 이름이 다르면 맞춘다(80-50 §4.1) */
  | { op: 'STORY_SYNC'; featureId: string }
  /** JIRA에서 만든 Story에 FF가 매긴 기능 ID를 적고 안내 댓글 */
  | { op: 'STORY_LINK'; key: string; featureId: string; functionId: string; comment: string }
  /** 현장 문제(운영 인시던트·조치 연결) → Feature Epic 아래 Bug */
  | { op: 'FIELD_ISSUE'; featureId: string; incidentId: string | null; ref: string | null; title: string; body: string };
