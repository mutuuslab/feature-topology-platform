// API 클라이언트 — 경로는 @ff/contracts ROUTES 하나에서 온다(백엔드 실제 라우트와 테스트로 일치 보장).
// 쓰기 요청은 행위자 헤더와 Idempotency-Key를 자동으로 붙이고, 오류 봉투 {error:{code,message}}를 ApiError로 바꾼다.
// 오류는 종류(kind)로 나눠 사용자 말로 안내한다(출시 준비 RD-UX-01) — 401 다시 로그인·409/412 다시 불러오기·400/422 입력 칸 오류·
// 429 잠시 뒤·5xx 문의 번호(X-Correlation-Id)·연결 끊김. 문구는 copy/errors.ts.
// 정적 데모(VITE_DATA_MODE=static, Cloudflare)에서는 GET을 미리 떠 둔 스냅샷에서 읽고 쓰기는 막는다.
import { ROUTES, routeUrl, snapshotFile, type Role, type RouteDef } from '@ff/contracts';
import { OIDC_AUTH } from '../auth-mode';
import { ssoStatus, startSsoLogin } from '../auth-oidc';
import { errors as E } from '../copy/errors';
import { hasUnsaved } from '../design/unsaved';
import { actorFor } from './actor';
import { errorKind, retryAfterSeconds, userMessage, type ErrorKind } from './errors';
import { markSessionExpired } from './session';

export const STATIC_MODE = import.meta.env.VITE_DATA_MODE === 'static';

export class ApiError extends Error {
  /** 사용자가 할 다음 행동을 고르는 종류 */
  readonly kind: ErrorKind;
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: any,
    /** 서버 상관 ID(X-Correlation-Id) — 지원 문의 번호 */
    readonly correlationId: string | null = null,
    /** 429 — 다시 시도까지 초 */
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.kind = errorKind(status);
  }
}

export type RouteName = (typeof ROUTES)[number]['name'];
const BY_NAME = new Map<string, RouteDef>(ROUTES.map((r) => [r.name, r]));

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** 현재 화면의 역할(레거시 키) — 쓰기 요청의 행위자 */
  role?: string;
  /** 이 요청에서 맡을 플랫폼 역할 — 한 사람이 여러 승인 역할을 맡을 때 화면이 정한다(예: 빈 칸이 FSM이면 FSM으로 서명). 맡지 않은 역할이면 무시 */
  actorRole?: Role;
  signal?: AbortSignal;
  /** 낙관적 잠금 — 화면이 본 버전(If-Match). 다르면 서버가 412 */
  ifMatch?: string | number;
}

/** 요청 URL — contracts의 routeUrl (정적 스냅샷 도구와 같은 규칙) */
export const pathOf = (name: string, params: Record<string, string> = {}, query: CallOptions['query'] = {}) => routeUrl(name, params, query ?? {});

/** 계정마다 결과가 다른 조회인가 — 캐시 키에 역할을 넣는다 */
export const isPersonal = (name: string) => !!BY_NAME.get(name)?.personal;

/** 응답 본문 — JSON이 아니면(앞단 프록시의 HTML 오류 쪽 등) null. 깨진 JSON으로 화면이 멈추지 않게 */
function parseBody(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 응답 → ApiError (사용자 문장·문의 번호·다시 시도 초) */
export function toApiError(res: Pick<Response, 'status' | 'headers'>, data: any): ApiError {
  const err = data?.error;
  const kind = errorKind(res.status);
  const retry = kind === 'rateLimit' ? retryAfterSeconds(res.headers.get('Retry-After'), err?.details) : null;
  const message = userMessage(kind, res.status, typeof err?.message === 'string' ? err.message : undefined, retry);
  return new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, message, err?.details, res.headers.get('X-Correlation-Id'), retry);
}

/** 연결 실패 → ApiError(status 0) */
export const networkError = () => new ApiError(0, 'NETWORK', userMessage('network', 0, undefined));

/**
 * 401 — 입력이 없으면 지금 화면으로 돌아오는 로그인으로, 있으면 셸 안내 띠가 묻는다(입력을 지키기 위해 바로 옮기지 않는다).
 * 로그아웃한(anon) 화면은 끌고 가지 않는다 — 로그아웃 직후 아직 돌던 조회의 401이 로그인 화면 대신 IdP 로그인으로 보냈다(e2e:oidc 회귀)
 */
function onUnauthenticated() {
  if (OIDC_AUTH && ssoStatus() === 'anon') return;
  markSessionExpired();
  if (OIDC_AUTH && !hasUnsaved()) startSsoLogin();
}

export async function call<T = any>(name: RouteName | string, opts: CallOptions = {}): Promise<T> {
  const route = BY_NAME.get(name);
  if (!route) throw new Error(E.unknownApi(name));
  const url = pathOf(name, opts.params, opts.query);
  const write = route.method !== 'GET';

  if (STATIC_MODE) {
    if (write) throw new ApiError(403, 'READ_ONLY_DEMO', E.readOnlyDemo);
    const res = await fetch(import.meta.env.BASE_URL + snapshotFile(url), { signal: opts.signal });
    // 정적 호스팅은 없는 파일에 SPA 대체 응답(index.html, 200)을 준다 — JSON이 아니면 '스냅샷에 없음'으로 본다(파싱 오류로 화면이 깨지지 않게)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new ApiError(404, 'NOT_FOUND', E.notInSnapshot);
    return res.json();
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  // 쓰기와 계정별 조회(내 알림)는 행위자 헤더를 붙인다
  if (write || (route.personal && opts.role)) {
    const a = actorFor(opts.role ?? 'viewer', opts.actorRole && route.roles?.includes(opts.actorRole) ? [opts.actorRole, ...route.roles] : route.roles);
    // SSO — 신원은 세션 쿠키가 정한다. ID 머리글은 보내지 않고, 역할은 부여받은 것 중 하나만 고른다(서버가 다시 확인)
    if (!OIDC_AUTH) headers['X-Actor-Id'] = a.id;
    headers['X-Actor-Role'] = a.role;
  }
  if (write) {
    headers['Idempotency-Key'] = crypto.randomUUID();
    headers['Content-Type'] = 'application/json';
    if (opts.ifMatch !== undefined) headers['If-Match'] = `"${opts.ifMatch}"`;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: route.method, headers, body: write ? JSON.stringify(opts.body ?? {}) : undefined, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw networkError();
  }
  // 세션이 끝났다(SSO 유휴·절대 만료)
  if (res.status === 401) onUnauthenticated();
  const data = parseBody(await res.text());
  if (!res.ok) throw toApiError(res, data);
  return data as T;
}
