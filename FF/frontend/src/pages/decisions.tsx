import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { impact, verification, deploy, supplier, buildDecisionPackage, fmtWon } from '../data/engine';
import { useToast } from '../store';

const FID = 'FEAT-BDC-001';

export function VerificationScope() {
  const v = verification(FID);
  return (
    <div>
      <div className="breadcrumb">의사결정 ▸ Verification Scope</div>
      <h1 className="page-title">Verification Scope</h1>
      <div className="card">
        <p>Mandatory Tests: {v.mandatoryTests.map(t=><span key={t} className="pill" style={{marginRight:4}}>{t}</span>)}</p>
        <p>Missing Evidence: <b style={{color:'var(--pending)'}}>{v.missingEvidence.join(', ')||'없음'}</b></p>
        <p>Gate Result: <span className={`badge status-${v.gateResult}`}>{v.gateResult}</span></p>
      </div>
    </div>
  );
}

export function DeploymentDecision() {
  const [ct, setCt] = useState('Targeting/Policy Rule 변경');
  const d = deploy([ct]);
  const opts = ['Targeting/Policy Rule 변경','Variant Rule 변경','SWC 코드 변경','API/Signal 변경','Calibration 변경'];
  return (
    <div>
      <div className="breadcrumb">의사결정 ▸ Deployment Decision</div>
      <h1 className="page-title">Deployment Decision</h1>
      <div className="card">
        <select value={ct} onChange={e=>setCt(e.target.value)} style={{padding:8}}>{opts.map(o=><option key={o}>{o}</option>)}</select>
        <div className="decision RELEASE mt" style={{background:'#EAF2FF',color:'var(--brand)',border:'1px solid var(--brand)'}}>
          배포 방식: <b>{d.deployType}</b> ({d.confidence}) · 필요 Gate: {d.requiredGates.join(' · ')}
        </div>
        <ul className="small mt">{d.rationale.map((r,i)=><li key={i}>✓ {r}</li>)}</ul>
      </div>
    </div>
  );
}

export function SupplierScope() {
  const s = supplier(FID);
  return (
    <div>
      <div className="breadcrumb">의사결정 ▸ Supplier Scope</div>
      <h1 className="page-title">Supplier Responsibility</h1>
      <div className="card"><div className="kv">
        <div>Supplier Scope</div><div>{s.supplierScope.join(', ')}</div>
        <div>Acceptance</div><div>{s.acceptanceCriteria}</div>
        <div>Contract Gap</div><div>{s.contractGap}</div>
        <div>Evidence</div><div>{s.evidenceStatus}</div>
      </div></div>
    </div>
  );
}

export function DecisionCenter() {
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">의사결정 ▸ Decision Center</div>
      <h1 className="page-title">Decision Center · FEAT-BDC-001</h1>
      <p className="page-sub">Pipeline: Change → Lookup → ①Impact → ②Verify → ③Deploy → ④Supplier → Report</p>
      <div className="card">
        <div className="row">
          {['① Impact','② Verification','③ Deploy','④ Supplier'].map((s,i)=>(
            <button key={s} className="btn" onClick={()=>nav(['/impact','/decisions/verification','/decisions/deploy','/decisions/supplier'][i])}>{s}</button>
          ))}
          <button className="btn primary" onClick={()=>nav('/decisions/report')}>Run All ▶</button>
        </div>
      </div>
    </div>
  );
}

export function DecisionReport() {
  const imp = impact(FID), v = verification(FID), d = deploy(['Targeting/Policy Rule 변경']), s = supplier(FID);
  const pkg = buildDecisionPackage(FID, 'Targeting/Policy Rule 변경', ['Targeting/Policy Rule 변경']);
  const toast = useToast();
  return (
    <div>
      <div className="breadcrumb">의사결정 ▸ DecisionReport</div>
      <h1 className="page-title">DecisionReport (통합)</h1>
      <div className="card">
        <p><b>① Impact</b> — {imp.features.length} Features · {imp.swcs.length} SWC · {imp.suppliers.length} Supplier · {imp.tests.length} Tests</p>
        <p><b>② Verify</b> — Gate {v.gateResult} · Missing {v.missingEvidence.join(', ')||'없음'}</p>
        <p><b>③ Deploy</b> — <span className="pill">{d.deployType}</span> ({d.confidence}) · reason: {d.reasonCodes.join(', ')}</p>
        <p><b>④ Supplier</b> — {s.supplierScope.join(', ')} · Gap {s.contractGap} · Evidence {s.evidenceStatus}</p>
        <div className="card" style={{ background:'var(--surface-2)' }}>
          <b>Decision Package <span className="pill">재현 가능 (immutable snapshot)</span></b>
          <div className="kv small mt">
            <div>decision_id</div><div className="mono">{pkg.decisionId}</div>
            <div>graph_snapshot</div><div className="mono">{pkg.graphSnapshotId}</div>
            <div>required_gates</div><div>{pkg.requiredGates.join(' · ')}</div>
            <div>reason_codes</div><div>{pkg.reasonCodes.map(c=><span key={c} className="pill" style={{marginRight:4}}>{c}</span>)}</div>
            <div>cost_impact</div><div className="mono">{pkg.costImpact ? `${fmtWon(pkg.costImpact.changeWon)} (Binary 대비 절감 ${fmtWon(pkg.costImpact.savingsWon)})` : '-'}</div>
          </div>
        </div>
        <div className="mt"><button className="btn" onClick={() => toast(`${pkg.decisionId} → CR 첨부됨`)}>Attach to CR</button> <button className="btn" onClick={() => toast('DecisionReport PDF Export')}>Export PDF</button> <button className="btn primary" onClick={() => toast('승인 요청 제출', 'ok')}>Submit for Approval</button></div>
      </div>
    </div>
  );
}
