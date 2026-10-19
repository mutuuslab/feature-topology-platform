// 선형 아이콘 세트 — 1.6px 스트로크, 20×20 격자. 이모지 대신 쓴다(플랫폼·폰트마다 모양이 달라지지 않게).
import type { SVGProps } from 'react';

const P: Record<string, string> = {
  home: 'M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1Z',
  feature: 'M4 4h12v12H4zM4 8h12M8 8v8',
  topology: 'M5 5.5a1.5 1.5 0 1 0 0 .01M15 5.5a1.5 1.5 0 1 0 0 .01M10 15a1.5 1.5 0 1 0 0 .01M6.3 6.4l2.9 7.2M13.7 6.4l-2.9 7.2M6.5 5.5h7',
  master: 'M4 5c0-1 2.7-2 6-2s6 1 6 2-2.7 2-6 2-6-1-6-2Zm0 0v10c0 1 2.7 2 6 2s6-1 6-2V5M4 10c0 1 2.7 2 6 2s6-1 6-2',
  gate: 'M4 4h3v12H4zM13 4h3v12h-3zM7 7h6M7 13h6',
  release: 'M10 3c3 2 4.5 5 4.5 8.5L12 14H8l-2.5-2.5C5.5 8 7 5 10 3ZM8 14l-1.5 3M12 14l1.5 3M10 8.5a1 1 0 1 0 0 .01',
  ops: 'M10 3.5 16.5 7v6L10 16.5 3.5 13V7ZM10 10l6.5-3M10 10v6.5M10 10 3.5 7',
  link: 'M8.5 11.5l3-3M7 9.5 5.5 11a2.5 2.5 0 0 0 3.5 3.5l1.5-1.5M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7',
  search: 'M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4Zm3.6 8.6L16 16',
  command: 'M7 4a2 2 0 1 0 0 4h6a2 2 0 1 0 0-4v12a2 2 0 1 0 0-4H7a2 2 0 1 0 0 4Z',
  sun: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1',
  moon: 'M15.5 12.5A6 6 0 0 1 7.5 4.5a6 6 0 1 0 8 8Z',
  present: 'M3 4h14v9H3zM10 13v3M7 17h6M6 10l2.5-2.5L10.5 9.5 14 6',
  bell: 'M6 8a4 4 0 0 1 8 0c0 4 1.5 5 1.5 5h-11S6 12 6 8ZM8.5 15.5a1.5 1.5 0 0 0 3 0',
  play: 'M7 5l8 5-8 5Z',
  pause: 'M7 5h2v10H7zM11 5h2v10h-2z',
  chevron: 'M8 6l4 4-4 4',
  chevronLeft: 'M12 6l-4 4 4 4',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  copy: 'M7 7h8v9H7zM5 13V4h8',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  alert: 'M10 3.5 17 16H3ZM10 8.5v3.5M10 14.2v.1',
  filter: 'M3.5 5h13l-5 6v5l-3-1.5V11Z',
  user: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 16.5c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4',
  layers: 'M10 3 17 7l-7 4-7-4ZM3 10.5l7 4 7-4M3 14l7 4 7-4',
  grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
  lock: 'M6.5 9V7a3.5 3.5 0 0 1 7 0v2M5 9h10v8H5zM10 12.2v2.2',
  book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5ZM4 16.5A1.5 1.5 0 0 0 5.5 18H16v-3',
  shield: 'M10 3l6 2.5V10c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V5.5Z',
  pen: 'M4 16l1-4 8.5-8.5 3 3L8 15ZM12 5l3 3',
  minimize: 'M5 15h10',
  target: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM10 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM10 1.5V4M10 16v2.5M1.5 10H4M16 10h2.5',
  logout: 'M12 3h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3M4 10h8M9.5 7l3 3-3 3',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, title, ...rest }: { name: IconName; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}

/** Gate·판정 모양 — 색맹 사용자도 구분: ● PASS · ◐ 검토 중 · ○ 미판정 · ✕ FAIL · – 해당 없음 */
export function StatusGlyph({ kind, size = 9 }: { kind: 'PASS' | 'REVIEW' | 'UNJUDGED' | 'FAIL' | 'DOT' | 'NA'; size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden className="ds-badge__glyph">
      {kind === 'PASS' || kind === 'DOT' ? <circle cx="5" cy="5" r="4.2" fill="currentColor" /> : null}
      {kind === 'REVIEW' ? (
        <>
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 1a4 4 0 0 1 0 8Z" fill="currentColor" />
        </>
      ) : null}
      {kind === 'NA' ? <path d="M2 5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : null}
      {kind === 'UNJUDGED' ? <circle cx="5" cy="5" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.4" /> : null}
      {kind === 'FAIL' ? <path d="M1.8 1.8l6.4 6.4M8.2 1.8 1.8 8.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
    </svg>
  );
}
