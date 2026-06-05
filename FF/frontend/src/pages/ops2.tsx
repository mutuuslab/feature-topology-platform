import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { campaigns, policies, policyStages, incidents } from '../data/refdata';
import { telemetry } from '../data/model';
import { useToast, useApp } from '../store';
import { RightPanel } from '../components/patterns';
import { AreaChart, GaugeArc, LiveDot, Donut, Bars, Steps, tally, dist } from '../components/charts';
import TopoLink from '../components/TopoLink';

export function OTACampaign() {
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ OTA Campaign</div>
      <h1 className="page-title">OTA Campaign Manager</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Status 분포</b>
          <Donut size={120} center={`${campaigns.length}`} segments={dist(tally(campaigns, c => c.status))} /></div>
        <div className="col card" style={{ flex: 2 }}><b>Campaign Rollout %</b>
          <div className="mt"><Bars data={Object.fromEntries(campaigns.map(c => [c.id, c.rollout]))} fmt={n => n + '%'} /></div></div>
      </div>
      <div className="card"><table><thead><tr><th>Campaign</th><th>Feature</th><th>Type</th><th>Cohort</th><th>Rollout</th><th>Status</th></tr></thead>
        <tbody>{campaigns.map(c=>(<tr key={c.id} onClick={()=>nav('/ops/campaign/'+c.id)}>
          <td className="mono">{c.id}</td><td className="mono">{c.feature}</td><td><span className="pill">{c.type}</span></td>
          <td>{c.cohort}</td><td>{c.rollout}%</td><td><span className="pill">{c.status}</span></td></tr>))}</tbody></table></div>
    </div>
  );
}

export function CampaignDetail() {
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Campaign Detail</div>
      <h1 className="page-title">CMP-BDC-2027-01</h1>
      {(() => {
        const c = campaigns.find(x => x.id === 'CMP-BDC-2027-01') || campaigns[0];
        const stages = ['5%', '20%', '100%'];
        const cur = c.rollout >= 100 ? 2 : c.rollout >= 20 ? 1 : 0;
        return <div className="card"><b>단계 Rollout 파이프라인</b><div className="mt"><Steps steps={stages} current={cur} done={c.rollout >= 100} /></div></div>;
      })()}
      <div className="card"><div className="kv">
        <div>Feature</div><div className="mono">FEAT-BDC-001</div><div>Type</div><div>Policy-only</div>
        <div>단계 Rollout</div><div>{[5,20,100].map(p=><span key={p} className="pill" style={{marginRight:4,background:'var(--pass)',color:'#fff'}}>{p}%</span>)}</div>
        <div>Guard</div><div>각 단계 telemetry 성공률 ≥ 임계 시 진행</div>
      </div></div>
    </div>
  );
}

export function PolicyLifecycle() {
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Policy Lifecycle</div>
      <h1 className="page-title">Policy Lifecycle Board</h1>
      <p className="page-sub">Draft → Review → Approved → Deployed → Monitored · 카드 클릭 → 상세</p>
      <div className="card"><b>단계별 정책 수</b>
        <div className="mt"><Bars data={Object.fromEntries(policyStages.map(s => [s, policies.filter(p => p.stage === s).length]))} /></div></div>
      <div className="row">{policyStages.map(stage => (
        <div className="col card" key={stage} style={{ minWidth: 180 }}>
          <b>{stage}</b>
          {policies.filter(p => p.stage === stage).map(p => (
            <div key={p.id} className="evt" role="button" tabIndex={0} onClick={() => setSel(p)} onKeyDown={e => { if (e.key === 'Enter') setSel(p); }}
              style={{ flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer' }}>
              <span className="mono small">{p.id}</span><span className="muted small">{p.feature} · {p.rollout}%</span>
            </div>
          ))}
        </div>
      ))}</div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.id || ''}>
        {sel && <div className="kv">
          <div>Feature</div><div className="mono">{sel.feature}</div>
          <div>Stage</div><div><span className="pill">{sel.stage}</span></div>
          <div>승인자</div><div>{sel.approver || '-'}</div>
          <div>Rollout</div><div>{sel.rollout}%</div>
          <div>비고</div><div className="small">정책 생애주기 5단계 (FR-PVER-004)</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function TelemetryExplorer() {
  const live = useApp().state.live;
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Telemetry Explorer · FEAT-BDC-001 <LiveDot /></h1>
        <TopoLink />
      </div>
      <div className="breadcrumb">배포·운영 ▸ Telemetry Explorer · 실시간 수집(MQTT 시뮬)</div>
      <div className="row">
        <div className="col card" style={{ flex: 2 }}><b>Activation Success Rate (실시간) <LiveDot /></b>
          <AreaChart data={live.series} height={150} min={88} max={100} fmt={n => n.toFixed(0) + '%'} />
          <div style={{ display: 'flex', gap: 24, marginTop: 8 }}><GaugeArc value={live.activation} size={120} label="활성화" /><div><div className="kv small"><div>실패율</div><div>{live.failRate}%</div><div>p95</div><div>{live.p95}ms</div><div>rollback</div><div>{live.rollback}</div></div></div></div>
        </div>
        <div className="col card"><b>Recent Events <LiveDot /></b>
          {live.events.map((e: any, i: number) => (
            <div className="evt" key={i} role="button" tabIndex={0} onClick={() => setSel(e)} onKeyDown={ev => { if (ev.key === 'Enter') setSel(e); }} style={{ cursor: 'pointer' }}>
              <span className="pill">{e.type}</span><span className="muted">{e.detail}</span><span className="muted small" style={{ marginLeft: 'auto' }}>{e.ts}</span></div>))}
        </div>
      </div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.type || ''}>
        {sel && <div className="kv">
          <div>Event</div><div className="mono">{sel.type}</div>
          <div>Detail</div><div>{sel.detail}</div>
          <div>Time</div><div>{sel.ts}</div>
          <div>Feature</div><div className="mono">FEAT-BDC-001</div>
          <div>Transport</div><div>MQTT (retained, QoS1)</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function IncidentManager() {
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Incident</div>
      <h1 className="page-title">Incident Manager</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Severity 분포</b>
          <Donut size={120} center={`${incidents.length}`} segments={dist(tally(incidents, i => i.severity))} /></div>
        <div className="col card" style={{ flex: 2 }}><b>Status 분포</b>
          <div className="mt"><Bars data={tally(incidents, i => i.status)} /></div></div>
      </div>
      <div className="card"><table><thead><tr><th>ID</th><th>Feature</th><th>Title</th><th>Severity</th><th>Status</th></tr></thead>
        <tbody>{incidents.map(i=>(<tr key={i.id} onClick={()=>nav('/ops/incident/'+i.id)}>
          <td className="mono">{i.id}</td><td className="mono">{i.feature}</td><td>{i.title}</td>
          <td><span className="badge" style={{background:i.severity==='high'?'var(--fail)':'var(--pending)'}}>{i.severity}</span></td>
          <td><span className="pill">{i.status}</span></td></tr>))}</tbody></table></div>
    </div>
  );
}

export function IncidentDetail() {
  const i = incidents[0];
  const nav = useNavigate();
  const toast = useToast();
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Incident Detail</div>
      <h1 className="page-title">{i.id}</h1>
      <div className="card" style={{ alignItems: 'center' }}><b>전체 Incident Severity</b>
        <Donut size={120} center={`${incidents.length}`} segments={dist(tally(incidents, x => x.severity))} /></div>
      <div className="card"><div className="kv">
        <div>Feature</div><div className="mono">{i.feature}</div>
        <div>Title</div><div>{i.title}</div>
        <div>Root Cause</div><div>{i.cause}</div>
        <div>Linked CR</div><div className="mono">{i.linkedCR}</div>
        <div>액션</div><div><button className="btn danger" onClick={() => toast('Rollback 실행 — 직전 정상 정책 복귀', 'warn')}>Rollback</button> <button className="btn" onClick={() => nav('/ops/' + i.feature)}>Kill Switch →</button></div>
      </div></div>
    </div>
  );
}
