// Topology 관계 그래프 작업대 — 도메인 레인 그래프(GraphStage)·도구 막대(찾기·영향 분석·경로·흐름)·필터·선택 정보·표 보기.
// 선택(Feature·관계)은 주소(feature·relation)에 둔다 — 상세 화면·핵심 메시지 행동·이전 주소(/topology/:id)가 같은 상태를 연다.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LIFECYCLE } from '@ff/contracts';
import { topologyGraph as G } from '../../../copy/topology-graph';
import { topologyMotion as M } from '../../../copy/topology-motion';
import { traceCopy } from '../../../copy/trace-links';
import { RELATION_TYPE_LIST, RELATION_TYPES } from '../../../../../contracts/src/rules/relation-types';
import { ko } from '../../../copy/ko';
import { DataTable, GateRail, LifecycleBadge, Segmented, Select, VerdictBadge } from '../../../design';
import { GraphStage, type Highlight, type NodeState, type StageHandle } from './GraphStage';
import { layoutGraph } from './layout';
import { applyFilters, buildModel, collapseDomains, DOMAIN_NAME, findPath, impactOf, LANE_ORDER, neighborhood, NO_FILTERS, type DepRow, type FeatureRow, type Filters, type FlagRow, type PrecheckRule, type TEdge, type TModel, type TNode } from './model';
import './topology.css';

const T = ko.master.topology;
type Mode = 'none' | 'impact' | 'path';

function useReducedMotion() {
  const query = () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false;
  const [reduced, setReduced] = useState(query);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m?.matches ?? false);
    m?.addEventListener?.('change', on);
    return () => m?.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

function useMedia(q: string) {
  const read = () => (typeof window !== 'undefined' && window.matchMedia?.(q).matches) || false;
  const [on, setOn] = useState(read);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    const f = () => setOn(m?.matches ?? false);
    m?.addEventListener?.('change', f);
    return () => m?.removeEventListener?.('change', f);
  }, [q]);
  return on;
}

export function TopologyWorkbench({
  features,
  deps,
  rules = [],
  flags = [],
  focus,
  relation,
  explicitFocus = false,
  onSelect,
}: {
  features: FeatureRow[];
  deps: DepRow[];
  rules?: PrecheckRule[];
  flags?: FlagRow[];
  focus: string | null;
  relation: string | null;
  explicitFocus?: boolean;
  onSelect: (next: { feature?: string | null; relation?: string | null }) => void;
}) {
  const reduced = useReducedMotion();
  // 좁은 화면 — 레인 머리를 약어만 보이는 좁은 띠로
  const compact = useMedia('(max-width: 719px)');
  const uid = useId().replace(/:/g, '');
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<Mode>('none');
  const [pathTo, setPathTo] = useState('');
  const [flow, setFlow] = useState(true);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const stage = useRef<StageHandle | null>(null);
  const onReady = useCallback((h: StageHandle) => void (stage.current = h), []);

  const model = useMemo(() => buildModel(features, deps, rules, flags), [features, deps, rules, flags]);
  const filtered = useMemo(() => applyFilters(model, filters), [model, filters]);
  const graph = useMemo(() => collapseDomains(filtered, collapsed), [filtered, collapsed]);
  const layout = useMemo(() => layoutGraph([...graph.nodes.values()], graph.edges, { headerW: compact ? 64 : 184 }), [graph, compact]);
  const fitKey = useMemo(() => `${[...graph.nodes.keys()].sort().join(',')}|${graph.edges.length}`, [graph]);

  // 접힌 도메인 안의 Feature를 고르면 그 묶음 노드가 선택으로 보인다
  const shown = (id: string | null) => {
    if (!id) return null;
    if (graph.nodes.has(id)) return id;
    const d = model.nodes.get(id)?.domain;
    return d && collapsed.has(d) && graph.nodes.has(`agg:${d}`) ? `agg:${d}` : null;
  };
  const focusKey = shown(focus);
  const relEdge = relation ? graph.edges.find((e) => e.id === relation || e.members?.includes(relation)) : undefined;
  const relModel = relation ? model.edges.find((e) => e.id === relation) : undefined;

  const path = useMemo(() => (mode === 'path' && focusKey && pathTo && graph.nodes.has(pathTo) ? findPath(graph.edges, focusKey, pathTo) : null), [mode, focusKey, pathTo, graph]);
  const impact = useMemo(() => (mode === 'impact' && focusKey ? impactOf(graph.edges, focusKey) : null), [mode, focusKey, graph]);
  const hl = useMemo<Highlight>(() => {
    const nodes = new Map<string, NodeState>(), edges = new Set<string>(), badges = new Map<string, string>();
    if (!focusKey) return { nodes, edges, dim: false, badges };
    if (mode === 'path' && path) {
      path.nodes.forEach((v, i) => (nodes.set(v, i === 0 ? 'sel' : 'hl1'), badges.set(v, String(i + 1))));
      path.edges.forEach((e) => edges.add(e));
      return { nodes, edges, dim: true, badges };
    }
    if (mode === 'impact' && impact) {
      nodes.set(focusKey, 'sel');
      for (const [v, imp] of impact) (nodes.set(v, imp.depth === 1 ? 'hl1' : 'hl2'), badges.set(v, imp.via === 'excludes' ? '⊘' : String(imp.depth)));
      for (const e of graph.edges) {
        const ds = impact.get(e.source)?.depth, dt = e.target === focusKey ? 0 : impact.get(e.target)?.depth;
        if (e.type === 'REQUIRES' && ds !== undefined && dt !== undefined && ds === dt + 1) edges.add(e.id);
        if (e.type === 'EXCLUDES' && (e.source === focusKey || e.target === focusKey)) edges.add(e.id);
      }
      return { nodes, edges, dim: true, badges };
    }
    const nb = neighborhood(graph.edges, focusKey, 2);
    for (const [v, h] of nb) nodes.set(v, h === 0 ? 'sel' : h === 1 ? 'hl1' : 'hl2');
    for (const e of graph.edges) {
      const a = nb.get(e.source), b = nb.get(e.target);
      if (a !== undefined && b !== undefined && Math.min(a, b) <= 1) edges.add(e.id);
    }
    return { nodes, edges, dim: nb.size > 1, badges };
  }, [focusKey, mode, path, impact, graph.edges]);

  const fail = graph.edges.filter((e) => e.tone === 'FAIL').length;
  const open = graph.edges.filter((e) => e.tone === 'CONDITIONAL' || e.tone === 'PENDING').length;
  const modeText =
    mode === 'path' && focusKey
      ? pathTo
        ? path
          ? G.pathResult(path.edges.length, path.mode)
          : G.pathNone(focusKey, pathTo)
        : G.pathPick
      : mode === 'impact' && focusKey && impact
        ? impact.size
          ? G.impactResult(focusKey, impact.size, Math.max(...[...impact.values()].map((v) => v.depth)))
          : G.impactNone(focusKey)
        : null;

  const toggleLane = useCallback((d: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(d)) n.delete(d); else n.add(d); return n; }), []);
  const onNode = useCallback(
    (id: string) => {
      if (id.startsWith('agg:')) return toggleLane(id.slice(4));
      onSelect({ feature: id, relation: null });
    },
    [onSelect, toggleLane],
  );
  const onEdge = useCallback(
    (id: string) => {
      const e = graph.edges.find((x) => x.id === id);
      if (!e) return;
      const rel = e.members?.[0] ?? e.id;
      const m = model.edges.find((x) => x.id === rel);
      onSelect({ relation: rel, ...(m && focus !== m.source && focus !== m.target ? { feature: m.source } : {}) });
    },
    [graph.edges, model.edges, focus, onSelect],
  );
  const find = (ev: FormEvent) => {
    ev.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = [...model.nodes.values()].find((n) => n.id.toLowerCase() === q || n.id.toLowerCase().endsWith(q) || `${n.id} · ${n.name}`.toLowerCase() === q) ?? [...model.nodes.values()].find((n) => n.name.toLowerCase().includes(q));
    if (!hit || !filtered.nodes.has(hit.id)) return setNote(G.notFound(query.trim()));
    setNote(null);
    if (collapsed.has(hit.domain)) toggleLane(hit.domain);
    onSelect({ feature: hit.id, relation: null });
    setView('graph');
    requestAnimationFrame(() => requestAnimationFrame(() => stage.current?.focusNode(hit.id)));
  };
  const activeFilters = filters.domains.size + filters.asil.size + filters.types.size + (filters.lifecycle ? 1 : 0) + (filters.flagsOnly ? 1 : 0) + (filters.verdict ? 1 : 0) + (filters.isolated ? 1 : 0);
  // 그래프에 있는 관계 유형과 수 — 유형 칩(FR-DEP-004-002)
  const typeCounts = RELATION_TYPE_LIST.map((t) => [t, model.edges.filter((e) => e.type === t).length] as const).filter(([, n]) => n > 0);
  const toggleIn = (k: 'domains' | 'asil' | 'types', v: string) => setFilters((f) => { const s = new Set(f[k]); if (s.has(v)) s.delete(v); else s.add(v); return { ...f, [k]: s }; });
  const domainCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of model.nodes.values()) m.set(n.domain, (m.get(n.domain) ?? 0) + 1);
    return m;
  }, [model]);
  const asils = ['QM', 'A', 'B', 'C', 'D'].filter((a) => [...model.nodes.values()].some((n) => n.asil === a));
  const lifecycles = LIFECYCLE.filter((l) => [...model.nodes.values()].some((n) => n.lifecycle === l));
  const wide = typeof window !== 'undefined' && (window.matchMedia?.('(min-width: 1024px)').matches ?? true);
  const pathTargets = [...graph.nodes.values()].filter((n) => n.id !== focusKey && !n.agg).sort((a, b) => (a.id < b.id ? -1 : 1));

  return (
    <section className="topo-wb" aria-label={G.region}>
      <div className="topo-wb__bar">
        <form role="search" className="topo-wb__search" onSubmit={find}>
          <label className="ds-field ds-field--inline">
            <span className="ds-field__label">{G.search}</span>
            <input className="ds-input" type="search" list={`${uid}-feats`} value={query} placeholder={G.searchHint} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <datalist id={`${uid}-feats`}>
            {[...filtered.nodes.values()].map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </datalist>
        </form>
        <Segmented label={G.view} options={[{ value: 'graph', label: G.views.graph }, { value: 'table', label: G.views.table }]} value={view} onChange={(v) => setView(v as 'graph' | 'table')} />
        <div className="topo-wb__modes" role="group" aria-label={G.tools}>
          <button type="button" className="ds-btn" aria-pressed={mode === 'impact'} disabled={!focusKey} onClick={() => setMode((m) => (m === 'impact' ? 'none' : 'impact'))}>{G.impact}</button>
          <button type="button" className="ds-btn" aria-pressed={mode === 'path'} disabled={!focusKey} onClick={() => setMode((m) => (m === 'path' ? 'none' : 'path'))}>{G.path}</button>
          {mode === 'path' && (
            <Select label={G.pathTo} value={pathTo} onChange={(e) => setPathTo(e.target.value)}>
              <option value="">{G.pathPick}</option>
              {pathTargets.map((n) => <option key={n.id} value={n.id}>{`${n.id} · ${n.name}`}</option>)}
            </Select>
          )}
          <button type="button" className="ds-btn" aria-pressed={flow && !reduced} disabled={reduced} title={reduced ? M.reduced : undefined} onClick={() => setFlow((f) => !f)}>{G.flow}</button>
        </div>
      </div>
      <details className="topo-wb__filters" open={wide || activeFilters > 0}>
        <summary>{activeFilters ? `${G.filters} · ${activeFilters}` : G.filters}</summary>
        <div className="topo-wb__filter-row">
          <div className="topo-chips" role="group" aria-label={G.domain}>
            {LANE_ORDER.filter((d) => domainCounts.has(d)).map((d) => (
              <button key={d} type="button" className="topo-chip" data-domain={d} aria-pressed={filters.domains.has(d)} title={DOMAIN_NAME[d] ?? d} onClick={() => toggleIn('domains', d)}>
                <span className="topo-chip__sw" aria-hidden="true" />
                {d}
                <span className="topo-chip__n">{domainCounts.get(d)}</span>
              </button>
            ))}
          </div>
          <div className="topo-chips" role="group" aria-label={G.asil}>
            {asils.map((a) => (
              <button key={a} type="button" className="topo-chip" aria-pressed={filters.asil.has(a)} onClick={() => toggleIn('asil', a)}>{a === 'QM' ? a : `ASIL ${a}`}</button>
            ))}
          </div>
          <div className="topo-chips" role="group" aria-label={traceCopy.topology.types}>
            {typeCounts.map(([t, n]) => (
              <button key={t} type="button" className="topo-chip" data-type={t} aria-pressed={filters.types.has(t)} title={RELATION_TYPES[t].description} onClick={() => toggleIn('types', t)}>
                {G.type[t] ?? t}
                <span className="topo-chip__n">{n}</span>
              </button>
            ))}
          </div>
          <Select label={G.lifecycle} value={filters.lifecycle} onChange={(e) => setFilters((f) => ({ ...f, lifecycle: e.target.value }))}>
            <option value="">{G.all}</option>
            {lifecycles.map((l) => <option key={l} value={l}>{`${l} · ${ko.lifecycle[l]}`}</option>)}
          </Select>
          <Select label={G.verdict} value={filters.verdict} onChange={(e) => setFilters((f) => ({ ...f, verdict: e.target.value as Filters['verdict'] }))}>
            <option value="">{G.verdicts.all}</option>
            <option value="open">{G.verdicts.open}</option>
            <option value="FAIL">{G.verdicts.FAIL}</option>
          </Select>
          <label className="topo-check"><input type="checkbox" checked={filters.flagsOnly} onChange={(e) => setFilters((f) => ({ ...f, flagsOnly: e.target.checked }))} />{G.flagsOnly}</label>
          <label className="topo-check"><input type="checkbox" checked={filters.isolated} onChange={(e) => setFilters((f) => ({ ...f, isolated: e.target.checked }))} />{G.isolated}</label>
          {activeFilters > 0 && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setFilters(NO_FILTERS)}>{G.reset}</button>}
        </div>
      </details>
      <p className="topo-wb__status" role="status">
        <span>{G.status(graph.nodes.size, graph.edges.length, fail, open)}</span>
        {(modeText || note) && <span className="topo-wb__mode">{note ?? modeText}</span>}
      </p>
      {view === 'graph' ? (
        <div className="topo-wb__body">
          <div className="topo-wb__canvas">
            <GraphStage
              graph={graph}
              layout={layout}
              focus={focusKey}
              relation={relEdge?.id ?? null}
              hl={hl}
              flow={flow}
              reduced={reduced}
              collapsed={collapsed}
              fitKey={fitKey}
              focusOnMount={explicitFocus || !!focusKey}
              onNode={onNode}
              onEdge={onEdge}
              onToggleLane={toggleLane}
              onReady={onReady}
            />
            <p id="topo-keys" className="topo-wb__keys">{G.keys}</p>
          </div>
          <Inspector graph={graph} model={model} features={features} focus={focusKey} relEdge={relEdge} relModel={relModel} onSelect={onSelect} onMode={(m) => setMode(m)} onExpand={toggleLane} />
        </div>
      ) : (
        <FeatureTable graph={filtered} onPick={(id) => onSelect({ feature: id, relation: null })} focus={focus} />
      )}
      <Legend />
    </section>
  );
}

const toneLabel = (e: TEdge) => (e.tone === 'PENDING' ? M.pending : e.verdict);

function Inspector({ graph, model, features, focus, relEdge, relModel, onSelect, onMode, onExpand }: {
  graph: TModel; model: TModel; features: FeatureRow[]; focus: string | null; relEdge?: TEdge; relModel?: TEdge;
  onSelect: (next: { feature?: string | null; relation?: string | null }) => void; onMode: (m: Mode) => void; onExpand: (d: string) => void;
}) {
  const node = focus ? graph.nodes.get(focus) : undefined;
  const rel = relModel ?? relEdge;
  return (
    <aside className="topo-insp" aria-label={G.inspector}>
      {rel && <RelationPanel e={rel} model={model} />}
      {node && <FeaturePanel n={node} graph={graph} model={model} features={features} onSelect={onSelect} onMode={onMode} onExpand={onExpand} />}
      {!rel && !node && <p className="topo-insp__hint">{G.pickHint}</p>}
    </aside>
  );
}

const endpointOf = (model: TModel, id: string, version: string | null) => {
  const n = model.nodes.get(id);
  return (
    <div className="topo-insp__end">
      <strong>{n?.name ?? id}</strong>
      {version ? <Link to={`/features/${id}/${version}`}><code>{`${id}@${version}`}</code></Link> : <code>{`${id} · ${M.unboundVersion}`}</code>}
      {n?.lifecycle && <LifecycleBadge value={n.lifecycle} />}
    </div>
  );
};

/** 선택 관계 — 원천·대상, 판정과 근거, 사전점검 결과, 다음 조치(이전 '선택 관계 설명'의 내용을 옆 칸으로) */
function RelationPanel({ e, model }: { e: TEdge; model: TModel }) {
  const verdict = ['PASS', 'FAIL', 'CONDITIONAL'].includes(e.verdict) ? e.verdict : M.pending;
  return (
    <section className="topo-insp__card topo-motion" aria-label={M.title} data-type={e.type} data-verdict={verdict} data-tone={e.tone}>
      <header className="topo-insp__head">
        <h3>{e.count && e.count > 1 ? G.grouped(e.count) : M.relation(e.id)}</h3>
        <span className="ds-tag">{e.type}</span>
        <VerdictBadge value={verdict === M.pending ? '미판정' : verdict} />
      </header>
      <div className="topo-insp__pair">
        <div><span className="topo-insp__k">{M.source}</span>{endpointOf(model, e.source, e.sourceVersion)}</div>
        <span className="topo-insp__arrow" aria-hidden="true">{RELATION_TYPES[e.type]?.symmetric ? '⇄' : '→'}</span>
        <div><span className="topo-insp__k">{M.target}</span>{endpointOf(model, e.target, e.targetVersion)}</div>
      </div>
      <p className="topo-insp__state">{e.type === 'REQUIRES' ? M.requires : e.type === 'EXCLUDES' ? M.excludes : `${RELATION_TYPES[e.type].label} — ${RELATION_TYPES[e.type].description}`}</p>
      {(e.versionCheck || e.mismatch || e.cycle) && (
        <p className="topo-insp__warn" data-on={!!(e.mismatch || e.cycle) || undefined}>
          {[e.versionCheck ? `${G.versionCheck}: ${e.versionCheck}` : null, e.mismatch ? G.mismatch[e.mismatch] : null, e.cycle ? G.cycle : null].filter(Boolean).join(' · ')}
        </p>
      )}
      <h4>{M.rationale}</h4>
      <p>{e.rationale || M.missingRationale}</p>
      {e.findings.length > 0 && (
        <>
          <h4>{G.findings}</h4>
          <ul className="topo-insp__findings">
            {e.findings.map((f, i) => (
              <li key={i}><VerdictBadge value={f.result} /><span><b>{f.title}</b> {f.message}</span></li>
            ))}
          </ul>
        </>
      )}
      <h4>{M.next}</h4>
      <p>{M.action[verdict as keyof typeof M.action] ?? M.action.pending}</p>
      <Link to="/precheck">{T.precheck}</Link>
      <p className="topo-insp__notice">{M.notice}</p>
    </section>
  );
}

function FeaturePanel({ n, graph, model, features, onSelect, onMode, onExpand }: {
  n: TNode; graph: TModel; model: TModel; features: FeatureRow[];
  onSelect: (next: { feature?: string | null; relation?: string | null }) => void; onMode: (m: Mode) => void; onExpand: (d: string) => void;
}) {
  if (n.agg)
    return (
      <section className="topo-insp__card" aria-label={n.name}>
        <header className="topo-insp__head"><h3>{n.name}</h3></header>
        <p>{G.agg(n.agg.count, n.agg.inner)}</p>
        <button type="button" className="ds-btn" onClick={() => onExpand(n.domain)}>{G.aggOpen}</button>
      </section>
    );
  const latest = features.find((f) => f.featureId === n.id && f.version === n.version);
  const rels = model.edges.filter((e) => e.source === n.id || e.target === n.id);
  const groups: [string, TEdge[]][] = [
    [G.outgoing, rels.filter((e) => e.type === 'REQUIRES' && e.source === n.id)],
    [G.incoming, rels.filter((e) => e.type === 'REQUIRES' && e.target === n.id)],
    [G.excludes, rels.filter((e) => e.type === 'EXCLUDES')],
  ];
  return (
    <section className="topo-insp__card" aria-label={`${G.feature} ${n.id}`}>
      <header className="topo-insp__head">
        <h3>{n.name}</h3>
        {n.lifecycle && <LifecycleBadge value={n.lifecycle} />}
      </header>
      <dl className="topo-insp__facts">
        <dt>{G.feature}</dt>
        <dd>{n.version ? <Link to={`/features/${n.id}/${n.version}`}><code>{`${n.id}@${n.version}`}</code></Link> : <code>{n.id}</code>}{n.versions.length > 1 && ` · ${G.versions(n.versions.length)}`}</dd>
        <dt>{G.domainOf}</dt>
        <dd><span className="topo-chip topo-chip--static" data-domain={n.domain}><span className="topo-chip__sw" aria-hidden="true" />{n.domain}</span> {DOMAIN_NAME[n.domain] ?? ''}</dd>
        <dt>{G.asil}</dt>
        <dd>{n.asil ?? '—'}</dd>
        <dt>{G.col.flags}</dt>
        <dd>{n.flags}</dd>
        {n.ownerId && (<><dt>{G.owner}</dt><dd>{n.ownerId}</dd></>)}
      </dl>
      {latest?.gates && <GateRail statuses={latest.gates as never} />}
      {groups.map(([title, list]) => (
        <div key={title} className="topo-insp__rels">
          <h4>{`${title} · ${list.length}`}</h4>
          {list.length ? (
            <ul>
              {list.map((e) => {
                const other = e.source === n.id ? e.target : e.source;
                const visible = graph.edges.some((g) => g.id === e.id || g.members?.includes(e.id));
                return (
                  <li key={e.id}>
                    <button type="button" className="topo-rel" disabled={!visible} onClick={() => onSelect({ relation: e.id })}>
                      <code>{other}</code>
                      <span>{model.nodes.get(other)?.name ?? other}</span>
                      <VerdictBadge value={e.tone === 'PENDING' ? '미판정' : e.verdict} label={toneLabel(e)} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="topo-insp__hint">{G.noRelations}</p>
          )}
        </div>
      ))}
      <div className="topo-insp__actions">
        <button type="button" className="ds-btn" onClick={() => onMode('impact')}>{G.showImpact}</button>
        <button type="button" className="ds-btn" onClick={() => onMode('path')}>{G.startPath}</button>
        {n.version && <Link className="ds-btn" to={`/features/${n.id}/${n.version}`}>{G.open}</Link>}
      </div>
    </section>
  );
}

/** 표 보기 — 그래프와 같은 Feature·관계를 표로(스크린리더·키보드 사용자용 대체 보기) */
function FeatureTable({ graph, onPick, focus }: { graph: TModel; onPick: (id: string) => void; focus: string | null }) {
  const rows = [...graph.nodes.values()].sort((a, b) => LANE_ORDER.indexOf(a.domain as never) - LANE_ORDER.indexOf(b.domain as never) || (a.id < b.id ? -1 : 1));
  const rel = (id: string, pick: (e: TEdge) => string | null) => graph.edges.map(pick).filter(Boolean).join(', ') || '—';
  return (
    <div className="topo-wb__table">
      <DataTable
        caption={G.table.features}
        rows={rows}
        rowKey={(r) => r.id}
        maxHeight="60vh"
        columns={[
          { key: 'id', header: G.col.id, cell: (r) => <button type="button" className="ds-btn ds-btn--ghost ds-mono" aria-pressed={r.id === focus} onClick={() => onPick(r.id)}>{r.id}</button>, sort: (r) => r.id },
          { key: 'name', header: G.col.name, cell: (r) => r.name, sort: (r) => r.name },
          { key: 'domain', header: G.col.domain, cell: (r) => <span className="topo-chip topo-chip--static" data-domain={r.domain} title={DOMAIN_NAME[r.domain]}><span className="topo-chip__sw" aria-hidden="true" />{r.domain}</span>, sort: (r) => r.domain },
          { key: 'asil', header: G.col.asil, cell: (r) => <span className="ds-mono">{r.asil ?? '—'}</span>, sort: (r) => r.asil ?? '' },
          { key: 'lc', header: G.col.lifecycle, cell: (r) => (r.lifecycle ? <LifecycleBadge value={r.lifecycle} /> : '—'), sort: (r) => r.lifecycle ?? '' },
          { key: 'flags', header: G.col.flags, cell: (r) => r.flags, sort: (r) => r.flags },
          { key: 'gates', header: G.col.gates, cell: (r) => (r.gates.length ? `${r.gatePass}/${r.gates.length}` : '—'), sort: (r) => r.gatePass },
          { key: 'out', header: G.col.out, cell: (r) => <span className="ds-mono">{rel(r.id, (e) => (e.type === 'REQUIRES' && e.source === r.id ? `${e.target} (${e.tone === 'PENDING' ? M.pending : e.verdict})` : null))}</span> },
          { key: 'in', header: G.col.in, cell: (r) => <span className="ds-mono">{rel(r.id, (e) => (e.type === 'REQUIRES' && e.target === r.id ? `${e.source} (${e.tone === 'PENDING' ? M.pending : e.verdict})` : null))}</span> },
          { key: 'ex', header: G.excludes, cell: (r) => <span className="ds-mono">{rel(r.id, (e) => (e.type === 'EXCLUDES' && (e.source === r.id || e.target === r.id) ? (e.source === r.id ? e.target : e.source) : null))}</span> },
        ]}
      />
    </div>
  );
}

function Legend() {
  const L = G.legendItems;
  const line = (tone: string, type: 'REQUIRES' | 'EXCLUDES') => (
    <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden="true" className="topo-legend__svg">
      <path d="M2,7 H40" className="ds-topo-edge" data-type={type} data-tone={tone} />
      {type === 'EXCLUDES' && <path d="M2,2 V12 M42,2 V12" className="topo-legend__tee" />}
      {type === 'REQUIRES' && <path d="M34,3 L42,7 L34,11 Z" className="topo-marker" data-tone={tone} />}
    </svg>
  );
  return (
    <ul className="topo-legend" aria-label={G.legend}>
      <li>{line('PASS', 'REQUIRES')}{L.requires}</li>
      <li>{line('PASS', 'EXCLUDES')}{L.excludes}</li>
      <li>{line('PASS', 'REQUIRES')}{traceCopy.topology.other}</li>
      {(['PASS', 'CONDITIONAL', 'FAIL', 'PENDING'] as const).map((t) => (
        <li key={t}><span className="topo-legend__sw" data-tone={t} aria-hidden="true" />{L[t.toLowerCase() as 'pass']}</li>
      ))}
      <li><span className="topo-legend__note" aria-hidden="true">V</span>{L.mismatch}</li>
      <li><span className="topo-legend__note" aria-hidden="true">↻</span>{L.cycle}</li>
      <li><span className="topo-legend__port" aria-hidden="true" />{L.port}</li>
      <li><span className="topo-legend__gates" aria-hidden="true"><i data-tone="PASS" /><i data-tone="REVIEW" /><i data-tone="UNJUDGED" /><i data-tone="FAIL" /></span>{L.gate}</li>
    </ul>
  );
}
