// /arch/topology — Topology·의존관계 검증 (D01-02, v2, P10-C4). 관계 표·판정, 선택 Feature 주변 관계 그래프(SVG), 관계 등록·판정.
// 그래프: 고른 Feature를 가운데, 관계 거리(1·2·3)마다 동심원에 놓는다. REQUIRES는 실선·화살표, EXCLUDES는 점선(대칭).
import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { topologyMotion as M } from '../../copy/topology-motion';
import { AsyncView, Button, DataTable, ErrorNote, GateBadge, PageHeader, Panel, Segmented, Select, SummaryLine, Toolbar } from '../../design';
import { usePermission } from '../shared';
import './topology-motion.css';

const T = ko.master.topology;

interface Dep {
  dependencyId: string;
  type: 'REQUIRES' | 'EXCLUDES';
  sourceFeatureId: string;
  sourceVersion: string;
  targetFeatureId: string;
  targetVersion: string | null;
  verdict: string;
  rationale: string | null;
}
interface Graph {
  nodes: { id: string; featureId: string; version: string | null; name: string; lifecycle: string | null }[];
  edges: { id: string; source: string; target: string; type: 'REQUIRES' | 'EXCLUDES'; verdict: string }[];
}

/** 미판정·FAIL 관계 — FAIL을 앞에(핵심 메시지 "FAIL 포함"과 그래프 기본 초점이 같은 관계를 가리키게) */
const OPEN = 'open';
const openRelations = (items: Dep[]) => [...items.filter((d) => d.verdict === 'FAIL'), ...items.filter((d) => d.verdict !== 'PASS' && d.verdict !== 'FAIL')];

export function TopologyScreen() {
  const [sp, setSp] = useSearchParams();
  const [depth, setDepth] = useState<'1' | '2' | '3'>('2');
  const [type, setType] = useState('');
  // 판정 필터는 주소에 둔다 — 핵심 메시지 행동(미판정·FAIL만)이 같은 목록을 연다(UX3-04)
  const verdict = sp.get('verdict') ?? '';
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const deps = useApi<{ items: Dep[] }>('dependencies', { query: { type: type || undefined, verdict: verdict && verdict !== OPEN ? verdict : undefined } }, { placeholderData: (p) => p });
  const all = useApi<{ items: Dep[] }>('dependencies');
  const total = all.data?.items ?? [];
  const open = openRelations(total);
  // 그래프 기본 초점 = 첫 미판정·FAIL 관계(S4: 핵심 메시지는 실패를 말하는데 그래프는 초록 관계만 보였다). 관계를 받기 전에는 그리지 않는다
  // 미판정·FAIL이 없으면 첫 관계, 관계가 하나도 없으면(빈 설치) 초점 없음 — 없는 데모 ID를 그리지 않는다(출시 준비 RD-OPS-02)
  const focus = sp.get('feature') ?? (all.data ? (open[0]?.sourceFeatureId ?? total[0]?.sourceFeatureId ?? null) : all.isError ? 'FEAT-00022' : null);
  const selected = sp.get('relation') ?? open.find((d) => d.sourceFeatureId === focus || d.targetFeatureId === focus)?.dependencyId ?? null;
  const graph = useApi<Graph>('topologyGraph', { query: { featureId: focus ?? '', depth } }, { enabled: !!focus });
  const feats = useApi<{ items: { featureId: string; version: string; name: string }[] }>('listFeatures', { query: { latestOnly: true } });
  const rows = (deps.data?.items ?? []).filter((d) => verdict !== OPEN || d.verdict !== 'PASS');
  const C = T.col;
  const openList = new URLSearchParams(sp);
  openList.set('verdict', OPEN);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-02 · Topology · REQUIRES · EXCLUDES"
        title={T.title}
        lead={T.lead}
        message={(() => {
          const fail = total.some((d) => d.verdict === 'FAIL');
          if (!all.data) return { tone: 'neutral', value: '—', text: T.key.open };
          return open.length
            ? {
                tone: fail ? 'danger' : 'warn',
                value: open.length,
                text: fail ? T.key.fail : T.key.open,
                action: (
                  <Link to={{ search: `?${openList}` }} replace onClick={() => document.getElementById('topo-table')?.scrollIntoView?.({ block: 'start' })}>
                    {T.key.show}
                  </Link>
                ),
              }
            : { tone: 'ok', text: T.key.clean };
        })()}
        actions={<Link to="/precheck">{T.precheck}</Link>}
      />
      <SummaryLine
        items={[
          { k: T.kpi.total, v: total.length },
          { k: T.kpi.requires, v: total.filter((d) => d.type === 'REQUIRES').length },
          { k: T.kpi.excludes, v: total.filter((d) => d.type === 'EXCLUDES').length },
        ]}
      />
      <div id="topo-graph"><Panel title={T.graph} id="topo-graph">
        <Toolbar label={T.graph}>
          <Select label={T.focus} value={focus ?? ''} onChange={(e) => setParam('feature', e.target.value)}>
            {focus && !feats.data?.items.some((f) => f.featureId === focus) && <option value={focus}>{focus}</option>}
            {(feats.data?.items ?? []).map((f) => (
              <option key={f.featureId} value={f.featureId}>{`${f.featureId} · ${f.name}`}</option>
            ))}
          </Select>
          <Segmented label={T.depth} options={(['1', '2', '3'] as const).map((v) => ({ value: v, label: v }))} value={depth} onChange={(v) => setDepth(v as typeof depth)} />
        </Toolbar>
        <AsyncView state={focus ? asyncState(graph) : all.data ? 'empty' : 'loading'} error={graph.error} onRetry={() => graph.refetch()}>
          {graph.data && focus && <TopologyGraph data={graph.data} focus={focus} selected={selected} relations={total} onSelect={(id) => setParam('relation', id)} />}
        </AsyncView>
      </Panel></div>
      {/* 핵심 메시지 행동(미판정·FAIL만)이 스크롤해 오는 자리 — Panel은 id를 요소에 두지 않는다 */}
      <div id="topo-table">
      <Panel>
        <Toolbar label={T.verdict}>
          <Select label={T.type} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{T.all}</option>
            <option value="REQUIRES">REQUIRES</option>
            <option value="EXCLUDES">EXCLUDES</option>
          </Select>
          <Select label={T.verdict} value={verdict} onChange={(e) => setParam('verdict', e.target.value)}>
            <option value="">{T.all}</option>
            <option value={OPEN}>{T.openOnly}</option>
            {[...new Set(total.map((d) => d.verdict))].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
        </Toolbar>
        <AsyncView state={asyncState(deps, rows.length === 0)} error={deps.error} onRetry={() => deps.refetch()}>
          <DataTable
            caption={T.title}
            rows={rows}
            rowKey={(r) => r.dependencyId}
            maxHeight="50vh"
            columns={[
              { key: 'i', header: C.id, cell: (r) => <button type="button" className="ds-btn ds-btn--ghost ds-mono" onClick={() => { const n = new URLSearchParams(sp); n.set('feature', r.sourceFeatureId); n.set('relation', r.dependencyId); setSp(n, { replace: true }); document.getElementById('topo-graph')?.scrollIntoView?.({ block: 'start' }); }}>{r.dependencyId}</button> },
              { key: 't', header: C.type, cell: (r) => <span className="ds-tag">{r.type}</span> },
              { key: 's', header: C.source, cell: (r) => <Link to={`/features/${r.sourceFeatureId}/${r.sourceVersion}`} className="ds-mono ds-nowrap">{`${r.sourceFeatureId}@${r.sourceVersion}`}</Link> },
              { key: 'g', header: C.target, cell: (r) => <button type="button" className="ds-btn ds-btn--ghost ds-mono" onClick={() => setParam('feature', r.targetFeatureId)}>{r.targetVersion ? `${r.targetFeatureId}@${r.targetVersion}` : r.targetFeatureId}</button> },
              { key: 'v', header: C.verdict, cell: (r) => <GateBadge status={r.verdict === '미판정' ? null : r.verdict} /> },
              { key: 'r', header: C.rationale, cell: (r) => r.rationale ?? '—' },
            ]}
          />
        </AsyncView>
      </Panel>
      </div>
      <CreateDependency />
    </div>
  );
}

/** 동심원 배치 — 고른 Feature(의 버전들)를 가운데, 관계 거리별로 바깥 원 */
export function TopologyGraph({ data, focus, selected, relations, onSelect }: { data: Graph; focus: string; selected: string | null; relations: Dep[]; onSelect: (id: string) => void }) {
  const nav = useNavigate();
  const active = data.edges.find((e) => e.id === selected) ?? data.edges[0];
  const dense = data.nodes.length > 10;
  const W = 760;
  const H = 420;
  const layout = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of data.edges) {
      adj.set(e.source, (adj.get(e.source) ?? new Set()).add(e.target));
      adj.set(e.target, (adj.get(e.target) ?? new Set()).add(e.source));
    }
    const dist = new Map<string, number>();
    const start = data.nodes.filter((n) => n.featureId === focus).map((n) => n.id);
    start.forEach((id) => dist.set(id, 0));
    const q = [...start];
    while (q.length) {
      const cur = q.shift()!;
      for (const nx of adj.get(cur) ?? []) if (!dist.has(nx)) (dist.set(nx, dist.get(cur)! + 1), q.push(nx));
    }
    const rings = new Map<number, string[]>();
    for (const n of data.nodes) {
      const d = dist.get(n.id) ?? 3;
      rings.set(d, [...(rings.get(d) ?? []), n.id]);
    }
    // 바깥 원까지 라벨 두 줄(시연 모드 큰 글자로 약 58)이 viewBox 안에 들어오게 원 간격을 맞춘다
    const maxD = Math.max(1, ...rings.keys());
    const ring = (d: number) => ((H / 2 - 60) * d) / maxD;
    const pos = new Map<string, { x: number; y: number; up: boolean }>();
    for (const [d, ids] of rings) {
      const r = d === 0 ? (ids.length > 1 ? 40 : 0) : ring(d);
      ids.forEach((id, i) => {
        const a = (2 * Math.PI * i) / ids.length - Math.PI / 2 + d * 0.4;
        // 위쪽 노드는 라벨을 위에 — 가운데로 들어오는 선과 화살표가 라벨을 덮지 않게(바깥쪽에 라벨)
        pos.set(id, { x: W / 2 + r * 1.6 * Math.cos(a), y: H / 2 + r * Math.sin(a), up: d > 0 && Math.sin(a) < -0.2 });
      });
    }
    return pos;
  }, [data, focus]);
  if (!data.edges.length) return <p className="ds-field__hint">{T.noEdges}</p>;
  return (
    <div className="ds-viz">
      {active && <RelationshipMotion key={active.id} edge={active} nodes={data.nodes} relation={relations.find((d) => d.dependencyId === active.id)} />}
      <label className="ds-field ds-field--inline"><span className="ds-field__label">{M.select}</span><select className="ds-input" value={active?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>{data.edges.map((e) => <option key={e.id} value={e.id}>{`${e.id} · ${e.type} · ${e.verdict}`}</option>)}</select></label>
      <details className="topo-overview" open>
      <summary>{M.overview}</summary>
      {dense && <p className="ds-field__hint">{M.dense}</p>}
      <ul className="ds-viz__legend" aria-label={ko.bizTrial.legend}>
        <li><span className="ds-viz__key ds-topo-key" data-type="REQUIRES" aria-hidden="true" />{T.legend.requires}</li>
        <li><span className="ds-viz__key ds-topo-key" data-type="EXCLUDES" aria-hidden="true" />{T.legend.excludes}</li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={`${T.graph} — ${focus}`} className="ds-topo">
        <defs>
          {/* userSpaceOnUse — 선택 관계를 굵게 그려도 화살촉은 같은 크기(선 굵기 2 × 7) */}
          <marker id="topo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="ds-topo-arrow" />
          </marker>
        </defs>
        {data.edges.map((e) => {
          const a = layout.get(e.source);
          const b = layout.get(e.target);
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const pad = 22;
          return (
            <g key={e.id} className="topo-edge-control" role="button" tabIndex={0} aria-label={M.edge(e.id, e.type, e.verdict)} aria-pressed={e.id === active?.id} onClick={() => onSelect(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e.id); } }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="topo-edge-hit" />
            <line
              x1={a.x + (dx / len) * pad}
              y1={a.y + (dy / len) * pad}
              x2={b.x - (dx / len) * pad}
              y2={b.y - (dy / len) * pad}
              className="ds-topo-edge"
              data-type={e.type}
              data-verdict={e.verdict}
              data-selected={e.id === active?.id || undefined}
              markerEnd={e.type === 'REQUIRES' ? 'url(#topo-arrow)' : undefined}
            >
              <title>{`${e.id} ${e.type} ${e.verdict}`}</title>
            </line>
            </g>
          );
        })}
        {data.nodes.map((n) => {
          const p = layout.get(n.id);
          if (!p) return null;
          const isFocus = n.featureId === focus;
          const rad = isFocus ? 20 : 15;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              className="ds-topo-node"
              data-focus={isFocus}
              role={n.version ? 'link' : 'img'}
              tabIndex={n.version ? 0 : undefined}
              aria-label={`${n.id} ${n.name}`}
              onClick={() => n.version && nav(`/features/${n.featureId}/${n.version}`)}
              onKeyDown={(ev) => ev.key === 'Enter' && n.version && nav(`/features/${n.featureId}/${n.version}`)}
            >
              <circle r={rad} />
              <title>{`${n.featureId} ${n.name} ${n.version ?? M.unboundVersion}`}</title>
              {/* 두 줄 간격은 글자 크기(em)를 따른다 — 고정 13px 간격은 시연 모드(큰 글자)에서 6px 겹쳤다(2026-11-05) */}
              {!dense && <text textAnchor="middle">
                <tspan x={0} y={p.up ? -rad - 7 : rad + 2} dy={p.up ? '-1.25em' : '1em'} className="ds-viz__label ds-topo-label">{n.featureId.slice(5)}</tspan>
                <tspan x={0} y={p.up ? -rad - 7 : undefined} dy={p.up ? undefined : '1.3em'} className="ds-viz__muted ds-topo-label">{n.name.length > 12 ? `${n.name.slice(0, 12)}…` : n.name}</tspan>
              </text>}
            </g>
          );
        })}
      </svg>
      </details>
    </div>
  );
}

function RelationshipMotion({ edge, nodes, relation }: { edge: Graph['edges'][number]; nodes: Graph['nodes']; relation?: Dep }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [replay, setReplay] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const uid = useId().replace(/:/g, '');
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const visibility = () => setHidden(document.hidden);
    const preference = () => setReduced(media?.matches ?? false);
    document.addEventListener('visibilitychange', visibility);
    media?.addEventListener('change', preference);
    return () => { document.removeEventListener('visibilitychange', visibility); media?.removeEventListener('change', preference); };
  }, []);
  const source = nodes.find((n) => n.id === edge.source), target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return null;
  const consistent = !!relation && relation.verdict === edge.verdict;
  const verdict = consistent && ['PASS', 'FAIL', 'CONDITIONAL'].includes(edge.verdict) ? edge.verdict : M.pending;
  const running = playing && !hidden && !reduced;
  const endpoint = (node: Graph['nodes'][number], label: string) => <div className="topo-motion__endpoint"><span>{label}</span><strong>{node.name}</strong>{node.version ? <Link to={`/features/${node.featureId}/${node.version}`}><code>{`${node.featureId}@${node.version}`}</code></Link> : <code>{`${node.featureId} · ${M.unboundVersion}`}</code>}<span>{node.lifecycle ?? '—'}</span></div>;
  return <section className="topo-motion" aria-label={M.title} data-type={edge.type} data-verdict={verdict} data-running={running} style={{ '--topo-duration': `${6 / Number(speed)}s` } as CSSProperties}>
    <div className="topo-motion__header"><h3>{M.relation(edge.id)}</h3><div><span className="ds-tag">{edge.type}</span><span>{M.verdict}</span><GateBadge status={verdict === M.pending ? null : verdict} /></div></div>
    <div className="topo-motion__identities">{endpoint(source, M.source)}{endpoint(target, M.target)}</div>
    <svg viewBox="0 0 900 240" className="topo-motion__diagram" role="img" aria-labelledby={`${uid}-title`} data-source={edge.source} data-target={edge.target}>
      <title id={`${uid}-title`}>{M.diagram(source.name, edge.type, target.name)}</title>
      <defs><marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto"><path d="M0 0 L10 5 L0 10 z" className="topo-motion__arrow" /></marker></defs>
      <path d="M110 170 C330 170 570 70 790 70" className="topo-motion__track" markerEnd={edge.type === 'REQUIRES' ? `url(#${uid}-arrow)` : undefined} />
      <circle cx="80" cy="170" r="28" className="topo-motion__node" /><circle cx="820" cy="70" r="28" className="topo-motion__node" />
      {edge.type === 'REQUIRES' && !reduced && <circle key={replay} r="7" className="topo-motion__dot" />}
      {edge.type === 'EXCLUDES' && <g className="topo-motion__exclusion"><circle cx="450" cy="120" r="19" /><path d="M438 108 L462 132 M462 108 L438 132" /></g>}
    </svg>
    <p className="topo-motion__state">{edge.type === 'REQUIRES' ? M.requires : M.excludes}</p>
    {edge.type === 'REQUIRES' && <div className="topo-motion__controls"><button className="ds-btn" type="button" disabled={reduced} onClick={() => setPlaying((p) => !p)}>{playing ? M.pause : M.play}</button><button className="ds-btn" type="button" disabled={reduced} onClick={() => { setReplay((r) => r + 1); setPlaying(true); }}>{M.replay}</button><label>{M.speed}<select className="ds-input" value={speed} disabled={reduced} onChange={(e) => setSpeed(e.target.value)}>{['0.5', '1', '2'].map((value) => <option key={value} value={value}>{`${value}×`}</option>)}</select></label><span className="topo-motion__state" role="status">{reduced ? M.reduced : hidden ? M.suspended : playing ? M.playing : M.paused}</span></div>}
    <p className="topo-motion__notice">{M.notice}</p>
    <div className="topo-motion__evidence"><div><h4>{M.rationale}</h4><p>{!consistent ? M.inconsistent : relation.rationale || M.missingRationale}</p></div><div><h4>{M.next}</h4><p>{M.action[verdict as keyof typeof M.action] ?? M.action.pending}</p><Link to="/precheck">{T.precheck}</Link></div></div>
  </section>;
}

function CreateDependency() {
  const perm = usePermission(['FEATURE_AUTHOR', 'VARIANT_OWNER']);
  const create = useApiMutation<{ dependencyId: string; verdict: string }>('createDependency', ['dependencies', 'topologyGraph', 'events', 'audit']);
  const [f, setF] = useState({ type: 'REQUIRES', sourceFeatureId: '', sourceVersion: '', targetFeatureId: '', targetVersion: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value.trim() }));
  return (
    <Panel title={T.create} id="topo-create">
      <div className="ds-toolbar">
        <Select label={T.type} value={f.type} onChange={set('type')}>
          <option value="REQUIRES">REQUIRES</option>
          <option value="EXCLUDES">EXCLUDES</option>
        </Select>
        {(['sourceFeatureId', 'sourceVersion', 'targetFeatureId', 'targetVersion'] as const).map((k) => (
          <label key={k} className="ds-field ds-field--inline">
            <span className="ds-field__label">{{ sourceFeatureId: T.source, sourceVersion: T.sourceVer, targetFeatureId: T.target, targetVersion: T.targetVer }[k]}</span>
            <input className="ds-input ds-input--mono" value={f[k]} onChange={set(k)} style={{ width: k.endsWith('Version') ? 80 : 120 }} />
          </label>
        ))}
      </div>
      <ErrorNote error={create.error} />
      {create.data && <p className="ds-ok" role="status">{T.done(create.data.dependencyId, create.data.verdict)}</p>}
      <Button variant="primary" disabled={!perm.ok || !f.sourceFeatureId || !f.sourceVersion || !f.targetFeatureId || create.isPending} title={perm.hint} onClick={() => create.mutate({ body: { ...f, targetVersion: f.targetVersion || null } })}>
        {T.submit}
      </Button>
    </Panel>
  );
}
