import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roles, permMatrix } from '../data/refdata';
import { useApp, roleHome } from '../store';
import { StatTile, AreaChart, Donut, LiveDot } from '../components/charts';
import { fleetStats } from '../data/fleet';

export function Login() {
  const nav = useNavigate();
  return (
    <div style={{ maxWidth: 380, margin: '60px auto' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 style={{ color: 'var(--brand)' }}>▣ Feature Topology</h2>
        <p className="muted small">SDV Feature Lifecycle & 통제 관리</p>
        <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={() => nav('/onboarding')}>Hyundai SSO 로그인</button>
        <input className="mt" placeholder="MFA 코드" style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
        <p className="muted small mt">테넌트: HMC-Global</p>
      </div>
    </div>
  );
}

export function Onboarding() {
  const nav = useNavigate();
  const [role, setRole] = useState('운영 P7');
  return (
    <div style={{ maxWidth: 480, margin: '40px auto' }}>
      <h1 className="page-title">온보딩 / Onboarding</h1>
      <div className="card">
        <p>역할을 확인하세요. 역할별 기본 대시보드가 설정됩니다.</p>
        <select value={role} onChange={e => setRole(e.target.value)} style={{ padding: 8, width: '100%' }}>{roles.map(r => <option key={r}>{r}</option>)}</select>
        <button className="btn primary mt" onClick={() => nav('/')}>시작하기 →</button>
      </div>
    </div>
  );
}

export function RoleHome() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const role = state.role;
  const verbs = permMatrix[role] || [];
  const change = (r: string) => { dispatch({ t: 'ROLE', role: r }); nav(roleHome[r] || '/'); };
  const QUICK: [string, string, string][] = [
    ['Catalog', '/catalog', 'view'], ['Topology', '/topology/FEAT-BDC-001', 'view'],
    ['Impact', '/impact', 'run-engine'], ['Release', '/readiness/FEAT-BDC-001', 'approve'],
    ['Kill Switch', '/ops/FEAT-BDC-001', 'kill'], ['CR 생성', '/cr-wizard', 'create'],
  ];
  return (
    <div>
      <div className="breadcrumb">홈 / Home ▸ 내 대시보드</div>
      <div className="hero">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h1 className="page-title">Feature Topology Platform <LiveDot /></h1>
            <div className="sub">현대자동차 SDV · {fleetStats.total.toLocaleString()}대 운영 · 현재 역할 <b>{role}</b> → 랜딩 {roleHome[role]}</div></div>
          <select value={role} onChange={e => change(e.target.value)} style={{ padding: 6, borderRadius: 6, border: 'none' }}>{roles.map(r => <option key={r}>{r}</option>)}</select>
        </div>
      </div>
      <div className="card" style={{ padding: '10px 14px' }}>
        <b>이 역할의 권한(verb)</b>{' '}
        {['view', 'create', 'edit', 'approve', 'run-engine', 'deploy', 'kill', 'rollback', 'admin'].map(v => (
          <span key={v} className="pill" style={{ marginRight: 4, opacity: verbs.includes(v) ? 1 : 0.35 }}>{verbs.includes(v) ? '✓' : '✕'} {v}</span>
        ))}
      </div>
      <div className="kpis reveal">
        <StatTile label="Fleet 차량" value={10.24} decimals={2} suffix="M" delta={2} />
        <StatTile label="활성화(실시간)" value={state.live.activation} decimals={1} suffix="%" data={state.live.series} color="#1F9D55" delta={+(state.live.activation - 97).toFixed(1)} />
        <StatTile label="정책 적용 실패" value={state.live.failRate} decimals={1} suffix="%" color="#D64545" />
        <StatTile label="p95 Latency" value={state.live.p95} suffix="ms" color="#D9822B" />
      </div>
      <div className="row">
        <div className="col card" style={{ flex: 2 }}><b>Fleet 활성화율 (실시간) <LiveDot /></b>
          <AreaChart data={state.live.series} height={150} min={88} max={100} fmt={n => n.toFixed(0) + '%'} /></div>
        <div className="col card"><b>권역별 차량</b>
          <Donut size={120} center="10.2M" segments={[
            { label: 'KR', value: Math.round(fleetStats.byRegion.KR / 1e5), color: '#0B5FFF' },
            { label: 'EU', value: Math.round(fleetStats.byRegion.EU / 1e5), color: '#16A34A' },
            { label: 'US', value: Math.round(fleetStats.byRegion.US / 1e5), color: '#D9822B' },
            { label: 'ETC', value: Math.round(fleetStats.byRegion.ETC / 1e5), color: '#9333EA' }]} /></div>
        <div className="col card ticker"><b>실시간 이벤트 <LiveDot /></b>
          {state.live.events.slice(0, 5).map((e, i) => <div className="evt" key={e.ts + i}><span className="pill">{e.type}</span><span className="muted small">{e.ts}</span></div>)}</div>
      </div>
      <div className="row mt">
        <div className="col card"><b>내 작업 / My Work</b>
          <div className="evt"><span className="pill">CR</span> CR-2026-0142 승인 대기</div>
          <div className="evt"><span className="pill">Gate</span> FEAT-SEAT-001 Gate 미통과</div>
        </div>
        <div className="col card"><b>경고 / Alerts</b>
          <div className="evt">❗ FEAT-BDC-001 실패율 임계 초과</div>
          <div className="evt">⚠️ FEAT-CONN-001 Missing Traceability</div>
        </div>
      </div>
      <div className="card mt"><b>바로가기 (역할 권한 반영)</b>
        <div className="row mt">
          {QUICK.map(([l, to, verb]) => verbs.includes(verb)
            ? <button key={to} className="btn" onClick={() => nav(to)}>{l}</button>
            : <span key={to} className="btn" style={{ opacity: .45, cursor: 'not-allowed' }} title={`권한 필요: ${verb}`}>🔒 {l}</span>)}
        </div>
        <p className="small muted mt">역할을 바꾸면 기본 랜딩·권한·잠금 버튼이 즉시 변경됩니다.</p>
      </div>
    </div>
  );
}

export function HomeCustomize() {
  const widgets = ['KPI Tiles','My Work','Alerts','Recent','Pinned Features','Telemetry'];
  return (
    <div>
      <div className="breadcrumb">홈 ▸ 커스터마이즈</div>
      <h1 className="page-title">홈 커스터마이즈</h1>
      <div className="card"><p className="muted">위젯을 드래그하여 배치(프로토타입)</p>
        <div className="row">{widgets.map(w => <span key={w} className="pill" style={{ padding: '8px 12px' }}>⠿ {w}</span>)}</div>
        <button className="btn primary mt">레이아웃 저장</button>
      </div>
    </div>
  );
}
