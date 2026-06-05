import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { reportEffects, auditLog, glossary } from '../data/refdata';
import { useApp } from '../store';
import { costSummary, fmtWon } from '../data/engine';
import { RightPanel } from '../components/patterns';
import { GroupedBars, Donut, Bars, Timeline, CountUp, tally, dist } from '../components/charts';

// "15~20%" → 17.5, "<2%" → 2, "35%" → 35. 단위(%)가 명확한 경우만 숫자 반환.
function parsePct(s: string): number | null {
  if (typeof s !== 'string' || !s.includes('%')) return null;
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => Number.isFinite(n));
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Number.isFinite(avg) ? avg : null;
}

export function Reports() {
  const nav = useNavigate();
  const c = costSummary();
  // Before/After가 % 단위로 깨끗이 파싱되는 행만 비교 차트에 포함 (NaN 가드)
  const cmpRows = reportEffects
    .map(r => ({ label: r[0], a: parsePct(r[1]), b: parsePct(r[2]) }))
    .filter((r): r is { label: string; a: number; b: number } =>
      r.a != null && r.b != null && Number.isFinite(r.a) && Number.isFinite(r.b));
  return (
    <div>
      <div className="breadcrumb">분석·감사 ▸ Reports</div>
      <h1 className="page-title">Reports / Analytics</h1>
      <p className="page-sub">정량 기대효과 (목표치 — PoC/Baseline 실측 검증 필요)</p>
      <div className="row">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>정량 기대효과 지표</b>
          <div className="kpi" style={{ marginTop: 6 }}><div className="v"><CountUp value={reportEffects.length} /></div><div className="l">측정 지표 수</div></div>
        </div>
        {cmpRows.length > 0 && (
          <div className="col card" style={{ flex: 1 }}><b>Before → After (%) 비교</b>
            <p className="small muted" style={{ margin: '2px 0 8px' }}>% 단위로 파싱 가능한 지표만 표시 (낮을수록 개선)</p>
            <GroupedBars rows={cmpRows} fmt={(n) => `${n}%`} />
          </div>
        )}
      </div>
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
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 260, alignItems: 'center' }}><b>Action 분포</b>
          <Donut size={120} center={`${rows.length}`} segments={dist(tally(rows, a => a.action))} /></div>
        <div className="col card" style={{ flex: 1 }}><b>Actor 활동량</b>
          <Bars data={tally(rows, a => a.actor)} /></div>
      </div>
      <div className="card"><b>최근 활동 타임라인</b>
        <Timeline items={rows.slice(0, 6).map(a => ({ ts: a.ts, title: a.action, detail: a.detail, tag: a.actor }))} /></div>
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
      <h1 className="page-title">Glossary / 용어집 <span className="muted" style={{ fontWeight: 400 }}>(<CountUp value={glossary.length} />개 용어)</span></h1>
      <div className="card"><table><thead><tr><th>용어</th><th>정의</th></tr></thead>
        <tbody>{glossary.map(([t,d])=>(<tr key={t}><td><b>{t}</b></td><td>{d}</td></tr>))}</tbody></table></div>
    </div>
  );
}
