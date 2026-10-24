// 절차(FPW.n) 한 건 → 흐름도 그래프. 활동 = 상자, 레인 = 수행(R) 첫 역할, Gate 판정 = 마름모, 시작(진입 조건)·종료(완료 조건) = 원.
// 순서는 두 가지 사실을 합친다: 모델의 next(다음 활동)와 산출물 의존(어떤 활동의 산출물을 입력으로 쓰는 활동은 그 뒤).
// 간선 이름표는 그 간선으로 넘어가는 산출물(WP) 이름이다. 화면 밖 사실(완료·내 차례)은 status.ts가 따로 얹는다.
import type { WorkflowActivity, WorkflowProcess } from '@ff/contracts';
import { layoutFlow, type FlowLayout, type LEdge, type LNode } from './layout';

export type FlowNodeKind = 'start' | 'event' | 'activity' | 'gate' | 'end';
export type FlowEdgeKind = 'flow' | 'data' | 'start' | 'event' | 'gate' | 'end';

export interface FlowNodeMeta {
  id: string;
  kind: FlowNodeKind;
  /** 활동·Gate 상자가 가리키는 활동 */
  activityId: string | null;
  gate: string | null;
}

export interface FlowEdgeMeta {
  id: string;
  from: string;
  to: string;
  kind: FlowEdgeKind;
  /** 넘어가는 산출물 키 */
  wps: string[];
}

export interface ProcessGraph {
  nodes: (LNode & FlowNodeMeta)[];
  edges: (LEdge & FlowEdgeMeta)[];
  laneOrder: string[];
}

export const NODE_SIZE = {
  activity: { w: 160, h: 84 },
  gate: { w: 64, h: 64 },
  circle: { w: 44, h: 44 },
} as const;

export const startId = (p: WorkflowProcess) => `${p.id}:start`;
export const endId = (p: WorkflowProcess) => `${p.id}:end`;
export const gateId = (a: WorkflowActivity) => `${a.id}:gate`;
export const eventId = (a: WorkflowActivity) => `${a.id}:event`;

/** 이름표 — 산출물 하나면 그 이름, 여럿이면 "첫 이름 외 n" */
export function wpLabel(keys: string[], name: (k: string) => string, more: (n: number) => string): string | undefined {
  if (!keys.length) return undefined;
  return keys.length === 1 ? name(keys[0]) : `${name(keys[0])} ${more(keys.length - 1)}`;
}

export function buildProcessGraph(p: WorkflowProcess, opts: { more: (n: number) => string } = { more: (n) => `+${n}` }): ProcessGraph {
  const acts = p.activities;
  const lane = (a: WorkflowActivity) => a.raci.R[0] ?? a.raci.A;
  const wpName = new Map(p.workProducts.map((w) => [w.key, w.name]));
  const producers = new Map<string, string[]>();
  for (const a of acts) for (const o of a.outputs) producers.set(o, [...(producers.get(o) ?? []), a.id]);

  // 활동 쌍 → (next 여부, 산출물)
  const pair = new Map<string, { from: string; to: string; next: boolean; wps: string[] }>();
  const touch = (from: string, to: string) => {
    const k = `${from}>${to}`;
    if (!pair.has(k)) pair.set(k, { from, to, next: false, wps: [] });
    return pair.get(k)!;
  };
  for (const a of acts) for (const n of a.next) if (acts.some((b) => b.id === n)) touch(a.id, n).next = true;
  for (const b of acts)
    for (const k of b.inputs)
      for (const from of producers.get(k) ?? []) if (from !== b.id) touch(from, b.id).wps.push(k);

  const nodes: ProcessGraph['nodes'] = [];
  const edges: ProcessGraph['edges'] = [];
  const byId = new Map(acts.map((a) => [a.id, a]));
  /** 활동에서 나가는 간선의 실제 출발 상자(Gate 판정 활동은 마름모에서 나간다) */
  const exitOf = (id: string) => (byId.get(id)?.gateDecision ? gateId(byId.get(id)!) : id);
  const label = (wps: string[]) => wpLabel(wps, (k) => wpName.get(k) ?? k, opts.more);

  const hasIn = new Set([...pair.values()].map((x) => x.to));
  const hasOut = new Set([...pair.values()].map((x) => x.from));
  const sources = acts.filter((a) => !hasIn.has(a.id));
  const plain = sources.filter((a) => !a.trigger || a === acts[0]);
  const events = sources.filter((a) => a.trigger && a !== acts[0]);
  const startLane = lane(plain[0] ?? events[0] ?? acts[0]);

  nodes.push({ id: startId(p), kind: 'start', activityId: null, gate: null, lane: startLane, shape: 'circle', ...NODE_SIZE.circle });
  for (const a of acts) {
    if (events.includes(a)) nodes.push({ id: eventId(a), kind: 'event', activityId: a.id, gate: null, lane: lane(a), shape: 'circle', pin: 'succ', ...NODE_SIZE.circle });
    nodes.push({ id: a.id, kind: 'activity', activityId: a.id, gate: a.gateDecision, lane: lane(a), shape: 'rect', ...NODE_SIZE.activity });
    if (a.gateDecision) nodes.push({ id: gateId(a), kind: 'gate', activityId: a.id, gate: a.gateDecision, lane: lane(a), shape: 'diamond', ...NODE_SIZE.gate });
  }

  for (const a of plain) edges.push({ id: `${startId(p)}>${a.id}`, from: startId(p), to: a.id, kind: 'start', wps: [] });
  // 진입 조건 뒤에 사건만으로 시작하는 절차(모든 시작 활동이 사건)는 시작 원에서 사건으로 잇는다
  for (const a of events) {
    if (!plain.length) edges.push({ id: `${startId(p)}>${eventId(a)}`, from: startId(p), to: eventId(a), kind: 'start', wps: [] });
    edges.push({ id: `${eventId(a)}>${a.id}`, from: eventId(a), to: a.id, kind: 'event', wps: [] });
  }
  for (const a of acts) if (a.gateDecision) edges.push({ id: `${a.id}>${gateId(a)}`, from: a.id, to: gateId(a), kind: 'gate', wps: [] });
  for (const x of pair.values()) {
    const from = exitOf(x.from);
    edges.push({ id: `${from}>${x.to}`, from, to: x.to, kind: x.next ? 'flow' : 'data', style: x.next ? 'flow' : 'data', wps: x.wps, label: label(x.wps) });
  }

  const lastRank = acts.filter((a) => !hasOut.has(a.id));
  nodes.push({ id: endId(p), kind: 'end', activityId: null, gate: null, lane: lane(lastRank[lastRank.length - 1] ?? acts[acts.length - 1]), shape: 'circle', pin: 'last', ...NODE_SIZE.circle });
  for (const a of lastRank) {
    // 절차 밖으로 나가는 산출물(다른 절차·보존 기록) 이름을 종료 간선에 붙인다
    const leaving = a.outputs.filter((k) => !acts.some((b) => b.inputs.includes(k)));
    edges.push({ id: `${exitOf(a.id)}>${endId(p)}`, from: exitOf(a.id), to: endId(p), kind: 'end', style: 'flow', wps: leaving, label: label(leaving) });
  }

  const laneOrder: string[] = [];
  for (const a of acts) if (!laneOrder.includes(lane(a))) laneOrder.push(lane(a));
  return { nodes, edges, laneOrder };
}

// 같은 절차 객체는 한 번만 배치한다(역할이 바뀌어도 모양은 같고 상태만 바뀐다)
export type ProcessLayout = FlowLayout<ProcessGraph['nodes'][number], ProcessGraph['edges'][number]>;
const CACHE = new WeakMap<WorkflowProcess, { graph: ProcessGraph; layout: ProcessLayout }>();
export function processFlow(p: WorkflowProcess, more?: (n: number) => string): { graph: ProcessGraph; layout: ProcessLayout } {
  const hit = CACHE.get(p);
  if (hit) return hit;
  const graph = buildProcessGraph(p, more ? { more } : undefined);
  const layout = layoutFlow(graph);
  const made = { graph, layout };
  CACHE.set(p, made);
  return made;
}

/** 텍스트 보기 순서 — 흐름도 열(왼쪽→오른쪽), 같은 열은 위→아래 */
export function readingOrder(layout: ProcessLayout): string[] {
  return [...layout.nodes].sort((a, b) => a.rank - b.rank || a.y - b.y).map((n) => n.id);
}
