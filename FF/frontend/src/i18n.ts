import { useApp } from './store';

// 한/영 사전 — 네비게이션 셸 + 공통 UI. (페이지 본문은 점진 적용)
type Lang = 'ko' | 'en';
export interface NavItem { to: string; ko: string; en: string }
export interface NavGroup { ko: string; en: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { ko: 'G0 홈', en: 'G0 Home', items: [
    { to: '/', ko: '내 대시보드', en: 'My Dashboard' }, { to: '/home/customize', ko: '홈 커스터마이즈', en: 'Customize Home' },
    { to: '/login', ko: 'Login·SSO', en: 'Login·SSO' }, { to: '/onboarding', ko: 'Onboarding', en: 'Onboarding' } ] },
  { ko: 'G1 기준정보', en: 'G1 Master Data', items: [
    { to: '/catalog', ko: 'Feature Catalog', en: 'Feature Catalog' }, { to: '/master/define', ko: 'Feature 등록(7-criteria)', en: 'Feature Definition (7-criteria)' },
    { to: '/master/taxonomy', ko: 'Taxonomy Browser', en: 'Taxonomy Browser' }, { to: '/master/taxonomy/edit', ko: 'Taxonomy Editor', en: 'Taxonomy Editor' },
    { to: '/master/bom', ko: 'BOM Editor', en: 'BOM Editor' }, { to: '/master/artifacts', ko: 'Artifact Catalog', en: 'Artifact Catalog' },
    { to: '/master/control-points', ko: 'Control Point Catalog', en: 'Control Point Catalog' } ] },
  { ko: 'G2 관계', en: 'G2 Topology', items: [
    { to: '/topology/FEAT-BDC-001', ko: 'Topology Graph', en: 'Topology Graph' }, { to: '/topology/edge', ko: 'Edge Editor', en: 'Edge Editor' },
    { to: '/metamodel', ko: 'Metamodel Viewer', en: 'Metamodel Viewer' }, { to: '/consistency', ko: 'Consistency Console', en: 'Consistency Console' },
    { to: '/consistency/violation', ko: 'Violation Detail', en: 'Violation Detail' } ] },
  { ko: 'G3 의사결정', en: 'G3 Decisions', items: [
    { to: '/decisions/center', ko: 'Decision Center', en: 'Decision Center' }, { to: '/impact', ko: 'Impact Analysis', en: 'Impact Analysis' },
    { to: '/decisions/verification', ko: 'Verification Scope', en: 'Verification Scope' }, { to: '/decisions/deploy', ko: 'Deployment Decision', en: 'Deployment Decision' },
    { to: '/decisions/supplier', ko: 'Supplier Scope', en: 'Supplier Scope' }, { to: '/decisions/report', ko: 'DecisionReport', en: 'DecisionReport' },
    { to: '/spec/experiment', ko: '실험·효과검증', en: 'Experiments' }, { to: '/spec/conflict', ko: '정책 충돌', en: 'Policy Conflict' }, { to: '/spec/exception', ko: '예외 정책', en: 'Exception Policy' } ] },
  { ko: 'G4 변경관리', en: 'G4 Change', items: [
    { to: '/lifecycle', ko: 'Lifecycle 관리', en: 'Lifecycle Mgmt' },
    { to: '/change/cr', ko: 'CR List', en: 'CR List' }, { to: '/cr-wizard', ko: 'CR Wizard', en: 'CR Wizard' },
    { to: '/change/changeset', ko: 'ChangeSet', en: 'ChangeSet' }, { to: '/change/baseline', ko: 'Baseline Diff', en: 'Baseline Diff' }, { to: '/change/timeline', ko: 'Version Timeline', en: 'Version Timeline' } ] },
  { ko: 'G5 검증', en: 'G5 Verification', items: [
    { to: '/verify/evidence', ko: 'Test Evidence Manager', en: 'Test Evidence Manager' }, { to: '/readiness/FEAT-BDC-001', ko: 'Release Readiness', en: 'Release Readiness' },
    { to: '/spec/compliance', ko: '컴플라이언스 룰', en: 'Compliance' }, { to: '/spec/scenario', ko: '시나리오 검증', en: 'Scenario Test' } ] },
  { ko: 'G6 배포·운영', en: 'G6 Deploy & Ops', items: [
    { to: '/ops/FEAT-BDC-001', ko: 'Ops · Kill Switch', en: 'Ops · Kill Switch' }, { to: '/ops/campaign', ko: 'OTA Campaign', en: 'OTA Campaign' },
    { to: '/ops/policy', ko: 'Policy Lifecycle', en: 'Policy Lifecycle' }, { to: '/ops/telemetry', ko: 'Telemetry Explorer', en: 'Telemetry Explorer' },
    { to: '/ops/incident', ko: 'Incident', en: 'Incident' }, { to: '/fleet', ko: 'Fleet · 차량 상태', en: 'Fleet · Vehicles' }, { to: '/activation', ko: 'Activation · 차종 제어', en: 'Activation Control' }, { to: '/variants/FEAT-BDC-001', ko: 'Variant Matrix', en: 'Variant Matrix' }, { to: '/spec/cicd', ko: 'CI/CD 파이프라인', en: 'CI/CD Pipeline' } ] },
  { ko: 'G7 협력사', en: 'G7 Supplier', items: [
    { to: '/supplier/portal', ko: 'Supplier Portal', en: 'Supplier Portal' }, { to: '/supplier/package', ko: 'API Release Package', en: 'API Release Package' } ] },
  { ko: 'G8 연동', en: 'G8 Integration', items: [
    { to: '/integration/connectors', ko: 'Connector Hub', en: 'Connector Hub' }, { to: '/integration/sync', ko: 'Sync Logs', en: 'Sync Logs' }, { to: '/spec/billing', ko: '과금 연계', en: 'Billing' } ] },
  { ko: 'G9 분석·감사', en: 'G9 Insights', items: [
    { to: '/insights/reports', ko: 'Reports', en: 'Reports' }, { to: '/cost', ko: 'SW 개발비 / Cost', en: 'SW Cost' }, { to: '/insights/audit', ko: 'Audit Log', en: 'Audit Log' },
    { to: '/insights/glossary', ko: 'Glossary', en: 'Glossary' }, { to: '/spec/business', ko: '글로벌·현장·사업', en: 'Global·Field·Biz' } ] },
  { ko: 'G10 관리자', en: 'G10 Admin', items: [
    { to: '/admin/users', ko: 'Users & Roles', en: 'Users & Roles' }, { to: '/admin/permissions', ko: 'Permissions Matrix', en: 'Permissions Matrix' },
    { to: '/admin/org', ko: 'Org & Domains', en: 'Org & Domains' }, { to: '/admin/approval', ko: 'Approval Workflow', en: 'Approval Workflow' },
    { to: '/admin/settings', ko: 'Settings', en: 'Settings' }, { to: '/admin/notifications', ko: 'Notifications', en: 'Notifications' }, { to: '/spec/security', ko: '보안 운영', en: 'Security Ops' } ] },
  { ko: 'G11 기능명세', en: 'G11 Spec', items: [
    { to: '/spec', ko: 'Overview', en: 'Overview' }, { to: '/spec/explorer', ko: 'FR Explorer', en: 'FR Explorer' }, { to: '/spec/coverage', ko: 'Coverage', en: 'Coverage' },
    { to: '/spec/changelog', ko: 'Change Log', en: 'Change Log' }, { to: '/spec/glossary', ko: '용어집', en: 'Glossary' } ] },
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

export function useT() {
  const { state } = useApp();
  const lang = (state?.lang || 'ko') as Lang;
  return {
    lang,
    t: (k: string) => COMMON[k]?.[lang] ?? COMMON[k]?.ko ?? k,
    navGroup: (g: NavGroup) => (lang === 'en' ? g.en : g.ko),
    navItem: (i: NavItem) => (lang === 'en' ? i.en : i.ko),
  };
}
