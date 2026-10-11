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
}

export const ROUTES: RouteDef[] = [
  // 커널
  { name: 'health', method: 'GET', path: '/api/health', summary: '상태 점검', component: 'KERNEL' },
  { name: 'components', method: 'GET', path: '/api/components', summary: '42 컴포넌트 현황', component: 'KERNEL' },
  { name: 'events', method: 'GET', path: '/api/events', summary: '이벤트 이력', component: 'D04-04', query: ['after', 'type', 'aggregate', 'limit'] },
  { name: 'eventStream', method: 'GET', path: '/api/events/stream', summary: '이벤트 실시간 스트림 (SSE)', component: 'D04-04', query: ['types'] },
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
  { name: 'productCandidates', method: 'GET', path: '/api/products/candidates', summary: 'BOM 후보 (확정 Baseline·범위 일치)', component: 'D01-03', query: ['country', 'vehicleModel', 'trim', 'q'] },
  { name: 'validateComposition', method: 'POST', path: '/api/products/validate', summary: '구성 검증 (저장 없음)', component: 'D01-03', roles: ['PRODUCT_AUTHOR', 'PRODUCT_APPROVER'], body: ValidateCompositionBody },
  { name: 'productDetail', method: 'GET', path: '/api/products/:id/versions/:ver', summary: '상품 Version 상세·구성 검증·출시 적격성', component: 'D01-03' },
  { name: 'updateProductDraft', method: 'PATCH', path: '/api/products/:id/versions/:ver', summary: 'PROPOSED 상품 수정', component: 'D01-03', roles: ['PRODUCT_AUTHOR'], body: UpdateProductDraftBody },
  { name: 'createProductVersion', method: 'POST', path: '/api/products/:id/versions', summary: '새 Catalog Version (구성·기간 변경)', component: 'D01-03', roles: ['PRODUCT_AUTHOR'], body: CreateProductVersionBody },
  { name: 'productTransition', method: 'POST', path: '/api/products/:id/versions/:ver/transitions', summary: '상품 Lifecycle 전이 (구성 승인·고객 출시 승인 분리)', component: 'D01-03', roles: ['PRODUCT_APPROVER'], body: ProductTransitionBody },
];

export const routeKey = (r: Pick<RouteDef, 'method' | 'path'>) => `${r.method} ${r.path}`;
