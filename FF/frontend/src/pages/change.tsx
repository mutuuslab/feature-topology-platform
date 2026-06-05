import { useNavigate } from 'react-router-dom';
import { changeSets } from '../data/model';
import { useApp, useToast } from '../store';

export function CRList() {
  const nav = useNavigate();
  const CRS = useApp().state.crs;
  return (
    <div>
      <div className="breadcrumb">변경관리 ▸ CR List</div>
      <h1 className="page-title">Change Request List</h1>
      <div className="card"><table><thead><tr><th>CR</th><th>Feature</th><th>유형</th><th>Status</th><th>Owner</th><th>Risk</th></tr></thead>
        <tbody>{CRS.map(c=>(<tr key={c.id} onClick={()=>nav('/change/cr/'+c.id)}>
          <td className="mono">{c.id}</td><td className="mono">{c.feature}</td><td>{c.type}</td>
          <td><span className="pill">{c.status}</span></td><td>{c.owner}</td>
          <td><span className="badge" style={{background:c.risk==='High'?'var(--fail)':c.risk==='Med'?'var(--pending)':'var(--pass)'}}>{c.risk}</span></td></tr>))}</tbody></table></div>
    </div>
  );
}

export function CRDetail() {
  const nav = useNavigate();
  const { can } = useApp();
  const toast = useToast();
  return (
    <div>
      <div className="breadcrumb">변경관리 ▸ CR Detail</div>
      <h1 className="page-title">CR-2026-0142 · FEAT-BDC-001</h1>
      <div className="row">
        <div className="col card"><b>상태</b>
          <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>{['Draft','Analyzed','Reviewed','Approved','Implemented','Closed'].map((s,i)=><span key={s} className="pill" style={{background:i<=2?'var(--brand)':'',color:i<=2?'#fff':''}}>{s}</span>)}</div>
          <p className="small mt">변경: Targeting Rule (SWC/API 무변경) → Policy-only</p>
          <button className="btn primary mt" onClick={()=>nav('/decisions/report')}>DecisionReport 보기</button>
        </div>
        <div className="col card"><b>승인</b><p className="small">승인자: 정하늘(Admin)</p>
          {can('approve')
            ? <><button className="btn primary" onClick={() => toast('CR 승인됨 → Implemented', 'ok')}>승인 / Approve</button> <button className="btn" onClick={() => toast('CR 반려됨', 'warn')}>반려</button></>
            : <span className="btn" style={{ opacity: .45, cursor: 'not-allowed' }} title="권한 필요: approve">🔒 승인 권한 없음</span>}
        </div>
      </div>
    </div>
  );
}

export function ChangeSetList() {
  const cs = changeSets['FEAT-BDC-001'] || [];
  return (
    <div>
      <div className="breadcrumb">변경관리 ▸ ChangeSet</div>
      <h1 className="page-title">ChangeSet · FEAT-BDC-001 (v1.0→v1.1)</h1>
      <div className="card"><table><thead><tr><th>Type</th><th>Area</th><th>변경 내용</th></tr></thead>
        <tbody>{cs.map((c,i)=>(<tr key={i}><td><span className="pill" style={{background:c.type==='ADD'?'var(--pass)':'var(--pending)',color:'#fff'}}>{c.type}</span></td><td>{c.area}</td><td>{c.detail}</td></tr>))}</tbody></table>
        <div className="decision RELEASE mt" style={{background:'#EAF2FF',color:'var(--brand)',border:'1px solid var(--brand)'}}>ADD {cs.filter(c=>c.type==='ADD').length} · MODIFY {cs.filter(c=>c.type==='MODIFY').length} → ⚡ Impact Analysis 자동 트리거 (RULE-R12)</div>
      </div>
    </div>
  );
}

export function BaselineDiff() {
  const cs = changeSets['FEAT-BDC-001'] || [];
  return (
    <div>
      <div className="breadcrumb">변경관리 ▸ Baseline Diff</div>
      <h1 className="page-title">Baseline Diff — v1.0 ↔ v1.1</h1>
      <div className="card">{cs.map((c,i)=>(
        <div key={i} className="evt"><span className="pill" style={{background:c.type==='ADD'?'var(--pass)':'var(--pending)',color:'#fff'}}>{c.type==='ADD'?'➕':'✏'} {c.type}</span><b>{c.area}</b><span className="muted">{c.detail}</span></div>
      ))}</div>
    </div>
  );
}

export function VersionTimeline() {
  return (
    <div>
      <div className="breadcrumb">변경관리 ▸ Version Timeline</div>
      <h1 className="page-title">Version Timeline · FEAT-BDC-001</h1>
      <div className="card">
        <div className="evt"><span className="pill">v1.1</span><span className="muted">2026.06 · ADD 5 / MODIFY 2 · 자동 Impact</span></div>
        <div className="evt"><span className="pill">v1.0</span><span className="muted">2026.05 · 최초 Baseline</span></div>
      </div>
    </div>
  );
}
