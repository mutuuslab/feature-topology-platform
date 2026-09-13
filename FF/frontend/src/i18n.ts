import { useAppShell } from './store';

// 한/영 사전 — 네비게이션 셸 + 공통 UI. (페이지 본문은 점진 적용)
type Lang = 'ko' | 'en';
export interface NavItem { to: string; ko: string; en: string }
export interface NavGroup { ko: string; en: string; items: NavItem[] }
export interface NavDomain { key: string; icon: string; ko: string; en: string; groups: NavGroup[] }

// 그룹 정의 (기존 G0~G11) — 라우트/항목 변경 없음
const G0: NavGroup = { ko: '홈', en: 'Home', items: [
  { to: '/', ko: '내 대시보드', en: 'My Dashboard' }, { to: '/home/customize', ko: '홈 커스터마이즈', en: 'Customize Home' },
  { to: '/login', ko: 'Login·SSO', en: 'Login·SSO' }, { to: '/onboarding', ko: 'Onboarding', en: 'Onboarding' } ] };
const G1: NavGroup = { ko: '기준정보', en: 'Master Data', items: [
  { to: '/catalog', ko: 'Feature Catalog', en: 'Feature Catalog' }, { to: '/master/define', ko: 'Feature 등록(7-criteria)', en: 'Feature Definition (7-criteria)' },
  { to: '/master/taxonomy', ko: 'Taxonomy Browser', en: 'Taxonomy Browser' }, { to: '/master/taxonomy/edit', ko: 'Taxonomy Editor', en: 'Taxonomy Editor' },
  { to: '/master/bom', ko: 'BOM Editor', en: 'BOM Editor' }, { to: '/master/artifacts', ko: 'Artifact Catalog', en: 'Artifact Catalog' },
  { to: '/master/control-points', ko: 'Control Point Catalog', en: 'Control Point Catalog' } ] };
const G2: NavGroup = { ko: '관계', en: 'Topology', items: [
  { to: '/topology/FEAT-BDC-001', ko: 'Topology Graph', en: 'Topology Graph' }, { to: '/topology/edge', ko: 'Edge Editor', en: 'Edge Editor' },
  { to: '/metamodel', ko: 'Metamodel Viewer', en: 'Metamodel Viewer' }, { to: '/consistency', ko: 'Consistency Console', en: 'Consistency Console' },
  { to: '/consistency/violation', ko: 'Violation Detail', en: 'Violation Detail' } ] };
// 기능명세 — 참조성(변경이력·용어집)은 Feature 도메인에 유지
const G11: NavGroup = { ko: '기능명세 (참조)', en: 'Spec (Ref)', items: [
  { to: '/spec/changelog', ko: 'Change Log', en: 'Change Log' }, { to: '/spec/glossary', ko: '용어집', en: 'Glossary' } ] };
// 기능명세 — Overview/FR Explorer/Coverage는 관리(거버넌스) 도메인으로 이동
const G11M: NavGroup = { ko: '기능명세 관리', en: 'Spec Mgmt', items: [
  { to: '/spec', ko: 'Overview', en: 'Overview' }, { to: '/spec/explorer', ko: 'FR Explorer', en: 'FR Explorer' }, { to: '/spec/coverage', ko: 'Coverage', en: 'Coverage' } ] };
const G3: NavGroup = { ko: '의사결정', en: 'Decisions', items: [
  { to: '/decisions/center', ko: 'Decision Center', en: 'Decision Center' }, { to: '/impact', ko: 'Impact Analysis', en: 'Impact Analysis' },
  { to: '/decisions/verification', ko: 'Verification Scope', en: 'Verification Scope' }, { to: '/decisions/deploy', ko: 'Deployment Decision', en: 'Deployment Decision' },
  { to: '/decisions/supplier', ko: 'Supplier Scope', en: 'Supplier Scope' }, { to: '/decisions/report', ko: 'DecisionReport', en: 'DecisionReport' },
  { to: '/spec/experiment', ko: '실험·효과검증', en: 'Experiments' }, { to: '/spec/conflict', ko: '정책 충돌', en: 'Policy Conflict' }, { to: '/spec/exception', ko: '예외 정책', en: 'Exception Policy' } ] };
const G4: NavGroup = { ko: '변경관리', en: 'Change', items: [
  { to: '/lifecycle', ko: 'Lifecycle 관리', en: 'Lifecycle Mgmt' },
  { to: '/change/cr', ko: 'CR List', en: 'CR List' }, { to: '/cr-wizard', ko: 'CR Wizard', en: 'CR Wizard' },
  { to: '/change/changeset', ko: 'ChangeSet', en: 'ChangeSet' }, { to: '/change/baseline', ko: 'Baseline Diff', en: 'Baseline Diff' }, { to: '/change/timeline', ko: 'Version Timeline', en: 'Version Timeline' } ] };
const G5: NavGroup = { ko: '검증', en: 'Verification', items: [
  { to: '/verify/evidence', ko: 'Test Evidence Manager', en: 'Test Evidence Manager' }, { to: '/readiness/FEAT-BDC-001', ko: 'Release Readiness', en: 'Release Readiness' },
  { to: '/spec/compliance', ko: '컴플라이언스 룰', en: 'Compliance' }, { to: '/spec/scenario', ko: '시나리오 검증', en: 'Scenario Test' } ] };
const G6: NavGroup = { ko: '배포·운영', en: 'Deploy & Ops', items: [
  { to: '/ops/FEAT-BDC-001', ko: 'Ops · Kill Switch', en: 'Ops · Kill Switch' }, { to: '/ops/campaign', ko: 'OTA Campaign', en: 'OTA Campaign' },
  { to: '/ops/policy', ko: 'Policy Lifecycle', en: 'Policy Lifecycle' }, { to: '/ops/telemetry', ko: 'Telemetry Explorer', en: 'Telemetry Explorer' },
  { to: '/ops/incident', ko: 'Incident', en: 'Incident' }, { to: '/ops/runtime', ko: 'Runtime Sim', en: 'Runtime Sim' }, { to: '/fleet', ko: 'Fleet · 차량 상태', en: 'Fleet · Vehicles' }, { to: '/activation', ko: 'Activation · 차종 제어', en: 'Activation Control' }, { to: '/variants/FEAT-BDC-001', ko: 'Variant Matrix', en: 'Variant Matrix' }, { to: '/spec/cicd', ko: 'CI/CD 파이프라인', en: 'CI/CD Pipeline' } ] };
const G8: NavGroup = { ko: '연동', en: 'Integration', items: [
  { to: '/integration/connectors', ko: 'Connector Hub', en: 'Connector Hub' }, { to: '/integration/sync', ko: 'Sync Logs', en: 'Sync Logs' }, { to: '/spec/billing', ko: '과금 연계', en: 'Billing' } ] };
const G9: NavGroup = { ko: '분석·감사', en: 'Insights', items: [
  { to: '/insights/reports', ko: 'Reports', en: 'Reports' }, { to: '/cost', ko: 'SW 개발비 / Cost', en: 'SW Cost' }, { to: '/insights/audit', ko: 'Audit Log', en: 'Audit Log' },
  { to: '/insights/glossary', ko: 'Glossary', en: 'Glossary' }, { to: '/spec/business', ko: '글로벌·현장·사업', en: 'Global·Field·Biz' } ] };
// G12 — Digital Twin (운영 도메인 하위 그룹). 신규 도메인이 아니라 기존 6도메인 안에 배치한다.
const G12: NavGroup = { ko: 'Digital Twin', en: 'Digital Twin', items: [
  { to: '/twin/live', ko: 'Live Visual Twin (3D)', en: 'Live Visual Twin (3D)' },
  { to: '/twin/fleet', ko: 'Twin Fleet', en: 'Twin Fleet' },
  { to: '/twin/impact', ko: 'Impact Preview', en: 'Impact Preview' },
  { to: '/twin/simulation', ko: 'What-if Simulation', en: 'What-if Simulation' },
  { to: '/twin/incident', ko: 'Closed-Loop Incident', en: 'Closed-Loop Incident' },
  { to: '/twin/vehicle/VIN-DEMO-017', ko: 'Vehicle Twin 상세', en: 'Vehicle Twin Detail' } ] };

const G7: NavGroup = { ko: '협력사', en: 'Supplier', items: [
  { to: '/supplier/portal', ko: 'Supplier Portal', en: 'Supplier Portal' }, { to: '/supplier/package', ko: 'API Release Package', en: 'API Release Package' } ] };
const G10: NavGroup = { ko: '관리자', en: 'Admin', items: [
  { to: '/admin/users', ko: 'Users & Roles', en: 'Users & Roles' }, { to: '/admin/permissions', ko: 'Permissions Matrix', en: 'Permissions Matrix' },
  { to: '/admin/org', ko: 'Org & Domains', en: 'Org & Domains' }, { to: '/admin/approval', ko: 'Approval Workflow', en: 'Approval Workflow' },
  { to: '/admin/settings', ko: 'Settings', en: 'Settings' }, { to: '/admin/notifications', ko: 'Notifications', en: 'Notifications' }, { to: '/spec/security', ko: '보안 운영', en: 'Security Ops' } ] };

// 상위 도메인 (12그룹 → 6도메인 통합)
export const DOMAINS: NavDomain[] = [
  { key: 'home', icon: '🏠', ko: '홈', en: 'Home', groups: [G0] },
  { key: 'feature', icon: '📦', ko: 'Feature', en: 'Feature', groups: [G1, G2, G11] },
  { key: 'lifecycle', icon: '⚖️', ko: '라이프사이클', en: 'Lifecycle', groups: [G3, G4, G5] },
  { key: 'operate', icon: '🚀', ko: '운영', en: 'Operate', groups: [G6, G8, G12] },
  { key: 'insights', icon: '📊', ko: '분석·감사', en: 'Insights', groups: [G9] },
  { key: 'governance', icon: '🛡️', ko: '거버넌스', en: 'Governance', groups: [G7, G10, G11M] },
];

// 하위호환: 평탄화된 그룹 목록
export const NAV: NavGroup[] = DOMAINS.flatMap(d => d.groups);

// 경로 → NavItem 룩업 (부서별 보기에서 라벨 i18n 재사용)
export const ITEM: Record<string, NavItem> = (() => {
  const m: Record<string, NavItem> = {};
  NAV.forEach(g => g.items.forEach(it => { if (!(it.to in m)) m[it.to] = it; }));
  return m;
})();

// ── 부서별 보기 (역할 P1~P7+Admin → 담당 메뉴 큐레이션) ──
export interface DeptSection { ko: string; en: string; paths: string[] }
export interface Dept { role: string; icon: string; ko: string; en: string; sections: DeptSection[] }
export const DEPT_NAV: Dept[] = [
  { role: '기획 P1', icon: '📋', ko: '기획', en: 'Planning', sections: [
    { ko: '정의', en: 'Define', paths: ['/catalog', '/master/define', '/master/taxonomy'] },
    { ko: '명세', en: 'Spec', paths: ['/spec', '/spec/explorer', '/spec/coverage'] },
    { ko: '분석', en: 'Insights', paths: ['/insights/reports', '/cost', '/spec/business'] } ] },
  { role: '시스템 P2', icon: '🔗', ko: '시스템', en: 'System', sections: [
    { ko: '아키텍처', en: 'Architecture', paths: ['/topology/FEAT-BDC-001', '/topology/edge', '/metamodel'] },
    { ko: '정합성', en: 'Consistency', paths: ['/consistency', '/consistency/violation'] },
    { ko: 'BOM', en: 'BOM', paths: ['/master/bom', '/master/artifacts', '/master/control-points'] },
    { ko: '영향', en: 'Impact', paths: ['/impact'] } ] },
  { role: 'SW P3', icon: '💻', ko: 'SW', en: 'SW', sections: [
    { ko: '의사결정', en: 'Decisions', paths: ['/decisions/center', '/impact', '/decisions/deploy', '/decisions/report'] },
    { ko: '변경', en: 'Change', paths: ['/change/cr', '/cr-wizard', '/change/changeset'] },
    { ko: '구현', en: 'Build', paths: ['/master/bom', '/spec/cicd'] } ] },
  { role: '검증 P4', icon: '✅', ko: '검증', en: 'Verification', sections: [
    { ko: '게이트', en: 'Gate', paths: ['/readiness/FEAT-BDC-001', '/verify/evidence', '/twin/simulation'] },
    { ko: '규정', en: 'Compliance', paths: ['/spec/compliance', '/spec/scenario'] },
    { ko: '추적', en: 'Traceability', paths: ['/spec/coverage', '/lifecycle'] } ] },
  { role: 'OTA P5', icon: '🚀', ko: 'OTA', en: 'OTA', sections: [
    { ko: '캠페인', en: 'Campaign', paths: ['/ops/campaign', '/ops/policy', '/activation'] },
    { ko: '파이프라인', en: 'Pipeline', paths: ['/spec/cicd'] },
    { ko: 'Twins', en: 'Twins', paths: ['/twin/fleet', '/twin/impact'] },
    { ko: '모니터', en: 'Monitor', paths: ['/ops/telemetry', '/variants/FEAT-BDC-001'] } ] },
  { role: '협력사 P6', icon: '🤝', ko: '협력사', en: 'Supplier', sections: [
    { ko: '패키지', en: 'Package', paths: ['/supplier/portal', '/supplier/package'] },
    { ko: '연동', en: 'Integration', paths: ['/integration/connectors', '/integration/sync', '/spec/billing'] } ] },
  { role: '운영 P7', icon: '🛠', ko: '운영', en: 'Operations', sections: [
    { ko: '운영', en: 'Ops', paths: ['/ops/FEAT-BDC-001', '/ops/incident', '/ops/runtime'] },
    { ko: 'Twin', en: 'Twin', paths: ['/twin/fleet', '/twin/incident', '/twin/vehicle/VIN-DEMO-017'] },
    { ko: 'Fleet', en: 'Fleet', paths: ['/fleet', '/activation'] },
    { ko: '감사', en: 'Audit', paths: ['/insights/audit'] } ] },
  { role: 'Admin', icon: '⚙️', ko: '관리', en: 'Admin', sections: [
    { ko: '관리', en: 'Admin', paths: ['/admin/users', '/admin/permissions', '/admin/org', '/admin/approval', '/admin/settings', '/admin/notifications'] },
    { ko: '보안', en: 'Security', paths: ['/spec/security'] } ] },
];

const COMMON: Record<string, { ko: string; en: string }> = {
  search: { ko: '🔍 검색 · ⌘K  (예: FEAT-BDC-001)', en: '🔍 Search · ⌘K  (e.g. FEAT-BDC-001)' },
  role: { ko: '역할', en: 'Role' },
  noPerm: { ko: '권한 필요', en: 'Permission required' },
  close: { ko: '닫기', en: 'Close' },
  retry: { ko: '재시도', en: 'Retry' },
  noResult: { ko: '결과 없음', en: 'No results' },
  notFound: { ko: '404 — 페이지를 찾을 수 없습니다', en: '404 — Page not found' },
  home: { ko: '홈으로', en: 'Home' },
  skip: { ko: '본문 바로가기', en: 'Skip to content' },
};

// 정확 경로 → 도메인 (모호한 /spec/* 등 정확 매핑) + 첫 세그먼트 폴백
const EXACT_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  DOMAINS.forEach(d => d.groups.forEach(g => g.items.forEach(it => { if (!(it.to in m)) m[it.to] = d.key; })));
  return m;
})();
const SEG_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  DOMAINS.forEach(d => d.groups.forEach(g => g.items.forEach(it => {
    const seg = it.to.split('/')[1] || '';
    if (seg && !(seg in m)) m[seg] = d.key;
  })));
  m['feature'] = 'feature';   // /feature/:id (Feature Detail)
  return m;
})();

export function domainOfPath(pathname: string): string {
  if (EXACT_TO_DOMAIN[pathname]) return EXACT_TO_DOMAIN[pathname];
  const seg = pathname.split('/')[1] || '';
  return SEG_TO_DOMAIN[seg] || 'home';
}

export function useT() {
  // 라벨은 UI 언어에만 의존한다 — 전체 state 를 구독하면 2초 LIVE_TICK 마다
  // useT() 를 쓰는 모든 컴포넌트가 함께 리렌더된다.
  const { lang: raw = 'ko' } = useAppShell();
  const lang = (raw || 'ko') as Lang;
  return {
    lang,
    t: (k: string) => COMMON[k]?.[lang] ?? COMMON[k]?.ko ?? k,
    navGroup: (g: NavGroup) => (lang === 'en' ? g.en : g.ko),
    navItem: (i: NavItem) => (lang === 'en' ? i.en : i.ko),
    navDomain: (d: NavDomain) => (lang === 'en' ? d.en : d.ko),
    deptLabel: (d: Dept | DeptSection) => (lang === 'en' ? d.en : d.ko),
  };
}
