// API 경로 목록 — 단일 기준. 백엔드 실제 라우트와 다르면 테스트가 실패하고(backend/test/routes.spec.ts),
// OpenAPI(docs/80-integration/openapi.json)와 프론트 API 클라이언트가 이것에서 만들어진다.
import type { ZodTypeAny } from 'zod';
import { ROLES, type Role } from './enums';
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
import { RestorePolicyRevisionBody } from './rules/policy-version';
import { CreateRollbackPlanBody, CreateRollbackRequestBody, PolicyRollbackBody, ROLLBACK_APPROVER_ROLES, ROLLBACK_REQUEST_ROLES, RollbackDecisionBody, RollbackPreviewBody } from './rules/rollback';
import { CreatePolicyBody, DeclineTrialBody, OfferTrialsBody, OfrepBody, PolicyDecisionBody, PurchaseTrialBody, RolloutStageBody, UpdatePolicyBody } from './schemas/policy';
import { FlagSourceManifest } from './schemas/flag-source';
import { ApproverKeyRegisterBody, EpochBumpBody, KeyRotateBody, KillApproveBody, KillCreateBody, KillRejectBody, ReadbackBody, RestoreRequestBody } from './schemas/ops';
import { HUMAN_ROLES, KILL_APPROVER_ROLES } from './rules/access';
import { NotificationReadAllBody } from './rules/notification';
import { RunVirtualBody } from './rules/virtual';
import { MetricPlanBody } from './rules/safety-kpi';
import { DATA_CATEGORY_ACCESS } from './rules/data-catalog';
import { LOCATION_VIEW_ROLES } from './rules/fleet-map';
import { FleetOnboardBody } from './rules/population';
import { ContractBasisBody, DataAccessRequestBody } from './rules/data-act';
import { ReferenceRetireBody, ReferenceValueBody, VehicleRegisterBody } from './rules/reference-data';
import { ErasureExecuteBody, ErasureRejectBody, ErasureRequestBody, PrivacyExportBody } from './rules/privacy';
import { PostReviewBody } from './rules/duty-separation';
import { ChangeRecordBody } from './rules/change-record';
import { RetirementRequestBody, RetirementStepBody } from './rules/retirement';
import type { DataCategory } from './rules/retention';
import { SafetyConfirmBody, SafetyProfilePatch } from './schemas/safety-profile';
import { ReleaseSignoffBody } from './schemas/release-signoff';
import { ProcedureCompleteBody } from './schemas/procedure';
import { AddCostFeatureBody, COST_MONEY_ROLES, COST_READ_ROLES, CostBasisDraftBody, CostTransitionBody, CreateCostProjectBody, PutCostActualBody, PutCostCheckBody, PutCostMbdBody, UpdateCostLineBody, UpdateCostProjectBody } from './schemas/cost';

import { AnomalyActionBody, FeedbackAcceptBody } from './rules/anomaly';
import { VehicleReportBody } from './rules/vehicle-requests';
import { VehicleDeliveryAck } from './rules/vehicle-auth';
import { OtaEvent, OtaJobActionBody } from './rules/ota';
import { KillCommandV2, StatusReportV2 } from './schemas/wire';
import { ConcludeExperimentBody, CreateExperimentBody, CreateIncidentBody, FieldCaseBody, ImportOrdersBody, RunSyncBody, TranslateLegacyBody } from './rules/ext';
import { z } from 'zod';
import { VexStatement } from './rules/sbom';
import { LinkChangeRequestBody, MockExtActionBody, MockExtCreateBody, ResolveConflictBody } from './rules/ext-sync';
import { DashboardCreateBody, DashboardDeleteBody, DashboardFavouriteBody, DashboardUpdateBody } from './schemas/dashboard';
import { CreateRefChangeBody, DecideRefChangeBody, PublishRefReleaseBody, RecordSourceReviewBody, RequestRefAddBody, ReviewRefChangeBody } from './schemas/refdb';
import { AnswerConsultationBody, CreateConsultationBody } from './schemas/consult';
import { G7SignoffBody, HaraBody, HomologationBody, SotifBody, TaraBody } from './rules/gate-evidence';

const EmptyBody = z.object({}).strict();
/** 공개 데모 게이트 로그인(20-99) — 데모 ID·비밀번호. 길이만 막고 판정은 서버가 상수 시간으로 */
export const DemoLoginBody = z.object({ id: z.string().max(128), password: z.string().max(256) }).strict();
export type DemoLoginBody = z.infer<typeof DemoLoginBody>;
/** Feature DB 변경 요청 작성 — 사람 역할(HUMAN_ROLES) 모두에서 감사 조회자만 뺀다(30-95 §8.1). 백엔드 컨트롤러 @Roles도 이것을 쓴다.
 *  HUMAN_ROLES와 같은 식을 enums에서 바로 쓴다 — rules/access.ts가 이 파일을 먼저 읽는 순환에서 HUMAN_ROLES가 아직 없을 수 있다(access-refdb.test가 같음을 본다) */
export const REFDB_CHANGE_REQUESTERS: Role[] = ROLES.filter((r) => r !== 'VEHICLE' && r !== 'SYSTEM' && r !== 'AUDITOR');
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
  /** 빠지면 서버가 400을 내는 질의 — routeUrl이 빈 값으로 만들지 않고 던진다. 화면 조회는 enabled로 막아야 한다(data:check가 검사).
   *  예전(2026-10-25): 활성화 판단 화면의 Fleet 조회가 정책 목록보다 먼저 돌아 flagKey 없이 요청 → 정적 데모 스냅샷 누락이 응답 순서에 따라 났다 */
  requiredQuery?: string[];
  /** 필수 질의가 있는 GET — 준수 검사가 호출할 예시 값 */
  sample?: Record<string, string>;
  /** 끝나지 않는 스트림(SSE) — 준수 검사는 상태·Content-Type만 본다 */
  stream?: boolean;
  /** 텔레메트리 읽기 경로의 13.1 범주 — roles는 DATA_CATEGORY_ACCESS와 같다(FFG-TEL-001) */
  dataCategory?: DataCategory;
  /** 상태를 바꾸지 않는 공개 POST(OFREP 평가) — 역할 없음 */
  public?: boolean;
  /** 요청 계정마다 결과가 다른 조회(내 알림) — 프론트가 GET에도 행위자 헤더를 붙이고 계정별로 캐시한다 */
  personal?: boolean;
}

export const ROUTES: RouteDef[] = [
  // 커널
  { name: 'health', method: 'GET', path: '/api/health', summary: '상태 점검', component: 'KERNEL' },
  { name: 'healthLive', method: 'GET', path: '/api/health/live', summary: '생존 점검(프로세스 응답)', component: 'KERNEL' },
  { name: 'healthMetrics', method: 'GET', path: '/api/health/metrics', summary: '지표(Prometheus 텍스트) — 운영 모드는 Bearer FF_METRICS_TOKEN', component: 'KERNEL' },
  { name: 'healthReady', method: 'GET', path: '/api/health/ready', summary: '준비 점검(마이그레이션·DB 쓰기·Feature DB 행 수, 아니면 503)', component: 'KERNEL' },
  // 로그인(BFF, FF_AUTH=oidc) — 신원 없이 연다. 브라우저는 httpOnly 세션 쿠키만 가진다(출시 준비 RD-SEC-01·03)
  { name: 'authConfig', method: 'GET', path: '/api/auth/config', summary: '인증 방식(demo|oidc) — 로그인 화면이 무엇을 그릴지', component: 'KERNEL', public: true },
  { name: 'authLogin', method: 'GET', path: '/api/auth/login', summary: 'SSO 로그인 시작 — IdP 인가로 302(PKCE S256·state·nonce)', component: 'KERNEL', query: ['returnTo', 'login_hint'], public: true },
  { name: 'authCallback', method: 'GET', path: '/api/auth/callback', summary: 'IdP 콜백 — 코드 교환·id_token 검증·역할 매핑 후 세션 쿠키, 안전한 returnTo로 302', component: 'KERNEL', query: ['code', 'state', 'error'], public: true },
  { name: 'authLogout', method: 'POST', path: '/api/auth/logout', summary: '로그아웃 — 세션 삭제·쿠키 제거, IdP 로그아웃 주소', component: 'KERNEL', body: EmptyBody, public: true },
  { name: 'authMe', method: 'GET', path: '/api/auth/me', summary: '로그인한 사용자 — 이름·이메일·부여 역할(IdP 그룹에서)', component: 'KERNEL', public: true },
  { name: 'authDemoLogin', method: 'POST', path: '/api/auth/demo-login', summary: '공개 데모 게이트 로그인 — 데모 ID·비밀번호로 서버 세션 쿠키(FF_DEMO_GATE=on, 20-99). 출처 확인·실패 제한', component: 'KERNEL', body: DemoLoginBody, public: true },
  { name: 'systemConnections', method: 'GET', path: '/api/system/connections', summary: '외부 연결 상태(과금·OTA·Data Lake) — 모의·연결 안 됨을 화면에 표시하는 근거', component: 'KERNEL' },
  { name: 'components', method: 'GET', path: '/api/components', summary: '42 컴포넌트 현황', component: 'KERNEL' },
  { name: 'events', method: 'GET', path: '/api/events', summary: '이벤트 이력 — after(순번) 커서 페이지 나눔·nextCursor, recent=1 최근 창(순번 오름차순)', component: 'D04-04', query: ['after', 'type', 'aggregate', 'limit', 'recent'] },
  { name: 'notifications', method: 'GET', path: '/api/notifications', summary: '내 알림 — 개인·역할·Owner 팀 수신자, 안 읽음 수·범주별 집계', component: 'D04-04', query: ['unread', 'category', 'limit'], personal: true },
  { name: 'readNotification', method: 'POST', path: '/api/notifications/:id/read', summary: '알림 읽음 표시(계정별)', component: 'D04-04', roles: HUMAN_ROLES, body: EmptyBody },
  { name: 'readAllNotifications', method: 'POST', path: '/api/notifications/read-all', summary: '알림 모두 읽음(범주 선택)', component: 'D04-04', roles: HUMAN_ROLES, body: NotificationReadAllBody },
  { name: 'eventStream', method: 'GET', path: '/api/events/stream', summary: '이벤트 실시간 스트림 (SSE)', component: 'D04-04', query: ['types'], stream: true },
  { name: 'safetyProfiles', method: 'GET', path: '/api/safety-profiles', summary: '안전 분류 목록 (보고서 5.7)', component: 'D01-01', query: ['featureId'] },
  { name: 'safetyProfile', method: 'GET', path: '/api/features/:id/versions/:ver/safety', summary: '안전 분류 + 조합 검사 (FFG-CLS-009)', component: 'D01-01' },
  { name: 'updateSafetyProfile', method: 'PUT', path: '/api/features/:id/versions/:ver/safety', summary: '안전 분류 초안 수정 (확정 후 불가, FFG-CLS-004)', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'SAFETY_OFFICER'], body: SafetyProfilePatch },
  { name: 'confirmSafetyProfile', method: 'POST', path: '/api/features/:id/versions/:ver/safety/confirm', summary: '안전 분류 확정 — Safety Manager 개인 서명', component: 'D01-01', roles: ['SAFETY_OFFICER'], body: SafetyConfirmBody },
  { name: 'releaseSignoff', method: 'GET', path: '/api/features/:id/versions/:ver/release-signoff', summary: 'Release Sign-off(출시 책임 확인) 조회 — 현재 G8·G9 판정에 묶인 서명인지', component: 'D01-01' },
  { name: 'signRelease', method: 'POST', path: '/api/features/:id/versions/:ver/release-signoff', summary: 'Release Sign-off — Feature Owner가 G8·G9 PASS 뒤 출시 책임을 개인 서명으로 확인(보고서 6.1 G7)', component: 'D01-01', roles: ['FEATURE_AUTHOR'], body: ReleaseSignoffBody },
  { name: 'audit', method: 'GET', path: '/api/audit', summary: '감사 이력 — 최신순, cursor 페이지 나눔(응답 nextCursor)', component: 'D01-10', query: ['target', 'actorId', 'result', 'limit', 'cursor', 'targetPrefix', 'action'] },
  { name: 'auditChain', method: 'GET', path: '/api/audit/chain', summary: '감사 해시 체인 무결성 (FFG-PLT-015)', component: 'D01-10' },

  // 업무 절차 실행 (docs/65-workflows) — 완료는 서버 저장·감사·이벤트, 검토함은 내 역할 기준
  { name: 'procedureState', method: 'GET', path: '/api/procedures/state', summary: '업무 절차 활동 완료 상태(서버 저장) — Evidence·서명 포함', component: 'D04-04', personal: true },
  { name: 'procedureInbox', method: 'GET', path: '/api/procedures/inbox', summary: '내 업무 절차 검토함 — 준비된 수행(R)·책임(A) 활동, SLA 기한·초과', component: 'D04-04', personal: true },
  { name: 'procedureSummary', method: 'GET', path: '/api/procedures/summary', summary: '내 업무 절차 요약 — 메뉴 배지(할 일·검토·기한 초과)', component: 'D04-04', personal: true },
  { name: 'completeProcedureActivity', method: 'POST', path: '/api/procedures/activities/:id/complete', summary: '활동 완료 — Evidence·개인 서명(선택), 감사·인계 알림', component: 'D04-04', roles: HUMAN_ROLES, body: ProcedureCompleteBody },
  { name: 'undoProcedureActivity', method: 'DELETE', path: '/api/procedures/activities/:id/complete', summary: '활동 완료 취소 — 감사 기록, 다음 활동 인계를 되돌린다', component: 'D04-04', roles: HUMAN_ROLES, body: EmptyBody },

  // Feature Registry (D01-01)
  { name: 'listFeatures', method: 'GET', path: '/api/features', summary: 'Feature 버전 목록 — limit·cursor를 주면 페이지 나눔(응답 nextCursor), 없으면 전체', component: 'D01-01', query: ['q', 'lifecycle', 'country', 'vehicleModel', 'latestOnly', 'limit', 'cursor'] },
  { name: 'createFeature', method: 'POST', path: '/api/features', summary: 'Feature 등록 (PROPOSED 0.1.0)', component: 'D01-01', roles: ['FEATURE_AUTHOR'], body: CreateFeatureBody },
  { name: 'featureVersions', method: 'GET', path: '/api/features/:id', summary: 'Feature의 버전들', component: 'D01-01' },
  { name: 'createVersion', method: 'POST', path: '/api/features/:id/versions', summary: '새 Version 생성', component: 'D01-01', roles: ['FEATURE_AUTHOR'], body: CreateVersionBody },
  { name: 'featureDetail', method: 'GET', path: '/api/features/:id/versions/:ver', summary: 'Feature 버전 상세 — 전이 미리 보기(transitions)는 묻는 사람의 역할로 판정한다(행위자 헤더)', component: 'D01-01', personal: true },
  { name: 'updateDraft', method: 'PATCH', path: '/api/features/:id/versions/:ver', summary: 'PROPOSED 초안 수정', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'SAFETY_OFFICER', 'VARIANT_OWNER', 'IMPLEMENTER'], body: UpdateDraftBody },
  { name: 'transition', method: 'POST', path: '/api/features/:id/versions/:ver/transitions', summary: 'Lifecycle 전이', component: 'D01-01', roles: ['FEATURE_APPROVER', 'RELEASE_MANAGER', 'GATE_JUDGE'], body: TransitionBody },
  { name: 'baselineChecklist', method: 'GET', path: '/api/features/:id/versions/:ver/baseline-checklist', summary: 'BOM 확정 체크리스트', component: 'D01-01' },

  // Feature DB (D01-01 확장, docs/30-data-model/30-95) — 차종과 무관한 기준 기능 정의. Feature 등록은 기준 행을 대표 1 + 포함 N으로 참조한다
  { name: 'listRefs', method: 'GET', path: '/api/refdb/refs', summary: 'Feature DB 기준 행 검색 — 한글·영문 기능명·별칭·용어집·ID, 도메인·컴포넌트·상태 필터, offset·limit 페이지(금액 필드는 산정 역할만)', component: 'D01-01', query: ['q', 'domain', 'component', 'status', 'offset', 'limit', 'source'], personal: true },
  { name: 'refDetail', method: 'GET', path: '/api/refdb/refs/:refId', summary: 'Feature DB 기준 행 상세 — 정의·근거·세부기능 후보·이 행을 쓰는 Feature(금액 필드는 산정 역할만)', component: 'D01-01', personal: true },
  { name: 'refTaxonomy', method: 'GET', path: '/api/refdb/taxonomy', summary: 'Feature DB 분류 — 도메인 10 → 클러스터 → 컴포넌트', component: 'D01-01' },
  { name: 'refSources', method: 'GET', path: '/api/refdb/sources', summary: 'Feature DB 출처 — 자료·발행처·버전·확인일·다음 점검일', component: 'D01-01' },
  { name: 'recordSourceReview', method: 'POST', path: '/api/refdb/sources/reviews', summary: 'Feature DB 출처 정기 점검 기록 — 확인일·다음 점검일 갱신(기한 알림이 닫힌다)', component: 'D01-01', roles: ['REFDB_ADMIN'], body: RecordSourceReviewBody },
  { name: 'refQuality', method: 'GET', path: '/api/refdb/quality', summary: 'Feature DB 품질 지표 — 상태별 행 수·출처 없음·근거 확인 12개월 경과·규모 근거 D 비중·발행 대기', component: 'D01-01' },
  { name: 'refReleases', method: 'GET', path: '/api/refdb/releases', summary: 'Feature DB 발행 버전 이력 — 변경 요청 묶음·전체 해시', component: 'D01-01' },
  { name: 'refSubfunctions', method: 'GET', path: '/api/refdb/subfunctions', summary: 'Feature DB 세부기능 후보(읽기 전용 참고) — 컴포넌트별', component: 'D01-01', query: ['component'] },
  { name: 'requestRefAdd', method: 'POST', path: '/api/refdb/requests', summary: 'Feature DB에 없는 기능 추가 요청 — 정식 ID를 바로 부여한 요청 중 행 + 추가 변경 요청(승인 전에는 Feature 정의 승인이 막힘)', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'REFDB_ADMIN'], body: RequestRefAddBody },
  { name: 'listRefChanges', method: 'GET', path: '/api/refdb/changes', summary: 'Feature DB 변경 요청 목록 — 대상 행·상태·종류·도메인(도메인 검토자의 담당 도메인) 필터(금액 필드는 산정 역할만)', component: 'D01-01', query: ['refId', 'status', 'kind', 'domain'], personal: true },
  { name: 'refChangeDetail', method: 'GET', path: '/api/refdb/changes/:id', summary: 'Feature DB 변경 요청 상세 — 필드 차이·자동 점검·검토 의견·영향(이 행을 쓰는 Feature, 금액 필드는 산정 역할만)', component: 'D01-01', personal: true },
  { name: 'createRefChange', method: 'POST', path: '/api/refdb/changes', summary: 'Feature DB 변경 요청 작성(추가·수정·폐기 예정·폐기) — 자동 점검 후 도메인 검토로', component: 'D01-01', roles: REFDB_CHANGE_REQUESTERS, body: CreateRefChangeBody },
  { name: 'reviewRefChange', method: 'POST', path: '/api/refdb/changes/:id/reviews', summary: 'Feature DB 변경 요청 도메인 검토 의견(동의·보완·반대) — 요청자는 검토할 수 없다', component: 'D01-01', roles: ['DOMAIN_REVIEWER'], body: ReviewRefChangeBody },
  { name: 'decideRefChange', method: 'POST', path: '/api/refdb/changes/:id/decision', summary: 'Feature DB 변경 요청 승인·반려 — 요청자·검토자 ≠ 승인자, 마지막 검토 의견이 보완·반대이거나 필수 정보 누락이면 승인 불가', component: 'D01-01', roles: ['REFDB_ADMIN'], body: DecideRefChangeBody },
  { name: 'publishRefRelease', method: 'POST', path: '/api/refdb/releases', summary: 'Feature DB 버전 발행 — 승인된 변경 요청을 묶어 다음 버전·전체 해시 기록(추가만)', component: 'D01-01', roles: ['REFDB_ADMIN'], body: PublishRefReleaseBody },
  { name: 'exportRefdb', method: 'GET', path: '/api/refdb/export', summary: 'Feature DB 내보내기 — 엑셀 03_FeatureDB 열 순서 + 출처 시트(금액 열은 산정 역할만)', component: 'D01-01', query: ['format', 'release'], personal: true },

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
  { name: 'featureFlags', method: 'GET', path: '/api/feature-flags', summary: 'Feature Flag와 코드 사용처·배포 확인', component: 'D01-06', query: ['featureId', 'version'] },
  { name: 'listFlagSources', method: 'GET', path: '/api/flag-sources', summary: '소스 스냅샷 가져오기 이력', component: 'D01-06' },
  { name: 'importFlagSources', method: 'POST', path: '/api/flag-sources', summary: '개발자·CI 소스 스냅샷 가져오기', component: 'D01-06', roles: ['IMPLEMENTER'], body: FlagSourceManifest },
  { name: 'createPolicy', method: 'POST', path: '/api/policies', summary: '정책 작성 (DRAFT)', component: 'D01-06', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER'], body: CreatePolicyBody },
  { name: 'validations', method: 'GET', path: '/api/policies/validations', summary: '검증 이력 (8종 결과·근거)', component: 'D06-04', query: ['policyId'] },
  { name: 'policyDetail', method: 'GET', path: '/api/policies/:id', summary: '정책 상세·마지막 검증·승인 적격성', component: 'D01-06' },
  { name: 'updatePolicy', method: 'PATCH', path: '/api/policies/:id', summary: '정책 수정 (새 개정본·재검증 필요)', component: 'D01-06', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER'], body: UpdatePolicyBody },
  { name: 'policyRevisions', method: 'GET', path: '/api/policies/:id/revisions', summary: '정책 버전 목록 (개정본마다 내용 보존)', component: 'D01-06' },
  { name: 'policyRevision', method: 'GET', path: '/api/policies/:id/revisions/:revision', summary: '정책 버전 내용', component: 'D01-06' },
  { name: 'restorePolicyRevision', method: 'POST', path: '/api/policies/:id/revisions/:revision/restore', summary: '정책 버전 복원 (새 개정본·DRAFT, 재검증·재승인 필요)', component: 'D01-06', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER'], body: RestorePolicyRevisionBody },
  { name: 'policyHistory', method: 'GET', path: '/api/policies/:id/history', summary: '정책 버전·배포 이력 — 이 flag로 배포된 버전(서명 게시본)·되돌릴 수 있는 버전·진행 중 되돌리기 요청', component: 'D03-04' },
  { name: 'requestPolicyRollback', method: 'POST', path: '/api/policies/:id/rollback', summary: '이전 버전으로 되돌리기 요청 — 재검증·지정 승인·실행은 수동 롤백과 같다 (412 기준 배포 바뀜, 409 진행 중 요청)', component: 'D03-04', roles: ROLLBACK_REQUEST_ROLES, body: PolicyRollbackBody },
  { name: 'policyChanges', method: 'GET', path: '/api/policies/:id/changes', summary: '정책 변경 이력 (변경자·시각·변경 전후)', component: 'D01-06' },
  { name: 'validatePolicy', method: 'POST', path: '/api/policies/:id/validate', summary: '분야별 검증 8종 병렬 → 배포 안전성 판정', component: 'D06-04', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE'], body: EmptyBody },
  { name: 'decidePolicy', method: 'POST', path: '/api/policies/:id/decision', summary: '정책 승인·반려 (작성자≠승인자, 해시·GO 확인)', component: 'D01-06', roles: ['FEATURE_APPROVER'], body: PolicyDecisionBody },
  { name: 'deployPolicy', method: 'POST', path: '/api/policies/:id/deploy', summary: '서버 배포 (평가 기준 전환)', component: 'D01-06', roles: ['RELEASE_MANAGER', 'OPERATOR'], body: ReasonBody },
  { name: 'stageRollout', method: 'POST', path: '/api/policies/:id/rollout', summary: '단계적 기능 배포 — 승인 범위 안 코호트 단계', component: 'D01-08', roles: ['RELEASE_MANAGER', 'OPERATOR'], body: RolloutStageBody },

  // 사용 권한 (D01-05) · 적용 대상 (D01-04) · 활성화 제어 (D01-09)
  { name: 'vehicles', method: 'GET', path: '/api/vehicles', summary: 'Fleet 차량 — limit·cursor를 주면 VIN 순 페이지(응답 nextCursor), 없으면 전체. total·sample(표본 차량 수)은 늘 함께', component: 'D01-04', query: ['limit', 'cursor'] },
  { name: 'entitlements', method: 'GET', path: '/api/entitlements', summary: '사용 권한 (체험권·구독·구매)', component: 'D01-05', query: ['vin', 'source'] },
  { name: 'trials', method: 'GET', path: '/api/trials', summary: '체험권 차량 목록 (상태·성향 필터)', component: 'D01-05', query: ['catalogId', 'state', 'source', 'country', 'region', 'vehicleModel', 'trim', 'ageBand', 'drivingStyle', 'adasUsage', 'q', 'page', 'pageSize'] },
  { name: 'offerTrials', method: 'POST', path: '/api/trials/offers', summary: '차량별 체험 제안 (14일 안에 수락)', component: 'D01-05', roles: ['PRODUCT_AUTHOR', 'OPERATOR', 'SYSTEM'], body: OfferTrialsBody },
  { name: 'acceptTrial', method: 'POST', path: '/api/trials/:grantId/accept', summary: '체험 수락 → 30일 기능 ON', component: 'D01-05', roles: ['OPERATOR', 'SYSTEM'], body: EmptyBody },
  { name: 'declineTrial', method: 'POST', path: '/api/trials/:grantId/decline', summary: '체험 거절', component: 'D01-05', roles: ['OPERATOR', 'SYSTEM'], body: DeclineTrialBody },
  { name: 'purchaseTrial', method: 'POST', path: '/api/trials/:grantId/purchase', summary: '체험 → 구독·구매 전환 (과금 연계)', component: 'D05-04', roles: ['OPERATOR', 'SYSTEM'], body: PurchaseTrialBody },
  { name: 'trialAnalytics', method: 'GET', path: '/api/biz/trials', summary: '체험 전환 분석 (수락률·전환율·성향별·주별)', component: 'D05-06', query: ['catalogId', 'groupBy', 'source', 'weeks'] },
  { name: 'cohort', method: 'GET', path: '/api/targeting/cohort', summary: 'FP-COHORT-1 코호트 소속', component: 'D01-04', query: ['flagKey', 'basisPoints'], sample: { flagKey: 'care_00022_param' } },
  { name: 'activationDecide', method: 'GET', path: '/api/activation/decide', summary: '서버 기준 활성화 판단 (평가 근거)', component: 'D01-09', query: ['vin', 'flagKey'], requiredQuery: ['vin', 'flagKey'], sample: { vin: 'ego-01', flagKey: 'care_00022_param' } },

  // API Gateway (D05-01) — OpenFeature OFREP (IF-10)
  { name: 'ofrepEvaluate', method: 'POST', path: '/ofrep/v1/evaluate/flags/:key', summary: 'OFREP 단일 flag 평가', component: 'D05-01', body: OfrepBody, public: true },
  { name: 'ofrepBulk', method: 'POST', path: '/ofrep/v1/evaluate/flags', summary: 'OFREP 전체 flag 평가 (ETag)', component: 'D05-01', body: OfrepBody, public: true },
  // 배포·차단 전달 (PoC ④⑤⑥) — 서명 게시본 → 파이프라인 → 차량 런타임·GLEO → 회신 집계
  { name: 'pkiKeys', method: 'GET', path: '/api/pki/keys', summary: '서명 키 (공개키·지문·유효기간)', component: 'D06-10' },
  { name: 'rotateKey', method: 'POST', path: '/api/pki/rotate', summary: '서명 키 교체 (이전 키는 검증용으로 유지, 용도별)', component: 'D06-10', roles: ['SECURITY_OFFICER', 'SAFETY_OFFICER'], body: KeyRotateBody },
  { name: 'hsmStatus', method: 'GET', path: '/api/pki/hsm', summary: '소프트웨어 HSM — 차량 키 epoch·승인자 키 수', component: 'D06-10' },
  { name: 'bumpEpoch', method: 'POST', path: '/api/pki/epoch', summary: '차량 키 epoch 상향 (키 유출 대응, FFG-SEC-002)', component: 'D06-10', roles: ['SECURITY_OFFICER', 'SAFETY_OFFICER'], body: EpochBumpBody },
  { name: 'approverKeys', method: 'GET', path: '/api/pki/approver-keys', summary: '등록된 승인자 키 목록 — 공개키 지문·출처(플랫폼 보관·외부 장치)', component: 'D06-10' },
  { name: 'registerApproverKey', method: 'POST', path: '/api/pki/approver-keys', summary: '외부 승인자 공개키 등록 (긴급 차단 승인 서명 검증용, D-RD-5)', component: 'D06-10', roles: ['SECURITY_OFFICER'], body: ApproverKeyRegisterBody },
  { name: 'publications', method: 'GET', path: '/api/publications', summary: '서명 게시본 (정책·차단·복구) 목록', component: 'D06-08', query: ['kind', 'status'] },
  { name: 'publicationDetail', method: 'GET', path: '/api/publications/:id', summary: '게시본 — 서명 검증·차량별 회신·외부 연계 호출', component: 'D06-08' },
  { name: 'flagRetirements', method: 'GET', path: '/api/flag-retirements', summary: 'Flag Retirement 6단계 진행·코드 삭제 기한·기한 초과(보고서 6.5, FFG-LCY-011)', component: 'D01-01' },
  { name: 'requestFlagRetirement', method: 'POST', path: '/api/flag-retirements', summary: 'Flag Retirement 요청 — 다음 정기 릴리스 예정일(선택)', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'RELEASE_MANAGER'], body: RetirementRequestBody },
  { name: 'approveFlagRetirement', method: 'POST', path: '/api/flag-retirements/:id/approvals', summary: 'Retirement 승인 — Feature 승인자, F2 이상은 Safety Manager도(요청자 제외)', component: 'D01-01', roles: ['FEATURE_APPROVER', 'SAFETY_OFFICER'], body: EmptyBody },
  { name: 'recordFlagRetirementStep', method: 'POST', path: '/api/flag-retirements/:id/steps', summary: 'Retirement 2~6단계 기록 — 순서·완료 조건, 5단계 Registry 퇴역(ID 재사용 금지)', component: 'D01-01', roles: ['FEATURE_AUTHOR', 'RELEASE_MANAGER', 'IMPLEMENTER', 'REGULATORY_OWNER'], body: RetirementStepBody },
  { name: 'changeRecords', method: 'GET', path: '/api/change-records', summary: '변경 기록 감사 — AI 생성 표시·도구·범위, 검토·정적 분석·시험·커버리지 근거 누락(FFG-CODE-030)', component: 'D04-01', query: ['swId'] },
  { name: 'registerChangeRecord', method: 'POST', path: '/api/change-records', summary: 'CI/CD(IF-13) 변경 기록 등록 — 추가만', component: 'D04-01', roles: ['IMPLEMENTER', 'SYSTEM'], body: ChangeRecordBody },
  { name: 'integrationCalls', method: 'GET', path: '/api/integrations/calls', summary: '외부 연계 호출 기록 (IF-05·IF-13, 멱등 키)', component: 'D04-01', query: ['ifId', 'key'] },
  { name: 'readbacks', method: 'GET', path: '/api/telemetry/readbacks', summary: '차량 회신 (readback) 기록', component: 'D04-03', query: ['publicationId', 'vin'], personal: true, dataCategory: 'SAFETY_OPERATION', roles: [...DATA_CATEGORY_ACCESS.SAFETY_OPERATION] },
  { name: 'ingestReadback', method: 'POST', path: '/api/telemetry/readback', summary: 'IF-06 차량 회신 수집', component: 'D04-03', roles: ['SYSTEM'], body: ReadbackBody },
  { name: 'fleetRuntime', method: 'GET', path: '/api/fleet/runtime', summary: 'Fleet 실시간 적용 현황 — 차량별 적용 게시본·상태·서버 판단 비교', component: 'D02-03' },
  { name: 'fleetMap', method: 'GET', path: '/api/fleet/map', summary: '전세계 차량 지도 — 차량별 위치(약 1 km)·구독 상태·기능 활성, 국가별 집계. 위치는 데모 모의값, 열람 감사', component: 'D02-03', query: ['source', 'catalogId', 'flagKey', 'zoom', 'bbox'], personal: true, roles: [...LOCATION_VIEW_ROLES] },
  { name: 'fleetMapVehicle', method: 'GET', path: '/api/fleet/map/vehicles/:vin', summary: '지도 차량 상세 — 정밀 위치(약 10 m)·권한·플래그 적용, 열람마다 감사', component: 'D02-03', personal: true, roles: [...LOCATION_VIEW_ROLES], sample: { vin: 'KMH-NX4-0001' } },
  { name: 'fleetPopulation', method: 'GET', path: '/api/fleet/population', summary: '대상 차량 모집단 — 판매 → 서비스 시장 → 플랫폼 탑재 → 커넥티드 → 운행 중 깔때기(가정값 모델)·가중 표본 규모', component: 'D02-03' },
  { name: 'fleetOnboard', method: 'POST', path: '/api/fleet/onboard', summary: '신차 커넥티드 등록(IF-06 Fleet 연계 모의) — 가중 표본 차량·수신 표본 등록', component: 'D02-03', roles: ['SYSTEM'], body: FleetOnboardBody },
  { name: 'registerVehicle', method: 'POST', path: '/api/fleet/vehicles', summary: '운영 차량 등록(IF-06 Fleet 연계) — Fleet 구분 PRODUCTION, 판매국·차종·트림은 등록된 기준 값이어야 한다(RD-OPS-03)', component: 'D02-03', roles: ['SYSTEM', 'VARIANT_OWNER'], body: VehicleRegisterBody },
  { name: 'vehicleRuntime', method: 'GET', path: '/api/vehicles/:vin/runtime', summary: '차량 런타임 — 적용 게시본·차량 측 평가·서버 판단 비교', component: 'D02-03' },
  { name: 'vehicleRequests', method: 'GET', path: '/api/vehicles/:vin/requests', summary: '차량 발신 요청 기록 — 조회·보고·거부 사유, 보고 위치(bootId·sequence)', component: 'D02-03', dataCategory: 'SAFETY_OPERATION', roles: [...DATA_CATEGORY_ACCESS.SAFETY_OPERATION] },
  // 차량 발신 요청 — 사람 역할이 아니라 차량 신원으로 받는다(RD-SEC-08: 요청 CMAC 또는 mTLS 주체, 데모만 X-Vehicle-Id 단독). 자기 VIN만.
  { name: 'vehicleSignedUnleashFlags', method: 'POST', path: '/vehicle/v1/:vin/signed-flags', summary: 'Unleash Edge 평가·FF 경계 검사 후 VIN/TTL 귀속 서명본', component: 'D02-03', roles: ['VEHICLE'], body: OfrepBody },
  { name: 'vehicleQueryAll', method: 'POST', path: '/vehicle/v1/:vin/flags', summary: 'IF-10 차량 발신 전체 flag 조회 (OFREP 형식, ETag)', component: 'D05-01', roles: ['VEHICLE'], body: OfrepBody },
  { name: 'vehicleQuery', method: 'POST', path: '/vehicle/v1/:vin/flags/:key', summary: 'IF-10 차량 발신 단일 flag 조회 (OFREP 형식)', component: 'D05-01', roles: ['VEHICLE'], body: OfrepBody },
  { name: 'vehicleStatus', method: 'POST', path: '/vehicle/v1/:vin/status', summary: 'IF-06 차량 상태 보고 v2 — 6단계 수신 검사(스키마·state_auth·report_seq·대상·명령 이력·영속), 위반은 이상 징후로', component: 'D04-03', roles: ['VEHICLE'], body: StatusReportV2 },
  { name: 'vehicleStatusView', method: 'GET', path: '/api/vehicles/:vin/status', summary: '차량 상태 보고 v2 — 받아들인 최신 상태·최근 수신(위반 포함)', component: 'D04-03', personal: true, dataCategory: 'SAFETY_OPERATION', roles: [...DATA_CATEGORY_ACCESS.SAFETY_OPERATION] },
  // 차량 당겨받기 채널(RD-OPS-04) — 서명한 요청(RD-SEC-08 CMAC 또는 mTLS)으로 전달함을 받아 가고 확인한다. docs/80-integration/80-40-vehicle-channel.md
  { name: 'vehicleInbox', method: 'GET', path: '/vehicle/v1/:vin/inbox', summary: 'IF-07 차량 전달함 — 확인하지 않은 서명 게시본(차단·복원은 kill_command v2 봉투 포함), 당겨받기 채널', component: 'D02-03', roles: ['VEHICLE'] },
  { name: 'vehicleDeliveryAck', method: 'POST', path: '/vehicle/v1/:vin/inbox/:deliveryId/ack', summary: 'IF-07 전달 확인 — 적용·거부를 회신(IF-06 readback)으로, 같은 확인 재시도는 같은 응답', component: 'D02-03', roles: ['VEHICLE'], body: VehicleDeliveryAck },
  { name: 'vehicleChannel', method: 'GET', path: '/api/vehicle-channel', summary: '차량 전달 채널 — 고른 어댑터(sim·pull·고객 게이트웨이)·대기 중 전달(설정 상태, 차량 데이터 아님)', component: 'D02-03', roles: [...DATA_CATEGORY_ACCESS.SAFETY_OPERATION] },
  // OTA 서버 연동(IF-05, FF_VEHICLE_CHANNEL=ota) — 작업 제출은 FF가 OTA 서버로, 차량별 결과는 OTA 서버가 webhook으로. docs/80-integration/80-45-ota-server-if05.md
  { name: 'otaEvents', method: 'POST', path: '/api/ota/v1/events', summary: 'IF-05 OTA 서버 webhook — 차량별 결과·작업 상태(HMAC·시각·이벤트 ID로 재전송 방지) → 회신 집계(IF-06)', component: 'D04-01', body: OtaEvent, public: true },
  { name: 'otaJobs', method: 'GET', path: '/api/ota/jobs', summary: 'IF-05 OTA 전달 작업 — 상태(전달 실패·재시도 대기 포함)·차량별 결과', component: 'D04-01', roles: [...DATA_CATEGORY_ACCESS.SAFETY_OPERATION], query: ['publicationId', 'state'] },
  { name: 'otaJobRetry', method: 'POST', path: '/api/ota/jobs/:jobId/retry', summary: 'IF-05 전달 실패한 OTA 작업 다시 제출(같은 멱등 키 — 두 번 전달되지 않는다)', component: 'D04-01', roles: ['RELEASE_MANAGER', 'OPS_LEAD', 'OPERATOR'], body: OtaJobActionBody },
  { name: 'otaJobCancel', method: 'POST', path: '/api/ota/jobs/:jobId/cancel', summary: 'IF-05 OTA 작업 취소 — 아직 전달하지 않은 차량만(이미 적용한 차량은 새 게시본으로 되돌린다)', component: 'D04-01', roles: ['RELEASE_MANAGER', 'OPS_LEAD'], body: OtaJobActionBody },
  { name: 'vehicleReport', method: 'POST', path: '/vehicle/v1/:vin/reports', summary: 'IF-06 차량 보고 — 재연결 대사·관측값·체험 수락·오류·회신 (Flag 직접 변경은 거부), 재평가 결과 응답', component: 'D02-03', roles: ['VEHICLE'], body: VehicleReportBody },
  { name: 'gleoStatus', method: 'GET', path: '/api/gleo/status', summary: 'GLEO Broker 연결·최근 메시지', component: 'D02-03' },
  { name: 'gatePreview', method: 'POST', path: '/api/gate/preview', summary: '정책 게이트 미리보기 — kill_command v2 판정(스키마·규칙), 원장 변경 없음. 스키마 오류도 SCHEMA_FAIL 결과로 돌려준다', component: 'D03-02', roles: ['OPERATOR', 'SAFETY_OFFICER', 'SECURITY_OFFICER', 'OPS_LEAD'], body: KillCommandV2 },
  { name: 'gateSnapshot', method: 'GET', path: '/api/gate/features/:id/versions/:ver', summary: '게이트가 보는 Feature Version — Registry 항목(D.6)·명령 원장·다음 순번·24시간 누적', component: 'D03-02', sample: { id: 'FEAT-00022', ver: '1.0.0' } },
  { name: 'killRequests', method: 'GET', path: '/api/kill-requests', summary: '긴급 차단 요청 목록 (회신 집계 포함)', component: 'D03-03', query: ['status'] },
  { name: 'killPreview', method: 'GET', path: '/api/kill-requests/preview', summary: '차단 영향 범위 미리보기 (의존 Feature·flag·차량)', component: 'D03-03', query: ['featureId', 'featureVersion', 'vins'], sample: { featureId: 'FEAT-00022', featureVersion: '1.0.0' } },
  { name: 'killDetail', method: 'GET', path: '/api/kill-requests/:id', summary: '차단 요청 상세 (차단·복구 회신)', component: 'D03-03' },
  { name: 'issueKill', method: 'POST', path: '/api/kill-requests', summary: '긴급 차단 요청 (type-to-confirm·사유 분류) — 2인 승인 뒤 게이트·서명·차량별 봉투', component: 'D03-03', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: KillCreateBody },
  { name: 'approveKill', method: 'POST', path: '/api/kill-requests/:id/approvals', summary: '긴급 차단 승인 — 개인 서명, 두 번째 승인이면 게이트 판정 후 발행', component: 'D03-03', roles: KILL_APPROVER_ROLES, body: KillApproveBody },
  { name: 'rejectKill', method: 'POST', path: '/api/kill-requests/:id/reject', summary: '긴급 차단 요청 거절', component: 'D03-03', roles: KILL_APPROVER_ROLES, body: KillRejectBody },
  { name: 'killTimeline', method: 'GET', path: '/api/kill-requests/:id/timeline', summary: '종료·복원 시간 기록 — 차량별 다섯 시각·명령 ID·Kill/고장 구분·신뢰 시간(FFG-ADS-007·TEL-004·TEL-010)', component: 'D03-03' },
  { name: 'killEnvelopes', method: 'GET', path: '/api/kill-requests/:id/envelopes', summary: '발행된 kill_command v2와 차량별 봉투(vehicle_auth·cmd_auth)', component: 'D03-03' },
  { name: 'requestRestore', method: 'POST', path: '/api/kill-requests/:id/restore', summary: '복원 요청 — 재검증 Evidence·이번 단계 Cohort, 2인 승인(직전 차단 승인자 제외) 뒤 게이트·서명', component: 'D03-04', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: RestoreRequestBody },
  { name: 'approveRestore', method: 'POST', path: '/api/kill-requests/:id/restore/approvals', summary: '복원 승인 — 개인 서명, 두 번째 승인이면 게이트 판정 후 복구 게시', component: 'D03-04', roles: KILL_APPROVER_ROLES, body: KillApproveBody },
  { name: 'rejectRestore', method: 'POST', path: '/api/kill-requests/:id/restore/reject', summary: '복원 요청 거절', component: 'D03-04', roles: KILL_APPROVER_ROLES, body: KillRejectBody },
  { name: 'rollbackDeployments', method: 'GET', path: '/api/rollbacks/deployments', summary: '롤백 대상 배포 — flag별 지금 배포와 복구 가능한 정책 버전', component: 'D03-04' },
  { name: 'rollbackDeployment', method: 'GET', path: '/api/rollbacks/deployments/:deploymentId', summary: '배포 기준 롤백 정보 — 변경·버전·배포 이력, 복구 가능 버전', component: 'D03-04' },
  { name: 'previewRollback', method: 'POST', path: '/api/rollbacks/preview', summary: '롤백 미리보기 — 영향 Feature·차량 그룹·적용 범위·적용 가능 여부(기록 없음)', component: 'D03-04', roles: HUMAN_ROLES, body: RollbackPreviewBody },
  { name: 'rollbacks', method: 'GET', path: '/api/rollbacks', summary: '롤백 이력 — 배포·Feature·Plan·요청·유형·차량·상태·결과·기간', component: 'D03-04', query: ['deploymentId', 'featureId', 'planId', 'requestId', 'targetType', 'vin', 'status', 'result', 'from', 'to'] },
  { name: 'rollbackExecution', method: 'GET', path: '/api/rollbacks/:id', summary: '롤백 실행 기록', component: 'D03-04' },
  { name: 'rollbackPlans', method: 'GET', path: '/api/rollback-plans', summary: 'Rollback Plan 목록', component: 'D03-04', query: ['deploymentId', 'status'] },
  { name: 'createRollbackPlan', method: 'POST', path: '/api/rollback-plans', summary: 'Rollback Plan 생성 — 자동 롤백 조건·복구 기준 버전·범위·승인대상자', component: 'D03-04', roles: ROLLBACK_REQUEST_ROLES, body: CreateRollbackPlanBody },
  { name: 'rollbackPlan', method: 'GET', path: '/api/rollback-plans/:id', summary: 'Rollback Plan 상세', component: 'D03-04' },
  { name: 'decideRollbackPlan', method: 'POST', path: '/api/rollback-plans/:id/decision', summary: 'Rollback Plan 승인·반려 — 지정 승인대상자(요청자 아님)', component: 'D03-04', roles: ROLLBACK_APPROVER_ROLES, body: RollbackDecisionBody },
  { name: 'rollbackRequests', method: 'GET', path: '/api/rollback-requests', summary: '수동 롤백 요청 목록', component: 'D03-04', query: ['deploymentId', 'status'] },
  { name: 'createRollbackRequest', method: 'POST', path: '/api/rollback-requests', summary: '수동 롤백 요청 — 복구 기준 버전·사유·승인대상자', component: 'D03-04', roles: ROLLBACK_REQUEST_ROLES, body: CreateRollbackRequestBody },
  { name: 'rollbackRequest', method: 'GET', path: '/api/rollback-requests/:id', summary: '수동 롤백 요청 상세', component: 'D03-04' },
  { name: 'decideRollbackRequest', method: 'POST', path: '/api/rollback-requests/:id/decision', summary: '수동 롤백 승인·반려 — 지정 승인대상자(요청자 아님)', component: 'D03-04', roles: ROLLBACK_APPROVER_ROLES, body: RollbackDecisionBody },
  { name: 'executeRollbackRequest', method: 'POST', path: '/api/rollback-requests/:id/execute', summary: '승인된 수동 롤백 실행 — 재검증 후 복구 기준 버전 재게시', component: 'D03-04', roles: ROLLBACK_REQUEST_ROLES, body: EmptyBody },
  { name: 'releaseKill', method: 'POST', path: '/api/kill-requests/:id/release', summary: '레거시(v1) 차단 해제 — v2 차단은 복원 요청·승인으로', component: 'D03-04', roles: ['OPERATOR', 'SAFETY_OFFICER'], body: z.object({ reason: z.string().trim().min(2).max(500) }).strict() },
  // 가상검증 (IF-09 가상검증 공급자: CARLA 실행기) — 차량 시나리오(D06-03)·안전 동작(D06-06) 근거, G5 Evidence는 TMS 제출(D04-02)
  { name: 'simStatus', method: 'GET', path: '/api/sim/status', summary: 'CARLA 가상검증 실행기 연결 상태', component: 'D06-03' },
  { name: 'virtualScenarios', method: 'GET', path: '/api/virtual-validations/scenarios', summary: 'Feature별 가상검증 시나리오 (역할·연결 검증기·목적)', component: 'D06-03', query: ['featureId'] },
  { name: 'sbomList', method: 'GET', path: '/api/sbom', summary: '게시본별 CycloneDX 1.6 SBOM 목록 — 원산지 누락 발견(FFG-SBOM-002·003·007, SEC-006)', component: 'D06-11', query: ['featureId'] },
  { name: 'sbomDetail', method: 'GET', path: '/api/sbom/:serial', summary: 'SBOM 본문(CycloneDX 1.6)', component: 'D06-11' },
  { name: 'vexList', method: 'GET', path: '/api/vex', summary: 'VEX 판정 이력과 영향 Feature', component: 'D06-11' },
  { name: 'recordVex', method: 'POST', path: '/api/vex', summary: 'VEX 판정 기록 — 저장된 SBOM으로 영향 Feature·조치 특정', component: 'D06-11', roles: ['SECURITY_OFFICER', 'SAFETY_OFFICER'], body: VexStatement },
  { name: 'retention', method: 'GET', path: '/api/retention', summary: '저장소별 보존 기간(13.7)·데이터 범주(13.1)·기간 초과/보존 유지/삭제 대상 수와 삭제 기록(FFG-TEL-008)', component: 'D04-03' },
  { name: 'retentionSweep', method: 'POST', path: '/api/retention/sweep', summary: '보존 기간이 지난 행 삭제 — 열린 Incident·이상 건에 연결된 행은 남기고 삭제 기록(FFG-TEL-008)', component: 'D04-03', roles: ['REGULATORY_OWNER', 'OPS_LEAD'], body: EmptyBody },
  { name: 'safetyKpi', method: 'GET', path: '/api/safety-kpi', summary: '출시 Feature Version별 운행 중 감시 지표 6종(13.5)·경보, 지표 계획 누락·예시값 Version(FFG-TEL-009)', component: 'D04-03' },
  { name: 'safetyKpiAnnex1', method: 'GET', path: '/api/safety-kpi/:featureId/:version/annex1', summary: 'ADS 기능 부속서 1 정기 보고 집계(기본 최근 365일, FFG-TEL-009)', component: 'D04-03', query: ['from', 'to'] },
  { name: 'recordSafetyKpiPlan', method: 'PUT', path: '/api/safety-kpi/:featureId/:version/plan', summary: 'Safety Case 경보 기준 기록(FSM, 추가만 — 최신 기록 유효)', component: 'D04-03', roles: ['SAFETY_OFFICER'], body: MetricPlanBody },
  { name: 'dataAccessRequests', method: 'GET', path: '/api/data-access-requests', summary: 'EU Data Act 접근 요청 처리 기록·계약 근거·Art.3(1) 직접 접근 대상·발견(FFG-TEL-006)', component: 'D05-01', roles: ['REGULATORY_OWNER', 'OPERATOR', 'AUDITOR', 'SYSTEM'] },
  { name: 'createDataAccessRequest', method: 'POST', path: '/api/data-access-requests', summary: 'EU 차량 사용자·제3자 데이터 접근 요청 처리 — Feature 상태·이력 제공 또는 거부(처리 기록, Art.4·5)', component: 'D05-01', roles: ['OPERATOR', 'REGULATORY_OWNER'], body: DataAccessRequestBody },
  { name: 'recordDataActContractBasis', method: 'POST', path: '/api/data-act/contract-basis', summary: 'OEM 비개인 데이터 이용 계약 근거(문서 ID) 등록 — 법무', component: 'D05-01', roles: ['REGULATORY_OWNER'], body: ContractBasisBody },
  // 고객 기준 값(출시 준비 RD-OPS-03) — 판매국·지역·차종·트림은 설치마다 등록한다. 데모 데이터셋 값은 시드일 뿐이다
  // SW 개발비 산정 (D07-01, 20-94 §7) — 금액은 산정 역할만, 그 밖의 역할은 공수(M/M)만(서버 투영). 금액을 돌려준 조회는 감사 COST_VIEW
  { name: 'costProjects', method: 'GET', path: '/api/cost/projects', summary: '산정 과제 목록(금액은 산정 역할만)', component: 'D07-01', personal: true, roles: COST_READ_ROLES },
  { name: 'costProjectCreate', method: 'POST', path: '/api/cost/projects', summary: '산정 과제 만들기', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: CreateCostProjectBody },
  { name: 'costProject', method: 'GET', path: '/api/cost/projects/:estId', summary: '산정 과제 상세·계산 결과(금액은 산정 역할만)', component: 'D07-01', personal: true, roles: COST_READ_ROLES, sample: { estId: 'EST-0001' } },
  { name: 'costProjectUpdate', method: 'PATCH', path: '/api/cost/projects/:estId', summary: '산정 과제 설정 수정', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: UpdateCostProjectBody },
  { name: 'costFeatureAdd', method: 'POST', path: '/api/cost/projects/:estId/features', summary: 'Feature 담기', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: AddCostFeatureBody },
  { name: 'costFeatureRemove', method: 'DELETE', path: '/api/cost/projects/:estId/features/:featureId/:version', summary: 'Feature 빼기', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: EmptyBody },
  { name: 'costLineUpdate', method: 'PATCH', path: '/api/cost/projects/:estId/lines/:lineNo', summary: '줄 입력', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: UpdateCostLineBody },
  { name: 'costMbdPut', method: 'PUT', path: '/api/cost/projects/:estId/mbd/:refId', summary: 'MBD 작업 행 바꾸기', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: PutCostMbdBody },
  { name: 'costTransition', method: 'POST', path: '/api/cost/projects/:estId/transitions', summary: '제출·승인·반려·개정 — 작성자와 승인자는 서로 다른 사람', component: 'D07-01', roles: ['COST_ESTIMATOR', 'COST_APPROVER'], body: CostTransitionBody },
  { name: 'costCheckPut', method: 'PUT', path: '/api/cost/projects/:estId/checks/:no', summary: '검토 체크리스트 항목', component: 'D07-01', roles: ['COST_ESTIMATOR', 'COST_APPROVER'], body: PutCostCheckBody },
  { name: 'costExport', method: 'GET', path: '/api/cost/projects/:estId/export', summary: '엑셀 내보내기(감사 COST_EXPORT)', component: 'D07-01', personal: true, roles: ['COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN'] },
  { name: 'costBasisList', method: 'GET', path: '/api/cost/basis', summary: '계수·단가 표 버전 목록', component: 'D07-01' },
  { name: 'costActualPut', method: 'PUT', path: '/api/cost/projects/:estId/actuals/:refId', summary: '승인 뒤 실적 공수', component: 'D07-01', roles: ['COST_ESTIMATOR'], body: PutCostActualBody },
  { name: 'costCalibration', method: 'GET', path: '/api/cost/calibration', summary: '교정 제안·실적 오차', component: 'D07-01', personal: true, roles: [...COST_MONEY_ROLES] },
  { name: 'costBasis', method: 'GET', path: '/api/cost/basis/:version', summary: '계수·단가 표 한 버전(산정 역할만)', component: 'D07-01', personal: true, sample: { version: 'v1.3' }, roles: ['COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN'] },
  { name: 'costBasisDraft', method: 'POST', path: '/api/cost/basis', summary: '계수·단가 표 초안', component: 'D07-01', roles: ['COST_BASIS_ADMIN'], body: CostBasisDraftBody },
  { name: 'costBasisPublish', method: 'POST', path: '/api/cost/basis/:version/publish', summary: '계수·단가 표 발행', component: 'D07-01', roles: ['COST_BASIS_ADMIN'], body: ReasonBody },
  { name: 'referenceValues', method: 'GET', path: '/api/reference-values', summary: '고객 기준 값(판매국·지역·차종·트림) — 등록·사용 중지 상태, 시드(SEED)·고객(CUSTOMER) 구분', component: 'D02-01', query: ['kind'] },
  { name: 'createReferenceValue', method: 'POST', path: '/api/reference-values', summary: '기준 값 등록 — 차량 사양 담당자, 지역·트림은 부모(판매국·차종)가 먼저', component: 'D02-01', roles: ['VARIANT_OWNER'], body: ReferenceValueBody },
  { name: 'retireReferenceValue', method: 'POST', path: '/api/reference-values/:kind/:code/retire', summary: '기준 값 사용 중지 — 이미 쓰인 기록은 그대로, 새 차량 등록·선택지에서 빠진다', component: 'D02-01', roles: ['VARIANT_OWNER'], body: ReferenceRetireBody },
  // 개인정보(출시 준비 RD-P2-05) — 목록·내보내기·삭제/가명 처리 요청(요청자와 다른 담당자가 실행)
  { name: 'privacyInventory', method: 'GET', path: '/api/privacy/inventory', summary: '개인정보 목록 — 저장소·칸·정보주체·처리 방법·보존 기한(설치 설정 반영)', component: 'KERNEL' },
  { name: 'privacyExport', method: 'POST', path: '/api/privacy/export', summary: '정보주체 내보내기(JSON) — 개인정보 목록의 모든 저장소에서 그 사용자·차량의 행(감사 기록, 식별자 대신 가명)', component: 'KERNEL', roles: ['SECURITY_OFFICER'], body: PrivacyExportBody },
  { name: 'privacyRequests', method: 'GET', path: '/api/privacy/requests', summary: '삭제·가명 처리 요청 — 상태·대상 행 수·처리 결과(처리 뒤에는 가명만)', component: 'KERNEL', roles: ['SECURITY_OFFICER', 'AUDITOR'] },
  { name: 'createPrivacyRequest', method: 'POST', path: '/api/privacy/requests', summary: '삭제·가명 처리 요청 — 저장소별 대상 행 수를 미리 센다', component: 'KERNEL', roles: ['SECURITY_OFFICER'], body: ErasureRequestBody },
  { name: 'executePrivacyRequest', method: 'POST', path: '/api/privacy/requests/:id/execute', summary: '삭제·가명 처리 실행 — 요청자와 다른 보안 담당자, 감사 체인 검증 유지, 차량은 Data Lake 삭제 요청', component: 'KERNEL', roles: ['SECURITY_OFFICER'], body: ErasureExecuteBody },
  { name: 'rejectPrivacyRequest', method: 'POST', path: '/api/privacy/requests/:id/reject', summary: '삭제·가명 처리 요청 거절 — 사유 필수, 대상 식별자를 지운다', component: 'KERNEL', roles: ['SECURITY_OFFICER'], body: ErasureRejectBody },
  { name: 'securityEvents', method: 'GET', path: '/api/security-events', summary: '보안 이벤트(IdsM) 기록·정의 — 임계값 도달 시 VSOC 경보, 진위 실패는 채널 제한(FFG-SEC-007)', component: 'D06-12', query: ['eventId'], dataCategory: 'SECURITY_MONITORING', roles: [...DATA_CATEGORY_ACCESS.SECURITY_MONITORING] },
  { name: 'sumsRecords', method: 'GET', path: '/api/sums', summary: 'SUMS 기록 — 명령별 RXSWIN·형식승인 영향 평가·사용자 고지·결과, 보존 기간(FFG-LCY-008)', component: 'D06-08', query: ['featureId'] },
  { name: 'reharaRequests', method: 'GET', path: '/api/rehara-requests', summary: '재-HARA 요청 (보고서 6.4 조건 자동 검출) — FFG-LCY-003', component: 'D06-05', query: ['featureId', 'featureVersion', 'status'] },
  { name: 'virtualCombinations', method: 'GET', path: '/api/virtual-validations/combinations', summary: 'Feature 조합 시험 계획 (Topology 허용 조합, 3-way covering array, 금지 조합 부정 시험) — FFG-TST-003', component: 'D06-03', query: ['featureId'] },
  { name: 'virtualRuns', method: 'GET', path: '/api/virtual-validations', summary: '가상검증 실행 이력', component: 'D06-03', query: ['policyId', 'featureId', 'featureVersion'] },
  { name: 'runVirtual', method: 'POST', path: '/api/virtual-validations', summary: '정책을 CARLA 가상 차량에 적용해 시나리오 실행 (판정·Evidence)', component: 'D06-03', roles: ['FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE'], body: RunVirtualBody },
  { name: 'virtualRunDetail', method: 'GET', path: '/api/virtual-validations/:id', summary: '가상검증 결과 (기준별 판정·Evidence 해시·TMS)', component: 'D06-03' },
  { name: 'virtualRunFile', method: 'GET', path: '/api/virtual-validations/:id/files/:name', summary: '가상검증 Evidence 파일 (보고서·텔레메트리)', component: 'D06-03' },
  { name: 'submitTms', method: 'POST', path: '/api/virtual-validations/:id/tms', summary: 'IF-09 TMS Evidence 제출 (G5 근거)', component: 'D04-02', roles: ['GATE_JUDGE', 'IMPLEMENTER'], body: EmptyBody },
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
  { name: 'iamSodAudit', method: 'GET', path: '/api/iam/sod-audit', summary: '직무 분리 감사 — 요구 승인·출시·Kill 실행·복원 승인 겸직 계정, 긴급 권한 사후 검토 현황(FFG-PLT-016)', component: 'D06-09' },
  { name: 'killPostReviews', method: 'GET', path: '/api/kill-post-reviews', summary: '발행된 Kill(긴급 권한)마다 24시간 사후 독립 검토 기한·기록', component: 'D06-09' },
  { name: 'recordKillPostReview', method: 'POST', path: '/api/kill-requests/:id/post-review', summary: '긴급 권한 사후 독립 검토 기록 — 요청자·승인자 제외, 한 번(FFG-PLT-016). 품질(내부감사)이 수행한다(2026-11-04)', component: 'D06-09', roles: ['AUDITOR', 'SECURITY_OFFICER', 'SAFETY_OFFICER', 'REGULATORY_OWNER'], body: PostReviewBody },
  { name: 'iamMe', method: 'GET', path: '/api/iam/me', summary: '현재 행위자·허용 작업', component: 'D06-09' },
  { name: 'variantMatrix', method: 'GET', path: '/api/variants/:featureId/:version', summary: 'Variant·지원 조건 × Fleet 매트릭스', component: 'D02-01' },
  { name: 'vehicleSupport', method: 'GET', path: '/api/support/:vin', summary: '차량별 배포 Feature 지원 여부', component: 'D02-02' },
  // 42 컴포넌트 활동 (아키텍처 화면)
  { name: 'componentActivity', method: 'GET', path: '/api/components/activity', summary: '컴포넌트별 최근 활동 (이벤트·감사)', component: 'KERNEL', query: ['minutes'] },
  // P10 — 실험·효과(D01-07)
  { name: 'experiments', method: 'GET', path: '/api/experiments', summary: '실험 목록 (A/B·Shadow)', component: 'D01-07', query: ['policyId', 'status'] },
  { name: 'experiment', method: 'GET', path: '/api/experiments/:id', summary: '실험 상세 + 효과 추정', component: 'D01-07' },
  { name: 'createExperiment', method: 'POST', path: '/api/experiments', summary: '실험 등록 — F2 이상은 Shadow만 (FFG-CLS-006)', component: 'D01-07', roles: ['FEATURE_AUTHOR', 'RELEASE_MANAGER'], body: CreateExperimentBody },
  { name: 'startExperiment', method: 'POST', path: '/api/experiments/:id/start', summary: '실험 시작', component: 'D01-07', roles: ['RELEASE_MANAGER'], body: EmptyBody },
  { name: 'concludeExperiment', method: 'POST', path: '/api/experiments/:id/conclude', summary: '실험 종료·결정 (채택·기각·연장)', component: 'D01-07', roles: ['RELEASE_MANAGER'], body: ConcludeExperimentBody },
  // 장애·VOC(D04-05)
  { name: 'incidents', method: 'GET', path: '/api/incidents', summary: '현장 장애·VOC 이력', component: 'D04-05', query: ['status', 'featureId', 'source'] },
  { name: 'createIncident', method: 'POST', path: '/api/incidents', summary: '장애·VOC 접수 — SOTIF 트리거면 이상 징후로 (FFG-SOT-003)', component: 'D04-05', roles: ['OPERATOR', 'SYSTEM'], body: CreateIncidentBody },
  { name: 'importVoc', method: 'POST', path: '/api/incidents/import-voc', summary: '고객센터 VOC 가져오기 (모의 원천)', component: 'D04-05', roles: ['OPERATOR', 'SYSTEM'], body: EmptyBody },
  // 데이터 동기화(D05-02 · IF-02·03·12)
  { name: 'syncTargets', method: 'GET', path: '/api/sync/targets', summary: '동기화 대상 (시장 구분 — CN 국외 이전 보류, FFG-TEL-005)', component: 'D05-02' },
  { name: 'syncRuns', method: 'GET', path: '/api/sync/runs', summary: '동기화·대사 실행 이력', component: 'D05-02', query: ['targetId'] },
  { name: 'runSync', method: 'POST', path: '/api/sync/runs', summary: '동기화·대사 실행', component: 'D05-02', roles: ['OPERATOR', 'SYSTEM', 'VARIANT_OWNER'], body: RunSyncBody },
  // Legacy 연계(D05-03 · IF-12)
  { name: 'legacyMappings', method: 'GET', path: '/api/legacy/mappings', summary: '레거시 옵션 코드 ↔ FEAT 매핑', component: 'D05-03' },
  { name: 'legacyOrders', method: 'GET', path: '/api/legacy/orders', summary: '해외공장 주문 해석 결과', component: 'D05-03', query: ['plant'] },
  { name: 'importPlantOrders', method: 'POST', path: '/api/legacy/orders/import', summary: '해외공장 주문 가져오기 (IF-12) → 옵션 코드 해석', component: 'D05-03', roles: ['OPERATOR', 'SYSTEM'], body: ImportOrdersBody },
  // Legacy-SDV(D05-07)
  { name: 'legacyVehicles', method: 'GET', path: '/api/legacy-sdv/vehicles', summary: '비SDV(레거시) 차량', component: 'D05-07' },
  { name: 'translateLegacy', method: 'POST', path: '/api/legacy-sdv/translate', summary: 'Feature 켜기·끄기 → 딜러 코딩 계획 (F2 이상 거부)', component: 'D05-07', roles: ['OPERATOR', 'VARIANT_OWNER'], body: TranslateLegacyBody },
  // 현장 지원 포털(D05-05)
  { name: 'fieldVehicle', method: 'GET', path: '/api/field/vehicles/:vin', summary: '현장 지원 — 차량 종합 조회', component: 'D05-05', sample: { vin: 'ego-01' } },
  { name: 'createFieldCase', method: 'POST', path: '/api/field/cases', summary: '현장 접수 → 장애·VOC(D04-05)', component: 'D05-05', roles: ['OPERATOR'], body: FieldCaseBody },
  // 외부 연계 모의 어댑터
  { name: 'integrationSystems', method: 'GET', path: '/api/integrations/systems', summary: 'IF-01~14 연결 현황 (모의·실연동·호출 수)', component: 'D05-01' },
  { name: 'almRequirements', method: 'GET', path: '/api/integrations/alm/requirements', summary: 'IF-01 ALM 요구사항 (Feature Version별)', component: 'D01-01', query: ['featureId', 'version'], sample: { featureId: 'FEAT-00022', version: '1.0.0' } },
  { name: 'supplierDeliveries', method: 'GET', path: '/api/integrations/supplier/deliveries', summary: 'IF-08 협력사 SW 납품', component: 'D05-01', query: ['supplier'] },
  { name: 'grafanaAlertWebhook', method: 'POST', path: '/api/webhooks/grafana/alerts', summary: 'Grafana 경보 webhook 수신 — 토큰·HMAC 확인, 중복 버림, 운영 관찰(개선 후보) 기록·이상 징후 신호(80-80)', component: 'D04-03', body: z.record(z.string(), z.unknown()), public: true },
  { name: 'opsObservations', method: 'GET', path: '/api/ops/observations', summary: 'Grafana 경보로 들어온 운영 관찰(개선 후보) — Feature·축·상태로 거르기', component: 'D04-03', query: ['featureId', 'axis', 'status', 'limit'] },
  { name: 'otelSpans', method: 'GET', path: '/api/integrations/otel/spans', summary: 'IF-11 OpenTelemetry 수집기 (모의) — 평가·이벤트 span', component: 'D04-03', query: ['name', 'limit'] },
  // GitLab · JIRA · codeBeamer 양방향 연계(IF-13·IF-14·IF-01) — 주인 규칙 contracts/rules/ext-sync
  { name: 'extSync', method: 'GET', path: '/api/integrations/sync', summary: '양방향 연계 현황 — 시스템별 연결·보내는 중·실패·충돌·거부, 주인 규칙', component: 'D05-01' },
  { name: 'extFeatureTrace', method: 'GET', path: '/api/integrations/sync/features/:id/:ver', summary: 'Feature 버전 추적 — 요구(codeBeamer)·Epic·CR(JIRA)·MR·파이프라인(GitLab)·정책', component: 'D05-01', sample: { id: 'FEAT-00022', ver: '1.0.0' } },
  { name: 'extFeatureEpics', method: 'GET', path: '/api/integrations/sync/epics', summary: 'Feature 버전별 JIRA Epic — 키·상태·동기 상태·플랫폼 Lifecycle 기준 상태(목록 화면용 한 번 조회)', component: 'D05-01' },
  { name: 'extChangeRequests', method: 'GET', path: '/api/integrations/sync/change-requests', summary: 'JIRA 변경요청(CR)과 연결된 정책 상태', component: 'D05-01' },
  { name: 'extConflicts', method: 'GET', path: '/api/integrations/sync/conflicts', summary: '동기화 충돌 — 양쪽 값, 처리 결과', component: 'D05-01', query: ['status'] },
  { name: 'resolveExtConflict', method: 'POST', path: '/api/integrations/sync/conflicts/:id/resolve', summary: '충돌 처리 — 플랫폼 값 다시 보내기 / 외부 값을 요청으로 다시 시도(가드 적용)', component: 'D05-01', roles: ['IMPLEMENTER', 'RELEASE_MANAGER', 'FEATURE_APPROVER'], body: ResolveConflictBody },
  { name: 'extOutbox', method: 'GET', path: '/api/integrations/sync/outbox', summary: '보낼 함 — 외부 쓰기 작업(대기·완료·실패·충돌)', component: 'D05-01', query: ['system', 'status'] },
  { name: 'extInbox', method: 'GET', path: '/api/integrations/sync/inbox', summary: '받은 함 — 외부 변경과 처리 결과(반영·거부·매핑 없음)', component: 'D05-01', query: ['system', 'outcome'] },
  { name: 'drainExtSync', method: 'POST', path: '/api/integrations/sync/drain', summary: '보낼 함 지금 보내기', component: 'D05-01', roles: ['SYSTEM', 'IMPLEMENTER'], body: EmptyBody },
  { name: 'policyExtLinks', method: 'GET', path: '/api/policies/:id/ext-links', summary: '정책에 연결된 외부 항목(JIRA CR)', component: 'D05-01', sample: { id: 'POL-00001' } },
  { name: 'linkPolicyChangeRequest', method: 'POST', path: '/api/policies/:id/change-request', summary: '정책 ↔ 근거 JIRA CR 연결', component: 'D05-01', roles: ['FEATURE_AUTHOR', 'RELEASE_MANAGER'], body: LinkChangeRequestBody },
  { name: 'extWebhook', method: 'POST', path: '/api/webhooks/:system', summary: '외부 webhook 수신(gitlab·jira·codebeamer) — 서명 확인 후 주인 규칙으로 처리', component: 'D05-01', body: z.record(z.string(), z.unknown()), public: true },
  { name: 'mockExtItems', method: 'GET', path: '/api/integrations/mock/:system/items', summary: '모의 외부 시스템 항목(실서버 없을 때)', component: 'D05-01', query: ['kind'], sample: { system: 'jira' } },
  { name: 'mockExtAct', method: 'POST', path: '/api/integrations/mock/:system/act', summary: '모의 외부 시스템에서 사람이 한 일 — 상태 변경·편집·병합·파이프라인(webhook으로 들어옴)', component: 'D05-01', roles: HUMAN_ROLES, body: MockExtActionBody },
  { name: 'mockExtCreate', method: 'POST', path: '/api/integrations/mock/:system/items', summary: '모의 외부 시스템에 항목 만들기(CR·MR·요구)', component: 'D05-01', roles: HUMAN_ROLES, body: MockExtCreateBody },
  // P10-B OpenFeature — 범위·flagd 내보내기·매니페스트(D05-01), 차량 내장 provider(D02-03)
  { name: 'openfeatureScope', method: 'GET', path: '/api/openfeature/scope', summary: 'OpenFeature 반영 범위 (OF-1~7·경계·SDK 고정·flag 목록)', component: 'D05-01' },
  { name: 'openfeatureFlagd', method: 'GET', path: '/api/openfeature/flagd', summary: 'flagd 내보내기 — F0·F1만, defaultVariant=off (FFG-OFT-005·002)', component: 'D05-01' },
  { name: 'openfeatureManifest', method: 'GET', path: '/api/openfeature/manifest', summary: 'OF-7 flag 매니페스트(OpenFeature CLI) + 기본값 규율', component: 'D05-01' },
  { name: 'vehicleOpenFeature', method: 'GET', path: '/api/vehicles/:vin/openfeature', summary: 'OF-6 차량 내장 provider 평가 — IVI 앱용, F2 이상은 기본값·DISABLED', component: 'D02-03', sample: { vin: 'ego-01' } },
  // P10-C4 기준정보·추적 조회(레거시 기준정보 화면 → v2)
  { name: 'masterEcu', method: 'GET', path: '/api/master/ecu', summary: 'ECU 마스터 (+ 탑재 SW·Feature 수)', component: 'D01-02' },
  { name: 'masterSw', method: 'GET', path: '/api/master/sw', summary: 'SW·Artifact 마스터 (+ 쓰는 Feature)', component: 'D01-02', query: ['ecuPno', 'q'] },
  { name: 'masterStructure', method: 'GET', path: '/api/master/structure', summary: 'SW 구조 — ECU → SW → Function → Feature', component: 'D01-02' },
  { name: 'masterUpg', method: 'GET', path: '/api/master/upg', summary: 'UPG-VC — 지원 Feature·Fleet 차량', component: 'D01-02' },
  { name: 'masterControlPoints', method: 'GET', path: '/api/master/control-points', summary: '제어점 — Control Point와 정책 flag 묶음(BD-06)', component: 'D01-02' },
  { name: 'masterTaxonomy', method: 'GET', path: '/api/master/taxonomy', summary: 'Taxonomy — 태그·범위별 Feature', component: 'D01-02' },
  { name: 'designTrace', method: 'GET', path: '/api/trace/:id/:ver', summary: '요구·안전 추적 — 요구 → Function → SW → ECU, Gate·Evidence, 안전 분류', component: 'D01-02', sample: { id: 'FEAT-00022', ver: '1.0.0' } },
  { name: 'evidenceLedger', method: 'GET', path: '/api/evidence', summary: 'Evidence 원장 (Gate 판정 Evidence) — 이관 기록 + 플랫폼 판정, ref는 Evidence Ref 일부', component: 'D04-02', query: ['featureId', 'gate', 'result', 'ref'] },
  { name: 'versionChanges', method: 'GET', path: '/api/changes', summary: '변경 이력 — Version 변경 사유(변경요청)', component: 'D01-01', query: ['featureId'] },
  // 대시보드(Jira식 가젯 판) — 내가 만든 것과 내 역할에 공유된 것. 소유자만 바꾸고 지운다, 버전 충돌은 412(If-Match)
  { name: 'listDashboards', method: 'GET', path: '/api/dashboards', summary: '내 대시보드 목록 — 내가 만든 것·내 역할에 공유된 것(즐겨찾기는 보는 사람 기준)', component: 'KERNEL', personal: true },
  { name: 'getDashboard', method: 'GET', path: '/api/dashboards/:id', summary: '대시보드 하나 — 판(레이아웃·가젯 설정)·버전(ETag)', component: 'KERNEL', personal: true },
  { name: 'createDashboard', method: 'POST', path: '/api/dashboards', summary: '대시보드 만들기(소유자 = 요청자)', component: 'KERNEL', roles: HUMAN_ROLES, body: DashboardCreateBody },
  { name: 'updateDashboard', method: 'PUT', path: '/api/dashboards/:id', summary: '대시보드 바꾸기 — 이름·판·공유 역할, 소유자만, If-Match 버전이 다르면 412', component: 'KERNEL', roles: HUMAN_ROLES, body: DashboardUpdateBody },
  { name: 'deleteDashboard', method: 'DELETE', path: '/api/dashboards/:id', summary: '대시보드 지우기 — 소유자만, If-Match 버전', component: 'KERNEL', roles: HUMAN_ROLES, body: DashboardDeleteBody },
  { name: 'favouriteDashboard', method: 'PUT', path: '/api/dashboards/:id/favourite', summary: '대시보드 즐겨찾기(별) — 보는 사람별', component: 'KERNEL', roles: HUMAN_ROLES, body: DashboardFavouriteBody },
  // 검토함 대기열(W2) — 정의 승인(PROPOSED·G1~G3 PASS)·Release Sign-off 대기·출시 가능·Gate 판정 대기·안전 분류 확정, 요청 시각 포함
  { name: 'workQueues', method: 'GET', path: '/api/work-queues', summary: '검토함 대기열 — 정의 승인·Release Sign-off·출시 가능·Gate 판정·안전 분류 확정 대기(요청 시각·작성자)', component: 'D01-01' },
  // 검토 포털 협의 요청(W5, P5-1) — 요청 부서가 구매·법무·개인정보보호에 의견을 구하고, 포털 부서가 동의·보완·반대 의견을 남긴다(감사 CONSULT_*)
  { name: 'listConsultations', method: 'GET', path: '/api/consultations', summary: '협의 요청 목록 — 받는 부서(to)·요청 부서(from)·상태 필터, 의견 대기·기한 순', component: 'D04-04', query: ['to', 'from', 'status'] },
  { name: 'consultationDetail', method: 'GET', path: '/api/consultations/:id', summary: '협의 요청 한 건 — 대상·살펴볼 것·기한·의견 이력', component: 'D04-04' },
  { name: 'createConsultation', method: 'POST', path: '/api/consultations', summary: '협의 요청 만들기 — 업무 절차에서 받는 부서가 협의(C)·통보(I)인 활동 근거, 대상·기한·살펴볼 것', component: 'D04-04', roles: [...REFDB_CHANGE_REQUESTERS, 'AUDITOR'], body: CreateConsultationBody },
  // 포털 부서(구매·법무·개인정보보호)는 플랫폼 역할이 없어 조회 계정(AUDITOR)으로 들어온다 — 요청·의견은 운영 상태를 바꾸지 않는 협의 기록이다
  { name: 'answerConsultation', method: 'POST', path: '/api/consultations/:id/opinions', summary: '협의 의견 — 받은 포털 부서가 동의·보완·반대 + 메모(요청자 본인은 불가)', component: 'D04-04', roles: [...REFDB_CHANGE_REQUESTERS, 'AUDITOR'], body: AnswerConsultationBody },
  // Feature DB 운영 보강(W5) — 발행 미리 보기(P5-4)·변경 요청 감사 이력(P5-6)
  { name: 'refReleasePreview', method: 'GET', path: '/api/refdb/releases/preview', summary: 'Feature DB 발행 미리 보기 — 다음 버전에 묶일 승인 요청·반려로 폐기될 요청 중 행·알림 받을 Feature Owner·품질 지표 변화', component: 'D01-01' },
  { name: 'refChangeAudit', method: 'GET', path: '/api/refdb/changes/:id/audit', summary: 'Feature DB 변경 요청 감사 이력 — 요청·추가 요청·검토·결정·발행 기록을 시간 순으로(금액 값은 남기지 않음)', component: 'D01-01' },
  // 분석 근거(W3, P3-3) — HARA·TARA·SOTIF·형식승인 영향을 담당 역할이 개인 서명으로 남기고, G2·G7이 본다. G7은 SM·CSM 두 사람 서명
  { name: 'analysisEvidence', method: 'GET', path: '/api/features/:id/versions/:ver/analysis', summary: '분석 근거 — 종류별 지금 기록·이력, 보안 관련 여부, 대표 ASIL 변경 사유, G7 서명', component: 'D01-02' },
  { name: 'recordHara', method: 'POST', path: '/api/features/:id/versions/:ver/analysis/hara', summary: 'HARA 기록 — 안전 목표·ASIL, Safety Manager 개인 서명(추가만)', component: 'D01-02', roles: ['SAFETY_OFFICER'], body: HaraBody },
  { name: 'recordTara', method: 'POST', path: '/api/features/:id/versions/:ver/analysis/tara', summary: 'TARA 기록 — 위협 시나리오·CAL, CSM 개인 서명(추가만)', component: 'D01-02', roles: ['SECURITY_OFFICER'], body: TaraBody },
  { name: 'recordSotif', method: 'POST', path: '/api/features/:id/versions/:ver/analysis/sotif', summary: 'SOTIF 기록 — 유발 조건, 아키텍트 개인 서명(추가만)', component: 'D01-02', roles: ['IMPLEMENTER'], body: SotifBody },
  { name: 'recordHomologation', method: 'POST', path: '/api/features/:id/versions/:ver/analysis/homologation', summary: '형식승인 영향 판단 — 영향 규정·판단, 법규 담당 개인 서명(추가만)', component: 'D01-02', roles: ['REGULATORY_OWNER'], body: HomologationBody },
  { name: 'signG7Safety', method: 'POST', path: '/api/features/:id/versions/:ver/analysis/g7-safety', summary: 'G7 기능안전 서명 — Safety Manager, 지금 HARA에 묶임', component: 'D01-02', roles: ['SAFETY_OFFICER'], body: G7SignoffBody },
  { name: 'signG7Security', method: 'POST', path: '/api/features/:id/versions/:ver/analysis/g7-security', summary: 'G7 사이버보안 서명 — CSM, 지금 TARA에 묶임(기능안전 서명과 다른 사람)', component: 'D01-02', roles: ['SECURITY_OFFICER'], body: G7SignoffBody },
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
  for (const k of r.requiredQuery ?? []) {
    const v = query[k];
    if (v === undefined || v === null || v === '') throw new Error(`${name}: 필수 질의 ${k} 누락 — 화면 조회는 값이 준비될 때까지 enabled: false로 둔다`);
  }
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

/** 스냅샷 파일 이름 길이 상한 — 설치 경로(데스크톱 NSIS·Windows 260자)까지 더해도 넘지 않게 */
export const SNAPSHOT_NAME_MAX = 120;

/** URL 전체의 짧은 해시(cyrb53, 16진) — 브라우저·Node 어디서나 같은 값(동기, 의존성 없음) */
function urlHash(s: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * 정적 데모 스냅샷 파일 이름 — 파일 시스템·정적 호스팅에서 안전한 문자만 남긴다.
 * 긴 질의(Feature DB 도메인·컴포넌트 이름 등)는 앞부분 + URL 전체 해시로 줄인다 — 같은 앞부분의 다른 URL도 갈린다.
 */
export function snapshotFile(url: string): string {
  const safe = url.replace(/^\/api\//, '').replace(/[^A-Za-z0-9._-]/g, '_');
  const name = safe.length <= SNAPSHOT_NAME_MAX ? safe : `${safe.slice(0, SNAPSHOT_NAME_MAX - 15)}~${urlHash(url)}`;
  return 'api-snapshot/' + name + '.json';
}
