// OpenDRIVE 1.6: authoring (JS spec → XML), parsing (DOMParser) and reference-line sampling.
import { clamp, lerp } from './util.js';

export function integrateGeom(g, ds) {
  if (g.type === 'line') return { x: g.x + Math.cos(g.hdg) * ds, y: g.y + Math.sin(g.hdg) * ds, h: g.hdg };
  if (g.type === 'arc') { const k = g.k, h = g.hdg + k * ds; return { x: g.x + (Math.sin(h) - Math.sin(g.hdg)) / k, y: g.y - (Math.cos(h) - Math.cos(g.hdg)) / k, h }; }
  const hAt = u => g.hdg + g.k0 * u + (g.k1 - g.k0) * u * u / (2 * g.length);
  const n = Math.max(4, Math.ceil(ds / 0.2)), dd = ds / n; let x = g.x, y = g.y;
  for (let i = 0; i < n; i++) { const hm = hAt((i + .5) * dd); x += Math.cos(hm) * dd; y += Math.sin(hm) * dd; }
  return { x, y, h: hAt(ds) };
}
function chain(x, y, h, list) {
  let s = 0; const out = [];
  for (const g of list) { const G = Object.assign({}, g, { s, x, y, hdg: h }); out.push(G); const e = integrateGeom(G, g.length); x = e.x; y = e.y; h = e.h; s += g.length; }
  return out;
}
// Scene mode (?scene=<name>): road 1 is rebuilt from a captured scene's lanes (tools/nurec_scene.py -> splat/<name>.road.json),
// in the same frame as the scene's splat, so the ego and traffic drive on the real lanes and follow the real elevation.
const SCENE_NAME = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scene') : null;
export const SCENE = SCENE_NAME ? await fetch(`./splat/${SCENE_NAME}.road.json`).then(r => (r.ok ? r.json() : null)).then(j => j && Object.assign(j, { name: SCENE_NAME })).catch(() => null) : null;
export const LW = SCENE ? SCENE.laneWidth : 3.75;
const lane = (id, type, w, m) => ({ id, type, w, m });
const LEFT = [lane(1, 'median', [[0, 1.5]], ['solid', .15]), lane(2, 'driving', [[0, LW]], ['broken', .15]), lane(3, 'driving', [[0, LW]], ['broken', .15]), lane(4, 'driving', [[0, LW]], ['solid', .3]), lane(5, 'shoulder', [[0, 2.5]], null)];
const RIGHT = [lane(-1, 'median', [[0, 1.5]], ['solid', .15]), lane(-2, 'driving', [[0, LW]], ['broken', .15]), lane(-3, 'driving', [[0, LW]], ['broken', .15]), lane(-4, 'driving', [[0, LW]], ['solid', .3]), lane(-5, 'shoulder', [[0, 2.5]], null)];
const RIGHT_EXIT = [lane(-1, 'median', [[0, 1.5]], ['solid', .15]), lane(-2, 'driving', [[0, LW]], ['broken', .15]), lane(-3, 'driving', [[0, LW]], ['broken', .15]), lane(-4, 'driving', [[0, LW]], ['broken', .3]),
  lane(-5, 'exit', [[0, 0, 0, 3 * LW / 3600, -2 * LW / 216000], [60, LW]], ['solid', .3]), lane(-6, 'shoulder', [[0, 2.5]], null)];

function sceneGeoms(pts) {  // polyline -> line geometries + cubic elevation records (linear per segment)
  const geoms = [], elev = []; let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x, y, z] = pts[i], [x1, y1, z1] = pts[i + 1], len = Math.hypot(x1 - x, y1 - y);
    geoms.push({ type: 'line', s, x, y, hdg: Math.atan2(y1 - y, x1 - x), length: len }); elev.push({ s, a: z, b: (z1 - z) / len, c: 0, d: 0 }); s += len;
  }
  return { geoms, elev, length: s };
}
const SG = SCENE ? sceneGeoms(SCENE.pts) : null;
const g1 = SG ? SG.geoms : chain(0, 0, 0, [{ type: 'line', length: 400 }, { type: 'arc', length: 300, k: 0.0012 }, { type: 'line', length: 500 }]);
const geomAt = (gs, s) => { let g = gs[0]; for (const q of gs) if (q.s <= s) g = q; return integrateGeom(g, s - g.s); };
const p480 = geomAt(g1, 480);
const t0 = -12.75; // ramp starts at road 1, s=480, outer edge of lane -4
const rampStart = { x: p480.x + Math.sin(p480.h) * (-t0), y: p480.y - Math.cos(p480.h) * (-t0), h: p480.h };
const g2 = chain(rampStart.x, rampStart.y, rampStart.h, [{ type: 'line', length: 40 }, { type: 'spiral', length: 60, k0: 0, k1: -0.008 }, { type: 'arc', length: 170, k: -0.008 }, { type: 'line', length: 120 }]);

export const SPEC = [
  SG ? { id: 1, name: `Scene ${SCENE.name}`, length: SG.length, geoms: g1, elev: SG.elev, sections: [{ s: 0, left: LEFT, right: RIGHT, center: null }] }
    : { id: 1, name: 'A-Hauptfahrbahn', length: 1200, geoms: g1, sections: [{ s: 0, left: LEFT, right: RIGHT, center: null }, { s: 300, left: LEFT, right: RIGHT_EXIT, center: null }, { s: 480, left: LEFT, right: RIGHT, center: null }] },
  { id: 2, name: 'Ausfahrt-Rampe', length: 390, geoms: g2, sections: [{ s: 0, left: [], right: [lane(-1, 'exit', [[0, LW]], ['solid', .3]), lane(-2, 'shoulder', [[0, 2.0]], null)], center: ['solid', .3] }] }
];
const f = (v, n) => (+v).toFixed(n);
export function toXML(spec) {
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>', '<OpenDRIVE>');
  L.push('  <header revMajor="1" revMinor="6" name="Ausfahrt Testfeld" version="1.00" date="2026-10-11T12:00:00" north="0" south="0" east="0" west="0" vendor="Mutuus Lab prototype"/>');
  for (const r of spec) {
    L.push(`  <road name="${r.name}" length="${f(r.length, 3)}" id="${r.id}" junction="-1">`);
    if (r.id === 2) L.push('    <!-- diverges from road 1 at s=480, t=-12.75 (outer edge of lane -4) -->');
    L.push('    <type s="0.0" type="motorway"><speed max="130" unit="km/h"/></type>', '    <planView>');
    for (const g of r.geoms) {
      const inner = g.type === 'line' ? '<line/>' : g.type === 'arc' ? `<arc curvature="${f(g.k, 6)}"/>` : `<spiral curvStart="${f(g.k0, 6)}" curvEnd="${f(g.k1, 6)}"/>`;
      L.push(`      <geometry s="${f(g.s, 3)}" x="${f(g.x, 3)}" y="${f(g.y, 3)}" hdg="${f(g.hdg, 6)}" length="${f(g.length, 3)}">${inner}</geometry>`);
    }
    L.push('    </planView>', '    <elevationProfile>' + (r.elev || [{ s: 0, a: 0, b: 0, c: 0, d: 0 }]).map(e => `<elevation s="${f(e.s, 3)}" a="${f(e.a, 4)}" b="${f(e.b, 6)}" c="${f(e.c, 8)}" d="${f(e.d, 10)}"/>`).join('') + '</elevationProfile>', '    <lanes>');
    for (const sec of r.sections) {
      L.push(`      <laneSection s="${f(sec.s, 3)}">`);
      const laneX = l => {
        const ws = l.w.map(w => `<width sOffset="${f(w[0], 3)}" a="${f(w[1], 4)}" b="${f(w[2] || 0, 6)}" c="${f(w[3] || 0, 8)}" d="${f(w[4] || 0, 10)}"/>`).join('');
        const m = l.m ? `<roadMark sOffset="0" type="${l.m[0]}" weight="${l.m[1] >= .25 ? 'bold' : 'standard'}" color="white" width="${l.m[1]}"/>` : '<roadMark sOffset="0" type="none"/>';
        return `          <lane id="${l.id}" type="${l.type}" level="false">${ws}${m}</lane>`;
      };
      if (sec.left.length) { L.push('        <left>'); sec.left.slice().reverse().forEach(l => L.push(laneX(l))); L.push('        </left>'); }
      L.push('        <center>', `          <lane id="0" type="none" level="false">${sec.center ? `<roadMark sOffset="0" type="${sec.center[0]}" weight="bold" color="white" width="${sec.center[1]}"/>` : '<roadMark sOffset="0" type="none"/>'}</lane>`, '        </center>');
      L.push('        <right>'); sec.right.forEach(l => L.push(laneX(l))); L.push('        </right>', '      </laneSection>');
    }
    L.push('    </lanes>', '  </road>');
  }
  L.push('</OpenDRIVE>');
  return L.join('\n');
}

const STEP = 0.5;
export function parseODR(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('OpenDRIVE XML 파싱 실패');
  const roads = {};
  for (const re of doc.querySelectorAll('road')) {
    const a = (el, n) => +el.getAttribute(n);
    const rd = { id: +re.getAttribute('id'), name: re.getAttribute('name'), length: a(re, 'length'), geoms: [], sections: [],
      elev: [...re.querySelectorAll('elevationProfile > elevation')].map(e => ({ s: a(e, 's'), a: a(e, 'a'), b: a(e, 'b'), c: a(e, 'c'), d: a(e, 'd') })).sort((p, q) => p.s - q.s) };
    for (const ge of re.querySelectorAll('planView > geometry')) {
      const c = ge.firstElementChild;
      const g = { s: a(ge, 's'), x: a(ge, 'x'), y: a(ge, 'y'), hdg: a(ge, 'hdg'), length: a(ge, 'length'), type: c.tagName };
      if (g.type === 'arc') g.k = a(c, 'curvature');
      if (g.type === 'spiral') { g.k0 = a(c, 'curvStart'); g.k1 = a(c, 'curvEnd'); }
      rd.geoms.push(g);
    }
    const pl = le => {
      const rm = le.querySelector('roadMark');
      return { id: a(le, 'id'), type: le.getAttribute('type'),
        widths: [...le.querySelectorAll('width')].map(w => ({ sOffset: a(w, 'sOffset'), a: a(w, 'a'), b: a(w, 'b'), c: a(w, 'c'), d: a(w, 'd') })).sort((p, q) => p.sOffset - q.sOffset),
        mark: rm ? { type: rm.getAttribute('type'), width: +(rm.getAttribute('width') || 0) } : null };
    };
    for (const ls of re.querySelectorAll('lanes > laneSection')) {
      const c = ls.querySelector('center > lane');
      rd.sections.push({ s: a(ls, 's'), left: [...ls.querySelectorAll('left > lane')].map(pl).sort((p, q) => p.id - q.id), right: [...ls.querySelectorAll('right > lane')].map(pl).sort((p, q) => q.id - p.id), center: c ? pl(c) : null });
    }
    sampleRoad(rd); roads[rd.id] = rd;
  }
  return roads;
}
function sampleRoad(rd) {
  const n = Math.round(rd.length / STEP) + 1; rd.n = n;
  rd.sx = new Float64Array(n); rd.sy = new Float64Array(n); rd.sh = new Float64Array(n); rd.sz = new Float64Array(n);
  let gi = 0, ei = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(i * STEP, rd.length);
    while (gi < rd.geoms.length - 1 && s >= rd.geoms[gi + 1].s - 1e-9) gi++;
    const g = rd.geoms[gi], p = integrateGeom(g, s - g.s);
    rd.sx[i] = p.x; rd.sy[i] = p.y; rd.sh[i] = p.h;
    while (ei < rd.elev.length - 1 && s >= rd.elev[ei + 1].s - 1e-9) ei++;
    const e = rd.elev[ei]; if (e) { const u = s - e.s; rd.sz[i] = e.a + e.b * u + e.c * u * u + e.d * u * u * u; }
  }
}
export function refAt(rd, s) {
  s = clamp(s, 0, rd.length);
  const fi = s / STEP, i0 = Math.min(Math.floor(fi), rd.n - 2), u = fi - i0;
  return { x: lerp(rd.sx[i0], rd.sx[i0 + 1], u), y: lerp(rd.sy[i0], rd.sy[i0 + 1], u), h: lerp(rd.sh[i0], rd.sh[i0 + 1], u), z: lerp(rd.sz[i0], rd.sz[i0 + 1], u) };
}
function widthAt(l, ds) { let w = l.widths[0]; for (const q of l.widths) if (q.sOffset <= ds + 1e-6) w = q; const u = ds - w.sOffset; return w.a + w.b * u + w.c * u * u + w.d * u * u * u; }
export function lanesOf(sec, ds) {
  const m = { 0: { inner: 0, outer: 0 } }; let t = 0;
  for (const l of sec.right) { const w = widthAt(l, ds); m[l.id] = { inner: t, outer: t - w, lane: l }; t -= w; } m.rightEdge = t; t = 0;
  for (const l of sec.left) { const w = widthAt(l, ds); m[l.id] = { inner: t, outer: t + w, lane: l }; t += w; } m.leftEdge = t;
  return m;
}
function secIdx(rd, s) { let k = 0; for (let i = 0; i < rd.sections.length; i++) if (rd.sections[i].s <= s + 1e-6) k = i; return k; }
export function lanesAt(rd, s) { const sec = rd.sections[secIdx(rd, s)]; return lanesOf(sec, s - sec.s); }
export function laneIdAt(rd, s, t) { const m = lanesAt(rd, s); for (const k in m) { const e = m[k]; if (typeof e !== 'object' || +k === 0) continue; const lo = Math.min(e.inner, e.outer), hi = Math.max(e.inner, e.outer); if (t >= lo && t < hi) return +k; } return 0; }
/** OpenDRIVE (x,y,z-up) → three.js (x, y-up, -y) */
export function W3(rd, s, t, y) { const r = refAt(rd, s); return [r.x - Math.sin(r.h) * t, (y || 0) + r.z, -(r.y + Math.cos(r.h) * t)]; }

export const XML = toXML(SPEC);
export const roads = parseODR(XML);
export const RD1 = roads[1], RD2 = roads[2];
export const tLane = id => { const s = Math.sign(id), k = Math.abs(id); return s * (1.5 + (k - 2) * LW + LW / 2); };
