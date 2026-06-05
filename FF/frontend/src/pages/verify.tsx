import { useState } from 'react';
import { evidence } from '../data/model';
import { RightPanel } from '../components/patterns';

const TC_META: Record<string, { method: string; feature: string }> = {
  'HIL-BDC-001': { method: 'HIL', feature: 'FEAT-BDC-001' },
  'OTA-RB-002': { method: 'OTA-Rollback', feature: 'FEAT-BDC-001' },
  'TEL-BDC-001': { method: 'Telemetry', feature: 'FEAT-BDC-001' },
};
export function TestEvidenceManager() {
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="breadcrumb">검증 ▸ Test Evidence Manager</div>
      <h1 className="page-title">Test Evidence Manager</h1>
      <p className="page-sub">행 클릭 → 증적 상세</p>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>Test Case</th><th>Method</th><th>Result</th><th>Coverage</th></tr></thead>
        <tbody>{evidence.map(e => (<tr key={e.testCaseId} role="button" tabIndex={0} onClick={() => setSel(e)} onKeyDown={ev => { if (ev.key === 'Enter') setSel(e); }}>
          <td className="mono">{e.testCaseId}</td><td>{TC_META[e.testCaseId]?.method || '-'}</td>
          <td><span className="badge" style={{ background: e.result === 'pass' ? 'var(--pass)' : e.result === 'pending' ? 'var(--pending)' : 'var(--fail)' }}>{e.result}</span></td>
          <td>{Math.round((e.coverage || 0) * 100)}%</td></tr>))}</tbody></table></div>
        <p className="small muted mt">Coverage 평균 {Math.round(evidence.reduce((s, e) => s + (e.coverage || 0), 0) / evidence.length * 100)}% · Missing: OTA-RB-002</p>
      </div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.testCaseId || ''}>
        {sel && <div className="kv">
          <div>Method</div><div>{TC_META[sel.testCaseId]?.method}</div>
          <div>연결 Feature</div><div className="mono">{TC_META[sel.testCaseId]?.feature}</div>
          <div>Result</div><div><span className="badge" style={{ background: sel.result === 'pass' ? 'var(--pass)' : 'var(--pending)' }}>{sel.result}</span></div>
          <div>Coverage</div><div>{Math.round((sel.coverage || 0) * 100)}%</div>
          <div>Gate 영향</div><div className="small">{sel.result !== 'pass' ? 'Verification Gate(G5) PENDING 원인' : 'G5 기여'}</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function EvidenceDetail() {
  return (
    <div>
      <div className="breadcrumb">검증 ▸ Evidence Detail</div>
      <h1 className="page-title">Evidence · OTA-RB-002</h1>
      <div className="card"><div className="kv">
        <div>Test Case</div><div className="mono">OTA-RB-002 (OTA Rollback Test)</div>
        <div>Result</div><div><span className="badge status-PENDING">pending</span></div>
        <div>Coverage</div><div>0%</div>
        <div>비고</div><div>Verification Gate(G5) PENDING의 원인 — 완료 시 Release 가능</div>
      </div></div>
    </div>
  );
}
