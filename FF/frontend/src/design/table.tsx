// 데이터 표 — 고정 머리글, 열 정렬, 키보드 행 이동(↑↓·Home·End·Enter).
// 큰 목록은 나눠 그린다(출시 준비 RD-UX-03) — 정렬은 전체 행에, 그리기는 한 쪽(기본 100행)만. 1만 행이어도 DOM 행 수는 한 쪽 크기.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ko } from '../copy/ko';
import { lists as L } from '../copy/lists';
import { Button } from './primitives';

/** 표 한 쪽 기본 행 수 */
export const TABLE_PAGE_SIZE = 100;

/** 쪽 넘김 — 범위(1–100 / 1만 건)와 이전·다음. 표 아래와 서버 페이지 목록에 같이 쓴다 */
export function Pager({ page, pageSize, total, onPage, label }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav className="ds-pager" aria-label={label ?? L.pager}>
      <Button disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label={`${label ?? L.pager} ${L.prev}`}>
        {L.prev}
      </Button>
      <span className="ds-mono" aria-live="polite">
        {L.range(from, to, total)} · {L.pageOf(page + 1, pages)}
      </span>
      <Button disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label={`${label ?? L.pager} ${L.next}`}>
        {L.next}
      </Button>
    </nav>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** 정렬 키 — 없으면 정렬 불가 */
  sort?: (row: T) => string | number;
  align?: 'left' | 'right';
  width?: string;
  /** 보조 열 — 좁은 화면(1600px 미만)에서는 숨긴다. 상세 화면에 같은 값이 있는 열에만 쓴다 */
  minor?: boolean;
  /** 머리글을 비운 열의 화면낭독기 전용 이름 — 없으면 '작업'(빈 th는 axe empty-table-header) */
  srHeader?: string;
}

/** 셀 안의 버튼·링크·입력(IdChip 복사·요약 보기 등)에서 온 클릭·키는 행 열기로 올리지 않는다 */
const fromControl = (e: { target: EventTarget; currentTarget: EventTarget }) => {
  const c = (e.target as HTMLElement).closest?.('button, a, input, select, textarea, [role="button"]');
  return !!c && c !== e.currentTarget;
};

export function DataTable<T>({ rows, columns, rowKey, onOpen, caption, maxHeight, initialSort, pageSize = TABLE_PAGE_SIZE }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  caption: string;
  maxHeight?: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** 한 쪽 행 수 — 넘으면 쪽 넘김(Pager)으로 나눠 그린다. 0이면 나누지 않는다 */
  pageSize?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // 열이 단어보다 좁아지지 않으므로 좁은 패널에서는 표가 가로로 넘친다 — 넘칠 때만 키보드로 스크롤할 수 있게(axe scrollable-region-focusable)
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    check();
    return () => ro.disconnect();
  }, []);
  const keyScroll = scrolls && !onOpen;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a);
      const y = col.sort!(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, columns, sort]);

  // 한 쪽만 그린다 — 필터로 행이 줄어 지금 쪽이 비면 마지막 쪽으로
  const paged = pageSize > 0 && sorted.length > pageSize;
  const pages = paged ? Math.ceil(sorted.length / pageSize) : 1;
  const current = Math.min(page, pages - 1);
  const visible = paged ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;

  const focusRow = (i: number) => {
    const tr = body.current?.querySelectorAll<HTMLTableRowElement>('tr')[i];
    if (tr) {
      tr.focus();
      setActive(tr.dataset.key ?? null);
    }
  };

  return (
    <>
    <div
      ref={wrap}
      className="ds-table-wrap"
      style={maxHeight ? ({ '--table-max-h': maxHeight } as React.CSSProperties) : undefined}
      tabIndex={keyScroll ? 0 : undefined}
      role={keyScroll ? 'region' : undefined}
      aria-label={keyScroll ? ko.action.scrollTable(caption) : undefined}
    >
      <table className="ds-table">
        <caption className="ds-sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : null;
              return (
                <th key={c.key} data-minor={c.minor || undefined} style={{ width: c.width, textAlign: c.align }} aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} scope="col">
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => (setSort({ key: c.key, dir: dir === 'asc' ? 'desc' : 'asc' }), setPage(0))}
                      aria-label={`${typeof c.header === 'string' ? c.header : c.key} ${dir === 'asc' ? ko.action.sortDesc : ko.action.sortAsc}`}
                    >
                      {c.header}
                      <span aria-hidden>{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span>
                    </button>
                  ) : c.header === '' ? (
                    <span className="ds-sr">{c.srHeader ?? ko.action.column}</span>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={body}>
          {visible.map((r, i) => {
            const k = rowKey(r);
            return (
              <tr
                key={k}
                data-key={k}
                tabIndex={onOpen ? (active === k || (!active && i === 0) ? 0 : -1) : undefined}
                data-clickable={!!onOpen}
                aria-selected={onOpen ? active === k : undefined}
                onClick={onOpen ? (e) => !fromControl(e) && onOpen(r) : undefined}
                onFocus={() => setActive(k)}
                onKeyDown={
                  onOpen
                    ? (e) => {
                        if (fromControl(e)) return;
                        if (e.key === 'ArrowDown') (e.preventDefault(), focusRow(Math.min(i + 1, visible.length - 1)));
                        else if (e.key === 'ArrowUp') (e.preventDefault(), focusRow(Math.max(i - 1, 0)));
                        else if (e.key === 'Home') (e.preventDefault(), focusRow(0));
                        else if (e.key === 'End') (e.preventDefault(), focusRow(visible.length - 1));
                        else if (e.key === 'Enter') onOpen(r);
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} data-minor={c.minor || undefined} className={c.align === 'right' ? 'num' : undefined}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {paged && <Pager page={current} pageSize={pageSize} total={sorted.length} onPage={(p) => (setPage(p), setActive(null))} label={caption} />}
    </>
  );
}
