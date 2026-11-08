// 전세계 차량 지도 그림 — MapLibre GL(BSD-3) + OpenFreeMap 벡터 타일(키·쿠키·요청 한도 없음). 밝은 면은 Positron, 어두운 관제실 영역은 Dark.
// 타일 서버에 닿지 않으면(정적 데모·오프라인·e2e) 내장 Natural Earth 육지 윤곽으로 그린다. WebGL이 없으면 그리지 않는다(화면의 표가 같은 내용).
// 차량 좌표는 GeoJSON으로 브라우저 안에서만 그린다 — 타일 요청에는 보고 있는 지도 범위만 담긴다.
// 색은 CSS 토큰에서 읽는다(밝은/어두운 테마를 따라간다). 모든 값은 백엔드 /api/fleet/map 응답 그대로다.
import { useEffect, useRef, useState } from 'react';
import type { ActivationState, FleetMapCluster, FleetMapVehicle, MapLens, SubscriptionState } from '@ff/contracts';
import { ACTIVATION_LABEL, LOCATION_PRECISION_LABEL, SUBSCRIPTION_LABEL, layoutMapVehicles, type MapVehicleGroup } from '@ff/contracts';
import { ko } from '../../copy/ko';
import { CAR_PIXEL_RATIO, carIconName, carImage } from './carIcon';
import { formatCount } from '../../design/format';
import './fleet-map-groups.css';
// maplibre-gl 6은 작업자(worker)를 자기 묶음 옆의 maplibre-gl-worker.mjs에서 찾는다 — 번들러가 옮기지 않으므로 파일로 내보내 주소를 알려 준다
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

const F = ko.fleetMap;
export const MAP_STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron';
export const MAP_STYLE_DARK_URL: string = import.meta.env.VITE_MAP_STYLE_DARK_URL ?? 'https://tiles.openfreemap.org/styles/dark';

/** 상태별 색 토큰 — 구독은 체험권 전환 화면과 같은 단계 색(제안·체험·구매), 활성은 신호 색 */
export const SUBSCRIPTION_VAR: Record<SubscriptionState, string> = {
  OFFERED: '--viz-1',
  TRIAL: '--viz-2',
  PAID: '--viz-3',
  ENDED: '--faint',
  NONE: '--muted',
};
export const ACTIVATION_VAR: Record<ActivationState, string> = {
  ON: '--mark-ok',
  OFF: '--mark-neutral',
  DISABLED: '--mark-danger',
  UNKNOWN: '--mark-warn',
};
export const NO_RUNTIME_VAR = '--line-strong';
/** 자동차 아이콘을 만들 상태 색 토큰 전부 */
export const CAR_STATE_VARS = [...new Set([...Object.values(SUBSCRIPTION_VAR), ...Object.values(ACTIVATION_VAR), NO_RUNTIME_VAR])];
/** 이 확대 단계부터 합성 차량도 자동차로 그린다(도시 단위) */
export const SYN_CAR_ZOOM = 10;
/** 차량을 고르면 이 단계까지 확대한다 */
export const SELECT_ZOOM = 11;
/** 속이 빈 자동차로 그리는 상태 색 — 권한 없음(종료의 회색과 모양으로 가른다) */
export const HOLLOW_VAR = SUBSCRIPTION_VAR.NONE;

export const stateVar = (v: FleetMapVehicle, lens: MapLens) => (lens === 'subscription' ? SUBSCRIPTION_VAR[v.subscription] : v.activation ? ACTIVATION_VAR[v.activation] : NO_RUNTIME_VAR);
/** 상태 색 토큰 → 지금 보기의 상태 이름(군집 설명) */
export function varLabel(name: string, lens: MapLens): string {
  if (lens === 'subscription') {
    const k = (Object.keys(SUBSCRIPTION_VAR) as SubscriptionState[]).find((x) => SUBSCRIPTION_VAR[x] === name);
    return k ? SUBSCRIPTION_LABEL[k] : name;
  }
  const k = (Object.keys(ACTIVATION_VAR) as ActivationState[]).find((x) => ACTIVATION_VAR[x] === name);
  return k ? ACTIVATION_LABEL[k] : '런타임 없음(합성)';
}
export const stateLabel = (v: FleetMapVehicle, lens: MapLens) => (lens === 'subscription' ? SUBSCRIPTION_LABEL[v.subscription] : v.activation ? ACTIVATION_LABEL[v.activation] : '런타임 없음(합성)');

export const VIEWS = {
  world: [
    [-160, -50],
    [178, 70],
  ],
  kr: [
    [124.4, 33],
    [131, 38.9],
  ],
  eu: [
    [-10, 36],
    [20, 56],
  ],
  us: [
    [-125, 24],
    [-66, 50],
  ],
} as const;
export type MapView = keyof typeof VIEWS;

export const hasWebGL = () => typeof window !== 'undefined' && typeof (window as unknown as { WebGLRenderingContext?: unknown }).WebGLRenderingContext !== 'undefined';

// 토큰은 영역(관제실 [data-zone='ops'] 등) 범위로 선언되므로 지도 요소에서 읽는다
const cssVar = (el: Element, name: string) => {
  const cs = getComputedStyle(el);
  return cs.getPropertyValue(name).trim() || cs.getPropertyValue('--muted').trim() || 'gray';
};
/** 면 색이 어두우면 어두운 지도 스타일 */
function isDark(el: Element) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(cssVar(el, '--surface'));
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

/** 군집·펼치기를 거는 차량 — 등록(데모) 차량 중 지역 대표점이 아닌 것. 합성 모집단은 점 크기가 작아 그대로 둔다 */
const placeable = (v: FleetMapVehicle) => v.source !== 'SYNTHETIC' && !!v.position && v.position.precision !== 'REGION';

/** 지도에 넣을 차량 점과 등록 차량 군집 — 확대 단계에 따라 넓게 볼 때는 군집, 가까이 볼 때는 같은 좌표를 펼친다 */
export function toGeoJSON(el: Element, items: FleetMapVehicle[], lens: MapLens, zoom = 0, selected: string | null = null) {
  // 색은 상태 토큰마다 한 번만 읽는다(차량마다 getComputedStyle을 부르지 않게 — 확대할 때마다 다시 그린다)
  const colors = new Map<string, string>();
  const color = (name: string) => colors.get(name) ?? (colors.set(name, cssVar(el, name)), colors.get(name)!);
  const { groups, placed } = layoutMapVehicles(items.filter(placeable), zoom, (v) => stateVar(v, lens), new Set(selected ? [selected] : []));
  const at = new Map(placed.map((x) => [x.vin, x]));
  const grouped = new Set(groups.flatMap((g) => g.vins));
  const data = {
    type: 'FeatureCollection' as const,
    features: items
      .filter((v) => v.position && !grouped.has(v.vin))
      .map((v) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [at.get(v.vin)?.lng ?? v.position!.lng, at.get(v.vin)?.lat ?? v.position!.lat],
        },
        properties: {
          vin: v.vin,
          short: v.label ? v.vin : '',
          demo: v.source !== 'SYNTHETIC',
          region: v.position!.precision === 'REGION',
          stale: v.stale,
          color: color(stateVar(v, lens)),
          hollow: stateVar(v, lens) === HOLLOW_VAR || stateVar(v, lens) === ACTIVATION_VAR.UNKNOWN,
          icon: carIconName(stateVar(v, lens)),
          // 정지 차량은 방향이 없다 — 북쪽으로 둔다
          heading: v.position!.heading ?? 0,
        },
      })),
  };
  return { data, groups };
}

/** 군집 표시 — 상태 색 고리(대수 비례) 가운데 대수. 누르면 그 자리로 확대해 한 대씩 보인다 */
/** 군집 단추 지름(px) — 대수가 많을수록 조금 크게 */
export const groupSize = (count: number) => Math.round(30 + Math.min(18, Math.sqrt(count) * 2.5));

/**
 * 화면에서 겹치는 군집을 하나로 합친다 — 이웃 격자의 군집 단추가 겹쳐 서로 가리고 누르기 어려웠다(대상 크기 2.5.8).
 * project: 경위도 → 화면 px. 합친 중심은 대수 가중 평균, 상태·차량은 더한다. 겹침이 없어질 때까지(최대 4번) 되풀이
 */
export function mergeOverlapping(groups: MapVehicleGroup[], project: (lng: number, lat: number) => { x: number; y: number }, gap = 4): MapVehicleGroup[] {
  let cur = groups.slice();
  for (let pass = 0; pass < 4; pass++) {
    const out: MapVehicleGroup[] = [];
    let merged = false;
    for (const g of [...cur].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))) {
      const p = project(g.lng, g.lat);
      const hit = out.find((o) => {
        const q = project(o.lng, o.lat);
        return Math.hypot(p.x - q.x, p.y - q.y) < (groupSize(g.count) + groupSize(o.count)) / 2 + gap;
      });
      if (!hit) {
        out.push({ ...g, states: { ...g.states }, vins: [...g.vins] });
        continue;
      }
      merged = true;
      const n = hit.count + g.count;
      hit.lat = (hit.lat * hit.count + g.lat * g.count) / n;
      hit.lng = (hit.lng * hit.count + g.lng * g.count) / n;
      hit.count = n;
      for (const [k, v] of Object.entries(g.states)) hit.states[k] = (hit.states[k] ?? 0) + v;
      hit.vins.push(...g.vins);
    }
    cur = out;
    if (!merged) break;
  }
  return cur;
}

export function groupElement(g: MapVehicleGroup, label: (state: string) => string, onOpen: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fm-group';
  const parts = Object.entries(g.states).sort((a, c) => c[1] - a[1]);
  let from = 0;
  const stops = parts.map(([name, n]) => {
    const to = from + (n / g.count) * 360;
    const stop = `var(${name}) ${from.toFixed(1)}deg ${to.toFixed(1)}deg`;
    from = to;
    return stop;
  });
  b.style.setProperty('--fm-group-ring', `conic-gradient(${stops.join(', ')})`);
  b.style.setProperty('--fm-group-size', `${groupSize(g.count)}px`);
  const text = F.group(g.count, parts.map(([name, n]) => `${label(name)} ${n}`).join(', '));
  b.setAttribute('aria-label', text);
  b.title = text;
  b.dataset.count = String(g.count);
  const n = document.createElement('span');
  n.textContent = formatCount(g.count);
  b.append(n);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen();
  });
  return b;
}

function fallbackStyle(el: Element) {
  const land = new URL(`${import.meta.env.BASE_URL ?? '/'}map/world-land.geojson`, window.location.href).href;
  return {
    version: 8 as const,
    sources: {
      land: {
        type: 'geojson' as const,
        data: land,
        attribution: 'Natural Earth (public domain)',
      },
    },
    layers: [
      {
        id: 'bg',
        type: 'background' as const,
        paint: { 'background-color': cssVar(el, '--surface-2') },
      },
      {
        id: 'land',
        type: 'fill' as const,
        source: 'land',
        paint: {
          'fill-color': cssVar(el, '--surface-3'),
          'fill-outline-color': cssVar(el, '--line-strong'),
        },
      },
    ],
  };
}

async function loadStyle(el: Element): Promise<{ style: any; fallback: boolean }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(isDark(el) ? MAP_STYLE_DARK_URL : MAP_STYLE_URL, {
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    return { style: await r.json(), fallback: false };
  } catch {
    return { style: fallbackStyle(el), fallback: true };
  }
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 화면 범위 — 확대 수준과 [서, 남, 동, 북] */
export interface MapViewport {
  zoom: number;
  bbox: [number, number, number, number];
}

function toClusterGeoJSON(clusters: FleetMapCluster[]) {
  return {
    type: 'FeatureCollection' as const,
    features: clusters.map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
      properties: { id: c.id, count: c.count, label: formatCount(c.count) },
    })),
  };
}

interface Props {
  items: FleetMapVehicle[];
  lens: MapLens;
  selected: string | null;
  /** 바뀔 때마다 고른 차량으로 지도를 다시 옮긴다(같은 차량을 다시 골라도) — 핵심 메시지 행동 */
  focus?: number;
  onSelect: (vin: string) => void;
  view: MapView;
  /** 표본 격자(가중 대수) — 범위 안 표본이 많아 점을 받지 못했을 때 그린다 */
  clusters?: FleetMapCluster[];
  /** 이동·확대가 끝날 때마다 화면 범위를 알린다 — 표본 격자·점을 그 범위로 다시 받는다 */
  onViewChange?: (v: MapViewport) => void;
}

export function FleetMapCanvas({ items, lens, selected, focus = 0, onSelect, view, clusters = [], onViewChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const latest = useRef({ items, lens, onSelect, clusters, onViewChange, selected });
  latest.current = { items, lens, onSelect, clusters, onViewChange, selected };
  // 등록 차량 군집 표시(HTML 표지) — 다시 그릴 때마다 지우고 새로 단다
  const markers = useRef<{ remove: () => void }[]>([]);
  const draw = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<'loading' | 'ready' | 'nogl'>(hasWebGL() ? 'loading' : 'nogl');
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!hasWebGL() || !host.current) return;
    let dead = false;
    let m: any;
    (async () => {
      const el = host.current;
      // maplibre-gl 6은 ESM 이름 내보내기만 있다(기본 내보내기 없음) — 모듈 이름 공간을 그대로 쓴다
      const [ml, { style, fallback: fb }] = await Promise.all([import('maplibre-gl'), loadStyle(el), import('maplibre-gl/dist/maplibre-gl.css')]);
      if (dead || !host.current) return;
      ml.setWorkerUrl(mapWorkerUrl);
      setFallback(fb);
      m = new ml.Map({
        container: host.current,
        style,
        bounds: VIEWS.world as any,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.current = m;
      const popup = new ml.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: 'fm-pop',
      });
      m.on('load', () => {
        if (dead) return;
        const { items: xs, lens: l } = latest.current;
        const first = toGeoJSON(el, xs, l, m.getZoom(), latest.current.selected);
        m.addSource('veh', { type: 'geojson', data: first.data });
        // 차량 점·군집을 지금 확대 단계로 다시 놓는다 — 자료가 바뀌거나 확대가 끝날 때
        draw.current = () => {
          const cur = latest.current;
          const { data, groups: cells } = toGeoJSON(el, cur.items, cur.lens, m.getZoom(), cur.selected);
          const groups = mergeOverlapping(cells, (lng, lat) => m.project([lng, lat]));
          m.getSource('veh')?.setData(data);
          for (const x of markers.current) x.remove();
          markers.current = groups.map((g) =>
            new ml.Marker({ element: groupElement(g, (name) => varLabel(name, cur.lens), () => m.easeTo({ center: [g.lng, g.lat], zoom: Math.min(Math.max(m.getZoom() + 2, 5), 14), duration: reducedMotion() ? 0 : 500 })) })
              .setLngLat([g.lng, g.lat])
              .addTo(m),
          );
          if (host.current) host.current.dataset.grouped = String(groups.reduce((n, g) => n + g.count, 0));
        };
        draw.current();
        m.on('zoomend', () => draw.current());
        // 표본 격자 — 원 넓이가 대표 대수에 비례(로그 아님: 수도권과 지방의 차이를 그대로), 숫자는 만·억
        m.addSource('cl', { type: 'geojson', data: toClusterGeoJSON(latest.current.clusters) });
        m.addLayer({
          id: 'cl-bubble',
          type: 'circle',
          source: 'cl',
          paint: {
            'circle-color': cssVar(el, '--accent'),
            'circle-opacity': 0.18,
            'circle-stroke-color': cssVar(el, '--accent'),
            'circle-stroke-width': 1.5,
            'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 0, 8, 400, 16, 2000, 30],
          },
        });
        const surface = cssVar(el, '--surface');
        // 상태 색마다 자동차 아이콘 하나 — 유리·바퀴는 테마와 무관하게 어두운 색
        const carColors = { outline: surface, glass: isDark(el) ? cssVar(el, '--paper') : cssVar(el, '--ink-2') };
        for (const v of CAR_STATE_VARS) m.addImage(carIconName(v), carImage({ ...carColors, body: cssVar(el, v), hollow: v === HOLLOW_VAR || v === ACTIVATION_VAR.UNKNOWN }), { pixelRatio: CAR_PIXEL_RATIO });
        const SYN = ['all', ['!', ['get', 'demo']], ['!', ['get', 'region']]];
        // 합성 모집단 — 넓게 볼 때는 점, 도시 단위로 확대하면 작은 자동차
        m.addLayer({
          id: 'veh-syn',
          type: 'circle',
          source: 'veh',
          maxzoom: SYN_CAR_ZOOM,
          filter: SYN,
          paint: {
            'circle-color': ['case', ['get', 'hollow'], surface, ['get', 'color']],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 4, 2.2, 6, 3, 9, 4],
            'circle-opacity': 0.85,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': ['case', ['get', 'hollow'], 1.5, 0],
          },
        });
        m.addLayer({
          id: 'veh-syn-car',
          type: 'symbol',
          source: 'veh',
          minzoom: SYN_CAR_ZOOM,
          filter: SYN,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], SYN_CAR_ZOOM, 0.5, 15, 0.8],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: { 'icon-opacity': 0.85 },
        });
        // 지역 대표점 고리는 데모 차량만 — 합성 미동의 차량(약 5%)은 한 점에 쌓여 얼룩이 되므로 표·집계에만 남긴다
        m.addLayer({
          id: 'veh-region',
          type: 'circle',
          source: 'veh',
          filter: ['all', ['get', 'demo'], ['get', 'region']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.12,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 7, 8, 16],
            'circle-stroke-width': 2,
            'circle-stroke-color': ['get', 'color'],
          },
        });
        // 데모 Fleet — 받침 원(면 색) 위에 진행 방향으로 돌린 자동차. 합성 점 무리 속에서도 데모 차량이 보이게, 오프라인(마지막 보고 위치)은 흐리게
        m.addLayer({
          id: 'veh-demo-base',
          type: 'circle',
          source: 'veh',
          filter: ['all', ['get', 'demo'], ['!', ['get', 'region']]],
          paint: {
            'circle-color': surface,
            'circle-opacity': ['case', ['get', 'stale'], 0.45, 0.85],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 12, 12, 15, 16, 19],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': ['get', 'color'],
          },
        });
        m.addLayer({
          id: 'veh-demo',
          type: 'symbol',
          source: 'veh',
          filter: ['all', ['get', 'demo'], ['!', ['get', 'region']]],
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 0.75, 12, 0.95, 16, 1.2],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.55, 1] },
        });
        m.addLayer({
          id: 'veh-sel',
          type: 'circle',
          source: 'veh',
          filter: ['==', ['get', 'vin'], ''],
          paint: {
            'circle-opacity': 0,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 12, 6, 15, 12, 18, 16, 22],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': cssVar(el, '--ink'),
          },
        });
        // 클릭 대상은 점보다 넓게
        m.addLayer({
          id: 'veh-hit',
          type: 'circle',
          source: 'veh',
          filter: ['any', ['get', 'demo'], ['!', ['get', 'region']]],
          paint: {
            'circle-opacity': 0,
            'circle-radius': ['case', ['get', 'demo'], 16, 7],
          },
        });
        // 차량 이름표는 지명과 구분되게 기울임이 아닌 굵은 글꼴(없으면 보통)
        const fonts: string[][] = (style.layers ?? []).filter((x: any) => x.type === 'symbol' && Array.isArray(x.layout?.['text-font'])).map((x: any) => x.layout['text-font']);
        const upright = fonts.filter((f) => !f.some((n) => /italic/i.test(n)));
        const font = upright.find((f) => f.some((n) => /bold/i.test(n))) ?? upright[0];
        if (!fb && style.glyphs && font)
          m.addLayer({
            id: 'veh-label',
            type: 'symbol',
            source: 'veh',
            // 국가 단위(5단계 미만)에서는 이름표가 몰려 겹친다 — 자동차만
            minzoom: 5,
            filter: ['get', 'demo'],
            layout: {
              'text-field': ['get', 'short'],
              'text-font': font,
              'text-size': 11,
              'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
              // 받침 원(반지름 12~19px) 밖에 붙는다 — 자동차를 덮지 않게
              'text-radial-offset': ['interpolate', ['linear'], ['zoom'], 5, 1.3, 12, 1.6, 16, 2],
              'text-justify': 'auto',
              'text-padding': 1,
            },
            paint: {
              'text-color': cssVar(el, '--ink'),
              'text-halo-color': surface,
              'text-halo-width': 1.8,
            },
          });
        // 격자를 누르면 그 자리로 두 단계 확대 — 더 작은 격자나 표본 차량이 보인다
        m.on('click', 'cl-bubble', (e: any) => {
          const f = e.features?.[0];
          if (f) m.easeTo({ center: f.geometry.coordinates, zoom: Math.min(m.getZoom() + 2, 14), duration: reducedMotion() ? 0 : 500 });
        });
        m.on('mouseenter', 'cl-bubble', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'cl-bubble', () => (m.getCanvas().style.cursor = ''));
        const report = () => {
          const b = m.getBounds();
          latest.current.onViewChange?.({ zoom: m.getZoom(), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
        };
        m.on('moveend', report);
        report();
        // 묶음 숫자는 자동차 위에 — 스타일이 가진 글꼴로(기본 글꼴은 타일 서버에 없어 404). 대체 윤곽(글꼴 없음)이면 원만
        if (font)
          m.addLayer({
            id: 'cl-label',
            type: 'symbol',
            source: 'cl',
            layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 11, 'text-allow-overlap': false },
            paint: { 'text-color': cssVar(el, '--ink'), 'text-halo-color': surface, 'text-halo-width': 1.8 },
          });
        m.on('click', 'veh-hit', (e: any) => {
          const vin = e.features?.[0]?.properties?.vin;
          if (vin) latest.current.onSelect(vin);
        });
        m.on('mousemove', 'veh-hit', (e: any) => {
          m.getCanvas().style.cursor = 'pointer';
          const vin = e.features?.[0]?.properties?.vin;
          const v = latest.current.items.find((x) => x.vin === vin);
          if (!v?.position) return;
          const el = document.createElement('div');
          const b = document.createElement('strong');
          b.textContent = v.label ?? v.vin;
          const s = document.createElement('div');
          s.textContent = `${v.vin} · ${stateLabel(v, latest.current.lens)}`;
          const p = document.createElement('div');
          p.textContent = `${v.position.city} · ${LOCATION_PRECISION_LABEL[v.position.precision]}${v.stale ? ` · ${F.stale}` : ''}`;
          el.append(b, s, p);
          popup.setLngLat(e.features?.[0]?.geometry?.coordinates ?? [v.position.lng, v.position.lat]).setDOMContent(el).addTo(m);
        });
        m.on('mouseleave', 'veh-hit', () => {
          m.getCanvas().style.cursor = '';
          popup.remove();
        });
        // 그린 차량 점 수 — 진단·e2e용(지도는 접근성 트리에 없다)
        m.on('idle', () => {
          if (dead || !host.current) return;
          host.current.dataset.rendered = String(
            m.queryRenderedFeatures({
              layers: ['veh-demo', 'veh-syn', 'veh-syn-car', 'veh-region'],
            }).length,
          );
          const cars = m.queryRenderedFeatures({ layers: ['veh-demo', 'veh-syn-car'] });
          host.current.dataset.cars = String(cars.length);
          // 화면에 그린 데모 자동차의 픽셀 위치·아이콘 — e2e가 지도 위 자동차를 직접 눌러 보고, 아이콘이 상태 색인지 본다
          host.current.dataset.points = JSON.stringify(
            cars
              .filter((f: any) => f.properties.demo)
              .slice(0, 50)
              .map((f: any) => {
                const p = m.project(f.geometry.coordinates);
                return { vin: f.properties.vin, icon: f.properties.icon, x: Math.round(p.x), y: Math.round(p.y) };
              }),
          );
          host.current.dataset.style = fb ? 'fallback' : isDark(el) ? 'dark' : 'light';
          host.current.dataset.zoom = m.getZoom().toFixed(2);
          host.current.dataset.clusters = String(m.queryRenderedFeatures({ layers: ['cl-bubble'] }).length);
        });
        setPhase('ready');
      });
    })().catch(() => !dead && setPhase('nogl'));
    return () => {
      dead = true;
      for (const x of markers.current) x.remove();
      markers.current = [];
      m?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (phase !== 'ready' || !m?.getSource('veh')) return;
    draw.current();
  }, [items, lens, selected, phase]);

  useEffect(() => {
    const m = map.current;
    if (phase !== 'ready' || !m?.getSource('cl')) return;
    m.getSource('cl').setData(toClusterGeoJSON(clusters));
  }, [clusters, phase]);

  useEffect(() => {
    const m = map.current;
    if (phase !== 'ready' || !m?.getLayer('veh-sel')) return;
    m.setFilter('veh-sel', ['==', ['get', 'vin'], selected ?? '']);
    // 고른 차량으로 지도를 옮긴다 — 표에서 골라도 그 차량이 지도 가운데 보이게(도시 단위까지 확대)
    const v = selected ? latest.current.items.find((x) => x.vin === selected) : null;
    if (v?.position) m.easeTo({ center: [v.position.lng, v.position.lat], zoom: Math.max(m.getZoom(), SELECT_ZOOM), duration: reducedMotion() ? 0 : 700 });
  }, [selected, focus, phase]);

  useEffect(() => {
    const m = map.current;
    if (phase !== 'ready' || !m) return;
    m.fitBounds(VIEWS[view] as any, {
      padding: 24,
      animate: !reducedMotion(),
      duration: 600,
    });
  }, [view, phase]);

  if (phase === 'nogl') return <p className="fm-empty">{F.noWebgl}</p>;
  return (
    // 지도 준비 중은 aria-busy — 하네스·캡처가 '불러오는 중'이 아니라 그린 지도를 기다린다(UX3-05: 캡처가 모두 이 안내에서 멈췄다)
    <div className="fm-map" data-phase={phase} aria-busy={phase === 'loading' || undefined}>
      <div ref={host} className="fm-map__canvas" data-testid="fleet-map-canvas" role="region" aria-label={F.map} />
      {phase === 'loading' && <p className="fm-map__note">{F.loading}</p>}
      {phase === 'ready' && fallback && <p className="fm-map__note fm-map__note--fallback">{F.fallback}</p>}
    </div>
  );
}
