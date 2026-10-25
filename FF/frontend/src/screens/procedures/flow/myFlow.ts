// 내 업무 흐름 — 13개 절차를 가로질러 내 역할의 활동(수행 R·책임 A)을 생애주기 순서로 잇고,
// 활동마다 누구에게서 받는지(입력 산출물을 만든 활동의 역할·앞 활동)와 누구에게 넘기는지(내 산출물을 쓰는 활동·다음 활동)를 붙인다.
// 한 활동 = 한 줄(받는 곳 → 내 활동 → 넘기는 곳). 줄마다 같은 배치 알고리즘(layout.ts)을 쓰고, 열 폭을 맞춰 내 활동이 한 세로줄에 선다.
import { myActivities, type WorkflowActivity, type WorkflowDoc, type WorkflowProcess } from '@ff/contracts';
import { layoutFlow, type FlowLayout, type LEdge, type LNode } from './layout';
import { wpLabel } from './model';

export type CounterpartKind = 'role' | 'external' | 'retained';

export interface Counterpart {
  id: string;
  kind: CounterpartKind;
  /** 조직 역할(R 첫 역할) — 외부 입력·보존 기록은 null */
  role: string | null;
  /** 이 역할이 내 역할 중 하나 */
  mine: boolean;
  activities: { id: string; processId: string }[];
  wps: string[];
  /** 작은 판에서 합친 나머지 상대 수 */
  extra?: number;
}

export interface MyStep {
  process: WorkflowProcess;
  activity: WorkflowActivity;
  from: Counterpart[];
  to: Counterpart[];
}

interface Facts {
  act: Map<string, { process: WorkflowProcess; activity: WorkflowActivity }>;
  producers: Map<string, string[]>;
  consumers: Map<string, string[]>;
  preds: Map<string, string[]>;
  wp: Map<string, { name: string; retained: boolean }>;
}

const FACTS = new WeakMap<WorkflowDoc, Facts>();
function factsOf(doc: WorkflowDoc): Facts {
  const hit = FACTS.get(doc);
  if (hit) return hit;
  const f: Facts = { act: new Map(), producers: new Map(), consumers: new Map(), preds: new Map(), wp: new Map() };
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const p of doc.processes) {
    for (const w of p.workProducts) if (!f.wp.has(w.key) || w.kind === 'output') f.wp.set(w.key, { name: w.name, retained: w.retained });
    for (const a of p.activities) {
      f.act.set(a.id, { process: p, activity: a });
      for (const o of a.outputs) push(f.producers, o, a.id);
      for (const i of a.inputs) push(f.consumers, i, a.id);
      for (const n of a.next) push(f.preds, n, a.id);
    }
  }
  FACTS.set(doc, f);
  return f;
}

export const wpNameOf = (doc: WorkflowDoc, key: string) => factsOf(doc).wp.get(key)?.name ?? key;

function group(f: Facts, pairs: { activity: string | null; wp: string | null; kind: CounterpartKind }[], roleIds: readonly string[], side: 'from' | 'to', self: string): Counterpart[] {
  const out: Counterpart[] = [];
  const mine = new Set(roleIds);
  for (const x of pairs) {
    const a = x.activity ? f.act.get(x.activity)!.activity : null;
    const role = a ? a.raci.R[0] ?? a.raci.A : null;
    const id = `${self}:${side}:${x.kind}:${role ?? ''}`;
    let c = out.find((y) => y.id === id);
    if (!c) out.push((c = { id, kind: x.kind, role, mine: !!role && mine.has(role), activities: [], wps: [] }));
    if (x.activity && !c.activities.some((y) => y.id === x.activity)) c.activities.push({ id: x.activity, processId: f.act.get(x.activity)!.process.id });
    if (x.wp && !c.wps.includes(x.wp)) c.wps.push(x.wp);
  }
  return out;
}

/** 내 활동마다 받는 곳·넘기는 곳 */
export function myWorkSteps(doc: WorkflowDoc, roleIds: readonly string[]): MyStep[] {
  const f = factsOf(doc);
  return myActivities(doc, roleIds).map(({ process, activity: a }) => {
    const fromPairs: { activity: string | null; wp: string | null; kind: CounterpartKind }[] = [];
    for (const k of a.inputs) {
      const ps = (f.producers.get(k) ?? []).filter((id) => id !== a.id);
      if (!ps.length) fromPairs.push({ activity: null, wp: k, kind: 'external' });
      for (const id of ps) fromPairs.push({ activity: id, wp: k, kind: 'role' });
    }
    for (const id of f.preds.get(a.id) ?? []) if (!fromPairs.some((x) => x.activity === id)) fromPairs.push({ activity: id, wp: null, kind: 'role' });
    const toPairs: { activity: string | null; wp: string | null; kind: CounterpartKind }[] = [];
    for (const k of a.outputs) {
      const cs = (f.consumers.get(k) ?? []).filter((id) => id !== a.id);
      if (!cs.length) toPairs.push({ activity: null, wp: k, kind: 'retained' });
      for (const id of cs) toPairs.push({ activity: id, wp: k, kind: 'role' });
    }
    for (const id of a.next) if (!toPairs.some((x) => x.activity === id)) toPairs.push({ activity: id, wp: null, kind: 'role' });
    return { process, activity: a, from: group(f, fromPairs, roleIds, 'from', a.id), to: group(f, toPairs, roleIds, 'to', a.id) };
  });
}

/** 작은 판용 — 한쪽 상대를 하나로 합친다(첫 상대 이름 + "외 n") */
export function collapseSides(step: MyStep): MyStep {
  const fold = (cs: Counterpart[]): Counterpart[] =>
    cs.length <= 1
      ? cs
      : [{ ...cs[0], extra: cs.length - 1, activities: cs.flatMap((c) => c.activities), wps: [...new Set(cs.flatMap((c) => c.wps))] }];
  return { ...step, from: fold(step.from), to: fold(step.to) };
}

// ── 배치 ────────────────────────────────────────────────────
export interface MyFlowSize {
  sideW: number;
  centerW: number;
  sideH: number;
  centerH: number;
  labelW: number;
  headerH: number;
}

export const MY_FLOW_FULL: MyFlowSize = { sideW: 192, centerW: 200, sideH: 56, centerH: 80, labelW: 136, headerH: 30 };
export const MY_FLOW_COMPACT: MyFlowSize = { sideW: 144, centerW: 168, sideH: 56, centerH: 80, labelW: 104, headerH: 0 };

type RowNode = LNode & { side: 'from' | 'center' | 'to'; counterpart: Counterpart | null };
type RowEdge = LEdge & { wps: string[] };

export interface MyFlowRow {
  step: MyStep;
  /** 이 줄 위에 절차 제목을 붙이는가(절차가 바뀌는 첫 줄) */
  header: boolean;
  y: number;
  height: number;
  layout: FlowLayout<RowNode, RowEdge>;
}

export interface MyFlowLayout {
  width: number;
  height: number;
  centerX: number;
  rows: MyFlowRow[];
  /** 내 활동끼리 잇는 생애주기 사슬(세로) */
  chain: { from: string; to: string; points: [number, number][] }[];
}

const ROW_GAP = 8;

export function layoutMyFlow(steps: MyStep[], doc: WorkflowDoc, size: MyFlowSize = MY_FLOW_FULL, more: (n: number) => string = (n) => `+${n}`): MyFlowLayout {
  const name = (k: string) => wpNameOf(doc, k);
  const graph = (s: MyStep) => {
    const nodes: RowNode[] = [];
    const edges: RowEdge[] = [];
    const c = s.activity.id;
    for (const x of s.from) nodes.push({ id: x.id, lane: 'row', w: size.sideW, h: size.sideH, shape: 'rect', side: 'from', counterpart: x });
    nodes.push({ id: c, lane: 'row', w: size.centerW, h: size.centerH, shape: 'rect', side: 'center', counterpart: null });
    for (const x of s.to) nodes.push({ id: x.id, lane: 'row', w: size.sideW, h: size.sideH, shape: 'rect', side: 'to', counterpart: x });
    for (const x of s.from) edges.push({ id: `${x.id}>${c}`, from: x.id, to: c, wps: x.wps, label: wpLabel(x.wps, name, more) });
    for (const x of s.to) edges.push({ id: `${c}>${x.id}`, from: c, to: x.id, wps: x.wps, label: wpLabel(x.wps, name, more) });
    // 받는 곳이 없으면 내 활동이 첫 열 — 열을 맞추려고 빈 자리를 둔다(받는 곳 없음 = 시작 활동)
    return { nodes, edges };
  };
  // 1차: 줄마다 배치해 열 폭·틈 폭의 최댓값을 구한다. 받는 곳이 없는 줄은 내 활동이 0열이 되므로 열을 한 칸 민다
  const opts = { laneLabelW: 0, labelW: size.labelW, outerBand: 8, innerBand: 12 };
  const shift = (s: MyStep) => (s.from.length ? 0 : 1);
  const colW = [size.sideW, size.centerW, size.sideW];
  let gapW = [0, 0];
  for (const s of steps) {
    const l = layoutFlow(graph(s), opts);
    const k = shift(s);
    l.gapW.forEach((w, i) => (gapW[i + k] = Math.max(gapW[i + k] ?? 0, w)));
  }
  gapW = gapW.map((w) => Math.max(w, size.labelW + 40));
  const rows: MyFlowRow[] = [];
  let y = 0;
  let prev: string | null = null;
  for (const s of steps) {
    const header = !!size.headerH && s.process.id !== prev;
    prev = s.process.id;
    if (header) y += size.headerH;
    const k = shift(s);
    const l = layoutFlow(graph(s), { ...opts, minColW: colW.slice(k), minGapW: gapW.slice(k) });
    if (k) {
      // 0열이 빠진 줄 — 받는 곳 열 폭만큼 오른쪽으로 민다
      const dx = colW[0] + gapW[0];
      for (const n of l.nodes) n.x += dx;
      for (const e of l.edges) {
        e.points = e.points.map(([px, py]) => [px + dx, py] as [number, number]);
        if (e.labelAt) e.labelAt = { ...e.labelAt, x: e.labelAt.x + dx };
      }
    }
    rows.push({ step: s, header, y, height: l.height, layout: l });
    y += l.height + ROW_GAP;
  }
  const centerX = colW[0] + gapW[0] + size.centerW / 2 + 16;
  const chain: MyFlowLayout['chain'] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const ca = a.layout.nodes.find((n) => n.side === 'center')!;
    const cb = b.layout.nodes.find((n) => n.side === 'center')!;
    chain.push({ from: a.step.activity.id, to: b.step.activity.id, points: [[centerX, a.y + ca.y + ca.h], [centerX, b.y + cb.y]] });
  }
  const width = colW.reduce((s, w) => s + w, 0) + gapW.reduce((s, w) => s + w, 0) + 16 + 24;
  return { width, height: Math.max(0, y - ROW_GAP), centerX, rows, chain };
}
