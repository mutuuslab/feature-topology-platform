// 목록 페이지 나눔(출시 준비 RD-UX-03) — 커서는 불투명 문자열(base64url JSON). limit이 없으면 예전처럼 전체(뒤 호환). 백엔드 전용(프론트 첫 화면 묶음에 넣지 않는다).
// 응답은 { items, nextCursor } — nextCursor가 null이면 마지막 페이지.

export const PAGE_LIMIT_MAX = 500;

/** 페이지 크기 질의 → 1..PAGE_LIMIT_MAX, 숫자가 아니면 undefined(전체) */
export function pageLimit(raw: unknown, max = PAGE_LIMIT_MAX): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Math.floor(Number(raw));
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
export function decodeCursor(cursor: string | undefined | null): Record<string, unknown> | null {
  if (!cursor) return null;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(cursor)) return null;
  try {
    const v = JSON.parse(fromB64Url(cursor));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 메모리 목록의 오프셋 커서 페이지 — limit이 없으면 전체와 nextCursor null */
export function pageOf<T>(items: T[], limit: number | undefined, cursor: string | undefined | null): { items: T[]; nextCursor: string | null } | null {
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
