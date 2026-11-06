// Topology 그래프 캔버스 — SVG 한 장에 레인·간선·카드 노드를 그리고, 확대·이동은 바깥 g의 transform 한 곳만 바꾼다(React 다시 그리기 없음).
// 184 노드·수백 간선에서도 끌기·확대가 프레임마다 속성 하나만 바뀌므로 60fps를 지킨다. 노드는 로빙 tabindex로 키보드 이동.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { GATE_META, type GateId } from '@ff/contracts';
import { topologyGraph as G } from '../../../copy/topology-graph';
import { DOMAIN_NAME, type TEdge, type TModel, type TNode } from './model';
import type { Layout, LEdge } from './layout';

export type NodeState = 'sel' | 'hl1' | 'hl2';
export interface Highlight {
  nodes: Map<string, NodeState>;
  edges: Set<string>;
  /** 강조 밖은 흐리게 */
  dim: boolean;
  /** 노드 머리표(영향 단계·경로 순서) */
  badges: Map<string, string>;
}
export interface StageHandle {
  fit: () => void;
  focusNode: (id: string) => void;
}

const LOD = { far: 0.5, mid: 0.8 };
const MIN_K = 0.18;
const MAX_K = 2.4;
type View = { x: number; y: number; k: number };

export const GraphStage = memo(function GraphStage({
  graph,
  layout,
  focus,
  relation,
  hl,
  flow,
  reduced,
  collapsed,
  fitKey,
  focusOnMount,
  onNode,
  onEdge,
  onToggleLane,
  onReady,
}: {
  graph: TModel;
  layout: Layout;
  focus: string | null;
  relation: string | null;
  hl: Highlight;
  flow: boolean;
  reduced: boolean;
  collapsed: ReadonlySet<string>;
  fitKey: string;
  focusOnMount: boolean;
  onNode: (id: string) => void;
  onEdge: (id: string) => void;
  onToggleLane: (domain: string) => void;
  onReady?: (h: StageHandle) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const settleTimer = useRef(0);
  const labels = useRef<(SVGGElement | null)[]>([]);
  const lastK = useRef(-1);
  const hw = layout.headerW;
  const compact = hw < 120;
  const miniView = useRef<SVGRectElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const anim = useRef(0);
  const [size, setSize] = useState({ w: 960, h: 560 });
  const [lod, setLod] = useState<'far' | 'mid' | 'near'>('near');
  const [active, setActive] = useState<string | null>(focus);
  const tipApi = useRef<{ show: (id: string, x: number, y: number) => void; hide: () => void } | null>(null);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const dragged = useRef(false);

  // 화면 크기 — 캔버스 viewBox를 화면 픽셀과 1:1로(글자 크기 = CSS 크기 × 확대율)
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(240, el.clientWidth), h: Math.max(240, el.clientHeight) });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const v = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, []);

  /**
   * 끄는 동안(data-moving)에는 그래프 층을 GPU 합성층으로 올려 CSS transform만 바꾼다 — 글자를 프레임마다 다시 그리지 않아 60fps.
   * 손을 떼고 잠시 뒤(settle) 합성층을 내려 지금 확대율로 선명하게 다시 그리고, 선 굵기·화살촉·멀리 보기 단계를 맞춘다.
   */
  const settle = useCallback(() => {
    const { k } = view.current;
    delete wrap.current?.dataset.moving;
    if (Math.abs(k - lastK.current) > 0.004) {
      lastK.current = k;
      // 선 굵기·화살촉·간선 기호는 확대율과 무관하게 화면에서 비슷한 크기로(멀리 봐도 관계가 보인다)
      const ms = (10 / Math.max(k, 0.4)).toFixed(2);
      canvas.current?.querySelectorAll('marker').forEach((m) => (m.setAttribute('markerWidth', ms), m.setAttribute('markerHeight', ms)));
      canvas.current?.style.setProperty('--sw', Math.min(2.6, Math.max(1, 1 / k)).toFixed(3));
      canvas.current?.style.setProperty('--inv-k', Math.min(2, 1 / k).toFixed(3));
    }
    const next = k < LOD.far ? 'far' : k < LOD.mid ? 'mid' : 'near';
    setLod((p) => (p === next ? p : next));
  }, []);
  const apply = useCallback((moving = true) => {
    const { x, y, k } = view.current;
    if (world.current) world.current.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
    if (heads.current) heads.current.style.transform = `translate(0px,${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
    if (miniView.current) {
      miniView.current.setAttribute('x', String(-x / k));
      miniView.current.setAttribute('y', String(-y / k));
      miniView.current.setAttribute('width', String(size.w / k));
      miniView.current.setAttribute('height', String(size.h / k));
    }
    // 레인 머리 글 — 레인 윗부분이 화면 위로 넘어가면 레인 안에서 보이는 맨 위에
    const top = -y / k;
    layout.lanes.forEach((l, i) => labels.current[i]?.setAttribute('transform', `translate(0,${Math.max(0, Math.min(l.h - (compact ? 72 : 100), top - l.y + 4)).toFixed(1)})`));
    clearTimeout(settleTimer.current);
    if (!moving) return settle();
    if (wrap.current && !wrap.current.dataset.moving) wrap.current.dataset.moving = '1';
    settleTimer.current = window.setTimeout(settle, 160);
  }, [size.w, size.h, layout.lanes, compact, settle]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const goTo = useCallback(
    (target: View, animate = true) => {
      cancelAnimationFrame(anim.current);
      if (!animate || reduced || typeof requestAnimationFrame === 'undefined') {
        view.current = target;
        apply(false);
        return;
      }
      const from = { ...view.current };
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 320);
        const e = 1 - Math.pow(1 - p, 3);
        view.current = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
        apply();
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [apply, reduced],
  );

  const fitBox = useCallback(
    (x0: number, y0: number, x1: number, y1: number, maxK = 1) => {
      const pad = 24;
      const k = Math.max(MIN_K, Math.min(maxK, (size.w - pad * 2) / Math.max(1, x1 - x0), (size.h - pad * 2) / Math.max(1, y1 - y0)));
      return { k, x: (size.w - (x1 - x0) * k) / 2 - x0 * k, y: (size.h - (y1 - y0) * k) / 2 - y0 * k };
    },
    [size.w, size.h],
  );
  const fitAll = useCallback((animate = true) => {
    const f = fitBox(0, 0, layout.width, layout.height);
    // 전체가 화면보다 작으면 위·왼쪽에 붙인다(레인 머리가 왼쪽 끝)
    goTo({ k: f.k, x: Math.min(f.x, 0) > 0 ? 0 : Math.max(0, f.x), y: Math.max(0, f.y) }, animate);
  }, [fitBox, goTo, layout.width, layout.height]);
  const focusNode = useCallback(
    (id: string, animate = true) => {
      const n = layout.nodes.get(id);
      if (!n) return;
      // 선택 노드와 1단계 이웃을 함께 — 카드 글자를 읽을 수 있는 확대율(0.7~0.9)로, 다 들어가지 않으면 선택 노드 가운데
      const ids = [id, ...graph.edges.filter((e) => e.source === id || e.target === id).flatMap((e) => [e.source, e.target])];
      const boxes = ids.map((v) => layout.nodes.get(v)).filter((b) => !!b);
      const x0 = Math.min(...boxes.map((b) => b.x)) - 48, y0 = Math.min(...boxes.map((b) => b.y)) - 48;
      const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + 48, y1 = Math.max(...boxes.map((b) => b.y + b.h)) + 48;
      const left = hw;
      const k = Math.max(0.6, Math.min(0.9, (size.w - 32) / (x1 - x0 + left), (size.h - 32) / (y1 - y0)));
      const fits = (x1 - x0 + left) * k <= size.w && (y1 - y0) * k <= size.h;
      const [cx, cy] = fits ? [(x0 + x1) / 2, (y0 + y1) / 2] : [n.x + n.w / 2, n.y + n.h / 2];
      goTo({ k, x: Math.min(0, (size.w + left * k) / 2 - cx * k), y: Math.min(0, size.h / 2 - cy * k) }, animate);
    },
    [fitBox, goTo, graph.edges, layout.nodes],
  );
  /** 노드가 화면 밖이면 보이게 옮긴다(확대율은 그대로) */
  const reveal = useCallback(
    (id: string) => {
      const n = layout.nodes.get(id);
      if (!n) return;
      const { x, y, k } = view.current;
      const sx = n.x * k + x, sy = n.y * k + y, sw = n.w * k, sh = n.h * k;
      const left = hw * k + 16;
      if (sx >= left && sy >= 8 && sx + sw <= size.w - 8 && sy + sh <= size.h - 8) return;
      goTo({ k, x: size.w / 2 - (n.x + n.w / 2) * k, y: size.h / 2 - (n.y + n.h / 2) * k });
    },
    [goTo, layout.nodes, size.w, size.h],
  );

  // 첫 화면 — 선택 Feature 주변(없으면 전체 맞춤), 필터·접기 변경 — 전체 맞춤. 화면 크기가 바뀌면 사용자가 옮기기 전까지 같은 배치를 다시 맞춘다
  const placement = useRef<{ kind: 'fit' } | { kind: 'focus'; id: string } | { kind: 'user' } | null>(null);
  const place = (animate: boolean) => {
    const p = placement.current;
    if (p?.kind === 'focus' && layout.nodes.has(p.id)) focusNode(p.id, animate);
    else if (p?.kind === 'fit') fitAll(animate);
  };
  // 같은 fitKey로 다시 불리면(개발 모드 StrictMode의 효과 재실행) 첫 배치로 본다
  const placedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const firstTime = placedKey.current === null || placedKey.current === fitKey;
    placedKey.current = fitKey;
    placement.current = firstTime && focusOnMount && focus && layout.nodes.has(focus) ? { kind: 'focus', id: focus } : { kind: 'fit' };
    place(!firstTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useLayoutEffect(() => {
    place(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);
  const userMoved = () => void (placement.current = { kind: 'user' });
  useEffect(() => onReady?.({ fit: () => ((placement.current = { kind: 'fit' }), fitAll()), focusNode: (id) => ((placement.current = { kind: 'focus', id }), focusNode(id)) }), [onReady, fitAll, focusNode]);
  useEffect(() => setActive((a) => (focus && layout.nodes.has(focus) ? focus : a && layout.nodes.has(a) ? a : null)), [focus, layout.nodes]);

  // 확대 — Ctrl(⌘)+휠·트랙패드 집기. 그냥 휠은 페이지 스크롤에 둔다
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      userMoved();
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0022));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const zoomAt = (px: number, py: number, factor: number) => {
    const { x, y, k } = view.current;
    const nk = Math.max(MIN_K, Math.min(MAX_K, k * factor));
    view.current = { k: nk, x: px - ((px - x) / k) * nk, y: py - ((py - y) / k) * nk };
    apply();
  };
  const zoomBy = (f: number) => {
    userMoved();
    const { x, y, k } = view.current;
    const nk = Math.max(MIN_K, Math.min(MAX_K, k * f));
    goTo({ k: nk, x: size.w / 2 - ((size.w / 2 - x) / k) * nk, y: size.h / 2 - ((size.h / 2 - y) / k) * nk });
  };

  // 끌어 이동·두 손가락 집기
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; vx: number; vy: number; d?: number; k?: number } | null>(null);
  const onPointerDown = (ev: RPointerEvent<HTMLDivElement>) => {
    if ((ev.target as Element).closest('.topo-zoom, .topo-mini')) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    dragged.current = false;
    const pts = [...pointers.current.values()];
    const c = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = { x: c.x, y: c.y, vx: view.current.x, vy: view.current.y, d: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined, k: view.current.k };
  };
  const onPointerMove = (ev: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(ev.pointerId) || !gesture.current) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 2 && g.d) {
      const r = wrap.current!.getBoundingClientRect();
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2 - r.left, cy = (pts[0].y + pts[1].y) / 2 - r.top;
      const nk = Math.max(MIN_K, Math.min(MAX_K, g.k! * (d / g.d)));
      view.current = { k: nk, x: cx - ((g.x - r.left - g.vx) / g.k!) * nk, y: cy - ((g.y - r.top - g.vy) / g.k!) * nk };
      dragged.current = true;
      userMoved();
      apply();
      return;
    }
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
    if (!dragged.current && Math.hypot(dx, dy) < 4) return;
    if (!dragged.current) (wrap.current?.setPointerCapture?.(ev.pointerId), userMoved());
    dragged.current = true;
    view.current = { ...view.current, x: g.vx + dx, y: g.vy + dy };
    apply();
  };
  const onPointerUp = (ev: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(ev.pointerId);
    gesture.current = null;
    wrap.current?.releasePointerCapture?.(ev.pointerId);
  };

  // 키보드 — 화살표로 가장 가까운 노드, Enter·Space 선택, Esc 선택 해제(관계만), +/−/0 확대
  const move = (dir: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => {
    const cur = layout.nodes.get(active ?? '') ?? [...layout.nodes.values()][0];
    if (!cur) return;
    if (!layout.nodes.get(active ?? '')) return setActive(cur.id);
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best: { id: string; s: number } | null = null;
    for (const n of layout.nodes.values()) {
      if (n.id === cur.id) continue;
      const dx = n.x + n.w / 2 - cx, dy = n.y + n.h / 2 - cy;
      const [main, side] = dir === 'ArrowLeft' ? [-dx, dy] : dir === 'ArrowRight' ? [dx, dy] : dir === 'ArrowUp' ? [-dy, dx] : [dy, dx];
      if (main <= 1) continue;
      const s = main + Math.abs(side) * 2.2;
      if (!best || s < best.s) best = { id: n.id, s };
    }
    if (best) setActive(best.id);
  };
  useEffect(() => {
    if (!active) return;
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(active) : active;
    const el = wrap.current?.querySelector<SVGGElement>(`[data-node="${esc}"]`);
    if (el && wrap.current?.contains(document.activeElement) && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      reveal(active);
    }
  }, [active, reveal]);
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const k = ev.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      if ((ev.target as Element).closest('.topo-zoom, .topo-mini, .topo-lanehead')) return;
      ev.preventDefault();
      move(k);
    } else if (k === '+' || k === '=') (ev.preventDefault(), zoomBy(1.25));
    else if (k === '-' || k === '_') (ev.preventDefault(), zoomBy(0.8));
    else if (k === '0') (ev.preventDefault(), (placement.current = { kind: 'fit' }), fitAll());
  };

  // 포트 — 간선이 실제로 닿는 쪽만(왼쪽 = 들어옴, 오른쪽 = 나감·배타)
  const ports = useMemo(() => {
    const m = new Map<string, { l: boolean; r: boolean }>();
    const mark = (id: string, x: number) => {
      const n = layout.nodes.get(id);
      if (!n) return;
      const p = m.get(id) ?? { l: false, r: false };
      if (Math.abs(x - n.x) < 1) p.l = true;
      if (Math.abs(x - (n.x + n.w)) < 1) p.r = true;
      m.set(id, p);
    };
    for (const e of graph.edges) {
      const le = layout.edges.get(e.id);
      if (!le) continue;
      mark(e.source, le.points[0][0]);
      mark(e.target, le.points[le.points.length - 1][0]);
    }
    return m;
  }, [graph.edges, layout]);

  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph.edges]);
  // 노드·간선 손잡이 — id를 받는 고정 함수(memo된 카드·간선이 선택이 바뀔 때만 다시 그려지게)
  const pickNode = useCallback((id: string) => { if (dragged.current) return; setActive(id); onNode(id); }, [onNode]);
  const focusCard = useCallback((id: string) => setActive(id), []);
  const pickEdge = useCallback((id: string) => { if (dragged.current) return; onEdge(id); }, [onEdge]);
  const tipAt = useCallback((id: string, cx: number, cy: number) => {
    if (gesture.current) return; // 끄는 동안에는 풍선을 띄우지 않는다
    const r = wrap.current?.getBoundingClientRect();
    if (r) tipApi.current?.show(id, cx - r.left, cy - r.top);
  }, []);
  const tipOff = useCallback(() => tipApi.current?.hide(), []);
  const mini = useMemo(() => {
    const w = 208;
    return { w, h: Math.min(150, Math.max(64, (w * layout.height) / Math.max(1, layout.width))) };
  }, [layout.width, layout.height]);
  const miniJump = (ev: RPointerEvent<SVGSVGElement>) => {
    if (ev.type === 'pointermove' && !ev.buttons) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const wx = ((ev.clientX - r.left) / r.width) * layout.width, wy = ((ev.clientY - r.top) / r.height) * layout.height;
    userMoved();
    const k = view.current.k;
    goTo({ k, x: size.w / 2 - wx * k, y: size.h / 2 - wy * k }, ev.type === 'pointerdown');
  };

  const dimmed = (id: string) => hl.dim && !hl.nodes.has(id);
  const tabNode = active && layout.nodes.has(active) ? active : [...layout.nodes.keys()][0];
  return (
    <div
      ref={wrap}
      className="topo-stage"
      data-lod={lod}
      data-flow={flow && !reduced && !hidden ? 'on' : 'off'}
      data-dim={hl.dim || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKey}
      onPointerLeave={tipOff}
    >
      <div ref={world} className="topo-world">
      <svg ref={canvas} className="ds-topo topo-canvas" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={G.canvas} aria-describedby="topo-keys">
        <defs>
          {(['PASS', 'CONDITIONAL', 'FAIL', 'PENDING'] as const).map((t) => (
            <g key={t}>
              <marker id={`topo-ar-${t}`} viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M0,1 L10,5 L0,9 L2.2,5 z" className="topo-marker" data-tone={t} />
              </marker>
              <marker id={`topo-tee-${t}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M5,0.5 L5,9.5" className="topo-marker-tee" data-tone={t} />
              </marker>
            </g>
          ))}
          <pattern id="topo-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="1" className="topo-dot" />
          </pattern>
        </defs>
        <g>
          <rect width={layout.width} height={layout.height} fill="url(#topo-dots)" className="topo-dots" />
          <g className="topo-lanes" aria-hidden="true">
            {layout.lanes.map((l, i) => (
              <g key={l.domain} data-domain={l.domain}>
                <rect x={0} y={l.y} width={layout.width} height={l.h} className="topo-lane" data-alt={i % 2 || undefined} />
                <line x1={0} x2={layout.width} y1={l.y} y2={l.y} className="topo-lane__rule" />
              </g>
            ))}
          </g>
          <g className="topo-edges">
            {graph.edges.map((e) => {
              const le = layout.edges.get(e.id);
              if (!le) return null;
              return (
                <EdgeView
                  key={e.id}
                  e={e}
                  le={le}
                  selected={e.id === relation}
                  on={hl.edges.has(e.id)}
                  dim={hl.dim && !hl.edges.has(e.id) && e.id !== relation}
                  onSelect={pickEdge}
                  onTip={tipAt}
                  onTipEnd={tipOff}
                />
              );
            })}
          </g>
          <g className="topo-nodes">
            {[...layout.nodes.values()].map((b, i) => {
              const n = graph.nodes.get(b.id)!;
              return (
                <NodeCard
                  key={b.id}
                  n={n}
                  x={b.x}
                  y={b.y}
                  w={b.w}
                  h={b.h}
                  order={i}
                  state={hl.nodes.get(b.id)}
                  dim={dimmed(b.id)}
                  badge={hl.badges.get(b.id)}
                  port={ports.get(b.id)}
                  tab={b.id === tabNode}
                  onSelect={pickNode}
                  onFocus={focusCard}
                />
              );
            })}
          </g>
        </g>
      </svg>
      </div>
      <div ref={heads} className="topo-heads">
      <svg width={hw} height={layout.height} viewBox={`0 0 ${hw} ${layout.height}`} className="topo-heads__svg">
        <g className="topo-lanehead" data-compact={compact || undefined}>
          {layout.lanes.map((l, i) => {
            const name = DOMAIN_NAME[l.domain] ?? l.domain;
            const [l1, l2] = splitName(name);
            const open = !collapsed.has(l.domain);
            return (
              <g key={l.domain} data-domain={l.domain} transform={`translate(0,${l.y})`}>
                <rect width={hw - 12} height={l.h} className="topo-lanehead__bg" />
                <rect width={4} height={l.h} className="topo-lanehead__band" />
                {/* 머리 글은 레인이 화면 위로 넘어가도 레인 안에서 보이는 자리에 붙는다(apply) */}
                <g ref={(el) => void (labels.current[i] = el)} className="topo-lanehead__label">
                  <text x={compact ? 12 : 18} y={30} className="topo-lanehead__abbr">{l.domain}</text>
                  {!compact && (
                    <>
                      <text x={18} y={50} className="topo-lanehead__name">
                        <tspan x={18}>{l1}</tspan>
                        {l2 && <tspan x={18} dy="1.3em">{l2}</tspan>}
                      </text>
                      <text x={18} y={l2 ? 86 : 70} className="topo-lanehead__count">{G.laneCount(l.count)}</text>
                    </>
                  )}
                  <g
                    className="topo-lanehead__toggle"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    aria-label={open ? G.collapse(name) : G.expand(name)}
                    transform={compact ? 'translate(12,40)' : `translate(${hw - 44},12)`}
                    onClick={() => onToggleLane(l.domain)}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onToggleLane(l.domain))}
                  >
                    <rect width={24} height={24} rx={4} />
                    <path d={open ? 'M7,10 L12,15 L17,10' : 'M10,7 L15,12 L10,17'} />
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      </div>
      <div className="topo-zoom" role="toolbar" aria-label={G.tools}>
        <button type="button" className="ds-btn" aria-label={G.zoom.in} title={G.zoom.in} onClick={() => zoomBy(1.25)}>+</button>
        <button type="button" className="ds-btn" aria-label={G.zoom.out} title={G.zoom.out} onClick={() => zoomBy(0.8)}>−</button>
        <button type="button" className="ds-btn" aria-label={G.zoom.fit} title={G.zoom.fit} onClick={() => ((placement.current = { kind: 'fit' }), fitAll())}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
        <button type="button" className="ds-btn" aria-label={G.zoom.focus} title={G.zoom.focus} disabled={!focus || !layout.nodes.has(focus)} onClick={() => focus && ((placement.current = { kind: 'focus', id: focus }), focusNode(focus))}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M7 0v3M7 11v3M0 7h3M11 7h3" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
      </div>
      <svg className="topo-mini" width={mini.w} height={mini.h} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" role="img" aria-label={G.minimap} onPointerDown={miniJump} onPointerMove={miniJump}>
        {layout.lanes.map((l, i) => <rect key={l.domain} x={0} y={l.y} width={layout.width} height={l.h} className="topo-lane" data-alt={i % 2 || undefined} />)}
        {[...layout.nodes.values()].map((b) => {
          const n = graph.nodes.get(b.id)!;
          return <rect key={b.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className="topo-mini__node" data-domain={n.domain} data-state={hl.nodes.get(b.id)} data-dim={dimmed(b.id) || undefined} />;
        })}
        <rect ref={miniView} className="topo-mini__view" vectorEffect="non-scaling-stroke" />
      </svg>
      <TipLayer api={tipApi} edges={edgeById} graph={graph} w={size.w} />
    </div>
  );
});

function splitName(name: string): [string, string?] {
  if (name.length <= 16) return [name];
  const amp = name.indexOf(' & ');
  if (amp > 0) return [name.slice(0, amp + 2), name.slice(amp + 3)];
  const sp = name.lastIndexOf(' ', 16);
  return sp > 0 ? [name.slice(0, sp), name.slice(sp + 1)] : [name];
}

/** 카드 이름 — 실제 글꼴 폭으로 잘라 말줄임(측정할 수 없는 환경은 글자 수로) */
let measure: CanvasRenderingContext2D | null | undefined;
const fitCache = new Map<string, string>();
function fitText(text: string, max: number): string {
  const key = `${max}|${text}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  if (measure === undefined) {
    measure = typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent) ? document.createElement('canvas').getContext('2d') : null;
    if (measure) measure.font = `650 14px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'sans-serif'}`;
  }
  let out = text;
  if (!measure) out = text.length > 16 ? `${text.slice(0, 16)}…` : text;
  else if (measure.measureText(text).width > max) {
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measure.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
      else hi = mid - 1;
    }
    out = `${text.slice(0, lo).trimEnd()}…`;
  }
  fitCache.set(key, out);
  return out;
}

const TONE_GLYPH: Record<string, string> = { CONDITIONAL: 'M0,-4a4,4 0 0 1 0,8Z', FAIL: 'M-2.6,-2.6 L2.6,2.6 M2.6,-2.6 L-2.6,2.6' };

const EdgeView = memo(function EdgeView({ e, le, selected, on, dim, onSelect, onTip, onTipEnd }: { e: TEdge; le: LEdge; selected: boolean; on: boolean; dim: boolean; onSelect: (id: string) => void; onTip: (id: string, x: number, y: number) => void; onTipEnd: () => void }) {
  const tip = (ev: { clientX: number; clientY: number }) => onTip(e.id, ev.clientX, ev.clientY);
  const marker = e.type === 'REQUIRES' ? { markerEnd: `url(#topo-ar-${e.tone})` } : { markerStart: `url(#topo-tee-${e.tone})`, markerEnd: `url(#topo-tee-${e.tone})` };
  const notes = [e.mismatch ? 'V' : null, e.cycle ? '↻' : null, e.count && e.count > 1 ? `×${e.count}` : null].filter(Boolean) as string[];
  return (
    <g className="topo-edge" data-type={e.type} data-tone={e.tone} data-on={on || undefined} data-dim={dim || undefined} data-edge={e.id} onClick={() => onSelect(e.id)} onPointerEnter={tip} onPointerMove={tip} onPointerLeave={onTipEnd}>
      <path d={le.d} className="topo-edge__hit" />
      {selected && <path d={le.d} className="topo-edge__halo" />}
      <path d={le.d} className="ds-topo-edge" data-type={e.type} data-verdict={e.verdict} data-tone={e.tone} data-selected={selected || undefined} data-cycle={e.cycle || undefined} data-mismatch={e.mismatch ?? undefined} {...marker} />
      {(on || selected) && e.type === 'REQUIRES' && <path d={le.d} className="topo-flow" pathLength={100} />}
      {(e.tone !== 'PASS' || notes.length > 0) && (
        <g className="topo-edge__badge" transform={`translate(${le.mid[0]},${le.mid[1]})`}>
          <g className="topo-edge__scale">
          {e.tone !== 'PASS' && (
            <g data-tone={e.tone}>
              <circle r={7} className="topo-edge__glyph-bg" />
              {e.tone === 'PENDING' ? <circle r={3.6} className="topo-edge__glyph topo-edge__glyph--ring" /> : <path d={TONE_GLYPH[e.tone]} className="topo-edge__glyph" />}
            </g>
          )}
          {notes.length > 0 && (
            <g transform={`translate(${e.tone !== 'PASS' ? 10 : -((notes.join(' ').length * 7 + 8) / 2)},-8)`}>
              <rect width={notes.join(' ').length * 7 + 8} height={16} rx={8} className="topo-edge__note" />
              <text x={4} y={12} className="topo-edge__note-text">{notes.join(' ')}</text>
            </g>
          )}
          </g>
        </g>
      )}
    </g>
  );
});

/** 간선 풍선 — 자기 상태만 바꿔(캔버스 전체를 다시 그리지 않게) 마우스를 따라간다 */
function TipLayer({ api, edges, graph, w }: { api: { current: { show: (id: string, x: number, y: number) => void; hide: () => void } | null }; edges: Map<string, TEdge>; graph: TModel; w: number }) {
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    api.current = { show: (id, x, y) => setTip({ id, x, y }), hide: () => setTip(null) };
    return () => void (api.current = null);
  }, [api]);
  const e = tip ? edges.get(tip.id) : undefined;
  return e && tip ? <EdgeTip e={e} graph={graph} x={tip.x} y={tip.y} w={w} /> : null;
}

function EdgeTip({ e, graph, x, y, w }: { e: TEdge; graph: TModel; x: number; y: number; w: number }) {
  const s = graph.nodes.get(e.source), t = graph.nodes.get(e.target);
  const left = x + 340 > w ? Math.max(8, x - 332) : x + 16;
  return (
    <div className="topo-tip" role="tooltip" style={{ left, top: y + 16 } as CSSProperties} data-tone={e.tone}>
      <p className="topo-tip__head">
        <code>{e.count && e.count > 1 ? G.grouped(e.count) : e.id}</code>
        <span>{G.type[e.type]}</span>
        <b data-tone={e.tone}>{G.tone[e.tone]}</b>
      </p>
      <p className="topo-tip__pair">
        <span>{s?.name ?? e.source}</span>
        <span aria-hidden="true">{e.type === 'REQUIRES' ? '→' : '⇄'}</span>
        <span>{t?.name ?? e.target}</span>
      </p>
      <p className="topo-tip__ver"><code>{`${e.source}${e.sourceVersion ? `@${e.sourceVersion}` : ''}`}</code> · <code>{`${e.target}${e.targetVersion ? `@${e.targetVersion}` : ''}`}</code></p>
      {(e.mismatch || e.cycle) && <p className="topo-tip__warn">{[e.mismatch ? G.mismatch[e.mismatch] : null, e.cycle ? G.cycle : null].filter(Boolean).join(' · ')}</p>}
      {e.findings.slice(0, 3).map((f, i) => (
        <p key={i} className="topo-tip__finding" data-result={f.result}>
          <b>{f.title}</b> {f.message}
        </p>
      ))}
      {e.rationale && <p className="topo-tip__why">{e.rationale.length > 120 ? `${e.rationale.slice(0, 120)}…` : e.rationale}</p>}
    </div>
  );
}

const GATE_TONE_GLYPH = { PASS: 1, REVIEW: 2, FAIL: 3, UNJUDGED: 0 } as const;

const NodeCard = memo(function NodeCard({ n, x, y, w, h, order, state, dim, badge, port, tab, onSelect, onFocus }: { n: TNode; x: number; y: number; w: number; h: number; order: number; state?: NodeState; dim: boolean; badge?: string; port?: { l: boolean; r: boolean }; tab: boolean; onSelect: (id: string) => void; onFocus: (id: string) => void }) {
  const gate = n.gates.length ? G.gates(n.gatePass, n.gates.length) : '';
  const label = n.agg ? `${n.name} — ${G.agg(n.agg.count, n.agg.inner)}` : G.node(n.id, n.name, n.version, n.lifecycle, n.asil, n.flags, gate);
  const name = fitText(n.name, w - 28);
  const asil = n.asil ? (n.asil === 'QM' ? 'QM' : `ASIL ${n.asil}`) : null;
  return (
    <g
      className="ds-topo-node"
      data-node={n.id}
      data-domain={n.domain}
      data-state={state}
      data-dim={dim || undefined}
      data-agg={n.agg ? true : undefined}
      data-focus={state === 'sel' || undefined}
      style={{ transform: `translate(${x}px,${y}px)`, '--i': Math.min(order, 40) } as CSSProperties}
      role="button"
      tabIndex={tab ? 0 : -1}
      aria-pressed={state === 'sel'}
      aria-label={label}
      onClick={() => onSelect(n.id)}
      onFocus={() => onFocus(n.id)}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onSelect(n.id))}
    >
      <title>{label}</title>
      {n.agg && <rect x={6} y={6} width={w} height={h} rx={6} className="topo-card topo-card--stack" />}
      <rect width={w} height={h} rx={6} className="topo-card" />
      <path d={`M6,0 H4 Q0,0 0,4 V${h - 4} Q0,${h} 4,${h} H6 Z`} className="topo-card__band" />
      {port?.l && <rect x={-4} y={h / 2 - 4} width={8} height={8} rx={2} className="topo-port" />}
      {port?.r && <rect x={w - 4} y={h / 2 - 4} width={8} height={8} rx={2} className="topo-port" />}
      <g className="topo-card__near">
        <text x={16} y={21} className="topo-card__id">
          {n.agg ? n.domain : n.id}
          {n.version && <tspan className="topo-card__ver" dx={8}>{`v${n.version}${n.versions.length > 1 ? ` +${n.versions.length - 1}` : ''}`}</tspan>}
        </text>
        {n.lifecycle && (
          <g className="topo-lc" data-lifecycle={n.lifecycle} transform={`translate(${w - 12},0)`}>
            <text x={0} y={21} textAnchor="end">{n.lifecycle}</text>
            <circle cx={-n.lifecycle.length * 6 - 7} cy={17.5} r={3.5} />
          </g>
        )}
        <text x={16} y={44} className="topo-card__name ds-topo-label">{name}</text>
        {n.agg ? (
          <text x={16} y={65} className="topo-card__meta-text">{G.agg(n.agg.count, n.agg.inner)}</text>
        ) : (
          <g transform="translate(16,53)" className="topo-card__meta">
            {asil && (
              <g className="topo-asil" data-asil={n.asil}>
                <rect width={asil.length * 6 + 10} height={15} rx={3} />
                <text x={5} y={11}>{asil}</text>
              </g>
            )}
            {n.flags > 0 && (
              <g transform={`translate(${asil ? asil.length * 6 + 18 : 0},0)`} className="topo-flag">
                <path d="M1.5,1.5 V14 M1.5,2 H9.5 L7.5,5 L9.5,8 H1.5" />
                <text x={13} y={11}>{n.flags}</text>
              </g>
            )}
            <g transform={`translate(${w - 28 - 9 * 7},3)`} className="topo-gates">
              {n.gates.map((g, i) => (
                <rect key={g.id} x={i * 7} y={GATE_TONE_GLYPH[g.tone] ? 0 : 4} width={5} height={GATE_TONE_GLYPH[g.tone] ? 9 : 5} rx={1} data-tone={g.tone}>
                  <title>{`${g.id} ${GATE_META[g.id as GateId]?.name ?? ''}`}</title>
                </rect>
              ))}
            </g>
          </g>
        )}
      </g>
      <text x={w / 2} y={h / 2 + 11} textAnchor="middle" className="topo-card__far">{n.agg ? n.domain : n.id.replace(/^FEAT-/, '')}</text>
      {badge && (
        <g transform={`translate(${w - 6},-6)`} className="topo-card__badge">
          <circle r={11} />
          <text y={4} textAnchor="middle">{badge}</text>
        </g>
      )}
    </g>
  );
});
