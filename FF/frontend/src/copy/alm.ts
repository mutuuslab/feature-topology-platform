// JIRA·codeBeamer 연계(80-50) 화면 문구 — 대사 실행 기록·Epic 필드 이름·산출물·재판정. 내부 코드는 쓰지 않는다.
import { EPIC_FIELD, RECONCILE_KIND_LABEL, type EpicFieldKey } from '@ff/contracts';

export const alm = {
  reconcile: {
    title: '주기 대사',
    lead: '놓친 변경을 15분마다, 모든 Epic을 하루 한 번 다시 맞춥니다. 받은 변경은 같은 확인을 거칩니다.',
    kind: RECONCILE_KIND_LABEL,
    col: { at: '시작', kind: '종류', system: '시스템', scanned: '훑은 수', applied: '반영', conflicts: '충돌', errors: '오류', notes: '처리 내용' },
    run: (kind: string) => `${kind} 지금 실행`,
    running: '대사 중…',
    more: (n: number) => `외 ${n}건`,
  },
  /** 충돌 칸 이름 — 상태 또는 Epic 필드 */
  conflictField: (field: string) => (field === 'status' ? '상태' : (EPIC_FIELD[field as EpicFieldKey]?.ko ?? field)),
};
