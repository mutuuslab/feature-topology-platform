// API 오류 분류(출시 준비 RD-UX-01) — 상태 코드·오류 코드를 "사용자가 무엇을 하면 되는가"로 나눈다.
// client.ts가 ApiError를 만들 때 쓰고, 화면은 kind로 다음 행동(다시 로그인·다시 불러오기·문의 번호)을 고른다.
import { errors as E } from '../copy/errors';

export type ErrorKind = 'network' | 'auth' | 'forbidden' | 'notFound' | 'conflict' | 'validation' | 'rateLimit' | 'server' | 'other';

/** 상태(0 = 응답 없음)·오류 코드 → 종류 */
export function errorKind(status: number): ErrorKind {
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409 || status === 412) return 'conflict';
  // 400(본문 검사 VALIDATION)·422(업무 조건 GUARD_FAILED) — 둘 다 입력·조건을 고치면 되는 오류
  if (status === 400 || status === 422) return 'validation';
  if (status === 429) return 'rateLimit';
  if (status >= 500) return 'server';
  return 'other';
}

/** Retry-After(초 또는 HTTP 날짜) → 초. 없거나 읽을 수 없으면 null */
export function retryAfterSeconds(header: string | null | undefined, details?: unknown, now = Date.now()): number | null {
  const fromDetails = (details as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
  if (typeof fromDetails === 'number' && fromDetails > 0) return Math.ceil(fromDetails);
  if (!header) return null;
  const n = Number(header.trim());
  if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(1, Math.ceil((at - now) / 1000)) : null;
}

/**
 * 사용자에게 보일 문장 — 서버가 준 업무 문장(한글)은 4xx에서 그대로 쓰고, 연결·세션·과부하·서버 오류는 우리 문장으로 바꾼다
 * (서버 내부 문장·포트·프로그램 이름을 화면에 내지 않는다).
 */
export function userMessage(kind: ErrorKind, status: number, serverMessage: string | undefined, o: { online?: boolean; retryAfterSec?: number | null } = {}): string {
  switch (kind) {
    case 'network':
      return o.online === false ? E.offline : E.network;
    case 'auth':
      return E.auth;
    case 'rateLimit':
      return E.rateLimit(o.retryAfterSec ?? null);
    case 'server':
      return E.server;
    case 'conflict':
      return serverMessage || E.conflictFallback;
    case 'validation':
      return serverMessage || E.validationFallback;
    case 'notFound':
      return serverMessage || E.notFound;
    default:
      return serverMessage || E.failed(status);
  }
}

/**
 * 입력 칸별 오류 — 서버 오류 상세에서 칸 이름 → 문장.
 *   · 요청 본문 검사(ZodPipe): details = [{ path: 'name' | 'tags.0', message }]
 *   · 업무 검사: details.fields = ['country', …] (그 칸들 모두에 오류 문장)
 *   · details.field = 'name'
 * 경로 'tags.0'은 'tags.0'과 맨 앞 이름 'tags' 둘 다로 찾을 수 있다.
 */
export function fieldErrors(err: { message?: string; details?: unknown } | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!err) return out;
  const d = err.details as any;
  const put = (path: string, message: string) => {
    if (!path) return;
    out[path] ??= message;
    const top = path.split('.')[0];
    out[top] ??= message;
  };
  if (Array.isArray(d)) for (const x of d) if (x && typeof x.path === 'string') put(x.path, String(x.message ?? err.message ?? ''));
  if (d && !Array.isArray(d) && typeof d === 'object') {
    if (Array.isArray(d.fields)) for (const f of d.fields) if (typeof f === 'string') put(f, err.message ?? E.validationFallback);
    if (typeof d.field === 'string') put(d.field, err.message ?? E.validationFallback);
  }
  return out;
}

/** 조회 자동 재시도 대상 — 연결 끊김·서버 오류만(401·403·409·입력 오류는 다시 보내도 같다) */
export const shouldRetry = (e: unknown) => {
  const kind = (e as { kind?: ErrorKind } | null)?.kind;
  return kind === undefined || kind === 'network' || kind === 'server';
};
