// GitLab · JIRA · codeBeamer 양방향 연계 (사용자 결정 2026-10-18 "양방향이 되게끔") — 계약과 주인 규칙.
// 한 사실의 주인은 하나다. 주인이 아닌 쪽에서 온 변경은 "요청"이 되어 플랫폼의 같은 가드(게이트·직무 분리·감사)를 거친다.
// 받아들여지면 반영, 아니면 거부하고 원래 시스템에 되돌림(되쓰기)과 사유 댓글을 남긴다. 양쪽이 같은 거울 값을 동시에 바꾸면
// 충돌로 두고 사람이 고른다(자동 병합 없음).
//   codeBeamer = 요구사항(사양)·시험 원장 → IF-01 · JIRA = 작업·변경요청(CR) 원장 → IF-14 · GitLab = 코드·MR·파이프라인 원장 → IF-13
//   Feature Lifecycle·정책·서명·긴급 차단·감사 = 플랫폼 원장
import { z } from 'zod';
import { Asil, LIFECYCLE, type Lifecycle } from '../enums';

export const EXT_SYSTEMS = ['CODEBEAMER', 'JIRA', 'GITLAB'] as const;
export type ExtSystem = (typeof EXT_SYSTEMS)[number];
export const EXT_SYSTEM_LABEL: Record<ExtSystem, string> = { CODEBEAMER: 'codeBeamer', JIRA: 'JIRA', GITLAB: 'GitLab' };
/** 연계 인터페이스 번호 (components.manifest INTERFACES) */
export const EXT_SYSTEM_IF: Record<ExtSystem, 'IF-01' | 'IF-13' | 'IF-14'> = { CODEBEAMER: 'IF-01', JIRA: 'IF-14', GITLAB: 'IF-13' };

/** 외부 항목 종류 */
export const EXT_KINDS = {
  CODEBEAMER: ['REQUIREMENT'],
  JIRA: ['EPIC', 'CHANGE_REQUEST', 'DEFECT'],
  GITLAB: ['MERGE_REQUEST', 'PIPELINE'],
} as const satisfies Record<ExtSystem, readonly string[]>;
export type ExtKind = (typeof EXT_KINDS)[ExtSystem][number];
export const EXT_KIND_LABEL: Record<ExtKind, string> = {
  REQUIREMENT: '요구사항',
  EPIC: 'Epic',
  CHANGE_REQUEST: '변경요청(CR)',
  DEFECT: '결함',
  MERGE_REQUEST: 'MR',
  PIPELINE: '파이프라인',
};

/** 플랫폼 쪽 연결 대상 */
export const LINK_ENTITIES = ['FEATURE', 'POLICY', 'KILL', 'CHANGE_RECORD'] as const;
export type LinkEntity = (typeof LINK_ENTITIES)[number];

/** 동기 상태 — 맞음·보낼 것 있음·충돌(사람이 고름)·실패(재시도 소진)·거부(외부 요청이 가드에 막혀 되돌림) */
export const SYNC_STATES = ['SYNCED', 'PENDING', 'CONFLICT', 'FAILED', 'REJECTED'] as const;
export type SyncState = (typeof SYNC_STATES)[number];
export const SYNC_STATE_LABEL: Record<SyncState, string> = { SYNCED: '맞음', PENDING: '보내는 중', CONFLICT: '충돌 — 선택 필요', FAILED: '보내기 실패', REJECTED: '외부 변경 거부됨' };

/** 외부 항목 한 건 — 연결 표(ext_link)에 저장한 마지막 관측 값 */
export const ExtRefSchema = z
  .object({
    system: z.enum(EXT_SYSTEMS),
    kind: z.string(),
    key: z.string().min(1),
    url: z.string().url(),
    title: z.string(),
    status: z.string(),
    /** 외부 쪽 개정 번호 — 낙관적 동시성(같으면 덮어쓰기, 다르면 충돌) */
    revision: z.number().int().nonnegative(),
    syncState: z.enum(SYNC_STATES),
    syncedAt: z.string().nullable(),
    /** 요구가 바뀌어 연결된 Feature의 G2 재검토가 필요하다(codeBeamer 요구 개정 뒤 G2 판정 전) */
    stale: z.boolean().default(false),
    /** 시스템별 부가 값(파이프라인 결과·MR 대상 브랜치·요구 본문 앞부분 등) */
    extra: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type ExtRef = z.infer<typeof ExtRefSchema>;

export interface ExtLink extends ExtRef {
  linkId: number;
  entity: LinkEntity;
  /** FEATURE는 `FEAT-00022@1.0.0`, POLICY는 정책 ID 등 */
  entityId: string;
  createdAt: string;
}

/** 필드별 주인 — 화면 안내와 동기화 엔진이 같은 표를 쓴다 */
export interface OwnershipRule {
  fact: string;
  owner: ExtSystem | 'PLATFORM';
  /** 주인이 아닌 쪽에서 바뀌면 */
  reverse: string;
}
export const SYNC_OWNERSHIP: readonly OwnershipRule[] = [
  { fact: '요구사항 내용·상태·개정', owner: 'CODEBEAMER', reverse: '플랫폼은 Feature 연결과 검증 결과(G2·G5 판정·Evidence)만 codeBeamer에 씁니다. 요구가 개정되면 연결된 Feature에 G2 재검토 표시가 붙습니다.' },
  { fact: '변경요청(CR) 작업 흐름', owner: 'JIRA', reverse: '플랫폼은 정책 검증·승인·배포·확대·긴급 차단 결과를 CR 상태와 댓글로 씁니다. JIRA에서 CR을 승인하면 플랫폼 정책 승인 요청이 됩니다.' },
  { fact: 'Feature Lifecycle', owner: 'PLATFORM', reverse: '플랫폼과 JIRA 양쪽에서 관리합니다. JIRA에서 Epic을 만들면 PROPOSED Feature가 자동 등록되고, Epic 상태를 바꾸면 전이 요청이 됩니다. 게이트·직무 분리 판정은 플랫폼이 하며, 통과하면 반영, 아니면 Epic 상태를 되돌리고 사유를 댓글로 남깁니다.' },
  { fact: '코드·MR·파이프라인', owner: 'GITLAB', reverse: 'MR 병합·파이프라인 결과는 변경 기록·Evidence로 들어옵니다. 플랫폼은 게이트 결과를 MR commit status로 씁니다.' },
  { fact: '정책·서명·긴급 차단·감사', owner: 'PLATFORM', reverse: '외부에서 바꿀 수 없습니다. 정책에는 근거가 된 JIRA CR을 연결합니다.' },
];

/** FF Lifecycle ↔ JIRA Epic 상태 (회사 워크플로 이름이 오면 이 표만 바꾼다) */
export const JIRA_EPIC_STATUS: Record<Lifecycle, string> = {
  PROPOSED: 'Proposed',
  APPROVED: 'Approved',
  DEVELOPING: 'In Progress',
  VERIFIED: 'In Verification',
  RELEASED: 'Released',
  DEPRECATED: 'Deprecated',
  RETIRED: 'Closed',
};
export function lifecycleOfEpicStatus(status: string): Lifecycle | null {
  const hit = (LIFECYCLE as readonly Lifecycle[]).find((l) => JIRA_EPIC_STATUS[l].toLowerCase() === status.trim().toLowerCase());
  return hit ?? null;
}

/**
 * JIRA Epic → Feature 자동 등록에 쓰는 적용 범위 값(사용자 결정 2026-10-23 "JIRA에서 Epic 만들면 Feature 자동 생성").
 * 국가·차종·트림은 Feature ID를 가르는 값이라 짐작해 채우지 않는다 — 빠지면 등록하지 않고 Epic 댓글로 알린다.
 * 실제 JIRA에서는 Epic의 사용자 정의 필드에서 읽는다(필드 ID는 환경 변수 JIRA_FIELD_COUNTRY 등).
 */
export const EPIC_SCOPE_FIELDS = ['country', 'vehicleModel', 'trim', 'asil', 'ownerId'] as const;
export type EpicScopeField = (typeof EPIC_SCOPE_FIELDS)[number];
export const EPIC_SCOPE_LABEL: Record<EpicScopeField, string> = { country: '국가', vehicleModel: '차종', trim: '트림', asil: 'ASIL', ownerId: '담당 조직' };
export const EpicScope = z
  .object({
    country: z.string().trim().min(1).max(8),
    vehicleModel: z.string().trim().min(1).max(80),
    trim: z.string().trim().min(1).max(80),
    asil: Asil,
    ownerId: z.string().trim().min(1).max(100),
  })
  .partial()
  .strict();
export type EpicScope = z.infer<typeof EpicScope>;
/** 빠졌거나 형식이 틀린 범위 값 */
export function missingEpicScope(scope: Record<string, unknown> | null | undefined): EpicScopeField[] {
  const s = scope ?? {};
  return EPIC_SCOPE_FIELDS.filter((k) => !EpicScope.shape[k].unwrap().safeParse(s[k]).success);
}

/** JIRA CR 상태 — 플랫폼 정책 상태를 거울로 */
export const JIRA_CR_STATUS = {
  OPEN: 'Open',
  IN_REVIEW: 'In Review',
  APPROVED: 'Approved',
  DEPLOYED: 'Deployed',
  ROLLED_BACK: 'Rolled Back',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
} as const;
export type JiraCrState = keyof typeof JIRA_CR_STATUS;
export const JIRA_CR_STATES = Object.keys(JIRA_CR_STATUS) as JiraCrState[];
/** JIRA 이슈 유형 이름 — 실제 연결 어댑터·webhook 정규화가 이 이름으로 가른다(프로젝트에 같은 이름의 유형이 있어야 한다) */
export const JIRA_ISSUE_TYPE = { EPIC: 'Epic', CHANGE_REQUEST: 'Change Request', DEFECT: 'Bug' } as const;

/**
 * 회사 워크플로 상태 이름 덮어쓰기 — 환경 변수 JIRA_EPIC_STATUS·JIRA_CR_STATUS(JSON, 바꿀 상태만).
 *   JIRA_EPIC_STATUS='{"PROPOSED":"Idea","DEVELOPING":"In Development"}'
 * 키는 플랫폼 상태(Lifecycle·CR 상태)만, 값은 비어 있지 않은 이름. Epic 상태는 서로 달라야 하고(되읽기로 Lifecycle을 고른다),
 * CR의 APPROVED·REJECTED는 다른 상태와 겹치면 안 된다(JIRA에서 승인·반려를 그 이름으로 알아본다).
 * 순수 함수 — 읽기·적용은 백엔드(ext-sync live-config)와 tools/ext-check가 같은 규칙으로 한다.
 */
export function parseJiraStatusMap(kind: 'EPIC' | 'CR', raw: string | undefined): { map: Record<string, string> } | { error: string } {
  const name = kind === 'EPIC' ? 'JIRA_EPIC_STATUS' : 'JIRA_CR_STATUS';
  const keys: readonly string[] = kind === 'EPIC' ? LIFECYCLE : JIRA_CR_STATES;
  if (!raw || !raw.trim()) return { map: {} };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { error: `${name}는 JSON 객체여야 합니다 — 예: {"PROPOSED":"Idea"}` };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: `${name}는 JSON 객체여야 합니다 — 예: {"PROPOSED":"Idea"}` };
  const map: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!keys.includes(k)) return { error: `${name}의 '${k}'는 플랫폼 상태가 아닙니다 — 쓸 수 있는 키: ${keys.join(', ')}` };
    if (typeof x !== 'string' || !x.trim()) return { error: `${name}.${k} 값이 비어 있습니다` };
    map[k] = x.trim();
  }
  const base: Record<string, string> = kind === 'EPIC' ? { ...JIRA_EPIC_STATUS_DEFAULT } : { ...JIRA_CR_STATUS_DEFAULT };
  const full = { ...base, ...map };
  const clash = (a: string) => keys.filter((b) => b !== a && full[b].toLowerCase() === full[a].toLowerCase());
  for (const a of kind === 'EPIC' ? keys : ['APPROVED', 'REJECTED']) {
    const c = clash(a);
    if (c.length) return { error: `${name}: ${a}와 ${c.join('·')}가 같은 JIRA 상태 '${full[a]}'를 씁니다 — 서로 달라야 합니다` };
  }
  return { map };
}
/** 덮어쓰기 전 기본 이름(모의 연결·시험 기준) */
export const JIRA_EPIC_STATUS_DEFAULT: Readonly<Record<Lifecycle, string>> = Object.freeze({ ...JIRA_EPIC_STATUS });
export const JIRA_CR_STATUS_DEFAULT: Readonly<Record<JiraCrState, string>> = Object.freeze({ ...JIRA_CR_STATUS });

/** 실제 연결(IF_MODE_xx=live)에 쓰는 환경 변수 — 백엔드 시작 검사(빠지면 시작하지 않음)와 tools/ext-check가 같은 표를 쓴다 */
export interface ExtLiveEnv {
  key: string;
  what: string;
  /** 값을 출력하지 않는다 */
  secret?: boolean;
  /** live에서 꼭 있어야 한다. 'epic-autocreate'는 FF_EPIC_AUTOCREATE=off가 아닐 때만 */
  required: true | false | 'epic-autocreate';
}
export const EXT_LIVE_ENV: Record<ExtSystem, readonly ExtLiveEnv[]> = {
  JIRA: [
    { key: 'JIRA_URL', what: 'JIRA 주소(https://…)', required: true },
    { key: 'JIRA_USER', what: 'Cloud: 사용자 이메일(Basic) · Data Center: 비움(개인 접근 토큰 Bearer)', required: false },
    { key: 'JIRA_TOKEN', what: 'API 토큰(Cloud)·개인 접근 토큰(Data Center)', secret: true, required: true },
    { key: 'JIRA_EPIC_PROJECT', what: 'Epic 프로젝트 키', required: true },
    { key: 'JIRA_CR_PROJECT', what: '변경요청(CR) 프로젝트 키', required: true },
    { key: 'JIRA_DEFECT_PROJECT', what: '결함(긴급 차단) 프로젝트 키', required: true },
    { key: 'JIRA_WEBHOOK_SECRET', what: 'webhook HMAC 비밀값(JIRA webhook 설정과 같은 값)', secret: true, required: true },
    { key: 'JIRA_FIELD_COUNTRY', what: 'Epic 사용자 정의 필드 ID — 국가', required: 'epic-autocreate' },
    { key: 'JIRA_FIELD_VEHICLE_MODEL', what: 'Epic 사용자 정의 필드 ID — 차종', required: 'epic-autocreate' },
    { key: 'JIRA_FIELD_TRIM', what: 'Epic 사용자 정의 필드 ID — 트림', required: 'epic-autocreate' },
    { key: 'JIRA_FIELD_ASIL', what: 'Epic 사용자 정의 필드 ID — ASIL', required: 'epic-autocreate' },
    { key: 'JIRA_FIELD_OWNER', what: 'Epic 사용자 정의 필드 ID — 담당 조직', required: 'epic-autocreate' },
    { key: 'JIRA_EPIC_STATUS', what: 'Epic 워크플로 상태 이름(JSON, 기본과 다른 것만)', required: false },
    { key: 'JIRA_CR_STATUS', what: 'CR 워크플로 상태 이름(JSON, 기본과 다른 것만)', required: false },
  ],
  GITLAB: [
    { key: 'GITLAB_URL', what: 'GitLab 주소(https://…)', required: true },
    { key: 'GITLAB_TOKEN', what: '접근 토큰(api 범위, Developer 이상)', secret: true, required: true },
    { key: 'GITLAB_PROJECT', what: '프로젝트 경로(그룹/이름) 또는 숫자 ID', required: true },
    { key: 'GITLAB_WEBHOOK_TOKEN', what: 'webhook 비밀 토큰(GitLab webhook 설정과 같은 값)', secret: true, required: true },
  ],
  CODEBEAMER: [
    { key: 'CODEBEAMER_URL', what: 'codeBeamer 주소(https://…, /api 앞까지)', required: true },
    { key: 'CODEBEAMER_USER', what: '사용자 이름(Basic)', required: true },
    { key: 'CODEBEAMER_TOKEN', what: '비밀번호 또는 토큰', secret: true, required: true },
    { key: 'CODEBEAMER_WEBHOOK_SECRET', what: 'webhook HMAC 비밀값(codeBeamer webhook 설정과 같은 값)', secret: true, required: true },
    { key: 'CODEBEAMER_REQ_TRACKER', what: '요구사항 tracker ID(숫자, 비우면 전체에서 찾음)', required: false },
    { key: 'CODEBEAMER_REQ_ID_FIELD', what: "요구 ID 필드 이름(기본 'Requirement ID')", required: false },
  ],
};
/** live에서 빠진 필수 환경 변수 */
export function missingLiveEnv(system: ExtSystem, get: (key: string) => string | undefined): string[] {
  const autocreate = (get('FF_EPIC_AUTOCREATE') ?? '').trim() !== 'off';
  return EXT_LIVE_ENV[system].filter((e) => (e.required === true || (e.required === 'epic-autocreate' && autocreate)) && !(get(e.key) ?? '').trim()).map((e) => e.key);
}

/** 외부 계정 → 플랫폼 행위자 (매핑이 없으면 외부 요청을 거부한다 — 직무 분리를 외부로 우회하지 못하게) */
/** roles: 이 사람이 플랫폼에서 맡은 역할 — 요청마다 그 작업이 허용하는 역할 중 맡은 것을 고른다(화면 actorFor와 같은 규칙) */
export const ExtIdentitySchema = z.object({ system: z.enum(EXT_SYSTEMS), externalId: z.string().min(1), actorId: z.string().min(1), roles: z.array(z.string().min(1)).min(1), name: z.string() }).strict();
export type ExtIdentity = z.infer<typeof ExtIdentitySchema>;

/** 정규화한 외부 변경 — 시스템별 webhook 본문을 이 모양으로 바꿔 받을 함(sync_inbox)에 넣는다 */
export interface ExtChange {
  system: ExtSystem;
  deliveryId: string;
  kind: ExtKind;
  key: string;
  url: string;
  title: string;
  status: string;
  /** 바뀌기 전 상태(있으면) */
  fromStatus: string | null;
  revision: number;
  externalUser: string;
  /** 본문에서 찾은 플랫폼 참조 — FEAT-00022@1.0.0, POL-…, 상위 Epic 키 등 */
  refs: { featureId?: string; version?: string; policyId?: string; epicKey?: string; crKey?: string };
  extra: Record<string, unknown>;
}

/** 본문(제목·설명·브랜치)에서 FEAT-xxxxx(@x.y.z)·JIRA 키를 찾는다 — 커밋 메시지·MR 설명 규칙 */
export function parseRefs(text: string, jiraProject = 'FFCR'): { featureId?: string; version?: string; crKey?: string } {
  const f = /\b(FEAT-\d{5})(?:@(\d+\.\d+\.\d+))?/.exec(text);
  const cr = new RegExp(`\\b(${jiraProject}-\\d+)\\b`).exec(text);
  return { ...(f ? { featureId: f[1], ...(f[2] ? { version: f[2] } : {}) } : {}), ...(cr ? { crKey: cr[1] } : {}) };
}

/** 모의 외부 시스템에서 사람이 한 일(화면의 "외부에서 바꿔 보기"·재생 엔진) — 실제 연결이면 쓰지 않는다 */
export const MockExtActionBody = z
  .object({
    key: z.string().min(1),
    action: z.enum(['TRANSITION', 'EDIT', 'MERGE', 'PIPELINE']),
    /** TRANSITION: 새 상태 · PIPELINE: success|failed */
    status: z.string().trim().min(1).max(60).optional(),
    /** EDIT: 새 제목·본문 */
    title: z.string().trim().min(2).max(200).optional(),
    body: z.string().trim().max(4000).optional(),
    /** 외부 계정 — 매핑 표(ext-identities)에 있어야 요청이 받아들여진다 */
    externalUser: z.string().trim().min(1).max(120),
    /** PIPELINE: 파이프라인이 보고한 커버리지(%) — 없으면 변경 기록에 커버리지 근거가 없다 */
    coverage: z.number().min(0).max(100).optional(),
    /** false면 webhook이 오지 않은 것으로(유실) — 플랫폼이 나중에 되쓰다 충돌을 만난다 */
    deliver: z.boolean().default(true),
    /** EDIT(Epic): 적용 범위 필드를 채우거나 고친다 */
    scope: EpicScope.optional(),
  })
  .strict();
export type MockExtActionBody = z.infer<typeof MockExtActionBody>;

/** 모의 외부 시스템에 새 항목 만들기(CR·MR·요구) */
export const MockExtCreateBody = z
  .object({
    kind: z.enum(['REQUIREMENT', 'EPIC', 'CHANGE_REQUEST', 'DEFECT', 'MERGE_REQUEST']),
    title: z.string().trim().min(2).max(200),
    body: z.string().trim().max(4000).default(''),
    externalUser: z.string().trim().min(1).max(120),
    /** EPIC: 적용 범위(Feature 자동 등록에 필요) */
    scope: EpicScope.optional(),
  })
  .strict();
export type MockExtCreateBody = z.infer<typeof MockExtCreateBody>;

/** 충돌 해소 — 플랫폼 값을 다시 보낸다 / 외부 값을 요청으로 다시 시도한다 */
export const ResolveConflictBody = z.object({ choose: z.enum(['PLATFORM', 'EXTERNAL']), reason: z.string().trim().min(2).max(500) }).strict();
export type ResolveConflictBody = z.infer<typeof ResolveConflictBody>;

/** 정책을 근거 CR에 연결 */
export const LinkChangeRequestBody = z.object({ crKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/), reason: z.string().trim().min(2).max(500).optional() }).strict();
export type LinkChangeRequestBody = z.infer<typeof LinkChangeRequestBody>;

/** 시스템별 연결 현황 */
export interface ExtSystemSummary {
  system: ExtSystem;
  ifId: string;
  mode: 'mock' | 'live' | 'off';
  baseUrl: string;
  links: number;
  pending: number;
  failed: number;
  conflicts: number;
  rejected: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}
