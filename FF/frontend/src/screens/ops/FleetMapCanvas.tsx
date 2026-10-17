// 전세계 차량 지도 그림 — MapLibre GL(BSD-3) + OpenFreeMap 벡터 타일(키·쿠키·요청 한도 없음). 밝은 면은 Positron, 어두운 관제실 영역은 Dark.
// 타일 서버에 닿지 않으면(정적 데모·오프라인·e2e) 내장 Natural Earth 육지 윤곽으로 그린다. WebGL이 없으면 그리지 않는다(화면의 표가 같은 내용).
// 차량 좌표는 GeoJSON으로 브라우저 안에서만 그린다 — 타일 요청에는 보고 있는 지도 범위만 담긴다.
// 색은 CSS 토큰에서 읽는다(밝은/어두운 테마를 따라간다). 모든 값은 백엔드 /api/fleet/map 응답 그대로다.
import { useEffect, useRef, useState } from 'react';
import type { ActivationState, FleetMapVehicle, MapLens, SubscriptionState } from '@ff/contracts';
import { ACTIVATION_LABEL, LOCATION_PRECISION_LABEL, SUBSCRIPTION_LABEL } from '@ff/contracts';
import { ko } from '../../copy/ko';

const F = ko.fleetMap;
export const MAP_STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron';
export const MAP_STYLE_DARK_URL: string = import.meta.env.VITE_MAP_STYLE_DARK_URL ?? 'https://tiles.openfreemap.org/styles/dark';

/** 상태별 색 토큰 — 구독은 체험권 전환 화면과 같은 단계 색(제안·체험·구매), 활성은 신호 색 */
export const SUBSCRIPTION_VAR: Record<SubscriptionState, string> = {
  OFFERED: '--viz-1',
  TRIAL: '--viz-2',
  PAID: '--viz-3',
  ENDED: '--faint',
  NONE: '--line-strong',
};
export const ACTIVATION_VAR: Record<ActivationState, string> = {
  ON: '--ok',
  OFF: '--faint',
  DISABLED: '--danger',
  UNKNOWN: '--warn',
};
export const NO_RUNTIME_VAR = '--line-strong';

export const stateVar = (v: FleetMapVehicle, lens: MapLens) => (lens === 'subscription' ? SUBSCRIPTION_VAR[v.subscription] : v.activation ? ACTIVATION_VAR[v.activation] : NO_RUNTIME_VAR);
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

function toGeoJSON(el: Element, items: FleetMapVehicle[], lens: MapLens) {
  return {
    type: 'FeatureCollection' as const,
    features: items
      .filter((v) => v.position)
      .map((v) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [v.position!.lng, v.position!.lat],
        },
        properties: {
          vin: v.vin,
          short: v.label ? v.vin : '',
          demo: v.source === 'DEMO',
          region: v.position!.precision === 'REGION',
          stale: v.stale,
          color: cssVar(el, stateVar(v, lens)),
        },
      })),
  };
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

interface Props {
  items: FleetMapVehicle[];
  lens: MapLens;
  selected: string | null;
  onSelect: (vin: string) => void;
  view: MapView;
}

export function FleetMapCanvas({ items, lens, selected, onSelect, view }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const latest = useRef({ items, lens, onSelect });
  latest.current = { items, lens, onSelect };
  const [phase, setPhase] = useState<'loading' | 'ready' | 'nogl'>(hasWebGL() ? 'loading' : 'nogl');
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!hasWebGL() || !host.current) return;
    let dead = false;
    let m: any;
    (async () => {
      const el = host.current;
      const [{ default: ml }, { style, fallback: fb }] = await Promise.all([import('maplibre-gl'), loadStyle(el), import('maplibre-gl/dist/maplibre-gl.css')]);
      if (dead || !host.current) return;
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
        m.addSource('veh', { type: 'geojson', data: toGeoJSON(el, xs, l) });
        const surface = cssVar(el, '--surface');
        m.addLayer({
          id: 'veh-syn',
          type: 'circle',
          source: 'veh',
          filter: ['all', ['!', ['get', 'demo']], ['!', ['get', 'region']]],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 4, 2.2, 6, 3, 9, 4, 12, 5.5],
            'circle-opacity': 0.85,
          },
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
        m.addLayer({
          id: 'veh-demo',
          type: 'circle',
          source: 'veh',
          filter: ['all', ['get', 'demo'], ['!', ['get', 'region']]],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 6, 7, 12, 9],
            'circle-opacity': ['case', ['get', 'stale'], 0.55, 1],
            'circle-stroke-width': 2,
            'circle-stroke-color': surface,
          },
        });
        m.addLayer({
          id: 'veh-sel',
          type: 'circle',
          source: 'veh',
          filter: ['==', ['get', 'vin'], ''],
          paint: {
            'circle-opacity': 0,
            'circle-radius': 13,
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
            'circle-radius': ['case', ['get', 'demo'], 14, 7],
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
            minzoom: 4,
            filter: ['get', 'demo'],
            layout: {
              'text-field': ['get', 'short'],
              'text-font': font,
              'text-size': 11,
              'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
              'text-radial-offset': 0.9,
              'text-justify': 'auto',
              'text-padding': 1,
            },
            paint: {
              'text-color': cssVar(el, '--ink'),
              'text-halo-color': surface,
              'text-halo-width': 1.8,
            },
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
          popup.setLngLat([v.position.lng, v.position.lat]).setDOMContent(el).addTo(m);
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
              layers: ['veh-demo', 'veh-syn', 'veh-region'],
            }).length,
          );
          host.current.dataset.style = fb ? 'fallback' : isDark(el) ? 'dark' : 'light';
        });
        setPhase('ready');
      });
    })().catch(() => !dead && setPhase('nogl'));
    return () => {
      dead = true;
      m?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (phase !== 'ready' || !m?.getSource('veh')) return;
    m.getSource('veh').setData(toGeoJSON(host.current!, items, lens));
  }, [items, lens, phase]);

  useEffect(() => {
    const m = map.current;
    if (phase !== 'ready' || !m?.getLayer('veh-sel')) return;
    m.setFilter('veh-sel', ['==', ['get', 'vin'], selected ?? '']);
  }, [selected, phase]);

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
    <div className="fm-map">
      <div ref={host} className="fm-map__canvas" data-testid="fleet-map-canvas" role="region" aria-label={F.map} />
      {phase === 'loading' && <p className="fm-map__note">{F.loading}</p>}
      {phase === 'ready' && fallback && <p className="fm-map__note">{F.fallback}</p>}
    </div>
  );
}
