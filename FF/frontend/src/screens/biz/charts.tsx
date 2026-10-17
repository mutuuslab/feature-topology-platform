// 체험 전환 분석 차트 — 라이브러리 없이 SVG. 규칙(dataviz): 막대 ≤24px·끝 4px 둥글게·기준선 쪽 각지게, 선 2px, 끝점 r4 + 2px 면 테두리,
// 격자 1px 실선, 글자는 글자 색(계열 색은 표지에만), 2계열 이상은 범례, 값은 선택적으로 표기, 마우스·키보드 모두 같은 툴팁.
// 색은 tokens.css --viz-1..3 (제안·수락·구매 고정 순서).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ko } from '../../copy/ko';
import { formatCount } from '../../design/format';

export const STAGE_COLOR = { offered: 'var(--viz-1)', accepted: 'var(--viz-2)', converted: 'var(--viz-3)' } as const;
export type Stage = keyof typeof STAGE_COLOR;

const nf = (n: number) => n.toLocaleString('ko-KR');
export const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

/** 포인터의 svg 기준 x — SVG 자식 요소의 offsetX는 브라우저마다 기준이 달라 쓰지 않는다 */
const svgX = (e: { clientX: number; currentTarget: Element }) => {
  const svg = e.currentTarget instanceof SVGSVGElement ? e.currentTarget : e.currentTarget.closest('svg');
  return svg ? e.clientX - svg.getBoundingClientRect().left : 0;
};

function useWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 가로 막대 — 기준선(왼쪽)은 각지게, 값 끝(오른쪽)만 4px 둥글게 */
function hbar(x: number, y: number, w: number, h: number, r = 4) {
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

interface Tip {
  x: number;
  y: number;
  title: ReactNode;
  rows: { color: string; label: ReactNode; value: ReactNode }[];
}
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="ds-viz__tip" role="status" style={{ left: tip.x, top: tip.y }}>
      <div className="ds-viz__tip-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="ds-viz__tip-row">
          <span className="ds-viz__key" style={{ background: r.color }} aria-hidden="true" />
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: ReactNode; line?: boolean }[] }) {
  return (
    <ul className="ds-viz__legend" aria-label={ko.bizTrial.legend}>
      {items.map((it, i) => (
        <li key={i}>
          <span className={it.line ? 'ds-viz__key' : 'ds-viz__swatch'} style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** 제안 → 수락 → 구매 깔때기 — 단계마다 한 막대, 값은 막대 끝 바깥 */
export function FunnelChart({ stages, label }: { stages: { key: Stage; label: string; value: number; note: string }[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const labelW = 64;
  const valueW = 190;
  const bar = 24;
  const row = 40;
  const max = Math.max(1, ...stages.map((s) => s.value));
  const span = Math.max(40, width - labelW - valueW);
  const h = stages.length * row;
  return (
    <div className="ds-viz" ref={ref} onPointerLeave={() => setTip(null)}>
      <svg width={width} height={h} role="group" aria-label={`${label}: ${stages.map((s) => `${s.label} ${nf(s.value)}`).join(', ')}`}>
        {stages.map((s, i) => {
          const y = i * row + (row - bar) / 2;
          const w = (s.value / max) * span;
          const show = (x: number) => setTip({ x, y: y + bar + 6, title: s.label, rows: [{ color: STAGE_COLOR[s.key], label: s.note, value: nf(s.value) }] });
          return (
            <g key={s.key}>
              <text x={labelW - 8} y={y + bar / 2} className="ds-viz__label" textAnchor="end" dominantBaseline="central">
                {s.label}
              </text>
              <path d={hbar(labelW, y, Math.max(w, 2), bar)} fill={STAGE_COLOR[s.key]} />
              <text x={labelW + w + 8} y={y + bar / 2} className="ds-viz__value" dominantBaseline="central">
                {formatCount(s.value)}
                <tspan className="ds-viz__muted"> {s.note}</tspan>
              </text>
              {/* 표적은 막대보다 크게 — 줄 전체 */}
              <rect x={0} y={i * row} width={width} height={row} fill="transparent" tabIndex={0} role="img" aria-label={`${s.label} ${nf(s.value)} ${s.note}`} onPointerMove={(e) => show(svgX(e))} onFocus={() => show(labelW + w / 2)} onBlur={() => setTip(null)} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export interface SegmentRow {
  key: string;
  offered: number;
  acceptRate: number | null;
  conversionRate: number | null;
  suppressed: boolean;
}

/** 집단별 수락률·구매 전환율 — 같은 0~100% 축의 짝 막대(축 하나), 가린 집단은 글자로 */
export function SegmentChart({ rows, label, suppressedText, rateLabels }: { rows: SegmentRow[]; label: string; suppressedText: string; rateLabels: { accept: string; convert: string } }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const labelW = 150;
  const valueW = 64;
  const bar = 12;
  const gap = 2;
  const row = bar * 2 + gap + 14;
  const top = 18;
  const span = Math.max(60, width - labelW - valueW);
  const h = top + rows.length * row;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const series = [
    { k: 'acceptRate' as const, color: STAGE_COLOR.accepted, label: rateLabels.accept },
    { k: 'conversionRate' as const, color: STAGE_COLOR.converted, label: rateLabels.convert },
  ];
  return (
    <div className="ds-viz" ref={ref} onPointerLeave={() => setTip(null)}>
      <Legend items={series.map((s) => ({ color: s.color, label: s.label }))} />
      <svg width={width} height={h} role="group" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={labelW + t * span} x2={labelW + t * span} y1={top - 4} y2={h} className="ds-viz__grid" />
            <text x={labelW + t * span} y={10} className="ds-viz__tick" textAnchor="middle">
              {t * 100}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y0 = top + i * row + 7;
          const name = (
            <text x={labelW - 8} y={y0 + bar + gap / 2} className="ds-viz__label" textAnchor="end" dominantBaseline="central">
              {r.key}
              <tspan className="ds-viz__muted"> ({nf(r.offered)})</tspan>
            </text>
          );
          if (r.suppressed)
            return (
              <g key={r.key}>
                {name}
                <text x={labelW + 8} y={y0 + bar + gap / 2} className="ds-viz__muted" dominantBaseline="central">
                  {suppressedText}
                </text>
              </g>
            );
          const show = (x: number) =>
            setTip({ x, y: y0 + row - 6, title: `${r.key} · ${ko.bizTrial.stages.offered} ${nf(r.offered)}`, rows: series.map((s) => ({ color: s.color, label: s.label, value: pct(r[s.k]) })) });
          return (
            <g key={r.key}>
              {name}
              {series.map((s, j) => {
                const v = r[s.k] ?? 0;
                const y = y0 + j * (bar + gap);
                return (
                  <g key={s.k}>
                    <path d={hbar(labelW, y, Math.max(v * span, 2), bar)} fill={s.color} />
                    <text x={labelW + v * span + 6} y={y + bar / 2} className="ds-viz__value ds-viz__value--sm" dominantBaseline="central">
                      {pct(r[s.k])}
                    </text>
                  </g>
                );
              })}
              <rect x={0} y={y0 - 5} width={width} height={row} fill="transparent" tabIndex={0} role="img" aria-label={`${r.key}: ${series.map((s) => `${s.label} ${pct(r[s.k])}`).join(', ')}`} onPointerMove={(e) => show(svgX(e))} onFocus={() => show(labelW + span / 2)} onBlur={() => setTip(null)} />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** 깔끔한 축 최댓값 (1·2·2.5·5 × 10^n) */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** 주별 추이 — 계열 3개 선, 축 하나, 십자선이 가장 가까운 주를 잡고 세 값을 한 툴팁에. ←/→ 키로 주 이동 */
export function TrendChart({ weeks, series, label, weekLabel }: { weeks: string[]; series: { key: Stage; label: string; values: number[] }[]; label: string; weekLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const left = 44;
  const right = 72;
  const top = 12;
  const h = 240;
  const bottom = 24;
  const plotW = Math.max(100, width - left - right);
  const plotH = h - top - bottom;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => left + (weeks.length <= 1 ? 0 : (i / (weeks.length - 1)) * plotW);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const fmt = formatCount;
  // 주 눈금 — 반년 넘게 보면 월(YYYY-MM)로, 5년이면 반년마다
  const long = weeks.length > 60;
  const step = weeks.length <= 30 ? 4 : long ? 26 : 8;
  // 끝 표기 — 서로 12px 넘게 떨어진 것만(겹치면 범례·툴팁이 맡는다)
  const ends = series.map((s) => ({ s, yy: y(s.values.at(-1) ?? 0) })).sort((a, b) => a.yy - b.yy);
  const labeled = new Set(ends.filter((e, i) => (i === 0 || e.yy - ends[i - 1].yy >= 12) && (i === ends.length - 1 || ends[i + 1].yy - e.yy >= 12)).map((e) => e.s.key));
  const onMove = (px: number) => setIdx(Math.max(0, Math.min(weeks.length - 1, Math.round(((px - left) / plotW) * (weeks.length - 1)))));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') (setIdx((i) => Math.min(weeks.length - 1, (i ?? -1) + 1)), e.preventDefault());
    if (e.key === 'ArrowLeft') (setIdx((i) => Math.max(0, (i ?? weeks.length) - 1)), e.preventDefault());
    if (e.key === 'Escape') setIdx(null);
  };
  const tipX = idx === null ? 0 : Math.min(x(idx) + 12, width - 180);
  return (
    <div className="ds-viz" ref={ref}>
      <Legend items={series.map((s) => ({ color: STAGE_COLOR[s.key], label: s.label, line: true }))} />
      <svg
        width={width}
        height={h}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
        onPointerMove={(e) => onMove(svgX(e))}
        onPointerLeave={() => setIdx(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className="ds-viz__grid" />
            <text x={left - 6} y={y(t)} className="ds-viz__tick" textAnchor="end" dominantBaseline="central">
              {fmt(t)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) =>
          i % step === 0 || (i === weeks.length - 1 && i % step >= step - 1) ? (
            <text key={w} x={x(i)} y={h - 6} className="ds-viz__tick" textAnchor="middle">
              {long ? w.slice(0, 7) : w.slice(5)}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <polyline key={s.key} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={STAGE_COLOR[s.key]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const v = s.values.at(-1) ?? 0;
          return (
            <g key={s.key}>
              <circle cx={x(weeks.length - 1)} cy={y(v)} r={4} fill={STAGE_COLOR[s.key]} className="ds-viz__dot" />
              {labeled.has(s.key) && (
                <text x={x(weeks.length - 1) + 10} y={y(v)} className="ds-viz__value ds-viz__value--sm" dominantBaseline="central">
                  {s.label} {formatCount(v)}
                </text>
              )}
            </g>
          );
        })}
        {idx !== null && (
          <g>
            <line x1={x(idx)} x2={x(idx)} y1={top} y2={top + plotH} className="ds-viz__cross" />
            {series.map((s) => (
              <circle key={s.key} cx={x(idx)} cy={y(s.values[idx])} r={4} fill={STAGE_COLOR[s.key]} className="ds-viz__dot" />
            ))}
          </g>
        )}
      </svg>
      {idx !== null && <Tooltip tip={{ x: tipX, y: top + 30, title: `${weeks[idx]} ${weekLabel}`, rows: series.map((s) => ({ color: STAGE_COLOR[s.key], label: s.label, value: nf(s.values[idx]) })) }} />}
    </div>
  );
}
