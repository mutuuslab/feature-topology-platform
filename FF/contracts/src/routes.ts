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
import { CreatePolicyBody, OfrepBody, PolicyDecisionBody, RolloutStageBody, UpdatePolicyBody } from './schemas/policy';
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
  { name: 'audit', method: 'GET', path: '/api/audit', summary: '감사 이력', component: 'D01-10', query: ['target', 'actorId', 'result', 'limit'] },

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
  { name: 'entitlements', method: 'GET', path: '/api/entitlements', summary: '사용 권한 (체험권·구독·구매)', component: 'D01-05', query: ['vin'] },
  { name: 'consumeEntitlement', method: 'POST', path: '/api/entitlements/:grantId/consume', summary: '체험 수락 → 1회 체험권 사용', component: 'D01-05', roles: ['OPERATOR', 'SYSTEM'], body: EmptyBody },
  { name: 'cohort', method: 'GET', path: '/api/targeting/cohort', summary: 'FP-COHORT-1 코호트 소속', component: 'D01-04', query: ['flagKey', 'basisPoints'], sample: { flagKey: 'care_00022_param' } },
  { name: 'activationDecide', method: 'GET', path: '/api/activation/decide', summary: '서버 기준 활성화 판단 (평가 근거)', component: 'D01-09', query: ['vin', 'flagKey'], sample: { vin: 'ego-01', flagKey: 'care_00022_param' } },

  // API Gateway (D05-01) — OpenFeature OFREP (IF-10)
  { name: 'ofrepEvaluate', method: 'POST', path: '/ofrep/v1/evaluate/flags/:key', summary: 'OFREP 단일 flag 평가', component: 'D05-01', body: OfrepBody, public: true },
  { name: 'ofrepBulk', method: 'POST', path: '/ofrep/v1/evaluate/flags', summary: 'OFREP 전체 flag 평가 (ETag)', component: 'D05-01', body: OfrepBody, public: true },
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
