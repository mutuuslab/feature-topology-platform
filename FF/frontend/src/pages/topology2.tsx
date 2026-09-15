import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { consistency, wouldCycle } from '../data/engine';
import { useApp } from '../store';
import { Donut, Bars, tally, dist } from '../components/charts';
import { SeverityBadge, SeverityLegend, severityMeta } from '../components/ui';
import { Breadcrumb } from '../components/Breadcrumb';

const SEV_COLOR = { Blocking: '#D64545', Warning: '#D9822B', Info: '#3B82F6' };


export function EdgeEditor() {
  const { state, dispatch } = useApp();
  const nav = useNavigate();
  const types = ['parent_of','child_of','composed_of','requires','excludes','overrides','fallback_to','degrades_to','replaces','duplicates'];
  const [source, setSource] = useState('FEAT-BDC-001');
  const [target, setTarget] = useState('FEAT-RUNTIME-001');
  const [type, setType] = useState('requires');
  const [err, setErr] = useState('');

  const save = () => {
    setErr('');
    if (source === target) { setErr('Source와 Target이 동일할 수 없습니다'); return; }
    if (wouldCycle(source, target, type)) { setErr(`EQ1 위반: ${type} 순환(No Cycle) 감지 — 저장 차단`); return; }
    const id = 'E' + (state.edges.length + 1);
    dispatch({ t: 'ADD_EDGE', e: { id, source, target, type: type as any } });
    nav(`/topology/${source}`);
  };

  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Edge Editor (Typed Edge)</h1>
      <div className="card">
        <div className="kv" style={{ maxWidth: 560 }}>
          <div>Source</div><div><select value={source} onChange={e=>setSource(e.target.value)} style={{padding:6,width:'100%'}}>{state.features.map(f=><option key={f.id}>{f.id}</option>)}</select></div>
          <div>Relationship</div><div><select value={type} onChange={e=>setType(e.target.value)} style={{padding:6}}>{types.map(t=><option key={t}>{t}</option>)}</select></div>
          <div>Target</div><div><select value={target} onChange={e=>setTarget(e.target.value)} style={{padding:6,width:'100%'}}>{state.features.map(f=><option key={f.id}>{f.id}</option>)}</select></div>
          <div>Criticality</div><div><select style={{padding:6}}><option>high</option><option>med</option><option>low</option></select></div>
        </div>
        <p className="small muted mt">저장 시 EQ1(No Cycle)·EQ2(Dependency Gate)·EQ3(Conflict)·EQ4(Recovery) 검증 — 순환 시 차단</p>
        {err && <div className="decision HOLD">{err}</div>}
        <button className="btn primary mt" onClick={save}>엣지 저장 (품질 규칙 검증)</button>
        <p className="small muted mt">예: FEAT-RUNTIME-001 → requires → FEAT-BDC-001 추가 시 순환 차단됨</p>
      </div>
      <div className="card"><b>현재 등록된 관계 타입 분포 ({state.edges.length})</b>
        <div className="mt"><Bars data={tally(state.edges, (e: any) => e.type)} /></div>
      </div>
    </div>
  );
}

export function ViolationDetail() {
  const all = consistency();
  const v = all[0];
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Violation Detail</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>전체 위반 Severity</b>
          <Donut size={120} center={`${all.length}`} segments={dist(tally(all, x => severityMeta(x.severity).label), SEV_COLOR)} />
        </div>
        <div className="col card"><b>Rule별 위반</b><div className="mt"><Bars data={tally(all, x => x.rule)} /></div></div>
      </div>
      <div className="card"><b>Severity 범례</b><div className="mt"><SeverityLegend /></div></div>
      <div className="card">
        {v ? <div className="kv">
          <div>Rule</div><div className="mono">{v.rule}</div>
          <div>Feature</div><div className="mono">{v.featureId}</div>
          <div>Severity</div><div><SeverityBadge code={v.severity} /> <span className="muted small">— {severityMeta(v.severity).why}</span></div>
          <div>Message</div><div>{v.message}</div>
          <div>해소</div><div><button className="btn">Open Feature</button> <button className="btn primary">Resolve</button></div>
        </div> : <p className="muted">위반 없음</p>}
      </div>
    </div>
  );
}

