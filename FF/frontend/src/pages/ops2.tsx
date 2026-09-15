import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { telemetry } from '../data/model';
import { useToast, useApp, ROLLOUT_STEPS, POLICY_STAGES } from '../store';
import { RightPanel } from '../components/patterns';
import { AreaChart, GaugeArc, LiveDot, Donut, Bars, Steps, tally, dist } from '../components/charts';
import TopoLink from '../components/TopoLink';
import { useTwinOptional } from '../state/twinStore';
import { Breadcrumb } from '../components/Breadcrumb';

export function OTACampaign() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const campaigns = state.campaigns;
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">OTA Campaign Manager</h1>
      <p className="page-sub">단계적 롤아웃(5→20→50→100%) · 각 단계 telemetry 가드 통과 시 진행 (FR-ROL/TGT)</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Status 분포</b>
          <Donut size={120} center={`${campaigns.length}`} segments={dist(tally(campaigns, c => c.status))} /></div>
        <div className="col card" style={{ flex: 2 }}><b>Campaign Rollout % <LiveDot /></b>
          <div className="mt"><Bars data={Object.fromEntries(campaigns.map(c => [c.id, c.rollout]))} fmt={n => n + '%'} /></div></div>
      </div>
      <div className="card"><table><thead><tr><th>Campaign</th><th>Feature</th><th>Type</th><th>Cohort</th><th>Rollout</th><th>Status</th><th>단계 진행</th><th>자동 배포</th></tr></thead>
        <tbody>{campaigns.map(c => (<tr key={c.id}>
          <td className="mono" style={{ cursor: 'pointer' }} onClick={() => nav('/ops/campaign/' + c.id)}>{c.id}</td><td className="mono">{c.feature}</td><td><span className="pill">{c.type}</span></td>
          <td>{c.cohort}</td><td><b>{c.rollout}%</b></td><td><span className="pill">{c.status}</span></td>
          <td><button className="btn" disabled={c.rollout >= 100 || c.auto} onClick={() => dispatch({ t: 'CAMPAIGN_ADVANCE', id: c.id })}>{c.rollout >= 100 ? '완료' : `▶ ${ROLLOUT_STEPS[c.step + 1] || 100}%`}</button></td>
          <td><button className={'btn' + (c.auto ? ' primary' : '')} disabled={c.rollout >= 100} onClick={() => dispatch({ t: 'CAMPAIGN_AUTO', id: c.id })}>{c.auto ? '🟢 AUTO' : 'AUTO'}</button></td></tr>))}</tbody></table>
        <p className="small muted mt">수동: telemetry 가드(실패율 &lt;5%) 통과 시 단계 진행. <b>AUTO</b>: 메트릭 기반 자동 승급(실패율 ≤5%)·자동 롤백(실패율 &gt;8%). 현재 실패율 {state.live.failRate}% (FR-ROL/PDA).</p>
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
      <Breadcrumb title="Campaign Detail" />
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
      <Breadcrumb />
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
  const { state, dispatch } = useApp();
  const live = state.live;
  const toast = useToast();
  const [sel, setSel] = useState<any>(null);
  const openInc = state.incidents.filter(i => i.status !== 'resolved').length;
  // FR-QFL 품질 피드백 루프: 실시간 지표·VOC → 개선 액션 도출
  const feedback = [
    live.failRate > 2 && { k: '정책 적용 실패', d: `실패율 ${live.failRate}% — 타겟팅 룰 단순화/검증 강화`, feature: 'FEAT-BDC-001' },
    live.rollback > 3 && { k: '롤백 빈발', d: `롤백 ${live.rollback}회 — Safe Default·가드 임계 점검`, feature: 'FEAT-BDC-001' },
    live.p95 > 60 && { k: '지연 상승', d: `p95 ${live.p95}ms — 정책 평가 경로 최적화`, feature: 'FEAT-BDC-001' },
    openInc > 0 && { k: 'VOC/인시던트', d: `미해소 인시던트 ${openInc}건 — 원인분석→개선 반영`, feature: 'FEAT-CONN-001' },
  ].filter(Boolean) as { k: string; d: string; feature: string }[];
  const toCR = (f: any) => { const n = 143 + state.crs.filter(c => c.id.startsWith('CR-2026')).length; dispatch({ t: 'CREATE_CR', cr: { id: `CR-2026-0${n}`, feature: f.feature, type: `품질개선: ${f.k}`, status: 'Draft', owner: state.role, risk: 'Low' } }); dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 09:20', actor: state.role, action: 'QFL_FEEDBACK', target: f.feature, detail: f.d } }); toast('품질 피드백 → CR 생성됨', 'ok'); };
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Telemetry Explorer · FEAT-BDC-001 <LiveDot /></h1>
        <TopoLink />
      </div>
      <Breadcrumb />
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
      <div className="card mt"><b>품질 피드백 루프 (VOC·품질 데이터 → 개선) <LiveDot /></b>
        <p className="small muted">실시간 지표·인시던트에서 개선 액션을 도출해 변경요청(CR)으로 반영 (FR-QFL)</p>
        {feedback.length ? feedback.map((f, i) => (
          <div className="evt" key={i}><span className="pill" style={{ background: 'var(--pending)', color: '#fff' }}>{f.k}</span><span className="muted small">{f.d}</span>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => toCR(f)}>CR로 반영 →</button></div>
        )) : <div className="evt"><span className="muted small">현재 임계 초과 항목 없음 — 품질 양호 ✓</span></div>}
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
  const twin = useTwinOptional();
  const twinIncidents = twin?.snapshot.incidents ?? [];
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Incident Manager</h1>
      {twin && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Digital Twin Closed Loop Incident ({twinIncidents.length})</b>
            <button className="btn primary" onClick={() => nav('/twin/incident')}>Twin Incident 콘솔 →</button>
          </div>
          <p className="small muted mt">차량 이상은 VIN 단위 Twin 상태에서 먼저 감지된다. 원인 분석 → Rollout 중단 → Kill-Switch/부분 복구 → 재수렴 확인까지 12단계 Closed Loop 로 처리한다.</p>
          {twinIncidents.length ? (
            <div className="table-wrap mt"><table><thead><tr><th>Incident</th><th>Feature</th><th>심각도</th><th>상태</th><th>영향 VIN</th><th>원인</th></tr></thead>
              <tbody>{twinIncidents.map(i => (
                <tr key={i.incidentId} role="button" tabIndex={0} onClick={() => nav('/twin/incident')} onKeyDown={e => { if (e.key === 'Enter') nav('/twin/incident'); }}>
                  <td className="mono">{i.incidentId}</td>
                  <td className="mono">{i.featureId}</td>
                  <td><span className="badge" style={{ background: i.severity === 'SEV-1' ? 'var(--fail)' : i.severity === 'SEV-2' ? 'var(--pending)' : 'var(--info)' }}>{i.severity}</span></td>
                  <td><span className="pill">{i.status}</span></td>
                  <td>{i.affectedVins.length}대</td>
                  <td className="small mono">{i.fault}</td>
                </tr>))}</tbody></table></div>
          ) : <p className="small muted mt">현재 Open Twin Incident 없음 — Fault Injection 으로 Closed Loop 를 시연할 수 있다.</p>}
        </div>
      )}
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
      <Breadcrumb title="Incident Detail" />
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
        <div>액션</div><div><button className="btn danger" onClick={() => { dispatch({ t: 'RECOVER', feature: i.feature }); dispatch({ t: 'INCIDENT_STATUS', id: i.id, status: 'resolved' }); dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 09:35', actor: state.role, action: 'ROLLBACK', target: i.feature, detail: `${i.id} 직전 정상 정책 복귀` } }); toast('Rollback 실행 — runtime 복구·인시던트 해소', 'ok'); }}>Rollback (복구)</button> <button className="btn" onClick={() => nav('/ops/' + i.feature)}>Kill Switch →</button></div>
      </div></div>
    </div>
  );
}
