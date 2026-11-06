// 가젯 종류 목록과 역할별 시스템 대시보드 — Jira의 가젯 디렉터리·"System dashboard".
// 여기는 판 틀이 첫 화면에서 쓰는 가벼운 정보(제목·분류·기본 구성·다시 읽을 조회)만 둔다.
// 본문(bodies-*.tsx)·구성 양식(GadgetConfig.tsx)·디렉터리(Directory.tsx)는 필요할 때 읽는다(첫 화면 묶음 예산).
import { dashboard } from '../../../copy/dashboard';
import { addGadget, emptyBoard, type Board, type GadgetConfig, type LayoutKind } from './layout';

const T = dashboard.board.types;

/** 긴급 차단 중 상업 비활성화(체험 만료 등)는 빼고 센다 — 5년 운영이면 수십 건이 늘 걸려 있다 */
export const isSafetyKill = (k: { reasonCategory?: string }) => k.reasonCategory !== 'COMMERCIAL';

export type GadgetType = keyof typeof T;
export type Category = 'charts' | 'lists' | 'ops' | 'shortcuts';
/** 본문이 들어 있는 지연 묶음 */
export type BodyModule = 'lists' | 'charts' | 'ops';

export interface GadgetTypeDef {
  type: GadgetType;
  category: Category;
  module: BodyModule;
  /** 처음 놓을 때의 구성 */
  defaults: GadgetConfig;
  /** 놓은 뒤 구성 양식을 먼저 보이는가(데이터·기준을 골라야 하는 가젯) */
  needsConfig: boolean;
  /** 새로 고침할 때 다시 읽을 조회 이름 — 구성(데이터 원천)에 따라 다를 수 있다 */
  apis: (config: GadgetConfig) => string[];
  /** 머리 오른쪽 '전체 보기' */
  link?: string;
}

/** 데이터 원천 → 조회 이름(새로 고침 대상) */
export const SOURCE_APIS: Record<string, string[]> = {
  features: ['listFeatures'],
  policies: ['listPolicies'],
  myReviews: ['baselineRequests', 'listPolicies', 'listProducts', 'safetyProfiles', 'killRequests', 'extConflicts'],
  kills: ['killRequests'],
  anomalies: ['anomalies'],
  audit: ['audit'],
  reviews: ['listPolicies'],
};
const bySource = (c: GadgetConfig) => SOURCE_APIS[String(c.source ?? 'features')] ?? [];

export const GADGET_TYPES: GadgetTypeDef[] = [
  { type: 'filter', category: 'lists', module: 'lists', needsConfig: true, apis: bySource, defaults: { source: 'features', status: '', mine: false, columns: ['key', 'summary', 'status'], rows: 10, sort: 'key', order: 'asc', title: '' } },
  { type: 'assigned', category: 'lists', module: 'lists', needsConfig: false, apis: () => [...SOURCE_APIS.myReviews, 'procedureInbox'], defaults: { rows: 10, title: '' }, link: '/admin/approval' },
  { type: 'activity', category: 'lists', module: 'lists', needsConfig: false, apis: () => ['audit'], defaults: { rows: 10, title: '' }, link: '/audit' },
  { type: 'pie', category: 'charts', module: 'charts', needsConfig: true, apis: bySource, defaults: { source: 'features', groupBy: 'lifecycle', title: '' } },
  { type: 'twoD', category: 'charts', module: 'charts', needsConfig: true, apis: bySource, defaults: { source: 'features', y: 'lifecycle', x: 'asil', title: '' } },
  { type: 'createdResolved', category: 'charts', module: 'charts', needsConfig: true, apis: bySource, defaults: { source: 'anomalies', days: 30, title: '' } },
  { type: 'lifecycle', category: 'charts', module: 'charts', needsConfig: false, apis: () => ['listFeatures'], defaults: { title: '' }, link: '/features' },
  { type: 'summary', category: 'ops', module: 'ops', needsConfig: false, apis: () => ['listFeatures', 'listPolicies', 'killRequests', 'anomalies', 'vehicles', 'fleetPopulation'], defaults: { title: '' } },
  { type: 'kills', category: 'ops', module: 'ops', needsConfig: false, apis: () => ['killRequests'], defaults: { title: '' }, link: '/ops/kill' },
  { type: 'procedures', category: 'ops', module: 'ops', needsConfig: false, apis: () => ['procedureSummary'], defaults: { title: '' }, link: '/procedures' },
  { type: 'links', category: 'shortcuts', module: 'ops', needsConfig: false, apis: () => [], defaults: { title: '' } },
  { type: 'intro', category: 'shortcuts', module: 'ops', needsConfig: false, apis: () => [], defaults: { title: '' } },
];

export const TYPE_IDS = GADGET_TYPES.map((t) => t.type);
export const typeDef = (type: string) => GADGET_TYPES.find((t) => t.type === type);
export const typeTitle = (type: string) => (T as Record<string, { title: string }>)[type]?.title ?? type;

/** 가젯 제목 — 구성의 제목이 있으면 그것, 필터 결과는 데이터 이름을 붙인다(Jira "Filter Results: …") */
export function gadgetTitle(type: string, config: GadgetConfig): string {
  const custom = typeof config.title === 'string' ? config.title.trim() : '';
  if (custom) return custom;
  const base = typeTitle(type);
  const src = (dashboard.board.sources as Record<string, string>)[String(config.source ?? '')];
  return src && ['filter', 'pie', 'twoD', 'createdResolved'].includes(type) ? `${base}: ${src}` : base;
}

// ───────── 역할별 시스템 대시보드 ─────────
// 데모 데이터의 ID를 박지 않는다(빈 설치 RD-OPS-02) — 원천·상태·기준만 고르고, 빈 결과는 각 가젯이 빈 상태로 말한다.

type Slot = [type: GadgetType, config?: GadgetConfig, id?: string];

function build(layout: LayoutKind, columns: Slot[][]): Board {
  let b = emptyBoard(layout);
  // addGadget은 첫 열 맨 위에 넣는다 — 열마다 아래에서 위로 넣어 적은 순서를 지킨다
  columns.forEach((slots, col) => {
    for (const [type, config, id] of [...slots].reverse()) {
      const def = typeDef(type)!;
      b = addGadget(b, type, { ...def.defaults, ...config }, { configured: true, id: id ?? type, col }).board;
    }
  });
  return b;
}

const ROLE_BOARDS: Record<string, () => Board> = {
  // Feature 설계 — 내 차례·개발 중 Feature·Lifecycle 비율
  author: () =>
    build('2L', [
      [['assigned'], ['filter', { source: 'features', status: 'DEVELOPING', columns: ['key', 'summary', 'asil', 'status'] }, 'filter-1'], ['procedures']],
      [['summary'], ['pie', { source: 'features', groupBy: 'lifecycle' }, 'pie-1'], ['activity'], ['links']],
    ]),
  // 구성 승인 — 승인 기다리는 정책·검토 추이
  approver: () =>
    build('2L', [
      [['assigned'], ['filter', { source: 'policies', status: 'VALIDATED', columns: ['key', 'flagKey', 'feature', 'status'] }, 'filter-1'], ['procedures']],
      [['summary'], ['createdResolved', { source: 'reviews', days: 30 }, 'createdResolved-1'], ['pie', { source: 'policies', groupBy: 'status' }, 'pie-1']],
    ]),
  // 품질 검토 — Lifecycle × ASIL, 열린 이상 건
  quality: () =>
    build('2L', [
      [['assigned'], ['twoD', { source: 'features', y: 'lifecycle', x: 'asil' }, 'twoD-1'], ['procedures']],
      [['summary'], ['filter', { source: 'anomalies', status: 'open', columns: ['key', 'kind', 'severity', 'status'] }, 'filter-1'], ['pie', { source: 'features', groupBy: 'asil' }, 'pie-1']],
    ]),
  // 차량 운영 — 긴급 차단·이상 건 추이
  operator: () =>
    build('2L', [
      [['kills'], ['filter', { source: 'anomalies', status: 'open', columns: ['key', 'kind', 'severity', 'status'] }, 'filter-1'], ['procedures']],
      [['summary'], ['createdResolved', { source: 'anomalies', days: 30 }, 'createdResolved-1'], ['pie', { source: 'anomalies', groupBy: 'severity' }, 'pie-1'], ['links']],
    ]),
  // PLM 기준정보 — 지역 × Lifecycle, 차종 비율
  steward: () =>
    build('2L', [
      [['assigned'], ['twoD', { source: 'features', y: 'country', x: 'lifecycle' }, 'twoD-1'], ['procedures']],
      [['summary'], ['pie', { source: 'features', groupBy: 'vehicleModel' }, 'pie-1'], ['activity'], ['links']],
    ]),
  // 상품 권리 — 출시된 Feature, 지역 비율
  commerce: () =>
    build('2L', [
      [['filter', { source: 'features', status: 'RELEASED', columns: ['key', 'summary', 'country', 'status'] }, 'filter-1'], ['procedures']],
      [['summary'], ['pie', { source: 'features', groupBy: 'country' }, 'pie-1'], ['links']],
    ]),
  // 시스템 연계 — 활동·감사, 이상 건
  integrator: () =>
    build('2L', [
      [['assigned'], ['activity'], ['procedures']],
      [['summary'], ['pie', { source: 'anomalies', groupBy: 'kind' }, 'pie-1'], ['links']],
    ]),
  // 협의와 개발 이관 · 출시 — 검증된 Feature, Lifecycle 비율
  coordinator: () =>
    build('2L', [
      [['assigned'], ['filter', { source: 'features', status: 'VERIFIED', columns: ['key', 'summary', 'country', 'status'] }, 'filter-1'], ['procedures']],
      [['summary'], ['pie', { source: 'features', groupBy: 'lifecycle' }, 'pie-1'], ['createdResolved', { source: 'reviews', days: 30 }, 'createdResolved-1']],
    ]),
  // 조회 — 운영 요약·활동
  viewer: () =>
    build('2L', [
      [['filter', { source: 'features', columns: ['key', 'summary', 'country', 'status'] }, 'filter-1'], ['twoD', { source: 'features', y: 'lifecycle', x: 'asil' }, 'twoD-1'], ['procedures']],
      [['summary'], ['lifecycle'], ['activity'], ['links']],
    ]),
};

/** 역할의 시스템 대시보드 판 — 모르는 역할은 조회 판 */
export const systemBoard = (role: string): Board => (ROLE_BOARDS[role] ?? ROLE_BOARDS.viewer)();
