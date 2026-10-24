// API 오류 분류(출시 준비 RD-UX-01) — 상태 코드를 "사용자가 무엇을 하면 되는가"로 나눈다.
// client.ts가 ApiError를 만들 때 쓰고, 화면은 kind로 다음 행동(다시 로그인·다시 불러오기·문의 번호)을 고른다. 첫 화면 묶음이라 작게.
import { errors as E } from '../copy/errors';

export type ErrorKind = 'network' | 'auth' | 'forbidden' | 'notFound' | 'conflict' | 'validation' | 'rateLimit' | 'server' | 'other';

const BY_STATUS: Record<number, ErrorKind> = { 0: 'network', 401: 'auth', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 412: 'conflict', 400: 'validation', 422: 'validation', 429: 'rateLimit' };

/** 상태(0 = 응답 없음) → 종류. 400(본문 검사 VALIDATION)·422(업무 조건 GUARD_FAILED)는 둘 다 입력·조건을 고치면 되는 오류 */
export const errorKind = (status: number): ErrorKind => BY_STATUS[status] ?? (status >= 500 ? 'server' : 'other');

/** 다시 시도까지 초 — 오류 상세 retryAfterSec 또는 Retry-After(초). 없으면 null */
export function retryAfterSeconds(header: string | null | undefined, details?: unknown): number | null {
  const d = (details as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
  const n = typeof d === 'number' ? d : Number(header ?? NaN);
  return Number.isFinite(n) && n >= 0 ? Math.max(1, Math.ceil(n)) : null;
}

/**
 * 사용자에게 보일 문장 — 서버가 준 업무 문장(한글)은 4xx에서 그대로, 연결·세션·과부하·서버 오류는 우리 문장으로
 * (서버 내부 문장·포트·프로그램 이름을 화면에 내지 않는다).
 */
export function userMessage(kind: ErrorKind, status: number, server: string | undefined, retryAfterSec: number | null = null): string {
  if (kind === 'network') return E.network;
  if (kind === 'auth') return E.auth;
  if (kind === 'rateLimit') return E.rateLimit(retryAfterSec);
  if (kind === 'server') return E.server;
  return server || (kind === 'conflict' ? E.conflictFallback : kind === 'validation' ? E.validationFallback : kind === 'notFound' ? E.notFound : E.failed(status));
}

/** 조회 자동 재시도 대상 — 연결 끊김·서버 오류만(401·403·409·입력 오류는 다시 보내도 같다) */
export const shouldRetry = (e: unknown) => {
  const kind = (e as { kind?: ErrorKind } | null)?.kind;
  return kind === undefined || kind === 'network' || kind === 'server';
};
