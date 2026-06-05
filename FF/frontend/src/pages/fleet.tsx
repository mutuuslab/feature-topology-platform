import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fleetStats, sampleVehicles, vehicleFeatureStates, STATE_COLOR, Vehicle } from '../data/fleet';
import { useApp } from '../store';
import { Donut, Bars, Sparkline, LiveDot } from '../components/charts';
import TopoLink from '../components/TopoLink';
import { RightPanel } from '../components/patterns';

const fmtM = (n: number) => (n / 1e6).toFixed(2) + 'M';

export default function Fleet() {
  const nav = useNavigate();
  const live = useApp().state.live;
  const [vin, setVin] = useState('');
  const [veh, setVeh] = useState<Vehicle | null>(null);
  const [sel, setSel] = useState<any>(null);
  const states = veh ? vehicleFeatureStates(veh) : [];
  const lookup = (q: string) => { const v = sampleVehicles.find(x => x.vin.toLowerCase() === q.trim().toLowerCase()) || sampleVehicles.find(x => x.vin.toLowerCase().includes(q.trim().toLowerCase())); setVeh(v || null); };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Fleet · 차량별 Feature 상태 <LiveDot /></h1>
        <TopoLink />
      </div>
      <p className="page-sub">현대자동차 SDV 전사 운영 — <b>{fleetStats.total.toLocaleString()}대</b> 규모 · 차량(VIN) 단위 Feature 상태 조회</p>

      <div className="kpis">
        <div className="kpi"><div className="v">{fmtM(fleetStats.total)}</div><div className="l">총 차량 (대)</div></div>
        <div className="kpi"><div className="v">{Math.round(fleetStats.onlineRate * 100)}%</div><div className="l">온라인 차량</div></div>
        <div className="kpi"><div className="v">{live.activation}%</div><div className="l">Fleet 활성화 성공(실시간)</div></div>
        <div className="kpi"><div className="v">{live.failRate}%</div><div className="l">정책 적용 실패(실시간)</div></div>
      </div>

      <div className="row">
        <div className="col card"><b>권역별 차량 분포</b>
          <Donut size={130} segments={[
            { label: 'KR', value: Math.round(fleetStats.byRegion.KR / 1e5), color: '#0B5FFF' },
            { label: 'EU', value: Math.round(fleetStats.byRegion.EU / 1e5), color: '#16A34A' },
            { label: 'US', value: Math.round(fleetStats.byRegion.US / 1e5), color: '#D9822B' },
            { label: 'ETC', value: Math.round(fleetStats.byRegion.ETC / 1e5), color: '#9333EA' },
          ]} />
          <p className="small muted">단위 10만대</p>
        </div>
        <div className="col card"><b>배포방식별 차량</b><div className="mt"><Bars data={fleetStats.byDeploy} fmt={fmtM} /></div></div>
        <div className="col card"><b>Fleet 활성화율(실시간)</b><Sparkline data={live.series} height={80} min={88} max={100} /><div className="muted small">현재 {live.activation}%</div></div>
      </div>

      <div className="card">
        <b>차량(VIN) 조회</b>
        <div className="row mt" style={{ alignItems: 'center' }}>
          <input placeholder="VIN 입력 (예: KMHX001KR2027A0001)" value={vin} onChange={e => setVin(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') lookup(vin); }} style={{ flex: 1, minWidth: 220, padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          <button className="btn primary" onClick={() => lookup(vin)}>조회</button>
        </div>
        <div className="row mt" style={{ gap: 6 }}>
          <span className="small muted">샘플:</span>
          {sampleVehicles.map(v => <span key={v.vin} className="pill" style={{ cursor: 'pointer' }} onClick={() => { setVin(v.vin); setVeh(v); }}>{v.vin}</span>)}
        </div>
      </div>

      {veh && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b className="mono">{veh.vin}</b>
            <span className="small muted">{veh.region} · MY{veh.my} · {veh.trim} · {veh.hw} · SW {veh.sw} · cohort {veh.cohort}</span>
          </div>
          <div className="table-wrap mt"><table><thead><tr><th>Feature</th><th>Deploy</th><th>상태</th><th>사유</th></tr></thead>
            <tbody>{states.map(s => (
              <tr key={s.feature.id} role="button" tabIndex={0} onClick={() => setSel(s)} onKeyDown={e => { if (e.key === 'Enter') setSel(s); }}>
                <td className="mono">{s.feature.id}</td><td>{s.feature.deployType}</td>
                <td><span className="badge" style={{ background: STATE_COLOR[s.state] }}>{s.state}</span></td>
                <td className="small muted">{s.reason}</td></tr>))}</tbody></table></div>
          <p className="small muted mt">활성 {states.filter(s => s.state === 'enabled').length} · 차단 {states.filter(s => s.state === 'blocked').length} · 저하 {states.filter(s => s.state === 'degraded').length} · 실패 {states.filter(s => s.state === 'apply_fail').length}</p>
        </div>
      )}

      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel ? `${veh?.vin} · ${sel.feature.id}` : ''}>
        {sel && <div className="kv">
          <div>Feature</div><div>{sel.feature.displayName}</div>
          <div>상태</div><div><span className="badge" style={{ background: STATE_COLOR[sel.state] }}>{sel.state}</span></div>
          <div>사유</div><div>{sel.reason}</div>
          <div>Deploy</div><div>{sel.feature.deployType}</div>
          <div>차량</div><div className="small">{veh?.region}·MY{veh?.my}·{veh?.trim}·{veh?.hw}·SW{veh?.sw}</div>
          <div></div><div><button className="btn" onClick={() => nav(`/feature/${sel.feature.id}`)}>Feature 상세 →</button> <button className="btn" onClick={() => nav(`/topology/${sel.feature.id}`)}>Topology</button></div>
        </div>}
      </RightPanel>
    </div>
  );
}
