import { useState, useEffect, lazy, Suspense } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { useApp, roleHome } from './store';
import { NotFound } from './components/patterns';
import { roles } from './data/refdata';
import { DOMAINS, DEPT_NAV, ITEM, domainOfPath, useT } from './i18n';
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
import { TaxonomyBrowser, TaxonomyEditor, BOMEditor, DefinitionWizard, ArtifactCatalog, ControlPointCatalog } from './pages/master';
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
import { SpecOverview, SpecExplorer, SpecCoverage, SpecChangeLog, SpecGlossary } from './pages/spec';
import { Experiment, Conflict, Exception, Compliance, Scenario, CICD, Billing, Business, Security } from './pages/specnew';

const NAV: { group: string; items: [string, string][] }[] = [
  { group: 'G0 홈 / Home', items: [['/', '내 대시보드'], ['/home/customize', '홈 커스터마이즈'], ['/login', 'Login·SSO'], ['/onboarding', 'Onboarding']] },
  { group: 'G1 기준정보 / Master', items: [['/catalog', 'Feature Catalog'], ['/master/define', 'Feature 등록(7-criteria)'], ['/master/taxonomy', 'Taxonomy Browser'], ['/master/taxonomy/edit', 'Taxonomy Editor'], ['/master/bom', 'BOM Editor'], ['/master/artifacts', 'Artifact Catalog'], ['/master/control-points', 'Control Point Catalog']] },
  { group: 'G2 관계 / Topology', items: [['/topology/FEAT-BDC-001', 'Topology Graph'], ['/topology/edge', 'Edge Editor'], ['/metamodel', 'Metamodel Viewer'], ['/consistency', 'Consistency Console'], ['/consistency/violation', 'Violation Detail']] },
  { group: 'G3 의사결정 / Decisions', items: [['/decisions/center', 'Decision Center'], ['/impact', 'Impact Analysis'], ['/decisions/verification', 'Verification Scope'], ['/decisions/deploy', 'Deployment Decision'], ['/decisions/supplier', 'Supplier Scope'], ['/decisions/report', 'DecisionReport'], ['/spec/experiment', '실험·효과검증'], ['/spec/conflict', '정책 충돌'], ['/spec/exception', '예외 정책']] },
  { group: 'G4 변경관리 / Change', items: [['/change/cr', 'CR List'], ['/cr-wizard', 'CR Wizard'], ['/change/changeset', 'ChangeSet'], ['/change/baseline', 'Baseline Diff'], ['/change/timeline', 'Version Timeline']] },
  { group: 'G5 검증 / Verification', items: [['/verify/evidence', 'Test Evidence Manager'], ['/readiness/FEAT-BDC-001', 'Release Readiness'], ['/spec/compliance', '컴플라이언스 룰'], ['/spec/scenario', '시나리오 검증']] },
  { group: 'G6 배포·운영 / Ops', items: [['/ops/FEAT-BDC-001', 'Ops · Kill Switch'], ['/ops/campaign', 'OTA Campaign'], ['/ops/policy', 'Policy Lifecycle'], ['/ops/telemetry', 'Telemetry Explorer'], ['/ops/incident', 'Incident'], ['/ops/runtime', 'Runtime Sim'], ['/variants/FEAT-BDC-001', 'Variant Matrix'], ['/spec/cicd', 'CI/CD 파이프라인']] },
  { group: 'G7 협력사 / Supplier', items: [['/supplier/portal', 'Supplier Portal'], ['/supplier/package', 'API Release Package']] },
  { group: 'G8 연동 / Integration', items: [['/integration/connectors', 'Connector Hub'], ['/integration/sync', 'Sync Logs'], ['/spec/billing', '과금 연계']] },
  { group: 'G9 분석·감사 / Insights', items: [['/insights/reports', 'Reports'], ['/cost', 'SW 개발비 / Cost'], ['/insights/audit', 'Audit Log'], ['/insights/glossary', 'Glossary'], ['/spec/business', '글로벌·현장·사업']] },
  { group: 'G10 관리자 / Admin', items: [['/admin/users', 'Users & Roles'], ['/admin/permissions', 'Permissions Matrix'], ['/admin/org', 'Org & Domains'], ['/admin/approval', 'Approval Workflow'], ['/admin/settings', 'Settings'], ['/admin/notifications', 'Notifications'], ['/spec/security', '보안 운영']] },
  { group: 'G11 기능명세 / Spec', items: [['/spec', 'Overview'], ['/spec/explorer', 'FR Explorer'], ['/spec/coverage', 'Coverage'], ['/spec/changelog', 'Change Log'], ['/spec/glossary', '용어집']] },
];

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const { state, dispatch } = useApp();
  const { t, navGroup, navItem, navDomain, deptLabel } = useT();
  const [navOpen, setNavOpen] = useState(false);
  const [activeDomain, setActiveDomain] = useState(() => domainOfPath(loc.pathname));
  useEffect(() => { setActiveDomain(domainOfPath(loc.pathname)); }, [loc.pathname]);
  const roleDomain = domainOfPath(roleHome[state.role] || '/');
  const dom = DOMAINS.find(d => d.key === activeDomain) || DOMAINS[0];
  // 부서별 보기
  const navMode = state.navMode || 'function';
  const [activeDept, setActiveDept] = useState(state.role);
  useEffect(() => { setActiveDept(state.role); }, [state.role]);
  const deptObj = DEPT_NAV.find(d => d.role === activeDept) || DEPT_NAV[0];
  const [q, setQ] = useState('');
  const submitSearch = () => { if (q.trim()) { nav('/catalog?q=' + encodeURIComponent(q.trim())); setNavOpen(false); } };
  const changeRole = (r: string) => { dispatch({ t: 'ROLE', role: r }); nav(roleHome[r] || '/'); };
  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <a className="skip" href="#main">{t('skip')}</a>
      <div className="topbar">
        <button className="hamburger" aria-label="menu" onClick={() => setNavOpen(o => !o)}>☰</button>
        <span className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>▣ FEATURE TOPOLOGY</span>
        <div className="search">
          <input aria-label="search" placeholder={t('search')} value={q}
            onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }} />
        </div>
        <select className="role-sel" aria-label={t('role')} value={state.role} onChange={e => changeRole(e.target.value)}>
          {roles.map(r => <option key={r}>{r}</option>)}
        </select>
        <button className="icon-btn" title="language" aria-label="language" onClick={() => dispatch({ t: 'LANG', lang: state.lang === 'ko' ? 'en' : 'ko' })}>{state.lang.toUpperCase()}</button>
        <button className="icon-btn" title="theme" aria-label="theme" onClick={() => dispatch({ t: 'THEME', theme: state.theme === 'light' ? 'dark' : 'light' })}>{state.theme === 'light' ? '🌙' : '☀'}</button>
        <button className="icon-btn" title="notifications" aria-label="notifications" onClick={() => nav('/admin/notifications')}>🔔</button>
      </div>
      <nav className="nav" aria-label="primary">
        <div className="nav-mode">
          <button className={navMode === 'function' ? 'active' : ''} onClick={() => dispatch({ t: 'SET_NAV_MODE', mode: 'function' })}>기능별</button>
          <button className={navMode === 'dept' ? 'active' : ''} onClick={() => dispatch({ t: 'SET_NAV_MODE', mode: 'dept' })}>부서별</button>
        </div>
        <div className="nav-body">
          {navMode === 'function' ? <>
            <div className="rail">
              {DOMAINS.map(d => (
                <button key={d.key} className={'rail-btn' + (d.key === activeDomain ? ' active' : '')} title={navDomain(d)} aria-label={navDomain(d)} aria-current={d.key === activeDomain} onClick={() => setActiveDomain(d.key)}>
                  <span className="ic">{d.icon}</span><span className="lb">{navDomain(d)}</span>
                  {d.key === roleDomain && <span className="role-dot" title="현재 역할 기본 영역" />}
                </button>
              ))}
            </div>
            <div className="subnav" onClick={() => setNavOpen(false)}>
              <div className="subnav-head">{dom.icon} {navDomain(dom)}</div>
              {dom.groups.map(g => (
                <div key={g.ko}>
                  <div className="group">{navGroup(g)}</div>
                  {g.items.map(it => <NavLink key={it.to + it.ko} to={it.to} end={it.to === '/'}>{navItem(it)}</NavLink>)}
                </div>
              ))}
            </div>
          </> : <>
            <div className="rail">
              {DEPT_NAV.map(d => (
                <button key={d.role} className={'rail-btn' + (d.role === activeDept ? ' active' : '')} title={deptLabel(d)} aria-label={deptLabel(d)} aria-current={d.role === activeDept} onClick={() => setActiveDept(d.role)}>
                  <span className="ic">{d.icon}</span><span className="lb">{deptLabel(d)}</span>
                  {d.role === state.role && <span className="role-dot" title="현재 역할" />}
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
          <Route path="/master/define" element={<DefinitionWizard />} />
          <Route path="/master/taxonomy" element={<TaxonomyBrowser />} />
          <Route path="/master/taxonomy/edit" element={<TaxonomyEditor />} />
          <Route path="/master/bom" element={<BOMEditor />} />
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

          <Route path="/spec" element={<SpecOverview />} />
          <Route path="/spec/explorer" element={<SpecExplorer />} />
          <Route path="/spec/coverage" element={<SpecCoverage />} />
          <Route path="/spec/changelog" element={<SpecChangeLog />} />
          <Route path="/spec/glossary" element={<SpecGlossary />} />
          <Route path="/spec/experiment" element={<Experiment />} />
          <Route path="/spec/conflict" element={<Conflict />} />
          <Route path="/spec/exception" element={<Exception />} />
          <Route path="/spec/compliance" element={<Compliance />} />
          <Route path="/spec/scenario" element={<Scenario />} />
          <Route path="/spec/cicd" element={<CICD />} />
          <Route path="/spec/billing" element={<Billing />} />
          <Route path="/spec/business" element={<Business />} />
          <Route path="/spec/security" element={<Security />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}
