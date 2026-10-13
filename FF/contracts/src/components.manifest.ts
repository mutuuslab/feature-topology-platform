// 42 컴포넌트 manifest — 하네스(conformance)의 단일 기준.
// 출처: Feature_Platform_42컴포넌트_PoC_워크플로우_아키텍처반영_v0.50.pptx (Module View, shape 266~307)
// status가 'implemented'인 항목은 module·endpoints·screens·tests가 모두 실재해야 한다(tools/conformance.ts).
import { ROUTES } from './routes';

export type DomainId = 'D01' | 'D02' | 'D03' | 'D04' | 'D05' | 'D06';
export type Tier = 'A' | 'B' | 'C';
export type ComponentStatus = 'planned' | 'implemented';

export interface ComponentEntry {
  id: string; // D01-01 …
  ko: string; // PPT 표기 그대로
  domain: DomainId;
  /** A: 실제 로직+영속+전체 테스트, B: 규칙+모의 데이터, C: 조회 모델+모의 IF */
  tier: Tier;
  status: ComponentStatus;
  /** 담당 백엔드 모듈 경로 (FF/backend/src 기준) */
  module: string;
  endpoints: string[];
  /** 담당 화면 라우트 (frontend routes.tsx) */
  screens: string[];
  /** 테스트 파일 (FF 기준 상대 경로) */
  tests: string[];
  ifs: string[];
  /** PoC 6단계 중 참여 단계 */
  pocSteps: number[];
}

export const DOMAINS: Record<DomainId, { ko: string; plane: string }> = {
  D01: { ko: '01. Feature 정책 관리 도메인', plane: 'Control Plane' },
  D02: { ko: '02. 차량 런타임 실행 도메인', plane: 'Vehicle Plane' },
  D03: { ko: '03. 안전·검증 도메인', plane: 'Quality Plane' },
  D04: { ko: '04. 배포·운영·데이터 도메인', plane: 'Governance(Monitoring) Plane' },
  D05: { ko: '05. 시스템 연계·확장 도메인', plane: 'Cross-cutting' },
  D06: { ko: '06. 품질·보안·운영 도메인', plane: 'Quality Plane' },
};

type Seed = [id: string, ko: string, tier: Tier, module: string, ifs: string[], pocSteps: number[]];

const SEEDS: Seed[] = [
  // 01. Feature 정책 관리 (10)
  ['D01-01', 'Feature Registry', 'A', 'domains/d01-policy/registry', ['IF-01'], [1]],
  ['D01-02', 'Feature Topology', 'A', 'domains/d01-policy/topology', ['IF-02', 'IF-12'], [1, 6]],
  ['D01-03', 'Feature Catalog', 'A', 'domains/d01-policy/catalog', [], [1]],
  ['D01-04', '적용 대상 선정 규칙', 'A', 'domains/d01-policy/targeting', [], [3]],
  ['D01-05', '사용 권한 관리', 'A', 'domains/d01-policy/entitlement', [], [3, 5]],
  ['D01-06', '정책 저장·버전 관리', 'A', 'domains/d01-policy/policy-store', ['IF-04'], [2, 3]],
  ['D01-07', '실험·효과 검증 관리', 'B', 'domains/d01-policy/experiment', [], []],
  ['D01-08', '단계적 기능 배포', 'B', 'domains/d01-policy/staged-rollout', [], []],
  ['D01-09', '정책 기반 활성화 제어', 'A', 'domains/d01-policy/activation', ['IF-10'], [3, 4]],
  ['D01-10', '감사 이력 관리', 'A', 'domains/d01-policy/audit-history', ['IF-03'], [1, 2, 4, 6]],
  // 02. 차량 런타임 실행 (3)
  ['D02-01', 'Variant 조건 관리', 'A', 'domains/d02-runtime/variant-conditions', ['IF-02'], [3]],
  ['D02-02', '기능 지원 조건 관리', 'B', 'domains/d02-runtime/support-conditions', [], [5]],
  ['D02-03', '차량 런타임 실행 모듈', 'A', 'domains/d02-runtime/vehicle-runtime', ['IF-07', 'IF-10'], [4, 5, 6]],
  // 03. 안전·검증 (4)
  ['D03-01', '컴플라이언스 룰 체커', 'B', 'domains/d03-safety/compliance-checker', [], [2]],
  ['D03-02', '배포 안전성 검증', 'A', 'domains/d03-safety/deploy-safety', [], [2]],
  ['D03-03', '긴급 기능 차단', 'A', 'domains/d03-safety/kill-switch', ['IF-05', 'IF-07'], [6]],
  ['D03-04', '이전 상태 복구', 'A', 'domains/d03-safety/restore', ['IF-05'], []],
  // 04. 배포·운영·데이터 (6)
  ['D04-01', '배포 파이프라인 연계', 'A', 'domains/d04-ops/pipeline-link', ['IF-05', 'IF-13'], [4, 6]],
  ['D04-02', '품질 기준 검증', 'B', 'domains/d04-ops/quality-gate', ['IF-09'], [2]],
  ['D04-03', '운영 데이터 수집', 'A', 'domains/d04-ops/telemetry-ingest', ['IF-06', 'IF-11'], [4, 5, 6]],
  ['D04-04', '이벤트 이력 추적', 'A', 'domains/d04-ops/event-history', ['IF-11'], [4, 5, 6]],
  ['D04-05', '장애·VOC 이력 연계', 'C', 'domains/d04-ops/incident-voc', [], []],
  ['D04-06', '품질 피드백 반영', 'A', 'domains/d04-ops/quality-feedback', [], [6]],
  // 05. 시스템 연계·확장 (7)
  ['D05-01', 'API Gateway', 'C', 'domains/d05-ext/api-gateway', ['IF-01', 'IF-02', 'IF-03', 'IF-08', 'IF-09', 'IF-10'], []],
  ['D05-02', '데이터 동기화', 'C', 'domains/d05-ext/data-sync', ['IF-02', 'IF-03', 'IF-12'], []],
  ['D05-03', 'Legacy 시스템 연계', 'C', 'domains/d05-ext/legacy', ['IF-12'], []],
  ['D05-04', '과금 시스템 연계', 'C', 'domains/d05-ext/billing', [], []],
  ['D05-05', '현장 지원 포털', 'C', 'domains/d05-ext/field-portal', [], []],
  ['D05-06', '사업 지표 모니터링', 'C', 'domains/d05-ext/biz-metrics', [], []],
  ['D05-07', 'Legacy-SDV Interface', 'C', 'domains/d05-ext/legacy-sdv', [], []],
  // 06. 품질·보안·운영 (12)
  ['D06-01', '정책 검증', 'A', 'domains/d06-qsec/policy-validation', [], [2]],
  ['D06-02', '시스템 연동 검증', 'B', 'domains/d06-qsec/integration-validation', [], [2]],
  ['D06-03', '차량 시나리오 검증', 'B', 'domains/d06-qsec/scenario-validation', [], [2]],
  ['D06-04', '검증 이력 관리', 'A', 'domains/d06-qsec/validation-history', ['IF-09'], [2]],
  ['D06-05', '변경 영향 검증', 'A', 'domains/d06-qsec/change-impact-validation', [], [2]],
  ['D06-06', '안전 동작 검증', 'B', 'domains/d06-qsec/safe-behavior-validation', [], [2]],
  ['D06-07', '안전 요구사항 추적', 'B', 'domains/d06-qsec/safety-req-trace', [], [2]],
  ['D06-08', '보안 배포 관리', 'A', 'domains/d06-qsec/secure-deploy', [], [4, 6]],
  ['D06-09', '플랫폼 인증·권한 관리(IAM)', 'A', 'domains/d06-qsec/iam', [], [6]],
  ['D06-10', '인증서·키 관리(PKI/KMS)', 'A', 'domains/d06-qsec/pki-kms', [], [4, 6]],
  ['D06-11', '보안 취약점 모니터링', 'C', 'domains/d06-qsec/vuln-monitor', [], []],
  ['D06-12', '이상 징후 대응', 'B', 'domains/d06-qsec/anomaly-response', [], [4]],
];

/**
 * 구현이 끝난 컴포넌트 — 화면(routes.tsx 경로)과 테스트 파일을 적는다. endpoints는 ROUTES에서 자동으로 모인다.
 * conformance가 모듈 디렉터리·테스트 파일·화면 라우트 실재를, backend/test/conformance.spec.ts가 등록·응답을 검사한다.
 */
const BE_D01 = ['backend/test/d01/registry.spec.ts', 'backend/test/d01/topology-catalog.spec.ts'];
const FE_V2 = 'frontend/src/__tests__/screensV2.test.tsx';
const E2E_GOV = 'e2e/tests/governance.spec.ts';
const BE_POL = 'backend/test/d01/policy.spec.ts';
const FE_POL = 'frontend/src/__tests__/screensPolicy.test.tsx';
const E2E_POL = 'e2e/tests/policy.spec.ts';
const CT_FLAG = ['contracts/src/flags/evaluate.test.ts', 'contracts/src/flags/p0.test.ts'];
/** PoC ② 분야별 검증기 — 병렬 실행되어 정책 상세·검증 이력에서 결과를 본다 */
const BE_DLV = 'backend/test/d03/delivery.spec.ts';
const BE_VV = 'backend/test/d06/virtual.spec.ts';
const FE_OPS = 'frontend/src/__tests__/screensOps.test.tsx';
const E2E_OPS = 'e2e/tests/ops.spec.ts';
const BE_VREQ = 'backend/test/d02/vehicle-requests.spec.ts';
const CT_VREQ = 'contracts/src/rules/vehicle-requests.test.ts';
const BE_TRIAL = 'backend/test/d05/trials.spec.ts';
const CT_TRIAL = 'contracts/src/rules/trial.test.ts';
const FE_TRIAL = 'frontend/src/__tests__/screensTrials.test.tsx';
const E2E_TRIAL = 'e2e/tests/trials.spec.ts';
const BE_P10 = 'backend/test/ext/p10.spec.ts';
const CT_EXT = 'contracts/src/rules/ext.test.ts';
const FE_P10 = 'frontend/src/__tests__/screensP10.test.tsx';
const E2E_P10 = 'e2e/tests/p10.spec.ts';
const BE_MASTER = 'backend/test/d01/master.spec.ts';
const FE_MASTER = 'frontend/src/__tests__/screensMaster.test.tsx';
const VALIDATOR: Impl = { screens: ['/policies/:id', '/validations'], tests: [BE_POL, 'contracts/src/flags/evaluate.test.ts', FE_POL, E2E_POL], via: ['validatePolicy'] };
/** via — 자기 API 없이 다른 컴포넌트의 라우트 안에서 호출되는 컴포넌트(예: 병렬 검증기)가 그 라우트 이름을 적는다 */
type Impl = Pick<ComponentEntry, 'screens' | 'tests'> & { via?: string[] };
const IMPLEMENTED: Record<string, Impl> = {
  'D01-01': { screens: ['/features', '/features/:id/:ver', '/baselines', '/change/cr', '/master/taxonomy'], tests: [...BE_D01, FE_V2, E2E_GOV, BE_MASTER, FE_MASTER] },
  'D01-02': { screens: ['/features/:id/:ver', '/analysis/impact', '/precheck', '/master/upg', '/master/artifacts', '/master/structure', '/master/control-points', '/trace/design'], tests: [...BE_D01, 'contracts/src/rules/topology.test.ts', 'contracts/src/rules/precheck.test.ts', FE_V2, E2E_GOV, BE_MASTER, FE_MASTER] },
  'D01-03': { screens: ['/products', '/products/new', '/products/:id/:ver'], tests: ['backend/test/d01/topology-catalog.spec.ts', 'contracts/src/rules/catalog.test.ts', E2E_GOV] },
  'D01-10': { screens: ['/audit'], tests: ['backend/test/kernel/kernel.spec.ts', E2E_GOV] },
  'D04-04': { screens: ['/events'], tests: ['backend/test/kernel/kernel.spec.ts', E2E_GOV] },
  'D01-04': { screens: ['/activation/decide'], tests: [BE_POL, ...CT_FLAG, FE_POL, E2E_POL] },
  'D01-05': { screens: ['/entitlements'], tests: [BE_POL, BE_TRIAL, CT_TRIAL, 'contracts/src/flags/evaluate.test.ts', FE_TRIAL, E2E_TRIAL] },
  // 기간형 체험권 → 구매 전환·체험 전환 분석 (2026-10-13)
  'D05-04': { screens: ['/entitlements'], tests: [BE_TRIAL, FE_TRIAL, E2E_TRIAL] },
  'D05-06': { screens: ['/biz/trials'], tests: [BE_TRIAL, CT_TRIAL, FE_TRIAL, E2E_TRIAL] },
  // P10 — 실험·효과·장애·VOC·데이터 동기화·Legacy·현장 지원·Legacy-SDV (IF-01·02·03·08·11·12 모의 어댑터)
  'D01-07': { screens: ['/experiments'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10] },
  'D04-05': { screens: ['/ops/incidents'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10] },
  'D05-02': { screens: ['/integration/sync'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10] },
  'D05-03': { screens: ['/integration/legacy'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10] },
  'D05-05': { screens: ['/field'], tests: [BE_P10, FE_P10, E2E_P10] },
  'D05-07': { screens: ['/integration/legacy'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10] },
  'D01-06': { screens: ['/policies', '/policies/new', '/policies/:id'], tests: [BE_POL, 'backend/test/d01/unleash.spec.ts', 'contracts/src/rules/unleash.test.ts', FE_POL, 'frontend/src/__tests__/screensP8b.test.tsx', E2E_POL, 'e2e/tests/p8b.spec.ts'] },
  'D01-08': { screens: ['/policies/:id'], tests: [BE_POL, ...CT_FLAG, E2E_POL] },
  'D01-09': { screens: ['/activation/decide'], tests: [BE_POL, ...CT_FLAG, FE_POL, E2E_POL] },
  'D05-01': { screens: ['/activation/decide', '/integration/openfeature', '/integration/connectors'], tests: [BE_POL, FE_POL, E2E_POL, BE_VREQ, 'backend/test/d05/openfeature.spec.ts', 'contracts/src/flags/openfeature.test.ts', FE_P10] },
  'D06-01': VALIDATOR,
  'D06-02': VALIDATOR,
  'D06-03': { screens: ['/policies/:id', '/validations', '/validations/virtual'], tests: [BE_POL, BE_VV, 'contracts/src/flags/evaluate.test.ts', FE_POL, FE_OPS, E2E_POL, E2E_OPS], via: ['validatePolicy'] },
  'D06-04': VALIDATOR,
  'D06-05': VALIDATOR,
  'D06-06': VALIDATOR,
  'D06-07': VALIDATOR,
  'D03-01': VALIDATOR,
  'D03-02': { screens: ['/policies/:id', '/validations'], tests: [BE_POL, ...CT_FLAG, FE_POL, E2E_POL], via: ['validatePolicy', 'decidePolicy'] },
  'D04-02': { screens: ['/policies/:id', '/validations', '/validations/virtual', '/verify/evidence'], tests: [BE_MASTER, FE_MASTER, BE_POL, BE_VV, 'contracts/src/flags/evaluate.test.ts', FE_OPS, E2E_POL], via: ['validatePolicy'] },
  // P8b 운영 되먹임·IAM·Variant
  'D06-12': { screens: ['/ops/anomalies'], tests: ['backend/test/d06/anomaly.spec.ts', 'contracts/src/rules/anomaly.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx', 'e2e/tests/p8b.spec.ts'] },
  'D04-06': { screens: ['/quality/feedback'], tests: ['backend/test/d06/anomaly.spec.ts', 'contracts/src/rules/anomaly.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx', 'e2e/tests/p8b.spec.ts'] },
  'D06-09': { screens: ['/admin/iam'], tests: ['backend/test/d06/iam-variant.spec.ts', 'contracts/src/rules/access-variant.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx'] },
  'D02-01': { screens: ['/variant-conditions'], tests: ['backend/test/d06/iam-variant.spec.ts', 'contracts/src/rules/access-variant.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx'] },
  'D02-02': { screens: ['/variant-conditions', '/fleet/vehicles/:vin'], tests: ['backend/test/d06/iam-variant.spec.ts', 'contracts/src/rules/access-variant.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx'] },
  // PoC ④⑤⑥ 배포·차단 전달 (P8a)
  'D02-03': { screens: ['/fleet/live', '/fleet/vehicles/:vin'], tests: [BE_DLV, 'backend/test/d03/gleo.ws.spec.ts', 'contracts/src/gleo.test.ts', FE_OPS, E2E_OPS, BE_VREQ, CT_VREQ] },
  'D03-03': { screens: ['/ops/kill'], tests: [BE_DLV, 'backend/test/d03/gleo.ws.spec.ts', FE_OPS, E2E_OPS] },
  'D03-04': { screens: ['/ops/kill'], tests: [BE_DLV, 'backend/test/d03/gleo.ws.spec.ts', E2E_OPS] },
  'D04-01': { screens: ['/deployments', '/deployments/:id'], tests: [BE_DLV, FE_OPS, E2E_OPS] },
  'D04-03': { screens: ['/fleet/live', '/deployments/:id'], tests: [BE_DLV, FE_OPS, E2E_OPS] },
  'D06-08': { screens: ['/deployments', '/deployments/:id', '/fleet/live'], tests: [BE_DLV, FE_OPS, E2E_OPS] },
  'D06-10': { screens: ['/deployments'], tests: [BE_DLV, E2E_OPS] },
};

export const COMPONENTS: ComponentEntry[] = SEEDS.map(([id, ko, tier, module, ifs, pocSteps]) => {
  const impl = IMPLEMENTED[id];
  return {
    id,
    ko,
    domain: id.slice(0, 3) as DomainId,
    tier,
    status: impl ? 'implemented' : 'planned',
    module,
    endpoints: impl ? ROUTES.filter((r) => r.component === id || impl.via?.includes(r.name)).map((r) => `${r.method} ${r.path}`) : [],
    screens: impl?.screens ?? [],
    tests: impl?.tests ?? [],
    ifs,
    pocSteps,
  };
});

/** PoC 6단계 (PPT 슬라이드 3~8) */
export const POC_STEPS = [
  { no: 1, ko: 'Feature 등록·상품 구성' },
  { no: 2, ko: '정책 준비·검증·승인' },
  { no: 3, ko: '사용 권한·서버 활성화 판단' },
  { no: 4, ko: '정책 배포·차량 수신' },
  { no: 5, ko: '차량 평가·체험 제안·기능 적용' },
  { no: 6, ko: '이상 확인·긴급 차단·차단 적용' },
] as const;

/** 외부 연계 인터페이스 (PPT 카드 라벨) */
export const INTERFACES: Record<string, string> = {
  'IF-01': '요구관리 연계 (ALM)',
  'IF-02': '차량·SW·HW 기준정보 연계',
  'IF-03': 'MDM · DW/DM',
  'IF-04': 'Policy Tool',
  'IF-05': '배포 캠페인 요청 (CCS / OTA)',
  'IF-06': '차량 런타임 수집 (Fleet)',
  'IF-07': '차량 전개·평가 제공 (Fleet)',
  'IF-08': 'Supplier Portal',
  'IF-09': '검증 게이트 연계 (TMS)',
  'IF-10': 'OpenFeature SDK',
  'IF-11': 'OpenTelemetry Collector',
  'IF-12': 'Overseas Plant',
  'IF-13': 'CI/CD 파이프라인 연계',
};
