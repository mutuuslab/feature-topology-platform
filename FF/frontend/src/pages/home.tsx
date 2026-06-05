import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roles, permMatrix } from '../data/refdata';
import { useApp, roleHome } from '../store';

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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">내 대시보드 / Role Home</h1>
        <select value={role} onChange={e => change(e.target.value)} style={{ padding: 6 }}>{roles.map(r => <option key={r}>{r}</option>)}</select>
      </div>
      <p className="page-sub">현재 역할 <b>{role}</b> → 기본 랜딩 <span className="mono">{roleHome[role]}</span></p>
      <div className="card" style={{ padding: '10px 14px' }}>
        <b>이 역할의 권한(verb)</b>{' '}
        {['view', 'create', 'edit', 'approve', 'run-engine', 'deploy', 'kill', 'rollback', 'admin'].map(v => (
          <span key={v} className="pill" style={{ marginRight: 4, opacity: verbs.includes(v) ? 1 : 0.35 }}>{verbs.includes(v) ? '✓' : '✕'} {v}</span>
        ))}
      </div>
      <div className="kpis">
        <div className="kpi"><div className="v">10.24M</div><div className="l">Fleet 차량</div></div>
        <div className="kpi"><div className="v">8/9</div><div className="l">BDC Gates PASS</div></div>
        <div className="kpi"><div className="v">Policy-only</div><div className="l">BDC Deploy</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--pass)' }}>{state.live.activation}%</div><div className="l">활성화(실시간)</div></div>
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
