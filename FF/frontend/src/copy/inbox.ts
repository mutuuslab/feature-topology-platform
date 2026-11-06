// 검토함·작업공간 홈·다음 차례 문구(담당자 E2E W2 — P2-3·P3-6·P1-4·P2-5·P1-6·P1-11·P1-13·P4-9). ko.master.inbox의 대기열에 새 대기열을 더한다.
import { master } from './master';

/** 대기열 이름 — 앞의 7개는 ko.master.inbox.queues 그대로 */
export const QUEUE_LABEL = {
  ...master.inbox.queues,
  definition: '정의 승인 대기',
  refReview: 'Feature DB 검토 대기',
  signoff: 'Release Sign-off 대기',
  release: '출시 가능',
  deploy: '배포 대기',
  gate: 'Gate 판정 대기',
  postReview: '긴급 차단 사후 검토',
  homologation: '형식승인 영향 판단 대기',
} as const;
export type QueueKey = keyof typeof QUEUE_LABEL;

/** 대기열을 처리하는 사람(패널 머리) — 차단은 보고서 승인 역할 전부(FSM·CSM·운영 리더·상품 Owner·품질·법규) */
export const QUEUE_ROLE: Record<QueueKey, string> = {
  ...master.inbox.roles,
  kill: '차단 승인자 2인 — F2 이상 안전·보안은 Safety Manager(FSM)·사이버보안(CSM), 그 밖은 운영 리더·상품 Owner·품질·법규도',
  definition: 'Feature 승인자(작성자 제외)',
  refReview: '도메인 검토자(요청자 제외)',
  signoff: 'Feature Owner',
  release: '출시 담당',
  deploy: '출시 담당·운영자',
  gate: 'Gate 판정자·Safety Manager',
  postReview: '독립 검토자(요청자·승인자 제외)',
  homologation: '법규 담당자',
};

/** 보고서 승인 역할 → 화면 이름(차단·복원 '내 차례'가 어느 칸인지) */
export const SLOT_LABEL: Record<string, string> = { FSM: 'Safety Manager(FSM)', CSM: '사이버보안(CSM)', OPS_LEAD: '운영 리더', PRODUCT_OWNER: '상품 Owner', QA: '품질', REGULATORY: '법규' };

export const inbox = {
  /** 내 차례 칸 — 행동 자격(판정 결과 PASS·승인됨과 다른 색·말) */
  reviewable: '검토 가능',
  slot: (label: string) => `${label} 칸으로 승인`,
  ownDefinition: '내가 작성한 제안은 승인할 수 없습니다(직무 분리)',
  reviewed: '이미 검토 의견을 냈습니다',
  signedStale: 'G8·G9가 다시 판정돼 다시 서명해야 합니다',
  due: { left: (t: string) => `남은 ${t}`, over: (t: string) => `기한 지남 ${t}` },
  col: { due: '기한' },
  approvals: (n: number, of: number) => `승인 ${n}/${of}`,
  gate: (gate: string, name: string) => `${gate} ${name}`,
  classification: (f: string) => `안전 분류 ${f} 확정`,
  signoff: 'G8·G9 PASS — Feature Owner 서명 차례',
  release: (who: string) => `서명 ${who} — 출시 전이 차례`,
  deploy: (flag: string) => `승인됨 · ${flag} 배포 차례`,
  definition: (who: string) => `G1~G3 PASS — 작성 ${who}`,
  refReview: (kind: string, who: string) => `${kind} 요청 · 요청 ${who}`,
  postReview: (who: string) => `발행 뒤 24시간 안 사후 검토 · 요청 ${who}`,
  /** 결재함 — 부서 대기열 */
  deptScope: (dept: string) => `${dept} 대기열`,
  queueAllDept: '부서 전체',
} as const;

/** 작업공간 홈 — 역할별 핵심 메시지·내 업무 */
export const homeWork = {
  key: (labels: string[]) => `내 차례 — ${labels.join(' · ')}`,
  tiles: '내 차례 대기열',
  tileGo: '처리하러 가기',
  procedure: '절차',
  procedureHint: '업무 절차 문서',
  loading: '불러오는 중',
  myFeatures: '내 Feature',
  recentFeatures: '최근 Feature',
  myFeaturesHint: '최근에 만든 순',
  signoffs: 'Release Sign-off 대기',
  signoffsHint: 'G8·G9 PASS — 서명하면 출시 담당에게 알림이 갑니다',
  signoffGo: '서명하러 가기',
  stale: '다시 서명',
  handoffGo: (name: string) => `${name} 화면 열기`,
};

// 부서 전환 알림(deptNotice)은 copy/departments.ts — 앱 상태(store)가 첫 화면에서 쓰는데 이 파일 전체(업무함 문구)를 끌어오지 않게
export { deptNotice } from './departments';

/** Feature 상세 '다음 차례' 카드(P1-6) */
export const nextTurn = {
  title: '다음 차례',
  mine: '내가 할 일',
  canDo: (what: string) => `지금 ${what}할 수 있습니다`,
  notMine: (who: string) => `내 차례가 아닙니다 — ${who} 차례`,
  waitAuto: (what: string) => `조건이 갖춰지면 ${what}(으)로 자동 전이`,
  nextWho: '다음 담당',
  blockers: '막힌 조건',
  noBlockers: '막힌 조건 없음',
  done: '마지막 단계입니다 — 남은 전이가 없습니다',
  loading: '전이 조건을 불러오는 중',
  roleBlocked: (roles: string) => `권한이 없습니다 — ${roles}만 할 수 있습니다`,
};

/** Release Sign-off 서랍 — 서명 전에 볼 근거(P1-5) */
export const signoffEvidence = { gates: 'G8·G9 판정', safety: 'Safety Case(안전 분류)', evidence: 'Evidence 원장' };
