// 대시보드 아이콘 — Atlassian식 얇은 16px 선 아이콘(장식, aria-hidden). 이름이 있는 버튼 안에서만 쓴다.
import type { Category } from './catalog';
import type { LayoutKind } from './layout';

const P = {
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z',
  chevronDown: 'M4 6l4 4 4-4',
  more: '',
  refresh: 'M13 3v3.5H9.5M13 6.5A5 5 0 1 0 13.6 10',
  edit: 'M3 13l.6-2.7L10.8 3a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L5.7 12.4ZM9.6 4.2l2.2 2.2',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  grip: '',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm3.2 7.7L13.5 13.5',
  check: 'M3.5 8.5l3 3 6-7',
} as const;

export function Glyph({ name, size = 16 }: { name: keyof typeof P; size?: number }) {
  if (name === 'more')
    return (
      <svg className="jd-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
        <circle cx="3" cy="8" r="1.4" fill="currentColor" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" />
        <circle cx="13" cy="8" r="1.4" fill="currentColor" />
      </svg>
    );
  if (name === 'grip')
    return (
      <svg className="jd-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
        {[4, 8, 12].flatMap((y) => [<circle key={`a${y}`} cx="6" cy={y} r="1.1" fill="currentColor" />, <circle key={`b${y}`} cx="10" cy={y} r="1.1" fill="currentColor" />])}
      </svg>
    );
  return (
    <svg className="jd-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}

/** 레이아웃 썸네일 — 열 비율 그대로 */
const COLS: Record<LayoutKind, [number, number][]> = {
  '1': [[2, 20]],
  '2': [[2, 9.5], [12.5, 9.5]],
  '2L': [[2, 12.5], [15.5, 6.5]],
  '2R': [[2, 6.5], [9.5, 12.5]],
  '3': [[2, 5.6], [9.2, 5.6], [16.4, 5.6]],
};
export function LayoutThumb({ layout }: { layout: LayoutKind }) {
  return (
    <svg className="jd-thumb" width="24" height="18" viewBox="0 0 24 18" aria-hidden focusable="false">
      {COLS[layout].map(([x, w], i) => (
        <rect key={i} x={x} y="2" width={w} height="14" rx="1" />
      ))}
    </svg>
  );
}

/** 가젯 분류 아이콘 — 디렉터리 카드 왼쪽 */
export function CategoryIcon({ category }: { category: Category }) {
  const d = {
    charts: 'M10 3a7 7 0 1 0 7 7h-7Z M12 1.5V8h6.5A6.5 6.5 0 0 0 12 1.5Z',
    lists: 'M4 5h12M4 10h12M4 15h8',
    ops: 'M10 2.5 16.5 6v8L10 17.5 3.5 14V6ZM10 10l6.5-4M10 10v7.5M10 10 3.5 6',
    shortcuts: 'M8.5 11.5l3-3M7 9.5 5.5 11a2.5 2.5 0 0 0 3.5 3.5l1.5-1.5M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7',
  }[category];
  return (
    <span className="jd-caticon" data-category={category} aria-hidden>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d={d} />
      </svg>
    </span>
  );
}
