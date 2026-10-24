// API 클라이언트 — 경로는 @ff/contracts ROUTES 하나에서 온다(백엔드 실제 라우트와 테스트로 일치 보장).
// 쓰기 요청은 행위자 헤더와 Idempotency-Key를 자동으로 붙이고, 오류 봉투 {error:{code,message}}를 ApiError로 바꾼다.
// 정적 데모(VITE_DATA_MODE=static, Cloudflare)에서는 GET을 미리 떠 둔 스냅샷에서 읽고 쓰기는 막는다.
import { ROUTES, routeUrl, snapshotFile, type Role, type RouteDef } from '@ff/contracts';
import { OIDC_AUTH } from '../auth-mode';
import { startSsoLogin } from '../auth-oidc';
import { actorFor } from './actor';

export const STATIC_MODE = import.meta.env.VITE_DATA_MODE === 'static';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: any,
  ) {
    super(message);
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
}

/** 요청 URL — contracts의 routeUrl (정적 스냅샷 도구와 같은 규칙) */
export const pathOf = (name: string, params: Record<string, string> = {}, query: CallOptions['query'] = {}) => routeUrl(name, params, query ?? {});

/** 계정마다 결과가 다른 조회인가 — 캐시 키에 역할을 넣는다 */
export const isPersonal = (name: string) => !!BY_NAME.get(name)?.personal;

export async function call<T = any>(name: RouteName | string, opts: CallOptions = {}): Promise<T> {
  const route = BY_NAME.get(name);
  if (!route) throw new Error(`알 수 없는 API: ${name}`);
  const url = pathOf(name, opts.params, opts.query);
  const write = route.method !== 'GET';

  if (STATIC_MODE) {
    if (write) throw new ApiError(403, 'READ_ONLY_DEMO', '읽기 전용 데모입니다. 변경은 플랫폼 백엔드에 연결된 환경에서만 할 수 있습니다.');
    const res = await fetch(import.meta.env.BASE_URL + snapshotFile(url), { signal: opts.signal });
    // 정적 호스팅은 없는 파일에 SPA 대체 응답(index.html, 200)을 준다 — JSON이 아니면 '스냅샷에 없음'으로 본다(파싱 오류로 화면이 깨지지 않게)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new ApiError(404, 'NOT_FOUND', '데모 스냅샷에 없는 데이터입니다.');
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
  }
  let res: Response;
  try {
    res = await fetch(url, { method: route.method, headers, body: write ? JSON.stringify(opts.body ?? {}) : undefined, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', '플랫폼 백엔드에 연결할 수 없습니다. 백엔드(9101)가 실행 중인지 확인하세요.');
  }
  // SSO 세션이 끝났다(유휴·절대 만료) — 지금 화면을 되돌아올 곳으로 다시 로그인
  if (OIDC_AUTH && res.status === 401) startSsoLogin();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? `요청 실패 (${res.status})`, err?.details);
  }
  return data as T;
}
