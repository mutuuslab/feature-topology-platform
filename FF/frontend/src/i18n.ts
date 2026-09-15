import { useAppShell } from './store';
import { SPEC_MENU } from './data/specMenu';
import { ROLE_HOME_IMPL, SCREEN_LINKS, implementedPaths, navPathOfLink, screenOfRoute } from './data/uiLinks';
import { SPEC_PLANE_NAV } from './data/specPlanesNav';

// 한/영 사전 — 네비게이션 셸 + 공통 UI. (페이지 본문은 점진 적용)
type Lang = 'ko' | 'en';
export interface NavItem { to: string; ko: string; en: string }
export interface NavGroup { ko: string; en: string; items: NavItem[] }
export interface NavDomain { key: string; icon: string; ko: string; en: string; groups: NavGroup[] }

// ── 1차 IA = 정본 MENU 1.3 의 7 업무 그룹 × 30 기준 화면 ──
// 제품에는 **실제 구현된 화면**만 올린다. 요구사양 문서 화면(/ui/UIxx · /arch · 용어집 · 개정 이력)은
// 제품의 화면·메뉴·참조 링크 어디에도 두지 않는다.
//
// 서브내비 묶음 = 정본 업무 영역(기준 화면) 하나. 묶음 제목은 그 영역의 정본 이름을 쓰고,
// 묶음 아래에는 그 영역이 실제로 구현된 화면 경로(uiLinks)만 넣는다. 구현 화면이 없는 영역은
// 묶음을 만들지 않는다 — 메뉴는 화면 목록이므로 빈 영역을 올릴 수 없다.
//
// 경로 → 소속 영역은 uiLinks 연결표 순서(= 정본 화면 순서)가 정한다. 그래서 메뉴 소속·레일 하이라이트·
// 빵부스러기(screenOfRoute)가 모두 같은 답을 내며, 셋을 따로 손으로 적지 않는다.

/** 기준 화면 ID → 정본 라벨 · 소속 업무 그룹 */
const SCREEN_META: Record<string, { ko: string; en: string; domain: string }> = Object.fromEntries(
  SPEC_MENU.flatMap(g => g.items.map(it => [it.id, { ko: it.ko, en: it.en, domain: g.id }])),
);

/** 이미 다른 영역이 가져간 경로 — 한 경로는 메뉴에서 한 곳에만 나온다. */
const CLAIMED = new Set<string>();
/** 경로 → 소속 업무 그룹 · 업무 영역 (메뉴 · 빵부스러기 · 레일 하이라이트의 단일 근거). */
const PATH_SECTION: Record<string, { domain: string; screenId: string }> = {};

/** 기준 화면 하나를 서브내비 묶음으로 바꾼다. 구현 경로가 없으면 null. */
function sectionOfScreen(screenId: string): NavGroup | null {
  const meta = SCREEN_META[screenId];
  const entry = SCREEN_LINKS[screenId];
  if (!meta || !entry) return null;
  const items: NavItem[] = [];
  entry.links.forEach((l) => {
    const to = navPathOfLink(l);
    if (!to.startsWith('/') || to.includes(':') || CLAIMED.has(to)) return;
    CLAIMED.add(to);
    PATH_SECTION[to] = { domain: meta.domain, screenId };
    items.push({ to, ko: l.label, en: l.en });
  });
  return items.length ? { ko: meta.ko, en: meta.en, items } : null;
}

export const DOMAINS: NavDomain[] = SPEC_MENU.map(g => ({
  key: g.id,
  icon: g.icon,
  ko: g.ko,
  en: g.en,
  groups: g.items.map(it => sectionOfScreen(it.id)).filter((x): x is NavGroup => !!x),
}));

// 하위호환: 평탄화된 묶음 목록 (정본 업무 영역 순)
export const NAV: NavGroup[] = DOMAINS.flatMap(d => d.groups);

// 경로 → NavItem 룩업 (부서별·Plane별 보기에서 라벨 i18n 재사용)
export const ITEM: Record<string, NavItem> = (() => {
  const m: Record<string, NavItem> = {};
  NAV.forEach(g => g.items.forEach(it => { if (!(it.to in m)) m[it.to] = it; }));
  return m;
})();

// ── 3차 IA = 4 Plane 보기 (FP Architecture v4.5 Core 귀속 축) ──
// Plane은 업무 그룹과 다른 축이다. 대표 Plane 배정 근거와 기준 화면 목록은 data/specPlanesNav.ts 가 원천이고
// (SPEC_PLANE_NAV · specPlaneOfPath 가 그대로 사용), 여기서는 셸이 쓰는 라벨 형태로 구현 화면만 바꾼다.
// Knowledge Foundation(shared)은 4 Plane이 아니라 공유 기반이며, 참조 문서 화면만 갖고 있었으므로
// 제품 레일에서는 제외한다 — 남는 레일은 실제 구현 화면을 가진 4 Plane뿐이다.
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

export const PLANE_NAV: PlaneNavDomain[] = SPEC_PLANE_NAV.filter(p => !p.shared).map(p => ({
  key: p.id, icon: p.icon, ko: p.shortKo, en: p.shortEn,
  fullKo: p.ko, fullEn: p.en,
  produces: p.produces, contract: p.contract, note: p.note, shared: !!p.shared,
  groups: p.demos.map(g => ({
    ko: g.ko, en: g.en,
    items: g.routes.map(r => ITEM[r] || { to: r, ko: r, en: r }),
  })),
}));

// ── 2차 IA = 부서별 보기 (정본 9 역할 → 담당 화면 큐레이션) ──
export interface DeptSection { ko: string; en: string; paths: string[] }
export interface Dept { role: string; icon: string; ko: string; en: string; sections: DeptSection[] }

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

// 부서별 보기 = 역할이 소유한 기준 화면(SPEC_MENU 의 owner) 하나를 묶음 하나로 보여준다.
// 묶음 제목은 정본 업무 영역 이름, 내용은 그 영역이 구현된 메뉴 경로다.
// 노출되는 것은 구현된 경로뿐이다 — 요구사양 문서 화면(/ui/UIxx)은 제품에 존재하지 않는다.
export const DEPT_NAV: Dept[] = Object.keys(ROLE_KO).map(role => {
  const owned = SPEC_MENU.flatMap(g => g.items.filter(it => it.owner === role).map(it => it.id));
  const seen = new Set<string>();
  const sections: DeptSection[] = owned.map(id => {
    const meta = SCREEN_META[id];
    const paths = implementedPaths(id).filter(p => ITEM[p] && !seen.has(p));
    paths.forEach(p => seen.add(p));
    return { ko: meta?.ko || id, en: meta?.en || id, paths };
  }).filter(s => s.paths.length > 0);
  return {
    role,
    icon: ROLE_ICON[role] || '👤',
    ko: ROLE_KO[role] || role,
    en: ROLE_EN[role] || role,
    sections,
  };
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

// 메뉴에 없는 하위 경로(상세 화면 등)를 업무 그룹으로 되돌리기 위한 1세그먼트 보조표.
const SEG_TO_DOMAIN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  Object.keys(PATH_SECTION).forEach((p) => {
    const seg = p.split('/')[1] || '';
    if (seg && !(seg in m)) m[seg] = PATH_SECTION[p].domain;
  });
  Object.values(SCREEN_LINKS).forEach(s => {
    const domain = SCREEN_META[s.screenId]?.domain;
    const seg = s.links[0]?.path.split('/')[1] || '';
    if (domain && seg && !(seg in m)) m[seg] = domain;
  });
  return m;
})();

/** 현재 경로가 속한 업무 그룹 키 (레일 하이라이트). 업무 영역 밖(404)이면 ''. */
export function domainOfPath(pathname: string): string {
  const p = pathname.split('?')[0];
  if (PATH_SECTION[p]) return PATH_SECTION[p].domain;
  const screen = screenOfRoute(p);
  if (screen) return SCREEN_META[screen]?.domain || '';
  const seg = p.split('/')[1] || '';
  if (!seg) return '';
  return SEG_TO_DOMAIN[seg] || '';
}

/** 현재 경로의 정본 위치 — 업무 그룹 · 업무 영역 · 그 영역에서의 화면 항목. */
export interface NavLocation {
  domain: { key: string; icon: string; ko: string; en: string };
  screen: { id: string; ko: string; en: string };
  item?: NavItem;
}

export function locatePath(pathname: string): NavLocation | undefined {
  const p = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const section = PATH_SECTION[p];
  const screenId = section?.screenId || screenOfRoute(p);
  const meta = screenId ? SCREEN_META[screenId] : undefined;
  const dom = DOMAINS.find(d => d.key === (section?.domain || meta?.domain));
  if (!screenId || !meta || !dom) return undefined;
  return {
    domain: { key: dom.key, icon: dom.icon, ko: dom.ko, en: dom.en },
    screen: { id: screenId, ko: meta.ko, en: meta.en },
    item: ITEM[p],
  };
}

/** 역할별 기본 착지 경로 — 구현 화면만 쓴다 (data/uiLinks.ROLE_HOME_IMPL). */
export const roleHomePath = (role: string) => ROLE_HOME_IMPL[role] || '/catalog';

export function useT() {
  // 라벨은 UI 언어에만 의존한다 — 전체 state 를 구독하면 2초 LIVE_TICK 마다
  // useT() 를 쓰는 모든 컴포넌트가 함께 리렌더된다.
  const { lang: raw = 'ko' } = useAppShell();
  const lang = (raw || 'ko') as Lang;
  return {
    lang,
    t: (k: string) => COMMON[k]?.[lang] ?? COMMON[k]?.ko ?? k,
    navGroup: (g: NavGroup) => (lang === 'en' ? g.en : g.ko),
    navItem: (i: { ko: string; en: string }) => (lang === 'en' ? i.en : i.ko),
    navDomain: (d: { ko: string; en: string }) => (lang === 'en' ? d.en : d.ko),
    deptLabel: (d: Dept | DeptSection) => (lang === 'en' ? d.en : d.ko),
  };
}
