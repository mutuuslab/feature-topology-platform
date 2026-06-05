import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { telemetry } from '../data/model';
import { useToast, useApp, ROLLOUT_STEPS, POLICY_STAGES } from '../store';
import { RightPanel } from '../components/patterns';
import { AreaChart, GaugeArc, LiveDot, Donut, Bars, Steps, tally, dist } from '../components/charts';
import TopoLink from '../components/TopoLink';

export function OTACampaign() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const campaigns = state.campaigns;
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ OTA Campaign</div>
      <h1 className="page-title">OTA Campaign Manager</h1>
      <p className="page-sub">단계적 롤아웃(5→20→50→100%) · 각 단계 telemetry 가드 통과 시 진행 (FR-ROL/TGT)</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Status 분포</b>
          <Donut size={120} center={`${campaigns.length}`} segments={dist(tally(campaigns, c => c.status))} /></div>
        <div className="col card" style={{ flex: 2 }}><b>Campaign Rollout % <LiveDot /></b>
          <div className="mt"><Bars data={Object.fromEntries(campaigns.map(c => [c.id, c.rollout]))} fmt={n => n + '%'} /></div></div>
      </div>
      <div className="card"><table><thead><tr><th>Campaign</th><th>Feature</th><th>Type</th><th>Cohort</th><th>Rollout</th><th>Status</th><th>단계 진행</th></tr></thead>
        <tbody>{campaigns.map(c => (<tr key={c.id}>
          <td className="mono" style={{ cursor: 'pointer' }} onClick={() => nav('/ops/campaign/' + c.id)}>{c.id}</td><td className="mono">{c.feature}</td><td><span className="pill">{c.type}</span></td>
          <td>{c.cohort}</td><td><b>{c.rollout}%</b></td><td><span className="pill">{c.status}</span></td>
          <td><button className="btn" disabled={c.rollout >= 100} onClick={() => dispatch({ t: 'CAMPAIGN_ADVANCE', id: c.id })}>{c.rollout >= 100 ? '완료' : `▶ ${ROLLOUT_STEPS[c.step + 1] || 100}%`}</button></td></tr>))}</tbody></table>
        <p className="small muted mt">실패율(live) 5% 초과 시 단계 진행이 자동 차단됩니다(telemetry guard). 현재 실패율 {state.live.failRate}%.</p>
      </div>
    </div>
  );
}

export function CampaignDetail() {
  const { id } = useParams();
  const { state, dispatch } = useApp();
  const c = state.campaigns.find(x => x.id === id) || state.campaigns[0];
  if (!c) return <div className="card">캠페인 없음</div>;
  const labels = ROLLOUT_STEPS.map(r => r + '%');
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Campaign Detail</div>
      <h1 className="page-title">{c.id}</h1>
      <div className="card"><b>단계 Rollout 파이프라인</b>
        <div className="mt"><Steps steps={labels} current={c.rollout >= 100 ? undefined : c.step} done={c.rollout >= 100} /></div>
        <div className="row mt" style={{ alignItems: 'center' }}>
          <button className="btn primary" disabled={c.rollout >= 100} onClick={() => dispatch({ t: 'CAMPAIGN_ADVANCE', id: c.id })}>{c.rollout >= 100 ? '롤아웃 완료' : `다음 단계 → ${ROLLOUT_STEPS[c.step + 1] || 100}%`}</button>
          <span className="muted small">실패율(live) {state.live.failRate}% · 가드 임계 5%</span>
        </div>
      </div>
      <div className="card"><div className="kv">
        <div>Feature</div><div className="mono">{c.feature}</div><div>Type</div><div>{c.type}</div>
        <div>Cohort</div><div>{c.cohort}</div><div>현재 Rollout</div><div><b>{c.rollout}%</b> ({c.status})</div>
        <div>Guard</div><div className="small">각 단계 telemetry 성공률 ≥ 95% (실패율 &lt; 5%) 시 진행</div>
      </div></div>
    </div>
  );
}

export function PolicyLifecycle() {
  const { state, dispatch } = useApp();
  const policies = state.policies;
  const [sel, setSel] = useState<string | null>(null);
  const p = policies.find(x => x.id === sel);
  const promote = (id: string) => dispatch({ t: 'PROMOTE_POLICY', id, actor: state.role });
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Policy Lifecycle</div>
      <h1 className="page-title">Policy Lifecycle Board</h1>
      <p className="page-sub">Draft → Review → Approved → Deployed → Monitored · 카드 승급(promote) (FR-POL/PVER)</p>
      <div className="card"><b>단계별 정책 수</b>
        <div className="mt"><Bars data={Object.fromEntries(POLICY_STAGES.map(s => [s, policies.filter(p => p.stage === s).length]))} /></div></div>
      <div className="row">{POLICY_STAGES.map(stage => (
        <div className="col card" key={stage} style={{ minWidth: 180 }}>
          <b>{stage}</b>
          {policies.filter(p => p.stage === stage).map(p => (
            <div key={p.id} className="evt" role="button" tabIndex={0} onClick={() => setSel(p.id)} onKeyDown={e => { if (e.key === 'Enter') setSel(p.id); }}
              style={{ flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer' }}>
              <span className="mono small">{p.id} <span className="muted">v{p.version}</span></span><span className="muted small">{p.feature} · {p.rollout}%</span>
            </div>
          ))}
        </div>
      ))}</div>
      <RightPanel open={!!p} onClose={() => setSel(null)} title={p?.id || ''}>
        {p && <div>
          <div className="kv">
            <div>Feature</div><div className="mono">{p.feature}</div>
            <div>Stage</div><div><span className="pill">{p.stage}</span></div>
            <div>Version</div><div>v{p.version}</div>
            <div>승인자</div><div>{p.approver || '-'}</div>
            <div>Rollout</div><div>{p.rollout}%</div>
          </div>
          <div className="mt"><Steps steps={POLICY_STAGES} current={POLICY_STAGES.indexOf(p.stage)} /></div>
          <button className="btn primary mt" disabled={POLICY_STAGES.indexOf(p.stage) >= POLICY_STAGES.length - 1} onClick={() => promote(p.id)}>
            {POLICY_STAGES.indexOf(p.stage) >= POLICY_STAGES.length - 1 ? '최종 단계' : `▶ ${POLICY_STAGES[POLICY_STAGES.indexOf(p.stage) + 1]}로 승급`}
          </button>
          <p className="small muted mt">Deployed 승급 시 버전 증가·rollout 100% (FR-PVER-004).</p>
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

const INC_FLOW = ['open', 'investigating', 'resolved'];
export function IncidentManager() {
  const nav = useNavigate();
  const incidents = useApp().state.incidents;
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Incident</div>
      <h1 className="page-title">Incident Manager</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Severity 분포</b>
          <Donut size={120} center={`${incidents.length}`} segments={dist(tally(incidents, i => i.severity), { high: '#D64545', med: '#D9822B', low: '#1F9D55' })} /></div>
        <div className="col card" style={{ flex: 2 }}><b>Status 분포</b>
          <div className="mt"><Bars data={tally(incidents, i => i.status)} /></div></div>
      </div>
      <div className="card"><table><thead><tr><th>ID</th><th>Feature</th><th>Title</th><th>Severity</th><th>Status</th></tr></thead>
        <tbody>{incidents.map(i => (<tr key={i.id} onClick={() => nav('/ops/incident/' + i.id)}>
          <td className="mono">{i.id}</td><td className="mono">{i.feature}</td><td>{i.title}</td>
          <td><span className="badge" style={{ background: i.severity === 'high' ? 'var(--fail)' : 'var(--pending)' }}>{i.severity}</span></td>
          <td><span className="pill">{i.status}</span></td></tr>))}</tbody></table></div>
    </div>
  );
}

export function IncidentDetail() {
  const { id } = useParams();
  const { state, dispatch } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const i = state.incidents.find(x => x.id === id) || state.incidents[0];
  if (!i) return <div className="card">인시던트 없음</div>;
  const idx = INC_FLOW.indexOf(i.status) < 0 ? 0 : INC_FLOW.indexOf(i.status);
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Incident Detail</div>
      <h1 className="page-title">{i.id}</h1>
      <div className="card"><b>대응 상태</b>
        <div className="mt"><Steps steps={['접수(open)', '조사(investigating)', '해소(resolved)']} current={i.status === 'resolved' ? undefined : idx} done={i.status === 'resolved'} /></div>
        <div className="row mt">
          {idx < INC_FLOW.length - 1
            ? <button className="btn primary" onClick={() => dispatch({ t: 'INCIDENT_STATUS', id: i.id, status: INC_FLOW[idx + 1] })}>다음 단계 → {INC_FLOW[idx + 1]}</button>
            : <span className="pill" style={{ background: 'var(--pass)', color: '#fff' }}>해소 완료</span>}
        </div>
      </div>
      <div className="card"><div className="kv">
        <div>Feature</div><div className="mono">{i.feature}</div>
        <div>Title</div><div>{i.title}</div>
        <div>Severity</div><div><span className="badge" style={{ background: i.severity === 'high' ? 'var(--fail)' : 'var(--pending)' }}>{i.severity}</span></div>
        <div>Root Cause</div><div>{i.cause}</div>
        <div>Linked CR</div><div className="mono">{i.linkedCR}</div>
        <div>액션</div><div><button className="btn danger" onClick={() => toast('Rollback 실행 — 직전 정상 정책 복귀', 'warn')}>Rollback</button> <button className="btn" onClick={() => nav('/ops/' + i.feature)}>Kill Switch →</button></div>
      </div></div>
    </div>
  );
}
