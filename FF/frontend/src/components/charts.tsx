import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate } from '../state/motion';

// ── 카운트업 ──
// 애니메이션 값은 React state 가 아니라 DOM 텍스트로 직접 쓴다.
// 프레임마다 setState 하면 KPI 카드 수십 개가 매 프레임 커밋되어
// 시뮬레이션 틱과 겹칠 때 메인스레드를 잠근다.
// 또한 rAF 를 인스턴스마다 만들지 않고 공용 모션 커널에 묶는다 —
// 카드 수십 개가 동시에 갱신되어도 콜백 루프는 하나다.
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

function fmtCount(v: number, decimals: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function CountUp({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
  dur = 900,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  dur?: number;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);

  // 첫 프레임부터 값이 보이도록 마운트 시점에 즉시 0 → 텍스트를 채운다(paint 이전).
  useLayoutEffect(() => {
    const el = node.current;
    shown.current = 0;
    if (el) el.textContent = `${prefix}${fmtCount(0, decimals)}${suffix}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = node.current;
    const from = shown.current;
    const write = (v: number) => { if (el) el.textContent = `${prefix}${fmtCount(v, decimals)}${suffix}`; };
    if (!el || from === value) { shown.current = value; write(value); return; }
    return animate(dur, p => {
      const cur = from + (value - from) * easeOutCubic(p);
      shown.current = cur;
      write(cur);
    }, () => { shown.current = value; write(value); });
  }, [value, decimals, prefix, suffix, dur]);

  // 자식은 React 가 관리하지 않는다 — 위 effect 가 textContent 를 소유한다.
  return <span ref={node} />;
}

// 부드러운 곡선 path (Catmull-Rom → bezier)
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// ── AreaChart: 그라디언트 면적 + 격자 + Y축 + hover 툴팁 ──
export function AreaChart({ data, height = 160, color = '#0B5FFF', min, max, fmt }:
  { data: number[]; height?: number; color?: string; min?: number; max?: number; fmt?: (n: number) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 320, H = height, padL = 4, padB = 16, padT = 8;
  if (!data.length) return null;
  const lo = min ?? Math.min(...data), up = max ?? Math.max(...data);
  const span = up - lo || 1;
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL * 2);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const pts = data.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${x(data.length - 1)},${H - padB} L ${x(0)},${H - padB} Z`;
  const gid = 'ag' + color.replace(/[^a-z0-9]/gi, '');
  const grid = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}
        onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width * W; setHi(Math.max(0, Math.min(data.length - 1, Math.round((rel - padL) / ((W - padL * 2) / (data.length - 1)))))); }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {grid.map((g, i) => { const yy = padT + g * (H - padT - padB); const val = up - g * span; return (
          <g key={i}><line x1={padL} y1={yy} x2={W - padL} y2={yy} stroke="var(--line)" strokeWidth="0.5" strokeDasharray="3 3" />
            <text x={W - padL} y={yy - 2} textAnchor="end" fontSize="8" fill="var(--muted)">{fmt ? fmt(val) : val.toFixed(0)}</text></g>); })}
        <path d={area} fill={`url(#${gid})`} />
        <path className="draw" d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hi != null && <><line x1={x(hi)} y1={padT} x2={x(hi)} y2={H - padB} stroke={color} strokeWidth="0.7" strokeDasharray="2 2" />
          <circle cx={x(hi)} cy={y(data[hi])} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" /></>}
        <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3" fill={color}><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" /></circle>
      </svg>
      {hi != null && <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>{fmt ? fmt(data[hi]) : data[hi]}</div>}
    </div>
  );
}

// 기존 호환 Sparkline (면적 + 그라디언트)
export function Sparkline({ data, height = 60, color = 'var(--brand)', min, max }:
  { data: number[]; height?: number; color?: string; min?: number; max?: number }) {
  return <AreaChart data={data} height={height} color={color === 'var(--brand)' ? '#0B5FFF' : color} min={min} max={max} fmt={(n) => n.toFixed(0)} />;
}

// ── Donut (드로잉 애니메이션 + 중앙 라벨) ──
export function Donut({ segments, size = 130, center }: { segments: { label: string; value: number; color: string }[]; size?: number; center?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={14} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map((s, i) => { const len = (s.value / total) * c; const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={14} strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off}
              style={{ transition: 'stroke-dasharray .8s ease, stroke-dashoffset .8s ease' }} />); off += len; return el; })}
        </g>
        <text x="50%" y="46%" textAnchor="middle" dy="0.35em" fontSize="22" fontWeight="800" fill="var(--ink)">{center ?? total}</text>
        <text x="50%" y="62%" textAnchor="middle" fontSize="8" fill="var(--muted)">TOTAL</text>
      </svg>
      <div className="small">{segments.map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />{s.label} <b>{s.value}</b>
        </div>))}</div>
    </div>
  );
}

// ── Bars (그라디언트 + 성장 애니메이션) ──
export function Bars({ data, fmt, labelWidth = 120 }: { data: Record<string, number>; fmt?: (n: number) => string; labelWidth?: number }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div>{Object.entries(data).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0' }}>
        <span className="small" title={k} style={{ flex: `0 0 ${labelWidth}px`, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
        <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ width: `${(v / max) * 100}%`, background: 'linear-gradient(90deg,#0B5FFF,#0EA5E9)', height: 16, borderRadius: 5, transition: 'width .8s ease' }} />
        </div>
        <span className="small mono" style={{ width: 92, textAlign: 'right' }}>{fmt ? fmt(v) : v}</span>
      </div>))}</div>
  );
}

// ── GaugeArc (반원 아크 게이지) ──
export function GaugeArc({ value, label, size = 150 }: { value: number; label?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - 12, cx = size / 2, cy = size / 2;
  const ang = Math.PI * (1 - v / 100);
  const ex = cx + r * Math.cos(ang), ey = cy - r * Math.sin(ang);
  const color = v >= 95 ? '#1F9D55' : v >= 80 ? '#D9822B' : '#D64545';
  const arc = (a0: number, a1: number) => `M ${cx + r * Math.cos(a0)},${cy - r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)}`;
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size / 2 + 16} viewBox={`0 0 ${size} ${size / 2 + 16}`}>
        <path d={arc(Math.PI, 0)} fill="none" stroke="var(--surface-3)" strokeWidth="12" strokeLinecap="round" />
        <path d={arc(Math.PI, ang)} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" style={{ transition: 'all .6s' }} />
        <circle cx={ex} cy={ey} r="6" fill={color} stroke="#fff" strokeWidth="2" />
        <text x={cx} y={cy} textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--ink)">{v.toFixed(1)}%</text>
      </svg>
      {label && <div className="small muted">{label}</div>}
    </div>
  );
}

// ── RadialProgress (링) ──
export function RadialProgress({ value, size = 92, color = '#0B5FFF', label }: { value: number; size?: number; color?: string; label?: string }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray .8s ease' }} />
        </g>
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize="18" fontWeight="800" fill="var(--ink)">{Math.round(v)}%</text>
      </svg>
      {label && <div className="small muted">{label}</div>}
    </div>
  );
}

// ── Heatmap (rows × cols, value 0..1 또는 null) ──
export function Heatmap({ rows, cols, cell, legend }:
  { rows: string[]; cols: string[]; cell: (r: string, c: string) => { v: number | null; title?: string; label?: string }; legend?: string }) {
  const color = (v: number | null) => v == null ? 'var(--surface-2)' : `color-mix(in srgb, #0B5FFF ${Math.round(20 + v * 75)}%, var(--surface))`;
  return (
    <div className="table-wrap">
      <table className="heatmap"><thead><tr><th></th>{cols.map(c => <th key={c} style={{ fontSize: 11 }}>{c}</th>)}</tr></thead>
        <tbody>{rows.map(r => (<tr key={r}><td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r}</td>
          {cols.map(c => { const x = cell(r, c); return (
            <td key={c} title={x.title || ''} style={{ background: color(x.v), textAlign: 'center', color: (x.v ?? 0) > 0.55 ? '#fff' : 'var(--muted)', fontSize: 10, cursor: 'default' }}>{x.label ?? ''}</td>); })}
        </tr>))}</tbody></table>
      {legend && <div className="small muted mt">{legend}</div>}
    </div>
  );
}

// ── StatTile (카운트업 + delta + 미니 sparkline) ──
export function StatTile({ label, value, decimals = 0, suffix = '', prefix = '', delta, data, color = '#0B5FFF' }:
  { label: string; value: number; decimals?: number; suffix?: string; prefix?: string; delta?: number; data?: number[]; color?: string }) {
  return (
    <div className="kpi stat-tile">
      <div className="v"><CountUp value={value} decimals={decimals} suffix={suffix} prefix={prefix} /></div>
      <div className="l">{label} {delta != null && <span style={{ color: delta >= 0 ? 'var(--pass)' : 'var(--fail)', fontWeight: 700 }}>{delta >= 0 ? '▲' : '▼'}{Math.abs(delta)}</span>}</div>
      {data && <div style={{ marginTop: 6, opacity: .9 }}><Sparkline data={data} height={34} color={color} /></div>}
    </div>
  );
}

export function Gauge({ value, label }: { value: number; label?: string }) {
  const color = value >= 95 ? 'var(--pass)' : value >= 80 ? 'var(--pending)' : 'var(--fail)';
  return (
    <div>
      <div style={{ background: 'var(--surface-3)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, value)}%`, background: color, height: '100%', transition: 'width .4s' }} />
      </div>
      {label && <div className="small muted mt">{label} <b style={{ color }}>{value}%</b></div>}
    </div>
  );
}

export function LiveDot() {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--pass)' }}>
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pass)', animation: 'pulse 1.4s infinite' }} /> LIVE</span>;
}

// ── 색 팔레트 + 집계 유틸 ──
export const PALETTE = ['#0B5FFF', '#16A34A', '#D9822B', '#9333EA', '#D64545', '#0891B2', '#CA8A04', '#DB2777', '#2563EB', '#059669'];

export function tally<T>(items: T[], keyFn: (x: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  items.forEach(x => { const k = keyFn(x) || '기타'; r[k] = (r[k] || 0) + 1; });
  return r;
}

// 집계 → Donut segments 헬퍼 (색 자동 배정, 색맵 옵션)
export function dist(counts: Record<string, number>, colorMap?: Record<string, string>) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: colorMap?.[label] || PALETTE[i % PALETTE.length] }));
}

// ── Steps: 가로 파이프라인 (현재 단계 강조) ──
export function Steps({ steps, current, done }: { steps: string[]; current?: number; done?: boolean }) {
  return (
    <div className="steps">
      {steps.map((s, i) => {
        const state = done || (current != null && i < current) ? 'done' : current === i ? 'active' : 'todo';
        return (
          <div key={s} className={`step ${state}`}>
            <span className="dot">{state === 'done' ? '✓' : i + 1}</span>
            <span className="lbl">{s}</span>
            {i < steps.length - 1 && <span className="bar" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Timeline: 세로 타임라인 (최신 강조) ──
export function Timeline({ items }: { items: { ts: string; title: string; detail?: string; tag?: string; color?: string }[] }) {
  return (
    <div className="timeline">
      {items.map((it, i) => (
        <div className={`tl-item${i === 0 ? ' latest' : ''}`} key={i}>
          <span className="tl-node" style={{ background: it.color || (i === 0 ? 'var(--brand)' : 'var(--line)') }} />
          <div className="tl-body">
            <div className="tl-head">{it.tag && <span className="pill">{it.tag}</span>}<b className="small">{it.title}</b><span className="muted small" style={{ marginLeft: 'auto' }}>{it.ts}</span></div>
            {it.detail && <div className="muted small">{it.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── GroupedBars: Before/After 등 2계열 비교 ──
export function GroupedBars({ rows, fmt }: { rows: { label: string; a: number; b: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.a, r.b]));
  const f = fmt || ((n: number) => String(n));
  return (
    <div>{rows.map(r => (
      <div key={r.label} style={{ margin: '8px 0' }}>
        <div className="small" style={{ marginBottom: 3 }}>{r.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 4, height: 12 }}><div style={{ width: `${r.a / max * 100}%`, height: 12, borderRadius: 4, background: '#9AA7B8', transition: 'width .7s' }} /></div>
          <span className="small mono muted" style={{ width: 64, textAlign: 'right' }}>{f(r.a)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 4, height: 12 }}><div style={{ width: `${r.b / max * 100}%`, height: 12, borderRadius: 4, background: 'linear-gradient(90deg,#0B5FFF,#16A34A)', transition: 'width .7s' }} /></div>
          <span className="small mono" style={{ width: 64, textAlign: 'right' }}>{f(r.b)}</span>
        </div>
      </div>
    ))}<div className="small muted" style={{ marginTop: 4 }}><span style={{ color: '#9AA7B8' }}>■</span> Before · <span style={{ color: '#16A34A' }}>■</span> After</div></div>
  );
}
