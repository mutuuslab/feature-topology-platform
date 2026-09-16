import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { readiness, getFeature, verification, relationsOf } from '../data/engine';
import { GateBadge } from '../components/ui';
import { useApp, useToast } from '../store';
import { useTwinOptional } from '../state/twinStore';
import { RecBadge, KvRow } from '../components/twin';
import { FEATURE_ID, FEATURE_VERSION } from '../data/twin/types';
import { Donut, RadialProgress, Steps } from '../components/charts';
import TopoLink from '../components/TopoLink';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

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
  const twin = useTwinOptional();
  const nav = useNavigate();
  const [sim, setSim] = useState(-1); // -1 idle, 0..8 running, 9 done
  useEffect(() => { if (sim >= 0 && sim < 9) { const t = setTimeout(() => setSim(sim + 1), 800); return () => clearTimeout(t); } }, [sim]);
  const counts = { PASS: r.gates.filter(g => g.status === 'PASS').length, PENDING: r.gates.filter(g => g.status === 'PENDING').length, FAIL: r.gates.filter(g => g.status === 'FAIL').length };
  const gate = (verb: string, label: string, onOk: () => void, primary = false) => can(verb)
    ? <button className={primary ? 'btn primary' : 'btn'} disabled={primary && r.decision === 'HOLD'} onClick={onOk}>{label}</button>
    : <span className="btn" style={{ opacity: .45, cursor: 'not-allowed' }} title={`권한 필요: ${verb}`}>🔒 {label}</span>;
  return (
    <div>
      <Breadcrumb title={id} />
      <PageTitle fallback="Release Readiness Center" />
      <p className="page-sub">{f?.displayName} — {r.passCount}/9 PASS</p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <TopoLink id={id} />
      </div>

      <div className="row">
        <div className="col card" style={{ maxWidth: 360 }}>
          <b>9-Gate 요약</b>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <RadialProgress value={Math.round(r.passCount / 9 * 100)} size={96} color={r.decision === 'RELEASE' ? '#1F9D55' : '#D9822B'} label={`${r.passCount}/9 PASS`} />
            <Donut size={110} center={`${r.passCount}/9`} segments={[
              { label: 'PASS', value: counts.PASS, color: '#1F9D55' },
              { label: 'PENDING', value: counts.PENDING, color: '#D9822B' },
              { label: 'FAIL', value: counts.FAIL, color: '#D64545' },
            ]} /></div>
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
        {twin && (() => {
          const gates = twin.simResult.qualityGates;
          const failed = gates.filter(g => g.status === 'FAIL');
          const warns = gates.filter(g => g.status === 'WARN');
          const status: 'PASS' | 'WARN' | 'FAIL' | 'NOT_RUN' = failed.length ? 'FAIL' : warns.length ? 'WARN' : twin.impact.gate.qualityGatePassed ? 'PASS' : 'NOT_RUN';
          const bg = status === 'PASS' ? 'var(--pass)' : status === 'FAIL' ? 'var(--fail)' : status === 'WARN' ? 'var(--pending)' : 'var(--surface-3)';
          const col = status === 'NOT_RUN' ? 'var(--muted)' : '#fff';
          return (
            <div className="col card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <b>Twin What-if Gate <span className="badge" style={{ background: bg, color: col }}>{status}</span></b>
                <div>
                  <button className="btn" onClick={() => nav('/twin/simulation')}>What-if Simulation →</button>{' '}
                  <button className="btn" onClick={() => nav('/twin/impact')}>Twin Impact Preview</button>
                </div>
              </div>
              <p className="small muted mt">Simulation Twin 이 실제 차량과 동일한 Policy Evaluator · Local Guard 로 What-if 를 수행한 결과다. 이 Gate 를 통과하지 않으면 Production 승격 대상이 아니다.</p>
              <div className="kv mt">
                <KvRow k="Simulation ID"><span className="mono">{twin.simResult.simulationId}</span></KvRow>
                <KvRow k="Feature">{FEATURE_ID} v{FEATURE_VERSION}</KvRow>
                <KvRow k="입력 Policy Version"><span className="mono small">{twin.simResult.inputs.policyVersion}</span></KvRow>
                <KvRow k="최종 판정"><RecBadge value={twin.simResult.reconciliation} /> <span className="small muted">{twin.simResult.reasonCode.code}</span></KvRow>
                <KvRow k="Quality Gate">{gates.filter(g => g.status === 'PASS').length}/{gates.length} PASS{failed.length ? ` · FAIL ${failed.length}` : ''}{warns.length ? ` · WARN ${warns.length}` : ''}</KvRow>
                <KvRow k="증적"><span className="small">{twin.simResult.evidence.length}건 ({twin.simResult.evidence.map(e => e.kind).join(', ')})</span></KvRow>
              </div>
            </div>
          );
        })()}
      </div>

      {(() => {
        const v = verification(id);
        const reqLinks = relationsOf(id).filter(rl => rl.type === 'derives');
        const covered = v.mandatoryTests.length - v.missingEvidence.length;
        const tracePct = Math.round(covered / (v.mandatoryTests.length || 1) * 100);
        return (
          <div className="row">
            <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>설계→검증 추적성 (DSV)</b>
              <RadialProgress size={120} color={v.missingEvidence.length ? '#D9822B' : '#1F9D55'} value={tracePct} label={`${covered}/${v.mandatoryTests.length} 증적 매핑`} />
              <div className="small muted mt">요구사항(derives) {reqLinks.length}건 연결</div>
            </div>
            <div className="col card" style={{ flex: 2 }}><b>설계 검증 추적 매트릭스 (요구 ↔ 테스트 ↔ 증적)</b>
              <div className="mt"><Steps steps={['요구사항', '설계', '검증 케이스', '증적', 'Gate']} current={v.missingEvidence.length ? 3 : undefined} done={!v.missingEvidence.length} /></div>
              <div className="table-wrap mt"><table><thead><tr><th>Mandatory Test</th><th>증적</th><th>Gate 기여</th></tr></thead>
                <tbody>{v.mandatoryTests.map(t => { const miss = v.missingEvidence.includes(t); return (
                  <tr key={t}><td className="mono">{t}</td>
                    <td><span className="badge" style={{ background: miss ? 'var(--pending)' : 'var(--pass)' }}>{miss ? 'Missing' : '확보'}</span></td>
                    <td className="small muted">{miss ? 'G5 Verification PENDING 원인' : 'G5 기여'}</td></tr>); })}</tbody></table></div>
              {v.missingEvidence.length > 0 && <div className="decision HOLD mt">미매핑 증적 {v.missingEvidence.length}건 → 설계검증(DSV) 미완 · G5 PENDING</div>}
            </div>
          </div>
        );
      })()}

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
