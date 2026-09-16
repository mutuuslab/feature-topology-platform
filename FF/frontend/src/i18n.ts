import { useAppShell } from './store';
import { SPEC_MENU } from './data/specMenu';
import { canonAreaName } from './data/canonical';
import { SCREEN_CANON_BY_ID } from './data/screenAreas';
import {
  ROLE_HOME_IMPL, SCREEN_ENTRY, SCREEN_LINKS, navPathOfLink, screenEntryOf, screenOfRoute,
  type ImplementedLink,
} from './data/uiLinks';
import { SPEC_PLANE_NAV } from './data/specPlanesNav';

// 한/영 사전 — 네비게이션 셸 + 공통 UI. (페이지 본문은 점진 적용)
type Lang = 'ko' | 'en';
export interface NavItem { to: string; ko: string; en: string }

/** 기준 화면 하나 = 메뉴 항목 하나. 진입 경로는 그 화면이 구현된 경로 가운데 하나(`entry`)다. */
export interface NavScreen {
  /** 기준 화면 ID (UI01~UI30) */
  id: string;
  ko: string;
  en: string;
  /** 화면 진입 경로 */
  to: string;
  /** 담당 역할 키 (SPEC_MENU 의 owner) */
  owner: string;
  /** 대표 Plane 짧은 이름 */
  plane: string;
  /** 진입 뷰가 구현하는 정본 상세 영역 ID */
  areaId?: string;
  /** 그 화면의 구현 뷰 (진입 포함) — 화면 안 「구현 뷰」 이동에 쓴다 */
  views: NavItem[];
}

/** 업무 그룹 하나 = 레일 항목 하나. 그룹 아래에는 정본 화면이 정본 순서로 놓인다. */
export interface NavDomain { key: string; icon: string; ko: string; en: string; screens: NavScreen[] }
/** Plane·부서별 보기에서 화면을 업무 그룹으로 묶을 때 쓰는 묶음. */
export interface NavScreenGroup { ko: string; en: string; screens: NavScreen[] }

// ── 1차 IA = 정본 MENU 1.3 의 **2단계 메뉴** (7 업무 그룹 → 30 기준 화면) ──
// 제품에는 **실제 구현된 화면**만 올린다. 요구사양 문서 화면(/ui/UIxx · /arch · 용어집 · 개정 이력)은
// 제품의 화면·메뉴·참조 링크 어디에도 두지 않는다.
//
// 정본 런타임도 메뉴가 2단계다(그룹 → 화면). 그래서 서브내비는 **화면 목록**이고, 화면 안의 여러 구현
// 경로는 메뉴가 아니라 화면 안 「구현 뷰」 행으로 내려간다(data/uiLinks 의 entry·areaId).
// 메뉴 항목 이름은 정본 화면 이름을 그대로 쓰고, 구현 화면 이름은 화면 안에서만 보인다.
//
// 경로 → 소속 화면·영역은 uiLinks 연결표 순서(= 정본 화면 순서)가 정한다. 그래서 메뉴 소속·레일
// 하이라이트·빵부스러기(screenOfRoute)가 모두 같은 답을 내며, 셋을 따로 손으로 적지 않는다.

/** 기준 화면 ID → 정본 라벨 · 소속 업무 그룹 · 담당 역할 */
export const SCREEN_META: Record<string, { ko: string; en: string; domain: string; owner: string }> = Object.fromEntries(
  SPEC_MENU.flatMap(g => g.items.map(it => [it.id, { ko: it.ko, en: it.en, domain: g.id, owner: it.owner }])),
);

/** 경로 → 소속 업무 그룹 · 업무 영역 (메뉴 · 빵부스러기 · 레일 하이라이트의 단일 근거). */
const PATH_SECTION: Record<string, { domain: string; screenId: string }> = {};
Object.values(SCREEN_LINKS).forEach((s) => {
  const meta = SCREEN_META[s.screenId];
  if (!meta) return;
  s.links.forEach((l) => {
    const to = navPathOfLink(l);
    if (!to.startsWith('/') || to.includes(':')) return;
    if (!(to in PATH_SECTION)) PATH_SECTION[to] = { domain: meta.domain, screenId: s.screenId };
  });
});

/**
 * 구현 뷰의 표시 이름 — 정본 상세 영역 이름이 있으면 그 이름을 쓴다(메뉴·이동이 정본 용어를 쓰도록).
 *
 * 한 화면에서 두 뷰가 같은 정본 영역을 나눠 쓰면(예: UI11-S03 을 Fleet 3D 와 Live 3D 가 함께 씀)
 * 정본 이름만으로는 구분되지 않으므로 구현 화면 이름을 그대로 남긴다.
 */
const VIEW_LABEL: Map<ImplementedLink, string> = (() => {
  const m = new Map<ImplementedLink, string>();
  Object.values(SCREEN_LINKS).forEach(s => {
    const perArea = new Map<string, number>();
    s.links.forEach(l => { if (l.areaId) perArea.set(l.areaId, (perArea.get(l.areaId) || 0) + 1); });
    s.links.forEach(l => {
      const canon = l.areaId ? canonAreaName(l.areaId) : undefined;
      const shared = !!l.areaId && (perArea.get(l.areaId) || 0) > 1;
      m.set(l, canon && !shared ? canon : l.label);
    });
  });
  return m;
})();

function viewItem(link: ImplementedLink): NavItem {
  return { to: navPathOfLink(link), ko: VIEW_LABEL.get(link) || link.label, en: link.en };
}

/** 기준 화면 하나를 메뉴 항목으로 바꾼다. 구현된 진입 경로가 없으면 null. */
function screenOf(screenId: string): NavScreen | null {
  const meta = SCREEN_META[screenId];
  const link = SCREEN_LINKS[screenId];
  const to = SCREEN_ENTRY[screenId];
  if (!meta || !link || !to) return null;
  return {
    id: screenId, ko: meta.ko, en: meta.en, to, owner: meta.owner,
    plane: SCREEN_CANON_BY_ID[screenId]?.plane || '',
    areaId: screenEntryOf(screenId)?.areaId,
    views: link.links.filter(l => !navPathOfLink(l).includes(':')).map(viewItem),
  };
}

export const DOMAINS: NavDomain[] = SPEC_MENU.map(g => ({
  key: g.id,
  icon: g.icon,
  ko: g.ko,
  en: g.en,
  screens: g.items.map(it => screenOf(it.id)).filter((x): x is NavScreen => !!x),
}));

/** 기준 화면 ID → 메뉴 항목 (Plane·부서별 보기가 같은 값을 재사용한다). */
export const SCREEN_NAV: Record<string, NavScreen> = Object.fromEntries(
  DOMAINS.flatMap(d => d.screens).map(s => [s.id, s]),
);

// 하위호환: 평탄화된 화면 목록 (정본 화면 순)
export const NAV: NavScreen[] = DOMAINS.flatMap(d => d.screens);

// 경로 → NavItem 룩업 — 메뉴에 오르지 않은 구현 뷰까지 **모두** 담는다(빵부스러기·화면 안 이동·부서별 보기).
export const ITEM: Record<string, NavItem> = (() => {
  const m: Record<string, NavItem> = {};
  Object.values(SCREEN_LINKS).forEach(s => s.links.forEach((l) => {
    const to = navPathOfLink(l);
    if (to.includes(':') || to in m) return;
    m[to] = viewItem(l);
  }));
  return m;
})();

// ── 3차 IA = 4 Plane 보기 (FP Architecture v4.5 Core 귀속 축) ──
// Plane은 업무 그룹과 다른 축이다. 대표 Plane 배정 근거와 기준 화면 목록은 data/specPlanesNav.ts 가 원천이고
// (SPEC_PLANE_NAV · specPlaneOfPath 가 그대로 사용), 여기서는 셸이 쓰는 라벨 형태로 구현 화면만 바꾼다.
// Knowledge Foundation(shared)은 4 Plane이 아니라 공유 기반이며, 참조 문서 화면만 갖고 있었으므로
// 제품 레일에서는 제외한다 — 남는 레일은 실제 구현 화면을 가진 4 Plane뿐이다.
export interface PlaneNavDomain {
  key: string;
  icon: string;
  /** 레일 라벨 — Plane 짧은 이름 */
  ko: string;
  en: string;
  /** Plane 전체 이름 (레일 라벨은 ko/en 짧은 이름을 쓴다) */
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
  /** Plane 아래 화면 묶음 (업무 그룹 순서, 화면만 — 각 화면은 진입 경로 하나) */
  groups: NavScreenGroup[];
}

export const PLANE_NAV: PlaneNavDomain[] = SPEC_PLANE_NAV.filter(p => !p.shared).map(p => ({
  key: p.id, icon: p.icon, ko: p.shortKo, en: p.shortEn,
  fullKo: p.ko, fullEn: p.en,
  produces: p.produces, contract: p.contract, note: p.note, shared: !!p.shared,
  groups: p.screenGroups
    .map(g => ({ ko: g.ko, en: g.en, screens: g.screens.map(id => SCREEN_NAV[id]).filter((x): x is NavScreen => !!x) }))
    .filter(g => g.screens.length > 0),
}));

// ── 2차 IA = 부서별 보기 (정본 9 역할 → 담당 화면) ──
export interface Dept { role: string; icon: string; ko: string; en: string; screens: NavScreen[] }

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

// 부서별 보기 = 역할이 소유한 기준 화면(SPEC_MENU 의 owner)을 정본 순서 그대로 보여준다.
// 노출되는 것은 구현된 화면뿐이다 — 요구사양 문서 화면(/ui/UIxx)은 제품에 존재하지 않는다.
export const DEPT_NAV: Dept[] = Object.keys(ROLE_KO).map(role => {
  const owned = SPEC_MENU.flatMap(g => g.items.filter(it => it.owner === role).map(it => it.id));
  return {
    role,
    icon: ROLE_ICON[role] || '👤',
    ko: ROLE_KO[role] || role,
    en: ROLE_EN[role] || role,
    screens: owned.map(id => SCREEN_NAV[id]).filter((x): x is NavScreen => !!x),
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

/**
 * 경로 → 화면 머리(h1)에 쓸 정본 제목.
 *
 * 진입 경로는 정본 **화면** 이름을, 같은 화면의 나머지 구현 뷰는 그 뷰의 정본 **상세 영역** 이름을 쓴다
 * (영역 이름이 겹쳐 구분되지 않는 뷰는 구현 이름을 남긴다 — VIEW_LABEL 과 같은 규칙).
 *
 * 정적 경로 표(PATH_SECTION)에 없는 경로는 null 이다. `/feature/:id` 처럼 기록마다 대상이 달라지는
 * 상세 화면의 제목은 그 화면이 스스로 정한다.
 */
export function canonTitleOf(pathname: string, lang: Lang = 'ko'): string | null {
  const p = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const section = PATH_SECTION[p];
  const meta = section ? SCREEN_META[section.screenId] : undefined;
  if (!meta) return null;
  if (SCREEN_ENTRY[section.screenId] === p) return lang === 'en' ? meta.en : meta.ko;
  const item = ITEM[p];
  return item ? (lang === 'en' ? item.en : item.ko) : null;
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
    navScreen: (s: NavScreen) => (lang === 'en' ? s.en : s.ko),
    navItem: (i: { ko: string; en: string }) => (lang === 'en' ? i.en : i.ko),
    navDomain: (d: { ko: string; en: string }) => (lang === 'en' ? d.en : d.ko),
    deptLabel: (d: { ko: string; en: string }) => (lang === 'en' ? d.en : d.ko),
  };
}
