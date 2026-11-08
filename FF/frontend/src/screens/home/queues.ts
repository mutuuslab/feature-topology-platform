// 검토함 대기열 규칙(화면 몫, W2) — 부서별로 어떤 대기열을 보는지, 급한 순서, 역할별로 먼저 보이는 대기열.
// 대기열에 들어가는 조건은 contracts(rules/work-queue)·서버가, 내 차례 판정은 Inbox.useInbox가 정한다.
import type { GateId } from '@ff/contracts';
import type { QueueKey } from '../../copy/inbox';

export interface QueueItem {
  key: string;
  queue: QueueKey;
  item: string;
  detail: string;
  since: string | null;
  who: string | null;
  mine: boolean;
  why: string | null;
  to: string;
  /** 처리 기한(차단 승인 대기 만료·사후 검토 기한) — 없으면 null */
  due: string | null;
  /** 내 차례면 어느 칸으로(차단·복원 승인 역할) */
  slot: string | null;
  featureId: string | null;
  gate: GateId | null;
}

/** Gate → 판정·검토를 맡는 심사 부서(결재함). 절차 모델의 판정 활동과 같은 묶음 */
export const GATE_DEPTS: Record<GateId, string[]> = {
  G1: ['DEP-SE'],
  G2: ['DEP-FS'],
  G3: ['DEP-PLM'],
  G4: ['DEP-QA'],
  G5: ['DEP-VAL'],
  G6: ['DEP-QA'],
  G7: ['DEP-FS', 'DEP-CS'],
  G8: ['DEP-HOM'],
  G9: ['DEP-QA'],
};

/** 대기열 → 그 대기열을 보는 부서. 빈 목록이면 부서 보기에서 보이지 않는다(전체 보기는 모두) */
export const QUEUE_DEPTS: Record<QueueKey, string[]> = {
  kill: ['DEP-FS', 'DEP-CS', 'DEP-OPS'],
  restore: ['DEP-FS', 'DEP-CS', 'DEP-OPS'],
  postReview: ['DEP-QA', 'DEP-CS'],
  gate: [], // Gate별 — GATE_DEPTS
  safety: ['DEP-FS'],
  definition: ['DEP-PDP', 'DEP-SE'],
  refReview: ['DEP-SE'],
  baseline: ['DEP-PLM'],
  policy: ['DEP-SE'],
  product: ['DEP-PDP'],
  signoff: ['DEP-PDP'],
  release: ['DEP-INT'],
  deploy: ['DEP-INT', 'DEP-OPS'],
  sync: ['DEP-INT', 'DEP-SE'],
  homologation: ['DEP-HOM'],
  modelUse: ['DEP-FS', 'DEP-OPS'],
  finding: ['DEP-OPS', 'DEP-FS', 'DEP-PDP'],
  canaryHold: ['DEP-INT', 'DEP-OPS'],
  rejudge: ['DEP-SE', 'DEP-QA', 'DEP-FS'],
};

export const inDept = (i: Pick<QueueItem, 'queue' | 'gate'>, dept: string | null | undefined) =>
  !dept || (i.queue === 'gate' && i.gate ? GATE_DEPTS[i.gate].includes(dept) : QUEUE_DEPTS[i.queue].includes(dept));

/** 급한 순서 — 긴급 차단·복원(남은 기한) → 사후 검토 → Gate → 승인·확정 → 상품 → 안전 분류 확정 → 연계 충돌 */
export const QUEUE_RANK: Record<QueueKey, number> = {
  kill: 0,
  restore: 1,
  postReview: 2,
  gate: 3,
  definition: 4,
  refReview: 4,
  baseline: 5,
  policy: 5,
  signoff: 5,
  release: 5,
  deploy: 5,
  product: 6,
  safety: 7,
  sync: 8,
  homologation: 4,
  finding: 3,
  canaryHold: 3,
  modelUse: 6,
  rejudge: 3,
};

const t = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

/** 급한 순서로 — 같은 묶음 안에서는 기한이 가까운 것, 그다음 오래 기다린 것 */
export function byUrgency<T extends Pick<QueueItem, 'queue' | 'due' | 'since' | 'key'>>(items: readonly T[]): T[] {
  // 시각은 한 번씩만 읽는다 — 비교마다 Date.parse를 부르면 대기열 수백 건에서 느렸다
  const keyed = items.map((i) => ({ i, rank: QUEUE_RANK[i.queue], due: t(i.due), since: t(i.since) }));
  keyed.sort((a, b) => a.rank - b.rank || a.due - b.due || a.since - b.since || a.i.key.localeCompare(b.i.key));
  return keyed.map((k) => k.i);
}

/** 패널 순서 — 대기열 묶음도 급한 순서 */
export const QUEUE_ORDER = (Object.keys(QUEUE_RANK) as QueueKey[]).sort((a, b) => QUEUE_RANK[a] - QUEUE_RANK[b]);

/** 데모 계정별로 홈 핵심 메시지·'내 차례 대기열'에 먼저 보이는 대기열(P2-5·P1-11) */
export const ROLE_FOCUS: Record<string, QueueKey[]> = {
  author: ['signoff'],
  approver: ['definition', 'refReview', 'policy', 'product'],
  quality: ['gate', 'kill', 'restore', 'safety'],
  operator: ['deploy', 'kill'],
  steward: ['baseline'],
  commerce: ['product'],
  integrator: ['kill', 'restore', 'sync'],
  coordinator: ['release', 'deploy'],
  viewer: ['postReview'],
  opslead: ['kill', 'restore', 'finding', 'modelUse'],
  safety2: ['restore', 'kill', 'gate'],
  productowner: ['product'],
  sysadmin: [], // 시스템 관리자 — 결재 대기열이 없다(계정 상태·소유자 이관은 플랫폼 인증·권한 화면)
};
