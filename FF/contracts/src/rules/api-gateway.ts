// 외부 API 게이트웨이(D05-01, 기능명세서 FR-AGW-001-003~007) — 외부 시스템 API 키(해시 저장·원문 1회·키→역할), API 버전 정책(지원·폐기 일정·410+Sunset).
// 키 원문은 서버가 만들어 발급 응답에만 싣는다. 저장소에는 SHA-256 해시만 — 폐기하면 해시도 지워 다시는 인증되지 않는다.
// 키가 맡는 역할은 외부 시스템 역할(SYSTEM)과 조회 전용(AUDITOR)뿐이다. 사람 역할을 키로 대신하지 않는다(승인·직무 분리는 사람 서명 그대로).
import { z } from 'zod';
import type { Role } from '../enums';

/** API 키 머리글 — 이 머리글이 오면 행위자 머리글(X-Actor-*) 대신 키 신원으로 처리한다 */
export const API_KEY_HEADER = 'x-api-key';
/** 키가 맡을 수 있는 역할 — 외부 시스템(SYSTEM 허용 경로)·조회 전용 */
export const API_KEY_ROLES = ['SYSTEM', 'AUDITOR'] as const satisfies readonly Role[];
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];
/** 키 발급·폐기 — 사이버보안 담당(외부 접근 자격)·운영 리더. 시스템 관리자 역할은 따로 두지 않는다(역할 기반 인가) */
export const API_KEY_ADMIN_ROLES: Role[] = ['SECURITY_OFFICER', 'OPS_LEAD'];
/** 유효 기간 상한(일) — 기한 없는 키를 만들지 않는다 */
export const API_KEY_MAX_DAYS = 365;

/** 키 원문 모양 `ffk_<키 ID>_<비밀 43자(base64url 32바이트)>` */
export const API_KEY_PATTERN = /^ffk_(AK-\d{4,})_([A-Za-z0-9_-]{43})$/;
export function parseApiKey(raw: string): { keyId: string; secret: string } | null {
  const m = API_KEY_PATTERN.exec(raw.trim());
  return m ? { keyId: m[1], secret: m[2] } : null;
}
/** 목록에 보이는 앞부분 — 원문을 다시 만들 수 없는 길이 */
/** 키 ID 뒤 '_'(두 번째)부터 4자 — 비밀(base64url)에도 '_'가 나올 수 있어 마지막 '_' 기준이면 안 된다 */
export const apiKeyPrefix = (raw: string) => raw.slice(0, raw.indexOf('_', raw.indexOf('_') + 1) + 5);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD');
export const IssueApiKeyBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    /** 키를 쓸 외부 시스템(예: 고객센터 VOC 수집기) */
    system: z.string().trim().min(2).max(80),
    role: z.enum(API_KEY_ROLES),
    /** 만료일(포함) — 비우면 발급일부터 API_KEY_MAX_DAYS일 */
    expiresOn: ymd.optional(),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type IssueApiKeyBody = z.infer<typeof IssueApiKeyBody>;
export const RevokeApiKeyBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type RevokeApiKeyBody = z.infer<typeof RevokeApiKeyBody>;

export const API_KEY_STATES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type ApiKeyState = (typeof API_KEY_STATES)[number];
export const ApiKeyView = z.object({
  keyId: z.string(),
  name: z.string(),
  system: z.string(),
  role: z.enum(API_KEY_ROLES),
  /** 원문 앞부분(식별용) */
  prefix: z.string(),
  state: z.enum(API_KEY_STATES),
  createdBy: z.string(),
  createdAt: z.string(),
  expiresOn: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
});
export type ApiKeyView = z.infer<typeof ApiKeyView>;
/** 발급 응답 — 원문(secret)은 이 응답 한 번뿐 */
export const IssuedApiKey = ApiKeyView.extend({ secret: z.string() });
export type IssuedApiKey = z.infer<typeof IssuedApiKey>;

/** 키 상태 — 폐기가 먼저, 다음 만료일(포함) 지남 */
export function apiKeyState(k: { revokedAt: string | null; expiresOn: string }, now: string): ApiKeyState {
  if (k.revokedAt) return 'REVOKED';
  return now.slice(0, 10) > k.expiresOn ? 'EXPIRED' : 'ACTIVE';
}

/** 만료일 검사 — 오늘 이후, 상한 이내. 비우면 상한 날짜 */
export function apiKeyExpiry(expiresOn: string | undefined, now: string): { ok: true; expiresOn: string } | { ok: false; reason: string } {
  const today = now.slice(0, 10);
  const max = new Date(Date.parse(`${today}T00:00:00Z`) + API_KEY_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!expiresOn) return { ok: true, expiresOn: max };
  if (Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`))) return { ok: false, reason: `만료일 ${expiresOn}이(가) 올바른 날짜가 아닙니다` };
  if (expiresOn < today) return { ok: false, reason: `만료일 ${expiresOn}이(가) 오늘(${today})보다 앞입니다` };
  if (expiresOn > max) return { ok: false, reason: `만료일은 발급일부터 ${API_KEY_MAX_DAYS}일(${max}) 안이어야 합니다` };
  return { ok: true, expiresOn };
}

// ───────── API 버전 정책(FR-AGW-001-007) ─────────

/** 버전 선택 머리글 — 없으면 현재 버전. 응답에는 처리한 버전을 같은 머리글로 돌려준다 */
export const API_VERSION_HEADER = 'x-api-version';
/** 정책 — 한 버전 안의 변경은 추가만(필드·경로 추가), 지우거나 뜻을 바꾸려면 새 버전. 폐기 예고 뒤 최소 기간이 지나야 지원 종료 */
export const API_VERSION_POLICY = {
  compatibility: 'ADDITIVE_ONLY' as const,
  /** 폐기 예고(Deprecation)부터 지원 종료(Sunset)까지 최소 일수 */
  minNoticeDays: 180,
  /** 폐기 예고 버전의 응답 — 현재 버전과 같은 본문 + Deprecation·Sunset·Link 머리글 */
  deprecatedResponse: '같은 경로·같은 본문으로 응답하고 Deprecation·Sunset·Link 머리글로 종료 일정을 알린다',
  /** 지원 종료 버전 요청 — 410 + Sunset 머리글 + 옮길 버전 안내 */
  retiredResponse: '410 API_VERSION_RETIRED — 종료일·옮길 버전·정책 주소를 오류 본문과 Sunset·Link 머리글로 알린다',
};

export interface ApiVersionDef {
  version: string;
  releasedAt: string;
  /** 폐기 예고일 — 이날부터 Deprecation 머리글 */
  deprecatedAt: string | null;
  /** 지원 종료일 — 이날부터 410 */
  sunsetAt: string | null;
  /** 이 버전에서 바뀐 것(추가만) */
  changes: string[];
}
/** 버전 표 — 날짜 순. 상태는 시계로 정한다(apiVersionStatus) */
export const API_VERSIONS: ApiVersionDef[] = [
  { version: '2025-12', releasedAt: '2025-12-01', deprecatedAt: '2026-04-01', sunsetAt: '2026-10-01', changes: ['첫 공개 버전 — 정책·Feature·감사 조회, OFREP 평가'] },
  { version: '2026-06', releasedAt: '2026-06-01', deprecatedAt: '2026-11-01', sunsetAt: '2027-05-01', changes: ['체험·구독 전환, 연계 오류 이력, 데이터 동기화 대사 추가'] },
  { version: '2026-11', releasedAt: '2026-11-01', deprecatedAt: null, sunsetAt: null, changes: ['외부 API 키, 런타임 명세(GET /api/openapi.json), Legacy 연계 설정·변환 규칙, 사용량 정산 전송 추가'] },
];
export const API_VERSION_STATES = ['CURRENT', 'SUPPORTED', 'DEPRECATED', 'RETIRED'] as const;
export type ApiVersionState = (typeof API_VERSION_STATES)[number];

/** 시각 now에서 버전 상태 — 종료일 지남 RETIRED, 예고일 지남 DEPRECATED, 그 밖 중 가장 새것 CURRENT */
export function apiVersionStatus(v: ApiVersionDef, now: string, table: ApiVersionDef[] = API_VERSIONS): ApiVersionState {
  const day = now.slice(0, 10);
  if (v.sunsetAt && day >= v.sunsetAt) return 'RETIRED';
  if (v.deprecatedAt && day >= v.deprecatedAt) return 'DEPRECATED';
  const live = table.filter((x) => x.releasedAt <= day && !(x.deprecatedAt && day >= x.deprecatedAt));
  return live.at(-1)?.version === v.version ? 'CURRENT' : 'SUPPORTED';
}
export const currentApiVersion = (now: string, table: ApiVersionDef[] = API_VERSIONS): ApiVersionDef =>
  table.find((v) => apiVersionStatus(v, now, table) === 'CURRENT') ?? table.at(-1)!;

/** HTTP-date(RFC 9110) — Sunset 머리글 */
export const httpDate = (ymdDay: string) => new Date(`${ymdDay}T00:00:00Z`).toUTCString();

export type ApiVersionResolution =
  | { ok: true; version: string; state: ApiVersionState; headers: Record<string, string> }
  | { ok: false; status: 400 | 410; code: 'VALIDATION' | 'API_VERSION_RETIRED'; message: string; headers: Record<string, string>; details: Record<string, unknown> };

/** 요청 머리글 값 → 처리 버전·응답 머리글, 또는 오류(모르는 버전 400·지원 종료 410) */
export function resolveApiVersion(requested: string | undefined, now: string, table: ApiVersionDef[] = API_VERSIONS): ApiVersionResolution {
  const cur = currentApiVersion(now, table);
  const want = (requested ?? '').trim();
  if (!want) return { ok: true, version: cur.version, state: 'CURRENT', headers: { 'X-Api-Version': cur.version } };
  const v = table.find((x) => x.version === want);
  const supported = table.filter((x) => apiVersionStatus(x, now, table) !== 'RETIRED').map((x) => x.version);
  if (!v || v.releasedAt > now.slice(0, 10))
    return { ok: false, status: 400, code: 'VALIDATION', message: `알 수 없는 API 버전입니다: ${want}. 지원 버전: ${supported.join(', ')}`, headers: {}, details: { requested: want, supported, current: cur.version } };
  const state = apiVersionStatus(v, now, table);
  const link = '</api/api-versions>; rel="deprecation"; type="application/json"';
  if (state === 'RETIRED')
    return {
      ok: false,
      status: 410,
      code: 'API_VERSION_RETIRED',
      message: `API 버전 ${want}은(는) ${v.sunsetAt}에 지원이 끝났습니다. ${cur.version} 버전으로 옮기세요(X-Api-Version: ${cur.version}). 일정은 /api/api-versions에서 봅니다.`,
      headers: { Sunset: httpDate(v.sunsetAt!), Link: link },
      details: { requested: want, sunsetAt: v.sunsetAt, current: cur.version, supported, policy: '/api/api-versions' },
    };
  const headers: Record<string, string> = { 'X-Api-Version': v.version };
  if (state === 'DEPRECATED') {
    headers.Deprecation = `@${Math.floor(Date.parse(`${v.deprecatedAt}T00:00:00Z`) / 1000)}`;
    if (v.sunsetAt) headers.Sunset = httpDate(v.sunsetAt);
    headers.Link = link;
  }
  return { ok: true, version: v.version, state, headers };
}

export const ApiVersionsView = z.object({
  header: z.string(),
  current: z.string(),
  policy: z.object({ compatibility: z.string(), minNoticeDays: z.number(), deprecatedResponse: z.string(), retiredResponse: z.string() }),
  versions: z.array(z.object({ version: z.string(), state: z.enum(API_VERSION_STATES), releasedAt: z.string(), deprecatedAt: z.string().nullable(), sunsetAt: z.string().nullable(), changes: z.array(z.string()) })),
  spec: z.object({ openapi: z.string(), version: z.string(), paths: z.number(), operations: z.number(), sha256: z.string(), url: z.string() }),
});
export type ApiVersionsView = z.infer<typeof ApiVersionsView>;

/** 버전 표 + 시각 now의 상태 */
export function apiVersionsAt(now: string, table: ApiVersionDef[] = API_VERSIONS) {
  return table.filter((v) => v.releasedAt <= now.slice(0, 10)).map((v) => ({ ...v, state: apiVersionStatus(v, now, table) })).reverse();
}

// ───────── OFREP SDK 키(2026-11-07 결정 C8 (b)) ─────────
// 평가 결과는 Feature 구성을 드러내므로 OFREP 경로는 SDK 키가 필수다. 키는 위 외부 API 키(발급·해시 저장·폐기·만료)를 그대로 쓴다.
// 데모 설치에는 공개 기본 키를 하나 둔다(예약 ID AK-0000, 데모 인증 방식에서만). 회사 SSO 설치는 보안 담당이 발급한 키만 받는다.
/** 데모 기본 SDK 키의 예약 ID — 발급 번호(AK-0001~)와 겹치지 않는다 */
export const DEMO_SDK_KEY_ID = 'AK-0000';
/** 데모 기본 SDK 키 원문 — 공개 데모용이라 비밀이 아니다. 운영(FF_AUTH=oidc)에는 만들지 않는다 */
export const DEMO_SDK_KEY = `ffk_${DEMO_SDK_KEY_ID}_DemoSdkKeyPublicDemoOnlyNotASecret000000000`;
/** SDK 요청에서 키 원문 — `Authorization: Bearer <키>`(OFREP 표준) 또는 `X-Api-Key`. 없거나 다른 방식이면 null */
export function sdkKeyFrom(h: { authorization?: string | null; apiKey?: string | null }): string | null {
  const bearer = /^bearer\s+(\S+)\s*$/i.exec((h.authorization ?? '').trim());
  if (bearer) return bearer[1];
  const key = (h.apiKey ?? '').trim();
  return key || null;
}
/** 데모 기본 키를 둘지 — 데모 인증 방식이고 FF_OFREP_DEMO_KEY=off가 아닐 때(인증 방식 판정은 kernel/auth/auth-config authModeOf와 같다) */
export function demoSdkKeyEnabled(env: Record<string, string | undefined>): boolean {
  if ((env.FF_OFREP_DEMO_KEY ?? '').trim() === 'off') return false;
  const mode = (env.FF_AUTH ?? '').trim();
  if (mode === 'oidc') return false;
  if (mode === 'demo') return true;
  return env.FF_ENV !== 'production';
}
