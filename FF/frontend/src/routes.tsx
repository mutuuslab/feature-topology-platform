// MENU 2.0 — 업무 기준 8그룹. 라우트·메뉴·breadcrumb·⌘K·IA 하네스가 모두 이 배열 하나를 읽는다.
// 규칙(__tests__/ia.test.ts가 강제): 모든 라우트는 메뉴 항목이거나 부모(parent)를 가진다 · 경로 중복 없음 ·
// 메뉴 링크는 실제 라우트로 열린다 · 그룹은 8개. UI01~UI30(MENU 1.3) 코드는 추적 메타로 자동 연결된다.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { legacyTo } from './screens/legacyRedirect';
import { SPEC_MENU_ITEM } from './data/specMenu';
import { screenOfRoute } from './data/uiLinks';
import type { IconName } from './design';

export type GroupKey = 'home' | 'feature' | 'config' | 'master' | 'verify' | 'release' | 'ops' | 'admin';

export interface MenuGroup {
  key: GroupKey;
  ko: string;
  en: string;
  icon: IconName;
  /** 레일용 짧은 라벨 */
  short: string;
  /** 어두운 관제실 톤 영역 */
  zone?: 'ops';
}

export const GROUPS: MenuGroup[] = [
  { key: 'home', ko: '홈', short: '홈', en: 'Home', icon: 'home' },
  { key: 'feature', ko: 'Feature 정의', short: '정의', en: 'Feature Definition', icon: 'feature' },
  { key: 'config', ko: '구성·Topology', short: '구성', en: 'Configuration & Topology', icon: 'topology' },
  { key: 'master', ko: '기준정보', short: '기준', en: 'Master Data', icon: 'master' },
  { key: 'verify', ko: '검증·Gate', short: '검증', en: 'Verification & Gates', icon: 'gate' },
  { key: 'release', ko: '상품·출시', short: '출시', en: 'Products & Release', icon: 'release' },
  { key: 'ops', ko: '차량 운영·안전', short: '운영', en: 'Vehicle Ops & Safety', icon: 'ops', zone: 'ops' },
  { key: 'admin', ko: '연계·감사·관리', short: '연계', en: 'Integration, Audit & Admin', icon: 'link' },
];

type Page = LazyExoticComponent<ComponentType<any>> | ComponentType<any>;

export interface AppRoute {
  path: string;
  element: Page;
  /** 화면 이름 = 메뉴 라벨 = breadcrumb 마지막 칸 */
  title: string;
  group: GroupKey;
  /** 메뉴에 올릴 때의 링크 (동적 경로는 대표 대상) — 없으면 메뉴에 없다 */
  menu?: string;
  /** 메뉴 밖 화면의 부모 메뉴 경로 (드릴다운) */
  parent?: string;
  /** 담당 42 컴포넌트 (contracts manifest ID) */
  components?: string[];
  /** v0.81 재디자인 화면 여부 — 라벨=h1 등 엄격 규칙 대상 */
  v2?: boolean;
}

const named = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));

// 페이지 모듈 — 모두 지연 로딩(초기 번들은 셸과 디자인 키트만)
const homeScreens = () => import('./screens/home/Inbox');
const twin = () => import('./pages/twin');
const twinOps = () => import('./pages/twinOps');

const def = (m: () => Promise<{ default: ComponentType<any> }>) => lazy(m);

// v2 화면 (screens/)
const products = () => import('./screens/products/Products');
const auditEvents = () => import('./screens/governance/AuditEvents');
const policyScreens = () => import('./screens/policy/Policies');
const runtimeScreens = () => import('./screens/policy/Runtime');
const entitlementScreens = () => import('./screens/policy/Entitlements');
const bizScreens = () => import('./screens/biz/TrialAnalytics');
const extScreens = () => import('./screens/ext/Integrations');
const masterScreens = () => import('./screens/master/MasterData');
const traceScreens = () => import('./screens/master/Trace');
const opsScreens = () => import('./screens/master/Ops');
const topologyScreens = () => import('./screens/master/Topology');
const experimentScreens = () => import('./screens/ext/Experiments');
const incidentScreens = () => import('./screens/ext/Incidents');
const virtualScreens = () => import('./screens/policy/Virtual');
const fleetScreens = () => import('./screens/ops/FleetLive');
const killScreens = () => import('./screens/ops/KillConsole');
const deployScreens = () => import('./screens/ops/Deployments');
const anomalyScreens = () => import('./screens/ops/Anomalies');
const accessScreens = () => import('./screens/admin/Access');
const learnScreens = () => import('./screens/learn/Learn');

export const ROUTES: AppRoute[] = [
  // 1 홈
  { path: '/', element: named(homeScreens, 'HomeScreen'), title: '내 대시보드', group: 'home', menu: '/', v2: true },
  { path: '/admin/approval', element: named(homeScreens, 'ApprovalInboxScreen'), title: '검토함', group: 'home', menu: '/admin/approval', v2: true },
  { path: '/learn', element: named(learnScreens, 'LearnHub'), title: '표준 따라하기', group: 'home', menu: '/learn', v2: true },
  { path: '/learn/:id', element: named(learnScreens, 'LearnRun'), title: '따라하기 시나리오', group: 'home', parent: '/learn', v2: true },
  { path: '/poc', element: named(() => import('./screens/home/Poc'), 'PocScreen'), title: 'PoC 6단계 진행', group: 'home', menu: '/poc', v2: true },
  { path: '/arch/components', element: named(() => import('./screens/home/Architecture'), 'ArchitectureScreen'), title: '42 컴포넌트 아키텍처', group: 'home', menu: '/arch/components', v2: true },
  { path: '/admin/notifications', element: legacyTo('/'), title: '알림 (이전 주소)', group: 'home', parent: '/' },
  { path: '/login', element: legacyTo('/'), title: '로그인 (이전 주소)', group: 'home', parent: '/' },
  { path: '/onboarding', element: legacyTo('/'), title: '시작하기 (이전 주소)', group: 'home', parent: '/' },
  { path: '/home/customize', element: legacyTo('/'), title: '홈 꾸미기 (이전 주소)', group: 'home', parent: '/' },

  // 2 Feature 정의
  { path: '/feature/propose', element: named(homeScreens, 'ProposeScreen'), title: 'Feature 제안', group: 'feature', menu: '/feature/propose', v2: true },
  { path: '/features', element: def(() => import('./screens/features/FeatureList')), title: 'Feature Registry', group: 'feature', menu: '/features', components: ['D01-01'], v2: true },
  { path: '/features/:id/:ver', element: def(() => import('./screens/features/FeatureDetail')), title: 'Feature Version 상세', group: 'feature', parent: '/features', components: ['D01-01', 'D01-02'], v2: true },
  { path: '/catalog', element: legacyTo('/features'), title: 'Feature 카탈로그 (이전 주소)', group: 'feature', parent: '/features' },
  { path: '/feature/:id', element: legacyTo('/features'), title: 'Feature 상세 (이전 주소)', group: 'feature', parent: '/features' },
  { path: '/lifecycle', element: legacyTo('/features'), title: 'Lifecycle 보드 (이전 주소)', group: 'feature', parent: '/features' },
  { path: '/master/define', element: named(homeScreens, 'DefineScreen'), title: 'Feature 등록', group: 'feature', menu: '/master/define', components: ['D01-01'], v2: true },
  { path: '/change/cr', element: named(traceScreens, 'ChangesScreen'), title: '변경요청', group: 'feature', menu: '/change/cr', components: ['D01-01'], v2: true },
  { path: '/change/cr/:id', element: legacyTo('/change/cr'), title: '변경요청 상세 (이전 주소)', group: 'feature', parent: '/change/cr' },
  { path: '/change/baseline', element: legacyTo('/change/cr'), title: 'Baseline 비교 (이전 주소)', group: 'feature', parent: '/change/cr' },
  { path: '/change/timeline', element: legacyTo('/change/cr'), title: 'Version 이력 (이전 주소)', group: 'feature', parent: '/change/cr' },
  { path: '/master/taxonomy', element: named(masterScreens, 'TaxonomyScreen'), title: 'Taxonomy', group: 'feature', menu: '/master/taxonomy', components: ['D01-01'], v2: true },
  { path: '/master/taxonomy/edit', element: legacyTo('/master/taxonomy'), title: 'Taxonomy 편집 (이전 주소)', group: 'feature', parent: '/master/taxonomy' },

  // 3 구성·Topology
  { path: '/baselines', element: def(() => import('./screens/bom/BaselineQueue')), title: 'BOM 기준선·확정 승인', group: 'config', menu: '/baselines', components: ['D01-01'], v2: true },
  { path: '/master/bom', element: legacyTo('/baselines'), title: 'BOM 11영역 편집 (이전 주소)', group: 'config', parent: '/baselines' },
  { path: '/master/bom/items', element: legacyTo('/baselines'), title: 'BOM 항목 편집 (이전 주소)', group: 'config', parent: '/baselines' },
  { path: '/arch/topology', element: named(topologyScreens, 'TopologyScreen'), title: 'Topology·의존관계 검증', group: 'config', menu: '/arch/topology', components: ['D01-02'], v2: true },
  { path: '/topology/:id', element: legacyTo('/arch/topology?feature=:id'), title: '관계 그래프 (이전 주소)', group: 'config', parent: '/arch/topology' },
  { path: '/topology/edge', element: legacyTo('/arch/topology'), title: '관계 편집 (이전 주소)', group: 'config', parent: '/arch/topology' },
  { path: '/consistency', element: legacyTo('/precheck'), title: '정합성 규칙 (이전 주소)', group: 'config', parent: '/arch/topology' },
  { path: '/consistency/violation', element: legacyTo('/precheck'), title: '위반 상세 (이전 주소)', group: 'config', parent: '/arch/topology' },
  { path: '/analysis/impact', element: def(() => import('./screens/governance/Impact')), title: '변경 영향 분석', group: 'config', menu: '/analysis/impact', components: ['D01-02', 'D06-05'], v2: true },
  { path: '/impact', element: legacyTo('/analysis/impact'), title: '영향 센터 (이전 주소)', group: 'config', parent: '/analysis/impact' },
  { path: '/decisions/report', element: legacyTo('/analysis/impact'), title: '결정 보고서 (이전 주소)', group: 'config', parent: '/analysis/impact' },
  { path: '/decisions/center', element: legacyTo('/analysis/impact'), title: '결정 센터 (이전 주소)', group: 'config', parent: '/analysis/impact' },
  { path: '/decisions/deploy', element: legacyTo('/analysis/impact'), title: '배포 결정 (이전 주소)', group: 'config', parent: '/analysis/impact' },
  { path: '/twin/impact', element: named(twin, 'TwinImpact'), title: '변경 영향 시뮬레이션 (BDC 데모)', group: 'config', parent: '/analysis/impact' },
  { path: '/variant-conditions', element: named(accessScreens, 'VariantScreen'), title: 'Variant·지원 조건', group: 'config', menu: '/variant-conditions', components: ['D02-01', 'D02-02'], v2: true },
  { path: '/master/product-spec', element: legacyTo('/variant-conditions'), title: 'Variant·적용 조건 (이전 주소)', group: 'config', parent: '/variant-conditions' },
  { path: '/variants/:id', element: legacyTo('/variant-conditions'), title: 'Variant 매트릭스 (이전 주소)', group: 'config', parent: '/variant-conditions' },

  // 4 기준정보
  { path: '/master/upg', element: named(masterScreens, 'UpgScreen'), title: 'UPG·UPG-VC', group: 'master', menu: '/master/upg', components: ['D01-02'], v2: true },
  { path: '/master/artifacts', element: named(masterScreens, 'SwScreen'), title: 'SW·Artifact', group: 'master', menu: '/master/artifacts', components: ['D01-02'], v2: true },
  { path: '/master/structure', element: named(masterScreens, 'StructureScreen'), title: 'SW 구조', group: 'master', menu: '/master/structure', components: ['D01-02'], v2: true },
  { path: '/change/eo', element: named(opsScreens, 'EoScreen'), title: 'SW EO', group: 'master', menu: '/change/eo', v2: true },
  { path: '/master/control-points', element: named(masterScreens, 'ControlPointsScreen'), title: '제어점', group: 'master', menu: '/master/control-points', components: ['D01-02'], v2: true },

  { path: '/precheck', element: def(() => import('./screens/governance/Precheck')), title: '데이터 사전점검', group: 'master', menu: '/precheck', components: ['D01-02'], v2: true },

  // 5 검증·Gate
  { path: '/verify/evidence', element: named(traceScreens, 'EvidenceScreen'), title: '품질 기준·Evidence', group: 'verify', menu: '/verify/evidence', components: ['D04-02', 'D06-04'], v2: true },
  { path: '/verify/evidence/:id', element: legacyTo('/verify/evidence'), title: '증적 상세 (이전 주소)', group: 'verify', parent: '/verify/evidence' },
  { path: '/decisions/verification', element: legacyTo('/verify/evidence'), title: '검증 범위 (이전 주소)', group: 'verify', parent: '/verify/evidence' },
  { path: '/readiness/:id', element: legacyTo('/features'), title: 'Gate·출시 준비 (이전 주소)', group: 'verify', parent: '/verify/evidence' },
  { path: '/validations', element: named(policyScreens, 'ValidationHistory'), title: '분야별 검증 이력', group: 'verify', menu: '/validations', components: ['D06-04', 'D03-02'], v2: true },
  { path: '/policy/conflict', element: legacyTo('/validations'), title: '정책 충돌 검토 (이전 주소)', group: 'verify', parent: '/validations' },
  { path: '/policy/exception', element: legacyTo('/validations'), title: '정책 예외 (이전 주소)', group: 'verify', parent: '/validations' },
  { path: '/verify/compliance', element: named(opsScreens, 'ComplianceScreen'), title: '컴플라이언스', group: 'verify', menu: '/verify/compliance', components: ['D03-01'], v2: true },
  { path: '/quality/feedback', element: named(anomalyScreens, 'FeedbackScreen'), title: '품질 피드백', group: 'verify', menu: '/quality/feedback', components: ['D04-06'], v2: true },
  { path: '/validations/virtual', element: named(virtualScreens, 'VirtualValidationScreen'), title: 'vECU 가상검증', group: 'verify', menu: '/validations/virtual', components: ['D06-03', 'D04-02'], v2: true },
  { path: '/verify/scenario', element: legacyTo('/validations/virtual'), title: '차량 시나리오 (이전 주소)', group: 'verify', parent: '/validations/virtual' },
  { path: '/twin/simulation', element: named(twin, 'TwinSimulation'), title: 'What-if 시뮬레이션 (BDC 데모)', group: 'verify', parent: '/validations/virtual' },
  { path: '/experiments', element: named(experimentScreens, 'ExperimentsScreen'), title: '실험·효과', group: 'verify', menu: '/experiments', components: ['D01-07'], v2: true },
  { path: '/verify/experiment', element: legacyTo('/experiments'), title: '실험·효과 (이전 주소)', group: 'verify', parent: '/experiments' },
  { path: '/trace/design', element: named(traceScreens, 'DesignTraceScreen'), title: '요구·안전 추적', group: 'verify', menu: '/trace/design', components: ['D06-07', 'D01-02'], v2: true },

  // 6 상품·출시
  { path: '/products', element: named(products, 'ProductList'), title: 'Feature Catalog 상품', group: 'release', menu: '/products', components: ['D01-03'], v2: true },
  { path: '/products/new', element: named(products, 'ProductCompose'), title: '새 상품 구성', group: 'release', parent: '/products', components: ['D01-03'], v2: true },
  { path: '/products/:id/:ver', element: named(products, 'ProductDetail'), title: '상품 Version 상세', group: 'release', parent: '/products', components: ['D01-03'], v2: true },
  { path: '/commerce/offer', element: legacyTo('/products/new'), title: '상품 구성 (이전 주소)', group: 'release', parent: '/products' },
  { path: '/entitlements', element: named(entitlementScreens, 'EntitlementsScreen'), title: '사용 권한·체험권', group: 'release', menu: '/entitlements', components: ['D01-05', 'D05-04'], v2: true },
  { path: '/commerce/billing', element: legacyTo('/entitlements'), title: '과금 연계 (이전 주소)', group: 'release', parent: '/entitlements' },
  { path: '/activation/decide', element: named(runtimeScreens, 'ActivationScreen'), title: '활성화 판단', group: 'release', menu: '/activation/decide', components: ['D01-04', 'D01-09', 'D05-01'], v2: true },
  { path: '/activation', element: legacyTo('/activation/decide'), title: '차종별 활성화 (이전 주소)', group: 'release', parent: '/activation/decide' },
  { path: '/policies', element: named(policyScreens, 'PolicyList'), title: '정책·검증·승인', group: 'release', menu: '/policies', components: ['D01-06', 'D01-08'], v2: true },
  { path: '/policies/new', element: named(policyScreens, 'PolicyCreate'), title: '새 정책', group: 'release', parent: '/policies', components: ['D01-06'], v2: true },
  { path: '/policies/:id', element: named(policyScreens, 'PolicyDetail'), title: '정책 상세', group: 'release', parent: '/policies', components: ['D01-06', 'D06-04', 'D03-02', 'D01-08'], v2: true },
  { path: '/ops/policy', element: legacyTo('/policies'), title: '정책 단계 보드 (이전 주소)', group: 'release', parent: '/policies' },
  { path: '/ops/runtime', element: legacyTo('/policies'), title: '정책 평가 시뮬레이터 (이전 주소)', group: 'release', parent: '/policies' },
  { path: '/deployments', element: named(deployScreens, 'DeploymentList'), title: '서명 배포·차량 회신', group: 'release', menu: '/deployments', components: ['D06-08', 'D06-10', 'D04-01', 'D04-03'], v2: true },
  { path: '/deployments/:id', element: named(deployScreens, 'DeploymentDetail'), title: '게시본 상세', group: 'release', parent: '/deployments', components: ['D06-08', 'D04-03'], v2: true },
  { path: '/ops/campaign', element: legacyTo('/deployments'), title: '출시 캠페인 (이전 주소)', group: 'release', parent: '/deployments' },
  { path: '/ops/campaign/:id', element: legacyTo('/deployments'), title: '캠페인 상세 (이전 주소)', group: 'release', parent: '/deployments' },
  { path: '/release/cicd', element: legacyTo('/deployments'), title: 'CI/CD 연계 (이전 주소)', group: 'release', parent: '/deployments' },

  // 7 차량 운영·안전 (관제실 톤)
  { path: '/fleet/live', element: named(fleetScreens, 'FleetLive'), title: 'Fleet 실시간 적용 현황', group: 'ops', menu: '/fleet/live', components: ['D02-03', 'D04-03', 'D06-08'], v2: true },
  { path: '/twin/live', element: named(fleetScreens, 'LegacyLiveRedirect'), title: 'Fleet 실시간 적용 현황 (이전 주소)', group: 'ops', parent: '/fleet/live' },
  { path: '/fleet', element: legacyTo('/fleet/live'), title: '차량 운영 현황 (이전 주소)', group: 'ops', parent: '/fleet/live' },
  { path: '/twin/fleet', element: named(twin, 'TwinFleet'), title: '3D Fleet (BDC 데모)', group: 'ops', parent: '/fleet/live' },
  { path: '/fleet/vehicles/:vin', element: named(fleetScreens, 'VehicleRuntimeScreen'), title: '차량별 적용 상태', group: 'ops', menu: '/fleet/vehicles/ego-01', components: ['D02-03'], v2: true },
  { path: '/twin/applied/:vin', element: legacyTo('/fleet/vehicles/:vin'), title: '차량 적용 상태 (이전 주소)', group: 'ops', parent: '/fleet/vehicles/:vin' },
  { path: '/twin/vehicle/:vin', element: named(twinOps, 'TwinVehicle'), title: '차량 상세 (BDC 데모)', group: 'ops', parent: '/fleet/vehicles/:vin' },
  { path: '/ops/kill', element: named(killScreens, 'KillConsole'), title: '긴급 차단·복구', group: 'ops', menu: '/ops/kill', components: ['D03-03', 'D03-04'], v2: true },
  { path: '/twin/incident', element: named(twinOps, 'TwinIncident'), title: '긴급 차단 시나리오 (BDC 데모)', group: 'ops', parent: '/ops/kill' },
  { path: '/ops/:id', element: legacyTo('/fleet/live'), title: 'Feature 운영 대시보드 (이전 주소)', group: 'ops', parent: '/fleet/live' },
  { path: '/ops/anomalies', element: named(anomalyScreens, 'AnomalyScreen'), title: '이상 징후 대응', group: 'ops', menu: '/ops/anomalies', components: ['D06-12'], v2: true },
  { path: '/ops/incidents', element: named(incidentScreens, 'IncidentsScreen'), title: '장애·VOC', group: 'ops', menu: '/ops/incidents', components: ['D04-05'], v2: true },
  { path: '/ops/incident', element: legacyTo('/ops/incidents'), title: '장애·VOC (이전 주소)', group: 'ops', parent: '/ops/incidents' },
  { path: '/ops/incident/:id', element: legacyTo('/ops/incidents'), title: '장애 상세 (이전 주소)', group: 'ops', parent: '/ops/incidents' },
  { path: '/ops/telemetry', element: named(opsScreens, 'TelemetryScreen'), title: '운영 데이터·이벤트', group: 'ops', menu: '/ops/telemetry', components: ['D04-03', 'D04-04', 'D04-06'], v2: true },

  { path: '/events', element: named(auditEvents, 'EventsScreen'), title: 'Platform 이벤트', group: 'ops', menu: '/events', components: ['D04-04'], v2: true },

  // 8 연계·감사·관리
  { path: '/integration/connectors', element: named(extScreens, 'IntegrationsScreen'), title: '외부 연계 현황', group: 'admin', menu: '/integration/connectors', components: ['D05-01'], v2: true },
  { path: '/integration/connector/:id', element: legacyTo('/integration/connectors'), title: '연계 상세 (이전 주소)', group: 'admin', parent: '/integration/connectors' },
  { path: '/integration/openfeature', element: named(() => import('./screens/ext/OpenFeatureScope'), 'OpenFeatureScopeScreen'), title: 'OpenFeature 범위', group: 'admin', menu: '/integration/openfeature', components: ['D05-01', 'D02-03'], v2: true },
  { path: '/integration/sync', element: named(extScreens, 'DataSyncScreen'), title: '데이터 동기화', group: 'admin', menu: '/integration/sync', components: ['D05-02'], v2: true },
  { path: '/integration/legacy', element: named(extScreens, 'LegacyScreen'), title: 'Legacy 연계', group: 'admin', menu: '/integration/legacy', components: ['D05-03', 'D05-07'], v2: true },
  { path: '/field', element: named(incidentScreens, 'FieldPortalScreen'), title: '현장 지원 포털', group: 'admin', menu: '/field', components: ['D05-05'], v2: true },
  { path: '/integration/jobs', element: legacyTo('/integration/sync'), title: '연계 작업 (이전 주소)', group: 'admin', parent: '/integration/sync' },
  { path: '/supplier/portal', element: named(opsScreens, 'SupplierScreen'), title: '협력사 이관', group: 'admin', menu: '/supplier/portal', v2: true },
  { path: '/supplier/package', element: legacyTo('/supplier/portal'), title: 'API 릴리스 패키지 (이전 주소)', group: 'admin', parent: '/supplier/portal' },
  { path: '/supplier/package/:id', element: legacyTo('/supplier/portal'), title: '패키지 상세 (이전 주소)', group: 'admin', parent: '/supplier/portal' },
  { path: '/decisions/supplier', element: legacyTo('/supplier/portal'), title: '협력사 범위 (이전 주소)', group: 'admin', parent: '/supplier/portal' },
  { path: '/audit', element: named(auditEvents, 'AuditScreen'), title: '감사 이력', group: 'admin', menu: '/audit', components: ['D01-10'], v2: true },
  { path: '/insights/audit', element: legacyTo('/audit'), title: '감사 로그 (이전 주소)', group: 'admin', parent: '/audit' },
  { path: '/admin/iam', element: named(accessScreens, 'IamScreen'), title: '플랫폼 인증·권한', group: 'admin', menu: '/admin/iam', components: ['D06-09'], v2: true },
  { path: '/admin/users', element: legacyTo('/admin/iam'), title: '사용자·권한 (이전 주소)', group: 'admin', parent: '/admin/iam' },
  { path: '/admin/permissions', element: legacyTo('/admin/iam'), title: '권한 매트릭스 (이전 주소)', group: 'admin', parent: '/admin/iam' },
  { path: '/admin/org', element: legacyTo('/admin/iam'), title: '조직·도메인 (이전 주소)', group: 'admin', parent: '/admin/iam' },
  { path: '/admin/security', element: named(opsScreens, 'SecurityScreen'), title: '보안·인증서', group: 'admin', menu: '/admin/security', components: ['D06-10', 'D06-11'], v2: true },
  { path: '/biz/trials', element: named(bizScreens, 'TrialAnalyticsScreen'), title: '체험 전환 분석', group: 'admin', menu: '/biz/trials', components: ['D05-06'], v2: true },
  { path: '/insights/business', element: legacyTo('/biz/trials'), title: '사업 지표 (이전 주소)', group: 'admin', parent: '/biz/trials' },
  { path: '/insights/reports', element: legacyTo('/biz/trials'), title: '보고서 (이전 주소)', group: 'admin', parent: '/biz/trials' },
  { path: '/cost', element: legacyTo('/biz/trials'), title: '비용 (이전 주소)', group: 'admin', parent: '/biz/trials' },
  { path: '/admin/settings', element: named(opsScreens, 'SettingsScreen'), title: '설정', group: 'admin', menu: '/admin/settings', v2: true },
  { path: '/_design', element: def(() => import('./screens/design-gallery')), title: '디자인 시스템', group: 'admin', menu: '/_design', v2: true },
];

// ── 파생 정보 ─────────────────────────────────────────────────────────

/** 라우트 경로 → 정본 화면(UI01~UI30) — MENU 1.3 추적 메타 */
export function uiCodeOf(r: Pick<AppRoute, 'path' | 'menu'>): string | undefined {
  return screenOfRoute(r.menu ?? r.path.replace(/:\w+/g, 'X'));
}

/** 이 메뉴를 담당하는 역할(레거시 역할 키) — 정본 화면 담당자. '전체'는 모든 역할. */
export function rolesOf(r: AppRoute): string[] | 'all' {
  const ui = uiCodeOf(r);
  const owner = ui ? SPEC_MENU_ITEM[ui]?.owner : undefined;
  if (!owner || owner === '전체') return 'all';
  return [owner];
}

export const MENU = GROUPS.map((g) => ({ ...g, items: ROUTES.filter((r) => r.group === g.key && r.menu) }));

const pattern = (p: string) => new RegExp('^' + p.replace(/:\w+/g, '[^/]+') + '$');
const STATIC_FIRST = [...ROUTES].sort((a, b) => Number(a.path.includes(':')) - Number(b.path.includes(':')));

/** 현재 경로의 라우트 (정적 경로 우선 — '/ops/incident'가 '/ops/:id'에 먹히지 않게) */
export function routeOf(pathname: string): AppRoute | undefined {
  return STATIC_FIRST.find((r) => pattern(r.path).test(pathname));
}

/** breadcrumb — 그룹 › 부모들 › 현재 */
export function trailOf(pathname: string): { title: string; to?: string }[] {
  const cur = routeOf(pathname);
  if (!cur) return [];
  const chain: AppRoute[] = [];
  let p: AppRoute | undefined = cur;
  for (let i = 0; p && i < 6; i++) {
    chain.unshift(p);
    p = p.parent ? ROUTES.find((r) => r.path === p!.parent) : undefined;
  }
  const g = GROUPS.find((x) => x.key === cur.group)!;
  return [{ title: g.ko }, ...chain.map((r, i) => ({ title: r.title, to: i < chain.length - 1 ? (r.menu ?? (r.path.includes(':') ? undefined : r.path)) : undefined }))];
}
