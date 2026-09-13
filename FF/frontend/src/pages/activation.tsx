import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store';
import { MODELS, sampleVehicles } from '../data/fleet';
import { Gauge, Heatmap } from '../components/charts';
import TopoLink from '../components/TopoLink';

export default function Activation() {
  const nav = useNavigate();
  const { state, dispatch, can } = useApp();
  const feats = state.features.filter(f => ['Approved', 'Verified', 'Released', 'Retired'].includes(f.lifecycle));
  const [fid, setFid] = useState(feats[0]?.id || 'FEAT-BDC-001');
  const key = (m: string) => `${fid}@${m}`;
  const act = (m: string) => state.activation[key(m)] || { enabled: false, rollout: 0, killed: false };
  const set = (m: string, patch: any) => can('deploy') || can('kill') ? dispatch({ t: 'SET_ACTIVATION', key: key(m), patch }) : dispatch({ t: 'TOAST', toast: { msg: '권한 필요: deploy/kill', kind: 'warn' } });
  const vehCount = (m: string) => sampleVehicles.filter(v => v.model === m).length;
  const enabledModels = MODELS.filter(m => act(m).enabled && !act(m).killed).length;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Activation Control · 차종별 활성/비활성</h1>
        <TopoLink id={fid} />
      </div>
      <p className="page-sub">특정 차종(모델)에 대해 Feature를 ON/OFF·롤아웃%·Kill — Fleet 차량 상태에 즉시 반영</p>

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <b>대상 Feature</b>
          <select value={fid} onChange={e => setFid(e.target.value)} style={{ padding: 8 }}>{feats.map(f => <option key={f.id} value={f.id}>{f.id} · {f.displayName}</option>)}</select>
          <span className="pill" style={{ marginLeft: 'auto' }}>{enabledModels}/{MODELS.length} 차종 활성</span>
          <button className="btn" onClick={() => nav('/fleet')}>Fleet에서 확인 →</button>
        </div>
      </div>

      <div className="card">
        <b>전체 Feature × 차종 활성화 Heatmap</b>
        <Heatmap rows={feats.slice(0, 10).map(f => f.id)} cols={MODELS}
          cell={(fidR, m) => { const a = state.activation[`${fidR}@${m}`]; if (!a) return { v: null, label: '–' };
            if (a.killed) return { v: 0.06, label: '⛔', title: 'Kill' };
            return a.enabled ? { v: Math.max(0.3, a.rollout / 100), label: a.rollout + '%', title: `ON ${a.rollout}%` } : { v: 0.12, label: 'off' }; }}
          legend="색 진할수록 rollout↑ · ⛔ Kill · – 정책 없음 · 행 클릭 대신 위 셀렉터로 편집" />
      </div>

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>차종(Model)</th><th>차량(샘플)</th><th>상태</th><th>Rollout</th><th>제어</th></tr></thead>
          <tbody>{MODELS.map(m => {
            const a = act(m);
            return (
              <tr key={m}>
                <td><b>{m}</b></td>
                <td className="muted">{vehCount(m)}대</td>
                <td><span className="badge" style={{ background: a.killed ? 'var(--fail)' : a.enabled ? 'var(--pass)' : 'var(--muted)' }}>{a.killed ? 'KILLED' : a.enabled ? 'ON' : 'OFF'}</span></td>
                <td style={{ minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="range" min={0} max={100} step={5} value={a.rollout} disabled={!a.enabled || a.killed}
                      onChange={e => set(m, { rollout: Number(e.target.value) })} style={{ flex: 1 }} />
                    <span className="mono small" style={{ width: 40 }}>{a.rollout}%</span>
                  </div>
                  <Gauge value={a.killed ? 0 : a.enabled ? a.rollout : 0} />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn" onClick={() => set(m, { enabled: !a.enabled, killed: false, rollout: !a.enabled ? (a.rollout || 100) : a.rollout })}>{a.enabled ? 'OFF' : 'ON'}</button>{' '}
                  <button className="btn danger" onClick={() => set(m, { killed: !a.killed })}>{a.killed ? '해제' : 'Kill'}</button>
                </td>
              </tr>
            );
          })}</tbody></table></div>
        <p className="small muted mt">토글·롤아웃·Kill은 store에 저장(새로고침 유지)되고 Fleet 차량별 상태에 반영됩니다. 권한: deploy/kill.</p>
      </div>
    </div>
  );
}
