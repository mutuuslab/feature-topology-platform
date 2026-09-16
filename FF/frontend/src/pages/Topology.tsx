import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { topology, getFeature, artifact } from '../data/engine';
import { features } from '../data/model';
import GraphCanvas from '../components/GraphCanvas';
import { RightPanel } from '../components/patterns';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const QUERIES = [
  ['Q1', 'Change Impact'], ['Q2', 'Verification Scope'], ['Q3', 'Deploy Decision'], ['Q4', 'Release Readiness'], ['Q5', 'Recovery Path'],
];

export default function Topology() {
  const { id = 'FEAT-BDC-001' } = useParams();
  const nav = useNavigate();
  const f = getFeature(id);
  const [layout, setLayout] = useState('concentric');
  const [q, setQ] = useState('Q1');
  const [sel, setSel] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [live, setLive] = useState(true);
  const cyRef = useRef<any>(null);
  const raw = topology(id);
  const edgeLabels = [...new Set(raw.edges.map((e: any) => e.data.label))];
  const nodeKinds = [...new Set(raw.nodes.map((n: any) => n.data.type))];
  const el = { nodes: raw.nodes, edges: raw.edges.filter((e: any) => !hidden.has(e.data.label)) };
  const toggle = (lbl: string) => setHidden(h => { const n = new Set(h); n.has(lbl) ? n.delete(lbl) : n.add(lbl); return n; });
  const exportPng = () => {
    if (!cyRef.current) return;
    const png = cyRef.current.png({ full: true, scale: 2, bg: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff' });
    const a = document.createElement('a'); a.href = png; a.download = `topology_${id}.png`; a.click();
  };

  const selFeat = sel ? getFeature(sel) : null;
  const selArt = sel ? artifact(sel) : null;

  return (
    <div>
      <Breadcrumb title={id} />
      <PageTitle fallback="Topology Graph" />
      <p className="page-sub">{f?.displayName} 중심 관계 그래프 — 노드 {raw.nodes.length}개 · 관계 {raw.edges.length}개</p>

      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="small muted">Layout</span>
          <select value={layout} onChange={e => setLayout(e.target.value)} style={{ padding: 6 }}>
            <option value="concentric">concentric</option><option value="breadthfirst">breadthfirst</option><option value="cose">cose(force)</option>
          </select>
          <span className="small muted" style={{ marginLeft: 12 }}>Decision Query</span>
          {QUERIES.map(([k, label]) => (
            <button key={k} className={'btn' + (q === k ? ' primary' : '')} onClick={() => setQ(k)} title={label as string}>{k}</button>
          ))}
          <span className="small muted" style={{ marginLeft: 12 }}>Center</span>
          <select value={id} onChange={e => nav(`/topology/${e.target.value}`)} style={{ padding: 6 }}>
            {features.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
          </select>
          <button className={'btn' + (live ? ' primary' : '')} onClick={() => setLive(v => !v)} style={{ marginLeft: 'auto' }}>{live ? '⏸ 라이브' : '▶ 라이브'}</button>
          <button className="btn" onClick={exportPng}>⤓ PNG</button>
        </div>
        <div className="row mt" style={{ alignItems: 'center', gap: 4 }}>
          <span className="small muted">Edge 필터:</span>
          {edgeLabels.map(lbl => (
            <span key={lbl} className="pill" style={{ cursor: 'pointer', opacity: hidden.has(lbl) ? 0.4 : 1, textDecoration: hidden.has(lbl) ? 'line-through' : 'none' }} onClick={() => toggle(lbl)}>{lbl}</span>
          ))}
        </div>
      </div>

      <GraphCanvas elements={el} layout={layout} live={live} onNodeClick={setSel} onReady={cy => (cyRef.current = cy)} />
      <p className="muted small mt">
        노드 {el.nodes.length} · 엣지 {el.edges.length} · 노드 유형 {nodeKinds.length}종 · 노드 클릭 → Inspector
      </p>

      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel ? `Inspector · ${sel}` : ''}>
        {selFeat && <div className="kv">
          <div>Type</div><div>Feature ({selFeat.level})</div>
          <div>Name</div><div>{selFeat.displayName}</div>
          <div>Lifecycle</div><div>{selFeat.lifecycle}</div>
          <div>Deploy</div><div>{selFeat.deployType}</div>
          <div></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="btn primary" onClick={() => nav(`/feature/${selFeat.id}`)}>상세 →</button>
            <button className="btn" onClick={() => nav(`/topology/${selFeat.id}`)}>중심</button>
            <button className="btn" onClick={() => nav('/impact')}>Impact</button>
            <button className="btn" onClick={() => nav(`/readiness/${selFeat.id}`)}>Readiness</button>
            <button className="btn" onClick={() => nav(`/ops/${selFeat.id}`)}>Ops</button>
          </div>
        </div>}
        {!selFeat && selArt && <div className="kv">
          <div>Type</div><div>{selArt.kind}</div>
          <div>ID</div><div className="mono">{selArt.id}</div>
          <div>Name</div><div>{selArt.displayName}</div>
        </div>}
        {!selFeat && !selArt && <p className="muted">노드 정보 없음</p>}
      </RightPanel>
    </div>
  );
}
