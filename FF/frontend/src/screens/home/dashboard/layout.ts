// 대시보드 판 모델(v2) — Jira 대시보드처럼 열 레이아웃 위에 가젯 "인스턴스"를 놓는다.
// 같은 종류(type)를 설정(config)만 달리해 여러 개 둘 수 있고, 인스턴스마다 자동 새로 고침·최소화가 있다.
// 화면(Dashboard.tsx)·저장(store.ts)·회귀 시험이 이 순수 함수만 쓴다. 판 모양은 contracts DashboardBoard(서버 검증)와 같다.
import { DASHBOARD_COLUMNS, type DashboardBoard, type DashboardLayout, type GadgetInstance, type GadgetRefresh } from '@ff/contracts';

export type LayoutKind = DashboardLayout;
export type Board = DashboardBoard;
export type Gadget = GadgetInstance;
export type GadgetConfig = GadgetInstance['config'];
export type Refresh = GadgetRefresh;
export type Direction = 'up' | 'down' | 'left' | 'right';

/** 레이아웃별 열 수 — 2L은 왼쪽이 넓은 2열(2:1), 2R은 오른쪽이 넓은 2열(1:2) */
export const COLUMN_COUNT: Record<LayoutKind, number> = DASHBOARD_COLUMNS;
export const LAYOUTS: LayoutKind[] = ['1', '2', '2L', '2R', '3'];
export const REFRESH_OPTIONS: Refresh[] = [0, 1, 5, 15];

const clone = (b: Board): Board => ({ ...b, columns: b.columns.map((c) => [...c]), gadgets: Object.fromEntries(Object.entries(b.gadgets).map(([k, g]) => [k, { ...g, config: { ...g.config } }])) });

/** 빈 판 */
export const emptyBoard = (layout: LayoutKind = '2'): Board => ({ v: 2, layout, columns: Array.from({ length: COLUMN_COUNT[layout] }, () => []), gadgets: {} });

/** 인스턴스 id — 같은 종류를 여러 개 둘 수 있게 종류와 무작위 꼬리 */
export function newGadgetId(type: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${type}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 48);
    if (!used.has(id)) return id;
  }
}

/** 열 수를 n으로 — 넘치는 열의 가젯은 마지막 남는 열 아래로 옮긴다(가젯을 잃지 않는다) */
function fit(columns: string[][], n: number): string[][] {
  const cols = columns.slice(0, n).map((c) => [...c]);
  while (cols.length < n) cols.push([]);
  for (const extra of columns.slice(n)) cols[n - 1].push(...extra);
  return cols;
}

/** 저장된 값이 깨졌거나 모르는 가젯이면 — 모르는 종류·중복·놓이지 않은 설정을 버리고 열 수를 레이아웃에 맞춘다 */
export function normalize(raw: unknown, knownTypes: readonly string[], fallback: Board): Board {
  const b = raw as Partial<Board> | null;
  if (!b || b.v !== 2 || !LAYOUTS.includes(b.layout as LayoutKind) || !Array.isArray(b.columns) || !b.gadgets || typeof b.gadgets !== 'object') return clone(fallback);
  const seen = new Set<string>();
  const gadgets: Record<string, Gadget> = {};
  const cols = b.columns.map((c) =>
    (Array.isArray(c) ? c : []).filter((id) => {
      const g = (b.gadgets as Record<string, Gadget>)[id];
      if (typeof id !== 'string' || seen.has(id) || !g || !knownTypes.includes(g.type)) return false;
      seen.add(id);
      gadgets[id] = { id, type: g.type, config: { ...(g.config ?? {}) }, configured: g.configured !== false, refresh: REFRESH_OPTIONS.includes(g.refresh as Refresh) ? (g.refresh as Refresh) : 0, minimized: !!g.minimized };
      return true;
    }),
  );
  return { v: 2, layout: b.layout as LayoutKind, columns: fit(cols, COLUMN_COUNT[b.layout as LayoutKind]), gadgets };
}

/** 레이아웃 바꾸기 — 열이 줄면 넘친 가젯을 마지막 열 아래로, 열이 늘면 새 열이 비지 않게 나눠 준다.
 *  나눌 때는 가젯 높이(heights, 화면이 잰 값 — 없으면 1)로 가장 긴 열의 맨 아래 가젯을 가장 짧은 열 아래로,
 *  그렇게 옮겨도 가장 긴 열보다 길어지지 않을 때만 옮긴다(열 안의 위아래 순서는 그대로) */
export function setLayout(b: Board, layout: LayoutKind, heights: Record<string, number> = {}): Board {
  const n = COLUMN_COUNT[layout];
  const grew = n > b.columns.length;
  const next: Board = { ...clone(b), layout, columns: fit(b.columns, n) };
  if (!grew) return next;
  const h = (id: string) => heights[id] ?? 1;
  const total = (c: string[]) => c.reduce((s, id) => s + h(id), 0);
  const moved: string[][] = next.columns.map(() => []);
  for (let guard = 0; guard < 64; guard++) {
    const sums = next.columns.map((c, i) => total(c) + total(moved[i]));
    const long = sums.indexOf(Math.max(...sums));
    const short = sums.indexOf(Math.min(...sums));
    const from = moved[long].length ? moved[long] : next.columns[long];
    const last = from.at(-1);
    if (!last || next.columns[long].length + moved[long].length < 2 || sums[short] + h(last) >= sums[long]) break;
    moved[short].unshift(from.pop()!);
  }
  next.columns = next.columns.map((c, i) => [...c, ...moved[i]]);
  return next;
}

export function locate(b: Board, id: string): { col: number; index: number } | null {
  for (let col = 0; col < b.columns.length; col++) {
    const index = b.columns[col].indexOf(id);
    if (index >= 0) return { col, index };
  }
  return null;
}

/** id를 col열 index 자리로 — index는 옮기기 전 그 열 기준(끌어 놓기 표시 자리 그대로). 범위 밖이면 열 끝 */
export function move(b: Board, id: string, col: number, index: number): Board {
  const from = locate(b, id);
  if (!from || col < 0 || col >= b.columns.length) return b;
  const next = clone(b);
  next.columns[from.col].splice(from.index, 1);
  // 같은 열에서 아래로 옮기면 빠진 자리만큼 하나 당긴다
  const at = from.col === col && from.index < index ? index - 1 : index;
  const target = next.columns[col];
  target.splice(Math.max(0, Math.min(at, target.length)), 0, id);
  return next;
}

/** 키보드·메뉴용 이동 — 끌기를 못 쓰는 사용자도 같은 배치를 만든다(WCAG 2.5.7) */
export function moveBy(b: Board, id: string, dir: Direction): Board {
  const at = locate(b, id);
  if (!at) return b;
  if (dir === 'up') return at.index === 0 ? b : move(b, id, at.col, at.index - 1);
  if (dir === 'down') return at.index >= b.columns[at.col].length - 1 ? b : move(b, id, at.col, at.index + 2);
  const col = at.col + (dir === 'left' ? -1 : 1);
  if (col < 0 || col >= b.columns.length) return b;
  return move(b, id, col, Math.min(at.index, b.columns[col].length));
}

/** 가젯 추가 — Jira처럼 첫 열 맨 위에, 설정 양식이 열린 채로. 같은 종류도 새 인스턴스로 */
export function addGadget(b: Board, type: string, config: GadgetConfig = {}, opts: { configured?: boolean; id?: string; col?: number } = {}): { board: Board; id: string } {
  const next = clone(b);
  const id = opts.id && !next.gadgets[opts.id] ? opts.id : newGadgetId(type, Object.keys(next.gadgets));
  next.gadgets[id] = { id, type, config: { ...config }, configured: opts.configured ?? false, refresh: 0, minimized: false };
  next.columns[Math.min(opts.col ?? 0, next.columns.length - 1)].unshift(id);
  return { board: next, id };
}

export function removeGadget(b: Board, id: string): Board {
  if (!b.gadgets[id]) return b;
  const next = clone(b);
  next.columns = next.columns.map((c) => c.filter((x) => x !== id));
  delete next.gadgets[id];
  return next;
}

/** 설정 저장 — 저장하면 보기 상태가 된다 */
export function configureGadget(b: Board, id: string, config: GadgetConfig): Board {
  if (!b.gadgets[id]) return b;
  const next = clone(b);
  next.gadgets[id] = { ...next.gadgets[id], config: { ...config }, configured: true };
  return next;
}

export function setRefresh(b: Board, id: string, refresh: Refresh): Board {
  if (!b.gadgets[id] || b.gadgets[id].refresh === refresh) return b;
  const next = clone(b);
  next.gadgets[id] = { ...next.gadgets[id], refresh };
  return next;
}

/** Jira의 최소화 — 머리만 남긴다(저장) */
export function toggleMinimized(b: Board, id: string): Board {
  if (!b.gadgets[id]) return b;
  const next = clone(b);
  next.gadgets[id] = { ...next.gadgets[id], minimized: !next.gadgets[id].minimized };
  return next;
}

export const placed = (b: Board) => b.columns.flat();
export const countOf = (b: Board, type: string) => Object.values(b.gadgets).filter((g) => g.type === type).length;

/** 끌어 놓을 자리 — 열 안 가젯들의 세로 가운데와 포인터 높이를 비교한다(가운데보다 위면 그 앞) */
export function dropIndex(midpoints: readonly number[], y: number): number {
  const i = midpoints.findIndex((m) => y < m);
  return i < 0 ? midpoints.length : i;
}

// ───────── v1 → v2 한 번 옮기기 ─────────
// v1(2026-10-24 첫 판): 역할별 localStorage `ff.dashboard.v1.<role>` = { v:1, layout:'1'|'2'|'2L'|'3', columns: 가젯 ID[][], collapsed }.
// v1 가젯 ID는 종류이기도 했다 — 인스턴스 id로 그대로 쓰고, 바뀐 종류만 옮긴다(접힘 → 최소화).

/** v1 가젯 ID → v2 종류·설정 */
const V1_TYPES: Record<string, { type: string; config?: GadgetConfig }> = {
  governance: { type: 'intro' },
  summary: { type: 'summary' },
  procedures: { type: 'procedures' },
  myWork: { type: 'assigned' },
  kills: { type: 'kills' },
  anomalies: { type: 'filter', config: { source: 'anomalies', status: 'open', rows: 10 } },
  lifecycle: { type: 'lifecycle' },
  links: { type: 'links' },
  activity: { type: 'activity' },
};

export const V1_KEY = (role: string) => `ff.dashboard.v1.${role}`;

/** v1 배치 → v2 판. 알아볼 수 없으면 null */
export function migrateV1(raw: unknown): Board | null {
  const b = raw as { v?: number; layout?: string; columns?: unknown; collapsed?: unknown } | null;
  if (!b || b.v !== 1 || !Array.isArray(b.columns) || !['1', '2', '2L', '3'].includes(String(b.layout))) return null;
  const layout = b.layout as LayoutKind;
  const collapsed = new Set(Array.isArray(b.collapsed) ? (b.collapsed as string[]) : []);
  const gadgets: Record<string, Gadget> = {};
  const columns = (b.columns as unknown[]).map((c) =>
    (Array.isArray(c) ? (c as unknown[]) : []).filter((id): id is string => {
      if (typeof id !== 'string' || gadgets[id] || !V1_TYPES[id]) return false;
      const t = V1_TYPES[id];
      gadgets[id] = { id, type: t.type, config: { ...(t.config ?? {}) }, configured: true, refresh: 0, minimized: collapsed.has(id) };
      return true;
    }),
  );
  return { v: 2, layout, columns: fit(columns, COLUMN_COUNT[layout]), gadgets };
}

/** 이 역할의 v1 배치를 읽는다(없으면 null) — 옮긴 뒤 clearV1로 지워 한 번만 옮긴다 */
export function readV1(role: string): Board | null {
  try {
    return migrateV1(JSON.parse(localStorage.getItem(V1_KEY(role)) ?? 'null'));
  } catch {
    return null;
  }
}

export function clearV1(role: string): void {
  try {
    localStorage.removeItem(V1_KEY(role));
  } catch {
    /* 무시 */
  }
}
