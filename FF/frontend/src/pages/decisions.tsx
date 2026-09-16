import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { impact, verification, deploy, supplier, buildDecisionPackage, fmtWon } from '../data/engine';
import { useToast, useApp } from '../store';
import { Donut, Bars, RadialProgress, Steps, GroupedBars } from '../components/charts';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const FID = 'FEAT-BDC-001';

export function VerificationScope() {
  const v = verification(FID);
  const covered = v.mandatoryTests.length - v.missingEvidence.length;
  return (
    <div>
      <Breadcrumb />
      <PageTitle fallback="Verification Scope" />
      <div className="row">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>증적 커버리지</b>
          <RadialProgress size={120} color={v.gateResult === 'PASS' ? '#1F9D55' : '#D9822B'} value={Math.round(covered / (v.mandatoryTests.length || 1) * 100)} label={`${covered}/${v.mandatoryTests.length} 증적`} />
        </div>
        <div className="col card" style={{ alignItems: 'center', maxWidth: 220 }}><b>증적 상태</b>
          <Donut size={120} segments={[{ label: '확보', value: covered, color: '#1F9D55' }, { label: 'Missing', value: v.missingEvidence.length, color: '#D9822B' }]} />
        </div>
        <div className="col card">
          <p>Mandatory Tests: {v.mandatoryTests.map(t=><span key={t} className="pill" style={{marginRight:4}}>{t}</span>)}</p>
          <p>Missing Evidence: <b style={{color:'var(--pending)'}}>{v.missingEvidence.join(', ')||'없음'}</b></p>
          <p>Gate Result: <span className={`badge status-${v.gateResult}`}>{v.gateResult}</span></p>
        </div>
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
      <Breadcrumb />
      <PageTitle fallback="Deployment Decision" />
      <div className="card">
        <select value={ct} onChange={e=>setCt(e.target.value)} style={{padding:8}}>{opts.map(o=><option key={o}>{o}</option>)}</select>
        <div className="decision RELEASE mt" style={{background:'#EAF2FF',color:'var(--brand)',border:'1px solid var(--brand)'}}>
          배포 방식: <b>{d.deployType}</b> ({d.confidence})
        </div>
        {d.requiredGates.length > 0 && <div className="mt"><b className="small">필요 Gate</b><Steps steps={d.requiredGates} current={0} /></div>}
        <ul className="small mt">{d.rationale.map((r,i)=><li key={i}>✓ {r}</li>)}</ul>
      </div>
    </div>
  );
}

export function SupplierScope() {
  const s = supplier(FID);
  return (
    <div>
      <Breadcrumb />
      <PageTitle fallback="Supplier Responsibility" />
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
      <Breadcrumb />
      <PageTitle fallback="Decision Center" detail="FEAT-BDC-001" />
      <p className="page-sub">Pipeline: Change → Lookup → ①Impact → ②Verify → ③Deploy → ④Supplier → Report</p>
      <div className="card">
        <Steps steps={['Change', 'Lookup', '① Impact', '② Verify', '③ Deploy', '④ Supplier', 'Report']} current={1} />
      </div>
      <div className="card">
        <b>단계별 바로가기</b>
        <div className="row mt">
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
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const newCrId = () => `CR-2026-0${143 + state.crs.filter(c => c.id.startsWith('CR-2026')).length}`;
  const attach = () => { const id = newCrId(); dispatch({ t: 'CREATE_CR', cr: { id, feature: FID, type: 'DecisionReport 첨부', status: 'Analyzed', owner: state.role, risk: d.deployType === 'Binary' ? 'High' : 'Low' } }); dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 09:40', actor: state.role, action: 'DECISION_ATTACH', target: id, detail: pkg.decisionId } }); toast(`${id}에 ${pkg.decisionId} 첨부됨`, 'ok'); nav('/change/cr/' + id); };
  const submit = () => { const id = newCrId(); dispatch({ t: 'CREATE_CR', cr: { id, feature: FID, type: '승인 요청', status: 'Reviewed', owner: state.role, risk: 'Low' } }); toast(`${id} 승인 요청 제출 (Reviewed)`, 'ok'); nav('/change/cr/' + id); };
  const exportReport = () => {
    const md = `# DecisionReport ${pkg.decisionId}\n\n- Feature: ${FID}\n- Impact: ${imp.features.length} Features / ${imp.swcs.length} SWC / ${imp.suppliers.length} Supplier / ${imp.tests.length} Tests\n- Verify: Gate ${v.gateResult} (Missing ${v.missingEvidence.join(', ') || '없음'})\n- Deploy: ${d.deployType} (${d.confidence}) · reason ${d.reasonCodes.join(', ')}\n- Supplier: ${s.supplierScope.join(', ')} · Gap ${s.contractGap}\n- graph_snapshot: ${pkg.graphSnapshotId}\n- required_gates: ${pkg.requiredGates.join(' · ')}\n- cost_impact: ${pkg.costImpact ? `${pkg.costImpact.changeWon} (절감 ${pkg.costImpact.savingsWon})` : '-'}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${pkg.decisionId}.md`; a.click(); URL.revokeObjectURL(url);
    toast('DecisionReport 내보내기(.md)', 'ok');
  };
  return (
    <div>
      <Breadcrumb />
      <PageTitle fallback="DecisionReport (통합)" />
      <div className="card">
        <Steps steps={['Impact', 'Verify', 'Deploy', 'Supplier', 'Package']} done />
      </div>
      <div className="row">
        <div className="col card"><b>① Impact 영향 범위</b>
          <div className="mt"><Bars data={{ Features: imp.features.length, SWC: imp.swcs.length, Supplier: imp.suppliers.length, Test: imp.tests.length }} /></div>
        </div>
        {pkg.costImpact && <div className="col card"><b>💰 비용 (Binary → {d.deployType})</b>
          <div className="mt"><GroupedBars rows={[{ label: '변경 개발비', a: pkg.costImpact.binaryWon, b: pkg.costImpact.changeWon }]} fmt={fmtWon} /></div>
          <p className="small">절감 <b className="mono" style={{ color: 'var(--pass)' }}>{fmtWon(pkg.costImpact.savingsWon)}</b></p>
        </div>}
      </div>
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
        <div className="mt"><button className="btn" onClick={attach}>Attach to CR</button> <button className="btn" onClick={exportReport}>Export (.md)</button> <button className="btn primary" onClick={submit}>Submit for Approval</button></div>
      </div>
    </div>
  );
}
