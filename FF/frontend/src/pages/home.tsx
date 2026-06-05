import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roles, permMatrix, users, campaigns } from '../data/refdata';
import { useApp, roleHome } from '../store';
import { StatTile, AreaChart, Donut, Bars, RadialProgress, LiveDot, Timeline, tally, dist } from '../components/charts';
import { fleetStats } from '../data/fleet';
import { catalogStats, costSummary, fmtWon, consistency, readiness } from '../data/engine';

const LC_COLOR: Record<string, string> = { Proposed: '#8895A7', Approved: '#3B82F6', Developing: '#6366F1', Verified: '#0EA5E9', Released: '#1F9D55', Retired: '#9CA3AF' };

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

const ROLE_FOCUS: Record<string, { title: string; desc: string; views: [string, string][] }> = {
  '기획 P1': { title: '기획 · 카탈로그/요구사항 중심', desc: 'Feature 정의·우선순위·기대효과', views: [['Catalog', '/catalog'], ['Feature 등록', '/master/define'], ['Reports', '/insights/reports']] },
  '시스템 P2': { title: '시스템 · 토폴로지/정합성 중심', desc: '아키텍처 관계·일관성 규칙', views: [['Topology', '/topology/FEAT-BDC-001'], ['Consistency', '/consistency'], ['Metamodel', '/metamodel']] },
  'SW P3': { title: 'SW · 의사결정/영향분석 중심', desc: '변경 영향·배포방식 결정·BOM', views: [['Decision Center', '/decisions/center'], ['Impact', '/impact'], ['BOM Editor', '/master/bom']] },
  '검증 P4': { title: '검증 · Gate/증적 중심', desc: 'Release Readiness·테스트 증적', views: [['Release Readiness', '/readiness/FEAT-BDC-001'], ['Test Evidence', '/verify/evidence'], ['Coverage', '/spec/coverage']] },
  'OTA P5': { title: 'OTA · 캠페인/정책 중심', desc: '롤아웃·정책 생애주기·활성화', views: [['OTA Campaign', '/ops/campaign'], ['Policy Lifecycle', '/ops/policy'], ['Activation', '/activation']] },
  '협력사 P6': { title: '협력사 · 패키지/인수 중심', desc: 'API 릴리스 패키지·인수 기준', views: [['Supplier Portal', '/supplier/portal'], ['Release Package', '/supplier/package']] },
  '운영 P7': { title: '운영 · Kill Switch/텔레메트리 중심', desc: '실시간 운영·인시던트·Fleet', views: [['Ops Dashboard', '/ops/FEAT-BDC-001'], ['Telemetry', '/ops/telemetry'], ['Incident', '/ops/incident'], ['Fleet', '/fleet']] },
  'Admin': { title: '관리자 · 권한/감사 중심', desc: '사용자·권한·감사 로그', views: [['Permissions', '/admin/permissions'], ['Users', '/admin/users'], ['Audit', '/insights/audit']] },
};

export function RoleHome() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const role = state.role;
  const verbs = permMatrix[role] || [];
  // 대시보드에서는 역할만 전환하고 화면을 유지 — 부서를 바꾸면 대시보드 내용이 그 역할에 맞게 갱신됨
  const change = (r: string) => dispatch({ t: 'ROLE', role: r });
  const focus = ROLE_FOCUS[role] || ROLE_FOCUS['기획 P1'];
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
            <div className="sub">현대자동차 SDV · {fleetStats.total.toLocaleString()}대 운영 · 현재 역할 <b>{role}</b> · 기본 랜딩 {roleHome[role]}</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <label className="small" style={{ opacity: .9 }}>부서/역할 전환</label>
            <select value={role} onChange={e => change(e.target.value)} style={{ padding: 6, borderRadius: 6, border: 'none', minWidth: 140 }}>{roles.map(r => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: '1px solid rgba(255,255,255,.4)' }} onClick={() => nav(roleHome[role] || '/')}>내 워크스페이스로 이동 →</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div><b>{focus.title}</b><div className="muted small">{focus.desc}</div></div>
          <div className="row" style={{ gap: 6 }}>
            {focus.views.map(([l, to]) => <button key={to} className="btn" onClick={() => nav(to)}>{l} →</button>)}
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: '10px 14px' }}>
        <b>이 역할의 권한(verb)</b>{' '}
        {['view', 'create', 'edit', 'approve', 'run-engine', 'deploy', 'kill', 'rollback', 'admin'].map(v => (
          <span key={v} className="pill" style={{ marginRight: 4, opacity: verbs.includes(v) ? 1 : 0.35 }}>{verbs.includes(v) ? '✓' : '✕'} {v}</span>
        ))}
      </div>
      <RoleDashboardBody role={role} state={state} nav={nav} />
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

// 부서/역할별 대시보드 본문 — 역할을 바꾸면 그 관점의 KPI·차트·작업/경고로 전환
function RoleDashboardBody({ role, state, nav }: { role: string; state: any; nav: (to: string) => void }) {
  const live = state.live;
  const feats = state.features;
  const crs = state.crs;

  // ── 기획 P1: 카탈로그·요구사항·기대효과 ──
  if (role === '기획 P1') {
    const cat = catalogStats();
    const cost = costSummary();
    return (<>
      <div className="kpis reveal">
        <StatTile label="총 Feature" value={feats.length} delta={+2} />
        <StatTile label="Released" value={cat.released} color="#1F9D55" />
        <StatTile label="개발 진행중" value={cat.developing} color="#6366F1" />
        <div className="kpi"><div className="v">{fmtWon(cost.totalEst)}</div><div className="l">총 예상 개발비</div></div>
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 260, alignItems: 'center' }}><b>Lifecycle 분포</b>
          <Donut size={130} center={`${feats.length}`} segments={dist(tally(feats, (f: any) => f.lifecycle), LC_COLOR)} /></div>
        <div className="col card" style={{ flex: 2 }}><b>도메인별 Feature 수</b><div className="mt"><Bars data={tally(feats, (f: any) => f.domain)} /></div></div>
      </div>
      <div className="row mt">
        <div className="col card"><b>내 작업 / My Work</b>
          <div className="evt" role="button" onClick={() => nav('/master/define')}><span className="pill">등록</span> 신규 Feature 후보 7-criteria 검토</div>
          <div className="evt" role="button" onClick={() => nav('/catalog')}><span className="pill">우선순위</span> Proposed {feats.filter((f: any) => f.lifecycle === 'Proposed').length}건 검토 대기</div>
        </div>
        <div className="col card"><b>경고 / Alerts</b>
          <div className="evt" role="button" onClick={() => nav('/consistency')}>⚠️ Missing Traceability {consistency().filter((v: any) => /trace/i.test(v.rule || v.message)).length || 1}건</div>
          <div className="evt" role="button" onClick={() => nav('/insights/reports')}>📈 기대효과 리포트 갱신 필요</div>
        </div>
      </div>
    </>);
  }

  // ── 시스템 P2: 토폴로지·정합성 ──
  if (role === '시스템 P2') {
    const vios = consistency();
    const blocking = vios.filter((v: any) => v.severity === 'blocking');
    const RULES = 12;
    return (<>
      <div className="kpis reveal">
        <StatTile label="총 Feature" value={feats.length} />
        <StatTile label="관계(Edge)" value={state.edges.length} color="#6366F1" />
        <StatTile label="정합성 위반" value={vios.length} color="#D9822B" />
        <StatTile label="Blocking" value={blocking.length} color="#D64545" />
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>위반 Severity</b>
          <Donut size={130} center={`${vios.length}`} segments={dist(tally(vios, (v: any) => v.severity), { blocking: '#D64545', warning: '#D9822B', info: '#3B82F6' })} /></div>
        <div className="col card" style={{ flex: 2 }}><b>Rule별 위반</b><div className="mt"><Bars data={tally(vios, (v: any) => v.rule)} /></div></div>
        <div className="col card" style={{ maxWidth: 200, alignItems: 'center' }}><b>정합성 점수</b>
          <RadialProgress size={110} color={blocking.length ? '#D64545' : '#1F9D55'} value={Math.round((RULES - new Set(vios.map((v: any) => v.rule)).size) / RULES * 100)} label={`${RULES - new Set(vios.map((v: any) => v.rule)).size}/${RULES} Rule`} /></div>
      </div>
      <div className="row mt">
        <div className="col card"><b>경고 / Blocking 위반</b>
          {(blocking.length ? blocking : vios).slice(0, 4).map((v: any, i: number) => <div className="evt" key={i} role="button" onClick={() => nav('/consistency')}><span className="pill" style={{ background: v.severity === 'blocking' ? 'var(--fail)' : 'var(--pending)', color: '#fff' }}>{v.rule}</span><span className="muted small">{v.message}</span></div>)}
        </div>
      </div>
    </>);
  }

  // ── SW P3: 변경·영향·CR ──
  if (role === 'SW P3') {
    const pend = crs.filter((c: any) => c.status !== 'Closed' && c.status !== 'Implemented');
    const high = crs.filter((c: any) => c.risk === 'High');
    return (<>
      <div className="kpis reveal">
        <StatTile label="전체 CR" value={crs.length} />
        <StatTile label="진행중 CR" value={pend.length} color="#6366F1" />
        <StatTile label="High Risk" value={high.length} color="#D64545" />
        <StatTile label="BOM 영역" value={11} color="#0EA5E9" />
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>CR Status</b>
          <Donut size={120} center={`${crs.length}`} segments={dist(tally(crs, (c: any) => c.status))} /></div>
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>Risk 분포</b>
          <Donut size={120} segments={dist(tally(crs, (c: any) => c.risk), { High: '#D64545', Med: '#D9822B', Low: '#1F9D55' })} /></div>
        <div className="col card" style={{ flex: 2 }}><b>유형별 CR</b><div className="mt"><Bars data={tally(crs, (c: any) => c.type)} /></div></div>
      </div>
      <div className="row mt">
        <div className="col card"><b>내 작업 / 분석 대기 CR</b>
          {(pend.length ? pend : crs).slice(0, 4).map((c: any) => <div className="evt" key={c.id} role="button" onClick={() => nav('/change/cr/' + c.id)}><span className="pill">{c.status}</span><span className="mono small">{c.id}</span><span className="muted small">{c.feature}</span></div>)}
          <button className="btn primary mt" onClick={() => nav('/cr-wizard')}>+ CR 생성</button>
        </div>
      </div>
    </>);
  }

  // ── 검증 P4: Gate·커버리지·증적 ──
  if (role === '검증 P4') {
    const r = readiness('FEAT-BDC-001');
    const counts = { PASS: 0, PENDING: 0, FAIL: 0 };
    (r.gates || []).forEach((g: any) => { counts[(g.status as 'PASS' | 'PENDING' | 'FAIL')] = (counts[(g.status as 'PASS' | 'PENDING' | 'FAIL')] || 0) + 1; });
    const verified = feats.filter((f: any) => f.lifecycle === 'Verified' || f.lifecycle === 'Released').length;
    return (<>
      <div className="kpis reveal">
        <StatTile label="9-Gate PASS" value={r.passCount} suffix="/9" color="#1F9D55" />
        <div className="kpi"><div className="v" style={{ color: r.decision === 'RELEASE' ? 'var(--pass)' : 'var(--pending)' }}>{r.decision}</div><div className="l">Release 판정</div></div>
        <StatTile label="Verified+ Feature" value={verified} color="#0EA5E9" />
        <StatTile label="총 Feature" value={feats.length} />
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>9-Gate 진척</b>
          <RadialProgress size={120} color={r.decision === 'RELEASE' ? '#1F9D55' : '#D9822B'} value={Math.round(r.passCount / 9 * 100)} label={`${r.passCount}/9 PASS`} /></div>
        <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>Gate 상태 분포</b>
          <Donut size={130} segments={[{ label: 'PASS', value: counts.PASS, color: '#1F9D55' }, { label: 'PENDING', value: counts.PENDING, color: '#D9822B' }, { label: 'FAIL', value: counts.FAIL, color: '#D64545' }]} /></div>
        <div className="col card"><b>바로가기</b>
          <div className="row mt"><button className="btn" onClick={() => nav('/readiness/FEAT-BDC-001')}>Release Readiness →</button><button className="btn" onClick={() => nav('/verify/evidence')}>Test Evidence →</button><button className="btn" onClick={() => nav('/spec/coverage')}>Coverage →</button></div>
        </div>
      </div>
      <div className="row mt">
        <div className="col card"><b>경고 / Gate 미통과</b>
          {(r.gates || []).filter((g: any) => g.status !== 'PASS').slice(0, 4).map((g: any, i: number) => <div className="evt" key={i} role="button" onClick={() => nav('/readiness/FEAT-BDC-001')}><span className="pill" style={{ background: g.status === 'FAIL' ? 'var(--fail)' : 'var(--pending)', color: '#fff' }}>{g.status}</span><span className="muted small">{g.name || g.id}</span></div>)}
        </div>
      </div>
    </>);
  }

  // ── OTA P5: 캠페인·롤아웃·정책 ──
  if (role === 'OTA P5') {
    const avgRollout = Math.round(campaigns.reduce((s, c) => s + (c.rollout || 0), 0) / (campaigns.length || 1));
    return (<>
      <div className="kpis reveal">
        <StatTile label="활성 캠페인" value={campaigns.length} color="#0EA5E9" />
        <StatTile label="평균 Rollout" value={avgRollout} suffix="%" color="#6366F1" />
        <StatTile label="활성화(실시간)" value={live.activation} decimals={1} suffix="%" data={live.series} color="#1F9D55" />
        <StatTile label="Rollback(실시간)" value={live.rollback} color="#D64545" />
      </div>
      <div className="row">
        <div className="col card" style={{ flex: 2 }}><b>활성화율 (실시간) <LiveDot /></b>
          <AreaChart data={live.series} height={150} min={88} max={100} fmt={n => n.toFixed(0) + '%'} /></div>
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>캠페인 상태</b>
          <Donut size={120} center={`${campaigns.length}`} segments={dist(tally(campaigns, c => c.status))} /></div>
      </div>
      <div className="row mt">
        <div className="col card"><b>진행 캠페인</b>
          {campaigns.slice(0, 4).map(c => <div className="evt" key={c.id} role="button" onClick={() => nav('/ops/campaign')}><span className="pill">{c.status}</span><span className="mono small">{c.id}</span><span className="muted small">{c.rollout}% · {c.cohort}</span></div>)}
        </div>
        <div className="col card"><b>바로가기</b>
          <div className="row mt"><button className="btn" onClick={() => nav('/ops/campaign')}>OTA Campaign →</button><button className="btn" onClick={() => nav('/ops/policy')}>Policy Lifecycle →</button><button className="btn" onClick={() => nav('/activation')}>Activation →</button></div>
        </div>
      </div>
    </>);
  }

  // ── 협력사 P6: 패키지·인수 ──
  if (role === '협력사 P6') {
    const valid = 8, total = 10; // API Release Package 체크리스트 기준
    return (<>
      <div className="kpis reveal">
        <StatTile label="담당 Feature" value={1} />
        <StatTile label="패키지 완료율" value={Math.round(valid / total * 100)} suffix="%" color="#1F9D55" />
        <StatTile label="인수 대기" value={total - valid} color="#D9822B" />
        <StatTile label="Contract Gap" value={1} color="#D64545" />
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>패키지 완료율</b>
          <RadialProgress size={120} color="#1F9D55" value={Math.round(valid / total * 100)} label={`${valid}/${total} 항목`} /></div>
        <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>항목 상태</b>
          <Donut size={130} segments={[{ label: 'valid', value: valid, color: '#1F9D55' }, { label: 'partial', value: total - valid, color: '#D9822B' }]} /></div>
        <div className="col card"><b>바로가기</b>
          <div className="row mt"><button className="btn" onClick={() => nav('/supplier/portal')}>Supplier Portal →</button><button className="btn" onClick={() => nav('/supplier/package')}>Release Package →</button></div>
        </div>
      </div>
    </>);
  }

  // ── Admin: 권한·감사·사용자 ──
  if (role === 'Admin') {
    const audit = state.audit || [];
    return (<>
      <div className="kpis reveal">
        <StatTile label="사용자" value={users.length} />
        <StatTile label="역할" value={roles.length} color="#6366F1" />
        <StatTile label="감사 로그" value={audit.length} color="#0EA5E9" />
        <StatTile label="권한 Verb" value={9} color="#9333EA" />
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 260, alignItems: 'center' }}><b>사용자 역할 분포</b>
          <Donut size={130} center={`${users.length}`} segments={dist(tally(users, u => u.role.split(' ')[0]))} /></div>
        <div className="col card"><b>최근 감사 로그</b>
          {audit.length ? <Timeline items={audit.slice(0, 6).map((a: any) => ({ ts: a.ts, title: a.action, detail: a.target, tag: a.actor }))} /> : <p className="muted small">기록 없음</p>}
        </div>
      </div>
      <div className="row mt">
        <div className="col card"><b>바로가기</b>
          <div className="row mt"><button className="btn" onClick={() => nav('/admin/permissions')}>Permissions →</button><button className="btn" onClick={() => nav('/admin/users')}>Users →</button><button className="btn" onClick={() => nav('/insights/audit')}>Audit →</button></div>
        </div>
      </div>
    </>);
  }

  // ── 운영 P7 (기본): 실시간 텔레메트리·Fleet ──
  return (<>
    <div className="kpis reveal">
      <StatTile label="Fleet 차량" value={10.24} decimals={2} suffix="M" delta={2} />
      <StatTile label="활성화(실시간)" value={live.activation} decimals={1} suffix="%" data={live.series} color="#1F9D55" delta={+(live.activation - 97).toFixed(1)} />
      <StatTile label="정책 적용 실패" value={live.failRate} decimals={1} suffix="%" color="#D64545" />
      <StatTile label="p95 Latency" value={live.p95} suffix="ms" color="#D9822B" />
    </div>
    <div className="row">
      <div className="col card" style={{ flex: 2 }}><b>Fleet 활성화율 (실시간) <LiveDot /></b>
        <AreaChart data={live.series} height={150} min={88} max={100} fmt={n => n.toFixed(0) + '%'} /></div>
      <div className="col card"><b>권역별 차량</b>
        <Donut size={120} center="10.2M" segments={[
          { label: 'KR', value: Math.round(fleetStats.byRegion.KR / 1e5), color: '#0B5FFF' },
          { label: 'EU', value: Math.round(fleetStats.byRegion.EU / 1e5), color: '#16A34A' },
          { label: 'US', value: Math.round(fleetStats.byRegion.US / 1e5), color: '#D9822B' },
          { label: 'ETC', value: Math.round(fleetStats.byRegion.ETC / 1e5), color: '#9333EA' }]} /></div>
      <div className="col card ticker"><b>실시간 이벤트 <LiveDot /></b>
        {live.events.slice(0, 5).map((e: any, i: number) => <div className="evt" key={e.ts + i}><span className="pill">{e.type}</span><span className="muted small">{e.ts}</span></div>)}</div>
    </div>
    <div className="row mt">
      <div className="col card"><b>경고 / Alerts</b>
        <div className="evt" role="button" onClick={() => nav('/ops/FEAT-BDC-001')}>❗ FEAT-BDC-001 실패율 임계 초과</div>
        <div className="evt" role="button" onClick={() => nav('/ops/incident')}>⚠️ 인시던트 모니터링</div>
      </div>
      <div className="col card"><b>바로가기</b>
        <div className="row mt"><button className="btn" onClick={() => nav('/ops/FEAT-BDC-001')}>Ops · Kill Switch →</button><button className="btn" onClick={() => nav('/ops/telemetry')}>Telemetry →</button><button className="btn" onClick={() => nav('/fleet')}>Fleet →</button></div>
      </div>
    </div>
  </>);
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
