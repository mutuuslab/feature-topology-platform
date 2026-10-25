// 절차(FPW.n) 한 건 → 흐름도 그래프. 표기는 엔지니어링 절차서(EngineeringWorkFlow) 방식을 따른다:
//   맨 위 '입력' 레인 = 다른 절차·외부에서 오는 산출물 문서, 가운데 = 수행(R) 역할 레인의 활동, 맨 아래 '산출물' 레인 = 활동이 만드는 문서.
//   제어 흐름(실선, 상자 옆) = 시작 → 활동 → (Gate 판정 마름모) → 다음 활동 → 종료.
//   객체 흐름(점선, 상자 위아래) = 입력 문서 → 쓰는 활동, 활동 → 만든 문서.
//   다음 활동으로 이어지지 않는 산출물 의존(앞 활동이 만든 문서를 쓰기만 함)은 입력 레인에 그 문서의 '참조'를 두고 위에서 넣는다
//   — 아래 산출물 레인에서 거꾸로 올라오는 긴 선을 만들지 않는다.
// 산출물 의존은 열 순서(숨은 간선)에도 쓴다 — 쓰는 활동은 만든 활동 뒤에 놓인다. 화면 밖 사실(완료·내 차례)은 status.ts가 따로 얹는다.
import type { WorkflowActivity, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { layoutFlow, type FlowLayout, type LEdge, type LNode } from './layout';

export type FlowNodeKind = 'start' | 'event' | 'activity' | 'gate' | 'end' | 'doc';
/** 제어 흐름: start·event·flow·gate·end / 객체 흐름: input·output·use / 숨은 순서: data */
export type FlowEdgeKind = 'flow' | 'start' | 'event' | 'gate' | 'end' | 'input' | 'output' | 'use' | 'data';

export const IN_LANE = '__in';
export const OUT_LANE = '__out';

export interface FlowNodeMeta {
  id: string;
  kind: FlowNodeKind;
  /** 활동·Gate 상자가 가리키는 활동 */
  activityId: string | null;
  gate: string | null;
  /** 문서 상자 — 산출물 키, 다른 절차(또는 밖)에서 오는지, 만든 절차(참조는 만든 활동), 보존 기록인지, 이 절차 산출물의 참조인지 */
  wp: string | null;
  external: boolean;
  owner: string | null;
  retained: boolean;
  ref: boolean;
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
  activity: { w: 160, h: 80 },
  doc: { w: 160, h: 58 },
  gate: { w: 56, h: 56 },
  start: { w: 22, h: 22 },
  end: { w: 26, h: 26 },
} as const;

export const startId = (p: WorkflowProcess) => `${p.id}:start`;
export const endId = (p: WorkflowProcess) => `${p.id}:end`;
export const gateId = (a: WorkflowActivity) => `${a.id}:gate`;
export const eventId = (a: WorkflowActivity) => `${a.id}:event`;
export const inDocId = (p: WorkflowProcess, key: string) => `${p.id}:in:${key}`;
export const outDocId = (p: WorkflowProcess, key: string) => `${p.id}:out:${key}`;
export const refDocId = (p: WorkflowProcess, key: string) => `${p.id}:ref:${key}`;

export const isObjectFlow = (k: FlowEdgeKind) => k === 'input' || k === 'output' || k === 'use';

/** 이름표 — 산출물 하나면 그 이름, 여럿이면 "첫 이름 외 n" */
export function wpLabel(keys: string[], name: (k: string) => string, more: (n: number) => string): string | undefined {
  if (!keys.length) return undefined;
  return keys.length === 1 ? name(keys[0]) : `${name(keys[0])} ${more(keys.length - 1)}`;
}

/** 산출물 키 → 이름·만든 절차(문서 전체에서) */
export type WpInfo = (key: string) => { name: string; process: string | null; retained: boolean } | null;
export function wpInfoOf(doc: WorkflowDoc | undefined): WpInfo {
  const m = new Map<string, { name: string; process: string | null; retained: boolean }>();
  for (const p of doc?.processes ?? [])
    for (const w of p.workProducts) {
      const producer = p.activities.some((a) => a.outputs.includes(w.key));
      if (!m.has(w.key) || producer) m.set(w.key, { name: w.name, process: producer ? p.id : m.get(w.key)?.process ?? null, retained: w.retained });
    }
  return (k) => m.get(k) ?? null;
}

export function buildProcessGraph(p: WorkflowProcess, wpInfo: WpInfo = () => null): ProcessGraph {
  const acts = p.activities;
  const lane = (a: WorkflowActivity) => a.raci.R[0] ?? a.raci.A;
  const own = new Map(p.workProducts.map((w) => [w.key, w]));
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
  /** 활동에서 나가는 제어 흐름의 실제 출발 상자(Gate 판정 활동은 마름모에서 나간다) */
  const exitOf = (id: string) => (byId.get(id)?.gateDecision ? gateId(byId.get(id)!) : id);
  const none = { activityId: null, gate: null, wp: null, external: false, owner: null, retained: false, ref: false };

  // 제어 흐름의 시작·끝은 next만 본다 — 모든 활동이 시작에서 끝까지 실선 위에 놓인다(절차서 표기)
  const nextIn = new Set([...pair.values()].filter((x) => x.next).map((x) => x.to));
  const nextOut = new Set([...pair.values()].filter((x) => x.next).map((x) => x.from));
  const hasDep = new Set([...pair.values()].filter((x) => !x.next).map((x) => x.to));
  const sources = acts.filter((a) => !nextIn.has(a.id));
  // 시작 점에서 바로: 첫 활동·사건도 산출물 의존도 없는 활동 / 따로 시작: 사건(trigger) 또는 앞 활동 산출물이 준비되면(준비 시작)
  const plain = sources.filter((a) => a === acts[0] || (!a.trigger && !hasDep.has(a.id)));
  const events = sources.filter((a) => !plain.includes(a));
  const startLane = lane(plain[0] ?? events[0] ?? acts[0]);

  nodes.push({ id: startId(p), kind: 'start', ...none, lane: startLane, shape: 'circle', ...NODE_SIZE.start });
  for (const a of acts) {
    if (events.includes(a)) nodes.push({ id: eventId(a), kind: 'event', ...none, activityId: a.id, lane: lane(a), shape: 'circle', pin: 'succ', ...NODE_SIZE.start });
    nodes.push({ id: a.id, kind: 'activity', ...none, activityId: a.id, gate: a.gateDecision, lane: lane(a), shape: 'rect', ...NODE_SIZE.activity });
    if (a.gateDecision) nodes.push({ id: gateId(a), kind: 'gate', ...none, activityId: a.id, gate: a.gateDecision, lane: lane(a), shape: 'diamond', ...NODE_SIZE.gate });
  }
  const lastRank = acts.filter((a) => !nextOut.has(a.id));
  nodes.push({ id: endId(p), kind: 'end', ...none, lane: lane(lastRank[lastRank.length - 1] ?? acts[acts.length - 1]), shape: 'circle', pin: 'last', ...NODE_SIZE.end });

  // 문서 — 입력(이 절차가 만들지 않는 산출물)은 맨 위, 이 절차가 만드는 산출물은 맨 아래
  const inputs: string[] = [];
  for (const a of acts) for (const k of a.inputs) if (!producers.has(k) && !inputs.includes(k)) inputs.push(k);
  for (const k of inputs) {
    const info = wpInfo(k);
    nodes.push({ id: inDocId(p, k), kind: 'doc', ...none, wp: k, external: true, owner: info?.process ?? null, retained: info?.retained ?? false, lane: IN_LANE, shape: 'doc', free: true, ...NODE_SIZE.doc });
  }
  // 참조 문서 — 앞 활동이 만든 문서를 다음 활동 연결 없이 쓰는 경우(입력 레인에 둔다)
  const refs: string[] = [];
  for (const a of acts) for (const k of a.inputs) for (const from of producers.get(k) ?? []) if (from !== a.id && !pair.get(`${from}>${a.id}`)?.next && !refs.includes(k)) refs.push(k);
  for (const k of refs)
    nodes.push({ id: refDocId(p, k), kind: 'doc', ...none, wp: k, owner: producers.get(k)![0], retained: own.get(k)?.retained ?? false, ref: true, lane: IN_LANE, shape: 'doc', free: true, ...NODE_SIZE.doc });
  for (const k of producers.keys())
    nodes.push({ id: outDocId(p, k), kind: 'doc', ...none, wp: k, external: false, owner: p.id, retained: own.get(k)?.retained ?? false, lane: OUT_LANE, shape: 'doc', free: true, ...NODE_SIZE.doc });

  // 제어 흐름
  for (const a of plain) edges.push({ id: `${startId(p)}>${a.id}`, from: startId(p), to: a.id, kind: 'start', style: 'control', trunk: 'start', wps: [] });
  // 진입 조건 뒤에 사건만으로 시작하는 절차(모든 시작 활동이 사건)는 시작 원에서 사건으로 잇는다
  for (const a of events) {
    if (!plain.length) edges.push({ id: `${startId(p)}>${eventId(a)}`, from: startId(p), to: eventId(a), kind: 'start', style: 'control', trunk: 'start', wps: [] });
    edges.push({ id: `${eventId(a)}>${a.id}`, from: eventId(a), to: a.id, kind: 'event', style: 'control', wps: [] });
  }
  for (const a of acts) if (a.gateDecision) edges.push({ id: `${a.id}>${gateId(a)}`, from: a.id, to: gateId(a), kind: 'gate', style: 'control', wps: [] });
  for (const x of pair.values()) {
    const from = exitOf(x.from);
    if (x.next) edges.push({ id: `${from}>${x.to}`, from, to: x.to, kind: 'flow', style: 'control', wps: x.wps });
    // 다음 활동으로 잇지 않은 산출물 의존 — 순서에만 쓰고, 그림은 문서에서 쓰는 활동으로 가는 객체 흐름
    else edges.push({ id: `${from}>${x.to}`, from, to: x.to, kind: 'data', hidden: true, wps: x.wps });
  }
  for (const a of lastRank) {
    // 절차 밖으로 나가는 산출물(다른 절차·보존 기록)
    const leaving = a.outputs.filter((k) => !acts.some((b) => b.inputs.includes(k)));
    edges.push({ id: `${exitOf(a.id)}>${endId(p)}`, from: exitOf(a.id), to: endId(p), kind: 'end', style: 'control', merge: 'end', wps: leaving });
  }

  // 객체 흐름
  for (const a of acts)
    for (const k of a.inputs) {
      if (!producers.has(k)) edges.push({ id: `${inDocId(p, k)}>${a.id}`, from: inDocId(p, k), to: a.id, kind: 'input', style: 'object', route: 'vert', wps: [k] });
      else
        if (refs.includes(k) && (producers.get(k) ?? []).some((from) => from !== a.id && !pair.get(`${from}>${a.id}`)?.next))
          edges.push({ id: `${refDocId(p, k)}>${a.id}`, from: refDocId(p, k), to: a.id, kind: 'use', style: 'object', route: 'vert', wps: [k] });
    }
  for (const [k, list] of producers) for (const from of list) edges.push({ id: `${from}>${outDocId(p, k)}`, from, to: outDocId(p, k), kind: 'output', style: 'object', route: 'vert', wps: [k] });

  const laneOrder: string[] = [IN_LANE];
  for (const a of acts) if (!laneOrder.includes(lane(a))) laneOrder.push(lane(a));
  laneOrder.push(OUT_LANE);
  return { nodes, edges, laneOrder };
}

export const PROCESS_LAYOUT = { laneLabelW: 128, pinnedLanes: [IN_LANE, OUT_LANE], outerBand: 16, innerBand: 32 };

// 같은 절차 객체는 한 번만 배치한다(역할이 바뀌어도 모양은 같고 상태만 바뀐다)
export type ProcessLayout = FlowLayout<ProcessGraph['nodes'][number], ProcessGraph['edges'][number]>;
const CACHE = new WeakMap<WorkflowProcess, { graph: ProcessGraph; layout: ProcessLayout }>();
export function processFlow(p: WorkflowProcess, doc?: WorkflowDoc): { graph: ProcessGraph; layout: ProcessLayout } {
  const hit = CACHE.get(p);
  if (hit) return hit;
  const graph = buildProcessGraph(p, wpInfoOf(doc));
  const layout = layoutFlow(graph, PROCESS_LAYOUT);
  const made = { graph, layout };
  CACHE.set(p, made);
  return made;
}

/** 텍스트 보기 순서 — 흐름도 열(왼쪽→오른쪽), 같은 열은 위→아래 */
export function readingOrder(layout: ProcessLayout): string[] {
  return [...layout.nodes].sort((a, b) => a.rank - b.rank || a.y - b.y).map((n) => n.id);
}
