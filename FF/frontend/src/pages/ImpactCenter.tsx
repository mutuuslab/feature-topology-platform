import { useState } from 'react';
import { impact, deploy, verification, supplier, buildDecisionPackage, changeCost, fmtWon } from '../data/engine';

import TopoLink from '../components/TopoLink';
import { Bars, GroupedBars, Steps } from '../components/charts';

const TARGETS = ['API-BDC-POLICY-CONTROL','FEAT-BDC-001','SWC-BDC-ADAPTER'];
const TRACE = ['Feature Master','BOM Baseline','Topology Snapshot','Decision Package','Operations Evidence'];
const AC = ['AC-1 Topology Snapshot 불변 참조', 'AC-2 Decision Package 재현 가능', 'AC-3 필수 Gate/Test 식별', 'AC-4 Operations Evidence 연결'];

export default function ImpactCenter() {
  const [target, setTarget] = useState('API-BDC-POLICY-CONTROL');
  const [res, setRes] = useState<any>(null);
  const run = () => setRes({ impact: impact(target), deploy: deploy(['Targeting/Policy Rule 변경']), verify: verification('FEAT-BDC-001'), supplier: supplier('FEAT-BDC-001'), pkg: buildDecisionPackage('FEAT-BDC-001', target, ['Targeting/Policy Rule 변경']) });

  return (
    <div>
      <div className="breadcrumb">의사결정 / Decisions ▸ Impact Analysis</div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Impact Analysis Center</h1>
        <TopoLink />
      </div>
      <p className="page-sub">변경 대상 → Topology 탐색 → 영향도·검증·배포·협력사 산출</p>
      <div className="card">
        <div className="row" style={{ alignItems:'center' }}>
          <label>Change Target&nbsp;</label>
          <select value={target} onChange={e=>setTarget(e.target.value)} style={{ padding:8 }}>{TARGETS.map(t=><option key={t}>{t}</option>)}</select>
          <span className="muted">Change Type: v1.4 → v1.5 (Optional field added)</span>
          <button className="btn primary" onClick={run}>▶ Run Impact</button>
        </div>
      </div>
      {res && <div className="row">
        <div className="col card">
          <b>Impact Summary</b> <span className="pill">Confidence: {res.impact.confidence}</span>
          <div className="mt"><Bars data={{ Features: res.impact.features.length, SWC: res.impact.swcs.length, ECU: res.impact.ecus.length, Supplier: res.impact.suppliers.length, Test: res.impact.tests.length, Variant: res.impact.variants.length }} /></div>
          <table className="mt"><tbody>
            <tr><td>Impacted Features</td><td>{res.impact.features.length}</td><td className="mono small">{res.impact.features.join(', ')}</td></tr>
            <tr><td>SWCs</td><td>{res.impact.swcs.length}</td><td className="mono small">{res.impact.swcs.join(', ')}</td></tr>
            <tr><td>ECUs</td><td>{res.impact.ecus.length}</td><td className="mono small">{res.impact.ecus.join(', ')}</td></tr>
            <tr><td>Suppliers</td><td>{res.impact.suppliers.length}</td><td className="mono small">{res.impact.suppliers.join(', ')}</td></tr>
            <tr><td>Tests</td><td>{res.impact.tests.length}</td><td className="mono small">{res.impact.tests.join(', ')}</td></tr>
            <tr><td>Variants</td><td>{res.impact.variants.length}</td><td className="small">{res.impact.variants.join(' · ')}</td></tr>
          </tbody></table>
          <p className="small mt">Deployment: {res.impact.deploymentImpact}<br/>Safety/Security: {res.impact.safetySecurity}</p>
        </div>
        <div className="col card">
          <b>Decision Report</b>
          <p className="mt"><b>② Verify</b> — Missing: {res.verify.missingEvidence.join(', ')||'없음'} · Gate: {res.verify.gateResult}</p>
          <p><b>③ Deploy</b> — <span className="pill">{res.deploy.deployType}</span> ({res.deploy.confidence})</p>
          <ul className="small">{res.deploy.rationale.map((r:string,i:number)=><li key={i}>✓ {r}</li>)}</ul>
          <p><b>④ Supplier</b> — {res.supplier.supplierScope.join(', ')} · Gap {res.supplier.contractGap} · Evidence {res.supplier.evidenceStatus}</p>
          <div className="decision RELEASE" style={{ background:'#EAF2FF', color:'var(--brand)', border:'1px solid var(--brand)' }}>
            결론: Optional field 추가 → 구조변경 아님 → <b>Policy-only</b>. 단 3 Test 재실행 + Supplier 호환성 확인.
          </div>
          <div className="card" style={{ background:'var(--surface-2)' }}>
            <b>Decision Package <span className="pill">재현 가능</span></b>
            <div className="kv small mt">
              <div>decision_id</div><div className="mono">{res.pkg.decisionId}</div>
              <div>graph_snapshot</div><div className="mono">{res.pkg.graphSnapshotId}</div>
              <div>reason_codes</div><div>{res.pkg.reasonCodes.map((c:string)=><span key={c} className="pill" style={{marginRight:4}}>{c}</span>)}</div>
            </div>
          </div>
          {(() => { const cc = changeCost(res.impact, res.deploy.deployType); return (
            <div className="card" style={{ background:'var(--surface-2)' }}>
              <b>💰 비용 영향 (SW 개발비, 추정)</b>
              <div className="mt"><GroupedBars rows={[{ label: '변경 개발비 (Binary → 선택방식)', a: cc.binaryWon, b: cc.changeWon }]} fmt={fmtWon} /></div>
              <p className="small mt">절감액 <b className="mono" style={{ color:'var(--pass)' }}>{fmtWon(cc.savingsWon)}</b> (Policy-only 전환)</p>
            </div>); })()}
        </div>
      </div>}

      <div className="card">
        <b>E2E Trace Chain (S20)</b>
        <Steps steps={TRACE} done={!!res} current={res ? undefined : -1} />
        <div className="mt small">{AC.map(a=>(<div key={a} className="evt">{res?'✅':'⬜'} {a}</div>))}</div>
      </div>
    </div>
  );
}
