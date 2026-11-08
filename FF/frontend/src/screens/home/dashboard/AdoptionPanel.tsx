import { uiLocaleTag } from '../../../locale/runtime';
// 홈 'Feature 적용 현황' — 고른 Flag의 차량 점 지도(Canvas, 점 하나 = 차량 한 대)·단계 깔때기·회신 시각 되감기.
// 값은 서버 요약(operationSummary.adoption)의 차량별 상태·단계·회신 시각 그대로다(contracts rules/operation-adoption). 지연 묶음 — 홈 첫 화면 번들에 넣지 않는다.
// 시연 데이터(브라우저 시뮬)의 차량 회신 이벤트는 같은 이벤트 버스를 구독만 한다 — 도착한 차량 점에 고리를 한 번 그리고 요약을 다시 읽는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ADOPTION_BY_CODE, ADOPTION_STAGES, ADOPTION_STATES, REGION_CITIES, type AdoptionFlag, type AdoptionStage, type AdoptionState, type OperationAdoption } from '@ff/contracts';
import { usePlatformLiveEvents } from '../../../api/stream';
import { operationOverview as O } from '../../../copy/operation-overview';
import { LAND_PATH, LAND_VIEW } from './overview-land';
import './adoption.css';

const A = O.adoption;
/** 상태 → 표식 색 토큰(밝음·어두움 모두 tokens.css). 차량 지도 활성 보기와 같은 뜻 */
export const ADOPTION_MARK: Record<AdoptionState, string> = { ON: '--mark-ok', CANARY: '--mark-info', OFF: '--mark-neutral', DISABLED: '--mark-danger', UNKNOWN: '--mark-warn' };
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const mapHref = (flagKey: string, extra: Record<string, string | undefined> = {}) => {
  const q = new URLSearchParams({ lens: 'activation', flagKey });
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return `/fleet/map?${q}`;
};
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 국가(묶음) 대표점 — 지도 규칙의 도시 좌표 평균(육지 윤곽 좌표: x = 경도+180, y = 80-위도). 없으면 남대서양 바다 위 '미확인' 자리 */
export function clusterCenter(name: string): { x: number; y: number } {
  const cities = Object.values(REGION_CITIES[name] ?? {}).flat();
  if (!cities.length) return { x: 160, y: 118 };
  const lat = cities.reduce((n, c) => n + c[1], 0) / cities.length;
  const lng = cities.reduce((n, c) => n + c[2], 0) / cities.length;
  return { x: lng + 180, y: LAND_VIEW.top - lat };
}

/** 회신 시각 t(0.1초)에서 차량이 보일 상태 — 아직 회신 전이면 'PENDING'(차단 차량은 차단 회신 전까지 적용 상태로) */
export type ShownState = AdoptionState | 'PENDING';
export function shownAt(flag: AdoptionFlag, i: number, t: number | null): ShownState {
  const s = ADOPTION_BY_CODE[flag.state[i]];
  const at = flag.at[i];
  if (t === null || at === null || at <= t) return s;
  return s === 'DISABLED' ? 'ON' : 'PENDING';
}

/** 시간 t까지 적용(ON·CANARY)으로 확인된 차량 수 — 되감기 설명과 누적 곡선 */
export function appliedAt(flag: AdoptionFlag, t: number | null): number {
  let n = 0;
  for (let i = 0; i < flag.state.length; i++) { const s = shownAt(flag, i, t); if (s === 'ON' || s === 'CANARY') n++; }
  return n;
}

interface Placed { i: number; x: number; y: number }
interface Cluster { name: string; x: number; y: number; r: number; total: number; members: number[]; states: Record<AdoptionState, number> }

/** 국가 묶음마다 해바라기 배치(점이 겹치지 않게) — 상태 순서로 가운데부터 */
export function layoutClusters(adoption: OperationAdoption, flag: AdoptionFlag, W: number, H: number) {
  const s = Math.min(W / LAND_VIEW.width, H / LAND_VIEW.height);
  const ox = (W - LAND_VIEW.width * s) / 2, oy = (H - LAND_VIEW.height * s) / 2;
  const groups = new Map<number, number[]>();
  for (let i = 0; i < adoption.vins.length; i++) {
    const g = parseInt(adoption.country[i] ?? '0', 36);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(i);
  }
  const maxN = Math.max(1, ...[...groups.values()].map((m) => m.length));
  // 점 간격 — 가장 큰 묶음이 지도 높이의 1/3·폭의 1/5 안에 들게(좁은 폭에서 묶음끼리 덮지 않게)
  const step = Math.max(1.8, Math.min(4.6, (0.32 * H) / Math.sqrt(maxN), (0.2 * W) / Math.sqrt(maxN)));
  const dot = step * 0.44;
  const order = (i: number) => ADOPTION_STATES.indexOf(ADOPTION_BY_CODE[flag.state[i]]);
  const clusters: Cluster[] = [...groups].map(([g, members]) => {
    const name = adoption.countries[g] ?? '';
    const c = clusterCenter(name);
    const sorted = [...members].sort((a, b) => order(a) - order(b) || adoption.vins[a].localeCompare(adoption.vins[b]));
    const states: Record<AdoptionState, number> = { ON: 0, CANARY: 0, OFF: 0, DISABLED: 0, UNKNOWN: 0 };
    for (const i of sorted) states[ADOPTION_BY_CODE[flag.state[i]]]++;
    return { name, x: ox + c.x * s, y: oy + c.y * s, r: step * Math.sqrt(sorted.length) + dot, total: sorted.length, members: sorted, states };
  });
  // 묶음이 겹치면 서로 밀어낸다(결정적 — 같은 입력이면 같은 자리). 지도 위치는 대표점 근처, 이름표가 국가를 말한다
  const clamp = (c: Cluster) => { c.x = Math.min(W - c.r - 2, Math.max(c.r + 2, c.x)); c.y = Math.min(H - c.r - 14, Math.max(c.r + 16, c.y)); };
  clusters.forEach(clamp);
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
      const p = clusters[a], q = clusters[b];
      const dx = q.x - p.x || 1, dy = q.y - p.y, d = Math.hypot(dx, dy), need = p.r + q.r + 8;
      if (d >= need) continue;
      const k = (need - d) / 2 / d;
      p.x -= dx * k; p.y -= dy * k; q.x += dx * k; q.y += dy * k;
      clamp(p); clamp(q);
      moved = true;
    }
    if (!moved) break;
  }
  const placed: Placed[] = clusters.flatMap((c) => c.members.map((i, k) => {
    const rad = step * Math.sqrt(k + 0.5), th = k * 2.399963;
    return { i, x: c.x + rad * Math.cos(th), y: c.y + rad * Math.sin(th) };
  }));
  return { placed, clusters, dot, s, ox, oy };
}

type Highlight = { kind: 'stage'; stage: AdoptionStage } | { kind: 'state'; state: AdoptionState } | null;
const lit = (flag: AdoptionFlag, i: number, h: Highlight) =>
  !h || (h.kind === 'stage' ? Number(flag.stage[i]) >= ADOPTION_STAGES.indexOf(h.stage) + 1 : ADOPTION_BY_CODE[flag.state[i]] === h.state);

function useThemeColors(el: React.RefObject<HTMLElement | null>) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTick((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-workspace', 'data-present'] });
    return () => mo.disconnect();
  }, []);
  return useMemo(() => {
    const cs = el.current ? getComputedStyle(el.current) : null;
    const v = (name: string) => cs?.getPropertyValue(name).trim() || 'currentColor';
    return { mark: Object.fromEntries(ADOPTION_STATES.map((s) => [s, v(ADOPTION_MARK[s])])) as Record<AdoptionState, string>, land: v('--track-bg'), coast: v('--chart-grid'), surface: v('--surface'), pending: v('--faint'), ring: v('--ink') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, el.current]);
}

/** 점 하나 — 색만으로 가르지 않게 모양을 함께(적용 ●·단계 배포 ◆·차단 ■·미수신 ○·대상 아님 작은 점) */
function drawMark(g: CanvasRenderingContext2D, st: ShownState, x: number, y: number, r: number, c: ReturnType<typeof useThemeColors>) {
  g.beginPath();
  if (st === 'PENDING') { g.strokeStyle = c.pending; g.lineWidth = Math.max(0.8, r * 0.45); g.arc(x, y, r * 0.8, 0, Math.PI * 2); g.stroke(); return; }
  const col = c.mark[st];
  if (st === 'UNKNOWN') { g.strokeStyle = col; g.lineWidth = Math.max(1, r * 0.55); g.arc(x, y, r * 0.85, 0, Math.PI * 2); g.stroke(); return; }
  g.fillStyle = col;
  if (st === 'OFF') g.arc(x, y, r * 0.6, 0, Math.PI * 2);
  else if (st === 'DISABLED') g.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (st === 'CANARY') { g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 1.15, y); g.lineTo(x, y + r * 1.15); g.lineTo(x - r * 1.15, y); g.closePath(); }
  else g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

const LAND = typeof Path2D !== 'undefined' ? new Path2D(LAND_PATH) : null;

function DotMap({ adoption, flag, t, highlight, arrivals, onCluster }: { adoption: OperationAdoption; flag: AdoptionFlag; t: number | null; highlight: Highlight; arrivals: Map<string, number>; onCluster: (name: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Cluster | null>(null);
  const colors = useThemeColors(wrap);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => { const w = Math.round(el.clientWidth); setSize({ w, h: Math.max(220, Math.min(380, Math.round(w * 0.42))) }); };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const layout = useMemo(() => (size.w ? layoutClusters(adoption, flag, size.w, size.h) : null), [adoption, flag, size]);
  const vinIndex = useMemo(() => new Map(adoption.vins.map((v, i) => [v, i])), [adoption.vins]);
  // 그리기 — 상태가 바뀌거나 도착 고리가 남아 있는 동안만 다시 그린다
  useEffect(() => {
    const cv = canvas.current;
    const g = cv?.getContext?.('2d');
    if (!cv || !g || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    let frame = 0;
    const paint = (now: number) => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);
      if (LAND) {
        g.save(); g.translate(layout.ox, layout.oy); g.scale(layout.s, layout.s);
        g.fillStyle = colors.land; g.fill(LAND); g.strokeStyle = colors.coast; g.lineWidth = 0.5 / layout.s; g.stroke(LAND); g.restore();
      }
      for (const p of layout.placed) {
        g.globalAlpha = lit(flag, p.i, highlight) ? 1 : 0.16;
        drawMark(g, shownAt(flag, p.i, t), p.x, p.y, layout.dot, colors);
      }
      g.globalAlpha = 1;
      // 실시간 도착 — 점 둘레 고리 한 번(400ms). 동작 줄이기면 그리지 않는다
      let live = false;
      if (!reducedMotion()) for (const [vin, at] of arrivals) {
        const k = (now - at) / 400;
        const i = vinIndex.get(vin);
        const p = i === undefined ? undefined : layout.placed.find((x) => x.i === i);
        if (!p || k < 0 || k > 1) continue;
        live = true;
        g.globalAlpha = 0.6 * (1 - k); g.strokeStyle = colors.ring; g.lineWidth = 1;
        g.beginPath(); g.arc(p.x, p.y, layout.dot + 4 * k + 1, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      if (live) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [layout, flag, t, highlight, arrivals, colors, size, vinIndex]);
  const pick = (e: React.MouseEvent) => {
    if (!layout || !wrap.current) return null;
    const b = wrap.current.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    return layout.clusters.find((c) => Math.hypot(c.x - x, c.y - y) <= c.r + 6) ?? null;
  };
  const counts = (c: Cluster) => ADOPTION_STATES.filter((s) => c.states[s]).map((s) => `${A.state[s]} ${c.states[s]}`).join(' · ');
  return (
    <div ref={wrap} className="ad-map" style={{ height: size.h || undefined }} onMouseMove={(e) => setHover(pick(e))} onMouseLeave={() => setHover(null)} onClick={(e) => { const c = pick(e); if (c) onCluster(c.name); }} data-clickable={hover ? '' : undefined}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} role="img" aria-label={A.mapLabel(flag.flagKey, layout ? layout.clusters.map((c) => `${c.name || O.unspecified} ${O.donut.sum(c.total)}(${counts(c)})`).join(', ') : '')} />
      {layout?.clusters.map((c) => (
        <span key={c.name} className="ad-map__label" style={{ left: c.x, top: Math.max(0, c.y - c.r - 4) }} aria-hidden="true">
          <b>{c.name || O.unspecified}</b> {c.total}
        </span>
      ))}
      {hover && (
        <div className="ad-map__tip" style={{ left: Math.min(hover.x + hover.r + 8, size.w - 200), top: Math.max(4, hover.y - 20) }} role="tooltip">
          <b>{hover.name || O.unspecified}</b> <span className="ad-num">{O.donut.sum(hover.total)}</span>
          <ul>{ADOPTION_STATES.filter((s) => hover.states[s]).map((s) => <li key={s}><i data-state={s} aria-hidden="true" />{A.state[s]}<span className="ds-mono">{hover.states[s]}</span></li>)}</ul>
          <small>{A.mapOpen}</small>
        </div>
      )}
    </div>
  );
}

function Funnel({ flag, highlight, onPick }: { flag: AdoptionFlag; highlight: Highlight; onPick: (s: AdoptionStage) => void }) {
  const top = flag.funnel.TARGET ?? 0;
  return (
    <ol className="ad-funnel" aria-label={A.funnel}>
      {ADOPTION_STAGES.map((s, k) => {
        const n = flag.funnel[s];
        const prev = k ? flag.funnel[ADOPTION_STAGES[k - 1]] : null;
        const on = highlight?.kind === 'stage' && highlight.stage === s;
        return (
          <li key={s} data-stage={s}>
            <button type="button" aria-pressed={on} disabled={n === null} onClick={() => onPick(s)} title={n === null ? A.stageUnknown[s as 'RECEIVED' | 'USED'] : A.stageHint(A.stage[s], n)}>
              <span className="ad-funnel__name">{A.stage[s]}</span>
              <span className="ad-funnel__num ds-mono">{n === null ? '—' : n}</span>
              <span className="ad-funnel__bar" aria-hidden="true"><span style={{ width: n === null || !top ? 0 : `${(n / top) * 100}%` }} /></span>
              <span className="ad-funnel__rate">{n === null ? A.stageUnknownShort : k === 0 ? A.ofFleet(flag.state.length) : prev ? pct(n, prev) : '—'}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** 회신 시각 되감기 — 끌면 그 시각까지 회신한 차량만 적용으로 보인다. 재생은 누를 때만, 동작 줄이기면 끝 상태로 바로 */
function Rewind({ flag, t, setT }: { flag: AdoptionFlag; t: number | null; setT: (t: number | null) => void }) {
  // 적용 수의 분모는 배포 대상(머리 숫자와 같은 기준)
  const targets = Math.max(1, flag.funnel.TARGET ?? flag.state.length);
  const end = Math.max(1, ...flag.at.map((x) => x ?? 0), ...flag.markers.map((m) => m.at));
  const raf = useRef(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const play = () => {
    if (reducedMotion()) { setT(null); return; }
    cancelAnimationFrame(raf.current);
    const start = performance.now(), from = t === null || t >= end ? 0 : t, dur = 6000 * (1 - from / end);
    setPlaying(true);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / Math.max(1, dur));
      const v = Math.round(from + (end - from) * k);
      if (k >= 1) { setT(null); setPlaying(false); return; }
      setT(v);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  const stop = () => { cancelAnimationFrame(raf.current); setPlaying(false); };
  // 누적 적용 곡선 — 회신 시각 순서대로 계단
  const curve = useMemo(() => {
    const total = Math.max(targets, appliedAt(flag, null));
    const xs = [...new Set([0, ...flag.at.filter((x): x is number => x !== null), end])].sort((a, b) => a - b);
    return xs.map((x) => `${((x / end) * 100).toFixed(2)},${(28 - (appliedAt(flag, x) / total) * 26).toFixed(2)}`).join(' ');
  }, [flag, end, targets]);
  const now = t ?? end;
  const t0 = flag.t0 ? Date.parse(flag.t0) : NaN;
  const clock = Number.isFinite(t0) ? new Date(t0 + now * 100).toLocaleTimeString(uiLocaleTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  return (
    <div className="ad-rewind">
      <div className="ad-rewind__head">
        <button type="button" className="ds-btn" onClick={playing ? stop : play}>{playing ? A.pause : reducedMotion() ? A.showEnd : A.play}</button>
        <span className="ds-mono ad-rewind__clock">{clock}</span>
        <span className="ad-rewind__applied">{A.appliedAt(appliedAt(flag, t), targets)}</span>
        {t !== null && <button type="button" className="ad-rewind__now" onClick={() => { stop(); setT(null); }}>{A.toNow}</button>}
      </div>
      <div className="ad-rewind__track">
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <polyline points={curve} className="ad-rewind__curve" />
          {flag.markers.map((m) => <line key={m.id} x1={(m.at / end) * 100} x2={(m.at / end) * 100} y1="0" y2="30" className="ad-rewind__marker" data-kind={m.kind} />)}
          <line x1={(now / end) * 100} x2={(now / end) * 100} y1="0" y2="30" className="ad-rewind__cursor" />
        </svg>
        <input type="range" min={0} max={end} step={1} value={now} aria-label={A.scrub} aria-valuetext={`${clock} · ${A.appliedAt(appliedAt(flag, t), targets)}`} onChange={(e) => { stop(); const v = Number(e.target.value); setT(v >= end ? null : v); }} />
      </div>
      <ul className="ad-rewind__legend" aria-label={A.markers}>
        {(['DEPLOY', 'KILL', 'RESTORE'] as const).filter((k) => flag.markers.some((m) => m.kind === k)).map((k) => <li key={k} data-kind={k}>{A.marker[k]} <span className="ds-mono">{flag.markers.filter((m) => m.kind === k).length}</span></li>)}
      </ul>
    </div>
  );
}

export default function AdoptionPanel({ adoption }: { adoption: OperationAdoption }) {
  const nav = useNavigate();
  const [flagKey, setFlagKey] = useState(adoption.flags[0]?.flagKey ?? '');
  const flag = adoption.flags.find((f) => f.flagKey === flagKey) ?? adoption.flags[0];
  const [t, setT] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);
  // 시연 차량 회신 — 같은 이벤트 버스 구독(요약을 다시 읽게 무효화), 새로 온 회신만 점 고리로
  const { items } = usePlatformLiveEvents(['vehicle.readback'], ['operationSummary'], 200);
  const seen = useRef<number | null>(null);
  const [arrivals, setArrivals] = useState<Map<string, number>>(() => new Map());
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (seen.current === null) { seen.current = items.at(-1)?.seq ?? 0; return; }
    const fresh = items.filter((e) => e.seq > seen.current!);
    if (!fresh.length) return;
    seen.current = fresh.at(-1)!.seq;
    const now = performance.now();
    setArrivals((m) => { const next = new Map([...m].filter(([, at]) => now - at < 1000)); for (const e of fresh) next.set(e.aggregate, now); return next; });
    const kills = fresh.filter((e) => e.payload.kind === 'KILL').length;
    setAnnounce(kills ? A.liveKill(kills) : A.live(fresh.length));
  }, [items]);
  useEffect(() => { setT(null); setHighlight(null); }, [flagKey]);
  if (!flag) return null;
  const targets = flag.funnel.TARGET ?? 0;
  const applied = flag.states.ON + flag.states.CANARY;
  const pickStage = (s: AdoptionStage) => setHighlight((h) => (h?.kind === 'stage' && h.stage === s ? null : { kind: 'stage', stage: s }));
  const pickState = (s: AdoptionState) => setHighlight((h) => (h?.kind === 'state' && h.state === s ? null : { kind: 'state', state: s }));
  const stateParam = highlight?.kind === 'state' ? highlight.state : undefined;
  const country = (name: string) => nav(mapHref(flag.flagKey, { country: name || undefined, state: stateParam }));
  const groups = adoption.countries.map((name, g) => {
    const counts: Record<AdoptionState, number> = { ON: 0, CANARY: 0, OFF: 0, DISABLED: 0, UNKNOWN: 0 };
    for (let i = 0; i < adoption.vins.length; i++) if (parseInt(adoption.country[i], 36) === g) counts[ADOPTION_BY_CODE[flag.state[i]]]++;
    return { name, counts };
  });
  return (
    <section className="ad" aria-label={A.title}>
      <header className="ad__head">
        <div>
          <h3>{A.title}</h3>
          <p className="ad__key"><span className="ds-mono ad__key-num">{applied}</span><span className="ds-mono ad__key-of">/{targets}</span><span>{A.keyText(pct(applied, targets))}</span></p>
        </div>
        <label className="ad__pick">
          <span>{A.pick}</span>
          <select className="ds-input" value={flag.flagKey} onChange={(e) => setFlagKey(e.target.value)}>
            {adoption.flags.map((f) => <option key={f.flagKey} value={f.flagKey}>{`${f.flagKey} · ${A.why(f.why, f.stagePct)}`}</option>)}
          </select>
        </label>
      </header>
      <p className="ad__why"><span className="ds-badge" data-why={flag.why}><span className="ds-badge__ko">{A.why(flag.why, flag.stagePct)}</span></span><span className="ds-mono">{flag.policyId ? `${flag.policyId} · r${flag.revision}` : flag.featureId}</span><Link to={mapHref(flag.flagKey, { state: stateParam })}>{A.openMap}<span aria-hidden="true"> →</span></Link></p>
      <div className="ad__body">
        <div className="ad__map">
          <DotMap adoption={adoption} flag={flag} t={t} highlight={highlight} arrivals={arrivals} onCluster={country} />
          <ul className="ad-legend" aria-label={A.legend}>
            {ADOPTION_STATES.map((s) => (
              <li key={s}>
                <button type="button" aria-pressed={highlight?.kind === 'state' && highlight.state === s} onClick={() => pickState(s)} disabled={!flag.states[s]}>
                  <i data-state={s} aria-hidden="true" />{A.state[s]}<span className="ds-mono">{flag.states[s]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="ad__side">
          <h4 className="ad__sub">{A.funnel}</h4>
          <Funnel flag={flag} highlight={highlight} onPick={pickStage} />
          {highlight && <button type="button" className="ad__clear" onClick={() => setHighlight(null)}>{A.clearHighlight}</button>}
        </div>
      </div>
      <Rewind flag={flag} t={t} setT={setT} />
      <details className="ad__table">
        <summary>{A.table}</summary>
        <table>
          <caption className="ds-sr">{A.tableCaption(flag.flagKey)}</caption>
          <thead><tr><th scope="col">{O.country}</th>{ADOPTION_STATES.map((s) => <th scope="col" key={s} className="ad-num">{A.state[s]}</th>)}<th scope="col" className="ad-num">{A.total}</th></tr></thead>
          <tbody>{groups.map((g) => <tr key={g.name}><th scope="row">{g.name || O.unspecified}</th>{ADOPTION_STATES.map((s) => <td key={s} className="ad-num ds-mono">{g.counts[s]}</td>)}<td className="ad-num ds-mono">{ADOPTION_STATES.reduce((n, s) => n + g.counts[s], 0)}</td></tr>)}</tbody>
        </table>
      </details>
      <p className="ds-sr" aria-live="polite">{announce}</p>
    </section>
  );
}
