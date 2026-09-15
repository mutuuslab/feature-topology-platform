import { useState } from 'react';
import { useParams } from 'react-router-dom';
import * as M from '../data/model';
import { getFeature } from '../data/engine';
import { opsTriggerRules } from '../data/refdata';
import { useApp } from '../store';
import { GButton } from '../components/patterns';
import { AreaChart, GaugeArc, LiveDot } from '../components/charts';
import TopoLink from '../components/TopoLink';
import { Breadcrumb } from '../components/Breadcrumb';

export default function OpsDashboard() {
  const { id = 'FEAT-BDC-001' } = useParams();
  const { state, dispatch } = useApp();
  const f = getFeature(id);
  const tel = M.telemetry[id];
  const live = state.live;
  const killed = state.runtime[id] === 'disabled';
  const [stage, setStage] = useState<number | null>(null); // null=정상/킬, 0~2=복구중
  const [confirm, setConfirm] = useState('');

  if (!tel) return <div className="card">운영 데이터 없음: {id}</div>;
  const recovering = stage !== null;
  const rate = killed && !recovering ? 0 : recovering ? [5, 20, 100][stage!] : 98.7;

  return (
    <div>
      <Breadcrumb title={id} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Operations Dashboard · Kill Switch <LiveDot /></h1>
        <TopoLink id={id} />
      </div>
      <p className="page-sub">{f?.displayName} — Runtime: {killed && !recovering ? 'disabled (Safe Default)' : recovering ? `recovering ${rate}%` : 'enabled'} · 실시간 시뮬레이션(2s)</p>

      <div className="kpis">
        <div className="kpi"><div className="v">{killed && !recovering ? '0%' : `${live.activation}%`}</div><div className="l">Activation Success</div></div>
        <div className="kpi"><div className="v">{killed ? '—' : `${live.failRate}%`}</div><div className="l">Policy Apply Fail</div></div>
        <div className="kpi"><div className="v">{live.rollback}</div><div className="l">Rollback Count</div></div>
        <div className="kpi"><div className="v">{live.p95}ms</div><div className="l">p95 Latency</div></div>
        <div className="kpi"><div className="v">{tel.staleCacheCount}</div><div className="l">Stale Cache</div></div>
        <div className="kpi"><div className="v" style={{ color: killed ? 'var(--fail)' : 'var(--pass)' }}>{killed ? 'KILLED' : 'OK'}</div><div className="l">Kill Switch</div></div>
      </div>

      <div className="row">
        <div className="col card" style={{ flex: 2 }}><b>Activation Success Rate (실시간) <LiveDot /></b>
          <AreaChart data={killed && !recovering ? live.series.map(() => 0) : live.series} height={150} min={88} max={100} fmt={n => n.toFixed(0) + '%'} />
          <div className="muted small">최근 {live.series.length} 배치 · p95 {live.p95}ms</div></div>
        <div className="col card" style={{ maxWidth: 220 }}><b>활성화율</b>
          <GaugeArc value={killed && !recovering ? 0 : live.activation} label="실시간 Activation" /></div>
      </div>

      <div className="row mt">
        <div className="col card">
          <b>Recent Events <LiveDot /></b>
          {live.events.map((e: any, i: number) => (
            <div className="evt" key={i}><span className="pill">{e.type}</span><span className="muted">{e.detail}</span><span className="muted small" style={{ marginLeft: 'auto' }}>{e.ts}</span></div>
          ))}
        </div>
        <div className="col card">
          <b>⚠ Kill Switch — DESTRUCTIVE</b>
          {!killed && !recovering && <>
            <p className="small mt">Safe Default on kill: <b>disabled</b> · Scope: All (142,300 vehicles)</p>
            <input placeholder='확인: "FEAT-BDC-001" 입력' value={confirm} onChange={e => setConfirm(e.target.value)} style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
            <GButton verb="kill" className="btn danger mt" disabled={confirm !== id} onClick={() => { if (confirm === id) dispatch({ t: 'KILL', feature: id, actor: state.role }); }}>EXECUTE KILL</GButton>
            <p className="small muted mt">(상태는 store에 저장 — 새로고침해도 유지)</p>
          </>}
          {killed && !recovering && <>
            <p className="small mt">🔴 비활성화됨 → Safe Default(disabled). 원인: ECU FW mismatch. (Audit 기록됨)</p>
            <GButton verb="rollback" className="btn mt" onClick={() => setStage(0)}>Policy 수정 후 단계 복구 시작</GButton>
          </>}
          {recovering && <>
            <p className="small mt">단계 복구: {[5, 20, 100].map((p, i) => <span key={p} className="pill" style={{ marginRight: 6, background: i <= stage! ? 'var(--pass)' : '', color: i <= stage! ? '#fff' : '' }}>{p}%</span>)}</p>
            {stage! < 2
              ? <GButton verb="rollback" className="btn primary mt" onClick={() => setStage(s => (s ?? 0) + 1)}>다음 단계 (telemetry guard 통과)</GButton>
              : <GButton verb="rollback" className="btn mt" onClick={() => { dispatch({ t: 'RECOVER', feature: id }); setStage(null); setConfirm(''); }}>복구 완료 → 정상</GButton>}
          </>}
        </div>
      </div>

      <div className="card">
        <b>Trigger → Action 매핑 (S17)</b>
        <table className="mt"><thead><tr><th>Level</th><th>조건</th><th>액션</th></tr></thead>
          <tbody>{opsTriggerRules.map(r => (<tr key={r.level}>
            <td><span className="pill" style={{ background: r.level === 'ROLLBACK' || r.level === 'BLOCK' ? 'var(--fail)' : 'var(--pending)', color: '#fff' }}>{r.level}</span></td>
            <td className="small">{r.cond}</td><td className="small">{r.action}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
}
