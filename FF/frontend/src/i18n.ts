import { useAppShell } from './store';
import { SPEC_MENU, SPEC_MENU_ITEM, SPEC_MENU_GROUP_OF_SCREEN, SPEC_ROLE_HOME } from './data/specMenu';
import { SCREEN_LINKS } from './data/uiLinks';
import { SPEC_PLANE_NAV } from './data/specPlanesNav';

// 한/영 사전 — 네비게이션 셸 + 공통 UI. (페이지 본문은 점진 적용)
type Lang = 'ko' | 'en';
export interface NavItem { to: string; ko: string; en: string }
export interface NavGroup { ko: string; en: string; items: NavItem[] }
export interface NavDomain { key: string; icon: string; ko: string; en: string; groups: NavGroup[] }

// ── 1차 IA = 기준 패키지의 7 업무 그룹 · 30 화면 (FP-DETAILED-1.1 / MENU 1.3) ──
// 각 업무 그룹의 서브내비 = 그 그룹의 기준 화면 + 같은 업무 영역의 구현 화면(DEMO_DOMAIN).
// 구현 화면 그룹(D0·G1·G2 …)은 아래에서 정의하고, 마지막에 DOMAINS로 묶는다.

// ── 구현 데모 화면 (기준 화면이 아니라 시뮬레이션 구현) — 기준 화면에서 연결한다 ──
const D0: NavGroup = { ko: '홈', en: 'Home', items: [
  { to: '/', ko: '내 대시보드', en: 'My Dashboard' }, { to: '/home/customize', ko: '홈 커스터마이즈', en: 'Customize Home' },
  { to: '/login', ko: 'Login·SSO', en: 'Login·SSO' }, { to: '/onboarding', ko: 'Onboarding', en: 'Onboarding' } ] };
const G1: NavGroup = { ko: '기준정보', en: 'Master Data', items: [
  { to: '/catalog', ko: 'Feature Catalog', en: 'Feature Catalog' }, { to: '/master/define', ko: 'Feature 등록(Revision)', en: 'Feature Registration (Revision)' },
  { to: '/master/taxonomy', ko: 'Taxonomy Browser', en: 'Taxonomy Browser' }, { to: '/master/taxonomy/edit', ko: 'Taxonomy Editor', en: 'Taxonomy Editor' },
  { to: '/master/bom', ko: 'Feature BOM 기준선', en: 'Feature BOM Baseline' }, { to: '/master/bom/items', ko: 'BOM Editor', en: 'BOM Editor' }, { to: '/master/artifacts', ko: 'Artifact Catalog', en: 'Artifact Catalog' },
  { to: '/master/control-points', ko: 'Feature 제어점', en: 'Feature ControlPoint' } ] };
const G2: NavGroup = { ko: '관계', en: 'Topology', items: [
  { to: '/topology/FEAT-BDC-001', ko: 'Topology Graph', en: 'Topology Graph' }, { to: '/topology/edge', ko: 'Edge Editor', en: 'Edge Editor' },
  { to: '/metamodel', ko: 'Metamodel Viewer', en: 'Metamodel Viewer' }, { to: '/consistency', ko: 'Consistency Console', en: 'Consistency Console' },
  { to: '/consistency/violation', ko: 'Violation Detail', en: 'Violation Detail' } ] };
// 참조 — 기준 개정 이력·용어집 (기준 패키지 참조성 문서)
const G11: NavGroup = { ko: '기준 문서 (참조)', en: 'Reference', items: [
  { to: '/spec/changelog', ko: 'Change Log', en: 'Change Log' }, { to: '/spec/glossary', ko: '용어집', en: 'Glossary' } ] };
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

// 구현 데모 화면 묶음 — 1차 메뉴(기준 7그룹)에서 빠지지만 라우트는 살아 있다.
// 각 기준 화면 페이지의 '연결 구현 화면'과 홈의 '구현 데모 화면' 인덱스가 이 목록을 쓴다.
export const DEMO_GROUPS: NavGroup[] = [D0, G1, G2, G11, G3, G4, G5, G6, G8, G9, G12, G7, G10];

// 업무 그룹(기준 7그룹) → 그 업무 영역의 구현 화면 묶음.
// 기준 화면(무엇을 해야 하는가)과 구현 화면(지금 돌아가는 화면)을 한 자리에서 보게 한다.
// 13개 구현 묶음은 정확히 한 업무 그룹에만 들어간다(specData.test.ts 에서 검증).
const DEMO_DOMAIN: Record<string, NavGroup[]> = {
  work: [D0],
  feature: [G1, G4],
  config: [G2, G7],
  release: [G3],
  vehicle: [G12, G6],
  quality: [G5, G9],
  admin: [G8, G10, G11],
};

export const DOMAINS: NavDomain[] = SPEC_MENU.map(g => ({
  key: g.id, icon: g.icon, ko: g.ko, en: g.en,
  groups: [
    { ko: '기준 화면', en: 'Spec Screens', items: g.items.map(it => ({
      to: `/ui/${it.id}`, ko: `${it.id} ${it.ko}`, en: `${it.id} ${it.en}`,
    })) },
    ...(DEMO_DOMAIN[g.id] || []).map(dg => ({ ...dg, ko: `구현 · ${dg.ko}`, en: `Impl · ${dg.en}` })),
  ],
}));


// 하위호환: 평탄화된 그룹 목록 (기준 7업무 그룹)
export const NAV: NavGroup[] = DOMAINS.flatMap(d => d.groups);

// 경로 → NavItem 룩업 (부서별 보기에서 라벨 i18n 재사용)
export const ITEM: Record<string, NavItem> = (() => {
  const m: Record<string, NavItem> = {};
  [...NAV, ...DEMO_GROUPS].forEach(g => g.items.forEach(it => { if (!(it.to in m)) m[it.to] = it; }));
  // 기준 화면 ID 로도 조회할 수 있게 별칭을 둔다 (/ui/UI02 ↔ UI02)
  Object.entries(SPEC_MENU_ITEM).forEach(([id, it]) => { m[id] = { to: `/ui/${id}`, ko: `${id} ${it.ko}`, en: `${id} ${it.en}` }; });
  return m;
})();

// ── 3차 IA = 4 Plane 보기 (FP Architecture v4.5 Core 귀속 축) ──
// Plane은 업무 그룹과 다른 축이다. 기준 화면 ID와 데모 경로는 그대로 두고 대표 Plane으로 다시 묶는다.
// 배정 근거와 화면 목록은 data/specPlanesNav.ts 가 원천이고, 여기서는 셸이 쓰는 라벨 형태로 바꾼다.
export interface PlaneNavDomain extends NavDomain {
  /** Plane 전체 이름 (레일 라벨은 상속된 ko/en 짧은 이름을 쓴다) */
  fullKo: string;
  fullEn: string;
  /** Plane 산출물 (specArch.SPEC_PLANES 원천) */
  produces: string;
  /** Plane 계약 (specArch.SPEC_PLANES 원천) */
  contract: string;
  /** 대표 Plane 배정 근거 */
  note: string;
  /** 4 Plane에 속하지 않는 공유 기반(Knowledge Foundation) */
  shared: boolean;
}

export const PLANE_NAV: PlaneNavDomain[] = SPEC_PLANE_NAV.map(p => ({
  key: p.id, icon: p.icon, ko: p.shortKo, en: p.shortEn,
  fullKo: p.ko, fullEn: p.en,
  produces: p.produces, contract: p.contract, note: p.note, shared: !!p.shared,
  groups: [
    ...p.screenGroups.map(g => ({
      ko: g.ko, en: g.en,
      items: g.screens.map(id => {
        const it = SPEC_MENU_ITEM[id];
        return it ? { to: `/ui/${id}`, ko: `${id} ${it.ko}`, en: `${id} ${it.en}` } : { to: `/ui/${id}`, ko: id, en: id };
      }),
    })),
    ...p.demos.map(g => ({
      ko: g.ko, en: g.en,
      items: g.routes.map(r => ITEM[r] || { to: r, ko: r, en: r }),
    })),
  ],
}));

// ── 부서별 보기 (기준 패키지의 9 역할 → 담당 화면 큐레이션) ──
export interface DeptSection { ko: string; en: string; paths: string[] }
export interface Dept { role: string; icon: string; ko: string; en: string; sections: DeptSection[] }

/** 기준 화면 ID → 그 화면이 구현된 데모 경로들 (uiLinks 기준, 중복 제거 + 실제 네비게이션 가능 경로만) */
const implPathsOf = (screenIds: string[]) => {
  const seen = new Set<string>();
  screenIds.forEach(id => {
    const e = SCREEN_LINKS[id];
    (e?.links || []).forEach(l => { if (ITEM[l.path] && !l.path.includes(':')) seen.add(l.path); });
  });
  return [...seen];
};

const ROLE_ICON: Record<string, string> = {
  author: '✍️', approver: '🏛', quality: '✅', operator: '🚚', steward: '🧩',
  commerce: '💳', integrator: '🔗', coordinator: '🤝', viewer: '👁',
};
const ROLE_KO: Record<string, string> = {
  author: 'Feature 설계', approver: '구성 승인', quality: '품질 검토', operator: '차량 운영', steward: 'PLM 기준정보',
  commerce: '상품 권리', integrator: '시스템 연계', coordinator: '협의·개발 이관', viewer: '조회',
};
const ROLE_EN: Record<string, string> = {
  author: 'Feature Design', approver: 'Configuration Approval', quality: 'Quality Review', operator: 'Vehicle Operations', steward: 'PLM Master Data',
  commerce: 'Product Rights', integrator: 'System Integration', coordinator: 'Alignment & Handoff', viewer: 'Read-only',
};
/** 담당 화면이 없는 역할을 위한 공통 참조 화면 (내 업무·검토함·감사·추적) */
const COMMON_SCREENS = ['UI01', 'UI06', 'UI14', 'UI30'];

export const DEPT_NAV: Dept[] = Object.keys(ROLE_KO).map(role => {
  const owned = SPEC_MENU.flatMap(g => g.items.filter(it => it.owner === role).map(it => it.id));
  const sections: DeptSection[] = [
    { ko: '담당 화면', en: 'Owned screens', paths: owned.map(id => `/ui/${id}`) },
    { ko: '구현 화면', en: 'Implemented screens', paths: implPathsOf(owned) },
  ];
  const common = COMMON_SCREENS.filter(id => !owned.includes(id));
  if (common.length) sections.push({ ko: '공통 참조', en: 'Shared', paths: common.map(id => `/ui/${id}`) });
  return { role, icon: ROLE_ICON[role] || '👤', ko: ROLE_KO[role] || role, en: ROLE_EN[role] || role, sections: sections.filter(s => s.paths.length) };
});


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

// 정확 경로 → 업무 그룹. 기준 화면(/ui/UIxx)은 소속 그룹, 구현 데모 화면은
// uiLinks 의 연결(기준 화면 ↔ 구현 화면)을 따라 같은 그룹으로 묶는다.
// 기준 문서 참조 영역(/arch, /spec/*)은 7개 업무 그룹 밖이므로 제외한다.
const REF_SEGS = ['arch', 'spec'];
const isGroupPath = (p: string) => p !== '/' && !p.includes(':') && !REF_SEGS.includes(p.split('/')[1] || '');
// 기준 화면 연결(uiLinks)이 정본이다 — 구현 데모 화면이 어느 업무 그룹인지는
// 그 화면이 연결된 기준 화면의 소속 그룹으로 정한다. 레거시 구현 묶음(DEMO_GROUPS)은
// 기준 연결이 없는 경로의 보조 수단으로만 쓴다.
const EXACT_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  Object.values(SCREEN_LINKS).forEach(s => {
    const key = SPEC_MENU_GROUP_OF_SCREEN[s.screenId];
    if (!key) return;
    s.links.forEach(l => { if (isGroupPath(l.path) && !(l.path in m)) m[l.path] = key; });
  });
  DOMAINS.forEach(d => d.groups.forEach(g => g.items.forEach(it => {
    if (isGroupPath(it.to) && !(it.to in m)) m[it.to] = d.key;
  })));
  return m;
})();
const SEG_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  Object.values(SCREEN_LINKS).forEach(s => {
    const key = SPEC_MENU_GROUP_OF_SCREEN[s.screenId];
    if (!key) return;
    s.links.forEach(l => {
      const seg = l.path.split('/')[1] || '';
      if (seg && !REF_SEGS.includes(seg) && !(seg in m)) m[seg] = key;
    });
  });
  DOMAINS.forEach(d => d.groups.forEach(g => g.items.forEach(it => {
    const seg = it.to.split('/')[1] || '';
    if (seg && !REF_SEGS.includes(seg) && !(seg in m)) m[seg] = d.key;
  })));
  return m;
})();

/** 현재 경로가 속한 업무 그룹 키 (레일 하이라이트). 매핑이 없으면 '' — 기준 참조 화면. */
export function domainOfPath(pathname: string): string {
  if (EXACT_TO_DOMAIN[pathname]) return EXACT_TO_DOMAIN[pathname];
  const screen = /^\/ui\/(UI\d\d)/.exec(pathname);
  if (screen && SPEC_MENU_GROUP_OF_SCREEN[screen[1]]) return SPEC_MENU_GROUP_OF_SCREEN[screen[1]];
  const seg = pathname.split('/')[1] || '';
  if (!seg) return '';            // 홈(내 대시보드)은 업무 그룹 밖 — 레일은 홈 버튼이 담당
  return SEG_TO_DOMAIN[seg] || '';
}

/** 역할별 기본 착지 경로 (기준 30화면 안) */
export const roleHomePath = (role: string) => SPEC_ROLE_HOME[role] || '/ui/UI01';


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
    navDomain: (d: { ko: string; en: string }) => (lang === 'en' ? d.en : d.ko),
    deptLabel: (d: Dept | DeptSection) => (lang === 'en' ? d.en : d.ko),
  };
}
