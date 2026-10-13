// API 경로 목록 — 단일 기준. 백엔드 실제 라우트와 다르면 테스트가 실패하고(backend/test/routes.spec.ts),
// OpenAPI(docs/80-integration/openapi.json)와 프론트 API 클라이언트가 이것에서 만들어진다.
import type { ZodTypeAny } from 'zod';
import type { Role } from './enums';
import {
  BaselineDecisionBody,
  BaselineRequestBody,
  CreateDependencyBody,
  CreateFeatureBody,
  CreateProductBody,
  CreateProductVersionBody,
  CreateVersionBody,
  JudgeGateBody,
  ProductTransitionBody,
  TransitionBody,
  UpdateDraftBody,
  UpdateProductDraftBody,
  ValidateCompositionBody,
} from './schemas/api';
import { CreatePolicyBody, DeclineTrialBody, OfferTrialsBody, OfrepBody, PolicyDecisionBody, PurchaseTrialBody, RolloutStageBody, UpdatePolicyBody } from './schemas/policy';
import { EpochBumpBody, KeyRotateBody, KillCreateBody, ReadbackBody } from './schemas/ops';
import { RunVirtualBody } from './rules/virtual';
import { SafetyConfirmBody, SafetyProfilePatch } from './schemas/safety-profile';
import { AnomalyActionBody, FeedbackAcceptBody } from './rules/anomaly';
import { VehicleReportBody } from './rules/vehicle-requests';
import { z } from 'zod';

const EmptyBody = z.object({}).strict();
const ReasonBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteDef {
  /** 프론트 API 클라이언트 함수 이름 */
  name: string;
  method: HttpMethod;
  /** Express 형식 (:param) */
  path: string;
  summary: string;
  /** 담당 컴포넌트 (manifest ID) — 커널 공통은 'KERNEL' */
  component: string;
  roles?: Role[];
  body?: ZodTypeAny;
  query?: string[];
  /** 필수 질의가 있는 GET — 준수 검사가 호출할 예시 값 */
  sample?: Record<string, string>;
  /** 끝나지 않는 스트림(SSE) — 준수 검사는 상태·Content-Type만 본다 */
  stream?: boolean;
  /** 상태를 바꾸지 않는 공개 POST(OFREP 평가) — 역할 없음 */
  public?: boolean;
}

export const ROUTES: RouteDef[] = [
  // 커널
  { name: 'health', method: 'GET', path: '/api/health', summary: '상태 점검', component: 'KERNEL' },
  { name: 'components', method: 'GET', path: '/api/components', summary: '42 컴포넌트 현황', component: 'KERNEL' },
  { name: 'events', method: 'GET', path: '/api/events', summary: '이벤트 이력', component: 'D04-04', query: ['after', 'type', 'aggregate', 'limit'] },
  { name: 'eventStream', method: 'GET', path: '/api/events/stream', summary: '이벤트 실시간 스트림 (SSE)', component: 'D04-04', query: ['types'], stream: true },
  { name: 'safetyProfiles', method: 'GET', path: '/api/safety-profiles', summary: '안전 분류 목록 (보고서 5.7)', component: 'D01-01', query: ['featureId'] },
  { name: 'safetyProfile', method: 'GET', path: '/api/features/:id/versions/:ver/safety', summary: '안전 분류 + 조합 검사 (FFG-CLS-009)', component: 'D01-01' },
  { name: 'updateSafetyProfile', method: 'PUT', path: '/api/features/:id/versions/:ver/safety', summary: '안전 분류 초안 수정 (확정 후 불가, FFG-CLS-004)', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'SAFETY_OFFICER'], body: SafetyProfilePatch },
  { name: 'confirmSafetyProfile', method: 'POST', path: '/api/features/:id/versions/:ver/safety/confirm', summary: '안전 분류 확정 — Safety Manager 개인 서명', component: 'D01-01', roles: ['SAFETY_OFFICER'], body: SafetyConfirmBody },
  { name: 'audit', method: 'GET', path: '/api/audit', summary: '감사 이력', component: 'D01-10', query: ['target', 'actorId', 'result', 'limit'] },
  { name: 'auditChain', method: 'GET', path: '/api/audit/chain', summary: '감사 해시 체인 무결성 (FFG-PLT-015)', component: 'D01-10' },

  // Feature Registry (D01-01)
  { name: 'listFeatures', method: 'GET', path: '/api/features', summary: 'Feature 버전 목록', component: 'D01-01', query: ['q', 'lifecycle', 'country', 'vehicleModel', 'latestOnly'] },
  { name: 'createFeature', method: 'POST', path: '/api/features', summary: 'Feature 등록 (PROPOSED 0.1.0)', component: 'D01-01', roles: ['FEATURE_AUTHOR'], body: CreateFeatureBody },
  { name: 'featureVersions', method: 'GET', path: '/api/features/:id', summary: 'Feature의 버전들', component: 'D01-01' },
  { name: 'createVersion', method: 'POST', path: '/api/features/:id/versions', summary: '새 Version 생성', component: 'D01-01', roles: ['FEATURE_AUTHOR'], body: CreateVersionBody },
  { name: 'featureDetail', method: 'GET', path: '/api/features/:id/versions/:ver', summary: 'Feature 버전 상세', component: 'D01-01' },
  { name: 'updateDraft', method: 'PATCH', path: '/api/features/:id/versions/:ver', summary: 'PROPOSED 초안 수정', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'SAFETY_OFFICER', 'VARIANT_OWNER', 'IMPLEMENTER'], body: UpdateDraftBody },
  { name: 'transition', method: 'POST', path: '/api/features/:id/versions/:ver/transitions', summary: 'Lifecycle 전이', component: 'D01-01', roles: ['FEATURE_APPROVER', 'RELEASE_MANAGER', 'GATE_JUDGE'], body: TransitionBody },
  { name: 'baselineChecklist', method: 'GET', path: '/api/features/:id/versions/:ver/baseline-checklist', summary: 'BOM 확정 체크리스트', component: 'D01-01' },

  // Gate Record (Topology 소유, D01-02)
  { name: 'gates', method: 'GET', path: '/api/features/:id/versions/:ver/gates', summary: 'Gate G1~G9 판정·이력', component: 'D01-02' },
  { name: 'judgeGate', method: 'POST', path: '/api/features/:id/versions/:ver/gates', summary: 'Gate 판정 등록', component: 'D01-02', roles: ['GATE_JUDGE', 'SAFETY_OFFICER'], body: JudgeGateBody },

  // Feature BOM Baseline (D01-01 소관)
  { name: 'baselineRequests', method: 'GET', path: '/api/baselines/requests', summary: 'Baseline 확정 요청 목록', component: 'D01-01', query: ['status'] },
  { name: 'requestBaseline', method: 'POST', path: '/api/baselines/requests', summary: 'Baseline 확정 요청', component: 'D01-01', roles: ['FEATURE_AUTHOR'], body: BaselineRequestBody },
  { name: 'baselineRequest', method: 'GET', path: '/api/baselines/requests/:rid', summary: '확정 요청 상세 + 체크리스트', component: 'D01-01' },
  { name: 'decideBaseline', method: 'POST', path: '/api/baselines/requests/:rid/decision', summary: 'Baseline 확정 승인·반려', component: 'D01-01', roles: ['BOM_APPROVER'], body: BaselineDecisionBody },
  { name: 'baselines', method: 'GET', path: '/api/baselines', summary: 'Baseline 목록', component: 'D01-01' },
  { name: 'baseline', method: 'GET', path: '/api/baselines/:id', summary: 'Baseline 상세 (해시 검증·diff)', component: 'D01-01' },

  // Feature Topology (D01-02) — 의존관계·그래프·사전점검·영향
  { name: 'dependencies', method: 'GET', path: '/api/dependencies', summary: '의존관계 검증 이력', component: 'D01-02', query: ['featureId', 'type', 'verdict'] },
  { name: 'createDependency', method: 'POST', path: '/api/dependencies', summary: '의존관계 등록·판정', component: 'D01-02', roles: ['FEATURE_AUTHOR', 'VARIANT_OWNER'], body: CreateDependencyBody },
  { name: 'topologyGraph', method: 'GET', path: '/api/topology/graph', summary: '관계 그래프', component: 'D01-02', query: ['featureId', 'depth'] },
  { name: 'precheck', method: 'GET', path: '/api/precheck', summary: 'DATA-PRECHECK 16 규칙 + 데이터 품질', component: 'D01-02' },
  { name: 'impact', method: 'GET', path: '/api/impact/:id/:ver', summary: '변경 영향 (Feature→Baseline→Catalog)', component: 'D01-02', query: ['changed'] },

  // Feature Catalog (D01-03)
  { name: 'listProducts', method: 'GET', path: '/api/products', summary: '상품 목록', component: 'D01-03', query: ['q', 'lifecycle', 'saleType', 'country'] },
  { name: 'createProduct', method: 'POST', path: '/api/products', summary: '상품 등록 (PROPOSED 1.0.0)', component: 'D01-03', roles: ['PRODUCT_AUTHOR'], body: CreateProductBody },
  { name: 'productCandidates', method: 'GET', path: '/api/products/candidates', summary: 'BOM 후보 (확정 Baseline·범위 일치)', component: 'D01-03', query: ['country', 'vehicleModel', 'trim', 'q'], sample: { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' } },
  { name: 'validateComposition', method: 'POST', path: '/api/products/validate', summary: '구성 검증 (저장 없음)', component: 'D01-03', roles: ['PRODUCT_AUTHOR', 'PRODUCT_APPROVER'], body: ValidateCompositionBody },
  { name: 'productDetail', method: 'GET', path: '/api/products/:id/versions/:ver', summary: '상품 Version 상세·구성 검증·출시 적격성', component: 'D01-03' },
  { name: 'updateProductDraft', method: 'PATCH', path: '/api/products/:id/versions/:ver', summary: 'PROPOSED 상품 수정', component: 'D01-03', roles: ['PRODUCT_AUTHOR'], body: UpdateProductDraftBody },
  { name: 'createProductVersion', method: 'POST', path: '/api/products/:id/versions', summary: '새 Catalog Version (구성·기간 변경)', component: 'D01-03', roles: ['PRODUCT_AUTHOR'], body: CreateProductVersionBody },
  { name: 'productTransition', method: 'POST', path: '/api/products/:id/versions/:ver/transitions', summary: '상품 Lifecycle 전이 (구성 승인·고객 출시 승인 분리)', component: 'D01-03', roles: ['PRODUCT_APPROVER'], body: ProductTransitionBody },

  // 정책 저장·버전 관리 (D01-06) · 검증 이력 (D06-04) · 단계 배포 (D01-08)
  { name: 'listPolicies', method: 'GET', path: '/api/policies', summary: '정책 목록', component: 'D01-06', query: ['featureId', 'status', 'flagKey'] },
  { name: 'createPolicy', method: 'POST', path: '/api/policies', summary: '정책 작성 (DRAFT)', component: 'D01-06', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER'], body: CreatePolicyBody },
  { name: 'validations', method: 'GET', path: '/api/policies/validations', summary: '검증 이력 (8종 결과·근거)', component: 'D06-04', query: ['policyId'] },
  { name: 'policyDetail', method: 'GET', path: '/api/policies/:id', summary: '정책 상세·마지막 검증·승인 적격성', component: 'D01-06' },
  { name: 'updatePolicy', method: 'PATCH', path: '/api/policies/:id', summary: '정책 수정 (새 개정본·재검증 필요)', component: 'D01-06', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER'], body: UpdatePolicyBody },
  { name: 'validatePolicy', method: 'POST', path: '/api/policies/:id/validate', summary: '분야별 검증 8종 병렬 → 배포 안전성 판정', component: 'D06-04', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE'], body: EmptyBody },
  { name: 'decidePolicy', method: 'POST', path: '/api/policies/:id/decision', summary: '정책 승인·반려 (작성자≠승인자, 해시·GO 확인)', component: 'D01-06', roles: ['FEATURE_APPROVER'], body: PolicyDecisionBody },
  { name: 'deployPolicy', method: 'POST', path: '/api/policies/:id/deploy', summary: '서버 배포 (평가 기준 전환)', component: 'D01-06', roles: ['RELEASE_MANAGER', 'OPERATOR'], body: ReasonBody },
  { name: 'stageRollout', method: 'POST', path: '/api/policies/:id/rollout', summary: '단계적 기능 배포 — 승인 범위 안 코호트 단계', component: 'D01-08', roles: ['RELEASE_MANAGER', 'OPERATOR'], body: RolloutStageBody },

  // 사용 권한 (D01-05) · 적용 대상 (D01-04) · 활성화 제어 (D01-09)
  { name: 'vehicles', method: 'GET', path: '/api/vehicles', summary: '데모 Fleet 차량', component: 'D01-04' },
  { name: 'entitlements', method: 'GET', path: '/api/entitlements', summary: '사용 권한 (체험권·구독·구매)', component: 'D01-05', query: ['vin', 'source'] },
  { name: 'trials', method: 'GET', path: '/api/trials', summary: '체험권 차량 목록 (상태·성향 필터)', component: 'D01-05', query: ['catalogId', 'state', 'source', 'country', 'region', 'vehicleModel', 'trim', 'ageBand', 'drivingStyle', 'adasUsage', 'q', 'page', 'pageSize'] },
  { name: 'offerTrials', method: 'POST', path: '/api/trials/offers', summary: '차량별 체험 제안 (14일 안에 수락)', component: 'D01-05', roles: ['PRODUCT_AUTHOR', 'OPERATOR', 'SYSTEM'], body: OfferTrialsBody },
  { name: 'acceptTrial', method: 'POST', path: '/api/trials/:grantId/accept', summary: '체험 수락 → 30일 기능 ON', component: 'D01-05', roles: ['OPERATOR', 'SYSTEM'], body: EmptyBody },
  { name: 'declineTrial', method: 'POST', path: '/api/trials/:grantId/decline', summary: '체험 거절', component: 'D01-05', roles: ['OPERATOR', 'SYSTEM'], body: DeclineTrialBody },
  { name: 'purchaseTrial', method: 'POST', path: '/api/trials/:grantId/purchase', summary: '체험 → 구독·구매 전환 (과금 연계)', component: 'D05-04', roles: ['OPERATOR', 'SYSTEM'], body: PurchaseTrialBody },
  { name: 'trialAnalytics', method: 'GET', path: '/api/biz/trials', summary: '체험 전환 분석 (수락률·전환율·성향별·주별)', component: 'D05-06', query: ['catalogId', 'groupBy', 'source', 'weeks'] },
  { name: 'cohort', method: 'GET', path: '/api/targeting/cohort', summary: 'FP-COHORT-1 코호트 소속', component: 'D01-04', query: ['flagKey', 'basisPoints'], sample: { flagKey: 'care_00022_param' } },
  { name: 'activationDecide', method: 'GET', path: '/api/activation/decide', summary: '서버 기준 활성화 판단 (평가 근거)', component: 'D01-09', query: ['vin', 'flagKey'], sample: { vin: 'ego-01', flagKey: 'care_00022_param' } },

  // API Gateway (D05-01) — OpenFeature OFREP (IF-10)
  { name: 'ofrepEvaluate', method: 'POST', path: '/ofrep/v1/evaluate/flags/:key', summary: 'OFREP 단일 flag 평가', component: 'D05-01', body: OfrepBody, public: true },
  { name: 'ofrepBulk', method: 'POST', path: '/ofrep/v1/evaluate/flags', summary: 'OFREP 전체 flag 평가 (ETag)', component: 'D05-01', body: OfrepBody, public: true },
  // 배포·차단 전달 (PoC ④⑤⑥) — 서명 게시본 → 파이프라인 → 차량 런타임·GLEO → 회신 집계
  { name: 'pkiKeys', method: 'GET', path: '/api/pki/keys', summary: '서명 키 (공개키·지문·유효기간)', component: 'D06-10' },
  { name: 'rotateKey', method: 'POST', path: '/api/pki/rotate', summary: '서명 키 교체 (이전 키는 검증용으로 유지, 용도별)', component: 'D06-10', roles: ['SAFETY_OFFICER'], body: KeyRotateBody },
  { name: 'hsmStatus', method: 'GET', path: '/api/pki/hsm', summary: '소프트웨어 HSM — 차량 키 epoch·승인자 키 수', component: 'D06-10' },
  { name: 'bumpEpoch', method: 'POST', path: '/api/pki/epoch', summary: '차량 키 epoch 상향 (키 유출 대응, FFG-SEC-002)', component: 'D06-10', roles: ['SECURITY_OFFICER', 'SAFETY_OFFICER'], body: EpochBumpBody },
  { name: 'publications', method: 'GET', path: '/api/publications', summary: '서명 게시본 (정책·차단·복구) 목록', component: 'D06-08', query: ['kind', 'status'] },
  { name: 'publicationDetail', method: 'GET', path: '/api/publications/:id', summary: '게시본 — 서명 검증·차량별 회신·외부 연계 호출', component: 'D06-08' },
  { name: 'integrationCalls', method: 'GET', path: '/api/integrations/calls', summary: '외부 연계 호출 기록 (IF-05·IF-13, 멱등 키)', component: 'D04-01', query: ['ifId', 'key'] },
  { name: 'readbacks', method: 'GET', path: '/api/telemetry/readbacks', summary: '차량 회신 (readback) 기록', component: 'D04-03', query: ['publicationId', 'vin'] },
  { name: 'ingestReadback', method: 'POST', path: '/api/telemetry/readback', summary: 'IF-06 차량 회신 수집', component: 'D04-03', roles: ['SYSTEM'], body: ReadbackBody },
  { name: 'fleetRuntime', method: 'GET', path: '/api/fleet/runtime', summary: 'Fleet 실시간 적용 현황 — 차량별 적용 게시본·상태·서버 판단 비교', component: 'D02-03' },
  { name: 'vehicleRuntime', method: 'GET', path: '/api/vehicles/:vin/runtime', summary: '차량 런타임 — 적용 게시본·차량 측 평가·서버 판단 비교', component: 'D02-03' },
  { name: 'vehicleRequests', method: 'GET', path: '/api/vehicles/:vin/requests', summary: '차량 발신 요청 기록 — 조회·보고·거부 사유, 보고 위치(bootId·sequence)', component: 'D02-03' },
  // 차량 발신 요청 — 사람 역할이 아니라 차량 신원(X-Vehicle-Id, 실제는 mTLS 주체)으로 받는다. 자기 VIN만.
  { name: 'vehicleQueryAll', method: 'POST', path: '/vehicle/v1/:vin/flags', summary: 'IF-10 차량 발신 전체 flag 조회 (OFREP 형식, ETag)', component: 'D05-01', roles: ['VEHICLE'], body: OfrepBody },
  { name: 'vehicleQuery', method: 'POST', path: '/vehicle/v1/:vin/flags/:key', summary: 'IF-10 차량 발신 단일 flag 조회 (OFREP 형식)', component: 'D05-01', roles: ['VEHICLE'], body: OfrepBody },
  { name: 'vehicleReport', method: 'POST', path: '/vehicle/v1/:vin/reports', summary: 'IF-06 차량 보고 — 재연결 대사·관측값·체험 수락·오류·회신 (Flag 직접 변경은 거부), 재평가 결과 응답', component: 'D02-03', roles: ['VEHICLE'], body: VehicleReportBody },
  { name: 'gleoStatus', method: 'GET', path: '/api/gleo/status', summary: 'GLEO Broker 연결·최근 메시지', component: 'D02-03' },
  { name: 'killRequests', method: 'GET', path: '/api/kill-requests', summary: '긴급 차단 요청 목록 (회신 집계 포함)', component: 'D03-03', query: ['status'] },
  { name: 'killPreview', method: 'GET', path: '/api/kill-requests/preview', summary: '차단 영향 범위 미리보기 (의존 Feature·flag·차량)', component: 'D03-03', query: ['featureId', 'featureVersion', 'vins'], sample: { featureId: 'FEAT-00022', featureVersion: '1.0.0' } },
  { name: 'killDetail', method: 'GET', path: '/api/kill-requests/:id', summary: '차단 요청 상세 (차단·복구 회신)', component: 'D03-03' },
  { name: 'issueKill', method: 'POST', path: '/api/kill-requests', summary: '긴급 차단 (type-to-confirm·서명·긴급 채널)', component: 'D03-03', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: KillCreateBody },
  { name: 'releaseKill', method: 'POST', path: '/api/kill-requests/:id/release', summary: '차단 해제·이전 상태 복구', component: 'D03-04', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: z.object({ reason: z.string().trim().min(2).max(500) }).strict() },
  // vECU 가상검증 (IF-09 가상검증 공급자) — 차량 시나리오(D06-03)·안전 동작(D06-06) 근거, G5 증적은 TMS 제출(D04-02)
  { name: 'vecuStatus', method: 'GET', path: '/api/vecu/status', summary: 'vECU 가상검증 실행기 연결 상태', component: 'D06-03' },
  { name: 'virtualScenarios', method: 'GET', path: '/api/virtual-validations/scenarios', summary: 'Feature별 가상검증 시나리오 (판정 기준·연결 검증기)', component: 'D06-03', query: ['featureId'] },
  { name: 'virtualRuns', method: 'GET', path: '/api/virtual-validations', summary: '가상검증 실행 이력', component: 'D06-03', query: ['policyId', 'featureId', 'featureVersion'] },
  { name: 'runVirtual', method: 'POST', path: '/api/virtual-validations', summary: '정책을 vECU 가상 차량에 적용해 시나리오 실행 (판정·증적)', component: 'D06-03', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE'], body: RunVirtualBody },
  { name: 'virtualRunDetail', method: 'GET', path: '/api/virtual-validations/:id', summary: '가상검증 결과 (기준별 판정·증적 해시·TMS)', component: 'D06-03' },
  { name: 'virtualRunFile', method: 'GET', path: '/api/virtual-validations/:id/files/:name', summary: '가상검증 증적 파일 (보고서·텔레메트리)', component: 'D06-03' },
  { name: 'submitTms', method: 'POST', path: '/api/virtual-validations/:id/tms', summary: 'IF-09 TMS 증적 제출 (G5 근거)', component: 'D04-02', roles: ['GATE_JUDGE', 'IMPLEMENTER'], body: EmptyBody },
  // 이상 징후 대응(D06-12) · 품질 피드백 반영(D04-06) — PoC ⑥ 이상 확인 → 차단 → 품질 되먹임
  { name: 'anomalies', method: 'GET', path: '/api/anomalies', summary: '이상 건 (고장·보안·전달) — 심각도·권고', component: 'D06-12', query: ['status', 'kind', 'featureId'] },
  { name: 'anomalyDetail', method: 'GET', path: '/api/anomalies/:id', summary: '이상 건 상세 (신호·근거)', component: 'D06-12' },
  { name: 'acknowledgeAnomaly', method: 'POST', path: '/api/anomalies/:id/acknowledge', summary: '이상 건 확인', component: 'D06-12', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: AnomalyActionBody },
  { name: 'mitigateAnomaly', method: 'POST', path: '/api/anomalies/:id/mitigate', summary: '조치 완료 (차단 외 조치)', component: 'D06-12', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: AnomalyActionBody },
  { name: 'dismissAnomaly', method: 'POST', path: '/api/anomalies/:id/dismiss', summary: '이상 건 기각', component: 'D06-12', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: AnomalyActionBody },
  { name: 'qualityFeedback', method: 'GET', path: '/api/quality-feedback', summary: '품질 피드백 (다음 Version 재검증 요구)', component: 'D04-06', query: ['featureId', 'status'] },
  { name: 'qualityFeedbackDetail', method: 'GET', path: '/api/quality-feedback/:id', summary: '품질 피드백 상세', component: 'D04-06' },
  { name: 'acceptFeedback', method: 'POST', path: '/api/quality-feedback/:id/accept', summary: '품질 피드백 수용', component: 'D04-06', roles: ['FEATURE_AUTHOR', 'GATE_JUDGE', 'SAFETY_OFFICER'], body: FeedbackAcceptBody },
  // IF-04 Policy Tool (Unleash OSS 8.2.0) — 배포 정책을 Unleash 정의로, 차량별 판단 대조, 서버 변경(drift) 탐지 (D01-06)
  { name: 'unleashStatus', method: 'GET', path: '/api/unleash/status', summary: 'Unleash 연결 상태 (mock·live·off)', component: 'D01-06' },
  { name: 'policyUnleash', method: 'GET', path: '/api/policies/:id/unleash', summary: 'Unleash 계획·서버 정의·drift', component: 'D01-06' },
  { name: 'syncUnleash', method: 'POST', path: '/api/policies/:id/unleash/sync', summary: 'Unleash 동기화 (flag·태그·의존·전략·환경)', component: 'D01-06', roles: ['RELEASE_MANAGER', 'OPERATOR'], body: EmptyBody },
  { name: 'unleashEvaluation', method: 'GET', path: '/api/policies/:id/unleash/evaluation', summary: '차량별 Unleash 판단 vs 플랫폼 판단', component: 'D01-06' },
  // 플랫폼 인증·권한(D06-09) · Variant 조건(D02-01) · 기능 지원 조건(D02-02)
  { name: 'iamRoles', method: 'GET', path: '/api/iam/roles', summary: '역할·권한표(ROUTES 파생)·직무 분리 규칙', component: 'D06-09' },
  { name: 'iamDenials', method: 'GET', path: '/api/iam/denials', summary: '권한 거부 이력 (역할별 집계)', component: 'D06-09', query: ['limit'] },
  { name: 'iamMe', method: 'GET', path: '/api/iam/me', summary: '현재 행위자·허용 작업', component: 'D06-09' },
  { name: 'variantMatrix', method: 'GET', path: '/api/variants/:featureId/:version', summary: 'Variant·지원 조건 × Fleet 매트릭스', component: 'D02-01' },
  { name: 'vehicleSupport', method: 'GET', path: '/api/support/:vin', summary: '차량별 배포 Feature 지원 여부', component: 'D02-02' },
  // PoC 6단계 러너 (P9) — 실제 서비스를 역할별 행위자로 차례로 실행·상태 저장, 42 컴포넌트 활동
  { name: 'pocRuns', method: 'GET', path: '/api/poc/runs', summary: 'PoC 실행 목록', component: 'KERNEL' },
  { name: 'pocRun', method: 'GET', path: '/api/poc/runs/:id', summary: 'PoC 실행 — 단계·행위·증적', component: 'KERNEL' },
  { name: 'startPoc', method: 'POST', path: '/api/poc/runs', summary: 'PoC 실행 시작 (이전 PoC 차단 복구 후)', component: 'KERNEL', roles: ['OPERATOR', 'RELEASE_MANAGER', 'FEATURE_APPROVER', 'SAFETY_OFFICER'], body: EmptyBody },
  { name: 'advancePoc', method: 'POST', path: '/api/poc/runs/:id/advance', summary: 'PoC 다음 단계 실행 (진행 중 단계는 완료 확인)', component: 'KERNEL', roles: ['OPERATOR', 'RELEASE_MANAGER', 'FEATURE_APPROVER', 'SAFETY_OFFICER'], body: EmptyBody },
  { name: 'componentActivity', method: 'GET', path: '/api/components/activity', summary: '컴포넌트별 최근 활동 (이벤트·감사)', component: 'KERNEL', query: ['minutes'] },
];

export const routeKey = (r: Pick<RouteDef, 'method' | 'path'>) => `${r.method} ${r.path}`;

/** 경로 이름 + 매개변수 + 질의 → 요청 URL. 질의는 주어진 키 순서대로, 빈 값은 뺀다(스냅샷 파일 이름이 이 순서에 의존). */
export function routeUrl(name: string, params: Record<string, string> = {}, query: Record<string, string | number | boolean | undefined | null> = {}): string {
  const r = ROUTES.find((x) => x.name === name);
  if (!r) throw new Error(`알 수 없는 API: ${name}`);
  const path = r.path.replace(/:(\w+)/g, (_, k: string) => {
    if (params[k] === undefined) throw new Error(`${name}: 경로 매개변수 ${k} 누락`);
    return encodeURIComponent(params[k]);
  });
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

/** 정적 데모 스냅샷 파일 이름 — 파일 시스템·정적 호스팅에서 안전한 문자만 남긴다 */
export function snapshotFile(url: string): string {
  return 'api-snapshot/' + url.replace(/^\/api\//, '').replace(/[^A-Za-z0-9._-]/g, '_') + '.json';
}
