import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast, useApp, useLiveSlices, PIPELINE_STAGES } from '../store';
import { costSummary, fmtWon, readiness } from '../data/engine';
import { fleetStats } from '../data/fleet';
import { AreaChart, Donut, Bars, RadialProgress, Steps, Timeline, CountUp, LiveDot, tally, dist } from '../components/charts';
import { SeverityBadge } from '../components/ui';
import TopoLink from '../components/TopoLink';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const CMP_COLOR: Record<string, string> = { PASS: '#1F9D55', PENDING: '#D9822B', BLOCK: '#D64545' };

// ── 실험 (store 연동) ──
function ExperimentWidget() {
  const { state, dispatch } = useApp();
  const exps = state.experiments;
  return (
    <div><b>실험 · 효과 검증 (store 연동)</b>
      <div className="row mt">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>상태 분포</b>
          <Donut size={120} center={`${exps.length}`} segments={dist(tally(exps, e => e.status), { Running: '#1F9D55', Draft: '#D9822B', Stopped: '#9CA3AF' })} /></div>
        <div className="col card" style={{ flex: 2 }}><b>실험별 Uplift(%) <LiveDot /></b>
          <div className="mt"><Bars data={Object.fromEntries(exps.map(e => [e.id, Math.max(0, e.uplift)]))} fmt={n => '+' + n.toFixed(1) + '%'} /></div></div>
      </div>
      <div className="row mt"><button className="btn primary" onClick={() => dispatch({ t: 'ADD_EXPERIMENT', exp: { id: `EXP-${1000 + exps.length}`, feature: 'FEAT-BDC-001', variant: '신규 A/B', metric: '활성화율', status: 'Draft', uplift: 0 } })}>+ 실험 생성</button></div>
      <div className="table-wrap mt"><table><thead><tr><th>ID</th><th>Feature</th><th>Variant</th><th>Metric</th><th>Uplift</th><th>상태</th><th>제어</th></tr></thead>
        <tbody>{exps.map(e => (<tr key={e.id}><td className="mono">{e.id}</td><td className="mono">{e.feature}</td><td>{e.variant}</td><td>{e.metric}</td>
          <td style={{ color: e.uplift > 0 ? 'var(--pass)' : 'var(--muted)' }}>{e.uplift ? '+' + e.uplift + '%' : '-'}</td>
          <td><span className="badge" style={{ background: e.status === 'Running' ? 'var(--pass)' : e.status === 'Stopped' ? 'var(--fail)' : 'var(--pending)' }}>{e.status}</span></td>
          <td>{e.status !== 'Running' ? <button className="btn" onClick={() => dispatch({ t: 'EXP_STATUS', id: e.id, status: 'Running' })}>▶ 시작</button> : <button className="btn danger" onClick={() => dispatch({ t: 'EXP_STATUS', id: e.id, status: 'Stopped' })}>■ 중단</button>}</td></tr>))}</tbody></table></div>
      <p className="small muted mt">Running 실험의 Uplift는 실시간 틱으로 변동. 변경은 저장·유지됩니다 (FR-EXP).</p>
    </div>
  );
}

// ── 예외 정책 (store 연동) ──
function ExceptionWidget() {
  const { state, dispatch } = useApp();
  return (
    <div><b>예외 정책 (긴급 우회·만료 관리)</b>
      <div className="row mt"><button className="btn primary" onClick={() => dispatch({ t: 'ADD_EXCEPTION', exc: { id: `EXC-2026-${100 + state.exceptions.length}`, feature: 'FEAT-BDC-001', reason: '긴급 우회', approver: state.role, expiry: '2026-06-20', active: true } })}>+ 예외 승인 요청</button></div>
      <div className="table-wrap mt"><table><thead><tr><th>ID</th><th>Feature</th><th>사유</th><th>승인자</th><th>만료</th><th>상태</th><th></th></tr></thead>
        <tbody>{state.exceptions.map(e => (<tr key={e.id}><td className="mono">{e.id}</td><td className="mono">{e.feature}</td><td>{e.reason}</td><td>{e.approver}</td><td>{e.expiry}</td>
          <td><span className="badge" style={{ background: e.active ? 'var(--pending)' : 'var(--muted)' }}>{e.active ? 'Active' : 'Revoked'}</span></td>
          <td>{e.active && <button className="btn" onClick={() => dispatch({ t: 'EXC_REVOKE', id: e.id })}>해제</button>}</td></tr>))}</tbody></table></div>
    </div>
  );
}

// ── 정책 충돌 (store edges 연동 + 해소) ──
function ConflictWidget() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const conflicts = state.edges.filter(e => e.type === 'excludes' || e.type === 'overrides');
  const resolve = (c: any) => { dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 09:00', actor: state.role, action: 'CONFLICT_RESOLVE', target: `${c.source}→${c.target}`, detail: c.type === 'overrides' ? '우선순위 상위 적용' : '동시활성 차단 확정' } }); toast(`충돌 해소: ${c.source} ${c.type} ${c.target}`, 'ok'); };
  return (
    <div><b>정책 충돌 탐지·해소 (excludes/overrides 자동 산출)</b>
      <div className="row mt">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>충돌 유형</b>
          <Donut size={120} center={`${conflicts.length}`} segments={dist(tally(conflicts, c => c.type), { excludes: '#D64545', overrides: '#D9822B' })} /></div>
        <div className="col card" style={{ flex: 2 }}>
          <div className="table-wrap"><table><thead><tr><th>Source</th><th>Type</th><th>Target</th><th>해소</th></tr></thead>
            <tbody>{conflicts.map(c => (<tr key={c.id}><td className="mono">{c.source}</td>
              <td><span className="badge" style={{ background: c.type === 'overrides' ? 'var(--pending)' : 'var(--fail)' }}>{c.type}</span></td><td className="mono">{c.target}</td>
              <td><button className="btn" onClick={() => resolve(c)}>{c.type === 'overrides' ? '우선순위 적용' : '차단 확정'}</button></td></tr>))}
              {!conflicts.length && <tr><td colSpan={4} className="muted">충돌 없음</td></tr>}</tbody></table></div>
        </div>
      </div>
      <p className="small muted mt">Edge Editor에서 excludes/overrides 추가 시 즉시 반영. 해소는 Audit에 기록 (FR-CON).</p>
    </div>
  );
}

// ── 컴플라이언스 (store 연동 · 검증 실행) ──
function ComplianceWidget() {
  const { state, dispatch } = useApp();
  const checks = state.compliance;
  const regions = ['KR', 'EU', 'US', 'CN'];
  const feats = [...new Set(checks.map(c => c.feature))];
  const at = (f: string, r: string) => checks.find(c => c.feature === f && c.region === r);
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>지역 법규·개인정보·안전 룰 → 배포 전 자동 검증</b>
        <button className="btn primary" onClick={() => dispatch({ t: 'RUN_COMPLIANCE' })}>▶ 검증 실행</button>
      </div>
      {!checks.length ? <p className="muted small mt">'검증 실행'을 누르면 차종 × 지역(KR/EU/US/CN) 컴플라이언스를 평가합니다.</p> : <>
        <div className="row mt">
          <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>상태 분포</b>
            <Donut size={120} center={`${checks.length}`} segments={dist(tally(checks, c => c.status), CMP_COLOR)} /></div>
          <div className="col card" style={{ flex: 2 }}><b>차종 × 지역 매트릭스</b>
            <div className="table-wrap mt"><table><thead><tr><th>Feature</th>{regions.map(r => <th key={r}>{r}</th>)}</tr></thead>
              <tbody>{feats.map(f => <tr key={f}><td className="mono">{f}</td>{regions.map(r => { const c = at(f, r); return <td key={r}>{c ? <span className="badge" style={{ background: CMP_COLOR[c.status] }} title={c.reason}>{c.status}</span> : '-'}</td>; })}</tr>)}</tbody></table></div>
          </div>
        </div>
        <div className="table-wrap mt"><table><thead><tr><th>지역</th><th>Feature</th><th>상태</th><th>사유</th></tr></thead>
          <tbody>{checks.filter(c => c.status !== 'PASS').map((c, i) => <tr key={i}><td>{c.region}</td><td className="mono">{c.feature}</td><td><span className="badge" style={{ background: CMP_COLOR[c.status] }}>{c.status}</span></td><td className="small">{c.reason}</td></tr>)}
            {checks.every(c => c.status === 'PASS') && <tr><td colSpan={4} className="muted">차단/보류 없음 ✓</td></tr>}</tbody></table></div>
      </>}
    </div>
  );
}

// ── 시나리오 검증 (store 연동 · 단계 시뮬) ──
const SCN_STEPS = ['초기화', '차종 조합', '권한 평가', '활성화 흐름', '결과 집계'];
function ScenarioWidget() {
  const { dispatch } = useApp();
  const { scenarios: scs } = useLiveSlices();
  const agg = scs.reduce((a, s) => ({ pass: a.pass + s.pass, fail: a.fail + s.fail }), { pass: 0, fail: 0 });
  const done = scs.filter(s => s.status === 'done').length;
  return (
    <div><b>차량 시나리오 대량 검증 (차종·상태·권한 조합)</b>
      <div className="row mt">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>PASS / FAIL</b>
          <Donut size={120} center={`${agg.pass + agg.fail}`} segments={[{ label: 'PASS', value: agg.pass || (done ? 0 : 1), color: '#1F9D55' }, { label: 'FAIL', value: agg.fail, color: '#D64545' }]} /></div>
        <div className="col card" style={{ maxWidth: 200, alignItems: 'center' }}><b>실행 커버리지</b>
          <RadialProgress size={110} value={Math.round(done / (scs.length || 1) * 100)} label={`${done}/${scs.length} 시나리오`} /></div>
        <div className="col card"><b>실행 안내</b><p className="small muted mt">'실행'을 누르면 2초 틱마다 단계가 진행되어 결과가 집계됩니다(약 5% 실패 가정). FR-SCN·FR-SVL.</p></div>
      </div>
      <div className="table-wrap mt"><table><thead><tr><th>시나리오</th><th>건수</th><th>진행</th><th>결과</th><th></th></tr></thead>
        <tbody>{scs.map(s => <tr key={s.id}>
          <td><b>{s.name}</b><div className="small muted mono">{s.id}</div></td>
          <td>{s.total}</td>
          <td style={{ minWidth: 260 }}><Steps steps={SCN_STEPS} current={s.status === 'done' ? undefined : s.step} done={s.status === 'done'} /></td>
          <td>{s.status === 'done' ? <span className="small"><b style={{ color: 'var(--pass)' }}>{s.pass} PASS</b> / <b style={{ color: 'var(--fail)' }}>{s.fail} FAIL</b></span> : s.status === 'running' ? <span className="muted small">실행 중…</span> : <span className="muted small">대기</span>}</td>
          <td><button className="btn" disabled={s.status === 'running'} onClick={() => dispatch({ t: 'RUN_SCENARIO', id: s.id })}>▶ 실행</button></td>
        </tr>)}</tbody></table></div>
    </div>
  );
}

// ── CI/CD 파이프라인 (store 연동 · Quality Gate=9-Gate 가드) ──
function CICDWidget() {
  const { dispatch } = useApp();
  const nav = useNavigate();
  const p = useLiveSlices().pipeline;
  const r = readiness('FEAT-BDC-001');
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>CI/CD 파이프라인 · 품질 Gate (SW배포 ≠ Feature 출시 분리)</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => dispatch({ t: 'RUN_PIPELINE' })} disabled={p.status === 'running'}>{p.status === 'running' ? '실행 중…' : '▶ 파이프라인 실행'}</button>
          {(p.status === 'running' || p.status === 'blocked') && <button className="btn" onClick={() => dispatch({ t: 'PIPELINE_STEP' })}>{p.status === 'blocked' ? '관리자 승인 우회 →' : '다음 단계 →'}</button>}
        </div>
      </div>
      <div className="mt"><Steps steps={PIPELINE_STAGES} current={p.status === 'done' ? undefined : (p.stage < 0 ? undefined : p.stage)} done={p.status === 'done'} /></div>
      {p.status === 'blocked' && <div className="decision HOLD mt">⛔ Quality Gate 차단 — FEAT-BDC-001 9-Gate {r.passCount}/9 ({r.decision}). Gate 충족 또는 관리자 승인 우회 필요.</div>}
      {p.status === 'done' && <div className="decision RELEASE mt" style={{ background: '#EAF2FF', color: 'var(--brand)', border: '1px solid var(--brand)' }}>🎉 Release 완료 — 단계적 출시는 <b style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => nav('/activation')}>Activation</b> / <b style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => nav('/ops/campaign')}>출시와 차량 적용</b>에서 제어.</div>}
      <div className="card mt" style={{ background: 'var(--surface-2)' }}><b>실행 로그</b>
        {p.logs.length ? p.logs.map((l, i) => <div className="evt small" key={i}>{l}</div>) : <p className="muted small mt">파이프라인 실행 전</p>}
      </div>
      <div className="row mt"><button className="btn" onClick={() => nav('/readiness/FEAT-BDC-001')}>9-Gate(Quality Gate) 보기 →</button></div>
    </div>
  );
}

// ── 과금 (store 연동 · 사용량 실시간 정산) ──
function BillingWidget() {
  const { dispatch } = useApp();
  const nav = useNavigate();
  const subs = useLiveSlices().subscriptions;
  const total = subs.reduce((a, s) => a + s.revenueWon, 0);
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>구독·옵션 과금 · 사용량 실시간 정산</b>
        <button className="btn" onClick={() => dispatch({ t: 'ADD_SUBSCRIPTION', sub: { feature: 'FEAT-PARK-001', right: '옵션', plan: 'Parking Pack', qty: 12000, revenueWon: 12000 * 9000 } })}>+ 구독 추가</button>
      </div>
      <div className="kpis mt">
        <div className="kpi"><div className="v">{fmtWon(total)}</div><div className="l">누적 매출(추정)</div></div>
        <div className="kpi"><div className="v"><CountUp value={subs.reduce((a, s) => a + s.qty, 0)} /></div><div className="l">구독 차량(대)</div></div>
        <div className="kpi"><div className="v">{subs.length}</div><div className="l">과금 항목</div></div>
      </div>
      <div className="row mt">
        <div className="col card" style={{ flex: 2 }}><b>Feature별 매출 <LiveDot /></b><div className="mt"><Bars data={Object.fromEntries(subs.map(s => [s.feature, s.revenueWon]))} fmt={fmtWon} /></div></div>
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>플랜 비중</b><Donut size={120} center={`${subs.length}`} segments={dist(tally(subs, s => s.plan))} /></div>
      </div>
      <div className="table-wrap mt"><table><thead><tr><th>Feature</th><th>권한</th><th>플랜</th><th>구독 차량</th><th>매출(추정)</th><th></th></tr></thead>
        <tbody>{subs.map((s, i) => <tr key={i}><td className="mono">{s.feature}</td><td><span className="pill">{s.right}</span></td><td>{s.plan}</td><td>{s.qty.toLocaleString()}대</td><td className="mono">{fmtWon(s.revenueWon)}</td>
          <td><button className="btn" onClick={() => nav('/activation')}>활성화 제어 →</button></td></tr>)}</tbody></table></div>
      <p className="small muted mt">사용량(구독 차량)은 실시간 틱으로 증가하며 매출에 반영. 권한(entitlement)은 Activation Control과 연동 (FR-BIL).</p>
    </div>
  );
}

// ── 글로벌·현장·사업 지표 (파생 KPI) ──
function BusinessWidget() {
  const { state } = useApp();
  const feats = state.features;
  const released = feats.filter(f => f.lifecycle === 'Released').length;
  const cost = costSummary();
  const activeModels = new Set(Object.entries(state.activation).filter(([, a]) => a.enabled && !a.killed).map(([k]) => k.split('@')[1])).size;
  return (
    <div>
      <div className="kpis">
        <div className="kpi"><div className="v"><CountUp value={Math.round(released / (feats.length || 1) * 100)} suffix="%" /></div><div className="l">글로벌 출시율(Released)</div></div>
        <div className="kpi"><div className="v"><CountUp value={activeModels} /></div><div className="l">활성 차종 수</div></div>
        <div className="kpi"><div className="v">{fmtWon(cost.totalEst)}</div><div className="l">총 예상 개발비</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--pass)' }}>-32%</div><div className="l">출시 리드타임(가설)</div></div>
      </div>
      <div className="row mt">
        <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>권역별 차량</b>
          <Donut size={130} center="10.2M" segments={[
            { label: 'KR', value: Math.round(fleetStats.byRegion.KR / 1e5), color: '#0B5FFF' },
            { label: 'EU', value: Math.round(fleetStats.byRegion.EU / 1e5), color: '#16A34A' },
            { label: 'US', value: Math.round(fleetStats.byRegion.US / 1e5), color: '#D9822B' },
            { label: 'ETC', value: Math.round(fleetStats.byRegion.ETC / 1e5), color: '#9333EA' }]} /></div>
        <div className="col card" style={{ flex: 2 }}><b>도메인별 예상 개발비</b><div className="mt"><Bars data={cost.byDomain} fmt={fmtWon} /></div></div>
      </div>
      <p className="small muted mt">권역/법규/브랜드 차등 · 판매·정비 포털 · 사업 KPI를 운영 데이터에서 파생 (FR-GLB/FSP/BIZ).</p>
    </div>
  );
}

// ── 보안 운영 (store 연동) ──
function SecurityWidget() {
  const { state, dispatch } = useApp();
  const sec = state.security;
  const certs = [...sec.certs].sort((a, b) => a.expiry.localeCompare(b.expiry));
  return (
    <div>
      <div className="kpis">
        <div className="kpi"><div className="v" style={{ color: sec.signing ? 'var(--pass)' : 'var(--fail)' }}>{sec.signing ? '적용' : '미적용'}</div><div className="l">정책 서명·무결성</div></div>
        <div className="kpi"><div className="v">{sec.certs.length}</div><div className="l">인증서/키</div></div>
        <div className="kpi"><div className="v" style={{ color: sec.vulns.some(v => v.status === 'open') ? 'var(--fail)' : 'var(--pass)' }}>{sec.vulns.filter(v => v.status !== 'patched').length}</div><div className="l">미조치 취약점</div></div>
      </div>
      <div className="row mt">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>취약점 Severity</b>
          <Donut size={120} center={`${sec.vulns.length}`} segments={dist(tally(sec.vulns, v => v.severity), { B: '#D64545', W: '#D9822B', I: '#3B82F6' })} /></div>
        <div className="col card"><b>인증서/키 만료 일정</b>
          <Timeline items={certs.map(c => ({ ts: c.expiry, title: c.name, detail: '유효', tag: '인증서' }))} /></div>
      </div>
      <div className="table-wrap mt"><table><thead><tr><th>ID</th><th>Severity</th><th>Feature</th><th>제목</th><th>상태</th><th>조치</th></tr></thead>
        <tbody>{sec.vulns.map(v => <tr key={v.id}><td className="mono">{v.id}</td><td><SeverityBadge code={v.severity} /></td><td className="mono">{v.feature}</td><td className="small">{v.title}</td><td><span className="pill">{v.status}</span></td>
          <td>{v.status !== 'patched' ? <>{v.status === 'open' && <button className="btn" onClick={() => dispatch({ t: 'ACK_VULN', id: v.id, status: 'ack' })}>확인</button>} <button className="btn primary" onClick={() => dispatch({ t: 'ACK_VULN', id: v.id, status: 'patched' })}>패치</button></> : '✓'}</td></tr>)}
          {!sec.vulns.length && <tr><td colSpan={6} className="muted">취약점 없음 ✓</td></tr>}</tbody></table></div>
      <p className="small muted mt">정책 서명·무결성 검증, 인증서/키 수명주기, 취약점 추적 (FR-SRT/SDM/CIV/VHM/SVS). 정합성은 <b>Consistency Console</b> 연계.</p>
    </div>
  );
}

// 공통: 기준 화면 래퍼 — 동작 위젯
function SpecScreen({ title, sub, widget }:
  { title: string; sub: string; widget?: ReactNode }) {
  return (
    <div>
      <Breadcrumb />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <PageTitle fallback={title} />
        <TopoLink />
      </div>
      <p className="page-sub">{sub}</p>
      {widget && <div className="card">{widget}</div>}
    </div>
  );
}

export const Experiment = () => <SpecScreen title="실험 · 효과 검증 (Experiments)" sub="타겟팅 · 효과 측정 · 안전 기준 기반 실험 운영" widget={<ExperimentWidget />} />;
export const Conflict = () => <SpecScreen title="정책 충돌 탐지·해소 (Policy Conflict)" sub="중복·충돌 정책 자동 탐지 + 우선순위 해소 (Topology Consistency 연계)" widget={<ConflictWidget />} />;
export const Exception = () => <SpecScreen title="예외 정책 관리 (Exception Policy)" sub="긴급 예외 승인 · 임시 우회 · 만료 자동 관리" widget={<ExceptionWidget />} />;
export const Compliance = () => <SpecScreen title="컴플라이언스 룰 체커 (Compliance)" sub="지역 법규·개인정보·안전/보안 룰 → 배포 전 자동 검증·차단" widget={<ComplianceWidget />} />;
export const Scenario = () => <SpecScreen title="차량 시나리오 검증 (Scenario)" sub="차종·상태·권한 조합 대량 시나리오 사전 실행" widget={<ScenarioWidget />} />;
export const CICD = () => <SpecScreen title="CI/CD 파이프라인 · 품질 Gate" sub="SW배포/Feature출시 분리 · 단계적 배포 · 품질 Gate" widget={<CICDWidget />} />;
export const Billing = () => <SpecScreen title="과금 시스템 연계 (Billing)" sub="구독·옵션 과금 · 사용량 정산 연계" widget={<BillingWidget />} />;
export const Business = () => <SpecScreen title="글로벌 출시 · 현장 지원 · 사업 지표" sub="권역/법규/브랜드 차등 · 판매·정비 포털 · 사업 KPI" widget={<BusinessWidget />} />;
export const Security = () => <SpecScreen title="보안 운영 (Security Ops)" sub="안전 요구사항 추적 · 보안 배포 · 인증·키 · 취약점 · 이상징후" widget={<SecurityWidget />} />;
