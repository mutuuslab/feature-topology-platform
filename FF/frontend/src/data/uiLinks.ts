// 기준 화면(UI01~UI30)과 이 데모 앱에 실제로 구현된 화면의 연결표.
// 기준 패키지는 화면·영역·작업·API 계약만 정의하고 구현 화면 경로는 갖지 않으므로,
// 이 표는 앱 쪽 구현 대응 관계이며 기준 데이터가 아니다.
export interface ImplementedLink {
  path: string;
  label: string;
}

export interface ScreenLink {
  screenId: string;
  intent: string;
  links: ImplementedLink[];
}

export const SCREEN_LINKS: Record<string, ScreenLink> = {
  UI01: { screenId: 'UI01', intent: '내 업무 대시보드와 홈 구성', links: [
    { path: '/', label: '내 대시보드' },
    { path: '/home/customize', label: '홈 커스터마이즈' },
  ] },
  UI02: { screenId: 'UI02', intent: 'Feature 정의·정확 버전과 등록(Revision) 흐름', links: [
    { path: '/catalog', label: 'Feature Catalog' },
    { path: '/master/define', label: 'Feature 등록 (Revision)' },
    { path: '/feature/FEAT-BDC-001', label: 'Feature 상세 · 이력' },
  ] },
  UI03: { screenId: 'UI03', intent: 'Feature별 구현 구성과 Variant 범위', links: [
    { path: '/master/bom', label: 'BOM Editor' },
    { path: '/variants/FEAT-BDC-001', label: 'Variant Matrix' },
  ] },
  UI04: { screenId: 'UI04', intent: 'Feature BOM 기준선과 승인 버전', links: [
    { path: '/master/bom', label: 'BOM Editor' },
    { path: '/change/baseline', label: 'Baseline Diff' },
  ] },
  UI05: { screenId: 'UI05', intent: 'Topology 관계와 변경 영향', links: [
    { path: '/topology/FEAT-BDC-001', label: 'Topology Graph' },
    { path: '/topology/edge', label: 'Edge Editor' },
    { path: '/impact', label: 'Impact Analysis' },
    { path: '/consistency', label: 'Consistency Console' },
  ] },
  UI06: { screenId: 'UI06', intent: '검토 대기·승인 판단', links: [
    { path: '/admin/approval', label: 'Approval Workflow' },
    { path: '/decisions/center', label: 'Decision Center' },
  ] },
  UI07: { screenId: 'UI07', intent: 'Catalog 상품 구성과 판매 단위', links: [
    { path: '/catalog', label: 'Feature Catalog' },
    { path: '/variants/FEAT-BDC-001', label: 'Variant Matrix' },
  ] },
  UI08: { screenId: 'UI08', intent: '차량 적용 대상과 활성화 범위', links: [
    { path: '/activation', label: 'Activation' },
    { path: '/fleet', label: 'Fleet 개요' },
  ] },
  UI09: { screenId: 'UI09', intent: '상품 사용 권리와 과금 조건', links: [
    { path: '/cost', label: 'SW 개발비 / Cost' },
    { path: '/spec/business', label: '글로벌·현장·사업' },
  ] },
  UI10: { screenId: 'UI10', intent: '출시 판단과 차량 적용 실행', links: [
    { path: '/readiness/FEAT-BDC-001', label: 'Release Readiness' },
    { path: '/ops/campaign', label: 'OTA Campaign' },
  ] },
  UI11: { screenId: 'UI11', intent: '차량 운영 현황과 수렴 상태', links: [
    { path: '/fleet', label: 'Fleet 개요' },
    { path: '/twin/fleet', label: 'Twin Fleet' },
    { path: '/twin/live', label: 'Live Visual Twin (3D)' },
  ] },
  UI12: { screenId: 'UI12', intent: '차량별 적용 상태와 관측값', links: [
    { path: '/twin/vehicle/:vin', label: 'Vehicle Twin 상세' },
    { path: '/ops/telemetry', label: 'Telemetry Explorer' },
  ] },
  UI13: { screenId: 'UI13', intent: '장애·복구와 폐루프 조치', links: [
    { path: '/ops/incident', label: 'Incident 관리' },
    { path: '/twin/incident', label: 'Closed-Loop Incident' },
  ] },
  UI14: { screenId: 'UI14', intent: '감사 추적과 변경 이력 조회', links: [
    { path: '/insights/audit', label: 'Audit Log' },
    { path: '/change/timeline', label: 'Version Timeline' },
  ] },
  UI15: { screenId: 'UI15', intent: '데이터 가져오기와 검증', links: [
    { path: '/integration/sync', label: 'Sync Logs' },
  ] },
  UI16: { screenId: 'UI16', intent: '품질 기준과 검증 증적', links: [
    { path: '/verify/evidence', label: 'Test Evidence Manager' },
    { path: '/spec/compliance', label: '컴플라이언스 룰' },
  ] },
  UI17: { screenId: 'UI17', intent: '사용자 범위와 권한·직무 분리', links: [
    { path: '/admin/users', label: 'Users & Roles' },
    { path: '/admin/permissions', label: 'Permissions Matrix' },
  ] },
  UI18: { screenId: 'UI18', intent: '외부 시스템 연계 계약', links: [
    { path: '/integration/connectors', label: 'Connector Hub' },
    { path: '/metamodel', label: 'Metamodel Viewer' },
  ] },
  UI19: { screenId: 'UI19', intent: 'Feature 제안과 중복 검사', links: [
    { path: '/cr-wizard', label: 'CR Wizard' },
    { path: '/change/cr', label: 'CR List' },
  ] },
  UI20: { screenId: 'UI20', intent: 'SW ID와 버전 관리', links: [
    { path: '/master/artifacts', label: 'Artifact Catalog' },
  ] },
  UI21: { screenId: 'UI21', intent: 'UPG와 UPG VC 구성', links: [
    { path: '/master/artifacts', label: 'Artifact Catalog' },
    { path: '/master/control-points', label: 'Control Point Catalog' },
  ] },
  UI22: { screenId: 'UI22', intent: 'SW Structure 정의', links: [
    { path: '/master/artifacts', label: 'Artifact Catalog' },
    { path: '/metamodel', label: 'Metamodel Viewer' },
  ] },
  UI23: { screenId: 'UI23', intent: 'SW EO 변경관리', links: [
    { path: '/change/cr', label: 'CR List' },
    { path: '/change/changeset', label: 'ChangeSet' },
  ] },
  UI24: { screenId: 'UI24', intent: '제품사양과 HW Variant', links: [
    { path: '/variants/FEAT-BDC-001', label: 'Variant Matrix' },
    { path: '/master/control-points', label: 'Control Point Catalog' },
  ] },
  UI25: { screenId: 'UI25', intent: '협의와 개발 이관', links: [
    { path: '/decisions/center', label: 'Decision Center' },
    { path: '/decisions/report', label: 'DecisionReport' },
  ] },
  UI26: { screenId: 'UI26', intent: '연계 작업과 재처리', links: [
    { path: '/integration/sync', label: 'Sync Logs' },
    { path: '/integration/connectors', label: 'Connector Hub' },
  ] },
  UI27: { screenId: 'UI27', intent: '운영 인계와 조치', links: [
    { path: '/ops/FEAT-BDC-001', label: 'Ops · Kill Switch' },
    { path: '/ops/policy', label: 'Policy Lifecycle' },
  ] },
  UI28: { screenId: 'UI28', intent: '변경요청과 Revision 비교', links: [
    { path: '/change/changeset', label: 'ChangeSet' },
    { path: '/change/timeline', label: 'Version Timeline' },
    { path: '/change/baseline', label: 'Baseline Diff' },
  ] },
  UI29: { screenId: 'UI29', intent: '운영 기준과 지표', links: [
    { path: '/insights/reports', label: 'Reports' },
    { path: '/ops/telemetry', label: 'Telemetry Explorer' },
  ] },
  UI30: { screenId: 'UI30', intent: '요구사항과 설계 추적', links: [
    { path: '/spec/changelog', label: '기준 개정 이력' },
    { path: '/metamodel', label: 'Metamodel Viewer' },
  ] },
};

export function implementedLinks(screenId: string): ScreenLink {
  return SCREEN_LINKS[screenId] || { screenId, intent: '', links: [] };
}

function segmentMatch(linkSeg: string, pathSeg: string): boolean {
  return linkSeg.startsWith(':') || linkSeg.toLowerCase() === pathSeg.toLowerCase();
}

/**
 * 현재 경로가 어떤 기준 화면의 구현 대응인지 역으로 찾는다(가장 긴 일치 우선).
 * 예: /twin/vehicle/VIN-DEMO-017 → UI12
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
