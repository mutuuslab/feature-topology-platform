import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { impact, verification, deploy, supplier, buildDecisionPackage, fmtWon } from '../data/engine';
import { useApp } from '../store';
import { Steps, Bars } from '../components/charts';

const STEPS = ['Define', 'Topology Lookup', 'Run Decisions', 'Review Report', 'Submit'];

export default function CRWizard() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const features = state.features;
  const [step, setStep] = useState(0);
  const [feature, setFeature] = useState('FEAT-BDC-001');
  const [changeType, setChangeType] = useState('Targeting/Policy Rule 변경');

  const imp = impact(feature);
  const ver = verification(feature);
  const dep = deploy([changeType]);
  const sup = supplier(feature);
  const pkg = buildDecisionPackage(feature, changeType, [changeType]);

  const submit = () => {
    const n = 143 + state.crs.filter(c => c.id.startsWith('CR-2026')).length;
    const cr = { id: `CR-2026-0${n}`, feature, type: changeType, status: 'Reviewed', owner: state.role, risk: dep.deployType === 'Binary' ? 'High' : 'Low' };
    dispatch({ t: 'CREATE_CR', cr });
    dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 08:31', actor: state.role, action: 'CREATE_CR', target: feature, detail: cr.id } });
    nav('/change/cr');
  };

  return (
    <div>
      <div className="breadcrumb">변경관리 / Change Mgmt ▸ CR Wizard</div>
      <h1 className="page-title">Change Request Wizard</h1>
      <p className="page-sub">변경 요청 → Topology → Impact → Verify → Deploy → Supplier → Submit</p>

      <div className="card">
        <Steps steps={STEPS} current={step} />
        <div style={{ marginBottom: 12 }} />

        {step===0 && <div>
          <div className="kv" style={{maxWidth:520}}>
            <div>대상 Feature</div>
            <div><select value={feature} onChange={e=>setFeature(e.target.value)} style={{padding:6,width:'100%'}}>{features.map(f=><option key={f.id} value={f.id}>{f.id} · {f.displayName}</option>)}</select></div>
            <div>변경 유형</div>
            <div><select value={changeType} onChange={e=>setChangeType(e.target.value)} style={{padding:6,width:'100%'}}>
              <option>Targeting/Policy Rule 변경</option><option>Variant Rule 변경</option><option>SWC 코드 변경</option><option>API/Signal 변경</option><option>Calibration 변경</option>
            </select></div>
          </div>
        </div>}

        {step===1 && <div>
          <b>Topology Lookup · 영향 미리보기</b>
          <div className="mt" style={{ maxWidth: 460 }}><Bars data={{ Features: imp.features.length, SWC: imp.swcs.length, Supplier: imp.suppliers.length, Test: imp.tests.length }} /></div>
          <div className="mono small mt">{[...imp.features, ...imp.swcs, ...imp.suppliers].join(' · ')}</div>
        </div>}

        {step===2 && <div>
          <b>Run Decisions</b>
          <ul className="small mt">
            <li>① Impact: {imp.features.length} Features · {imp.tests.length} Tests</li>
            <li>② Verify: Gate {ver.gateResult} · Missing {ver.missingEvidence.join(', ')||'없음'}</li>
            <li>③ Deploy: <span className="pill">{dep.deployType}</span> ({dep.confidence})</li>
            <li>④ Supplier: {sup.supplierScope.join(', ')} · Gap {sup.contractGap}</li>
          </ul>
        </div>}

        {step===3 && <div>
          <b>DecisionReport</b>
          <div className="decision RELEASE" style={{background:'#EAF2FF',color:'var(--brand)',border:'1px solid var(--brand)'}}>
            {feature} · {changeType} → <b>{dep.deployType}</b> · 필요 Gate: {dep.requiredGates.join(' · ')}
          </div>
          <ul className="small mt">{dep.rationale.map((r,i)=><li key={i}>✓ {r}</li>)}</ul>
          <div className="card" style={{background:'var(--surface-2)'}}>
            <b>Decision Package <span className="pill">재현 가능</span></b>
            <div className="kv mt small">
              <div>decision_id</div><div className="mono">{pkg.decisionId}</div>
              <div>graph_snapshot</div><div className="mono">{pkg.graphSnapshotId}</div>
              <div>reason_codes</div><div>{pkg.reasonCodes.map(c=><span key={c} className="pill" style={{marginRight:4}}>{c}</span>)}</div>
              <div>evidence_links</div><div className="mono">{pkg.evidenceLinks.join(', ')}</div>
              <div>cost_impact</div><div className="mono">{pkg.costImpact ? `${fmtWon(pkg.costImpact.changeWon)} · 절감 ${fmtWon(pkg.costImpact.savingsWon)}` : '-'}</div>
            </div>
          </div>
        </div>}

        {step===4 && <div>
          <b>Submit for Approval</b>
          <p className="small mt">승인자 라우팅(SCR-A20). ASIL 등급 시 추가 승인.</p>
          <button className="btn primary" onClick={submit}>제출 / Submit → CR 생성</button>
        </div>}

        <div className="mt" style={{display:'flex',gap:8}}>
          <button className="btn" disabled={step===0} onClick={()=>setStep(s=>s-1)}>← 이전</button>
          {step<STEPS.length-1
            ? <button className="btn primary" onClick={()=>setStep(s=>s+1)}>다음 →</button>
            : <button className="btn" onClick={()=>nav('/impact')}>Impact Center 보기</button>}
        </div>
      </div>
    </div>
  );
}
