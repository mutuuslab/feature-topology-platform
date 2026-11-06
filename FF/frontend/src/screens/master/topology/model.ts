// Topology 그래프 모델 — Feature(최신 Version 기준)·의존관계·사전점검 결과·Flag를 한 그래프로 묶는다(순수 함수, 화면·시험 공용).
// 노드 = Feature ID 하나(Version은 목록으로), 간선 = 의존관계 하나. 도메인은 대표 기준 행 약어(목록 domain), 없으면 태그 대응표.
import { GATES, OFFICIAL_DOMAINS, type RelationType } from '@ff/contracts';

/** 관계 유형 10종(contracts RelationType) — REQUIRES는 배치 순위·흐름, EXCLUDES는 묶음 표시, 나머지는 방향(대칭이면 양끝 막대)만 */
export type DepType = RelationType;
export type GateTone = 'PASS' | 'REVIEW' | 'FAIL' | 'UNJUDGED';
export type VerdictTone = 'PASS' | 'CONDITIONAL' | 'FAIL' | 'PENDING';

export interface DepRow {
  dependencyId: string;
  type: DepType;
  sourceFeatureId: string;
  sourceVersion: string;
  targetFeatureId: string;
  targetVersion: string | null;
  verdict: string;
  rationale: string | null;
  targetVersionCheck?: string | null;
  ruleVersion?: string | null;
}
export interface FeatureRow {
  featureId: string;
  version: string;
  name: string;
  lifecycle: string;
  isLatest?: boolean;
  asil?: string | null;
  tags?: string[];
  controlPoints?: string[];
  gates?: Record<string, string>;
  domain?: string | null;
  ownerId?: string | null;
}
export interface PrecheckRule {
  ruleId: string;
  title: string;
  result: string;
  findings: { key: string; result: string; message: string }[];
}
export interface FlagRow {
  featureId: string;
  flagKey?: string;
}
export interface Finding {
  ruleId: string;
  title: string;
  result: string;
  message: string;
}

export interface TNode {
  id: string;
  name: string;
  version: string | null;
  versions: string[];
  lifecycle: string | null;
  asil: string | null;
  domain: string;
  flags: number;
  gates: { id: string; tone: GateTone }[];
  gatePass: number;
  ownerId: string | null;
  /** 도메인 묶음(접힘) 노드 — 묶인 Feature 수와 묶음 안 관계 수 */
  agg?: { count: number; inner: number; members: string[] };
}
export interface TEdge {
  id: string;
  source: string;
  target: string;
  type: DepType;
  verdict: string;
  tone: VerdictTone;
  sourceVersion: string | null;
  targetVersion: string | null;
  rationale: string | null;
  ruleVersion: string | null;
  versionCheck: string | null;
  findings: Finding[];
  /** 대상 Version 미기재(missing) · 더 새 Version이 있음(stale) */
  mismatch: 'missing' | 'stale' | null;
  cycle: boolean;
  /** 묶음 간선 — 합친 관계 수·원래 관계 ID */
  count?: number;
  members?: string[];
}
export interface TModel {
  nodes: Map<string, TNode>;
  edges: TEdge[];
}

/** 레인 순서 — 공식 도메인 10(엑셀 B열) 중 차량 기능을 위에서 아래로 읽는 순서, 대응 없는 Feature는 맨 아래 '기타' */
export const LANE_ORDER = ['AD', 'SF', 'CH', 'PE', 'PC', 'BC', 'IN', 'CO', 'PL', 'BE', 'ETC'] as const;
export const DOMAIN_NAME: Record<string, string> = Object.fromEntries(OFFICIAL_DOMAINS.map((d) => [d.abbr, d.name]));

/** 대표 기준 행이 없을 때 — Feature 태그(v0.81 데이터셋)를 공식 도메인으로 */
const TAG_DOMAIN: Record<string, string> = {
  adas: 'AD', parking: 'AD', safety: 'SF', chassis: 'CH', energy: 'PE', ev: 'PE', powertrain: 'PE',
  body: 'BC', cabin: 'BC', comfort: 'BC', ivi: 'IN', navigation: 'IN', hmi: 'IN', infotainment: 'IN',
  connectivity: 'CO', telematics: 'CO', ota: 'PL', platform: 'PL', cloud: 'BE',
};

export function domainOf(f: Pick<FeatureRow, 'domain' | 'tags'>): string {
  if (f.domain && DOMAIN_NAME[f.domain]) return f.domain;
  for (const t of f.tags ?? []) {
    const d = TAG_DOMAIN[t.toLowerCase()];
    if (d) return d;
  }
  return 'ETC';
}

export function verdictTone(v: string): VerdictTone {
  if (v === 'PASS') return 'PASS';
  if (v === 'FAIL') return 'FAIL';
  if (v === 'CONDITIONAL') return 'CONDITIONAL';
  return 'PENDING';
}
const TONE_RANK: Record<VerdictTone, number> = { PASS: 0, PENDING: 1, CONDITIONAL: 2, FAIL: 3 };
export const worseTone = (a: VerdictTone, b: VerdictTone) => (TONE_RANK[b] > TONE_RANK[a] ? b : a);

function gateTone(s: string | undefined): GateTone {
  if (s === 'PASS') return 'PASS';
  if (s === 'FAIL') return 'FAIL';
  if (s === '검토 중' || s === 'CONDITIONAL') return 'REVIEW';
  return 'UNJUDGED';
}

const cmpVer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** 그래프 모델 — 관계가 가리키는 Feature가 목록에 없으면(다른 범위) 이름 없는 노드로 둔다 */
export function buildModel(features: FeatureRow[], deps: DepRow[], rules: PrecheckRule[] = [], flags: FlagRow[] = []): TModel {
  const byId = new Map<string, FeatureRow[]>();
  for (const f of features) byId.set(f.featureId, [...(byId.get(f.featureId) ?? []), f]);
  const flagCount = new Map<string, number>();
  for (const fl of flags) flagCount.set(fl.featureId, (flagCount.get(fl.featureId) ?? 0) + 1);
  const nodes = new Map<string, TNode>();
  for (const [id, rows] of byId) {
    const sorted = [...rows].sort((a, b) => cmpVer(a.version, b.version));
    const latest = sorted.find((r) => r.isLatest) ?? sorted[sorted.length - 1];
    const domainRow = [...sorted].reverse().find((r) => r.domain) ?? latest;
    const gates = GATES.filter((g) => latest.gates?.[g] !== undefined).map((g) => ({ id: g, tone: gateTone(latest.gates?.[g]) }));
    nodes.set(id, {
      id,
      name: latest.name,
      version: latest.version,
      versions: sorted.map((r) => r.version),
      lifecycle: latest.lifecycle,
      asil: latest.asil ?? null,
      domain: domainOf({ domain: domainRow.domain, tags: latest.tags }),
      // Flag 수 = 코드에서 확인된 Flag(featureFlags), 없으면 제어점 중 Flag 수
      flags: flagCount.get(id) ?? (latest.controlPoints ?? []).filter((c) => c === 'Flag').length,
      gates,
      gatePass: gates.filter((g) => g.tone === 'PASS').length,
      ownerId: latest.ownerId ?? null,
    });
  }
  for (const d of deps)
    for (const id of [d.sourceFeatureId, d.targetFeatureId])
      if (!nodes.has(id)) nodes.set(id, { id, name: id, version: null, versions: [], lifecycle: null, asil: null, domain: 'ETC', flags: 0, gates: [], gatePass: 0, ownerId: null });
  const findingsOf = new Map<string, Finding[]>();
  for (const r of rules) for (const f of r.findings) findingsOf.set(f.key, [...(findingsOf.get(f.key) ?? []), { ruleId: r.ruleId, title: r.title, result: f.result, message: f.message }]);
  const edges: TEdge[] = deps.map((d) => {
    const target = nodes.get(d.targetFeatureId)!;
    const mismatch = !d.targetVersion ? 'missing' : target.version && target.versions.includes(d.targetVersion) && cmpVer(target.version, d.targetVersion) > 0 ? 'stale' : null;
    return {
      id: d.dependencyId,
      source: d.sourceFeatureId,
      target: d.targetFeatureId,
      type: d.type,
      verdict: d.verdict,
      tone: verdictTone(d.verdict),
      sourceVersion: d.sourceVersion ?? null,
      targetVersion: d.targetVersion ?? null,
      rationale: d.rationale ?? null,
      ruleVersion: d.ruleVersion ?? null,
      versionCheck: d.targetVersionCheck ?? null,
      findings: findingsOf.get(d.dependencyId) ?? [],
      mismatch,
      cycle: false,
    };
  });
  markCycles(edges);
  return { nodes, edges };
}

/** REQUIRES 순환 — 강결합 요소(Tarjan) 안의 간선과 자기 참조를 표시한다 */
export function markCycles(edges: TEdge[]): void {
  const adj = new Map<string, string[]>();
  for (const e of edges) if (e.type === 'REQUIRES') adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const index = new Map<string, number>(), low = new Map<string, number>(), comp = new Map<string, number>();
  const stack: string[] = [], on = new Set<string>();
  let i = 0, c = 0;
  const visit = (v: string) => {
    index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do { w = stack.pop()!; on.delete(w); comp.set(w, c); } while (w !== v);
      c++;
    }
  };
  for (const v of [...adj.keys()].sort()) if (!index.has(v)) visit(v);
  const size = new Map<number, number>();
  for (const k of comp.values()) size.set(k, (size.get(k) ?? 0) + 1);
  for (const e of edges)
    e.cycle = e.type === 'REQUIRES' && (e.source === e.target || (comp.get(e.source) === comp.get(e.target) && (size.get(comp.get(e.source)!) ?? 0) > 1));
}

/** 선택 Feature 주변 — 관계 방향과 무관하게 1·2단계 이웃 */
export function neighborhood(edges: readonly TEdge[], id: string, hops = 2): Map<string, number> {
  const adj = undirected(edges);
  const dist = new Map([[id, 0]]);
  let frontier = [id];
  for (let h = 1; h <= hops; h++) {
    const next: string[] = [];
    for (const v of frontier) for (const w of adj.get(v) ?? []) if (!dist.has(w)) (dist.set(w, h), next.push(w));
    frontier = next;
  }
  return dist;
}

function undirected(edges: readonly TEdge[]) {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  for (const [k, v] of adj) adj.set(k, [...new Set(v)].sort());
  return adj;
}

export interface PathResult {
  nodes: string[];
  edges: string[];
  /** requires = 원천→대상 의존 방향, reverse = 반대 방향(B가 A에 의존), any = 방향 무관 연결 */
  mode: 'requires' | 'reverse' | 'any';
}

/** A→B 경로 — 의존 방향(REQUIRES) 최단 경로를 먼저, 없으면 반대 방향, 그래도 없으면 방향 무관 */
export function findPath(edges: readonly TEdge[], from: string, to: string): PathResult | null {
  if (from === to) return null;
  const tries: [PathResult['mode'], (e: TEdge) => [string, string][]][] = [
    ['requires', (e) => (e.type === 'REQUIRES' ? [[e.source, e.target]] : [])],
    ['reverse', (e) => (e.type === 'REQUIRES' ? [[e.target, e.source]] : [])],
    ['any', (e) => [[e.source, e.target], [e.target, e.source]]],
  ];
  for (const [mode, arcs] of tries) {
    const adj = new Map<string, { to: string; edge: string }[]>();
    for (const e of [...edges].sort((a, b) => a.id.localeCompare(b.id))) for (const [a, b] of arcs(e)) adj.set(a, [...(adj.get(a) ?? []), { to: b, edge: e.id }]);
    const prev = new Map<string, { from: string; edge: string }>();
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const v = q.shift()!;
      if (v === to) break;
      for (const { to: w, edge } of adj.get(v) ?? []) if (!seen.has(w)) (seen.add(w), prev.set(w, { from: v, edge }), q.push(w));
    }
    if (!seen.has(to)) continue;
    const nodes = [to], es: string[] = [];
    for (let v = to; v !== from; ) { const p = prev.get(v)!; es.unshift(p.edge); nodes.unshift(p.from); v = p.from; }
    return { nodes, edges: es, mode };
  }
  return null;
}

export interface Impact {
  depth: number;
  via: 'requires' | 'excludes';
}

/** 영향 분석 — 선택 Feature가 바뀌면 그것을 (간접으로) 필요로 하는 Feature, 그리고 함께 구성할 수 없는 Feature */
export function impactOf(edges: readonly TEdge[], id: string): Map<string, Impact> {
  const up = new Map<string, string[]>();
  for (const e of edges) if (e.type === 'REQUIRES') up.set(e.target, [...(up.get(e.target) ?? []), e.source]);
  const out = new Map<string, Impact>();
  let frontier = [id];
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const v of frontier) for (const w of (up.get(v) ?? []).sort()) if (w !== id && !out.has(w)) (out.set(w, { depth: d, via: 'requires' }), next.push(w));
    frontier = next;
  }
  for (const e of edges)
    if (e.type === 'EXCLUDES') {
      const other = e.source === id ? e.target : e.target === id ? e.source : null;
      if (other && !out.has(other)) out.set(other, { depth: 1, via: 'excludes' });
    }
  return out;
}

/** 도메인 묶음 — 접은 도메인의 Feature를 한 노드로, 그 노드에 닿는 관계는 (원천, 대상, 유형)마다 하나로 합친다 */
export function collapseDomains(model: TModel, collapsed: ReadonlySet<string>): TModel {
  if (!collapsed.size) return model;
  const owner = (id: string) => {
    const n = model.nodes.get(id)!;
    return collapsed.has(n.domain) ? `agg:${n.domain}` : id;
  };
  const nodes = new Map<string, TNode>();
  for (const n of model.nodes.values()) {
    if (!collapsed.has(n.domain)) { nodes.set(n.id, n); continue; }
    const key = `agg:${n.domain}`;
    const a = nodes.get(key) ?? { id: key, name: DOMAIN_NAME[n.domain] ?? n.domain, version: null, versions: [], lifecycle: null, asil: null, domain: n.domain, flags: 0, gates: [], gatePass: 0, ownerId: null, agg: { count: 0, inner: 0, members: [] } };
    a.flags += n.flags;
    a.agg!.count++;
    a.agg!.members.push(n.id);
    nodes.set(key, a);
  }
  const merged = new Map<string, TEdge>();
  for (const e of model.edges) {
    const s = owner(e.source), t = owner(e.target);
    if (s === t && s.startsWith('agg:')) { nodes.get(s)!.agg!.inner++; continue; }
    if (s === e.source && t === e.target) { merged.set(e.id, e); continue; }
    const key = `${s}>${t}>${e.type}`;
    const m = merged.get(key);
    if (!m) merged.set(key, { ...e, id: `grp:${key}`, source: s, target: t, count: 1, members: [e.id], findings: [...e.findings] });
    else {
      m.count! += 1;
      m.members!.push(e.id);
      m.tone = worseTone(m.tone, e.tone);
      m.verdict = m.tone === 'PENDING' ? '미판정' : m.tone;
      m.mismatch = m.mismatch ?? e.mismatch;
      m.cycle = m.cycle || e.cycle;
      m.findings.push(...e.findings);
    }
  }
  return { nodes, edges: [...merged.values()] };
}

export interface Filters {
  domains: ReadonlySet<string>;
  asil: ReadonlySet<string>;
  lifecycle: string;
  flagsOnly: boolean;
  verdict: '' | 'open' | 'FAIL';
  isolated: boolean;
  /** 관계 유형(FR-DEP-004-002) — 비면 전체 */
  types: ReadonlySet<string>;
}
export const NO_FILTERS: Filters = { domains: new Set(), asil: new Set(), lifecycle: '', flagsOnly: false, verdict: '', isolated: false, types: new Set() };

/** 필터 — 노드 조건(도메인·ASIL·Lifecycle·Flag)과 관계 조건(판정)을 함께. 관계 없는 Feature는 isolated일 때만 */
export function applyFilters(model: TModel, f: Filters): TModel {
  const keepNode = (n: TNode) =>
    (!f.domains.size || f.domains.has(n.domain)) && (!f.asil.size || f.asil.has(n.asil ?? '')) && (!f.lifecycle || n.lifecycle === f.lifecycle) && (!f.flagsOnly || n.flags > 0);
  const edges = model.edges.filter((e) => {
    const s = model.nodes.get(e.source), t = model.nodes.get(e.target);
    if (!s || !t || !keepNode(s) || !keepNode(t)) return false;
    if (f.types?.size && !f.types.has(e.type)) return false;
    if (f.verdict === 'open') return e.tone !== 'PASS';
    if (f.verdict === 'FAIL') return e.tone === 'FAIL';
    return true;
  });
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes = new Map([...model.nodes].filter(([id, n]) => keepNode(n) && (linked.has(id) || (f.isolated && !f.verdict))));
  return { nodes, edges };
}
