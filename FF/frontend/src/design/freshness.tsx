// 데이터 신선도 칩(TL-UI01, 80-70 6장 1 · ADS-UI01) — 모든 '마지막 관측·적재' 표시는 이 부품 하나다(통합 D-INT-4).
// 두 가지 입력: Lake 집계 신선도(f — 출처 데이터셋·기준 시각·지연·SLA) 또는 관측 상태(state — 최신 확인/지연/오프라인/미확인 + 마지막 보고·기준 시간).
// 기준을 넘으면 경고 색과 '판단 보류'·'지연'을 글자로 함께 보인다(색만으로 구분하지 않게). Lake 입력은 설명(title·접근 이름)에 보류 사유를 둔다.
import type { CSSProperties, ReactNode } from 'react';
import type { Freshness } from '@ff/contracts';
import { ads } from '../copy/ads';
import { freshness as C } from '../copy/freshness';
import { StatusGlyph } from './icons';

/** 관측 상태 — 낱말은 copy/ads.ts(상태 용어 한 곳) */
export type FreshnessState = 'FRESH' | 'DELAYED' | 'OFFLINE' | 'UNOBSERVED';

/** 초 → 사람이 읽는 길이(분·시간·일) */
export function spanText(seconds: number): string {
  if (seconds < 3600) return C.minutes(Math.max(1, Math.round(seconds / 60)));
  if (seconds < 86_400) return C.hours(Math.round(seconds / 3600));
  return C.days(Math.round(seconds / 86_400));
}

/** 상대 시간(분·시간·일 전) — 화면 공통 */
export function relAgo(at: string | null | undefined, now: number = Date.now()): string {
  if (!at) return '—';
  const ms = Math.max(0, now - Date.parse(at));
  const m = Math.round(ms / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/** 절대 시각(KST, 월-일 시:분) */
export function fmtAt(at: string | null | undefined): string {
  if (!at) return '—';
  const d = new Date(Date.parse(at) + 9 * 3600_000).toISOString();
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
}

const clock = (iso: string) => {
  const k = new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
  return `${k.slice(5, 10).replace('-', '.')} ${k.slice(11, 16)}`;
};

const COLOR: Record<FreshnessState, string> = { FRESH: 'var(--ok)', DELAYED: 'var(--warn)', OFFLINE: 'var(--danger)', UNOBSERVED: 'var(--muted)' };
const GLYPH = { FRESH: 'PASS', DELAYED: 'REVIEW', OFFLINE: 'FAIL', UNOBSERVED: 'UNJUDGED' } as const;

type LakeInput = { f: Freshness | null | undefined; compact?: boolean };
type ObservedInput = { state: FreshnessState; observedAt?: string | null; staleAfterMs?: number | null; now?: number; note?: ReactNode };

export function FreshnessChip(props: LakeInput | ObservedInput) {
  let state: FreshnessState;
  let stale: boolean;
  let word: string;
  let src: string | null = null;
  let at: string | null = null;
  let hint: string | null = null;
  let note: ReactNode = null;
  if ('state' in props) {
    // 관측 상태 — 마지막 보고(상대+절대 시각)와 기준 시간을 글자로(title 아님)
    const O = ads.ui.freshness;
    state = props.state;
    stale = state !== 'FRESH';
    word = O[state];
    at = `${props.observedAt ? `${O.ago(relAgo(props.observedAt, props.now))} · ${fmtAt(props.observedAt)}` : O.never}${props.staleAfterMs ? ` · ${O.basis(Math.round(props.staleAfterMs / 60_000))}` : ''}`;
    note = props.note ?? null;
  } else {
    const f = props.f;
    if (!f) return null;
    stale = f.stale;
    state = f.stale ? 'DELAYED' : f.lagSeconds == null ? 'UNOBSERVED' : 'FRESH';
    const lag = f.lagSeconds == null ? C.unknown : f.lagSeconds < 90 ? C.now : C.lag(spanText(f.lagSeconds));
    word = f.stale ? `${lag} · ${C.hold}` : lag;
    src = props.compact ? null : f.dataset;
    const asOf = f.asOf ? C.asOf(clock(f.asOf)) : C.unknown;
    hint = `${C.hint(f.dataset, asOf, spanText(f.slaSeconds))}${f.stale ? ` — ${C.holdReason(spanText(f.slaSeconds))}` : ''}`;
  }
  return (
    <span className="ds-fresh" data-freshness={state} data-fresh={stale ? 'stale' : 'ok'} title={hint ?? undefined}>
      <span className="ds-badge" style={{ '--c': COLOR[state] } as CSSProperties}>
        <StatusGlyph kind={GLYPH[state]} />
        {src ? <span className="ds-fresh__src">{src}</span> : null}
        <span className="ds-badge__ko">{word}</span>
      </span>
      {at ? <span className="ds-fresh__at">{at}</span> : null}
      {note ? <span className="ds-fresh__note">{note}</span> : null}
      {hint ? <span className="ds-sr">{hint}</span> : null}
    </span>
  );
}
