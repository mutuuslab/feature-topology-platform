// 기준 화면(UI01~UI30)과 이 앱에 실제로 구현된 화면의 연결표.
// 기준 패키지는 화면·영역·작업·API 계약만 정의하고 구현 화면 경로는 갖지 않으므로,
// 이 표는 앱 쪽 구현 대응 관계이며 기준 데이터가 아니다.
//
// 정렬 규칙 — 항목 순서가 곧 정본 MENU 1.3 의 화면 순서(업무 그룹 순 → 그룹 안 화면 순)다.
//   · 구현 경로 하나가 여러 기준 화면에 걸리면 **먼저 오는 화면이 대표 화면**이 된다.
//     그래서 기능별 메뉴의 소속 영역은 screenOfRoute() 의 답과 언제나 같다(따로 손으로 적지 않는다).
//   · path 는 역조회 패턴(동적 세그먼트 :id 허용), nav 는 메뉴에 거는 실제 경로다.
//     nav 가 없으면 path 를 그대로 쓴다.
export interface ImplementedLink {
  /** 역조회 패턴 (예: /twin/vehicle/:vin) */
  path: string;
  /** 메뉴에 거는 실제 경로 (동적 세그먼트 패턴의 대표 값) */
  nav?: string;
  label: string;
  en: string;
}

export interface ScreenLink {
  screenId: string;
  intent: string;
  links: ImplementedLink[];
}

export const SCREEN_LINKS: Record<string, ScreenLink> = {
  // ── 내 업무 ──
  UI01: { screenId: 'UI01', intent: '내 업무 대시보드와 홈 구성', links: [
    { path: '/', label: '내 대시보드', en: 'My Dashboard' },
    { path: '/home/customize', label: '홈 커스터마이즈', en: 'Customize Home' },
  ] },
  UI06: { screenId: 'UI06', intent: '검토 대기와 승인 판단', links: [
    { path: '/admin/approval', label: '검토함', en: 'Review Inbox' },
    { path: '/decisions/center', label: 'Decision Center', en: 'Decision Center' },
  ] },
  UI25: { screenId: 'UI25', intent: '협의와 개발 이관', links: [
    { path: '/decisions/report', label: 'Decision Report', en: 'Decision Report' },
    { path: '/decisions/supplier', label: 'Supplier Scope', en: 'Supplier Scope' },
    { path: '/supplier/portal', label: 'Supplier Portal', en: 'Supplier Portal' },
    { path: '/supplier/package', label: 'API Release Package', en: 'API Release Package' },
  ] },
  UI27: { screenId: 'UI27', intent: '운영 인계와 조치', links: [
    { path: '/ops/:id', nav: '/ops/FEAT-BDC-001', label: 'Ops · Kill Switch', en: 'Ops · Kill Switch' },
    { path: '/ops/policy', label: 'Policy Lifecycle', en: 'Policy Lifecycle' },
    { path: '/ops/runtime', label: 'Runtime Sim', en: 'Runtime Sim' },
    { path: '/admin/notifications', label: 'Notifications', en: 'Notifications' },
  ] },

  // ── Feature 관리 ──
  UI19: { screenId: 'UI19', intent: 'Feature 제안과 중복 검사', links: [
    { path: '/feature/propose', label: 'Feature 제안', en: 'Feature Proposal' },
  ] },
  UI02: { screenId: 'UI02', intent: 'Feature 정의·정확 버전과 등록(Revision) 흐름', links: [
    { path: '/catalog', label: 'Feature Catalog', en: 'Feature Catalog' },
    { path: '/master/define', label: 'Feature 등록 (Revision)', en: 'Feature Registration (Revision)' },
    { path: '/master/taxonomy', label: 'Taxonomy Browser', en: 'Taxonomy Browser' },
    { path: '/master/taxonomy/edit', label: 'Taxonomy Editor', en: 'Taxonomy Editor' },
    { path: '/lifecycle', label: 'Lifecycle 관리', en: 'Lifecycle Management' },
    { path: '/feature/:id', nav: '/feature/FEAT-BDC-001', label: 'Feature 상세 · 이력', en: 'Feature Detail & History' },
  ] },
  UI28: { screenId: 'UI28', intent: '변경요청과 Revision 비교', links: [
    { path: '/change/cr', label: '변경요청 (Revision 비교)', en: 'Change Request & Revision Compare' },
    { path: '/change/cr/:id', nav: '/change/cr/CR-2026-0101', label: '변경요청 상세', en: 'Change Request Detail' },
    { path: '/change/timeline', label: 'Version Timeline', en: 'Version Timeline' },
  ] },

  // ── 구성과 PLM ──
  UI03: { screenId: 'UI03', intent: 'Feature별 구현 구성과 Variant 범위', links: [
    { path: '/master/bom/items', label: 'Feature별 구현 구성', en: 'Per-Feature Implementation' },
    { path: '/variants/:id', nav: '/variants/FEAT-BDC-001', label: 'Variant Matrix', en: 'Variant Matrix' },
  ] },
  UI04: { screenId: 'UI04', intent: 'Feature BOM 기준선과 승인 버전', links: [
    { path: '/master/bom', label: 'Feature BOM 기준선', en: 'Feature BOM Baseline' },
    { path: '/change/baseline', label: 'Baseline Diff', en: 'Baseline Diff' },
  ] },
  UI05: { screenId: 'UI05', intent: 'Topology 관계와 변경 영향', links: [
    { path: '/arch/topology', label: 'Topology 동작 메커니즘', en: 'Topology Mechanism' },
    { path: '/topology/:id', nav: '/topology/FEAT-BDC-001', label: 'Topology Graph', en: 'Topology Graph' },
    { path: '/topology/edge', label: 'Edge Editor', en: 'Edge Editor' },
    { path: '/impact', label: 'Impact Analysis', en: 'Impact Analysis' },
    { path: '/twin/impact', label: 'Impact Preview', en: 'Impact Preview' },
    { path: '/twin/simulation', label: 'What-if Simulation', en: 'What-if Simulation' },
    { path: '/consistency', label: 'Consistency Console', en: 'Consistency Console' },
    { path: '/consistency/violation', label: 'Violation Detail', en: 'Violation Detail' },
  ] },
  UI20: { screenId: 'UI20', intent: 'SW ID와 버전 관리', links: [
    { path: '/master/artifacts', label: 'SW ID · 버전', en: 'SW ID & Version' },
  ] },
  UI21: { screenId: 'UI21', intent: 'UPG와 UPG VC 구성', links: [
    { path: '/master/upg', label: 'UPG · UPG VC', en: 'UPG & UPG VC' },
    { path: '/master/control-points', label: 'Feature 제어점', en: 'Feature ControlPoint' },
  ] },
  UI22: { screenId: 'UI22', intent: 'SW Structure 정의', links: [
    { path: '/master/structure', label: 'SW Structure', en: 'SW Structure' },
  ] },
  UI23: { screenId: 'UI23', intent: 'SW EO 변경관리', links: [
    { path: '/change/eo', label: 'SW EO 변경관리', en: 'SW EO Change Management' },
  ] },
  UI24: { screenId: 'UI24', intent: '제품사양과 HW Variant', links: [
    { path: '/master/product-spec', label: '제품사양 · HW Variant', en: 'Product Spec & HW Variant' },
  ] },

  // ── 상품과 출시 ──
  UI07: { screenId: 'UI07', intent: 'Catalog 상품 구성과 판매 단위', links: [
    { path: '/commerce/offer', label: 'Catalog 상품 구성', en: 'Catalog Offer Configuration' },
  ] },
  UI09: { screenId: 'UI09', intent: '상품 사용 권리와 과금 조건', links: [
    { path: '/cost', label: 'SW 개발비 / Cost', en: 'SW Cost' },
    { path: '/commerce/billing', label: '과금 시스템 연계', en: 'Billing Integration' },
  ] },
  UI08: { screenId: 'UI08', intent: '차량 적용 대상과 활성화 범위', links: [
    { path: '/activation', label: 'Activation · 차종 제어', en: 'Activation Control' },
  ] },
  UI10: { screenId: 'UI10', intent: '출시 판단과 차량 적용 실행', links: [
    { path: '/readiness/:id', nav: '/readiness/FEAT-BDC-001', label: 'Release Readiness', en: 'Release Readiness' },
    { path: '/ops/campaign', label: 'OTA Campaign', en: 'OTA Campaign' },
    { path: '/decisions/deploy', label: 'Deployment Decision', en: 'Deployment Decision' },
    { path: '/release/cicd', label: 'CI/CD 파이프라인', en: 'CI/CD Pipeline' },
    { path: '/insights/business', label: '글로벌 출시 · 현장 지원', en: 'Global Rollout & Field Support' },
  ] },

  // ── 차량 운영 ──
  UI11: { screenId: 'UI11', intent: '차량 운영 현황과 수렴 상태', links: [
    { path: '/fleet', label: 'Fleet · 차량 상태', en: 'Fleet · Vehicles' },
    { path: '/twin/fleet', label: 'Twin Fleet (3D)', en: 'Twin Fleet (3D)' },
    { path: '/twin/live', label: 'Live Visual Twin (3D)', en: 'Live Visual Twin (3D)' },
  ] },
  UI12: { screenId: 'UI12', intent: '차량별 적용 상태와 관측값', links: [
    { path: '/twin/vehicle/:vin', nav: '/twin/vehicle/VIN-DEMO-017', label: 'Vehicle Twin 상세', en: 'Vehicle Twin Detail' },
    { path: '/ops/telemetry', label: 'Telemetry Explorer', en: 'Telemetry Explorer' },
  ] },
  UI13: { screenId: 'UI13', intent: '장애·복구와 폐루프 조치', links: [
    { path: '/ops/incident', label: 'Incident 관리', en: 'Incident' },
    { path: '/twin/incident', label: 'Closed-Loop Incident', en: 'Closed-Loop Incident' },
  ] },

  // ── 품질과 추적 ──
  UI16: { screenId: 'UI16', intent: '품질 기준과 검증 증적', links: [
    { path: '/verify/evidence', label: 'Test Evidence Manager', en: 'Test Evidence Manager' },
    { path: '/verify/compliance', label: '컴플라이언스 룰', en: 'Compliance Rules' },
    { path: '/verify/scenario', label: '시나리오 검증', en: 'Scenario Verification' },
    { path: '/verify/experiment', label: '실험 · 효과 검증', en: 'Experiments' },
    { path: '/decisions/verification', label: 'Verification Scope', en: 'Verification Scope' },
  ] },
  UI30: { screenId: 'UI30', intent: '요구사항과 설계 추적', links: [
    { path: '/trace/design', label: '요구 · 설계 추적', en: 'Requirement & Design Trace' },
  ] },
  UI14: { screenId: 'UI14', intent: '감사 추적과 변경 이력 조회', links: [
    { path: '/insights/audit', label: 'Audit Log', en: 'Audit Log' },
  ] },

  // ── 연계와 운영 기준 ──
  UI15: { screenId: 'UI15', intent: '데이터 가져오기와 검증', links: [
    { path: '/integration/sync', label: 'Sync Logs', en: 'Sync Logs' },
  ] },
  UI18: { screenId: 'UI18', intent: '외부 시스템 연계 계약', links: [
    { path: '/integration/connectors', label: 'Connector Hub', en: 'Connector Hub' },
  ] },
  UI26: { screenId: 'UI26', intent: '연계 작업과 재처리', links: [
    { path: '/integration/jobs', label: '연계 작업 · 재처리', en: 'Integration Jobs & Reprocessing' },
  ] },
  UI17: { screenId: 'UI17', intent: '사용자 범위와 권한·직무 분리', links: [
    { path: '/login', label: 'Login · SSO', en: 'Login · SSO' },
    { path: '/onboarding', label: 'Onboarding', en: 'Onboarding' },
    { path: '/admin/users', label: 'Users & Roles', en: 'Users & Roles' },
    { path: '/admin/permissions', label: 'Permissions Matrix', en: 'Permissions Matrix' },
    { path: '/admin/org', label: 'Org & Domains', en: 'Org & Domains' },
  ] },
  UI29: { screenId: 'UI29', intent: '운영 기준과 지표', links: [
    { path: '/insights/reports', label: 'Reports', en: 'Reports' },
    { path: '/admin/settings', label: 'Settings', en: 'Settings' },
    { path: '/admin/security', label: '보안 운영', en: 'Security Ops' },
    { path: '/policy/exception', label: '예외 정책', en: 'Exception Policy' },
    { path: '/policy/conflict', label: '정책 충돌', en: 'Policy Conflict' },
  ] },
};

/** 연결의 실제 이동 경로 (nav 우선). */
export const navPathOfLink = (l: ImplementedLink) => l.nav || l.path;

/**
 * 역할별 기본 착지 화면 — **구현 화면 경로만** 쓴다.
 *
 * 셸의 3개 보기(기능별·부서별·Plane별)는 실제 구현 화면만 메뉴에 올리므로 착지도 구현 화면이어야 한다.
 * 각 값은 그 역할이 소유한 기준 화면(SPEC_MENU 의 owner)의 `SCREEN_LINKS` 구현 경로 중 하나이며,
 * `regression.test.tsx` 가 (1) 소유 기준 화면과의 연결 (2) 메뉴에 실제로 있는 경로인지를 함께 검증한다.
 * 기준 패키지의 화면 정의서(`/ui/UIxx`)로는 착지하지 않는다 — 그건 참조 영역의 문서다.
 */
export const ROLE_HOME_IMPL: Record<string, string> = {
  author: '/master/define', // UI02 Feature Registry
  approver: '/admin/approval', // UI06 검토함
  quality: '/verify/evidence', // UI16 품질 기준과 검증 증적
  operator: '/fleet', // UI11 차량 운영 현황
  steward: '/master/upg', // UI21 UPG와 UPG VC
  commerce: '/commerce/offer', // UI07 Catalog 상품 구성
  integrator: '/integration/connectors', // UI18 외부 시스템 연계
  coordinator: '/decisions/report', // UI25 협의와 개발 이관
  viewer: '/insights/audit', // UI14 감사 추적
};

export function implementedLinks(screenId: string): ScreenLink {
  return SCREEN_LINKS[screenId] || { screenId, intent: '', links: [] };
}

/** 기준 화면이 구현된 메뉴 경로 (정본 순서, 동적 패턴 제외). */
export function implementedPaths(screenId: string): string[] {
  return implementedLinks(screenId).links
    .map(navPathOfLink)
    .filter(p => !p.includes(':'));
}

function segmentMatch(linkSeg: string, pathSeg: string): boolean {
  return linkSeg.startsWith(':') || linkSeg.toLowerCase() === pathSeg.toLowerCase();
}

/**
 * 현재 경로가 어떤 기준 화면의 구현 대응인지 역으로 찾는다.
 *
 * 가장 긴 일치를 먼저 보고, 길이가 같으면 `SCREEN_LINKS` 순서(= 정본 화면 순서)가 앞선 화면을 고른다.
 * 예: /twin/vehicle/VIN-DEMO-017 → UI12, /change/timeline → UI28(정본 순서가 앞선 화면)
 */
export function screenOfRoute(pathname: string): string | undefined {
  const target = pathname.split('?')[0].split('/').filter(Boolean);
  let best: { id: string; score: number } | undefined;
  Object.values(SCREEN_LINKS).forEach((entry) => {
    entry.links.forEach((link) => {
      const segs = link.path.split('/').filter(Boolean);
      if (segs.length === 0 || segs.length > target.length) return;
      if (!segs.every((s, i) => segmentMatch(s, target[i]))) return;
      const score = segs.length;
      if (!best || score > best.score) best = { id: entry.screenId, score };
    });
  });
  return best ? best.id : undefined;
}
