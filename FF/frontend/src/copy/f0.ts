import { localizedCopy } from '../locale/runtime';
// 계정 상태·소유자 이관 화면 문구 — 플랫폼 인증·권한(/admin/iam)의 계정 상태 패널, 컴플라이언스 룰 상세의 소유자 이관.
// 시스템 관리자는 계정 상태를 기록하고 소유자가 없는 기록의 소유자를 옮긴다. 기록 내용은 고치지 않는다.

export const accounts = /* @__PURE__ */ localizedCopy('f0.accounts', {
  panel: '계정 상태',
  lead: '퇴사·전보한 계정을 비활성으로 기록합니다. 비활성 계정이 소유한 기록은 시스템 관리자가 담당 역할의 다른 계정으로 옮깁니다.',
  key: (inactive: number) => (inactive ? `비활성 계정 ${inactive}개` : '모든 계정 사용 중'),
  col: { account: '계정', roles: '역할', state: '상태', changed: '마지막 기록' },
  state: { ACTIVE: '사용 중', INACTIVE: '비활성', ABSENT: '없는 계정', UNKNOWN: '확인 불가' } as Record<string, string>,
  reason: '사유(퇴사·전보·복귀)',
  reasonHint: '4자 이상 적으면 버튼이 열립니다',
  deactivate: '비활성으로 기록',
  reactivate: '다시 사용 중으로',
  self: '자기 계정의 상태는 다른 시스템 관리자가 기록합니다',
  changed: (by: string, at: string, reason: string) => `${by} · ${at} — ${reason}`,
});

export const ownerTransfer = /* @__PURE__ */ localizedCopy('f0.ownerTransfer', {
  panel: '소유자 이관',
  ownerState: '소유자 계정',
  lead: '소유자 계정이 없거나 비활성입니다. 룰 담당 역할의 사용 중 계정으로 옮깁니다. 내용·버전은 그대로입니다.',
  to: '새 소유자',
  reason: '이관 사유',
  submit: '소유자 이관',
  history: '소유자 이관 이력',
  col: { at: '일시', from: '이전 소유자', to: '새 소유자', by: '처리', reason: '사유' },
  fromState: (s: string) => `(${s})`,
});
