// API 클라이언트 — 경로는 @ff/contracts ROUTES 하나에서 온다(백엔드 실제 라우트와 테스트로 일치 보장).
// 쓰기 요청은 행위자 헤더와 Idempotency-Key를 자동으로 붙이고, 오류 봉투 {error:{code,message}}를 ApiError로 바꾼다.
// 오류는 종류(kind)로 나눠 사용자 말로 안내한다(출시 준비 RD-UX-01) — 401 다시 로그인·409/412 다시 불러오기·400/422 입력 칸 오류·
// 429 잠시 뒤·5xx 문의 번호(X-Correlation-Id)·연결 끊김. 문구는 copy/errors.ts.
// 정적 데모(VITE_DATA_MODE=static, Cloudflare)에서는 GET을 미리 떠 둔 스냅샷에서 읽고, 쓰기는 이 브라우저 안의 시연 데이터(api/sim)가
// 서버와 같은 규칙으로 처리한다 — 첫 쓰기 때 불러오고, 바뀐 것이 있으면(SIM_FLAG) 읽기도 그 위에 덮는다(20-60).
import { DATA_CATEGORY_ACCESS, ROUTES, routeUrl, snapshotFile, type Role, type RouteDef } from '@ff/contracts';
import { OIDC_AUTH } from '../auth-mode';
import { gateSessionEnded } from '../auth-demo';
import { ssoLoggedOut, startSsoLogin } from '../auth-oidc';
import { errors as E } from '../copy/errors';
import { hasUnsaved } from '../design/unsaved';
import { actorFor } from './actor';
import { errorKind, retryAfterSeconds, userMessage, type ErrorKind } from './errors';
import { markSessionExpired } from './session';
import { notifyWrite } from './writes';

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

/**
 * 역할마다 응답이 다른 조회(personal) 중 경로에 역할 제한이 없는 것 — 이 사람이 맡은 역할 중 더 많이 보는 역할로 묻는다.
 * Feature DB 금액 칸(벤치마크 €)은 서버가 DB 관리자 역할에만 준다(backend refdb read-view BENCHMARK_VIEWERS).
 * PLM 기준정보 계정의 첫 역할은 BOM 승인이라, 그대로 보내면 관리자에게도 금액이 안 보였다(하네스 리뷰 F1)
 */
export const VIEW_ROLES: Partial<Record<string, readonly Role[]>> = {
  listRefs: ['REFDB_ADMIN'],
  refDetail: ['REFDB_ADMIN'],
  listRefChanges: ['REFDB_ADMIN'],
  refChangeDetail: ['REFDB_ADMIN'],
  exportRefdb: ['REFDB_ADMIN'],
  // 홈 수신 현황 요약 — 회신(운영 데이터 범주)을 읽는 역할로 물어야 회신 건수가 들어간다
  operationSummary: DATA_CATEGORY_ACCESS.SAFETY_OPERATION,
};

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

/** 401 — 입력이 없으면 지금 화면으로 돌아오는 로그인으로, 있으면 셸 안내 띠가 묻는다(입력을 지키기 위해 바로 옮기지 않는다) */
function onUnauthenticated() {
  // 로그아웃한 뒤 늦게 끝난 요청의 401 — 세션 만료가 아니다. 로그인 화면에 머문다
  if (OIDC_AUTH && ssoLoggedOut()) return;
  // 공개 데모 게이트 — 서버 세션이 끝났고 입력이 없으면 로그인 화면으로(게이트 없는 데모는 그대로)
  if (!OIDC_AUTH && !hasUnsaved() && gateSessionEnded()) return;
  markSessionExpired();
  if (OIDC_AUTH && !hasUnsaved()) startSsoLogin();
}

/** 이 브라우저에 바뀐 시연 데이터가 있다는 표시(값 = 스냅샷 판) — api/sim/store가 쓰고 지운다 */
export const SIM_FLAG = 'ff.sim';
const simActive = () => {
  try {
    return localStorage.getItem(SIM_FLAG) !== null;
  } catch {
    return false;
  }
};
let sim: Promise<typeof import('./sim')> | null = null;
/** 시연 엔진 — 정적 모드의 첫 쓰기(또는 스냅샷에 없는 읽기) 때 불러온다 */
export const loadSim = () => (sim ??= import('./sim'));
const SIMULATED_READS = new Set(['workflowIdentity', 'workflowAssignableAccounts', 'workflowRoleGrants', 'workflowCases', 'workflowCase', 'workflowCaseSources', 'workflowTransferTargets', 'softwarePackages', 'softwarePackage', 'softwareDownloadHistory', 'exceptionPolicies', 'exceptionPolicy', 'policyReleaseGate', 'listPolicies', 'policyDetail', 'activationDecide']);

/** 공개 사이트 접속 게이트 응답 표식 — functions/_middleware.ts GATE_MARK와 같다(시험 staticGate가 맞춰 본다) */
export const GATE_MARK = 'ff-gate-v1';
let gateLeaving = false;
/**
 * 정적 사이트 — 게이트 쿠키가 끝나 스냅샷 요청이 401(게이트 표식)이면 화면 로그인 표식(ff.auth)을 지우고
 * 지금 주소로 돌아오는 로그인으로 옮긴다(SPA 안에 '스냅샷에 없음' 오류만 남지 않게). 게이트 401이 아니면 null
 */
export async function gateDenied(res: Response): Promise<ApiError | null> {
  if (res.status !== 401) return null;
  const data = parseBody(await res.clone().text());
  if (data?.gate !== GATE_MARK) return null;
  if (!gateLeaving) {
    gateLeaving = true;
    try {
      localStorage.removeItem('ff.auth');
    } catch {
      /* 저장소 막힘 — 이동만 */
    }
    const here = window.location.pathname + window.location.search + window.location.hash;
    window.location.assign(`${import.meta.env.BASE_URL}login?next=${encodeURIComponent(here)}`);
  }
  return toApiError(res, data);
}
/** 시험용 */
export const __resetGateForTest = () => void (gateLeaving = false);

/** 정적 데모 — ROUTES 밖 스냅샷 파일(OFREP 평가 등)을 읽는다. 없으면(SPA 대체 응답) call과 같은 '스냅샷에 없음' 404 */
export async function readSnapshotFile<T = any>(file: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(import.meta.env.BASE_URL + file, { signal });
  const gate = await gateDenied(res);
  if (gate) throw gate;
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new ApiError(404, 'NOT_FOUND', E.notInSnapshot);
  return res.json();
}

export async function call<T = any>(name: RouteName | string, opts: CallOptions = {}): Promise<T> {
  const route = BY_NAME.get(name);
  if (!route) throw new Error(E.unknownApi(name));
  const url = pathOf(name, opts.params, opts.query);
  const write = route.method !== 'GET';

  if (STATIC_MODE) {
    // 쓰기·바뀐 시연 데이터가 있는 읽기는 시연 엔진으로(첫 화면 묶음에 넣지 않는다)
    // Apply workflow persona scope and software capture provenance before the first browser-local write too.
    if (write || simActive() || SIMULATED_READS.has(route.name)) return (await loadSim()).simCall<T>(route, url, opts);
    const res = await fetch(import.meta.env.BASE_URL + snapshotFile(url), { signal: opts.signal });
    // 접속 게이트 쿠키 만료 — 시연 엔진으로 넘기지 않는다(넘기면 '스냅샷에 없음' 404로 보인다)
    const gate = await gateDenied(res);
    if (gate) throw gate;
    // 정적 호스팅은 없는 파일에 SPA 대체 응답(index.html, 200)을 준다 — JSON이 아니면 '스냅샷에 없음'으로 본다(파싱 오류로 화면이 깨지지 않게)
    // 스냅샷에 없는 질의(입력에 따라 바뀌는 미리보기 등)는 시연 엔진이 같은 규칙으로 계산할 수 있으면 계산한다. 못 하면 같은 404
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return (await loadSim()).simCall<T>(route, url, opts);
    return res.json();
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  // 쓰기와 계정별 조회(내 알림)는 행위자 헤더를 붙인다
  if (write || (route.personal && opts.role)) {
    const a = actorFor(opts.role ?? 'viewer', opts.actorRole && route.roles?.includes(opts.actorRole) ? [opts.actorRole, ...route.roles] : (route.roles ?? (write ? undefined : VIEW_ROLES[name])));
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
  if (write) notifyWrite(name);
  return data as T;
}
