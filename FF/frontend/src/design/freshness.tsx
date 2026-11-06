// 데이터 신선도 칩(TL-UI01, 80-70 6장 1) — 텔레메트리 수치마다 출처 데이터셋·기준 시각·지연을 붙인다.
// 기준(SLA)을 넘으면 경고 색과 '판단 보류'를 글자로 함께 보인다(색만으로 구분하지 않게). 설명(title·접근 이름)에 보류 사유를 둔다.
import type { CSSProperties } from 'react';
import type { Freshness } from '@ff/contracts';
import { freshness as C } from '../copy/freshness';
import { StatusGlyph } from './icons';

/** 초 → 사람이 읽는 길이(분·시간·일) */
export function spanText(seconds: number): string {
  if (seconds < 3600) return C.minutes(Math.max(1, Math.round(seconds / 60)));
  if (seconds < 86_400) return C.hours(Math.round(seconds / 3600));
  return C.days(Math.round(seconds / 86_400));
}

const clock = (iso: string) => {
  const k = new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
  return `${k.slice(5, 10).replace('-', '.')} ${k.slice(11, 16)}`;
};

export function FreshnessChip({ f, compact }: { f: Freshness | null | undefined; compact?: boolean }) {
  if (!f) return null;
  const lag = f.lagSeconds == null ? C.unknown : f.lagSeconds < 90 ? C.now : C.lag(spanText(f.lagSeconds));
  const asOf = f.asOf ? C.asOf(clock(f.asOf)) : C.unknown;
  const hint = `${C.hint(f.dataset, asOf, spanText(f.slaSeconds))}${f.stale ? ` — ${C.holdReason(spanText(f.slaSeconds))}` : ''}`;
  return (
    <span className="ds-badge ds-fresh" data-fresh={f.stale ? 'stale' : 'ok'} title={hint} style={{ '--c': f.stale ? 'var(--warn)' : 'var(--ok)' } as CSSProperties}>
      <StatusGlyph kind={f.stale ? 'REVIEW' : 'PASS'} />
      {!compact && <span className="ds-fresh__src">{f.dataset}</span>}
      <span className="ds-badge__ko">{f.stale ? `${lag} · ${C.hold}` : lag}</span>
      <span className="ds-sr">{hint}</span>
    </span>
  );
}
