// 대시보드 배치 모델 — Jira 대시보드처럼 열 레이아웃 위에 가젯을 놓고, 끌어서 옮기고, 추가·제거한다.
// 화면(Dashboard.tsx)과 회귀 시험이 이 순수 함수만 쓴다. 저장은 역할별 localStorage(설치 서버의 사용자 설정 API가 생기면 그쪽으로).

export type LayoutKind = '1' | '2' | '2L' | '3';
/** 레이아웃별 열 수 — 2L은 왼쪽이 넓은 2열(2:1) */
export const COLUMN_COUNT: Record<LayoutKind, number> = { '1': 1, '2': 2, '2L': 2, '3': 3 };
export const LAYOUTS = Object.keys(COLUMN_COUNT) as LayoutKind[];

export interface Board {
  v: 1;
  layout: LayoutKind;
  /** 열마다 위에서 아래로 가젯 ID */
  columns: string[][];
  /** 접어 둔 가젯 */
  collapsed: string[];
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const clone = (b: Board): Board => ({ ...b, columns: b.columns.map((c) => [...c]), collapsed: [...b.collapsed] });

/** 저장된 값이 깨졌거나 옛 판이어도 쓸 수 있게 — 모르는 가젯·중복을 버리고 열 수를 레이아웃에 맞춘다 */
export function normalize(raw: unknown, known: readonly string[], fallback: Board): Board {
  const b = raw as Partial<Board> | null;
  if (!b || b.v !== 1 || !LAYOUTS.includes(b.layout as LayoutKind) || !Array.isArray(b.columns)) return clone(fallback);
  const seen = new Set<string>();
  const cols = b.columns.map((c) => (Array.isArray(c) ? c.filter((id) => typeof id === 'string' && known.includes(id) && !seen.has(id) && (seen.add(id), true)) : []));
  const out = fit({ v: 1, layout: b.layout as LayoutKind, columns: cols, collapsed: [] }, COLUMN_COUNT[b.layout as LayoutKind]);
  out.collapsed = (Array.isArray(b.collapsed) ? b.collapsed : []).filter((id) => seen.has(id));
  return out;
}

/** 열 수를 n으로 — 넘치는 열의 가젯은 마지막 남는 열 아래로 옮긴다(가젯을 잃지 않는다) */
function fit(b: Board, n: number): Board {
  const cols = b.columns.slice(0, n);
  while (cols.length < n) cols.push([]);
  for (const extra of b.columns.slice(n)) cols[n - 1].push(...extra);
  return { ...b, columns: cols };
}

/** 레이아웃 바꾸기 — 열이 줄면 넘친 가젯을 마지막 열 아래로, 열이 늘면 새 열이 비지 않게 나눠 준다.
 *  나눌 때는 가젯 높이(heights, 화면이 잰 값 — 없으면 1)로 가장 긴 열의 맨 아래 가젯을 가장 짧은 열 아래로,
 *  그렇게 옮겨도 가장 긴 열보다 길어지지 않을 때만 옮긴다(열 안의 위아래 순서는 그대로). 끌어 옮긴 배치는 다시 나누지 않는다 */
export function setLayout(b: Board, layout: LayoutKind, heights: Record<string, number> = {}): Board {
  const n = COLUMN_COUNT[layout];
  const grew = n > b.columns.length;
  const next = { ...fit(clone(b), n), layout };
  if (!grew) return next;
  const h = (id: string) => heights[id] ?? 1;
  const total = (c: string[]) => c.reduce((s, id) => s + h(id), 0);
  // 옮긴 가젯은 받는 열의 아래에 원래 순서로 붙인다 — 거버넌스 현황 같은 맨 위 가젯 위로 끼어들지 않게
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

/** 가젯 추가 — Jira처럼 첫 열 맨 위에. 이미 있으면 그대로 */
export function add(b: Board, id: string, col = 0): Board {
  if (locate(b, id)) return b;
  const next = clone(b);
  next.columns[Math.min(col, next.columns.length - 1)].unshift(id);
  return next;
}

export function remove(b: Board, id: string): Board {
  const next = clone(b);
  next.columns = next.columns.map((c) => c.filter((x) => x !== id));
  next.collapsed = next.collapsed.filter((x) => x !== id);
  return next;
}

export function toggleCollapsed(b: Board, id: string): Board {
  const next = clone(b);
  next.collapsed = next.collapsed.includes(id) ? next.collapsed.filter((x) => x !== id) : [...next.collapsed, id];
  return next;
}

export const placed = (b: Board) => b.columns.flat();

/** 끌어 놓을 자리 — 열 안 가젯들의 세로 가운데와 포인터 높이를 비교한다(가운데보다 위면 그 앞) */
export function dropIndex(midpoints: readonly number[], y: number): number {
  const i = midpoints.findIndex((m) => y < m);
  return i < 0 ? midpoints.length : i;
}

const KEY = (role: string) => `ff.dashboard.v1.${role}`;

export function loadBoard(role: string, known: readonly string[], fallback: Board): Board {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY(role)) ?? 'null'), known, fallback);
  } catch {
    return clone(fallback);
  }
}

export function saveBoard(role: string, b: Board): void {
  try {
    localStorage.setItem(KEY(role), JSON.stringify(b));
  } catch {
    /* 저장소를 못 쓰면 이번 세션 배치만 유지 */
  }
}

export function resetBoard(role: string): void {
  try {
    localStorage.removeItem(KEY(role));
  } catch {
    /* 무시 */
  }
}
