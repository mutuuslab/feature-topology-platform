import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectors, syncLogs } from '../data/refdata';
import { RightPanel } from '../components/patterns';

export function ConnectorHub() {
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">연동 ▸ Connector Hub</div>
      <h1 className="page-title">Connector Hub</h1>
      <div className="row">{connectors.map(c=>(
        <div className="col card" key={c.id} style={{minWidth:240}} onClick={()=>nav('/integration/connector/'+c.id)}>
          <div style={{display:'flex',justifyContent:'space-between'}}><b>{c.name}</b>
            <span className="dot" style={{background:c.status==='connected'?'var(--pass)':c.status==='degraded'?'var(--pending)':'var(--fail)'}}/></div>
          <p className="small muted">{c.proto} · {c.dir}</p>
          <p className="small">last sync: {c.lastSync}</p>
        </div>
      ))}</div>
    </div>
  );
}

export function ConnectorDetail() {
  const c = connectors[0];
  return (
    <div>
      <div className="breadcrumb">연동 ▸ Connector Detail</div>
      <h1 className="page-title">{c.name}</h1>
      <div className="card"><div className="kv">
        <div>Protocol</div><div>{c.proto}</div><div>Direction</div><div>{c.dir}</div>
        <div>Auth</div><div>OAuth2</div><div>Field Mapping</div><div>Requirement ↔ BOM(Requirement 영역)</div>
        <div>충돌 해소</div><div>source-of-record 우선 · timestamp · 수동 검토 큐</div>
      </div></div>
    </div>
  );
}

export function SyncLogs() {
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="breadcrumb">연동 ▸ Sync Logs</div>
      <h1 className="page-title">Sync Logs</h1>
      <p className="page-sub">양방향 동기화 이력 · 행 클릭 → 상세</p>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Time</th><th>Connector</th><th>Event</th><th>Status</th></tr></thead>
        <tbody>{syncLogs.map((l, i) => (<tr key={i} role="button" tabIndex={0} onClick={() => setSel(l)} onKeyDown={e => { if (e.key === 'Enter') setSel(l); }}><td>{l.ts}</td><td className="mono">{l.conn}</td><td>{l.event}</td>
          <td><span className="badge" style={{ background: l.status === 'ok' ? 'var(--pass)' : 'var(--pending)' }}>{l.status}</span></td></tr>))}</tbody></table></div></div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.conn} sync` : ''}>
        {sel && <div className="kv">
          <div>Time</div><div>{sel.ts}</div><div>Connector</div><div className="mono">{sel.conn}</div>
          <div>Event</div><div>{sel.event}</div><div>Status</div><div><span className="badge" style={{ background: sel.status === 'ok' ? 'var(--pass)' : 'var(--pending)' }}>{sel.status}</span></div>
          <div>처리</div><div className="small">{sel.status === 'retry' ? 'outbox 재시도 큐 — 충돌 해소 대기' : 'Feature ID 기준 양방향 반영 완료'}</div>
        </div>}
      </RightPanel>
    </div>
  );
}
