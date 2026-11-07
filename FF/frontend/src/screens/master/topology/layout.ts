// Topology 배치 — 도메인 레인(가로 띠) × 의존 계층(세로 열) 격자에 Feature 카드를 놓고, 간선은 열 사이 통로·행 사이 골목으로만 지나는
// 직교(orthogonal) 경로로 그린다. 같은 대상으로 들어가는 간선은 통로의 한 트랙을 함께 쓰고(묶음), 같은 원천에서 나가는 긴 간선도 그렇다.
// 외부 배치 엔진(ELK·dagre) 없이 계층 배치(Sugiyama) 단계를 직접 구현한다 — 레인 제약을 지키고, 결과가 입력 순서와 무관하게 결정적이며,
// 화면 묶음 예산(40 KiB)에 들어간다.
import { LANE_ORDER } from './model';

export interface LayoutInputNode {
  id: string;
  domain: string;
}
export interface LayoutInputEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}
export interface LayoutOptions {
  nodeW: number;
  nodeH: number;
  headerW: number;
  /** 열 사이 통로 최소 폭 */
  channel: number;
  /** 행 사이 골목 최소 높이 */
  gutter: number;
  /** 통로·골목 안 트랙 간격 */
  track: number;
  pad: number;
  /** 목표 가로세로비(폭/높이) */
  aspect: number;
}
export const LAYOUT_DEFAULTS: LayoutOptions = { nodeW: 240, nodeH: 76, headerW: 184, channel: 56, gutter: 20, track: 8, pad: 24, aspect: 1.7 };

export type Pt = [number, number];
export interface LNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lane: string;
  col: number;
  rank: number;
}
export interface LEdge {
  id: string;
  points: Pt[];
  d: string;
  /** 원천에서 대상 쪽으로 그렸는가 — 흐름 모션 방향 */
  forward: boolean;
  mid: Pt;
  kind: 'adjacent' | 'long' | 'bracket' | 'loop';
}
export interface LLane {
  domain: string;
  y: number;
  h: number;
  count: number;
}
export interface Layout {
  headerW: number;
  nodes: Map<string, LNode>;
  edges: Map<string, LEdge>;
  lanes: LLane[];
  width: number;
  height: number;
  cols: number;
  crossings: number;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function layoutGraph(nodesIn: readonly LayoutInputNode[], edgesIn: readonly LayoutInputEdge[], options: Partial<LayoutOptions> = {}): Layout {
  const o = { ...LAYOUT_DEFAULTS, ...options };
  const nodes = [...nodesIn].sort(byId);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...edgesIn].filter((e) => ids.has(e.source) && ids.has(e.target)).sort(byId);
  const laneOf = new Map(nodes.map((n) => [n.id, (LANE_ORDER as readonly string[]).includes(n.domain) ? n.domain : 'ETC']));
  const laneKeys = LANE_ORDER.filter((l) => nodes.some((n) => laneOf.get(n.id) === l));
  const laneIdx = new Map<string, number>(laneKeys.map((l, i) => [l, i]));
  const L = laneKeys.length;

  // 1) 레인 안 묶음 — 같은 도메인끼리 이어진 Feature를 한 덩어리(블록)로. 다른 도메인과의 관계는 레인을 건너는 간선이 된다
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (v: string): string => (parent.get(v) === v ? v : (parent.set(v, find(parent.get(v)!)), parent.get(v)!));
  const intra = edges.filter((e) => e.source !== e.target && laneOf.get(e.source) === laneOf.get(e.target));
  for (const e of intra) {
    const a = find(e.source), b = find(e.target);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }
  const comps = new Map<string, string[]>();
  for (const n of nodes) comps.set(find(n.id), [...(comps.get(find(n.id)) ?? []), n.id]);
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));

  // 2) 블록 안 계층 — 원천→대상 방향으로 왼쪽에서 오른쪽(EXCLUDES도 나란히 두어 짧은 가로선이 되게). 순환은 깊이 우선 탐색의 되돌아가는 간선을 뒤집어 끊는다
  interface Block { id: string; lane: number; w: number; h: number; local: Map<string, { r: number; i: number }>; solo: boolean }
  const blocks: Block[] = [];
  for (const [root, members] of comps) {
    const set = new Set(members);
    const arcsOut = new Map<string, string[]>();
    for (const e of intra) if (set.has(e.source)) arcsOut.set(e.source, [...new Set([...(arcsOut.get(e.source) ?? []), e.target])].sort());
    const reversed = new Set<string>();
    const state = new Map<string, 1 | 2>();
    for (const start of members) {
      if (state.has(start)) continue;
      const stack: [string, number][] = [[start, 0]];
      state.set(start, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const next = (arcsOut.get(top[0]) ?? [])[top[1]++];
        if (next === undefined) { state.set(top[0], 2); stack.pop(); continue; }
        if (state.get(next) === 1) reversed.add(`${top[0]}>${next}`);
        else if (!state.has(next)) { state.set(next, 1); stack.push([next, 0]); }
      }
    }
    const succ = new Map<string, Set<string>>(), pred = new Map<string, Set<string>>();
    for (const [a0, list] of arcsOut)
      for (const b0 of list) {
        if (a0 === b0) continue;
        const [a, b] = reversed.has(`${a0}>${b0}`) ? [b0, a0] : [a0, b0];
        succ.set(a, (succ.get(a) ?? new Set()).add(b));
        pred.set(b, (pred.get(b) ?? new Set()).add(a));
      }
    const rank = new Map<string, number>();
    const indeg = new Map(members.map((v) => [v, pred.get(v)?.size ?? 0]));
    const queue = members.filter((v) => !indeg.get(v));
    const topo: string[] = [];
    while (queue.length) {
      queue.sort();
      const v = queue.shift()!;
      topo.push(v);
      for (const w of [...(succ.get(v) ?? [])].sort()) {
        rank.set(w, Math.max(rank.get(w) ?? 0, (rank.get(v) ?? 0) + 1));
        indeg.set(w, indeg.get(w)! - 1);
        if (!indeg.get(w)) queue.push(w);
      }
    }
    for (const v of topo) if (!rank.has(v)) rank.set(v, 0);
    // 원천만 있는 Feature는 가장 가까운 대상 바로 왼쪽으로(긴 간선을 줄인다)
    for (const v of [...topo].reverse()) if (!pred.get(v)?.size && succ.get(v)?.size) rank.set(v, Math.min(...[...succ.get(v)!].map((w) => rank.get(w)!)) - 1);
    const lo = Math.min(...members.map((v) => rank.get(v)!));
    const byRank: string[][] = [];
    for (const v of members) (byRank[rank.get(v)! - lo] ??= []).push(v);
    for (let r = 0; r < byRank.length; r++) byRank[r] ??= [];
    // 무게중심 정렬 — 이웃 계층의 평균 위치로, 왼→오·오→왼 번갈아
    const nb = new Map<string, string[]>();
    for (const e of intra) if (set.has(e.source) && e.source !== e.target) {
      nb.set(e.source, [...(nb.get(e.source) ?? []), e.target]);
      nb.set(e.target, [...(nb.get(e.target) ?? []), e.source]);
    }
    const idx = () => new Map(byRank.flatMap((list) => list.map((v, i) => [v, i] as const)));
    for (let it = 0; it < 6; it++) {
      const rs = byRank.map((_, r) => r);
      for (const r of it % 2 ? rs.reverse() : rs) {
        const at = idx();
        const side = it % 2 ? 1 : -1;
        const bary = (v: string, i: number) => {
          const ys = (nb.get(v) ?? []).filter((w) => rank.get(w)! - lo === r + side).map((w) => at.get(w)!);
          return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : i;
        };
        const list = byRank[r];
        const key = new Map(list.map((v, i) => [v, bary(v, i)]));
        list.sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : 1));
      }
    }
    const local = new Map<string, { r: number; i: number }>();
    byRank.forEach((list, r) => list.forEach((v, i) => local.set(v, { r, i })));
    blocks.push({ id: root, lane: laneIdx.get(laneOf.get(root)!)!, w: byRank.length, h: Math.max(...byRank.map((l) => l.length)), local, solo: !linked.has(root) && members.length === 1 });
  }

  // 3) 레인 채우기 — 큰 블록부터 스카이라인 방식으로 빈 곳에 끼워 넣는다. 열 수 C는 목표 가로세로비에 가깝게 고른다
  const order = [...blocks].sort((a, b) => a.lane - b.lane || Number(a.solo) - Number(b.solo) || b.w * b.h - a.w * a.h || b.w - a.w || (a.id < b.id ? -1 : 1));
  const blockOf = new Map(blocks.flatMap((b) => [...b.local.keys()].map((v) => [v, b] as const)));
  const cross = edges.filter((e) => e.source !== e.target && laneOf.get(e.source) !== laneOf.get(e.target));
  /** 레인을 건너는 관계의 상대 열에 맞춘 블록의 바라는 시작 열 — REQUIRES 대상은 원천 바로 오른쪽, EXCLUDES는 같은 열 */
  const desire = (b: Block, at: Map<string, { x: number; y: number }>, useGlobal: boolean) => {
    const xs: number[] = [];
    // REQUIRES 상대가 이미 놓였으면 방향을 지키는 범위 — 대상은 원천보다 오른쪽, 원천은 대상보다 왼쪽
    let min = -Infinity, max = Infinity;
    for (const e of cross)
      for (const [me, other, off] of [[e.source, e.target, e.type === 'REQUIRES' ? -1 : 0], [e.target, e.source, e.type === 'REQUIRES' ? 1 : 0]] as const) {
        if (blockOf.get(me) !== b) continue;
        const ob = blockOf.get(other)!, op = at.get(ob.id);
        if (!op) continue;
        const x = op.x + ob.local.get(other)!.r + off - b.local.get(me)!.r;
        xs.push(x);
        if (off === 1) min = Math.max(min, x);
        if (off === -1) max = Math.min(max, x);
      }
    if (xs.length) return { want: xs.reduce((a, c) => a + c, 0) / xs.length, min, max };
    const g = [...b.local].map(([v, q]) => gRank.get(v)! - q.r);
    return { want: useGlobal && cross.some((e) => blockOf.get(e.source) === b || blockOf.get(e.target) === b) ? g.reduce((a, c) => a + c, 0) / g.length : null, min, max };
  };
  const pack = (C: number, prev?: Map<string, { x: number; y: number }>, useGlobal = true, keepDir = false) => {
    const at = new Map<string, { x: number; y: number }>();
    const rows: number[] = [];
    for (let l = 0; l < L; l++) {
      const sky = Array(C).fill(0);
      for (const b of order.filter((x) => x.lane === l)) {
        const { want, min, max } = desire(b, prev ? new Map([...prev, ...at]) : new Map(), useGlobal);
        let best = { x: 0, y: 0, cost: Infinity };
        for (let x = 0; x + b.w <= C; x++) {
          const y = Math.max(...sky.slice(x, x + b.w));
          // 한 줄 아래로 내려가는 것(4)보다 의존 방향을 거스르는 것(6)이 더 나쁘다
          const cost = y * 4 + (want === null ? x * 0.01 : Math.abs(x - want)) + (keepDir && (x < min || x > max) ? 6 : 0);
          if (cost < best.cost - 1e-9) best = { x, y, cost };
        }
        at.set(b.id, { x: best.x, y: best.y });
        for (let x = best.x; x < best.x + b.w; x++) sky[x] = best.y + b.h;
      }
      rows[l] = Math.max(1, ...sky);
    }
    return { at, rows };
  };
  // 전체 계층 — 레인을 건너는 REQUIRES까지 포함한 최장 경로(순환은 끊고). 블록이 바라는 시작 열의 첫 값이 된다
  const gRank = globalRanks(nodes.map((n) => n.id), edges.filter((e) => e.type === 'REQUIRES' && e.source !== e.target));
  const chain = Math.max(0, ...gRank.values());
  const minC = Math.max(1, chain + 1, ...blocks.map((b) => b.w));
  let C = minC;
  let bestScore = Infinity;
  for (let c = minC; c <= Math.max(minC, nodes.length); c++) {
    const { rows } = pack(c, undefined, false);
    const W = o.headerW + c * (o.nodeW + o.channel);
    const H = rows.reduce((a, b) => a + b, 0) * (o.nodeH + o.gutter) + L * o.gutter * 2;
    const score = Math.abs(Math.log(W / H / o.aspect));
    if (score < bestScore - 1e-9) (bestScore = score), (C = c);
  }
  /** 배치 비용 — 교차(직선 근사) + 의존 방향 어긋남(대상이 원천 오른쪽 바로 옆이 아니면 벌점). 같은 열에 쌓인 직선은 교차로 잡히지 않아 함께 본다 */
  const packCost = (at: Map<string, { x: number; y: number }>, rows: number[]) => {
    const top: number[] = [];
    rows.reduce((acc, r, l) => ((top[l] = acc), acc + r + 1), 0);
    const pos = (v: string) => { const b = blockOf.get(v)!, p = at.get(b.id)!, q = b.local.get(v)!; return [p.x + q.r, top[b.lane] + p.y + q.i] as Pt; };
    const real = edges.filter((e) => e.source !== e.target);
    const segs = real.map((e) => [pos(e.source), pos(e.target)] as const);
    let n = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (properCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) n++;
    let bend = 0;
    real.forEach((e, i) => {
      const dx = segs[i][1][0] - segs[i][0][0];
      bend += e.type === 'REQUIRES' ? (dx < 1 ? 3 + Math.abs(dx - 1) : dx - 1) : Math.max(0, Math.abs(dx) - 1);
    });
    return n * 10 + bend;
  };
  // 레인을 건너는 관계 맞춤 — 앞 배치의 상대 위치를 보고 다시 채운다(세 번까지), 비용이 줄 때만 받는다
  const refine = (useGlobal: boolean, keepDir: boolean) => {
    let packed = pack(C, undefined, useGlobal, keepDir);
    let cost = packCost(packed.at, packed.rows);
    for (let it = 0; it < 3 && cross.length; it++) {
      const next = pack(C, packed.at, useGlobal, keepDir);
      const c = packCost(next.at, next.rows);
      if (c >= cost) break;
      (packed = next), (cost = c);
    }
    return packed;
  };
  // 네 출발점(전체 계층에 맞춤/빈 곳부터 × 의존 방향 지킴/안 지킴)으로 배치·경로를 다 만들고 보기 점수가 가장 좋은 것(같으면 앞쪽).
  // 점수 = 교차 × 2 + 되돌아 도는 REQUIRES(대상이 원천과 같은 열이나 왼쪽) × 5 — 되돌아 도는 선이 교차보다 읽기 어렵다
  const back = (l: Layout) => edges.filter((e) => e.type === 'REQUIRES' && e.source !== e.target && l.nodes.get(e.target)!.col <= l.nodes.get(e.source)!.col).length;
  const score = (l: Layout) => l.crossings * 2 + back(l) * 5;
  const first = finish(refine(true, true));
  if (!cross.length) return first;
  let best = { l: first, s: score(first) };
  for (const [g, d] of [[true, false], [false, true], [false, false]] as const) {
    const l = finish(refine(g, d));
    const sc = score(l);
    if (sc < best.s) best = { l, s: sc };
  }
  return best.l;

  function finish(packed: { at: Map<string, { x: number; y: number }>; rows: number[] }): Layout {
    const grid = new Map<string, { col: number; row: number; lane: number }>();
    for (const b of blocks) {
      const p = packed.at.get(b.id)!;
      for (const [v, { r, i }] of b.local) grid.set(v, { col: p.x + r, row: p.y + i, lane: b.lane });
    }
    const laneRows = packed.rows;

    // 4) 골목(행 사이) 트랙 — 같은 원천에서 나가는 긴 간선은 한 트랙을 함께 쓴다
    type Route = { e: LayoutInputEdge; from: string; to: string; kind: LEdge['kind']; gutter?: string; span?: [number, number] };
    const routes: Route[] = edges.map((e) => {
      if (e.source === e.target) return { e, from: e.source, to: e.target, kind: 'loop' };
      let from = e.source, to = e.target;
      const a = grid.get(from)!, b = grid.get(to)!;
      if (e.type === 'EXCLUDES' && (a.col > b.col || (a.col === b.col && (a.lane > b.lane || (a.lane === b.lane && a.row > b.row))))) [from, to] = [to, from];
      const pf = grid.get(from)!, pt = grid.get(to)!;
      if (e.type === 'EXCLUDES' && pf.col === pt.col) return { e, from, to, kind: 'bracket' };
      if (pt.col === pf.col + 1) return { e, from, to, kind: 'adjacent' };
      const below = pt.lane > pf.lane || (pt.lane === pf.lane && pt.row > pf.row);
      return { e, from, to, kind: 'long', gutter: `${pf.lane}:${below ? pf.row + 1 : pf.row}`, span: [Math.min(pf.col, pt.col - 1), Math.max(pf.col, pt.col - 1)] };
    });
    const gutterTrack = new Map<string, number>();
    const gutterCount = new Map<string, number>();
    {
      const groups = new Map<string, Map<string, [number, number]>>();
      for (const r of routes)
        if (r.gutter) {
          const g = groups.get(r.gutter) ?? new Map<string, [number, number]>();
          const s = g.get(r.from) ?? [Infinity, -Infinity];
          g.set(r.from, [Math.min(s[0], r.span![0]), Math.max(s[1], r.span![1])]);
          groups.set(r.gutter, g);
        }
      for (const [gid, g] of groups) {
        const tracks = colorIntervals([...g].map(([key, s]) => ({ key, lo: s[0], hi: s[1] })), 0);
        for (const [k, t] of tracks) gutterTrack.set(`${gid}|${k}`, t);
        gutterCount.set(gid, Math.max(...tracks.values()) + 1);
      }
    }
    const gutterH = (l: number, k: number) => Math.max(o.gutter, ((gutterCount.get(`${l}:${k}`) ?? 0) + 1) * o.track);
    const laneY: number[] = [];
    const rowY = new Map<string, number>();
    let y = o.pad;
    laneKeys.forEach((_, l) => {
      laneY[l] = y;
      let yy = y + gutterH(l, 0);
      for (let k = 0; k < laneRows[l]; k++) {
        rowY.set(`${l}:${k}`, yy);
        yy += o.nodeH + gutterH(l, k + 1);
      }
      y = yy;
    });
    const height = y + o.pad;
    const gutterY = (gid: string, track: number) => {
      const [l, k] = gid.split(':').map(Number);
      const top = k === 0 ? laneY[l] : rowY.get(`${l}:${k - 1}`)! + o.nodeH;
      const n = gutterCount.get(gid) ?? 1;
      return top + (gutterH(l, k) - (n - 1) * o.track) / 2 + track * o.track;
    };
    const nodeY = (id: string) => rowY.get(`${grid.get(id)!.lane}:${grid.get(id)!.row}`)!;
    const portY = (id: string) => nodeY(id) + o.nodeH / 2;

    // 5) 통로(열 사이) 트랙 — 같은 대상으로 들어가는 간선은 한 트랙(묶음). 통로 c는 열 c 오른쪽, -1은 첫 열 왼쪽
    type VSeg = { channel: number; group: string; lo: number; hi: number };
    // 묶음 기준 — 같은 통로에서 한 원천이 여러 대상으로 퍼지면 원천 줄기 하나, 여러 원천이 한 대상으로 모이면 대상 줄기 하나(가지끼리 엇갈리지 않게)
    const fan = new Map<string, number>();
    const bump = (k: string) => fan.set(k, (fan.get(k) ?? 0) + 1);
    for (const r of routes) {
      if (r.kind === 'adjacent') (bump(`o${grid.get(r.from)!.col}|${r.from}`), bump(`i${grid.get(r.from)!.col}|${r.to}`));
      if (r.kind === 'long') (bump(`o${grid.get(r.from)!.col}|${r.from}`), bump(`i${grid.get(r.to)!.col - 1}|${r.to}`));
    }
    const trunk = (c: number, from: string, to: string) => {
      const o = fan.get(`o${c}|${from}`) ?? 0, i = fan.get(`i${c}|${to}`) ?? 0;
      return o > 1 && o >= i ? `out:${from}` : `in:${to}`;
    };
    const vsegs: { r: Route; segs: VSeg[]; gy?: number }[] = routes.map((r) => {
      const ya = portY(r.from), yb = portY(r.to);
      const ca = grid.get(r.from)!.col, cb = grid.get(r.to)!.col;
      const span = (a: number, b: number) => ({ lo: Math.min(a, b), hi: Math.max(a, b) });
      if (r.kind === 'loop') return { r, segs: [{ channel: ca, group: `loop:${r.from}`, lo: ya - 12, hi: ya + 12 }] };
      if (r.kind === 'adjacent') return { r, segs: [{ channel: ca, group: trunk(ca, r.from, r.to), ...span(ya, yb) }] };
      if (r.kind === 'bracket') return { r, segs: [{ channel: ca, group: `br:${r.to}`, ...span(ya, yb) }] };
      const gy = gutterY(r.gutter!, gutterTrack.get(`${r.gutter}|${r.from}`)!);
      return { r, gy, segs: [{ channel: ca, group: `out:${r.from}`, ...span(ya, gy) }, { channel: cb - 1, group: `in:${r.to}`, ...span(gy, yb) }] };
    });
    const chanTrack = new Map<string, number>();
    const chanCount = new Map<number, number>();
    for (let c = -1; c < C; c++) {
      const g = new Map<string, [number, number]>();
      for (const v of vsegs) for (const s of v.segs) if (s.channel === c) {
        const span = g.get(s.group) ?? [Infinity, -Infinity];
        g.set(s.group, [Math.min(span[0], s.lo), Math.max(span[1], s.hi)]);
      }
      if (!g.size) continue;
      const tracks = colorIntervals([...g].map(([key, s]) => ({ key, lo: s[0], hi: s[1] })), 6);
      for (const [k, t] of tracks) chanTrack.set(`${c}|${k}`, t);
      chanCount.set(c, Math.max(...tracks.values()) + 1);
    }
    const chanW = (c: number) => (c === -1 || c === C - 1) && !chanCount.get(c) ? o.track * 2 : Math.max(o.channel, ((chanCount.get(c) ?? 0) + 3) * o.track);
    const colX: number[] = [];
    let x = o.headerW + chanW(-1);
    for (let c = 0; c < C; c++) (colX[c] = x), (x += o.nodeW + chanW(c));
    const widthPx = x + o.pad;
    const chanLeft = (c: number) => (c === -1 ? o.headerW : colX[c] + o.nodeW);
    const trackX = (c: number, group: string) => {
      const n = chanCount.get(c) ?? 1;
      return chanLeft(c) + (chanW(c) - (n - 1) * o.track) / 2 + (chanTrack.get(`${c}|${group}`) ?? 0) * o.track;
    };

    // 6) 좌표·경로 — 언제나 원천→대상 순서(화살표는 대상에, 흐름 모션도 같은 방향)
    const outNodes = new Map<string, LNode>();
    for (const n of nodes) {
      const g = grid.get(n.id)!;
      outNodes.set(n.id, { id: n.id, x: colX[g.col], y: nodeY(n.id), w: o.nodeW, h: o.nodeH, lane: laneOf.get(n.id)!, col: g.col, rank: g.row });
    }
    const outEdges = new Map<string, LEdge>();
    for (const { r, segs, gy } of vsegs) {
      const a = outNodes.get(r.from)!, b = outNodes.get(r.to)!;
      const ya = a.y + o.nodeH / 2, yb = b.y + o.nodeH / 2;
      const t0 = trackX(segs[0].channel, segs[0].group);
      let pts: Pt[];
      if (r.kind === 'loop') pts = [[a.x + a.w, ya - 10], [t0, ya - 10], [t0, ya + 10], [a.x + a.w, ya + 10]];
      else if (r.kind === 'adjacent') pts = [[a.x + a.w, ya], [t0, ya], [t0, yb], [b.x, yb]];
      else if (r.kind === 'bracket') pts = [[a.x + a.w, ya], [t0, ya], [t0, yb], [b.x + b.w, yb]];
      else {
        const t1 = trackX(segs[1].channel, segs[1].group);
        pts = [[a.x + a.w, ya], [t0, ya], [t0, gy!], [t1, gy!], [t1, yb], [b.x, yb]];
      }
      pts = simplify(pts);
      const forward = r.from === r.e.source;
      if (!forward) pts = [...pts].reverse();
      outEdges.set(r.e.id, { id: r.e.id, points: pts, d: roundedPath(pts, 8), forward, mid: midOf(pts), kind: r.kind });
    }
    const lanes: LLane[] = laneKeys.map((domain, l) => ({ domain, y: laneY[l], h: (l + 1 < L ? laneY[l + 1] : height - o.pad) - laneY[l], count: nodes.filter((n) => laneOf.get(n.id) === domain).length }));
    return { headerW: o.headerW, nodes: outNodes, edges: outEdges, lanes, width: widthPx, height, cols: C, crossings: countCrossings([...outEdges.values()].map((e) => e.points)) };
  }
}

/** REQUIRES 최장 경로 계층 — 깊이 우선 탐색의 되돌아가는 간선을 뒤집어 순환을 끊고, 원천만 있는 노드는 가장 가까운 대상 바로 왼쪽으로 */
function globalRanks(ids: string[], arcsIn: readonly { source: string; target: string }[]): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const e of arcsIn) out.set(e.source, [...new Set([...(out.get(e.source) ?? []), e.target])].sort());
  const state = new Map<string, 1 | 2>();
  const rev = new Set<string>();
  for (const start of [...ids].sort()) {
    if (state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (out.get(top[0]) ?? [])[top[1]++];
      if (next === undefined) { state.set(top[0], 2); stack.pop(); continue; }
      if (state.get(next) === 1) rev.add(`${top[0]}>${next}`);
      else if (!state.has(next)) { state.set(next, 1); stack.push([next, 0]); }
    }
  }
  const succ = new Map<string, Set<string>>(), pred = new Map<string, Set<string>>();
  for (const [a0, list] of out)
    for (const b0 of list) {
      const [a, b] = rev.has(`${a0}>${b0}`) ? [b0, a0] : [a0, b0];
      succ.set(a, (succ.get(a) ?? new Set()).add(b));
      pred.set(b, (pred.get(b) ?? new Set()).add(a));
    }
  const rank = new Map(ids.map((v) => [v, 0]));
  const indeg = new Map(ids.map((v) => [v, pred.get(v)?.size ?? 0]));
  const queue = ids.filter((v) => !indeg.get(v)).sort();
  const topo: string[] = [];
  while (queue.length) {
    queue.sort();
    const v = queue.shift()!;
    topo.push(v);
    for (const w of [...(succ.get(v) ?? [])].sort()) {
      rank.set(w, Math.max(rank.get(w)!, rank.get(v)! + 1));
      indeg.set(w, indeg.get(w)! - 1);
      if (!indeg.get(w)) queue.push(w);
    }
  }
  for (const v of [...topo].reverse()) if (!pred.get(v)?.size && succ.get(v)?.size) rank.set(v, Math.min(...[...succ.get(v)!].map((w) => rank.get(w)!)) - 1);
  const lo = Math.min(0, ...rank.values());
  for (const [k, v] of rank) rank.set(k, v - lo);
  return rank;
}

/** 구간 색칠 — 겹치는 구간은 다른 트랙(왼쪽 끝 순, 같으면 열쇠 순). gap은 같은 트랙에서 띄울 최소 거리 */
export function colorIntervals(items: { key: string; lo: number; hi: number }[], gap: number): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.lo - b.lo || a.hi - b.hi || (a.key < b.key ? -1 : 1));
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const it of sorted) {
    let t = ends.findIndex((end) => end + gap < it.lo);
    if (t < 0) t = ends.length;
    ends[t] = it.hi;
    out.set(it.key, t);
  }
  return out;
}

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((Math.abs(prev[0] - last[0]) < 0.01 && Math.abs(last[0] - p[0]) < 0.01) || (Math.abs(prev[1] - last[1]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 직교 꺾은선 → 모서리를 둥글린 경로(반경은 이웃 구간 절반을 넘지 않는다) */
export function roundedPath(pts: readonly Pt[], radius: number): string {
  if (pts.length < 2) return '';
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const ax = x - ((x - px) / (l1 || 1)) * r, ay = y - ((y - py) / (l1 || 1)) * r;
    const bx = x + ((nx - x) / (l2 || 1)) * r, by = y + ((ny - y) / (l2 || 1)) * r;
    d += ` L${r1(ax)},${r1(ay)} Q${r1(x)},${r1(y)} ${r1(bx)},${r1(by)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${r1(lx)},${r1(ly)}`;
}

function midOf(pts: readonly Pt[]): Pt {
  let best = 0, at: Pt = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (l > best) (best = l), (at = [(ax + bx) / 2, (ay + by) / 2]);
  }
  return at;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** 두 선분이 끝점이 아닌 곳에서 엇갈리는가(같은 직선 위 겹침은 묶음이라 교차가 아니다) */
export function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  const eps = 1e-9;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** 보이는 교차 수 — 서로 다른 간선의 선분이 엇갈리는 점(같은 점은 한 번: 묶음 간선이 한 선을 함께 넘으면 하나) */
export function countCrossings(polylines: readonly (readonly Pt[])[]): number {
  const seen = new Set<string>();
  for (let i = 0; i < polylines.length; i++)
    for (let j = i + 1; j < polylines.length; j++) {
      const a = polylines[i], b = polylines[j];
      for (let s = 1; s < a.length; s++)
        for (let t = 1; t < b.length; t++) {
          const p = a[s - 1], q = a[s], r = b[t - 1], u = b[t];
          if (!properCross(p, q, r, u)) continue;
          const den = (p[0] - q[0]) * (r[1] - u[1]) - (p[1] - q[1]) * (r[0] - u[0]);
          const x = ((p[0] * q[1] - p[1] * q[0]) * (r[0] - u[0]) - (p[0] - q[0]) * (r[0] * u[1] - r[1] * u[0])) / den;
          const y = ((p[0] * q[1] - p[1] * q[0]) * (r[1] - u[1]) - (p[1] - q[1]) * (r[0] * u[1] - r[1] * u[0])) / den;
          seen.add(`${Math.round(x)},${Math.round(y)}`);
        }
    }
  return seen.size;
}
