// 스윔레인 흐름도 배치 — 외부 라이브러리 없이(dagre/elk 미사용) 순수 함수로 좌표를 계산한다.
// 단계: ① 순환 끊기(DFS 역방향 간선) ② 열 = 위상 순위(최장 경로 + 뒤 활동 쪽으로 당기기) ③ 레인 순서(간선의 레인 거리 합 최소화, 인접 교환)
//       ④ 레인 안 행 = 무게중심 정렬(위·아래로 4회) ⑤ 포트·통로 배정 ⑥ 직교 경로(열 사이 틈의 세로 통로 + 행 사이 띠의 가로 통로).
// 상자는 (행 × 열) 칸에 하나만 놓이고, 간선은 상자 안을 지나지 않는다(틈·띠만 쓴다). 같은 입력이면 같은 좌표가 나온다(결정적).

export type Shape = 'rect' | 'diamond' | 'circle';

export interface LNode {
  id: string;
  lane: string;
  w: number;
  h: number;
  shape: Shape;
  /** 'succ' = 뒤 상자 바로 앞 열(사건 시작), 'last' = 마지막 열(종료) */
  pin?: 'succ' | 'last';
}

export interface LEdge {
  id: string;
  from: string;
  to: string;
  /** 출구 구간 위에 쓰는 이름(산출물) — 없으면 이름표 없음 */
  label?: string;
  /** 선 모양 묶음 — 같은 이름표라도 모양(실선·점선)이 다르면 한 줄기로 묶지 않는다 */
  style?: string;
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
}

const PORT = 16; // 포트 간격(이름표 한 줄이 들어가는 높이)
const TRACK = 12; // 틈 안 세로 통로 간격
const BAND_TRACK = 8; // 띠 안 가로 통로 간격
const PAD = 12;
/** 레인 경계선·도식 가장자리와 통로 사이 최소 거리 */
const EDGE_CLEAR = 12;
const MIN_ZONE = 20;
const COL_X0 = 16;

/** 상자 모양 가장자리의 x — 가운데에서 dy만큼 떨어진 높이에서 */
export function outlineX(n: { x: number; y: number; w: number; h: number; shape: Shape }, dy: number, side: 'left' | 'right'): number {
  const cx = n.x + n.w / 2;
  const half =
    n.shape === 'rect'
      ? n.w / 2
      : n.shape === 'diamond'
        ? (n.w / 2) * Math.max(0, 1 - Math.abs(dy) / (n.h / 2))
        : Math.sqrt(Math.max(0, (n.w / 2) ** 2 - dy * dy));
  return side === 'right' ? cx + half : cx - half;
}

/** 포트를 둘 수 있는 가운데에서의 최대 거리 */
const portRoom = (shape: Shape, h: number) => (shape === 'rect' ? h / 2 - PORT : shape === 'diamond' ? h / 4 : (h / 2) * 0.6);

/** 포트 n개가 들어가도록 키운 크기 */
export function fitPorts<N extends LNode>(n: N, ports: number): N {
  const need = ((Math.max(1, ports) - 1) * PORT) / 2;
  if (need <= portRoom(n.shape, n.h)) return n;
  const h = n.shape === 'rect' ? 2 * (need + PORT) : n.shape === 'diamond' ? 4 * need : (2 * need) / 0.6;
  const size = Math.ceil(h);
  return n.shape === 'rect' ? { ...n, h: size } : { ...n, w: size, h: size };
}

interface Seg {
  edge: string;
  x: number;
  y1: number;
  y2: number;
}

/** 순서를 지키는 통로 배정 — i번째는 i-1번째보다 왼쪽(작은 번호)에 오지 않고, 겹치지 않으면 같은 통로를 함께 쓴다 */
function packOrdered(items: { key: string; lo: number; hi: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const used: { lo: number; hi: number }[][] = [];
  let min = 0;
  for (const it of items) {
    let t = min;
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
  const edges = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const order = new Map(input.nodes.map((n, i) => [n.id, i]));
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
  const maxOf = () => Math.max(0, ...[...rank.entries()].filter(([id]) => pin.get(id) !== 'last').map(([, r]) => r));
  for (const id of [...topo].reverse()) {
    // 시작(뿌리)에서 바로 오는 상자는 당기지 않는다 — 시작 바로 뒤에 둔다
    if (pin.get(id) || preds.get(id)!.every((p) => !preds.get(p)!.length)) continue;
    const ss = succs.get(id)!.filter((s) => pin.get(s) !== 'last').map((s) => rank.get(s)!);
    if (ss.length) rank.set(id, Math.max(rank.get(id)!, Math.min(...ss) - 1));
  }
  for (const id of topo) if (pin.get(id) === 'succ') rank.set(id, Math.max(0, Math.min(...succs.get(id)!.map((s) => rank.get(s)!), Infinity) - 1));
  const last = maxOf() + 1;
  for (const id of topo) if (pin.get(id) === 'last') rank.set(id, Math.max(last, ...preds.get(id)!.map((p) => rank.get(p)! + 1)));
  const nRanks = Math.max(...rank.values()) + 1;

  // ③ 레인 순서 — 처음 나온 순서에서 시작해, 간선이 건너는 레인 수 합이 줄면 이웃 레인을 바꾼다
  const lanes: string[] = [];
  for (const id of input.laneOrder ?? []) if (!lanes.includes(id) && input.nodes.some((n) => n.lane === id)) lanes.push(id);
  for (const n of [...input.nodes].sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || order.get(a.id)! - order.get(b.id)!)) if (!lanes.includes(n.lane)) lanes.push(n.lane);
  const laneOf = new Map(input.nodes.map((n) => [n.id, n.lane]));
  const cost = (ls: string[]) => {
    const ix = new Map(ls.map((l, i) => [l, i]));
    return fwd.reduce((s, e) => s + Math.abs(ix.get(laneOf.get(e.from)!)! - ix.get(laneOf.get(e.to)!)!), 0);
  };
  for (let pass = 0, improved = true; improved && pass < 32; pass++) {
    improved = false;
    for (let i = 0; i + 1 < lanes.length; i++) {
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
  const allIn = new Map<string, E[]>(input.nodes.map((n) => [n.id, []]));
  for (const e of edges) allIn.get(e.to)!.push(e);
  const key = (id: string) => gRow(id) * 1000 + rank.get(id)!;
  const exitsOf = new Map<string, E[]>();
  const entriesOf = new Map<string, E[]>();
  for (const n of input.nodes) {
    exitsOf.set(n.id, [...out.get(n.id)!].sort((a, b) => Number(back.has(a.id)) - Number(back.has(b.id)) || key(a.to) - key(b.to) || order.get(a.to)! - order.get(b.to)!));
    entriesOf.set(n.id, [...allIn.get(n.id)!].sort((a, b) => Number(back.has(a.id)) - Number(back.has(b.id)) || key(a.from) - key(b.from) || order.get(a.from)! - order.get(b.from)!));
  }
  // 같은 산출물을 여러 곳에 넘기는 출구는 한 줄기(묶음)로 나가 통로에서 갈라진다 — 이름표는 한 번만
  const bundleOf = new Map<string, string>();
  const exitSlots = new Map<string, string[]>();
  for (const n of input.nodes) {
    const slots: string[] = [];
    const ex = exitsOf.get(n.id)!;
    for (const e of ex) {
      const same = e.label && !back.has(e.id) ? ex.filter((f) => f.label === e.label && f.style === e.style && !back.has(f.id)) : [];
      const slot = same.length > 1 ? `${n.id}|${e.style ?? ''}|${e.label}` : e.id;
      if (same.length > 1) bundleOf.set(e.id, slot);
      if (!slots.includes(slot)) slots.push(slot);
    }
    exitSlots.set(n.id, slots);
  }
  const slotOf = (e: LEdge) => bundleOf.get(e.id) ?? e.id;
  /** 같은 상자에서 같은 이름표로 나가는 간선 중 첫 간선만 이름표를 단다(묶음이든, 선 모양이 달라 따로 나가든) */
  const labelOwner = (e: LEdge) => back.has(e.id) || exitsOf.get(e.from)!.find((f) => f.label === e.label && !back.has(f.id))!.id === e.id;
  const sized = new Map(input.nodes.map((n) => [n.id, fitPorts(n, Math.max(exitSlots.get(n.id)!.length, entriesOf.get(n.id)!.length))]));
  const offset = (i: number, n: number) => (i - (n - 1) / 2) * PORT;
  const exitDy = new Map<string, number>();
  const entryDy = new Map<string, number>();
  for (const n of input.nodes) {
    const slots = exitSlots.get(n.id)!;
    for (const e of exitsOf.get(n.id)!) exitDy.set(e.id, offset(slots.indexOf(slotOf(e)), slots.length));
    const en = entriesOf.get(n.id)!;
    en.forEach((e, i) => entryDy.set(e.id, offset(i, en.length)));
  }

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
      if (boundary(b)) return Math.max(baseBand(b), 2 * (EDGE_CLEAR + (t - 1) * BAND_TRACK + 6));
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
  for (const e of edges) {
    if (back.has(e.id) || rank.get(e.to)! - rank.get(e.from)! !== 1 || gRow(e.from) !== gRow(e.to)) continue;
    if (entriesOf.get(e.to)!.length === 1 && Math.abs(exitDy.get(e.id)!) <= portRoom(sized.get(e.to)!.shape, sized.get(e.to)!.h)) entryDy.set(e.id, exitDy.get(e.id)!);
    else if (exitSlots.get(e.from)!.length === 1 && !bundleOf.has(e.id) && Math.abs(entryDy.get(e.id)!) <= portRoom(sized.get(e.from)!.shape, sized.get(e.from)!.h)) exitDy.set(e.id, entryDy.get(e.id)!);
  }

  // 같은 틈에서 출구(왼쪽에서 오는 가로)와 입구(오른쪽으로 가는 가로)가 같은 높이면 겹칠 수 있다 — 입구를 비켜 놓는다
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const e of edges) {
      const r = rank.get(e.to)! - 1;
      const ey = entryY(e);
      const clash = edges.find((f) => f.id !== e.id && rank.get(f.from) === r && Math.abs(exitY(f) - ey) < 2);
      if (clash) {
        entryDy.set(e.id, entryDy.get(e.id)! + (entryDy.get(e.id)! >= 0 ? 6 : -6));
        moved = true;
      }
    }
    if (!moved) break;
  }

  // 세로 통로(틈 g = 열 g와 g+1 사이). 교차를 줄이는 순서로 왼쪽부터 놓는다:
  //   [출구 쪽(먼 간선의 첫 세로)] [이웃 열 간선] [입구 쪽(먼 간선의 마지막 세로)]
  //   출구·이웃: 아래로 가면 위에서 나온 것이 오른쪽, 위로 가면 아래에서 나온 것이 오른쪽
  //   입구: 위에서 오면 위쪽 입구가 오른쪽, 아래에서 오면 아래쪽 입구가 오른쪽
  const bandMid = (b: number) => ys.bandY[b] + ys.bandH[b] / 2;
  type V = { gap: number; key: string; group: 0 | 1 | 2; attach: number; other: number };
  const verticals: V[] = [];
  for (const e of edges) {
    const k = kindOf(e);
    const y1 = exitY(e);
    const y2 = entryY(e);
    if (k === 'adj') {
      if (Math.abs(y1 - y2) > 0.5) verticals.push({ gap: rank.get(e.from)!, key: `${slotOf(e)}#1`, group: 1, attach: y1, other: y2 });
    } else {
      const yb = bandMid(bandOf(e));
      verticals.push({ gap: rank.get(e.from)!, key: `${slotOf(e)}#1`, group: 0, attach: y1, other: yb });
      verticals.push({ gap: rank.get(e.to)! - 1, key: `${e.id}#2`, group: 2, attach: y2, other: yb });
    }
  }
  const vOrder = (a: V, b: V) => {
    if (a.group !== b.group) return a.group - b.group;
    const da = a.other > a.attach ? 1 : 0;
    const db = b.other > b.attach ? 1 : 0;
    if (da !== db) return da - db;
    // 출구·이웃(group 0·1): 아래로(1) → attach 내림차순, 위로(0) → 오름차순 / 입구(group 2): 위에서 옴(0) → 내림차순, 아래에서 옴(1) → 오름차순
    const desc = a.group === 2 ? da === 0 : da === 1;
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
    const items = [...merged.values()].sort(vOrder).map((v) => ({ key: v.key, lo: v.lo - 3, hi: v.hi + 3 }));
    const c = packOrdered(items);
    for (const [k, t] of c) trackOf.set(k, t);
    gapTracks[g] = c.size ? Math.max(...c.values()) + 1 : 0;
  }
  const labelled = new Set(edges.filter((e) => e.label).map((e) => rank.get(e.from)!));
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

  // 가로 통로(띠) — 위로 들어가는 간선은 위쪽 통로, 아래로 들어가는 간선은 아래쪽 통로.
  //   아래로 들어가면 도착 세로가 오른쪽인 것이 위, 위로 들어가면 도착 세로가 오른쪽인 것이 아래
  const horiz: { band: number; key: string; up: boolean; x2: number; x1: number; lo: number; hi: number }[] = [];
  for (const e of edges) {
    if (kindOf(e) === 'adj') continue;
    const x1 = trackX(rank.get(e.from)!, trackOf.get(`${slotOf(e)}#1`)!);
    const x2 = trackX(rank.get(e.to)! - 1, trackOf.get(`${e.id}#2`)!);
    const b = bandOf(e);
    horiz.push({ band: b, key: e.id, up: gRow(e.to) < b, x1, x2, lo: Math.min(x1, x2) - 4, hi: Math.max(x1, x2) + 4 });
  }
  const bandTrack = new Map<string, number>();
  const bandTracks = Array(G + 1).fill(0);
  for (let b = 0; b <= G; b++) {
    const items = horiz
      .filter((h) => h.band === b)
      .sort((p, q) => (p.up === q.up ? (p.up ? p.x2 - q.x2 : q.x2 - p.x2) || p.x1 - q.x1 || (p.key < q.key ? -1 : 1) : p.up ? -1 : 1));
    const c = packOrdered(items);
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
  const pedges: PEdge<E>[] = edges.map((e) => {
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
        const gx = trackX(s.rank, trackOf.get(`${slotOf(e)}#1`)!);
        pts = [[sx, y1], [gx, y1], [gx, y2], [tx, y2]];
        firstX = gx;
      }
    } else {
      const gx1 = trackX(s.rank, trackOf.get(`${slotOf(e)}#1`)!);
      const gx2 = trackX(t.rank - 1, trackOf.get(`${e.id}#2`)!);
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
    return { ...e, points: pts, back: back.has(e.id), bundle: bundleOf.get(e.id) ?? null, labelAt: owns && maxW >= 36 ? { x: lx, y: y1 - 4, maxW, lines } : null };
  });

  // 레인 띠 — 경계는 레인 사이 띠의 가운데
  const planes: PLane[] = lanes.map((l, i) => {
    const first = gRowBase.get(l)!;
    const lastRow = first + rowsOf.get(l)! - 1;
    const top = i === 0 ? 0 : ys.bandY[first] + ys.bandH[first] / 2;
    const bottom = i === lanes.length - 1 ? ys.height : ys.bandY[lastRow + 1] + ys.bandH[lastRow + 1] / 2;
    return { id: l, index: i, y: top, h: bottom - top };
  });

  // 묶음이 갈라지는 점
  const joins: [number, number][] = [];
  const seen = new Set<string>();
  for (const e of pedges) if (e.bundle && !seen.has(e.bundle)) {
    seen.add(e.bundle);
    const p = e.points;
    if (p.length > 2) joins.push([p[1][0], p[1][1]]);
  }
  return { width, height: ys.height, laneLabelW, colX, colW, gapW, lanes: planes, nodes, edges: pedges, joins };
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
