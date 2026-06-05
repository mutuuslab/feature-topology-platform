import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store';
import { RightPanel } from '../components/patterns';
import { Donut, Timeline, LiveDot, tally, dist } from '../components/charts';

const CONN_STATUS_COLORS = { connected: '#1F9D55', degraded: '#D9822B', failed: '#D64545', disabled: '#9CA3AF' };
const SYNC_STATUS_COLORS = { ok: '#1F9D55', retry: '#D9822B', failed: '#D64545' };

export function ConnectorHub() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const connectors = state.connectors;
  return (
    <div>
      <div className="breadcrumb">연동 ▸ Connector Hub</div>
      <h1 className="page-title">Connector Hub</h1>
      <p className="page-sub">ALM/PLM/Feature Flag/OTA 양방향 연계 · 연결 토글 · 동기화 시뮬 (FR-AGW/LGCY/DSYN/SDVI)</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Connector 상태</b>
          <Donut size={120} center={`${connectors.length}`} segments={dist(tally(connectors, c => c.status), CONN_STATUS_COLORS)} /></div>
      </div>
      <div className="row">{connectors.map(c => (
        <div className="col card" key={c.id} style={{ minWidth: 240 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ cursor: 'pointer' }} onClick={() => nav('/integration/connector/' + c.id)}>{c.name}</b>
            <span className="dot" style={{ background: (CONN_STATUS_COLORS as any)[c.status] || 'var(--muted)' }} /></div>
          <p className="small muted">{c.proto} · {c.dir}</p>
          <p className="small">last sync: {c.lastSync} · <span className="pill">{c.status}</span></p>
          <button className="btn" onClick={() => dispatch({ t: 'CONNECTOR_TOGGLE', id: c.id })}>{c.enabled ? '⏸ 연결 중지' : '▶ 연결'}</button>
        </div>
      ))}</div>
    </div>
  );
}

export function ConnectorDetail() {
  const { id } = useParams();
  const { state, dispatch } = useApp();
  const connectors = state.connectors;
  const c = connectors.find(x => x.id === id) || connectors[0];
  if (!c) return <div className="card">커넥터 없음</div>;
  return (
    <div>
      <div className="breadcrumb">연동 ▸ Connector Detail</div>
      <h1 className="page-title">{c.name}</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>전체 Connector 상태</b>
          <Donut size={120} center={`${connectors.length}`} segments={dist(tally(connectors, x => x.status), CONN_STATUS_COLORS)} /></div>
      </div>
      <div className="card"><div className="kv">
        <div>상태</div><div><span className="badge" style={{ background: (CONN_STATUS_COLORS as any)[c.status] || 'var(--muted)' }}>{c.status}</span> <button className="btn" onClick={() => dispatch({ t: 'CONNECTOR_TOGGLE', id: c.id })}>{c.enabled ? '⏸ 중지' : '▶ 연결'}</button></div>
        <div>Protocol</div><div>{c.proto}</div><div>Direction</div><div>{c.dir}</div>
        <div>Auth</div><div>OAuth2</div><div>Field Mapping</div><div>Requirement ↔ BOM(Requirement 영역)</div>
        <div>충돌 해소</div><div>source-of-record 우선 · timestamp · 수동 검토 큐</div>
      </div></div>
    </div>
  );
}

export function SyncLogs() {
  const syncLogs = useApp().state.syncLogs;
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="breadcrumb">연동 ▸ Sync Logs</div>
      <h1 className="page-title">Sync Logs <LiveDot /></h1>
      <p className="page-sub">양방향 동기화 이력 · 연결된 커넥터에서 실시간 유입 · 행 클릭 → 상세</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Sync 상태</b>
          <Donut size={120} center={`${syncLogs.length}`} segments={dist(tally(syncLogs, l => l.status), SYNC_STATUS_COLORS)} /></div>
        <div className="col card"><b>최근 동기화 이벤트</b>
          <Timeline items={syncLogs.map(l => ({ ts: l.ts, title: l.event, detail: l.conn, tag: l.status, color: l.status === 'ok' ? '#1F9D55' : l.status === 'retry' ? '#D9822B' : '#D64545' }))} /></div>
      </div>
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
