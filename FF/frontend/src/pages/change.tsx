import { useNavigate } from 'react-router-dom';
import { changeSets } from '../data/model';
import { useApp, useToast } from '../store';
import { Donut, Bars, Steps, Timeline, tally, dist } from '../components/charts';

export function CRList() {
  const nav = useNavigate();
  const CRS = useApp().state.crs;
  return (
    <div>
      <div className="breadcrumb">변경관리 ▸ CR List</div>
      <h1 className="page-title">Change Request List</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>Status 분포</b>
          <Donut size={120} center={`${CRS.length}`} segments={dist(tally(CRS, c => c.status))} />
        </div>
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>Risk 분포</b>
          <Donut size={120} segments={dist(tally(CRS, c => c.risk), { High: '#D64545', Med: '#D9822B', Low: '#1F9D55' })} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>유형별 CR 수</b><div className="mt"><Bars data={tally(CRS, c => c.type)} /></div></div>
      </div>
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
        <div className="col card"><b>상태 진행</b>
          <Steps steps={['Draft','Analyzed','Reviewed','Approved','Implemented','Closed']} current={3} />
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
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>변경 유형</b>
          <Donut size={120} center={`${cs.length}`} segments={dist(tally(cs, c => c.type), { ADD: '#1F9D55', MODIFY: '#D9822B' })} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>영역별 변경 수</b><div className="mt"><Bars data={tally(cs, c => c.area)} /></div></div>
      </div>
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
        <Timeline items={[
          { ts: '2026.06', tag: 'v1.1', title: 'ADD 5 / MODIFY 2', detail: '자동 Impact Analysis 트리거 (RULE-R12)' },
          { ts: '2026.05', tag: 'v1.0', title: '최초 Baseline', detail: 'Feature 등록 · BOM 11영역 구성' },
        ]} />
      </div>
    </div>
  );
}
