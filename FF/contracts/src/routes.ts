// API 경로 목록 — 단일 기준. 백엔드 실제 라우트와 다르면 테스트가 실패하고(backend/test/routes.spec.ts),
// OpenAPI(docs/80-integration/openapi.json)와 프론트 API 클라이언트가 이것에서 만들어진다.
import type { ZodTypeAny } from 'zod';
import type { Role } from './enums';
import { BaselineDecisionBody, BaselineRequestBody, CreateFeatureBody, CreateVersionBody, JudgeGateBody, TransitionBody, UpdateDraftBody } from './schemas/api';

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
];

export const routeKey = (r: Pick<RouteDef, 'method' | 'path'>) => `${r.method} ${r.path}`;
