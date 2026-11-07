// 42 컴포넌트 manifest(+ D07-01 SW 개발비 산정, 2026-11-04 사용자 결정) — 하네스(conformance)의 단일 기준.
// 출처: Feature_Platform_42컴포넌트_PoC_워크플로우_아키텍처반영_v0.50.pptx (Module View, shape 266~307)
// status가 'implemented'인 항목은 module·endpoints·screens·tests가 모두 실재해야 한다(tools/conformance.ts).
import { ROUTES } from './routes';
export type DomainId = 'D01' | 'D02' | 'D03' | 'D04' | 'D05' | 'D06' | 'D07';
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
  // PPT v0.50 42개 밖 — 구매본부 SW 개발비 산정(docs/20-architecture/20-94)
  D07: { ko: '07. 구매·원가 도메인', plane: 'Business Plane' },
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
  ['D01-07', '실험·효과 검증 관리', 'B', 'domains/d01-policy/experiment', ['IF-15'], []],
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
  ['D04-03', '운영 데이터 수집', 'A', 'domains/d04-ops/telemetry-ingest', ['IF-06', 'IF-11', 'IF-15'], [4, 5, 6]],
  ['D04-04', '이벤트 이력 추적', 'A', 'domains/d04-ops/event-history', ['IF-11'], [4, 5, 6]],
  ['D04-05', '장애·VOC 이력 연계', 'C', 'domains/d04-ops/incident-voc', [], []],
  ['D04-06', '품질 피드백 반영', 'A', 'domains/d04-ops/quality-feedback', [], [6]],
  // 05. 시스템 연계·확장 (7)
  ['D05-01', 'API Gateway', 'C', 'domains/d05-ext/api-gateway', ['IF-01', 'IF-02', 'IF-03', 'IF-08', 'IF-09', 'IF-10', 'IF-13', 'IF-14', 'IF-15'], []],
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
  ['D06-12', '이상 징후 대응', 'B', 'domains/d06-qsec/anomaly-response', ['IF-15'], [4]],
  ['D07-01', 'SW 개발비 산정', 'A', 'domains/d07-cost/estimation', [], []],
];

/**
 * 구현이 끝난 컴포넌트 — 화면(routes.tsx 경로)과 테스트 파일을 적는다. endpoints는 ROUTES에서 자동으로 모인다.
 * conformance가 모듈 디렉터리·테스트 파일·화면 라우트 실재를, backend/test/conformance.spec.ts가 등록·응답을 검사한다.
 */
const BE_D01 = ['backend/test/d01/registry.spec.ts', 'backend/test/d01/topology-catalog.spec.ts', 'backend/test/d01/homologation-queue.spec.ts'];
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
// Data Lake 연계·Closed loop(80-70, TL-*) — 규칙·모의 Lake·화면·시나리오
const LAKE_TESTS = ['contracts/src/rules/lake.test.ts', 'backend/test/d04/lake-loop.spec.ts', 'frontend/src/__tests__/lakeLoop.test.tsx', 'e2e/tests/lake-loop.spec.ts'];
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
const FE_OPSADMIN = 'frontend/src/__tests__/screensOpsAdmin.test.tsx';
/** Feature DB(30-95) — D01-01 확장: 기준 행 목록·상세·변경 요청, 등록 때 대표 연결 */
const REFDB_SCREENS = ['/master/feature-db', '/master/feature-db/:refId', '/master/feature-db/changes', '/master/feature-db/changes/:id'];
const REFDB_TESTS = [
  'backend/test/d01/refdb-search-projection.spec.ts',
  ...['change', 'export', 'governance', 'harness', 'read', 'registration', 'release', 'seed'].map((x) => `backend/test/d01/refdb-${x}.spec.ts`),
  ...['domain-alias', 'explore', 'quality', 'registration-criteria', 'size', 'status-policy'].map((x) => `contracts/src/rules/refdb/${x}.test.ts`),
  'backend/test/kernel/refdb-ready.spec.ts', // 준비 점검 checks.refdb
  'backend/test/d05/epic-ref-ids.spec.ts', // JIRA Epic의 Feature DB ID
  'contracts/src/rules/access-refdb.test.ts',
  'contracts/src/schemas/refdb.test.ts',
  'frontend/src/__tests__/screensRefdb.test.tsx', 'frontend/src/__tests__/refExplorer.test.ts',
  'frontend/src/__tests__/screensPropose.test.tsx',
  'e2e/tests/refdb.spec.ts',
  'backend/test/d01/refdb-ops.spec.ts',
  'contracts/src/rules/refdb/internal-glossary.test.ts',
];
const VALIDATOR: Impl = { screens: ['/policies/:id', '/validations'], tests: [BE_POL, 'contracts/src/flags/evaluate.test.ts', FE_POL, E2E_POL], via: ['validatePolicy'] };
/** via — 자기 API 없이 다른 컴포넌트의 라우트 안에서 호출되는 컴포넌트(예: 병렬 검증기)가 그 라우트 이름을 적는다 */
type Impl = Pick<ComponentEntry, 'screens' | 'tests'> & { via?: string[] };
/** ISO/IEC 26580 정합(docs/20-architecture/20-60) — 등록 자동 채움·카탈로그·bill-of-features·구성기·공유 자산 */
const PLE_TESTS = ['contracts/src/rules/ple/autofill.test.ts', 'contracts/src/rules/ple/bill-of-features.test.ts', 'backend/test/d01/ple-26580.spec.ts', 'frontend/src/__tests__/screensPle.test.tsx', 'e2e/tests/ple-26580.spec.ts'];
const IMPLEMENTED: Record<string, Impl> = {
  'D01-01': { screens: ['/features', '/features/:id/:ver', '/master/define', '/baselines', '/change/cr', '/master/taxonomy', '/flag-retirements', '/flag-code/lifecycle', ...REFDB_SCREENS, '/features/catalogue'], tests: [...BE_D01, FE_V2, E2E_GOV, BE_MASTER, FE_MASTER, 'backend/test/d01/release-signoff.spec.ts', 'frontend/src/__tests__/screensReleaseSignoff.test.tsx', 'frontend/src/__tests__/flagCode.test.tsx', ...REFDB_TESTS, ...PLE_TESTS, 'backend/test/ads/p5-lifecycle.spec.ts', 'contracts/src/rules/lifecycle-isolation.test.ts'] },
  'D01-02': { screens: ['/features/:id/:ver', '/features/shared-assets', '/analysis/impact', '/precheck', '/master/upg', '/master/artifacts', '/master/structure', '/master/control-points', '/trace/design', '/change/eo', '/trace/coverage'], tests: [...BE_D01, 'contracts/src/rules/topology.test.ts', 'contracts/src/rules/precheck.test.ts', FE_V2, E2E_GOV, BE_MASTER, FE_MASTER, FE_OPSADMIN, 'backend/test/d01/analysis-evidence.spec.ts', 'contracts/src/rules/gate-evidence.test.ts', 'contracts/src/rules/gate-evidence-projection.test.ts', 'frontend/src/__tests__/screensAnalysisGates.test.tsx', 'e2e/tests/persona-safety.spec.ts', 'frontend/src/__tests__/topologyLayout.test.ts', 'frontend/src/__tests__/topologyMotion.test.tsx', 'e2e/tests/topology.spec.ts', 'backend/test/d01/trace-links.spec.ts', 'contracts/src/rules/relation-types.test.ts', 'contracts/src/rules/trace-link.test.ts', 'frontend/src/__tests__/traceLinks.test.tsx', 'e2e/tests/trace-links.spec.ts'] },
  'D01-03': { screens: ['/products', '/products/new', '/products/:id/:ver', '/products/bill-of-features', '/products/configurator'], tests: ['backend/test/d01/topology-catalog.spec.ts', 'contracts/src/rules/catalog.test.ts', E2E_GOV, ...PLE_TESTS] },
  'D01-10': { screens: ['/audit'], tests: ['backend/test/kernel/kernel.spec.ts', 'backend/test/d01/audit-export.spec.ts', 'frontend/src/__tests__/workProduct.test.tsx', 'frontend/src/__tests__/requirementGaps.test.tsx', E2E_GOV] },
  'D04-04': { screens: ['/events', '/notifications/rules'], tests: ['backend/test/kernel/kernel.spec.ts', 'backend/test/d04/notify-recipients.spec.ts', 'frontend/src/__tests__/workProduct.test.tsx', 'frontend/src/__tests__/requirementGaps.test.tsx', E2E_GOV] },
  'D01-04': { screens: ['/activation/decide'], tests: [BE_POL, ...CT_FLAG, FE_POL, E2E_POL] },
  'D01-05': { screens: ['/entitlements'], tests: [BE_POL, BE_TRIAL, CT_TRIAL, 'contracts/src/flags/evaluate.test.ts', FE_TRIAL, E2E_TRIAL] },
  // 기간형 체험권 → 구매 전환·체험 전환 분석 (2026-10-13)
  'D05-04': { screens: ['/entitlements', '/integration/connectors'], tests: [BE_TRIAL, FE_TRIAL, E2E_TRIAL, 'backend/test/ads/state.spec.ts', 'backend/test/d05/settlement.spec.ts', 'contracts/src/rules/settlement.test.ts', 'frontend/src/__tests__/extGateway.test.tsx', 'e2e/tests/ext-gateway.spec.ts'] },
  'D05-06': { screens: ['/biz/trials'], tests: [BE_TRIAL, CT_TRIAL, FE_TRIAL, E2E_TRIAL] },
  // P10 — 실험·효과·장애·VOC·데이터 동기화·Legacy·현장 지원·Legacy-SDV (IF-01·02·03·08·11·12 모의 어댑터)
  'D01-07': { screens: ['/experiments'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10] },
  'D04-05': { screens: ['/ops/incidents', '/ops/incident-reports', '/ops/incident-reports/:id'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10, 'backend/test/ads/evidence.spec.ts', 'contracts/src/rules/ads-evidence.test.ts', 'frontend/src/__tests__/screensAdsEvidence.test.tsx'] },
  'D05-02': { screens: ['/integration/sync', '/data/workbench', '/baselines/eol'], tests: ['frontend/src/__tests__/workbench.test.tsx', 'e2e/tests/data-workbench.spec.ts', BE_P10, CT_EXT, FE_P10, E2E_P10, 'backend/test/ads/p5-plant-ota.spec.ts', 'contracts/src/rules/eol.test.ts', 'frontend/src/__tests__/screensAdsP5.test.tsx', 'e2e/tests/ads-p5.spec.ts'] },
  'D05-03': { screens: ['/integration/legacy'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10, 'backend/test/d05/legacy-links.spec.ts', 'contracts/src/rules/legacy-link.test.ts', 'frontend/src/__tests__/extGateway.test.tsx', 'e2e/tests/ext-gateway.spec.ts'] },
  'D05-05': { screens: ['/field'], tests: [BE_P10, FE_P10, E2E_P10] },
  'D05-07': { screens: ['/integration/legacy'], tests: [BE_P10, CT_EXT, FE_P10, E2E_P10, 'backend/test/d05/legacy-links.spec.ts', 'contracts/src/rules/legacy-link.test.ts', 'frontend/src/__tests__/extGateway.test.tsx', 'e2e/tests/ext-gateway.spec.ts'] },
  'D01-06': { screens: ['/policies', '/policies/new', '/policies/:id'], tests: [BE_POL, 'backend/test/d01/unleash.spec.ts', 'backend/test/d01/unleash-vehicle.spec.ts', 'backend/test/d01/unleash-auto-sync.spec.ts', 'backend/live-tests/unleash-vehicle-live.spec.ts', 'contracts/src/rules/unleash-snapshot.test.ts', 'contracts/src/rules/unleash.test.ts', 'backend/test/d01/flag-source.spec.ts', 'contracts/src/schemas/flag-source.test.ts', FE_POL, 'frontend/src/__tests__/screensP8b.test.tsx', 'frontend/src/__tests__/featureFlags.test.tsx', E2E_POL, 'e2e/tests/p8b.spec.ts', 'e2e/tests/persona-flags.spec.ts'] },
  'D01-08': { screens: ['/policies/:id'], tests: [BE_POL, ...CT_FLAG, E2E_POL, ...LAKE_TESTS] },
  'D01-09': { screens: ['/activation/decide'], tests: [BE_POL, ...CT_FLAG, FE_POL, E2E_POL] },
  'D05-01': { screens: ['/activation/decide', '/integration/openfeature', '/integration/connectors', '/supplier/portal', '/integration/datalake'], tests: [BE_POL, FE_POL, E2E_POL, BE_VREQ, 'backend/test/d05/openfeature.spec.ts', 'contracts/src/flags/openfeature.test.ts', FE_P10, FE_OPSADMIN, 'backend/test/d05/ext-sync.spec.ts', 'contracts/src/rules/ext-sync.test.ts', 'frontend/src/__tests__/externalDemo.test.tsx', 'e2e/tests/external-windows.spec.ts', ...LAKE_TESTS, 'backend/test/d05/api-gateway.spec.ts', 'contracts/src/rules/api-gateway.test.ts', 'frontend/src/__tests__/extGateway.test.tsx', 'e2e/tests/ext-gateway.spec.ts'] },
  'D06-01': VALIDATOR,
  'D06-02': VALIDATOR,
  'D06-03': { screens: ['/policies/:id', '/validations', '/validations/virtual'], tests: [BE_POL, BE_VV, 'contracts/src/flags/evaluate.test.ts', FE_POL, FE_OPS, E2E_POL, E2E_OPS], via: ['validatePolicy'] },
  'D06-04': VALIDATOR,
  'D06-05': { ...VALIDATOR, screens: [...VALIDATOR.screens, '/analysis/impact'], tests: [...VALIDATOR.tests, 'backend/test/ads/change.spec.ts', 'contracts/src/rules/ads-change.test.ts', 'frontend/src/__tests__/screensAdsChange.test.tsx'] },
  'D06-06': VALIDATOR,
  'D06-07': { ...VALIDATOR, screens: [...VALIDATOR.screens, '/trace/ads', '/verify/safety-case'], tests: [...VALIDATOR.tests, 'backend/test/ads/evidence.spec.ts', 'contracts/src/rules/ads-evidence.test.ts', 'frontend/src/__tests__/screensAdsEvidence.test.tsx'] },
  'D03-01': { ...VALIDATOR, screens: [...VALIDATOR.screens, '/verify/compliance'], tests: [...VALIDATOR.tests, 'backend/test/d03/compliance-rules.spec.ts', 'contracts/src/rules/compliance-rule.test.ts', 'frontend/src/__tests__/complianceRegistry.test.tsx', 'e2e/tests/compliance-rules.spec.ts'] },
  'D03-02': { screens: ['/policies/:id', '/validations', '/verify/exceptions'], tests: [BE_POL, ...CT_FLAG, FE_POL, E2E_POL, 'backend/test/d03/exception-policy.spec.ts', 'contracts/src/rules/exception-policy.test.ts', 'frontend/src/__tests__/exceptions.test.tsx', 'e2e/tests/exceptions.spec.ts'], via: ['validatePolicy', 'decidePolicy'] },
  'D04-02': { screens: ['/policies/:id', '/validations', '/validations/virtual', '/verify/evidence'], tests: [BE_MASTER, FE_MASTER, BE_POL, BE_VV, 'contracts/src/flags/evaluate.test.ts', FE_OPS, E2E_POL], via: ['validatePolicy'] },
  // P8b 운영 되먹임·IAM·Variant
  'D06-12': { screens: ['/ops/anomalies'], tests: ['backend/test/d06/anomaly.spec.ts', 'contracts/src/rules/anomaly.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx', 'e2e/tests/p8b.spec.ts'] },
  'D04-06': { screens: ['/quality/feedback'], tests: ['backend/test/d06/anomaly.spec.ts', 'contracts/src/rules/anomaly.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx', 'e2e/tests/p8b.spec.ts'] },
  'D06-09': { screens: ['/admin/iam'], tests: ['backend/test/d06/iam-variant.spec.ts', 'contracts/src/rules/access-variant.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx'] },
  'D02-01': { screens: ['/variant-conditions', '/master/reference-values', '/config/odd', '/config/compat'], tests: ['backend/test/ads/config.spec.ts', 'backend/test/ads/p5-publish.spec.ts', 'contracts/src/rules/ads-publish.test.ts', 'contracts/src/rules/ads-config.test.ts', 'frontend/src/__tests__/screensAdsConfig.test.tsx', 'backend/test/d06/iam-variant.spec.ts', 'contracts/src/rules/access-variant.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx', 'backend/test/kernel/production-values.spec.ts', 'frontend/src/__tests__/referencePrivacy.test.tsx'] },
  'D02-02': { screens: ['/variant-conditions', '/fleet/vehicles/:vin', '/activation/decide'], tests: ['backend/test/ads/config.spec.ts', 'backend/test/d06/iam-variant.spec.ts', 'contracts/src/rules/access-variant.test.ts', 'frontend/src/__tests__/screensP8b.test.tsx'] },
  // PoC ④⑤⑥ 배포·차단 전달 (P8a)
  'D02-03': { screens: ['/fleet/live', '/fleet/vehicles/:vin', '/fleet/map', '/deployments/:id'], tests: [BE_DLV, 'backend/test/ads/state.spec.ts', 'contracts/src/rules/ads-state.test.ts', 'frontend/src/__tests__/screensAdsState.test.tsx', 'backend/test/d03/gleo.ws.spec.ts', 'contracts/src/gleo.test.ts', FE_OPS, E2E_OPS, BE_VREQ, CT_VREQ, 'backend/test/d02/fleet-map.spec.ts', 'backend/test/kernel/showcase.spec.ts', 'contracts/src/rules/fleet-map.test.ts', 'frontend/src/__tests__/screensFleetMap.test.tsx', 'frontend/src/__tests__/carIcon.test.ts', 'e2e/tests/fleet-map.spec.ts'] },
  'D03-03': { screens: ['/ops/kill'], tests: [BE_DLV, 'backend/test/d03/gleo.ws.spec.ts', FE_OPS, E2E_OPS] },
  'D03-04': { screens: ['/ops/kill', '/ops/rollback', '/policies/:id'], tests: [BE_DLV, 'backend/test/d03/gleo.ws.spec.ts', E2E_OPS, 'backend/test/d03/rollback.spec.ts', 'contracts/src/rules/rollback.test.ts', 'frontend/src/__tests__/screensRollback.test.tsx', 'backend/test/d03/policy-history.spec.ts', 'frontend/src/__tests__/policyHistory.test.tsx', 'e2e/tests/policy-rollback.spec.ts'] },
  'D04-01': { screens: ['/deployments', '/deployments/:id', '/ops/ota-installs', '/deployments/campaigns/:id'], tests: [BE_DLV, 'backend/test/d04/notify-recipients.spec.ts', FE_OPS, E2E_OPS, 'backend/test/ads/p5-plant-ota.spec.ts', 'contracts/src/rules/ota-install.test.ts', 'frontend/src/__tests__/screensAdsP5.test.tsx', 'e2e/tests/ads-p5.spec.ts'] },
  'D04-03': { screens: ['/fleet/live', '/deployments/:id', '/ops/telemetry', '/ops/safety-kpi', '/ops/feature-health', '/ops/feature-health/:findingId', '/ops/collection'], tests: ['backend/test/d04/evaluation-stats.spec.ts', 'frontend/src/__tests__/observabilityData.test.ts', 'frontend/src/__tests__/telemetryIdentity.test.ts', 'frontend/src/__tests__/telemetryObservability.test.tsx', BE_DLV, FE_OPS, E2E_OPS, FE_OPSADMIN, ...LAKE_TESTS] },
  'D06-08': { screens: ['/deployments', '/deployments/:id', '/fleet/live'], tests: [BE_DLV, FE_OPS, E2E_OPS] },
  'D06-10': { screens: ['/deployments', '/admin/security'], tests: [BE_DLV, E2E_OPS, FE_OPSADMIN] },
  // 보고서 v1.1 WP8 — 게시본별 CycloneDX SBOM·서명 전 해시 결합·VEX 판정
  'D06-11': { screens: ['/admin/security'], tests: ['backend/test/d06/sbom.spec.ts', 'contracts/src/rules/sbom.test.ts', FE_OPSADMIN] },
  // 구매본부 SW 개발비 산정(20-94) — 엑셀 v1.3과 1원 일치 엔진, 과제·승인 API, 화면 5탭·계수 표, 엑셀 양식 내보내기
  'D07-01': { screens: ['/procurement/sw-cost', '/procurement/sw-cost/:estId', '/procurement/sw-cost/basis'], tests: ['backend/test/d07/cost.spec.ts', 'backend/test/d07/cost-calibration.spec.ts', 'backend/test/kernel/xlsx-patch.spec.ts', 'contracts/src/rules/cost/engine.golden.test.ts', 'contracts/src/rules/cost/engine.test.ts', 'contracts/src/rules/cost/calibration.test.ts', 'frontend/src/__tests__/screensCost.test.tsx', 'e2e/tests/persona-cost.spec.ts'] },
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
  'IF-01': '요구관리 연계 (ALM · codeBeamer)',
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
  'IF-13': 'CI/CD · 소스 저장소 연계 (GitLab)',
  // 사용자 결정 2026-10-18 — Feature 상태·Flag 변경요청(CR)은 JIRA에서 관리, 양방향 연계
  'IF-14': '작업·변경요청 연계 (JIRA)',
  // 2026-10-18 설계 80-70 — 차량 데이터는 별도 서버 Data Lake가 주인, FF는 집계·신선도·모델 점수를 읽고 라벨을 보낸다(80-75)
  'IF-15': '차량 데이터 Data Lake',
};
