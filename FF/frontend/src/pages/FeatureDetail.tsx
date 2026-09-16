import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as M from '../data/model';
import * as E from '../data/engine';
import { LifecycleBadge, DeployBadge, Health } from '../components/ui';
import TopoLink from '../components/TopoLink';
import { GaugeArc, RadialProgress, Donut } from '../components/charts';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const TABS = ['Summary','Taxonomy','BOM','Topology','Variants','Control','Deploy','Verify','Supplier','Ops','History'];

export default function FeatureDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState('Summary');
  const f = E.getFeature(id);
  if (!f) return <div className="card">Feature를 찾을 수 없습니다: {id}</div>;
  const rels = E.relationsOf(id);
  const tel = M.telemetry[id];
  const v = E.verification(id);

  return (
    <div>
      <Breadcrumb title={f.id} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <PageTitle fallback={<span className="mono">{f.id}</span>} detail={f.displayName} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><TopoLink id={f.id} /><LifecycleBadge value={f.lifecycle} /></div>
      </div>
      <div className="row">
        <div className="col" style={{ flex: 3 }}>
          <div className="tabs">
            {TABS.map(t => <button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}
          </div>
          <div className="card">
            {tab==='Summary' && <div className="kv">
              <div>Level</div><div>{f.level} Vehicle/System</div>
              <div>Domain</div><div>{f.domain}</div>
              <div>Owner</div><div>{f.ownerOrg}</div>
              <div>Deployment</div><div><DeployBadge value={f.deployType} /></div>
              <div>Safety / Security</div><div>{f.safety} / {f.security}</div>
              <div>Baseline</div><div className="mono">{f.baselineVer}</div>
              <div>SW 개발비(추정)</div><div>예상 {E.featureCost(id).estMM} M/M · <b className="mono">{E.fmtWon(E.featureCost(id).estWon)}</b> / 실적 <span className="mono">{E.featureCost(id).actualWon ? E.fmtWon(E.featureCost(id).actualWon) : '-'}</span></div>
              <div>조직별 명칭</div><div className="small">{Object.entries(f.internalAlias||{}).map(([k,val])=>`${k}: ${val}`).join(' · ')||'-'}</div>
            </div>}
            {tab==='Taxonomy' && <div>L0 Body Comfort → L1 Remote Door Lock → <b>L2 {f.displayName}</b> → L3 SW → L4 Control Point → L5 Signal</div>}
            {tab==='BOM' && <table><thead><tr><th>관계</th><th>Artifact</th><th>Kind</th></tr></thead><tbody>
              {rels.map(r=>{const n=E.artifact(r.target)||E.artifact(r.source);return <tr key={r.id}><td>{r.type}</td><td className="mono">{n?.id}</td><td>{n?.kind}</td></tr>;})}
            </tbody></table>}
            {tab==='Topology' && <div><button className="btn primary" onClick={()=>nav(`/topology/${id}`)}>전체 그래프 열기 →</button>
              <ul className="mt small">{E.edgesOf(id).map(e=><li key={e.id} className="mono">{e.source} —{e.type}→ {e.target}</li>)}</ul></div>}
            {tab==='Variants' && <div><button className="btn" onClick={()=>nav(`/variants/${id}`)}>Variant Matrix 열기 →</button><p className="small mt">KR/EU · MY2027+ · Premium · Gen3 · SW≥3.2.0</p></div>}
            {tab==='Control' && <div className="kv"><div>Policy</div><div>POLICY-BDC-ENABLE</div><div>Kill Switch</div><div>CP-BDC-001-KILL</div><div>Safe Default</div><div>disabled</div></div>}
            {tab==='Deploy' && <div>현재 Deploy Type: <DeployBadge value={f.deployType}/> · <button className="btn" onClick={()=>nav('/impact')}>Deployment Decision →</button></div>}
            {tab==='Verify' && <div className="row" style={{ alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}><RadialProgress size={110} color="#0EA5E9" value={Math.round((v.mandatoryTests.length-v.missingEvidence.length)/(v.mandatoryTests.length||1)*100)} label="검증 커버리지" /></div>
              <div style={{ flex: 1 }}>Coverage {v.mandatoryTests.length-v.missingEvidence.length}/{v.mandatoryTests.length} · Missing: {v.missingEvidence.join(', ')||'없음'}
              <div className="mt"><button className="btn" onClick={()=>nav(`/readiness/${id}`)}>Release Readiness →</button></div></div></div>}
            {tab==='Supplier' && <div className="kv"><div>Supplier</div><div>{E.supplier(id).supplierScope.join(', ')}</div><div>Contract Gap</div><div>{E.supplier(id).contractGap}</div><div>Evidence</div><div>{E.supplier(id).evidenceStatus}</div></div>}
            {tab==='Ops' && (tel ? <div className="row" style={{ alignItems: 'center' }}>
              <GaugeArc value={+(tel.activationSuccess*100).toFixed(1)} size={130} label="활성화율" />
              <div style={{ flex: 1 }}><div className="kv"><div>Activation</div><div>{(tel.activationSuccess*100).toFixed(1)}%</div><div>Fail</div><div>{tel.policyApplyFail}</div><div>Rollback</div><div>{tel.rollbackCount}</div></div>
              <button className="btn mt" onClick={()=>nav(`/ops/${id}`)}>Ops Dashboard →</button></div></div> : <span className="muted">운영 데이터 없음</span>)}
            {tab==='History' && <table><thead><tr><th>Type</th><th>Area</th><th>변경</th></tr></thead><tbody>
              {(M.changeSets[id]||[]).map((c,i)=><tr key={i}><td>{c.type}</td><td>{c.area}</td><td>{c.detail}</td></tr>)}
            </tbody></table>}
          </div>
        </div>
        <div className="col">
          <div className="card">
            <b>Quick Actions</b>
            <div className="mt" style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button className="btn primary" onClick={()=>nav('/impact')}>Run Impact</button>
              <button className="btn" onClick={()=>nav(`/readiness/${id}`)}>Release Readiness</button>
              <button className="btn" onClick={()=>nav(`/ops/${id}`)}>Ops · Kill Switch</button>
            </div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <b style={{ display: 'block', textAlign: 'left' }}>Traceability Health</b>
            <GaugeArc value={E.health(id)} size={140} label="Health" />
            <div className="mt small" style={{ textAlign: 'left' }}>
              {[['Requirement', rels.some(r=>r.type==='derives')],['Test', v.gateResult==='PASS'],['Supplier', rels.some(r=>r.type==='realized_by')],['Variant', rels.some(r=>r.type==='applies_to')],['Rollback', E.edgesOf(id).some(e=>e.type==='fallback_to')],['Telemetry', !!tel]].map(([k,ok])=>(
                <div key={k as string}>{ok?'✅':'⚠️'} {k}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
