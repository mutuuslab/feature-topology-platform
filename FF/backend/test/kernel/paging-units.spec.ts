// readiness: RD-UX-03 — 목록 커서 페이지 나눔: limit이 없으면 전체(뒤 호환), 커서는 불투명·위조 거부.
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, pageLimit, pageOf } from '../../src/kernel/paging';

describe('목록 페이지 나눔 (RD-UX-03)', () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => i);

  it('limit이 없으면 전체와 nextCursor null — 예전 호출 모양 그대로', () => {
    expect(pageOf(rows, undefined, undefined)).toEqual({ items: rows, nextCursor: null });
  });

  it('1만 행을 커서로 끝까지 — 겹침·빠짐 없음', () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const p = pageOf(rows, 500, cursor)!;
      seen.push(...p.items);
      cursor = p.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(20);
    expect(seen).toEqual(rows);
  });

  it('limit 범위 — 1..500, 숫자가 아니면 전체', () => {
    expect(pageLimit('0')).toBe(1);
    expect(pageLimit('9999')).toBe(500);
    expect(pageLimit('abc')).toBeUndefined();
    expect(pageLimit(undefined)).toBeUndefined();
  });

  it('위조·깨진 커서는 null(호출자가 거부)', () => {
    expect(decodeCursor('***')).toBeNull();
    expect(decodeCursor('bm90LWpzb24')).toBeNull();
    expect(pageOf(rows, 10, encodeCursor({ o: -5 }))).toBeNull();
    expect(decodeCursor(encodeCursor({ o: 30 }))).toEqual({ o: 30 });
  });
});
