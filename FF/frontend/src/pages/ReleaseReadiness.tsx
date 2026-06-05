import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { readiness, getFeature } from '../data/engine';
import { GateBadge } from '../components/ui';
import SpecLink from '../components/SpecLink';
import { useApp, useToast } from '../store';
import { Donut } from '../components/charts';
import TopoLink from '../components/TopoLink';

const GATE_FLOW: Record<string, string[]> = {
  G1: ['Owner 확인', 'Lifecycle ≥ Approved'],
  G2: ['Requirement Trace', 'derives 링크 검증'],
  G3: ['Variant Rule 조회', 'Applicability 유효'],
  G4: ['Safe Default', 'Rollback', 'Kill 가용'],
  G5: ['Mandatory Test', 'Evidence 매칭', 'Missing 산출'],
  G6: ['Supplier 매핑', 'API Contract 영향'],
  G7: ['ASIL/Security 등급', 'Gate 기록'],
  G8: ['배포방식 확정', '채널 설정'],
  G9: ['Telemetry 연결', 'Audit·Alert 준비'],
};

export default function ReleaseReadiness() {
  const { id = 'FEAT-BDC-001' } = useParams();
  const f = getFeature(id);
  const r = readiness(id);
  const { can } = useApp();
  const toast = useToast();
  const [sim, setSim] = useState(-1); // -1 idle, 0..8 running, 9 done
  useEffect(() => { if (sim >= 0 && sim < 9) { const t = setTimeout(() => setSim(sim + 1), 800); return () => clearTimeout(t); } }, [sim]);
  const counts = { PASS: r.gates.filter(g => g.status === 'PASS').length, PENDING: r.gates.filter(g => g.status === 'PENDING').length, FAIL: r.gates.filter(g => g.status === 'FAIL').length };
  const gate = (verb: string, label: string, onOk: () => void, primary = false) => can(verb)
    ? <button className={primary ? 'btn primary' : 'btn'} disabled={primary && r.decision === 'HOLD'} onClick={onOk}>{label}</button>
    : <span className="btn" style={{ opacity: .45, cursor: 'not-allowed' }} title={`권한 필요: ${verb}`}>🔒 {label}</span>;
  return (
    <div>
      <div className="breadcrumb">검증 / Verification ▸ Release Readiness ▸ <span className="mono">{id}</span></div>
      <h1 className="page-title">Release Readiness Center</h1>
      <p className="page-sub">{f?.displayName} — {r.passCount}/9 PASS</p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <SpecLink families={['FR-REG', 'FR-DSV']} />
        <TopoLink id={id} />
      </div>

      <div className="row">
        <div className="col card" style={{ maxWidth: 320 }}>
          <b>9-Gate 요약</b>
          <Donut size={120} segments={[
            { label: 'PASS', value: counts.PASS, color: 'var(--pass)' },
            { label: 'PENDING', value: counts.PENDING, color: 'var(--pending)' },
            { label: 'FAIL', value: counts.FAIL, color: 'var(--fail)' },
          ]} />
        </div>
        <div className="col card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <b>실시간 게이트 시뮬레이션</b>
            <button className="btn primary" onClick={() => setSim(0)} disabled={sim >= 0 && sim < 9}>{sim >= 0 && sim < 9 ? '평가 중…' : '▶ 시뮬레이션'}</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
            {r.gates.map((g, i) => {
              const reached = sim >= i || sim === 9 || sim === -1;
              const running = sim === i;
              const status = sim === -1 ? g.status : reached ? g.status : 'IDLE';
              const bg = running ? 'var(--brand)' : status === 'PASS' ? 'var(--pass)' : status === 'PENDING' ? 'var(--pending)' : status === 'FAIL' ? 'var(--fail)' : 'var(--surface-3)';
              const col = status === 'IDLE' && !running ? 'var(--muted)' : '#fff';
              return <span key={g.id} className="pill" style={{ background: bg, color: col }}>{g.id}{running ? ' ⏳' : ''}</span>;
            })}
          </div>
          {sim >= 0 && sim < 9 && (
            <div className="small">
              <b>{r.gates[sim].name} Gate flow</b>
              <div className="mt">{(GATE_FLOW[r.gates[sim].id] || []).map(s => <span key={s} className="pill" style={{ marginRight: 4 }}>{s}</span>)}</div>
              <p className="muted mt">{r.gates[sim].detail}</p>
            </div>
          )}
          {sim === 9 && <div className={`decision ${r.decision}`}>시뮬레이션 완료 → {r.passCount}/9 PASS · {r.decision}</div>}
        </div>
      </div>
      <div className="card">
        <div className="gates">
          {r.gates.map((g, i) => (
            <div className="gate" key={g.id}>
              <div className="n"><span>{i+1}. {g.name}</span><GateBadge status={g.status} /></div>
              <div className="d">{g.detail}</div>
            </div>
          ))}
        </div>
        <div className={`decision ${r.decision}`}>
          {r.decision === 'HOLD' ? '🔴 Production 활성화 보류 (HOLD)' : '🟢 RELEASE 가능'}
          {r.decision === 'HOLD' && <span className="small"> — 조건: PENDING/FAIL Gate 해소 후 재평가</span>}
        </div>
        <div className="mt" style={{ display: 'flex', gap: 8 }}>
          {gate('run-engine', 'Re-evaluate', () => toast(`9-Gate 재평가: ${r.passCount}/9 PASS · ${r.decision}`))}
          {gate('approve', 'Request Approval', () => toast('승인 요청 전송 (Approver 라우팅)'))}
          {gate('deploy', 'Release (deploy)', () => toast(r.decision === 'HOLD' ? 'HOLD — 미통과 Gate 해소 필요' : 'Released 전환', r.decision === 'HOLD' ? 'warn' : 'ok'), true)}
        </div>
      </div>
    </div>
  );
}
