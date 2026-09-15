import { useState } from 'react';
import { useApp, useToast } from '../store';
import { sampleVehicles, vehicleFeatureStates, STATE_COLOR } from '../data/fleet';
import { telemetry } from '../data/model';
import { GaugeArc, Donut, Steps, LiveDot, tally, dist } from '../components/charts';
import TopoLink from '../components/TopoLink';
import { Breadcrumb } from '../components/Breadcrumb';

// FR-AUTH(런타임 Authoring) · FR-RTE(런타임 평가) · FR-LPC(로컬 정책 캐시) — 차량/ECU 런타임 시뮬
export default function RuntimeSim() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const live = state.live;
  const [fid, setFid] = useState('FEAT-BDC-001');
  const [policy, setPolicy] = useState('IF region IN (KR,EU) AND trim=Premium AND sw>=3.2.0 THEN enable');
  const [published, setPublished] = useState(false);
  const [vin, setVin] = useState(sampleVehicles[0]?.vin || '');

  const veh = sampleVehicles.find(v => v.vin === vin) || sampleVehicles[0];
  const states = veh ? vehicleFeatureStates(veh, state.activation) : [];
  const enabled = states.filter(s => s.state === 'enabled').length;
  const bundleId = `BND-${fid}-${String(live.tick).padStart(4, '0')}`;
  const hash = 'sha256:' + (Array.from(fid).reduce((a, c) => a + c.charCodeAt(0), 0) * 131 + live.tick).toString(16).padStart(8, '0');

  const publish = () => { setPublished(true); dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 09:10', actor: state.role, action: 'POLICY_PUBLISH', target: fid, detail: `${bundleId} 서명·발행` } }); toast(`${bundleId} 서명·발행 (런타임 시뮬)`, 'ok'); };

  const stale = telemetry[fid]?.staleCacheCount ?? 0;
  const cohorts = [
    { name: 'KR Premium', vehicles: 142300, fresh: live.tick % 5 === 0 ? 'stale' : 'fresh' },
    { name: 'EU Standard', vehicles: 98200, fresh: 'fresh' },
    { name: 'US ADAS', vehicles: 38200, fresh: stale > 0 ? 'stale' : 'fresh' },
  ];

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Runtime 시뮬 · Authoring·평가·캐시 <LiveDot /></h1>
        <TopoLink id={fid} />
      </div>
      <Breadcrumb />
      <div className="decision INFO" style={{ background: '#EAF2FF', border: '1px solid var(--brand)', color: 'var(--brand)' }}>
        ⓘ 차량/ECU 측 런타임 동작을 앱 안에서 재현한 시뮬레이터입니다. 실제 백엔드(정책 서명 서버·OTA·ECU) 연동 시 데이터 소스만 교체됩니다.
      </div>

      {/* FR-AUTH 런타임 Authoring */}
      <div className="card">
        <b>① 런타임 Authoring · 정책 서명·번들 발행 (FR-AUTH)</b>
        <div className="row mt" style={{ alignItems: 'center' }}>
          <select value={fid} onChange={e => { setFid(e.target.value); setPublished(false); }} style={{ padding: 8 }}>{state.features.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}</select>
          <span className="muted small">대상 Feature</span>
        </div>
        <textarea value={policy} onChange={e => { setPolicy(e.target.value); setPublished(false); }} style={{ width: '100%', minHeight: 64, marginTop: 8, padding: 8, border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'var(--mono)' }} />
        <div className="mt"><Steps steps={['작성', '서명(Sign)', '번들(Bundle)', '발행(Publish)']} current={published ? undefined : 0} done={published} /></div>
        <div className="row mt" style={{ alignItems: 'center' }}>
          <button className="btn primary" onClick={publish}>서명 & 발행 →</button>
          {published && <span className="small mono">{bundleId} · {hash}</span>}
        </div>
      </div>

      {/* FR-RTE 런타임 평가 */}
      <div className="row">
        <div className="col card" style={{ flex: 2 }}>
          <b>② 런타임 평가 · VIN 단위 정책 적용 (FR-RTE)</b>
          <div className="row mt" style={{ alignItems: 'center' }}>
            <select value={vin} onChange={e => setVin(e.target.value)} style={{ padding: 8 }}>{sampleVehicles.map(v => <option key={v.vin} value={v.vin}>{v.vin} · {v.model}</option>)}</select>
            <span className="muted small">{veh?.region} · MY{veh?.my} · {veh?.trim} · SW {veh?.sw}</span>
          </div>
          <div className="table-wrap mt"><table><thead><tr><th>Feature</th><th>입력 평가</th><th>결정</th><th>사유</th></tr></thead>
            <tbody>{states.map(s => (<tr key={s.feature.id}><td className="mono">{s.feature.id}</td>
              <td className="small muted">region·trim·sw·hw → rule</td>
              <td><span className="badge" style={{ background: STATE_COLOR[s.state] }}>{s.state}</span></td>
              <td className="small">{s.reason}</td></tr>))}</tbody></table></div>
        </div>
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>적용 결과</b>
          <GaugeArc value={Math.round(enabled / (states.length || 1) * 100)} size={130} label={`${enabled}/${states.length} enabled`} />
          <Donut size={120} segments={dist(tally(states, s => s.state), { enabled: '#1F9D55', blocked: '#D64545', degraded: '#D9822B', apply_fail: '#9333EA' })} />
        </div>
      </div>

      {/* FR-LPC 로컬 정책 캐시 */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <b>③ 로컬 정책 캐시 · 코호트 신선도 (FR-LPC)</b>
          <button className="btn" onClick={() => toast('정책 캐시 새로고침 요청 — 차량 다음 접속 시 갱신', 'ok')}>캐시 새로고침</button>
        </div>
        <div className="table-wrap mt"><table><thead><tr><th>코호트</th><th>차량 수</th><th>캐시 상태</th><th>마지막 갱신</th></tr></thead>
          <tbody>{cohorts.map(c => (<tr key={c.name}><td>{c.name}</td><td>{c.vehicles.toLocaleString()}대</td>
            <td><span className="badge" style={{ background: c.fresh === 'fresh' ? 'var(--pass)' : 'var(--pending)' }}>{c.fresh === 'fresh' ? '최신' : 'stale(재검증 대기)'}</span></td>
            <td className="muted small">tick {live.tick} 기준</td></tr>))}</tbody></table></div>
        <p className="small muted mt">오프라인/stale 시 Safe Default 적용. Stale Cache {stale}건 (telemetry 기준).</p>
      </div>
    </div>
  );
}
