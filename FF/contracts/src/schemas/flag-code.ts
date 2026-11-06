// Flag 코드 연결·대사·통제 계약(20-97). 저장소 연결·스캔 실행·Flag PR·출시 차단 해제·평가 지표·대사 결과.
// 스캔 결과는 FF 스캐너 서명 또는 GitHub Actions OIDC로 출처를 확인한다. 자격 증명·webhook 비밀은 본문에 넣지 않는다.
import { z } from 'zod';
import { ControlPointType, LIFECYCLE } from '../enums';
import { PolicyStatus } from './policy';
import { PublicationStatus } from './ops';
import { EVAL_FALLBACK_REASONS, EVAL_SOURCES } from '../rules/evaluation-stats';
import { FlagSourceLocation, FlagSourceMethod, FlagSourcePath, FlagSourceProvider, FlagSourceRepository, FlagSourceUsage } from './flag-source';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const iso = z.string().datetime({ offset: true });
const commit = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, '축약하지 않은 소문자 Git 커밋 해시를 쓰세요.');
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const FlagKey = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, 'flagKey는 소문자·숫자·밑줄 3~64자');
const FeatureId = z.string().regex(/^FEAT-\d{5}$/);
const Semver = z.string().regex(/^\d+\.\d+\.\d+$/);
/** Git 브랜치 이름 — 공백·제어 문자·`..`·`~^:?*[\` 금지(git check-ref-format 축약) */
export const GitBranch = z.string().min(1).max(200).refine((s) => !/[\s\x00-\x1f\x7f~^:?*[\\]|\.\.|^\/|\/$|\.lock$|@\{/.test(s), 'Git 브랜치 이름 형식이 아닙니다.');

// ── 저장소 패키지(도메인 폴더) ─────────────────────────────
/** 차량 SW 저장소의 도메인 패키지 — packages/<이름>. 다중 저장소로 늘려도 같은 이름을 쓴다 */
export const FLAG_PACKAGES = ['adas', 'ivi', 'body', 'chassis', 'powertrain', 'safety', 'connectivity', 'platform'] as const;
export const FlagPackage = z.enum(FLAG_PACKAGES);
export type FlagPackage = z.infer<typeof FlagPackage>;

// ── 저장소 연결 ──────────────────────────────────────────
export const FlagScanTrigger = z.enum(['PUSH', 'PULL_REQUEST', 'SCHEDULE', 'MANUAL', 'CI_UPLOAD', 'DEMO_SEED']);
export const FlagScanStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED']);
export type FlagScanStatus = z.infer<typeof FlagScanStatus>;
/** GITHUB_APP: FF GitHub App 설치(webhook·서버 스캔·Check Run·PR 생성). ACTIONS_OIDC: CI가 스캔해 OIDC로 올림(PR 생성 없음). DEMO_MIRROR: 시연용 로컬 Git 미러·모의 webhook */
export const FlagRepoMode = z.enum(['GITHUB_APP', 'ACTIONS_OIDC', 'DEMO_MIRROR']);
export type FlagRepoMode = z.infer<typeof FlagRepoMode>;
export const FlagWebhookState = z.enum(['ACTIVE', 'FAILING', 'DISABLED', 'NOT_CONFIGURED']);
export const FlagRepoPackage = z.object({ name: FlagPackage, path: FlagSourcePath }).strict();

export const FlagRepository = z.object({
  repoId: z.string().regex(/^FREPO-\d{3,}$/),
  provider: FlagSourceProvider,
  repository: FlagSourceRepository,
  displayName: text(1, 80),
  mode: FlagRepoMode,
  defaultBranch: GitBranch,
  scanPaths: z.array(FlagSourcePath).max(50),
  packages: z.array(FlagRepoPackage).max(20),
  /** 0 = webhook만, 아니면 주기 재스캔(분) */
  scanIntervalMinutes: z.number().int().min(0).max(1440),
  status: z.enum(['ACTIVE', 'PAUSED']),
  /** GitHub App 설치 번호 — 비밀이 아니다. 앱 개인키·webhook 비밀은 서버 설정(FF_GITHUB_APP_*)에만 둔다 */
  installationId: z.number().int().positive().nullable(),
  webhook: z.object({
    state: FlagWebhookState,
    lastDeliveryId: z.string().nullable(),
    lastDeliveryAt: iso.nullable(),
    failureCount: z.number().int().min(0),
    lastError: z.string().nullable(),
  }).strict(),
  lastScan: z.object({ scanId: z.string(), commit, at: iso, status: FlagScanStatus }).strict().nullable(),
  createdAt: iso,
  createdBy: z.string(),
}).strict();
export type FlagRepository = z.infer<typeof FlagRepository>;

export const CreateFlagRepositoryBody = z.object({
  repository: FlagSourceRepository,
  displayName: text(1, 80),
  mode: FlagRepoMode,
  defaultBranch: GitBranch.default('main'),
  scanPaths: z.array(FlagSourcePath).max(50).default([]),
  packages: z.array(FlagRepoPackage).min(1).max(20),
  scanIntervalMinutes: z.number().int().min(0).max(1440).default(0),
  installationId: z.number().int().positive().nullable().default(null),
}).strict().superRefine((b, ctx) => {
  if (b.mode === 'GITHUB_APP' && b.installationId == null) ctx.addIssue({ code: 'custom', path: ['installationId'], message: 'GitHub App 연결은 설치 번호가 필요합니다.' });
  if (b.scanIntervalMinutes > 0 && b.scanIntervalMinutes < 15) ctx.addIssue({ code: 'custom', path: ['scanIntervalMinutes'], message: '주기 재스캔은 15분 이상입니다.' });
  if (new Set(b.packages.map((p) => p.name)).size !== b.packages.length) ctx.addIssue({ code: 'custom', path: ['packages'], message: '같은 패키지를 두 번 연결할 수 없습니다.' });
});
export type CreateFlagRepositoryBody = z.infer<typeof CreateFlagRepositoryBody>;

export const UpdateFlagRepositoryBody = z.object({
  displayName: text(1, 80).optional(),
  defaultBranch: GitBranch.optional(),
  scanPaths: z.array(FlagSourcePath).max(50).optional(),
  scanIntervalMinutes: z.number().int().min(0).max(1440).optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  reason: text(2, 500),
}).strict().refine((b) => Object.keys(b).some((k) => k !== 'reason'), '바꿀 항목을 하나 이상 고르세요.');
export type UpdateFlagRepositoryBody = z.infer<typeof UpdateFlagRepositoryBody>;

// ── 스캔 ────────────────────────────────────────────────

/** 정적으로 풀지 못한 SDK 호출(동적 키) — 파일·줄·호출식 */
export const FlagUnresolvedCall = z.object({ path: FlagSourcePath, line: z.number().int().min(1), symbol: z.string().min(1).max(500), method: FlagSourceMethod }).strict();
export type FlagUnresolvedCall = z.infer<typeof FlagUnresolvedCall>;

/** 스캐너 v2 — v1에 브랜치·동적 키 위치를 더하고, 모듈 최상위 문자열 상수(같은 파일·상대 import)를 키로 푼다 */
export const FlagSourceManifestV2 = z.object({
  format: z.literal('ff-flag-source/v2'),
  provider: FlagSourceProvider,
  repository: FlagSourceRepository,
  ref: GitBranch,
  commit: z.string().regex(/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/).transform((s) => s.toLowerCase()),
  scannedAt: iso.transform((s) => new Date(s).toISOString()),
  scanner: z.object({ name: z.literal('ff-flag-scan'), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
  filesScanned: z.number().int().min(0).max(20_000),
  usages: z.array(FlagSourceUsage.extend({ via: z.enum(['LITERAL', 'CONST']) }).strict()).max(100_000),
  unresolved: z.array(FlagUnresolvedCall).max(100_000),
}).strict().superRefine((m, ctx) => {
  const files = new Map<string, string>();
  for (const [i, u] of m.usages.entries()) {
    const prior = files.get(u.path);
    if (prior && prior !== u.contentHash) ctx.addIssue({ code: 'custom', path: ['usages', i, 'contentHash'], message: '같은 파일의 내용 해시가 서로 다릅니다.' });
    files.set(u.path, u.contentHash);
  }
  const touched = new Set([...files.keys(), ...m.unresolved.map((u) => u.path)]);
  if (touched.size > m.filesScanned) ctx.addIssue({ code: 'custom', path: ['filesScanned'], message: '사용처 파일 수보다 스캔한 파일 수가 작습니다.' });
});
export type FlagSourceManifestV2 = z.infer<typeof FlagSourceManifestV2>;

/** 스캔 결과의 출처 — FF 스캐너 서명(Ed25519, 페이로드는 flagScanSigningPayload) 또는 GitHub Actions OIDC 검증 기록. NONE은 예전 수동 가져오기 */
export const FlagScanAttestation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FF_SCANNER'), keyId: z.string().min(1).max(100), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/, 'Ed25519 서명(base64url 64바이트)') }).strict(),
  z.object({ kind: z.literal('GITHUB_OIDC'), issuer: z.literal('https://token.actions.githubusercontent.com'), subject: z.string().min(1), workflowRef: z.string().min(1), runId: z.string().min(1), verifiedAt: iso }).strict(),
  z.object({ kind: z.literal('NONE') }).strict(),
]);
export type FlagScanAttestation = z.infer<typeof FlagScanAttestation>;

/** PR 검사(Check Run) 결과 — rules/flag-coverage.ts evaluateFlagPrCheck */
export const FlagPrCheckCode = z.enum(['UNREGISTERED_KEY', 'RETIRED_KEY_USED', 'REGISTERED_CALL_REMOVED', 'DYNAMIC_KEY', 'REMOVAL_ALLOWED', 'EXISTING_DYNAMIC_KEY']);
export const FlagPrCheckFinding = z.object({
  code: FlagPrCheckCode,
  level: z.enum(['FAILURE', 'WARNING', 'NOTICE']),
  flagKey: z.string().nullable(),
  path: FlagSourcePath,
  line: z.number().int().min(1).nullable(),
  message: z.string(),
}).strict();
export type FlagPrCheckFinding = z.infer<typeof FlagPrCheckFinding>;
export const FlagPrCheckResult = z.object({ conclusion: z.enum(['success', 'failure']), findings: z.array(FlagPrCheckFinding) }).strict();
export type FlagPrCheckResult = z.infer<typeof FlagPrCheckResult>;

export const FlagScanRun = z.object({
  scanId: z.string().regex(/^FSCAN-\d{6,}$/),
  repoId: z.string(),
  trigger: FlagScanTrigger,
  ref: z.string(),
  commit: commit.nullable(),
  /** PR 스캔이면 비교한 기준 커밋·PR 번호 */
  baseCommit: commit.nullable(),
  prNumber: z.number().int().positive().nullable(),
  status: FlagScanStatus,
  queuedAt: iso,
  finishedAt: iso.nullable(),
  resultId: z.string().nullable(),
  summary: z.object({ filesScanned: z.number().int().min(0), usages: z.number().int().min(0), flagKeys: z.number().int().min(0), unresolved: z.number().int().min(0) }).strict().nullable(),
  attestation: FlagScanAttestation.nullable(),
  prCheck: FlagPrCheckResult.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
  requestedBy: z.string(),
  deliveryId: z.string().nullable(),
}).strict();
export type FlagScanRun = z.infer<typeof FlagScanRun>;

export const RescanFlagRepositoryBody = z.object({ ref: GitBranch.optional(), reason: text(2, 300) }).strict();
export type RescanFlagRepositoryBody = z.infer<typeof RescanFlagRepositoryBody>;

/** CI(GitHub Actions) 업로드 — OIDC 토큰은 Authorization이 아니라 본문으로 받아 서버가 서명·aud·repository·sha를 검증한다(저장 안 함) */
export const UploadFlagScanBody = z.object({
  manifest: FlagSourceManifestV2,
  oidcToken: z.string().min(20).max(8192),
  prNumber: z.number().int().positive().nullable().default(null),
  baseCommit: commit.nullable().default(null),
}).strict();
export type UploadFlagScanBody = z.infer<typeof UploadFlagScanBody>;

// ── Flag PR(뼈대 생성·제거) ──────────────────────────────
export const FlagPrKind = z.enum(['SCAFFOLD', 'REMOVAL']);
export const FlagPrState = z.enum(['PLANNED', 'OPEN', 'MERGED', 'CLOSED', 'FAILED']);
export type FlagPrState = z.infer<typeof FlagPrState>;
export const FlagPullRequest = z.object({
  prId: z.string().regex(/^FPR-\d{6,}$/),
  repoId: z.string(),
  kind: FlagPrKind,
  featureId: FeatureId,
  version: Semver,
  flagKeys: z.array(FlagKey).min(1),
  branch: GitBranch,
  number: z.number().int().positive().nullable(),
  url: z.string().url().nullable(),
  title: z.string(),
  state: FlagPrState,
  checkConclusion: z.enum(['PENDING', 'SUCCESS', 'FAILURE']).nullable(),
  files: z.array(z.object({ path: FlagSourcePath, change: z.enum(['ADD', 'MODIFY', 'DELETE']) }).strict()),
  createdAt: iso,
  createdBy: z.string(),
  mergedAt: iso.nullable(),
  mergedBy: z.string().nullable(),
  mergeCommit: commit.nullable(),
  retirementId: z.string().nullable(),
  failure: z.string().nullable(),
}).strict();
export type FlagPullRequest = z.infer<typeof FlagPullRequest>;

export const CreateFlagPrBody = z.object({
  featureId: FeatureId,
  version: Semver,
  repoId: z.string().min(1),
  /** 빠지면 이 Version의 Flag 계획 전부 */
  flagKeys: z.array(FlagKey).min(1).max(50).optional(),
}).strict();
export type CreateFlagPrBody = z.infer<typeof CreateFlagPrBody>;

export const CreateFlagRemovalPrBody = z.object({ flagKey: FlagKey, repoId: z.string().min(1), retirementId: z.string().min(1) }).strict();
export type CreateFlagRemovalPrBody = z.infer<typeof CreateFlagRemovalPrBody>;

// ── 출시 차단 해제(waiver) ───────────────────────────────
export const FLAG_COVERAGE_STATUSES = ['OK', 'PR_OPEN', 'NO_CODE', 'CALL_DELETED', 'UNREGISTERED_KEY', 'DYNAMIC_KEY', 'UNLEASH_MISMATCH', 'STALE', 'REMOVAL_DUE'] as const;
export const FlagCoverageStatus = z.enum(FLAG_COVERAGE_STATUSES);
export type FlagCoverageStatus = z.infer<typeof FlagCoverageStatus>;
export const FLAG_WAIVER_MAX_DAYS = 30;
export const FlagGateWaiverBody = z.object({
  flagKey: FlagKey,
  featureId: FeatureId,
  version: Semver,
  reason: text(10, 1000),
  expiresAt: iso,
}).strict();
export type FlagGateWaiverBody = z.infer<typeof FlagGateWaiverBody>;
export const FlagGateWaiverDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: text(2, 500) }).strict();
export type FlagGateWaiverDecisionBody = z.infer<typeof FlagGateWaiverDecisionBody>;
export const FlagGateWaiver = FlagGateWaiverBody.extend({
  waiverId: z.string().regex(/^FWV-\d{4,}$/),
  state: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED']),
  /** 요청 시점의 대사 상태 — 해제는 이 상태에만 적용한다(다른 어긋남이 새로 생기면 다시 막는다) */
  coverageStatus: FlagCoverageStatus,
  requestedBy: z.string(),
  requestedAt: iso,
  decidedBy: z.string().nullable(),
  decidedAt: iso.nullable(),
  comment: z.string().nullable(),
}).strict();
export type FlagGateWaiver = z.infer<typeof FlagGateWaiver>;

// ── 대사(reconciliation) ─────────────────────────────────
export const FLAG_COVERAGE_LABEL: Record<FlagCoverageStatus, string> = {
  OK: '정상',
  PR_OPEN: 'Flag PR 검토 중',
  NO_CODE: '코드 없음',
  CALL_DELETED: '삭제된 호출',
  UNREGISTERED_KEY: '미등록 키',
  DYNAMIC_KEY: '동적 키',
  UNLEASH_MISMATCH: 'Unleash 불일치',
  STALE: '오래된 Flag',
  REMOVAL_DUE: '제거 대상',
};
/** BLOCKER: 출시·PR을 막는다. WARNING: 담당자 조치. INFO: 진행 중 */
export const FlagCoverageSeverity = z.enum(['BLOCKER', 'WARNING', 'INFO', 'OK']);
export type FlagCoverageSeverity = z.infer<typeof FlagCoverageSeverity>;
/** 5원천 — 등록·코드·Unleash·배포·회신 */
export const FLAG_LANES = ['REGISTRY', 'CODE', 'UNLEASH', 'DEPLOY', 'REPORT'] as const;
export const FlagLane = z.enum(FLAG_LANES);
export type FlagLane = z.infer<typeof FlagLane>;
export const FlagLaneState = z.enum(['OK', 'PENDING', 'MISSING', 'MISMATCH', 'NOT_APPLICABLE']);
export type FlagLaneState = z.infer<typeof FlagLaneState>;

export const FlagCoverageFinding = z.object({
  status: FlagCoverageStatus,
  severity: FlagCoverageSeverity,
  message: z.string(),
  /** 이 어긋남이 시작된 근거 시각(스캔·승인·기한) */
  since: iso.nullable(),
  dueAt: iso.nullable(),
}).strict();
export type FlagCoverageFinding = z.infer<typeof FlagCoverageFinding>;

/** Flag 계획의 출처 — POLICY: 정책에 이미 쓰인 키, PLANNED: 승인 시 Feature Version의 제어점에서 만든 키 */
export const FlagPlanSource = z.enum(['POLICY', 'PLANNED']);
export const FlagPlanEntry = z.object({
  flagKey: FlagKey,
  featureId: FeatureId,
  version: Semver,
  controlPoint: ControlPointType,
  ordinal: z.number().int().min(1),
  package: FlagPackage,
  source: FlagPlanSource,
}).strict();
export type FlagPlanEntry = z.infer<typeof FlagPlanEntry>;

export const FlagCoverageRow = z.object({
  flagKey: FlagKey,
  featureId: FeatureId.nullable(),
  version: Semver.nullable(),
  featureName: z.string().nullable(),
  lifecycle: z.enum(LIFECYCLE).nullable(),
  package: FlagPackage.nullable(),
  controlPoint: ControlPointType.nullable(),
  planSource: FlagPlanSource.nullable(),
  policy: z.object({ policyId: z.string(), status: PolicyStatus, revision: z.number().int() }).strict().nullable(),
  code: z.object({
    usages: z.array(FlagSourceLocation.extend({ repoId: z.string(), scanId: z.string().nullable() })),
    lastScanAt: iso.nullable(),
    /** 현재 스캔에는 없지만 이전 스캔에서 본 마지막 커밋 — 삭제된 호출 근거 */
    lastSeen: z.object({ repoId: z.string(), commit, at: iso }).strict().nullable(),
  }).strict(),
  pullRequest: z.object({ prId: z.string(), kind: FlagPrKind, state: FlagPrState, number: z.number().int().nullable(), url: z.string().nullable() }).strict().nullable(),
  unleash: z.object({ configured: z.boolean(), present: z.boolean(), revision: z.number().int().nullable(), archived: z.boolean() }).strict(),
  deploy: z.object({ publicationId: z.string(), status: PublicationStatus, policyRevision: z.number().int() }).strict().nullable(),
  report: z.object({ confirmed: z.number().int().min(0), denominator: z.number().int().min(0), lastReportAt: iso.nullable() }).strict().nullable(),
  status: FlagCoverageStatus,
  severity: FlagCoverageSeverity,
  findings: z.array(FlagCoverageFinding),
  lanes: z.record(FlagLane, FlagLaneState),
  codeRequired: z.boolean(),
  releaseBlocking: z.boolean(),
  waiver: z.object({ waiverId: z.string(), state: z.enum(['REQUESTED', 'APPROVED']), expiresAt: iso }).strict().nullable(),
}).strict();
export type FlagCoverageRow = z.infer<typeof FlagCoverageRow>;

/** 파일 단위 어긋남 — 동적 키는 어느 Flag인지 정할 수 없어 파일에 단다 */
export const FlagFileFinding = z.object({ repoId: z.string(), commit, status: z.literal('DYNAMIC_KEY'), call: FlagUnresolvedCall, since: iso }).strict();
export type FlagFileFinding = z.infer<typeof FlagFileFinding>;

export const FlagCoverageResponse = z.object({
  generatedAt: iso,
  summary: z.object({
    flags: z.number().int().min(0),
    codeRequired: z.number().int().min(0),
    connected: z.number().int().min(0),
    releaseBlocking: z.number().int().min(0),
    byStatus: z.record(FlagCoverageStatus, z.number().int().min(0)),
    repositories: z.array(z.object({ repoId: z.string(), displayName: z.string(), lastScanAt: iso.nullable(), commit: commit.nullable(), webhook: FlagWebhookState }).strict()),
  }).strict(),
  rows: z.array(FlagCoverageRow),
  fileFindings: z.array(FlagFileFinding),
}).strict();
export type FlagCoverageResponse = z.infer<typeof FlagCoverageResponse>;

export const FlagCoverageQuery = z.object({
  featureId: FeatureId.optional(),
  version: Semver.optional(),
  status: z.string().optional().transform((s, ctx) => {
    if (!s) return undefined;
    const parts = s.split(',');
    for (const p of parts) if (!FlagCoverageStatus.safeParse(p).success) { ctx.addIssue({ code: 'custom', message: `알 수 없는 상태 ${p}` }); return z.NEVER; }
    return parts as FlagCoverageStatus[];
  }),
  package: FlagPackage.optional(),
  repoId: z.string().optional(),
  q: z.string().max(100).optional(),
}).strict();
export type FlagCoverageQuery = z.infer<typeof FlagCoverageQuery>;

/** Feature Version 출시 관문 — 이 Version의 Flag 중 코드 연결 때문에 출시를 막는 것 */
export const FlagReleaseGate = z.object({
  featureId: FeatureId,
  version: Semver,
  pass: z.boolean(),
  blockers: z.array(z.object({ flagKey: FlagKey, status: FlagCoverageStatus, message: z.string() }).strict()),
  waived: z.array(z.object({ flagKey: FlagKey, waiverId: z.string(), expiresAt: iso }).strict()),
  checkedAt: iso,
}).strict();
export type FlagReleaseGate = z.infer<typeof FlagReleaseGate>;

/** Flag 하나의 대사 상세(flagCoverageDetail) — 대사 행, 이 키가 보인 서명 스캔 이력(기본 브랜치, 최근 순), PR·해제 이력 */
export const FlagCoverageDetail = z.object({
  row: FlagCoverageRow,
  history: z.array(z.object({ repoId: z.string(), scanId: z.string().nullable(), commit, at: iso, usages: z.number().int().min(0) }).strict()),
  pullRequests: z.array(FlagPullRequest),
  waivers: z.array(FlagGateWaiver),
}).strict();
export type FlagCoverageDetail = z.infer<typeof FlagCoverageDetail>;

/** 스캔 상세(flagScanDetail) — 실행 기록과 결과 manifest(서명 검증 결과·출처). 실패·대기 중이면 manifest는 null */
export const FlagScanDetail = z.object({
  scan: FlagScanRun,
  manifest: FlagSourceManifestV2.nullable(),
  provenance: z.enum(['FF_SCAN', 'CI_ATTESTED', 'DEMO']).nullable(),
  verified: z.boolean(),
}).strict();
export type FlagScanDetail = z.infer<typeof FlagScanDetail>;

// ── 평가 모니터링 ───────────────────────────────────────
export const FlagEvalWindow = z.enum(['1h', '24h', '7d']);
/** 평가 경로 — Feature 평가 운영과 같은 값(rules/evaluation-stats, 한 저장소) */
export const FlagEvalSource = z.enum(EVAL_SOURCES);
/** 차량이 기본값으로 돌아간 이유 — 차량 SDK 회신(IF-06). 모르는 사유는 UNSPECIFIED */
export const FlagFallbackReason = z.enum(EVAL_FALLBACK_REASONS);
export const FlagEvaluationStat = z.object({
  flagKey: FlagKey,
  window: FlagEvalWindow,
  source: FlagEvalSource,
  evaluations: z.number().int().min(0),
  enabled: z.number().int().min(0),
  disabled: z.number().int().min(0),
  variants: z.array(z.object({ name: z.string(), count: z.number().int().min(0) }).strict()),
  fallbacks: z.array(z.object({ reason: FlagFallbackReason, count: z.number().int().min(0) }).strict()),
  errors: z.number().int().min(0),
  /** 창 안 시 칸별 고유 차량 수의 최댓값 — 고유 수는 더할 수 없어 하한으로만 쓴다 */
  vehicles: z.number().int().min(0),
  lastEvaluatedAt: iso.nullable(),
}).strict().refine((s) => s.enabled + s.disabled <= s.evaluations, '켜짐·꺼짐 합이 평가 수보다 큽니다.');
export type FlagEvaluationStat = z.infer<typeof FlagEvaluationStat>;
export const FlagEvaluationBucket = z.object({ bucketStart: iso, source: FlagEvalSource, evaluations: z.number().int().min(0), enabled: z.number().int().min(0), fallbacks: z.number().int().min(0), errors: z.number().int().min(0) }).strict();
export const FlagEvaluationSeries = z.object({ flagKey: FlagKey, window: FlagEvalWindow, bucketMinutes: z.number().int().positive(), buckets: z.array(FlagEvaluationBucket), stats: z.array(FlagEvaluationStat) }).strict();
export type FlagEvaluationSeries = z.infer<typeof FlagEvaluationSeries>;
/** 평가 모니터링 목록(flagEvaluations) — 창 끝은 응답 시각, Flag×원천마다 한 줄 */
export const FlagEvaluationsResponse = z.object({ window: FlagEvalWindow, generatedAt: iso, items: z.array(FlagEvaluationStat) }).strict();
export type FlagEvaluationsResponse = z.infer<typeof FlagEvaluationsResponse>;
/** 차량 SDK 평가 요약 — IF-06 보고에 덧붙일 후속 계약(값 자체·VIN 외 개인정보는 넣지 않는다) */
export const VehicleFlagEvalSummary = z.object({
  windowStart: iso,
  windowEnd: iso,
  flags: z.array(z.object({ flagKey: FlagKey, evaluations: z.number().int().min(0), enabled: z.number().int().min(0), fallbacks: z.array(z.object({ reason: FlagFallbackReason, count: z.number().int().min(1) }).strict()).max(6), errors: z.number().int().min(0) }).strict()).max(500),
}).strict();
export type VehicleFlagEvalSummary = z.infer<typeof VehicleFlagEvalSummary>;

// ── GitHub webhook(서명 검증은 원문 바이트로 서버가 한다) ──────────
export const GithubWebhookBody = z.object({
  action: z.string().optional(),
  ref: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  repository: z.object({ html_url: z.string().url(), default_branch: z.string().optional() }).passthrough(),
  installation: z.object({ id: z.number().int() }).passthrough().optional(),
  pull_request: z.object({ number: z.number().int(), merged: z.boolean().optional(), head: z.object({ sha: z.string(), ref: z.string() }).passthrough(), base: z.object({ sha: z.string(), ref: z.string() }).passthrough() }).passthrough().optional(),
}).passthrough();
export type GithubWebhookBody = z.infer<typeof GithubWebhookBody>;
