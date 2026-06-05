// 의존성 없는 SVG 차트 — Sparkline / Donut / Bars / Gauge
export function Sparkline({ data, height = 60, color = 'var(--brand)', min, max }:
  { data: number[]; height?: number; color?: string; min?: number; max?: number }) {
  if (!data.length) return null;
  const lo = min ?? Math.min(...data), hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const w = 100;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - lo) / span) * (height - 8) - 4}`).join(' ');
  const area = `0,${height} ${pts} ${w},${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={w} cy={height - ((data[data.length - 1] - lo) / span) * (height - 8) - 4} r={2.5} fill={color} />
    </svg>
  );
}

export function Donut({ segments, size = 120 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map((s, i) => {
            const len = (s.value / total) * c;
            const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={14}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />;
            off += len; return el;
          })}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize="20" fontWeight="700" fill="var(--ink)">{total}</text>
      </svg>
      <div className="small">{segments.map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label} <b>{s.value}</b>
        </div>))}</div>
    </div>
  );
}

export function Bars({ data, fmt }: { data: Record<string, number>; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div>{Object.entries(data).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
        <span className="small" style={{ width: 120 }}>{k}</span>
        <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 4 }}>
          <div style={{ width: `${(v / max) * 100}%`, background: 'var(--brand)', height: 14, borderRadius: 4 }} />
        </div>
        <span className="small mono" style={{ width: 90, textAlign: 'right' }}>{fmt ? fmt(v) : v}</span>
      </div>))}</div>
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
