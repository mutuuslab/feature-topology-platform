// 스윔레인 흐름도 배치 — 외부 라이브러리 없이(dagre/elk 미사용) 순수 함수로 좌표를 계산한다.
// 단계: ① 순환 끊기(DFS 역방향 간선) ② 열 = 위상 순위(최장 경로 + 뒤 활동 쪽으로 당기기) ③ 레인 순서(간선의 레인 거리 합 최소화, 인접 교환)
//       ④ 레인 안 행 = 무게중심 정렬(위·아래로 4회) ⑤ 포트·통로 배정 ⑥ 직교 경로(열 사이 틈의 세로 통로 + 행 사이 띠의 가로 통로).
// 상자는 (행 × 열) 칸에 하나만 놓이고, 간선은 상자 안을 지나지 않는다(틈·띠만 쓴다). 같은 입력이면 같은 좌표가 나온다(결정적).
// 간선은 두 가지로 붙는다: 옆(side, 오른쪽에서 나가 왼쪽으로 — 제어 흐름) · 위아래(vert, 아래에서 나가 위로 — 객체 흐름).
// 'free' 상자(산출물 문서)는 열을 정할 때 빠지고, 이어진 상자의 열 가까이 빈 칸에 나중에 놓인다.

export type Shape = 'rect' | 'diamond' | 'circle' | 'doc';

export interface LNode {
  id: string;
  lane: string;
  w: number;
  h: number;
  shape: Shape;
  /** 'succ' = 뒤 상자 바로 앞 열(사건 시작), 'last' = 마지막 열(종료) */
  pin?: 'succ' | 'last';
  /** 열 계산에서 빠지고, 위아래 간선으로 이어진 상자의 열 가까이 빈 칸에 놓인다(산출물 문서) */
  free?: boolean;
}

export interface LEdge {
  id: string;
  from: string;
  to: string;
  /** 출구 구간 위에 쓰는 이름(산출물) — 없으면 이름표 없음 */
  label?: string;
  /** 선 모양 묶음 — 같은 이름표라도 모양(실선·점선)이 다르면 한 줄기로 묶지 않는다 */
  style?: string;
  /** 'vert' = 위아래 변에 붙는 간선(객체 흐름) — 아래로 가면 아래 변에서 나가 위 변으로 들어간다 */
  route?: 'side' | 'vert';
  /** 열 순서에만 쓰고 그리지 않는다(산출물 의존) */
  hidden?: boolean;
  /** 같은 상자에서 같은 trunk로 나가는 간선은 한 출구 줄기를 함께 쓴다 */
  trunk?: string;
  /** 같은 상자로 같은 merge로 들어오는 간선은 한 입구를 함께 쓴다(종료로 모이는 간선) */
  merge?: string;
}

export interface LayoutOptions {
  laneLabelW?: number;
  /** 이름표가 있는 틈의 이름표 자리 폭 */
  labelW?: number;
  /** 열·틈 최소 폭 — 여러 배치의 열을 맞출 때(내 업무 흐름) */
  minColW?: number[];
  minGapW?: number[];
  /** 맨 위·맨 아래 띠의 기본 높이 */
  outerBand?: number;
  /** 레인 안 행 사이 띠의 기본 높이 */
  innerBand?: number;
  /** 자리를 바꾸지 않는 레인(맨 위 입력·맨 아래 산출물) */
  pinnedLanes?: string[];
}

export type PNode<N extends LNode = LNode> = N & {
  x: number;
  y: number;
  rank: number;
  lane: string;
  laneIndex: number;
  row: number;
};

export type PEdge<E extends LEdge = LEdge> = E & {
  points: [number, number][];
  back: boolean;
  /** 이름표 자리(왼쪽 아래 기준선) — 자리가 좁으면 null */
  labelAt: { x: number; y: number; maxW: number; lines: 1 | 2 } | null;
  /** 같은 출구 줄기를 함께 쓰는 묶음(같은 산출물을 여러 곳에) */
  bundle: string | null;
};

export interface PLane {
  id: string;
  index: number;
  y: number;
  h: number;
}

export interface FlowLayout<N extends LNode = LNode, E extends LEdge = LEdge> {
  width: number;
  height: number;
  laneLabelW: number;
  colX: number[];
  colW: number[];
  gapW: number[];
  lanes: PLane[];
  nodes: PNode<N>[];
  edges: PEdge<E>[];
  joins: [number, number][];
  /** 합류 막대 — 같은 상자로 모이는 간선(merge)의 공용 세로 줄기 */
  bars: { x: number; y1: number; y2: number }[];
}

const PORT = 16; // 포트 간격(이름표 한 줄이 들어가는 높이)
const TRACK = 14; // 틈 안 세로 통로 간격
const BAND_TRACK = 10; // 띠 안 가로 통로 간격
const PAD = 12;
/** 레인 경계선·도식 가장자리와 통로 사이 최소 거리 */
const EDGE_CLEAR = 12;
const MIN_ZONE = 20;
const COL_X0 = 16;

/** 상자 모양 가장자리의 x — 가운데에서 dy만큼 떨어진 높이에서 */
export function outlineX(n: { x: number; y: number; w: number; h: number; shape: Shape }, dy: number, side: 'left' | 'right'): number {
  const cx = n.x + n.w / 2;
  const half =
    n.shape === 'rect' || n.shape === 'doc'
      ? n.w / 2
      : n.shape === 'diamond'
        ? (n.w / 2) * Math.max(0, 1 - Math.abs(dy) / (n.h / 2))
        : Math.sqrt(Math.max(0, (n.w / 2) ** 2 - dy * dy));
  return side === 'right' ? cx + half : cx - half;
}

/** 포트를 둘 수 있는 가운데에서의 최대 거리 */
const portRoom = (shape: Shape, h: number) => (shape === 'rect' || shape === 'doc' ? h / 2 - PORT : shape === 'diamond' ? h / 4 : (h / 2) * 0.6);

/** 포트 n개가 들어가도록 키운 크기 */
export function fitPorts<N extends LNode>(n: N, ports: number): N {
  const need = ((Math.max(1, ports) - 1) * PORT) / 2;
  if (need <= portRoom(n.shape, n.h)) return n;
  const rectLike = n.shape === 'rect' || n.shape === 'doc';
  const h = rectLike ? 2 * (need + PORT) : n.shape === 'diamond' ? 4 * need : (2 * need) / 0.6;
  const size = Math.ceil(h);
  return rectLike ? { ...n, h: size } : { ...n, w: size, h: size };
}

interface Seg {
  edge: string;
  x: number;
  y1: number;
  y2: number;
}

/** 순서를 지키는 통로 배정 — i번째는 i-1번째보다 왼쪽(작은 번호)에 오지 않고, 겹치지 않으면 같은 통로를 함께 쓴다 */
function packOrdered(items: { key: string; lo: number; hi: number; owner?: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  const used: { lo: number; hi: number; owner?: string }[][] = [];
  let min = 0;
  for (const it of items) {
    let t = min;
    // 같은 상자로 들어가거나(입구) 같은 상자에서 나오는(출구) 다른 간선끼리는 통로를 나눠 쓰지 않는다 — 한 줄처럼 보이지 않게
    while (used[t]?.some((u) => (u.lo < it.hi && it.lo < u.hi) || (!!it.owner && u.owner === it.owner))) t++;
    (used[t] ??= []).push(it);
    out.set(it.key, t);
    min = t;
  }
  return out;
}

/** 겹치는 점·한 줄 위 가운데 점을 뺀다 */
function simplify(pts: [number, number][]): [number, number][] {
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
  const out: [number, number][] = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5)) out.splice(i, 1);
  }
  return out;
}

/** 순서를 지키되 위아래 제약을 먼저 맞추는 통로 배정 — A(위에서 오는 세로)가 다른 통로의 B(아래로 가는 세로)와 같은 x면 그 통로보다 위 */
function packConstrained(items: { key: string; lo: number; hi: number; A: number[]; B: number[] }[]): Map<string, number> {
  const near = (xs: number[], ys: number[]) => xs.some((x) => ys.some((y) => Math.abs(x - y) < 6));
  const above = items.map((it) => items.filter((o) => o !== it && near(o.A, it.B)));
  const out = new Map<string, number>();
  const used: { lo: number; hi: number }[][] = [];
  const left = [...items];
  let min = 0;
  while (left.length) {
    const i = Math.max(0, left.findIndex((it) => above[items.indexOf(it)].every((o) => out.has(o.key) || !left.includes(o))));
    const it = left.splice(i, 1)[0];
    let t = Math.max(min, ...above[items.indexOf(it)].filter((o) => out.has(o.key)).map((o) => out.get(o.key)! + 1));
    while (used[t]?.some((u) => u.lo < it.hi && it.lo < u.hi)) t++;
    (used[t] ??= []).push(it);
    out.set(it.key, t);
    min = t;
  }
  return out;
}

export function layoutFlow<N extends LNode, E extends LEdge>(input: { nodes: N[]; edges: E[]; laneOrder?: string[] }, opt: LayoutOptions = {}): FlowLayout<N, E> {
  const laneLabelW = opt.laneLabelW ?? 116;
  const labelW = opt.labelW ?? 100;
  const ids = new Set(input.nodes.map((n) => n.id));
  const valid = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  /** 열·레인 순서를 정하는 간선(옆 간선 + 숨은 간선) */
  const edges = valid.filter((e) => e.route !== 'vert');
  /** 그리는 옆 간선 */
  const side = edges.filter((e) => !e.hidden);
  /** 위아래 간선(객체 흐름) */
  const vert = valid.filter((e) => e.route === 'vert');
  const order = new Map(input.nodes.map((n, i) => [n.id, i]));
  const isFree = new Map(input.nodes.map((n) => [n.id, !!n.free]));
  const out = new Map<string, E[]>(input.nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from)!.push(e);

  // ① 순환 끊기 — 모델 순서 DFS, 스택 위 상자로 가는 간선은 되돌림
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id)!) {
      const s = state.get(e.to);
      if (s === 1) back.add(e.id);
      else if (!s) dfs(e.to);
    }
    state.set(id, 2);
  };
  for (const n of input.nodes) if (!state.has(n.id)) dfs(n.id);
  const fwd = edges.filter((e) => !back.has(e.id));
  const preds = new Map<string, string[]>(input.nodes.map((n) => [n.id, []]));
  const succs = new Map<string, string[]>(input.nodes.map((n) => [n.id, []]));
  for (const e of fwd) {
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
  }
  const pin = new Map(input.nodes.map((n) => [n.id, n.pin]));

  // ② 열 — 최장 경로, 이어서 뒤 상자 쪽으로 당겨 긴 간선을 줄인다
  const topo: string[] = [];
  {
    const indeg = new Map(input.nodes.map((n) => [n.id, preds.get(n.id)!.length]));
    const q = input.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
    while (q.length) {
      q.sort((a, b) => order.get(a)! - order.get(b)!);
      const id = q.shift()!;
      topo.push(id);
      for (const s of succs.get(id)!) {
        indeg.set(s, indeg.get(s)! - 1);
        if (!indeg.get(s)) q.push(s);
      }
    }
  }
  const rank = new Map<string, number>();
  for (const id of topo) rank.set(id, Math.max(0, ...preds.get(id)!.map((p) => rank.get(p)! + 1)));
  const maxOf = () => Math.max(0, ...[...rank.entries()].filter(([id]) => pin.get(id) !== 'last' && !isFree.get(id)).map(([, r]) => r));
  for (const id of [...topo].reverse()) {
    // 시작(뿌리)에서 바로 오는 상자는 당기지 않는다 — 시작 바로 뒤에 둔다
    if (pin.get(id) || isFree.get(id) || preds.get(id)!.every((p) => !preds.get(p)!.length)) continue;
    const ss = succs.get(id)!.filter((s) => pin.get(s) !== 'last').map((s) => rank.get(s)!);
    if (ss.length) rank.set(id, Math.max(rank.get(id)!, Math.min(...ss) - 1));
  }
  for (const id of topo) if (pin.get(id) === 'succ') rank.set(id, Math.max(0, Math.min(...succs.get(id)!.map((s) => rank.get(s)!), Infinity) - 1));
  const last = maxOf() + 1;
  for (const id of topo) if (pin.get(id) === 'last') rank.set(id, Math.max(last, ...preds.get(id)!.map((p) => rank.get(p)! + 1)));
  const nRanks = Math.max(0, ...[...rank.entries()].filter(([id]) => !isFree.get(id)).map(([, r]) => r)) + 1;

  // ②' 떠 있는 상자(문서) — 이어진 상자의 열 칸(레인×열), 차 있으면 한 칸 옆, 그것도 차면 같은 칸에 줄을 더한다
  {
    const used = new Set(input.nodes.filter((n) => !n.free).map((n) => `${n.lane}|${rank.get(n.id)}`));
    const wantOf = (id: string) => {
      const to = vert.filter((e) => e.from === id && !isFree.get(e.to)).map((e) => rank.get(e.to)!);
      const from = vert.filter((e) => e.to === id && !isFree.get(e.from)).map((e) => rank.get(e.from)!);
      if (from.length) return { want: Math.min(...from), dir: 1 };
      if (to.length) return { want: Math.min(...to), dir: -1 };
      return { want: 0, dir: 1 };
    };
    const free = input.nodes.filter((n) => n.free).map((n) => ({ n, ...wantOf(n.id) }));
    free.sort((a, b) => a.want - b.want || order.get(a.n.id)! - order.get(b.n.id)!);
    for (const f of free) {
      // 바로 아래(위) 칸 → 한두 칸 옆(산출물은 오른쪽, 입력은 왼쪽 먼저) → 모두 차면 같은 칸에 한 줄 더(멀리 보내지 않는다)
      let r = f.want;
      // 입력 문서(뒤 상자로 감)는 입력 레인 빈 칸 어디든 가까운 순, 산출물은 오른쪽 한두 칸·왼쪽 한 칸 안 — 그보다 멀면 같은 칸에 쌓는다(만든 활동 밑을 떠나지 않게)
      const steps = [0];
      if (f.dir < 0) for (let d = 1; d <= nRanks; d++) steps.push(-d, d);
      else steps.push(1, -1, 2);
      for (const step of steps) {
        const c = f.want + step;
        if (c < 0 || c >= nRanks || used.has(`${f.n.lane}|${c}`)) continue;
        r = c;
        break;
      }
      rank.set(f.n.id, Math.max(0, Math.min(nRanks - 1, r)));
      used.add(`${f.n.lane}|${rank.get(f.n.id)}`);
    }
  }

  // ③ 레인 순서 — 처음 나온 순서에서 시작해, 간선이 건너는 레인 수 합이 줄면 이웃 레인을 바꾼다(고정 레인은 그대로)
  const lanes: string[] = [];
  for (const id of input.laneOrder ?? []) if (!lanes.includes(id) && input.nodes.some((n) => n.lane === id)) lanes.push(id);
  for (const n of [...input.nodes].sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || order.get(a.id)! - order.get(b.id)!)) if (!lanes.includes(n.lane)) lanes.push(n.lane);
  const pinnedLane = new Set(opt.pinnedLanes ?? []);
  const laneOf = new Map(input.nodes.map((n) => [n.id, n.lane]));
  const cost = (ls: string[]) => {
    const ix = new Map(ls.map((l, i) => [l, i]));
    return fwd.reduce((s, e) => s + Math.abs(ix.get(laneOf.get(e.from)!)! - ix.get(laneOf.get(e.to)!)!), 0);
  };
  for (let pass = 0, improved = true; improved && pass < 32; pass++) {
    improved = false;
    for (let i = 0; i + 1 < lanes.length; i++) {
      if (pinnedLane.has(lanes[i]) || pinnedLane.has(lanes[i + 1])) continue;
      const swapped = [...lanes];
      [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      if (cost(swapped) < cost(lanes)) {
        lanes.splice(0, lanes.length, ...swapped);
        improved = true;
      }
    }
  }
  const laneIx = new Map(lanes.map((l, i) => [l, i]));

  // ④ 레인 안 행 — 칸(레인×열)마다 상자를 나누고, 이웃 상자 행의 평균으로 정렬
  const cells = new Map<string, string[]>();
  for (const n of input.nodes) {
    const k = `${n.lane}|${rank.get(n.id)}`;
    cells.set(k, [...(cells.get(k) ?? []), n.id]);
  }
  const rowsOf = new Map(lanes.map((l) => [l, Math.max(1, ...[...cells.entries()].filter(([k]) => k.startsWith(`${l}|`)).map(([, v]) => v.length))]));
  const row = new Map<string, number>();
  for (const list of cells.values()) list.forEach((id, i) => row.set(id, i));
  const sweep = (dir: 1 | -1) => {
    const ranks = Array.from({ length: nRanks }, (_, i) => (dir === 1 ? i : nRanks - 1 - i));
    for (const r of ranks)
      for (const l of lanes) {
        const list = cells.get(`${l}|${r}`);
        if (!list) continue;
        const R = rowsOf.get(l)!;
        const want = (id: string) => {
          const nb = dir === 1 ? preds.get(id)! : succs.get(id)!;
          const same = nb.filter((x) => laneOf.get(x) === l);
          if (same.length) return same.reduce((s, x) => s + row.get(x)!, 0) / same.length;
          if (!nb.length) return row.get(id)!;
          const avg = nb.reduce((s, x) => s + laneIx.get(laneOf.get(x)!)!, 0) / nb.length;
          return avg > laneIx.get(l)! ? R - 1 : 0;
        };
        const sorted = list.map((id) => ({ id, w: want(id) })).sort((a, b) => a.w - b.w || order.get(a.id)! - order.get(b.id)!);
        let prev = -1;
        const rows = sorted.map((s) => (prev = Math.max(prev + 1, Math.round(s.w))));
        // 넘치면 뒤에서부터 위로 민다
        for (let i = rows.length - 1, cap = R - 1; i >= 0; i--, cap--) rows[i] = Math.min(rows[i], cap);
        sorted.forEach((s, i) => row.set(s.id, rows[i]));
      }
  };
  for (let i = 0; i < 4; i++) sweep(i % 2 === 0 ? 1 : -1);

  // 전역 행(레인 순서대로 쌓은 행)
  const gRowBase = new Map<string, number>();
  let G = 0;
  for (const l of lanes) {
    gRowBase.set(l, G);
    G += rowsOf.get(l)!;
  }
  const gRow = (id: string) => gRowBase.get(laneOf.get(id)!)! + row.get(id)!;

  // ⑤ 포트 — 출구는 대상 행 순서, 입구는 출발 행 순서(교차 줄임). 포트 수만큼 상자를 키운다
  const sideOut = new Map<string, E[]>(input.nodes.map((n) => [n.id, []]));
  const allIn = new Map<string, E[]>(input.nodes.map((n) => [n.id, []]));
  for (const e of side) {
    sideOut.get(e.from)!.push(e);
    allIn.get(e.to)!.push(e);
  }
  const key = (id: string) => gRow(id) * 1000 + rank.get(id)!;
  const exitsOf = new Map<string, E[]>();
  const entriesOf = new Map<string, E[]>();
  for (const n of input.nodes) {
    exitsOf.set(n.id, [...sideOut.get(n.id)!].sort((a, b) => Number(back.has(a.id)) - Number(back.has(b.id)) || key(a.to) - key(b.to) || order.get(a.to)! - order.get(b.to)!));
    entriesOf.set(n.id, [...allIn.get(n.id)!].sort((a, b) => Number(back.has(a.id)) - Number(back.has(b.id)) || key(a.from) - key(b.from) || order.get(a.from)! - order.get(b.from)!));
  }
  // 같은 산출물을 여러 곳에 넘기는 출구(또는 같은 trunk)는 한 줄기(묶음)로 나가 통로에서 갈라진다 — 이름표는 한 번만
  const bundleOf = new Map<string, string>();
  const exitSlots = new Map<string, string[]>();
  for (const n of input.nodes) {
    const slots: string[] = [];
    const ex = exitsOf.get(n.id)!;
    for (const e of ex) {
      const same = back.has(e.id)
        ? []
        : e.trunk
          ? ex.filter((f) => f.trunk === e.trunk && !back.has(f.id))
          : e.label
            ? ex.filter((f) => !f.trunk && f.label === e.label && f.style === e.style && !back.has(f.id))
            : [];
      const slot = same.length > 1 ? `${n.id}|${e.trunk ? `t:${e.trunk}` : `${e.style ?? ''}|${e.label}`}` : e.id;
      if (same.length > 1) bundleOf.set(e.id, slot);
      if (!slots.includes(slot)) slots.push(slot);
    }
    exitSlots.set(n.id, slots);
  }
  const slotOf = (e: LEdge) => bundleOf.get(e.id) ?? e.id;
  // 같은 merge로 들어오는 입구는 한 점 — 마지막 세로 줄기를 함께 쓴다
  const mergeOf = new Map<string, string>();
  const entrySlots = new Map<string, string[]>();
  for (const n of input.nodes) {
    const slots: string[] = [];
    const en = entriesOf.get(n.id)!;
    for (const e of en) {
      const same = e.merge && !back.has(e.id) ? en.filter((f) => f.merge === e.merge && !back.has(f.id)) : [];
      const slot = same.length > 1 ? `${n.id}|m:${e.merge}` : e.id;
      if (same.length > 1) mergeOf.set(e.id, slot);
      if (!slots.includes(slot)) slots.push(slot);
    }
    entrySlots.set(n.id, slots);
  }
  const inSlotOf = (e: LEdge) => mergeOf.get(e.id) ?? e.id;
  /** 같은 상자에서 같은 이름표로 나가는 간선 중 첫 간선만 이름표를 단다(묶음이든, 선 모양이 달라 따로 나가든) */
  const labelOwner = (e: LEdge) => back.has(e.id) || exitsOf.get(e.from)!.find((f) => f.label === e.label && !back.has(f.id))!.id === e.id;
  const sized = new Map(input.nodes.map((n) => [n.id, fitPorts(n, Math.max(exitSlots.get(n.id)!.length, entrySlots.get(n.id)!.length))]));
  const offset = (i: number, n: number) => (i - (n - 1) / 2) * PORT;
  const exitDy = new Map<string, number>();
  const entryDy = new Map<string, number>();
  for (const n of input.nodes) {
    const slots = exitSlots.get(n.id)!;
    for (const e of exitsOf.get(n.id)!) exitDy.set(e.id, offset(slots.indexOf(slotOf(e)), slots.length));
    const ins = entrySlots.get(n.id)!;
    for (const e of entriesOf.get(n.id)!) entryDy.set(e.id, offset(ins.indexOf(inSlotOf(e)), ins.length));
  }
  const setEntry = (e: LEdge, dy: number) => {
    const s = inSlotOf(e);
    for (const f of entriesOf.get(e.to)!) if (inSlotOf(f) === s) entryDy.set(f.id, dy);
  };

  // 열 폭·행 높이
  const colW = Array.from({ length: nRanks }, (_, r) => Math.max(opt.minColW?.[r] ?? 0, ...input.nodes.filter((n) => rank.get(n.id) === r).map((n) => sized.get(n.id)!.w)));
  const rowH = Array.from({ length: G }, (_, g) => Math.max(0, ...input.nodes.filter((n) => gRow(n.id) === g).map((n) => sized.get(n.id)!.h)));

  // 간선 종류: 이웃 열(adj) · 먼 열(long, 띠 사용) · 되돌림(back, 아래 띠)
  type Kind = 'adj' | 'long' | 'back';
  const kindOf = (e: LEdge): Kind => (back.has(e.id) ? 'back' : rank.get(e.to)! - rank.get(e.from)! === 1 ? 'adj' : 'long');
  /** 띠 번호 b = 전역 행 b 위(0..G, G = 맨 아래) */
  const bandOf = (e: LEdge): number => {
    const a = gRow(e.from);
    const b = gRow(e.to);
    if (back.has(e.id)) return Math.max(a, b) + 1;
    return b > a ? b : b < a ? b + 1 : a;
  };

  // 위아래 간선(객체 흐름) — 아래로 가면 출발 아래 띠·도착 위 띠, 위로 가면 반대. 두 띠가 같으면 바로, 아니면 도착 열이 비었을 때 곧게, 막히면 틈 세로 통로
  type VRoute = { up: boolean; b1: number; b2: number; via: 'band' | 'column' | 'gap'; gap: number };
  const vRoute = new Map<string, VRoute>();
  for (const e of vert) {
    const a = gRow(e.from);
    const b = gRow(e.to);
    const up = b < a;
    const b1 = up ? a : a + 1;
    const b2 = up ? b + 1 : b;
    const rt = rank.get(e.to)!;
    const lo = Math.min(b1, b2);
    const hi = Math.max(b1, b2);
    const blocked = input.nodes.some((n) => n.id !== e.to && n.id !== e.from && rank.get(n.id) === rt && gRow(n.id) >= lo && gRow(n.id) < hi);
    // 산출물로 내려가는 간선은 출발 열 오른쪽 틈, 활동으로 들어가는 간선은 도착 열 왼쪽 틈
    const toDoc = isFree.get(e.to) && !isFree.get(e.from);
    const rs = rank.get(e.from)!;
    const gap = toDoc ? (rs < nRanks - 1 ? rs : rs - 1) : rt > 0 ? rt - 1 : 0;
    vRoute.set(e.id, { up, b1, b2, via: b1 === b2 ? 'band' : blocked ? 'gap' : 'column', gap });
  }
  // 위·아래 변 포트 — 변마다 상대 상자 열 순서대로 펼친다. 한 상자에서 같은 변으로 나가는 간선은 한 포트(묶음)
  const vBundle = new Map<string, string>();
  const vPortX = new Map<string, number>(); // `${edge}|s` / `${edge}|t` → 가운데에서의 x 거리
  {
    const ports = new Map<string, { key: string; other: string; edges: string[]; end: 's' | 't' }[]>();
    const add = (node: string, sideKey: string, slot: string, other: string, edge: string, end: 's' | 't') => {
      const k = `${node}|${sideKey}`;
      const list = ports.get(k) ?? [];
      const hit = list.find((p) => p.key === slot);
      if (hit) hit.edges.push(edge);
      else list.push({ key: slot, other, edges: [edge], end });
      ports.set(k, list);
    };
    for (const e of vert) {
      const r = vRoute.get(e.id)!;
      const sSide = r.up ? 'top' : 'bottom';
      add(e.from, sSide, `${e.from}|v|${sSide}`, e.to, e.id, 's');
      add(e.to, r.up ? 'bottom' : 'top', e.id, e.from, e.id, 't');
    }
    for (const [k, list] of ports) {
      const node = sized.get(k.slice(0, k.lastIndexOf('|')))!;
      list.sort((p, q) => rank.get(p.other)! - rank.get(q.other)! || gRow(p.other) - gRow(q.other) || (p.key < q.key ? -1 : 1));
      const step = list.length > 1 ? Math.min(28, (node.w - 32) / (list.length - 1)) : 0;
      list.forEach((p, i) => {
        for (const id of p.edges) vPortX.set(`${id}|${p.end}`, (i - (list.length - 1) / 2) * step);
        if (p.edges.length > 1) for (const id of p.edges) vBundle.set(id, p.key);
      });
    }
  }
  const vSlot = (e: LEdge) => vBundle.get(e.id) ?? e.id;

  // y 좌표는 띠 높이에 달려 있다 — 기본 높이로 한 번 놓고, 띠 통로 수를 센 뒤 다시 놓는다(순서는 그대로라 통로 배정이 바뀌지 않는다)
  const outer = opt.outerBand ?? 20;
  const boundary = (b: number) => b > 0 && b < G && lanes.some((l) => gRowBase.get(l)! === b);
  const baseBand = (b: number) => {
    if (b === 0 || b === G) return outer;
    return boundary(b) ? 28 : opt.innerBand ?? 20;
  };
  const place = (bandTracks: number[]) => {
    // 레인 경계 띠는 통로를 경계선 아래쪽에 둔다(경계선과 겹쳐 보이지 않게) — 그만큼 높이를 더 잡는다
    // 바깥 띠(맨 위·아래)도 가장자리에서 띄운다
    const bandH = Array.from({ length: G + 1 }, (_, b) => {
      const t = bandTracks[b];
      if (!t) return baseBand(b);
      if (boundary(b)) return Math.max(baseBand(b), 2 * (EDGE_CLEAR + (t - 1) * BAND_TRACK + 10));
      if (b === 0 || b === G) return Math.max(baseBand(b), 2 * EDGE_CLEAR + (t - 1) * BAND_TRACK);
      return Math.max(baseBand(b), (t + 1) * BAND_TRACK);
    });
    const bandY: number[] = [];
    const rowY: number[] = [];
    let y = 0;
    for (let g = 0; g <= G; g++) {
      bandY.push(y);
      y += bandH[g];
      if (g < G) {
        rowY.push(y);
        y += rowH[g];
      }
    }
    return { bandH, bandY, rowY, height: y };
  };
  let ys = place(Array(G + 1).fill(0));
  const cyOf = (id: string) => ys.rowY[gRow(id)] + rowH[gRow(id)] / 2;
  const exitY = (e: LEdge) => cyOf(e.from) + exitDy.get(e.id)!;
  const entryY = (e: LEdge) => cyOf(e.to) + entryDy.get(e.id)!;

  // 같은 행의 이웃 열 간선은 곧게 — 한쪽 포트가 하나뿐이면 다른 쪽 높이에 맞춘다
  for (const e of side) {
    if (back.has(e.id) || rank.get(e.to)! - rank.get(e.from)! !== 1 || gRow(e.from) !== gRow(e.to)) continue;
    if (entrySlots.get(e.to)!.length === 1 && !mergeOf.has(e.id) && Math.abs(exitDy.get(e.id)!) <= portRoom(sized.get(e.to)!.shape, sized.get(e.to)!.h)) entryDy.set(e.id, exitDy.get(e.id)!);
    else if (exitSlots.get(e.from)!.length === 1 && !bundleOf.has(e.id) && Math.abs(entryDy.get(e.id)!) <= portRoom(sized.get(e.from)!.shape, sized.get(e.from)!.h)) exitDy.set(e.id, entryDy.get(e.id)!);
  }

  // 같은 틈에서 출구(왼쪽에서 오는 가로)와 입구(오른쪽으로 가는 가로)가 같은 높이면 겹칠 수 있다 — 입구를 비켜 놓는다
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const e of side) {
      const r = rank.get(e.to)! - 1;
      const ey = entryY(e);
      const clash = side.find((f) => f.id !== e.id && inSlotOf(f) !== inSlotOf(e) && rank.get(f.from) === r && Math.abs(exitY(f) - ey) < 2);
      if (clash) {
        setEntry(e, entryDy.get(e.id)! + (entryDy.get(e.id)! >= 0 ? 6 : -6));
        moved = true;
      }
    }
    if (!moved) break;
  }

  // 세로 통로(틈 g = 열 g와 g+1 사이). 교차를 줄이는 순서로 왼쪽부터 놓는다:
  //   [산출물로 내려가는 객체 흐름] [출구 쪽(먼 간선의 첫 세로)] [이웃 열 간선] [입구 쪽(먼 간선의 마지막 세로)] [활동으로 들어가는 객체 흐름]
  //   출구·이웃: 아래로 가면 위에서 나온 것이 오른쪽, 위로 가면 아래에서 나온 것이 오른쪽
  //   입구: 위에서 오면 위쪽 입구가 오른쪽, 아래에서 오면 아래쪽 입구가 오른쪽
  const bandMid = (b: number) => ys.bandY[b] + ys.bandH[b] / 2;
  type V = { gap: number; key: string; group: 0 | 1 | 2 | 3 | 4; attach: number; other: number; owner: string };
  const verticals: V[] = [];
  for (const e of side) {
    const k = kindOf(e);
    const y1 = exitY(e);
    const y2 = entryY(e);
    if (k === 'adj') {
      if (Math.abs(y1 - y2) > 0.5) {
        if (mergeOf.has(e.id)) verticals.push({ gap: rank.get(e.from)!, key: `${inSlotOf(e)}#2`, group: 3, attach: y2, other: y1, owner: e.to });
        else verticals.push({ gap: rank.get(e.from)!, key: `${slotOf(e)}#1`, group: 2, attach: y1, other: y2, owner: e.to });
      }
    } else {
      const yb = bandMid(bandOf(e));
      verticals.push({ gap: rank.get(e.from)!, key: `${slotOf(e)}#1`, group: 1, attach: y1, other: yb, owner: e.from });
      verticals.push({ gap: rank.get(e.to)! - 1, key: `${inSlotOf(e)}#2`, group: 3, attach: y2, other: yb, owner: e.to });
    }
  }
  for (const e of vert) {
    const r = vRoute.get(e.id)!;
    if (r.via !== 'gap') continue;
    const y1 = bandMid(r.b1);
    const y2 = bandMid(r.b2);
    const toDoc = isFree.get(e.to) && !isFree.get(e.from);
    verticals.push(toDoc ? { gap: r.gap, key: `${e.id}#v`, group: 0, attach: y1, other: y2, owner: e.from } : { gap: r.gap, key: `${e.id}#v`, group: 4, attach: y2, other: y1, owner: e.to });
  }
  const vOrder = (a: V, b: V) => {
    if (a.group !== b.group) return a.group - b.group;
    const da = a.other > a.attach ? 1 : 0;
    const db = b.other > b.attach ? 1 : 0;
    if (da !== db) return da - db;
    // 출구·이웃(group 0·1·2): 아래로(1) → attach 내림차순, 위로(0) → 오름차순 / 입구(group 3·4): 위에서 옴(0) → 내림차순, 아래에서 옴(1) → 오름차순
    const desc = a.group >= 3 ? da === 0 : da === 1;
    return (desc ? b.attach - a.attach : a.attach - b.attach) || (a.key < b.key ? -1 : 1);
  };
  const trackOf = new Map<string, number>();
  const gapTracks = Array(Math.max(0, nRanks - 1)).fill(0);
  for (let g = 0; g < nRanks - 1; g++) {
    // 묶음은 한 세로 줄기 — 구간을 합친다
    const merged = new Map<string, V & { lo: number; hi: number }>();
    for (const v of verticals.filter((x) => x.gap === g)) {
      const m = merged.get(v.key);
      if (!m) merged.set(v.key, { ...v, lo: Math.min(v.attach, v.other), hi: Math.max(v.attach, v.other) });
      else {
        m.group = Math.min(m.group, v.group) as V['group'];
        if (Math.abs(v.other - v.attach) > Math.abs(m.other - m.attach)) m.other = v.other;
        m.lo = Math.min(m.lo, v.attach, v.other);
        m.hi = Math.max(m.hi, v.attach, v.other);
      }
    }
    const items = [...merged.values()].sort(vOrder).map((v) => ({ key: v.key, lo: v.lo - 3, hi: v.hi + 3, owner: v.owner }));
    const c = packOrdered(items);
    for (const [k, t] of c) trackOf.set(k, t);
    gapTracks[g] = c.size ? Math.max(...c.values()) + 1 : 0;
  }
  const labelled = new Set(side.filter((e) => e.label).map((e) => rank.get(e.from)!));
  const zone = (g: number) => (labelled.has(g) ? labelW : MIN_ZONE);
  const gapW = gapTracks.map((t, g) => Math.max(opt.minGapW?.[g] ?? 0, zone(g) + Math.max(1, t) * TRACK + 2 * PAD));
  const colX: number[] = [];
  {
    let x = laneLabelW + COL_X0;
    for (let r = 0; r < nRanks; r++) {
      colX.push(x);
      x += colW[r] + (gapW[r] ?? 0);
    }
  }
  const width = colX[nRanks - 1] + colW[nRanks - 1] + 24;
  const trackX = (g: number, t: number) => colX[g] + colW[g] + zone(g) + PAD + t * TRACK;
  const cxOf = (id: string) => colX[rank.get(id)!] + colW[rank.get(id)!] / 2;
  const vsx = (e: LEdge) => cxOf(e.from) + vPortX.get(`${e.id}|s`)!;
  const vtx = (e: LEdge) => cxOf(e.to) + vPortX.get(`${e.id}|t`)!;
  // 빈 열을 곧게 지나는 객체 흐름 — 같은 열의 다른 세로(다른 간선의 세로·포트 줄기)와 겹치지 않는 x를 고른다(도착 포트 → 출발 포트 → 가운데에서 12씩)
  const colLine = new Map<string, number>();
  {
    type Seg = { x: number; lo: number; hi: number; edge: string };
    const taken = new Map<number, Seg[]>();
    const take = (r: number, sg: Seg) => taken.set(r, [...(taken.get(r) ?? []), sg]);
    const yEdge = (id: string, top: boolean) => (top ? ys.rowY[gRow(id)] : ys.rowY[gRow(id)] + rowH[gRow(id)]);
    for (const e of vert) {
      const r = vRoute.get(e.id)!;
      // 포트 줄기(상자 변 ↔ 띠 가운데)
      take(rank.get(e.from)!, { x: vsx(e), lo: Math.min(yEdge(e.from, r.up), bandMid(r.b1)), hi: Math.max(yEdge(e.from, r.up), bandMid(r.b1)), edge: e.id });
      take(rank.get(e.to)!, { x: vtx(e), lo: Math.min(yEdge(e.to, !r.up), bandMid(r.b2)), hi: Math.max(yEdge(e.to, !r.up), bandMid(r.b2)), edge: e.id });
    }
    const clash = (r: number, x: number, lo: number, hi: number, edge: string) =>
      (taken.get(r) ?? []).some((t) => t.edge !== edge && Math.abs(t.x - x) < 6 && t.lo < hi + 4 && lo < t.hi + 4);
    for (const e of vert) {
      const r = vRoute.get(e.id)!;
      if (r.via !== 'column') continue;
      const c = rank.get(e.to)!;
      const lo = Math.min(bandMid(r.b1), bandMid(r.b2));
      const hi = Math.max(bandMid(r.b1), bandMid(r.b2));
      const half = colW[c] / 2 - 12;
      const cands = [vtx(e), ...(rank.get(e.from) === c ? [vsx(e)] : [])];
      for (let k = 0; k * 12 <= half; k++) cands.push(cxOf(e.to) + k * 12, cxOf(e.to) - k * 12);
      const x = cands.find((v) => Math.abs(v - cxOf(e.to)) <= half + 0.5 && !clash(c, v, lo, hi, e.id)) ?? vtx(e);
      colLine.set(e.id, x);
      take(c, { x, lo, hi, edge: e.id });
    }
  }

  // 가로 통로(띠) — 위로 들어가는 간선은 위쪽 통로, 아래로 들어가는 간선은 아래쪽 통로.
  //   아래로 들어가면 도착 세로가 오른쪽인 것이 위, 위로 들어가면 도착 세로가 오른쪽인 것이 아래
  //   세로 줄기가 띠 위쪽에서 오는 x(A)와 띠 아래쪽으로 가는 x(B)가 같은 두 통로는 A 쪽을 위에 둔다(같은 x에서 세로가 겹치지 않게)
  type H = { band: number; key: string; up: boolean; x2: number; x1: number; lo: number; hi: number; A: number[]; B: number[] };
  const horizMap = new Map<string, H>();
  const addH = (h: H) => {
    const m = horizMap.get(h.key);
    if (!m) horizMap.set(h.key, h);
    else {
      m.lo = Math.min(m.lo, h.lo);
      m.hi = Math.max(m.hi, h.hi);
      m.A.push(...h.A);
      m.B.push(...h.B);
    }
  };
  const hseg = (band: number, key: string, up: boolean, x1: number, above1: boolean, x2: number, above2: boolean): H => ({
    band,
    key,
    up,
    x1,
    x2,
    lo: Math.min(x1, x2) - 4,
    hi: Math.max(x1, x2) + 4,
    A: [...(above1 ? [x1] : []), ...(above2 ? [x2] : [])],
    B: [...(above1 ? [] : [x1]), ...(above2 ? [] : [x2])],
  });
  for (const e of side) {
    if (kindOf(e) === 'adj') continue;
    const x1 = trackX(rank.get(e.from)!, trackOf.get(`${slotOf(e)}#1`)!);
    const x2 = trackX(rank.get(e.to)! - 1, trackOf.get(`${inSlotOf(e)}#2`)!);
    const b = bandOf(e);
    addH(hseg(b, e.id, gRow(e.to) < b, x1, gRow(e.from) < b, x2, gRow(e.to) < b));
  }
  for (const e of vert) {
    const r = vRoute.get(e.id)!;
    const sx = vsx(e);
    const tx = vtx(e);
    // 아래로 가는 간선: 출발 줄기는 위에서, 이어지는 세로는 아래로 / 위로 가는 간선은 반대
    const dn = !r.up;
    if (r.via !== 'band') {
      const gx = r.via === 'gap' ? trackX(r.gap, trackOf.get(`${e.id}#v`)!) : colLine.get(e.id)!;
      if (Math.abs(sx - gx) > 0.5) addH(hseg(r.b1, `${vSlot(e)}#h1`, r.up, sx, dn, gx, !dn));
      if (Math.abs(gx - tx) > 0.5) addH(hseg(r.b2, `${e.id}#h2`, r.up, gx, dn, tx, !dn));
    } else if (Math.abs(sx - tx) > 0.5) {
      addH(hseg(r.b1, `${vSlot(e)}#h1`, r.up, sx, dn, tx, !dn));
    }
  }
  const horiz = [...horizMap.values()];
  const bandTrack = new Map<string, number>();
  const bandTracks = Array(G + 1).fill(0);
  for (let b = 0; b <= G; b++) {
    const items = horiz
      .filter((h) => h.band === b)
      .sort((p, q) => (p.up === q.up ? (p.up ? p.x2 - q.x2 : q.x2 - p.x2) || p.x1 - q.x1 || (p.key < q.key ? -1 : 1) : p.up ? -1 : 1));
    const c = packConstrained(items);
    for (const [k, t] of c) bandTrack.set(k, t);
    bandTracks[b] = c.size ? Math.max(...c.values()) + 1 : 0;
  }
  ys = place(bandTracks);
  const bandLineY = (b: number, t: number) =>
    boundary(b) ? ys.bandY[b] + ys.bandH[b] / 2 + EDGE_CLEAR + t * BAND_TRACK : ys.bandY[b] + (ys.bandH[b] - (bandTracks[b] - 1) * BAND_TRACK) / 2 + t * BAND_TRACK;

  // 상자 좌표
  const nodes: PNode<N>[] = input.nodes.map((n0) => {
    const n = sized.get(n0.id)!;
    const r = rank.get(n.id)!;
    return { ...n, rank: r, laneIndex: laneIx.get(n.lane)!, row: row.get(n.id)!, x: colX[r] + (colW[r] - n.w) / 2, y: cyOf(n.id) - n.h / 2 };
  });
  const at = new Map(nodes.map((n) => [n.id, n]));

  // ⑥ 경로
  const sidePaths: PEdge<E>[] = side.map((e) => {
    const s = at.get(e.from)!;
    const t = at.get(e.to)!;
    const dy1 = exitDy.get(e.id)!;
    const dy2 = entryDy.get(e.id)!;
    const y1 = cyOf(e.from) + dy1;
    const y2 = cyOf(e.to) + dy2;
    const sx = outlineX(s, dy1, 'right');
    const tx = outlineX(t, dy2, 'left');
    const k = kindOf(e);
    let pts: [number, number][];
    let firstX: number;
    if (k === 'adj') {
      if (Math.abs(y1 - y2) <= 0.5) {
        pts = [[sx, y1], [tx, y1]];
        firstX = tx;
      } else {
        const gx = trackX(s.rank, trackOf.get(mergeOf.has(e.id) ? `${inSlotOf(e)}#2` : `${slotOf(e)}#1`)!);
        pts = [[sx, y1], [gx, y1], [gx, y2], [tx, y2]];
        firstX = gx;
      }
    } else {
      const gx1 = trackX(s.rank, trackOf.get(`${slotOf(e)}#1`)!);
      const gx2 = trackX(t.rank - 1, trackOf.get(`${inSlotOf(e)}#2`)!);
      const yb = bandLineY(bandOf(e), bandTrack.get(e.id)!);
      pts = [[sx, y1], [gx1, y1], [gx1, yb], [gx2, yb], [gx2, y2], [tx, y2]];
      firstX = gx1;
    }
    const lx = s.x + s.w + 6;
    const maxW = firstX - lx - 6;
    // 이름표 둘째 줄은 선 아래 — 아래 출구 이름표와 겹치지 않을 만큼 띄어 있을 때만
    const slots = exitSlots.get(e.from)!;
    const si = slots.indexOf(slotOf(e));
    const room = si + 1 < slots.length ? PORT : s.h / 2 - dy1 - 4;
    const lines = room >= 30 ? 2 : 1;
    const owns = !!e.label && labelOwner(e);
    return { ...e, points: pts, back: back.has(e.id), bundle: bundleOf.get(e.id) ?? mergeOf.get(e.id) ?? null, labelAt: owns && maxW >= 36 ? { x: lx, y: y1 - 4, maxW, lines } : null };
  });
  const vertPaths: PEdge<E>[] = vert.map((e) => {
    const r = vRoute.get(e.id)!;
    const s = at.get(e.from)!;
    const t = at.get(e.to)!;
    const sx = vsx(e);
    const tx = vtx(e);
    const sy = r.up ? s.y : s.y + s.h;
    const ty = r.up ? t.y + t.h : t.y;
    let pts: [number, number][];
    if (r.via !== 'band') {
      const gx = r.via === 'gap' ? trackX(r.gap, trackOf.get(`${e.id}#v`)!) : colLine.get(e.id)!;
      const h1 = bandTrack.get(`${vSlot(e)}#h1`);
      const h2 = bandTrack.get(`${e.id}#h2`);
      const y2 = h2 === undefined ? ty : bandLineY(r.b2, h2);
      const y1 = h1 === undefined ? sy : bandLineY(r.b1, h1);
      pts = [[sx, sy], [sx, y1], [gx, y1], [gx, y2], [tx, y2], [tx, ty]];
    } else if (Math.abs(sx - tx) > 0.5) {
      const y1 = bandLineY(r.b1, bandTrack.get(`${vSlot(e)}#h1`)!);
      pts = [[sx, sy], [sx, y1], [tx, y1], [tx, ty]];
    } else pts = [[sx, sy], [tx, ty]];
    return { ...e, points: simplify(pts), back: false, bundle: vBundle.get(e.id) ?? null, labelAt: null };
  });
  const pedges = [...sidePaths, ...vertPaths];

  // 레인 띠 — 경계는 레인 사이 띠의 가운데
  const planes: PLane[] = lanes.map((l, i) => {
    const first = gRowBase.get(l)!;
    const lastRow = first + rowsOf.get(l)! - 1;
    const top = i === 0 ? 0 : ys.bandY[first] + ys.bandH[first] / 2;
    const bottom = i === lanes.length - 1 ? ys.height : ys.bandY[lastRow + 1] + ys.bandH[lastRow + 1] / 2;
    return { id: l, index: i, y: top, h: bottom - top };
  });

  // 묶음이 갈라지는·모이는 점
  const joins: [number, number][] = [];
  const bars: { x: number; y1: number; y2: number }[] = [];
  const groups = new Map<string, PEdge<E>[]>();
  for (const e of pedges) if (e.bundle) groups.set(e.bundle, [...(groups.get(e.bundle) ?? []), e]);
  const keyXY = ([x, y]: [number, number]) => `${Math.round(x)},${Math.round(y)}`;
  for (const [b, list] of groups) {
    if (list.length < 2) continue;
    if (mergeOf.has(list[0].id)) {
      // 모이는 점 — 마지막 세로 줄기에 다른 간선이 붙는 곳(가장 먼 끝은 줄기의 시작이라 점이 없다)
      const turns = list
        .map((e) => ({ p: e.points.length === 6 ? e.points[3] : e.points.length === 4 ? e.points[1] : null, y: e.points[e.points.length - 1][1] }))
        .filter((t): t is { p: [number, number]; y: number } => !!t.p)
        .sort((m, n) => Math.abs(m.p[1] - m.y) - Math.abs(n.p[1] - n.y));
      // 모이는 세로 줄기를 굵은 막대(합류)로 — 어느 활동들이 함께 끝으로 가는지 보이게
      if (turns.length) {
        const ysOn = [...turns.map((t) => t.p[1]), turns[0].y];
        bars.push({ x: turns[0].p[0], y1: Math.min(...ysOn) - 4, y2: Math.max(...ysOn) + 4 });
      }
      continue;
    }
    const p = list[0].points;
    if (vBundle.has(list[0].id)) {
      // 문서 아래(또는 위) 줄기가 띠에 닿는 점
      if (p.length > 2) joins.push(p[1]);
      continue;
    }
    if (p.length > 2 && b) joins.push(p[1]);
  }
  const uniq = [...new Map(joins.map((j) => [keyXY(j), j])).values()];
  return { width, height: ys.height, laneLabelW, colX, colW, gapW, lanes: planes, nodes, edges: pedges, joins: uniq, bars };
}

// ── 검사 도우미(시험·개발용) ─────────────────────────────────
type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** 배치 결함 목록 — 빈 배열이면 맞다: 상자 겹침, 간선 끝점, 직교 여부, 상자 관통, 같은 선 위 간선 겹침 */
export function layoutProblems(l: FlowLayout<LNode, LEdge>): string[] {
  const out: string[] = [];
  const ids = new Map(l.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < l.nodes.length; i++)
    for (let j = i + 1; j < l.nodes.length; j++) if (overlap(l.nodes[i], l.nodes[j], 4)) out.push(`상자 겹침 ${l.nodes[i].id} ↔ ${l.nodes[j].id}`);
  const segs: { e: string; a: [number, number]; b: [number, number] }[] = [];
  const bundle = new Map(l.edges.map((e) => [e.id, e.bundle]));
  for (const e of l.edges) {
    const s = ids.get(e.from);
    const t = ids.get(e.to);
    if (!s || !t) {
      out.push(`끝점 없는 간선 ${e.id}`);
      continue;
    }
    const p = e.points;
    if (p.length < 2) out.push(`점이 모자란 간선 ${e.id}`);
    const [x0, y0] = p[0];
    const [x1, y1] = p[p.length - 1];
    if (x0 < s.x - 1 || x0 > s.x + s.w + 1 || y0 < s.y - 1 || y0 > s.y + s.h + 1) out.push(`간선 ${e.id} 출발점이 ${s.id} 밖`);
    if (x1 < t.x - 1 || x1 > t.x + t.w + 1 || y1 < t.y - 1 || y1 > t.y + t.h + 1) out.push(`간선 ${e.id} 도착점이 ${t.id} 밖`);
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (Math.abs(a[0] - b[0]) > 0.5 && Math.abs(a[1] - b[1]) > 0.5) out.push(`간선 ${e.id} 사선 구간`);
      segs.push({ e: e.id, a, b });
      // 끝 구간(상자에 붙는 곳)을 뺀 구간이 다른 상자를 지나는지
      const box = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
      for (const n of l.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        if (overlap(box, n, -1)) out.push(`간선 ${e.id}가 상자 ${n.id}를 지난다`);
      }
    }
  }
  // 다른 간선끼리 같은 선 위에서 겹치는 구간(교차는 허용)
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.e === t.e || (bundle.get(s.e) && bundle.get(s.e) === bundle.get(t.e))) continue;
      const sh = Math.abs(s.a[1] - s.b[1]) < 0.5;
      const th = Math.abs(t.a[1] - t.b[1]) < 0.5;
      if (sh && th && Math.abs(s.a[1] - t.a[1]) < 1.5) {
        const lo = Math.max(Math.min(s.a[0], s.b[0]), Math.min(t.a[0], t.b[0]));
        const hi = Math.min(Math.max(s.a[0], s.b[0]), Math.max(t.a[0], t.b[0]));
        if (hi - lo > 2) out.push(`가로 겹침 ${s.e} ↔ ${t.e}`);
      }
      const sv = Math.abs(s.a[0] - s.b[0]) < 0.5;
      const tv = Math.abs(t.a[0] - t.b[0]) < 0.5;
      if (sv && tv && Math.abs(s.a[0] - t.a[0]) < 1.5) {
        const lo = Math.max(Math.min(s.a[1], s.b[1]), Math.min(t.a[1], t.b[1]));
        const hi = Math.min(Math.max(s.a[1], s.b[1]), Math.max(t.a[1], t.b[1]));
        if (hi - lo > 2) out.push(`세로 겹침 ${s.e} ↔ ${t.e}`);
      }
    }
  return out;
}

/** 간선 교차 수(직교 구간끼리) — 배치 품질 측정용 */
export function crossings(l: FlowLayout<LNode, LEdge>): number {
  const segs = l.edges.flatMap((e) => e.points.slice(1).map((b, i) => ({ e: e.id, a: e.points[i], b })));
  let n = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.e === t.e) continue;
      const h = Math.abs(s.a[1] - s.b[1]) < 0.5 ? s : Math.abs(t.a[1] - t.b[1]) < 0.5 ? t : null;
      const v = h === s ? t : s;
      if (!h || Math.abs(v.a[0] - v.b[0]) > 0.5 || h === v) continue;
      const x = v.a[0];
      const y = h.a[1];
      if (x > Math.min(h.a[0], h.b[0]) + 0.5 && x < Math.max(h.a[0], h.b[0]) - 0.5 && y > Math.min(v.a[1], v.b[1]) + 0.5 && y < Math.max(v.a[1], v.b[1]) - 0.5) n++;
    }
  return n;
}
