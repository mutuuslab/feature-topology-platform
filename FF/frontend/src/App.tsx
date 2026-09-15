import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { useAppShell, useAppApi, roleHome } from './store';
import { NotFound } from './components/patterns';
import { roles, profileOf, roleLabel } from './data/refdata';
import { DOMAINS, DEMO_GROUPS, DEPT_NAV, PLANE_NAV, ITEM, domainOfPath, useT } from './i18n';
import { specPlaneOfPath } from './data/specPlanesNav';
import Catalog from './pages/Catalog';
import FeatureDetail from './pages/FeatureDetail';
const Topology = lazy(() => import('./pages/Topology')); // cytoscape 지연 로딩(초기 번들 분리)
import ImpactCenter from './pages/ImpactCenter';
import ReleaseReadiness from './pages/ReleaseReadiness';
import OpsDashboard from './pages/OpsDashboard';
import VariantMatrix from './pages/VariantMatrix';
import ConsistencyConsole from './pages/ConsistencyConsole';
import CRWizard from './pages/CRWizard';
import { Login, Onboarding, RoleHome, HomeCustomize } from './pages/home';
import { TaxonomyBrowser, TaxonomyEditor, BOMEditor, ArtifactCatalog, ControlPointCatalog } from './pages/master';
import { EdgeEditor, ViolationDetail, MetamodelViewer } from './pages/topology2';
import { VerificationScope, DeploymentDecision, SupplierScope, DecisionCenter, DecisionReport } from './pages/decisions';
import { CRList, CRDetail, ChangeSetList, BaselineDiff, VersionTimeline } from './pages/change';
import { TestEvidenceManager, EvidenceDetail } from './pages/verify';
import { OTACampaign, CampaignDetail, PolicyLifecycle, TelemetryExplorer, IncidentManager, IncidentDetail } from './pages/ops2';
import RuntimeSim from './pages/runtime';
import { SupplierPortal, APIReleasePackage, PackageDetail } from './pages/supplier';
import { ConnectorHub, ConnectorDetail, SyncLogs } from './pages/integration';
import { Reports, AuditLog, Glossary } from './pages/insights';
import { UsersRoles, PermissionsMatrix, OrgDomains, ApprovalWorkflow, Settings, NotificationsCenter, GlobalSearch } from './pages/admin';
import Cost from './pages/cost';
import Fleet from './pages/fleet';
import Activation from './pages/activation';
import Lifecycle from './pages/lifecycle';
import { Experiment, Conflict, Exception, Compliance, Scenario, CICD, Billing, Business, Security } from './pages/specnew';
// Digital Twin 계층은 초기 번들에서 분리한다(엔진 + 시뮬레이터 데이터 계층이 큼).
const TwinFleet = lazy(() => import('./pages/twin').then((m) => ({ default: m.TwinFleet })));
const TwinImpact = lazy(() => import('./pages/twin').then((m) => ({ default: m.TwinImpact })));
const TwinSimulation = lazy(() => import('./pages/twin').then((m) => ({ default: m.TwinSimulation })));
const TwinVehicle = lazy(() => import('./pages/twinOps').then((m) => ({ default: m.TwinVehicle })));
const TwinIncident = lazy(() => import('./pages/twinOps').then((m) => ({ default: m.TwinIncident })));
const TwinLive = lazy(() => import('./pages/twinLive').then((m) => ({ default: m.TwinLive })));
// Feature 등록은 Revision 규칙·등록 사전(R0 48 · 필수 20)을 쓰므로 초기 번들에서 분리한다.
const DefineRevision = lazy(() => import('./pages/defineRevision').then((m) => ({ default: m.DefineRevision })));
const FeatureBom = lazy(() => import('./pages/featureBom').then((m) => ({ default: m.FeatureBom })));
// UI05 Topology 동작 메커니즘은 그래프 엔진 + Twin 런타임을 함께 쓰므로 초기 번들에서 분리한다.
const TopologyArch = lazy(() => import('./pages/topologyArch').then((m) => ({ default: m.TopologyArch })));

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const { role, navMode, lang, theme } = useAppShell();
  const { dispatch } = useAppApi();
  const { t, navGroup, navItem, navDomain, deptLabel } = useT();
  const [navOpen, setNavOpen] = useState(false);
  const [activeDomain, setActiveDomain] = useState(() => domainOfPath(loc.pathname));
  useEffect(() => { setActiveDomain(domainOfPath(loc.pathname)); }, [loc.pathname]);
  // 사이트 최초 진입 시 기본 랜딩 = 현재 역할의 홈(기획 P1 → Feature Catalog). 이후 앱 내 '내 대시보드'로 이동 가능.
  const didLand = useRef(false);
  useEffect(() => {
    if (didLand.current) return;
    didLand.current = true;
    if (loc.pathname === '/') nav(roleHome[role] || '/catalog', { replace: true });
  }, []);
  const roleDomain = domainOfPath(roleHome[role] || '/');
  const dom = DOMAINS.find(d => d.key === activeDomain) || DOMAINS[0];
  // 업무 그룹에 속하지 않는 경로(예: /arch)에서는 레일 하이라이트 없이 기준 참조 목록을 보여준다.
  const refMode = !DOMAINS.some(d => d.key === activeDomain);
  // 부서별 보기
  const [activeDept, setActiveDept] = useState(role);
  useEffect(() => { setActiveDept(role); }, [role]);
  const deptObj = DEPT_NAV.find(d => d.role === activeDept) || DEPT_NAV[0];
  // Plane별 보기 — 대표 Plane은 경로가 정하고, 경로가 Plane 밖이면 현재 역할 기본 화면의 Plane을 쓴다.
  const planeDefault = () => specPlaneOfPath(loc.pathname) || specPlaneOfPath(roleHome[role] || '') || 'control';
  const [activePlane, setActivePlane] = useState(planeDefault);
  useEffect(() => { const p = specPlaneOfPath(loc.pathname); if (p) setActivePlane(p); }, [loc.pathname]);
  const planeObj = PLANE_NAV.find(p => p.key === activePlane) || PLANE_NAV[0];
  const setMode = (mode: 'function' | 'dept' | 'plane') => {
    dispatch({ t: 'SET_NAV_MODE', mode });
    if (mode === 'plane') setActivePlane(planeDefault());
  };
  const [q, setQ] = useState('');
  const submitSearch = () => { if (q.trim()) { nav('/catalog?q=' + encodeURIComponent(q.trim())); setNavOpen(false); } };
  const changeRole = (r: string) => { dispatch({ t: 'ROLE', role: r }); nav(roleHome[r] || '/'); };
  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <a className="skip" href="#main">{t('skip')}</a>
      <div className="topbar">
        <button className="hamburger" aria-label="menu" onClick={() => setNavOpen(o => !o)}>☰</button>
        <span className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>▣ FEATURE PLATFORM</span>
        <div className="search">
          <input aria-label="search" placeholder={t('search')} value={q}
            onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }} />
        </div>
        {(() => { const me = profileOf(role); return (
          <div className="user-chip" title={`${me.name} · 사번 ${me.empNo} · ${me.org}`}>
            <span className="avatar">{me.name.slice(0, 1)}</span>
            <span className="meta"><b>{me.name}</b><span className="muted">{me.empNo} · {me.org}</span></span>
          </div>
        ); })()}
        <select className="role-sel" aria-label={t('role')} value={role} onChange={e => changeRole(e.target.value)}>
          {roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <button className="icon-btn" title="language" aria-label="language" onClick={() => dispatch({ t: 'LANG', lang: lang === 'ko' ? 'en' : 'ko' })}>{lang.toUpperCase()}</button>
        <button className="icon-btn" title="theme" aria-label="theme" onClick={() => dispatch({ t: 'THEME', theme: theme === 'light' ? 'dark' : 'light' })}>{theme === 'light' ? '🌙' : '☀'}</button>
        <button className="icon-btn" title="notifications" aria-label="notifications" onClick={() => nav('/admin/notifications')}>🔔</button>
      </div>
      <nav className="nav" aria-label="primary">
        <div className="nav-mode">
          <button className={navMode === 'function' ? 'active' : ''} onClick={() => setMode('function')}>기능별</button>
          <button className={navMode === 'dept' ? 'active' : ''} onClick={() => setMode('dept')}>부서별</button>
          <button className={navMode === 'plane' ? 'active' : ''} onClick={() => setMode('plane')}>Plane별</button>
        </div>
        <div className="nav-body">
          {navMode === 'plane' ? <>
            <div className="rail">
              {PLANE_NAV.map(p => (
                <button key={p.key} className={'rail-btn' + (p.key === activePlane ? ' active' : '')} title={p.fullKo} aria-label={p.fullKo} aria-current={p.key === activePlane} onClick={() => setActivePlane(p.key)}>
                  <span className="ic">{p.icon}</span><span className="lb">{navDomain(p)}</span>
                </button>
              ))}
            </div>
            <div className="subnav" onClick={() => setNavOpen(false)}>
              <div className="subnav-head">{planeObj.icon} {navDomain({ ko: planeObj.fullKo, en: planeObj.fullEn })}</div>
              <div className="plane-meta">
                <div className="plane-row"><span className="muted small">산출물</span> {planeObj.produces}</div>
                <div className="plane-row"><span className="muted small">계약</span> {planeObj.contract}</div>
                <p className="muted small plane-note">{planeObj.note}</p>
              </div>
              {planeObj.groups.map(g => (
                <div key={g.ko}>
                  <div className="group">{navGroup(g)}</div>
                  {g.items.map(it => <NavLink key={it.to + it.ko} to={it.to} end={it.to === '/'}>{navItem(it)}</NavLink>)}
                </div>
              ))}
            </div>
          </> : navMode === 'function' ? <>
            <div className="rail">
              <button className="rail-btn" title="홈 · 내 대시보드" aria-label="홈 · 내 대시보드" onClick={() => nav('/')}>
                <span className="ic">🏠</span><span className="lb">홈</span>
              </button>
              {DOMAINS.map(d => (
                <button key={d.key} className={'rail-btn' + (d.key === activeDomain ? ' active' : '')} title={navDomain(d)} aria-label={navDomain(d)} aria-current={d.key === activeDomain} onClick={() => setActiveDomain(d.key)}>
                  <span className="ic">{d.icon}</span><span className="lb">{navDomain(d)}</span>
                  {d.key === roleDomain && <span className="role-dot" title="현재 역할 기본 영역" />}
                </button>
              ))}
            </div>
            <div className="subnav" onClick={() => setNavOpen(false)}>
              {refMode ? (
                <>
                  <div className="subnav-head">▣ 구현 화면 전체</div>
                  {DEMO_GROUPS.map(g => (
                    <div key={g.ko}>
                      <div className="group">{navGroup(g)}</div>
                      {g.items.map(it => <NavLink key={it.to + it.ko} to={it.to} end={it.to === '/'}>{navItem(it)}</NavLink>)}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="subnav-head">{dom.icon} {navDomain(dom)}</div>
                  {dom.groups.map(g => (
                    <div key={g.ko}>
                      <div className="group">{navGroup(g)}</div>
                      {g.items.map(it => <NavLink key={it.to + it.ko} to={it.to} end={it.to === '/'}>{navItem(it)}</NavLink>)}
                    </div>
                  ))}
                </>
              )}
            </div>
          </> : <>
            <div className="rail">
              {DEPT_NAV.map(d => (
                <button key={d.role} className={'rail-btn' + (d.role === activeDept ? ' active' : '')} title={deptLabel(d)} aria-label={deptLabel(d)} aria-current={d.role === activeDept} onClick={() => setActiveDept(d.role)}>
                  <span className="ic">{d.icon}</span><span className="lb">{deptLabel(d)}</span>
                  {d.role === role && <span className="role-dot" title="현재 역할" />}
                </button>
              ))}
            </div>
            <div className="subnav" onClick={() => setNavOpen(false)}>
              <div className="subnav-head">{deptObj.icon} {deptLabel(deptObj)} <span className="muted small">({deptObj.role})</span></div>
              {deptObj.sections.map(sec => (
                <div key={sec.ko}>
                  <div className="group">{deptLabel(sec)}</div>
                  {sec.paths.map(p => ITEM[p] ? <NavLink key={p} to={p} end={p === '/'}>{navItem(ITEM[p])}</NavLink> : null)}
                </div>
              ))}
            </div>
          </>}
        </div>
      </nav>
      <main className="main" id="main">
        <Suspense fallback={<div className="card">로딩 중…</div>}>
        <Routes>
          <Route path="/" element={<RoleHome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/home/customize" element={<HomeCustomize />} />
          <Route path="/search" element={<GlobalSearch />} />

          <Route path="/catalog" element={<Catalog />} />
          <Route path="/feature/:id" element={<FeatureDetail />} />
          <Route path="/master/define" element={<DefineRevision />} />
          <Route path="/master/taxonomy" element={<TaxonomyBrowser />} />
          <Route path="/master/taxonomy/edit" element={<TaxonomyEditor />} />
          <Route path="/master/bom" element={<FeatureBom />} />
          <Route path="/master/bom/items" element={<BOMEditor />} />
          <Route path="/master/artifacts" element={<ArtifactCatalog />} />
          <Route path="/master/control-points" element={<ControlPointCatalog />} />

          <Route path="/topology/edge" element={<EdgeEditor />} />
          <Route path="/topology/:id" element={<Topology />} />
          <Route path="/metamodel" element={<MetamodelViewer />} />
          <Route path="/consistency" element={<ConsistencyConsole />} />
          <Route path="/consistency/violation" element={<ViolationDetail />} />

          <Route path="/decisions/center" element={<DecisionCenter />} />
          <Route path="/impact" element={<ImpactCenter />} />
          <Route path="/decisions/verification" element={<VerificationScope />} />
          <Route path="/decisions/deploy" element={<DeploymentDecision />} />
          <Route path="/decisions/supplier" element={<SupplierScope />} />
          <Route path="/decisions/report" element={<DecisionReport />} />

          <Route path="/change/cr" element={<CRList />} />
          <Route path="/change/cr/:id" element={<CRDetail />} />
          <Route path="/cr-wizard" element={<CRWizard />} />
          <Route path="/change/changeset" element={<ChangeSetList />} />
          <Route path="/change/baseline" element={<BaselineDiff />} />
          <Route path="/change/timeline" element={<VersionTimeline />} />

          <Route path="/verify/evidence" element={<TestEvidenceManager />} />
          <Route path="/verify/evidence/:id" element={<EvidenceDetail />} />
          <Route path="/readiness/:id" element={<ReleaseReadiness />} />

          <Route path="/ops/campaign" element={<OTACampaign />} />
          <Route path="/ops/campaign/:id" element={<CampaignDetail />} />
          <Route path="/ops/policy" element={<PolicyLifecycle />} />
          <Route path="/ops/telemetry" element={<TelemetryExplorer />} />
          <Route path="/ops/incident" element={<IncidentManager />} />
          <Route path="/ops/incident/:id" element={<IncidentDetail />} />
          <Route path="/ops/runtime" element={<RuntimeSim />} />
          <Route path="/fleet" element={<Fleet />} />
          <Route path="/activation" element={<Activation />} />
          <Route path="/lifecycle" element={<Lifecycle />} />
          <Route path="/ops/:id" element={<OpsDashboard />} />
          <Route path="/variants/:id" element={<VariantMatrix />} />

          <Route path="/supplier/portal" element={<SupplierPortal />} />
          <Route path="/supplier/package" element={<APIReleasePackage />} />
          <Route path="/supplier/package/:id" element={<PackageDetail />} />

          <Route path="/integration/connectors" element={<ConnectorHub />} />
          <Route path="/integration/connector/:id" element={<ConnectorDetail />} />
          <Route path="/integration/sync" element={<SyncLogs />} />

          <Route path="/insights/reports" element={<Reports />} />
          <Route path="/insights/audit" element={<AuditLog />} />
          <Route path="/insights/glossary" element={<Glossary />} />
          <Route path="/cost" element={<Cost />} />

          <Route path="/admin/users" element={<UsersRoles />} />
          <Route path="/admin/permissions" element={<PermissionsMatrix />} />
          <Route path="/admin/org" element={<OrgDomains />} />
          <Route path="/admin/approval" element={<ApprovalWorkflow />} />
          <Route path="/admin/settings" element={<Settings />} />
          <Route path="/admin/notifications" element={<NotificationsCenter />} />

          {/* UI05 Topology 동작 메커니즘 — 구현 화면(요구사양 문서 화면은 제품에 두지 않는다) */}
          <Route path="/arch/topology" element={<TopologyArch />} />
          <Route path="/spec/experiment" element={<Experiment />} />
          <Route path="/spec/conflict" element={<Conflict />} />
          <Route path="/spec/exception" element={<Exception />} />
          <Route path="/spec/compliance" element={<Compliance />} />
          <Route path="/spec/scenario" element={<Scenario />} />
          <Route path="/spec/cicd" element={<CICD />} />
          <Route path="/spec/billing" element={<Billing />} />
          <Route path="/spec/business" element={<Business />} />
          <Route path="/spec/security" element={<Security />} />

          <Route path="/twin/live" element={<TwinLive />} />
          <Route path="/twin/fleet" element={<TwinFleet />} />
          <Route path="/twin/impact" element={<TwinImpact />} />
          <Route path="/twin/simulation" element={<TwinSimulation />} />
          <Route path="/twin/incident" element={<TwinIncident />} />
          <Route path="/twin/vehicle/:vin" element={<TwinVehicle />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}
