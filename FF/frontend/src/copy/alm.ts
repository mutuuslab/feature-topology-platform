// JIRA·codeBeamer 연계(80-50) 화면 문구 — 대사 실행 기록·Epic 필드 이름·산출물·재판정. 내부 코드는 쓰지 않는다.
import { RECONCILE_KIND_LABEL } from '@ff/contracts';
import { almInbox } from './alm-inbox';

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
  children: {
    stories: '기능 분해 (JIRA Story)',
    fieldIssues: '현장 문제 (JIRA)',
    col: { key: '키', function: '기능 ID', title: '제목', status: '상태', ops: '운영 연결' },
    kill: (id: string) => `긴급 차단 ${id}`,
    incident: (id: string) => `인시던트 ${id}`,
    candidate: '인시던트 후보 — 운영 판단',
    latest: (n: number, total: number) => `최근 ${n}건 · 전체 ${total}건`,
  },
  wp: {
    title: '산출물 (codeBeamer)',
    rate: (passed: number, required: number, rate: number) => `필요한 산출물 ${required}종 중 ${passed}종 완결 · 작성률 ${rate}%`,
    col: { kind: '산출물', process: '공정', need: '필요', items: '항목', approved: '승인', state: '추적 완결', problems: '누락' },
    need: { yes: '필요', no: '해당 없음' },
    passed: '완결',
    failed: (n: number) => `${n}건 누락`,
    none: '없음',
    cyber: (why: string) => `사이버보안 요구: ${why}`,
    problems: '누락·끊긴 추적',
    refresh: 'codeBeamer 다시 읽기',
    suspect: (n: number) => `의심 관계 ${n}건 — 위 항목이 승인 뒤 바뀌었습니다`,
  },
  rejudge: {
    detail: almInbox.rejudgeDetail,
  },
  gate: {
    title: 'codeBeamer 필수 산출물',
    ok: '이 판정에 필요한 산출물이 완결되었습니다',
    blocked: '필수 산출물이 완결되지 않았습니다',
    warn: '산출물이 완결되지 않았습니다 — 판정은 막지 않지만 담당자가 확인하세요',
    rejudge: (n: number) => `승인 뒤 바뀐 산출물로 재판정 요청 ${n}건`,
    close: '영향 없음으로 닫기',
    reason: '닫는 사유',
  },
  changes: {
    title: '승인 뒤 바뀐 산출물',
    line: (key: string, title: string, from: number, to: number, n: number) => `${key} ${title} — v${from} → v${to}, 영향 ${n}건`,
  },
  /** 충돌 칸 이름 — 상태 또는 Epic 필드 */
  conflictField: almInbox.conflictField,
};
