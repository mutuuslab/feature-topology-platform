// /arch/topology — Topology·의존관계 검증 (D01-02, v2, P10-C4). 관계 표·판정, 선택 Feature 주변 관계 그래프(SVG), 관계 등록·판정.
// 그래프: 고른 Feature를 가운데, 관계 거리(1·2·3)마다 동심원에 놓는다. REQUIRES는 실선·화살표, EXCLUDES는 점선(대칭).
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, GateBadge, PageHeader, Panel, Segmented, Select, SummaryLine, Toolbar } from '../../design';
import { usePermission } from '../shared';

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
  const focus = sp.get('feature') ?? (all.data || all.isError ? (open[0]?.sourceFeatureId ?? 'FEAT-00022') : null);
  const selected = open.find((d) => d.sourceFeatureId === focus || d.targetFeatureId === focus)?.dependencyId ?? null;
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
      <Panel title={T.graph} id="topo-graph">
        <Toolbar label={T.graph}>
          <Select label={T.focus} value={focus ?? ''} onChange={(e) => setParam('feature', e.target.value)}>
            {focus && !feats.data?.items.some((f) => f.featureId === focus) && <option value={focus}>{focus}</option>}
            {(feats.data?.items ?? []).map((f) => (
              <option key={f.featureId} value={f.featureId}>{`${f.featureId} · ${f.name}`}</option>
            ))}
          </Select>
          <Segmented label={T.depth} options={(['1', '2', '3'] as const).map((v) => ({ value: v, label: v }))} value={depth} onChange={(v) => setDepth(v as typeof depth)} />
        </Toolbar>
        <AsyncView state={focus ? asyncState(graph) : 'loading'} error={graph.error?.message} onRetry={() => graph.refetch()}>
          {graph.data && focus && <TopologyGraph data={graph.data} focus={focus} selected={selected} />}
        </AsyncView>
      </Panel>
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
        <AsyncView state={asyncState(deps, rows.length === 0)} error={deps.error?.message} onRetry={() => deps.refetch()}>
          <DataTable
            caption={T.title}
            rows={rows}
            rowKey={(r) => r.dependencyId}
            maxHeight="50vh"
            columns={[
              { key: 'i', header: C.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.dependencyId}</span> },
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
function TopologyGraph({ data, focus, selected }: { data: Graph; focus: string; selected: string | null }) {
  const nav = useNavigate();
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
    // 바깥 원까지 라벨 두 줄(약 50)이 viewBox 안에 들어오게 원 간격을 맞춘다
    const maxD = Math.max(1, ...rings.keys());
    const ring = (d: number) => ((H / 2 - 56) * d) / maxD;
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
      <ul className="ds-viz__legend" aria-label={ko.bizTrial.legend}>
        <li><span className="ds-viz__key ds-topo-key" data-type="REQUIRES" aria-hidden="true" />{T.legend.requires}</li>
        <li><span className="ds-viz__key ds-topo-key" data-type="EXCLUDES" aria-hidden="true" />{T.legend.excludes}</li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={`${T.graph} — ${focus}`} className="ds-topo">
        <defs>
          <marker id="topo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
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
            <line
              key={e.id}
              x1={a.x + (dx / len) * pad}
              y1={a.y + (dy / len) * pad}
              x2={b.x - (dx / len) * pad}
              y2={b.y - (dy / len) * pad}
              className="ds-topo-edge"
              data-type={e.type}
              data-verdict={e.verdict}
              data-selected={e.id === selected || undefined}
              markerEnd={e.type === 'REQUIRES' ? 'url(#topo-arrow)' : undefined}
            >
              <title>{`${e.id} ${e.type} ${e.verdict}`}</title>
            </line>
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
              role="link"
              tabIndex={0}
              aria-label={`${n.id} ${n.name}`}
              onClick={() => n.version && nav(`/features/${n.featureId}/${n.version}`)}
              onKeyDown={(ev) => ev.key === 'Enter' && n.version && nav(`/features/${n.featureId}/${n.version}`)}
            >
              <circle r={rad} />
              <text y={p.up ? -rad - 20 : rad + 14} textAnchor="middle" className="ds-viz__label ds-topo-label">{n.featureId.slice(5)}</text>
              <text y={p.up ? -rad - 7 : rad + 27} textAnchor="middle" className="ds-viz__muted ds-topo-label">{n.name.length > 12 ? `${n.name.slice(0, 12)}…` : n.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CreateDependency() {
  const perm = usePermission(['FEATURE_AUTHOR', 'VARIANT_OWNER']);
  const create = useApiMutation<{ dependencyId: string; verdict: string }>('createDependency', ['dependencies', 'topologyGraph', 'events', 'audit']);
  const [f, setF] = useState({ type: 'REQUIRES', sourceFeatureId: '', sourceVersion: '', targetFeatureId: '', targetVersion: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value.trim() }));
  if (STATIC_MODE) return null;
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
