import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useToast, LIFECYCLE_ORDER, canTransition } from '../store';
import { LifecycleBadge } from '../components/ui';
import { readiness } from '../data/engine';
import TopoLink from '../components/TopoLink';
import { Steps, RadialProgress, Donut, tally, dist } from '../components/charts';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const LC_COLOR: Record<string, string> = { Proposed: '#8895A7', Approved: '#3B82F6', Developing: '#6366F1', Verified: '#0EA5E9', Released: '#1F9D55', Retired: '#9CA3AF' };

export default function Lifecycle() {
  const nav = useNavigate();
  const { state, dispatch, can } = useApp();
  const toast = useToast();
  const [fid, setFid] = useState('FEAT-BDC-001');
  const f = state.features.find(x => x.id === fid)!;
  const idx = LIFECYCLE_ORDER.indexOf(f.lifecycle);
  const r = readiness(fid);

  const go = (to: any) => {
    const chk = canTransition(f, to);
    if (!chk.ok) { toast(`전이 차단: ${chk.reason}`, 'warn'); dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 08:40', actor: state.role, action: 'LIFECYCLE_BLOCKED', target: fid, detail: `→${to} · ${chk.reason}` } }); return; }
    if (!can('approve') && (to === 'Released' || to === 'Approved')) { toast('권한 필요: approve', 'warn'); return; }
    dispatch({ t: 'SET_LIFECYCLE', feature: fid, to, actor: state.role });
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Breadcrumb />
      <PageTitle fallback="Feature Lifecycle 관리" />
        <TopoLink id={fid} />
      </div>
      <p className="page-sub">Proposed → Approved → Developing → Verified → Released → Retired · 전이 시 구조 완전성·9-Gate 검증</p>

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <b>대상 Feature</b>
          <select value={fid} onChange={e => setFid(e.target.value)} style={{ padding: 8 }}>{state.features.map(x => <option key={x.id} value={x.id}>{x.id} · {x.displayName}</option>)}</select>
          <span style={{ marginLeft: 'auto' }}><LifecycleBadge value={f.lifecycle} /></span>
        </div>

        <div style={{ margin: '18px 0' }}>
          <Steps steps={LIFECYCLE_ORDER as unknown as string[]} current={idx} />
        </div>

        <div className="row">
          <button className="btn" disabled={idx <= 0} onClick={() => go(LIFECYCLE_ORDER[idx - 1])}>← {LIFECYCLE_ORDER[idx - 1] || '-'} (되돌리기)</button>
          {idx < LIFECYCLE_ORDER.length - 1 && (() => { const to = LIFECYCLE_ORDER[idx + 1]; const chk = canTransition(f, to); return (
            <button className={'btn ' + (chk.ok ? 'primary' : '')} onClick={() => go(to)} title={chk.ok ? '' : chk.reason}>
              {chk.ok ? '▶' : '🔒'} {to}로 전이 {chk.ok ? '' : `(${chk.reason})`}
            </button>); })()}
        </div>
      </div>

      <div className="card">
        <b>전이 전제 조건 (현재 Feature)</b>
        <div className="table-wrap mt"><table><thead><tr><th>대상 상태</th><th>조건</th><th>충족</th></tr></thead>
          <tbody>
            {(['Approved', 'Developing', 'Verified', 'Released'] as const).map(to => { const chk = canTransition(f, to); return (
              <tr key={to}><td>{to}</td><td className="small">{chk.ok ? 'OK' : chk.reason}</td>
                <td><span className="badge" style={{ background: chk.ok ? 'var(--pass)' : 'var(--pending)' }}>{chk.ok ? 'PASS' : 'PENDING'}</span></td></tr>); })}
          </tbody></table></div>
        <p className="small muted mt">Released 전이는 9-Gate({r.passCount}/9 PASS·{r.decision}) 통과 필요 — <button className="btn" onClick={() => nav(`/readiness/${fid}`)}>Release Readiness →</button></p>
      </div>

      <div className="row">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>현재 9-Gate 진척</b>
          <RadialProgress size={120} color={r.decision === 'RELEASE' ? '#1F9D55' : '#D9822B'} value={Math.round(r.passCount / 9 * 100)} label={`${r.passCount}/9 PASS`} />
        </div>
        <div className="col card" style={{ alignItems: 'center', maxWidth: 240 }}><b>전 Feature Lifecycle 분포</b>
          <Donut size={130} center={`${state.features.length}`} segments={dist(tally(state.features, x => x.lifecycle), LC_COLOR)} />
        </div>
      </div>

      <div className="card">
        <b>전 Feature Lifecycle 현황</b>
        <div className="table-wrap mt"><table><thead><tr><th>Feature</th><th>Lifecycle</th><th>Deploy</th></tr></thead>
          <tbody>{state.features.map(x => (
            <tr key={x.id} role="button" tabIndex={0} onClick={() => setFid(x.id)} onKeyDown={e => { if (e.key === 'Enter') setFid(x.id); }}>
              <td className="mono">{x.id}</td><td><LifecycleBadge value={x.lifecycle} /></td><td>{x.deployType}</td></tr>))}</tbody></table></div>
      </div>
    </div>
  );
}
