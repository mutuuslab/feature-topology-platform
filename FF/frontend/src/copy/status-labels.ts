import { localizedCopy } from '../locale/runtime';
export const statusLabels: Record<string, string> = /* @__PURE__ */ localizedCopy('status-labels.statusLabels', {
  DEPLOYED: '배포됨', RELEASED: '출시됨', DEVELOPING: '개발 중', VALIDATED: '검증됨',
  APPROVED: '승인됨', CONFIRMED: '확정됨', VERIFIED: '확인됨', REQUESTED: '요청됨',
  IN_PROGRESS: '진행 중', RUNNING: '실행 중', REVIEW: '검토 필요', PENDING: '대기 중',
  FAIL: '실패', FAILED: '실패', PASS: '통과', REJECTED: '반려됨', DENIED: '거부됨',
  DONE: '완료', CLOSED: '종료됨', BLOCKED: '차단됨', DRAFT: '초안', PROPOSED: '제안됨',
  ALLOWED: '허용됨', MITIGATED: '조치됨', ACKNOWLEDGED: '수신 확인', ACTIVE_ROLLOUT: '단계 배포 중',
  ACTIVE: '활성', OPEN: '열림', CRITICAL: '심각', WARNING: '주의', WARN: '주의',
  EXPIRED: '만료됨', ON_HOLD: '보류됨', NEW: '새로 등록',
});
