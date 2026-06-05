import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { users, roles, verbs, permMatrix, orgs, domains, notifications, uiActions, uiRoles, uiPermMatrix } from '../data/refdata';
import { features } from '../data/model';
import { RightPanel } from '../components/patterns';

export function UsersRoles() {
  const [sel, setSel] = useState<any>(null);
  const roleKey = (r: string) => (Object.keys(permMatrix).find(k => r.includes(k.split(' ')[0])) || 'Admin');
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Users & Roles</div>
      <h1 className="page-title">Users & Roles</h1>
      <p className="page-sub">행 클릭 → 사용자 권한 상세</p>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Org</th><th>Status</th></tr></thead>
        <tbody>{users.map(u => (<tr key={u.id} role="button" tabIndex={0} onClick={() => setSel(u)} onKeyDown={e => { if (e.key === 'Enter') setSel(u); }}><td>{u.name}</td><td>{u.role}</td><td>{u.org}</td>
          <td><span className="badge" style={{ background: u.status === 'active' ? 'var(--pass)' : 'var(--pending)' }}>{u.status}</span></td></tr>))}</tbody></table></div></div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.name || ''}>
        {sel && <div>
          <div className="kv"><div>Role</div><div>{sel.role}</div><div>Org</div><div>{sel.org}</div><div>Status</div><div>{sel.status}</div></div>
          <p className="mt small"><b>권한(verb)</b></p>
          <div>{verbs.map(v => <span key={v} className="pill" style={{ marginRight: 4, opacity: (permMatrix[roleKey(sel.role)] || []).includes(v) ? 1 : 0.3 }}>{v}</span>)}</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function PermissionsMatrix() {
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Permissions Matrix</div>
      <h1 className="page-title">Permissions Matrix (Role × Verb)</h1>
      <div className="card" style={{overflowX:'auto'}}>
        <table><thead><tr><th>Role \ Verb</th>{verbs.map(v=><th key={v}>{v}</th>)}</tr></thead>
          <tbody>{roles.map(r=>(<tr key={r}><td><b>{r}</b></td>{verbs.map(v=>(
            <td key={v} style={{textAlign:'center'}}>{permMatrix[r]?.includes(v)?'✅':'−'}</td>))}</tr>))}</tbody></table>
      </div>
      <p className="small muted">domain-scoped 오버라이드 · 검증 P4 approve=Verification Gate only · 변경은 감사 로그</p>

      <h2 className="page-title mt" style={{ fontSize: 16 }}>UI Permission Matrix · Action × Role (S19)</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table><thead><tr><th>Role \ Action</th>{uiActions.map(a => <th key={a}>{a}</th>)}</tr></thead>
          <tbody>{uiRoles.map(r => (<tr key={r}><td><b>{r}</b></td>{uiActions.map(a => (
            <td key={a} style={{ textAlign: 'center' }}>{uiPermMatrix[r]?.includes(a) ? '✅' : '−'}</td>))}</tr>))}</tbody></table>
        <p className="small muted">Audit Event: who·when·object·before/after·reason·evidence_link · 원칙: Evidence-first / No silent write / Explainable decision</p>
      </div>
    </div>
  );
}

export function OrgDomains() {
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Org & Domains</div>
      <h1 className="page-title">Org & Domains</h1>
      <div className="row">
        <div className="col card"><b>Orgs</b><ul>{orgs.map(o=><li key={o}>{o}</li>)}</ul></div>
        <div className="col card"><b>Domains</b><div className="row">{domains.map(d=><span key={d} className="pill">{d}</span>)}</div></div>
      </div>
    </div>
  );
}

export function ApprovalWorkflow() {
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Approval Workflow</div>
      <h1 className="page-title">Approval Workflow Config</h1>
      <div className="card">
        <div className="evt"><span className="pill">Gate 승인</span><span className="muted">Verification Gate → 검증 P4</span></div>
        <div className="evt"><span className="pill">ASIL escalation</span><span className="muted">ASIL-C/D → 안전팀 추가 승인</span></div>
        <div className="evt"><span className="pill">배포 승인</span><span className="muted">Release(deploy) → Governance</span></div>
      </div>
    </div>
  );
}

export function Settings() {
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Settings</div>
      <h1 className="page-title">Settings</h1>
      <div className="card"><div className="kv">
        <div>Tenant</div><div>HMC-Global</div><div>Locale</div><div>한국어 (KO-primary + EN)</div>
        <div>Theme</div><div>Light</div><div>Dev 포트</div><div className="mono">9001 (8000 금지)</div>
      </div></div>
    </div>
  );
}

export function NotificationsCenter() {
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Notifications</div>
      <h1 className="page-title">Notifications Center</h1>
      <div className="card">{notifications.map((n,i)=>(
        <div className="evt" key={i}><span className="pill" style={{background:n.type==='alert'?'var(--fail)':n.type==='task'?'var(--brand)':'',color:n.type==='info'?'':'#fff'}}>{n.type}</span>
          <span>{n.text}</span><span className="muted small" style={{marginLeft:'auto'}}>{n.ts}</span></div>
      ))}</div>
    </div>
  );
}

export function GlobalSearch() {
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">관리자 ▸ Global Search</div>
      <h1 className="page-title">Global Search / Command Palette (⌘K)</h1>
      <div className="card">
        <input placeholder="feat:FEAT-BDC-001 · Run Impact · Create CR …" style={{width:'100%',padding:10,border:'1px solid var(--line)',borderRadius:6}}/>
        <p className="small muted mt">예시 결과:</p>
        {features.slice(0,4).map(f=>(<div className="evt" key={f.id} onClick={()=>nav('/feature/'+f.id)}><span className="mono">{f.id}</span><span className="muted">{f.displayName}</span></div>))}
      </div>
    </div>
  );
}
