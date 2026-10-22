// GitLab · JIRA · codeBeamer 양방향 연계 화면 문구 — ko.ts와 분리. 도구 이름은 고유명사 그대로 쓴다.
import type { ExtKind, ExtSystem, SyncState } from '@ff/contracts';

export const extSync = {
  system: { CODEBEAMER: 'codeBeamer', JIRA: 'JIRA', GITLAB: 'GitLab' } satisfies Record<ExtSystem, string>,
  kind: { REQUIREMENT: '요구사항', EPIC: 'Epic', CHANGE_REQUEST: '변경요청', DEFECT: '결함', MERGE_REQUEST: 'MR', PIPELINE: '파이프라인' } satisfies Record<ExtKind, string>,
  state: { SYNCED: '맞음', PENDING: '보내는 중', CONFLICT: '충돌', FAILED: '보내기 실패', REJECTED: '외부 변경 거부됨' } satisfies Record<SyncState, string>,
  stale: 'G2 재검토',
  staleTitle: 'codeBeamer에서 요구가 개정되었습니다 — G2를 다시 판정하면 표시가 내려갑니다',
  open: (system: string) => `${system}에서 열기 (새 탭)`,
  mode: { mock: '모의', live: '실제 연결', off: '꺼짐' } as Record<string, string>,
  owner: { PLATFORM: 'Feature Platform', CODEBEAMER: 'codeBeamer', JIRA: 'JIRA', GITLAB: 'GitLab' } as Record<string, string>,

  // Feature 상세 — 연계 탭
  feature: {
    tab: '연계',
    epic: 'JIRA Epic',
    /** Registry 목록 열 — Epic 상태가 Lifecycle 기준과 다르면 */
    epicDrift: (expected: string) => `Lifecycle 기준 '${expected}'과 다름`,
    noEpic: 'Epic 없음',
    key: {
      clean: '요구·변경요청·코드가 모두 연결되어 있고 외부와 상태가 맞습니다',
      issues: '외부 연계에서 확인할 것이 있습니다',
    },
    chain: '추적 — 요구 → Feature → MR·파이프라인 → 정책·변경요청',
    requirements: '요구사항 (codeBeamer)',
    missing: (ids: string) => `codeBeamer에서 찾지 못한 요구 ID: ${ids} — 요구 ID를 확인하거나 codeBeamer에 등록하세요.`,
    stale: (n: number) => `codeBeamer에서 개정된 요구 ${n}건 — G2를 다시 판정하세요.`,
    epicMismatch: (expected: string, actual: string) => `JIRA Epic 상태 '${actual}'이(가) 플랫폼 Lifecycle 기준 '${expected}'과(와) 다릅니다 — 동기화가 끝나면 맞춰집니다.`,
    conflicts: (n: number) => `처리할 동기화 충돌 ${n}건 — 외부 연계 화면에서 고르세요.`,
    changeRequests: '변경요청 (JIRA)',
    defects: '결함 (JIRA)',
    code: '코드 (GitLab)',
    policies: '정책과 근거 변경요청',
    none: '없음',
    noCr: '근거 변경요청 없음',
    pipeline: '파이프라인',
    col: { key: '키', reqId: '요구 ID', cbItem: 'codeBeamer', title: '제목', status: '상태', sync: '동기', branch: '브랜치', policy: '정책', flag: 'Flag', cr: '변경요청' },
    latest: (n: number, total: number) => `최근 ${n}건 · 전체 ${total}건`,
  },

  // 변경요청(CR) 목록
  cr: {
    title: '변경요청',
    lead: 'JIRA 변경요청과 플랫폼 정책 상태를 나란히 봅니다',
    key: { ok: '모든 변경요청이 플랫폼 정책 상태와 맞습니다', drift: (n: number) => `변경요청 ${n}건이 플랫폼 정책 상태와 다릅니다` },
    tabs: { jira: 'JIRA 변경요청', rationale: '버전 변경 근거' },
    col: { key: '변경요청', title: '제목', jira: 'JIRA 상태', policy: '정책', ffStatus: '플랫폼 상태', expected: '기대 JIRA 상태', feature: 'Feature', sync: '동기' },
    unlinked: '정책 연결 없음',
    note: '변경요청 흐름(작성·검토·승인)은 JIRA가 주인입니다. JIRA에서 승인하면 플랫폼 정책 승인 요청이 되고, 직무 분리·검증 GO를 플랫폼이 다시 확인합니다.',
  },

  // 정책 상세
  policy: {
    title: '근거 변경요청 (JIRA)',
    none: '이 정책에 연결된 변경요청이 없습니다 — 변경 근거를 남기려면 JIRA 변경요청을 연결하세요.',
    link: '변경요청 연결',
    crKey: '변경요청 키 (예: FFCR-12)',
    linking: '연결 중…',
  },

  // 외부 연계 — 양방향 탭
  sync: {
    tab: '양방향 연계',
    key: { ok: '외부 연계 — 충돌·실패 없이 맞습니다', attention: '외부 연계에서 처리할 것 — 충돌·보내기 실패', idle: '아직 외부와 주고받은 변경이 없습니다' },
    inboxEmpty: '아직 받은 변경이 없습니다',
    inboxEmptyBody: '외부 도구에서 상태를 바꾸면 여기에 쌓입니다. 아래 "외부에서 바꿔 보기"로 시험할 수 있습니다.',
    summary: '시스템별 연결',
    col: { system: '시스템', ifId: 'IF', mode: '연결', links: '연결 항목', pending: '보내는 중', failed: '실패', conflicts: '충돌', rejected: '거부', lastIn: '마지막 수신', lastOut: '마지막 송신' },
    ownership: '누가 주인인가 — 주인이 아닌 쪽 변경은 요청으로 처리',
    ownCol: { fact: '사실', owner: '주인', reverse: '반대 방향' },
    conflicts: '충돌 — 사람이 고릅니다',
    noConflicts: '열린 충돌이 없습니다.',
    conflictCol: { at: '시각', system: '시스템', key: '항목', field: '필드', platform: '플랫폼 값', external: '외부 값', act: '처리' },
    choosePlatform: '플랫폼 값 다시 보내기',
    chooseExternal: '외부 값 요청으로 시도',
    resolveReason: '처리 사유',
    inbox: '받은 변경 (최근)',
    inboxCol: { at: '받은 시각', system: '시스템', key: '항목', outcome: '처리', summary: '내용', user: '외부 계정' },
    outcome: { APPLIED: '반영', REJECTED: '거부·되돌림', IGNORED: '변화 없음', UNMAPPED: '계정 매핑 없음' } as Record<string, string>,
    outbox: '보내기 실패',
    noFailures: '실패한 보내기가 없습니다.',
    outboxCol: { at: '만든 시각', system: '시스템', op: '작업', attempts: '시도', error: '오류' },
    simulate: '외부에서 바꿔 보기 (모의 연결일 때만)',
    simulateHint: '실제 도구 대신 모의 외부 시스템에서 사람이 한 일처럼 보냅니다 — 플랫폼은 실제 webhook과 같은 경로로 받습니다.',
    simSystem: '시스템',
    simKey: '항목 키',
    simStatus: '새 상태',
    simUser: '외부 계정',
    simSend: '보내기',
    open: '열기',
    revised: (title: string) => `${title} (개정)`,
    simResult: (outcome: string, summary: string) => `${outcome} — ${summary}`,
    // JIRA에서 Epic 만들기 → PROPOSED Feature 자동 등록(사용자 결정 2026-10-23)
    epicNew: 'JIRA에서 Epic 만들기 → Feature 자동 등록',
    epicNewHint: 'JIRA에서 Epic을 만든 것처럼 보냅니다. 작성 권한이 있는 계정이고 범위(국가·차종·트림·ASIL·담당 조직)가 모두 있으면 플랫폼에 PROPOSED Feature가 등록되고 Epic과 연결됩니다. 빠진 값이 있으면 등록하지 않고 Epic에 이유를 댓글로 남깁니다.',
    epicTitle: 'Epic 제목 (= Feature 이름)',
    epicBody: '설명',
    epicCreate: 'Epic 만들기',
  },
} as const;
