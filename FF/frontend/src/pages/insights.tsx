import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { reportEffects, auditLog, glossary } from '../data/refdata';
import { useApp } from '../store';
import { costSummary, fmtWon } from '../data/engine';
import { RightPanel } from '../components/patterns';

export function Reports() {
  const nav = useNavigate();
  const c = costSummary();
  return (
    <div>
      <div className="breadcrumb">분석·감사 ▸ Reports</div>
      <h1 className="page-title">Reports / Analytics</h1>
      <p className="page-sub">정량 기대효과 (목표치 — PoC/Baseline 실측 검증 필요)</p>
      <div className="card"><table><thead><tr><th>지표</th><th>Before</th><th>After(목표)</th><th>개선</th></tr></thead>
        <tbody>{reportEffects.map((r,i)=>(<tr key={i}><td>{r[0]}</td><td className="muted">{r[1]}</td><td><b>{r[2]}</b></td>
          <td><span className="badge status-PASS">{r[3]}</span></td></tr>))}
          <tr><td>SW 개발비(총 예상)</td><td className="muted">-</td><td className="mono"><b>{fmtWon(c.totalEst)}</b></td>
            <td><button className="btn" onClick={()=>nav('/cost')}>SW 개발비 상세 →</button></td></tr>
        </tbody></table></div>
    </div>
  );
}

export function AuditLog() {
  const live = useApp().state.audit.map(a => ({ ...a, reason: '-' }));
  const rows = [...live, ...auditLog];
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="breadcrumb">분석·감사 ▸ Audit Log</div>
      <h1 className="page-title">Audit Log Explorer</h1>
      <p className="page-sub">불변(append-only) · Feature ID 귀속 · R156 SUMS 증적 · 세션 내 액션 실시간 반영 · 행 클릭 → 상세</p>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>{rows.map((a, i) => (<tr key={i} role="button" tabIndex={0} onClick={() => setSel(a)} onKeyDown={e => { if (e.key === 'Enter') setSel(a); }}><td className="small">{a.ts}</td><td>{a.actor}</td>
          <td><span className="pill">{a.action}</span></td><td className="mono">{a.target}</td><td className="small muted">{a.detail}</td></tr>))}</tbody></table></div></div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.action} · ${sel.target}` : ''}>
        {sel && <div className="kv">
          <div>Time</div><div>{sel.ts}</div><div>Actor</div><div>{sel.actor}</div>
          <div>Action</div><div><span className="pill">{sel.action}</span></div><div>Target</div><div className="mono">{sel.target}</div>
          <div>Detail</div><div>{sel.detail}</div><div>Reason</div><div>{sel.reason || '-'}</div>
          <div>불변성</div><div className="small">append-only · 정정 시 별도 Record</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function Glossary() {
  return (
    <div>
      <div className="breadcrumb">분석·감사 ▸ Glossary</div>
      <h1 className="page-title">Glossary / 용어집</h1>
      <div className="card"><table><thead><tr><th>용어</th><th>정의</th></tr></thead>
        <tbody>{glossary.map(([t,d])=>(<tr key={t}><td><b>{t}</b></td><td>{d}</td></tr>))}</tbody></table></div>
    </div>
  );
}
