// 기준 메뉴 (FP-DETAILED-1.1 / MENU 1.3) — 7 업무 그룹 · 30 화면.
//
// 이 파일은 기준 패키지의 그룹·화면 이름을 그대로 옮긴 얇은 계층이다.
// 화면 ID·그룹·담당 역할은 specNav.ts(생성물)를 원천으로 삼고, 여기서는
// 셸(레일·서브내비)에 필요한 2개 국어 라벨과 아이콘만 덧붙인다.
// 값이 어긋나면 src/__tests__/specData.test.ts 의 메뉴 정합 테스트가 실패한다.

export interface SpecMenuItem {
  /** 화면 ID (UI01~UI30) */
  id: string;
  ko: string;
  en: string;
  /** 담당 역할 키 (specNav SPEC_SCREENS[].owner) */
  owner: string;
  /** 화면 유형 (specNav SPEC_SCREENS[].kind) */
  kind: string;
}

export interface SpecMenuGroup {
  id: string;
  ko: string;
  en: string;
  icon: string;
  items: SpecMenuItem[];
}

export const SPEC_MENU: SpecMenuGroup[] = [
  {
    id: 'work', ko: '내 업무', en: 'My Work', icon: '🗂',
    items: [
      { id: 'UI01', ko: '내 업무와 진행 현황', en: 'My Work & Progress', owner: '전체', kind: 'home' },
      { id: 'UI06', ko: '검토함', en: 'Review Inbox', owner: 'approver', kind: 'task' },
      { id: 'UI25', ko: '협의와 개발 이관', en: 'Alignment & Dev Handoff', owner: 'coordinator', kind: 'handoff' },
      { id: 'UI27', ko: '운영 인계와 조치', en: 'Ops Handover & Actions', owner: 'operator', kind: 'handover' },
    ],
  },
  {
    id: 'feature', ko: 'Feature 관리', en: 'Feature Management', icon: '📦',
    items: [
      { id: 'UI19', ko: 'Feature 제안', en: 'Feature Proposal', owner: 'author', kind: 'proposal' },
      { id: 'UI02', ko: 'Feature Registry', en: 'Feature Registry', owner: 'author', kind: 'feature' },
      { id: 'UI28', ko: '변경요청과 Revision 비교', en: 'Change Request & Revision Compare', owner: 'author', kind: 'change' },
    ],
  },
  {
    id: 'config', ko: '구성과 PLM', en: 'Configuration & PLM', icon: '🧩',
    items: [
      { id: 'UI03', ko: 'Feature별 구현 구성', en: 'Per-Feature Implementation', owner: 'author', kind: 'implementation' },
      { id: 'UI04', ko: 'Feature BOM 기준선', en: 'Feature BOM Baseline', owner: 'author', kind: 'bom' },
      { id: 'UI05', ko: 'Topology와 변경 영향', en: 'Topology & Change Impact', owner: 'author', kind: 'topology' },
      { id: 'UI20', ko: 'SW ID와 버전', en: 'SW ID & Version', owner: 'author', kind: 'sw' },
      { id: 'UI21', ko: 'UPG와 UPG VC', en: 'UPG & UPG VC', owner: 'steward', kind: 'upg' },
      { id: 'UI22', ko: 'SW Structure', en: 'SW Structure', owner: 'author', kind: 'structure' },
      { id: 'UI23', ko: 'SW EO 변경관리', en: 'SW EO Change Management', owner: 'steward', kind: 'eo' },
      { id: 'UI24', ko: '제품사양과 HW Variant', en: 'Product Spec & HW Variant', owner: 'steward', kind: 'spec' },
    ],
  },
  {
    id: 'release', ko: '상품과 출시', en: 'Product & Release', icon: '🚀',
    items: [
      { id: 'UI07', ko: 'Catalog 상품 구성', en: 'Catalog Offer Configuration', owner: 'commerce', kind: 'offer' },
      { id: 'UI09', ko: '상품 사용 권리', en: 'Product Entitlements', owner: 'commerce', kind: 'entitlement' },
      { id: 'UI08', ko: '차량 적용 대상', en: 'Vehicle Target Scope', owner: 'operator', kind: 'target' },
      { id: 'UI10', ko: '출시와 차량 적용', en: 'Release & Vehicle Rollout', owner: 'operator', kind: 'release' },
    ],
  },
  {
    id: 'vehicle', ko: '차량 운영', en: 'Vehicle Operations', icon: '🚚',
    items: [
      { id: 'UI11', ko: '차량 운영 현황', en: 'Vehicle Operations Status', owner: 'operator', kind: 'fleet' },
      { id: 'UI12', ko: '차량별 적용 상태', en: 'Per-Vehicle Applied State', owner: 'operator', kind: 'vehicle' },
      { id: 'UI13', ko: '장애와 복구', en: 'Incident & Recovery', owner: 'operator', kind: 'incident' },
    ],
  },
  {
    id: 'quality', ko: '품질과 추적', en: 'Quality & Traceability', icon: '✅',
    items: [
      { id: 'UI16', ko: '품질 기준과 검증 증적', en: 'Quality Criteria & Evidence', owner: 'quality', kind: 'evidence' },
      { id: 'UI30', ko: '요구사항과 설계 추적', en: 'Requirement & Design Traceability', owner: 'viewer', kind: 'trace' },
      { id: 'UI14', ko: '감사와 변경 이력', en: 'Audit & Change History', owner: 'viewer', kind: 'audit' },
    ],
  },
  {
    id: 'admin', ko: '연계와 운영 기준', en: 'Integration & Ops Baseline', icon: '🔗',
    items: [
      { id: 'UI15', ko: '데이터 가져오기', en: 'Data Import', owner: 'author', kind: 'import' },
      { id: 'UI18', ko: '외부 시스템 연계', en: 'External System Integration', owner: 'integrator', kind: 'connector' },
      { id: 'UI26', ko: '연계 작업과 재처리', en: 'Integration Jobs & Reprocessing', owner: 'integrator', kind: 'job' },
      { id: 'UI17', ko: '사용자 범위와 권한', en: 'User Scope & Permissions', owner: 'integrator', kind: 'access' },
      { id: 'UI29', ko: '운영 기준과 지표', en: 'Operations Baseline & Metrics', owner: 'operator', kind: 'policy' },
    ],
  },
];

export const SPEC_MENU_GROUP_BY_ID: Record<string, SpecMenuGroup> =
  Object.fromEntries(SPEC_MENU.map((g) => [g.id, g]));

/** 화면 ID → 메뉴 항목 (30건) */
export const SPEC_MENU_ITEM: Record<string, SpecMenuItem> = (() => {
  const m: Record<string, SpecMenuItem> = {};
  SPEC_MENU.forEach((g) => g.items.forEach((it) => { m[it.id] = it; }));
  return m;
})();

/** 화면 ID → 소속 그룹 ID */
export const SPEC_MENU_GROUP_OF_SCREEN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  SPEC_MENU.forEach((g) => g.items.forEach((it) => { m[it.id] = g.id; }));
  return m;
})();

/** 역할이 소유한 기준 화면 ID 목록 (specNav owner 기준) */
export const screensOfOwner = (owner: string) =>
  SPEC_MENU.flatMap((g) => g.items.filter((it) => it.owner === owner).map((it) => it.id));
