// 목록 페이지 나눔(출시 준비 RD-UX-03) — 커서는 불투명 문자열(base64url JSON). limit이 없으면 예전처럼 전체(뒤 호환). 백엔드 전용(프론트 첫 화면 묶음에 넣지 않는다).
// 응답은 { items, nextCursor } — nextCursor가 null이면 마지막 페이지.
// 질의 값은 문자열 하나만 — Express(qs)는 limit=5&limit=6을 배열로, limit[a]=5를 객체로 넘긴다(매개변수 변조). 배열을 숫자로 읽으면 NaN → '전체'가 되어 페이지 나눔을 건너뛰었다.
import { DomainError } from './errors';

export const PAGE_LIMIT_MAX = 500;

/** 질의 값 하나 — 문자열(또는 코드에서 넘긴 숫자)만. 배열·객체면 VALIDATION(field) */
export function singleQuery(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  throw new DomainError('VALIDATION', `질의 ${field}는 한 번만, 값 하나로 보내세요.`, { field });
}

/** 페이지 크기 질의 → 1..PAGE_LIMIT_MAX, 숫자가 아니면 undefined(전체). 배열·객체는 VALIDATION */
export function pageLimit(raw: unknown, max = PAGE_LIMIT_MAX): number | undefined {
  const v = singleQuery(raw, 'limit');
  if (v === undefined || v === '') return undefined;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(n, 1), max);
}

// 커서 내용은 ASCII(숫자·짧은 키)뿐 — btoa/atob(브라우저·Node 공통)로 충분하다
const toB64Url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export function encodeCursor(v: Record<string, string | number>): string {
  return toB64Url(JSON.stringify(v));
}

/** 읽을 수 없는 커서는 null — 호출자가 VALIDATION으로 거부한다 */
export function decodeCursor(cursor: unknown): Record<string, unknown> | null {
  if (typeof cursor !== 'string' || !cursor) return null;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(cursor)) return null;
  try {
    const v = JSON.parse(fromB64Url(cursor));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 메모리 목록의 오프셋 커서 페이지 — limit이 없으면 전체와 nextCursor null */
export function pageOf<T>(items: T[], limit: number | undefined, cursor: unknown): { items: T[]; nextCursor: string | null } | null {
  if (limit === undefined) return { items, nextCursor: null };
  let offset = 0;
  if (cursor) {
    const c = decodeCursor(cursor);
    if (!c || typeof c.o !== 'number' || !Number.isInteger(c.o) || c.o < 0) return null;
    offset = c.o;
  }
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit;
  return { items: slice, nextCursor: next < items.length ? encodeCursor({ o: next }) : null };
}
