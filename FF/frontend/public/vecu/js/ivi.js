// In-vehicle infotainment: instrument cluster + centre display drawn on canvases, used as textures in the cabin
// and mirrored into the IVI panel. Original UI design; platform label only names the target stack.
import * as THREE from 'three/webgpu';
import { clamp, lerp } from './util.js';
import { RD1, RD2, refAt } from './odr.js';

export const ivi = {
  platform: 'Pleos Connect', screen: 'nav', popup: null, lang: 'ko',
  body: { locked: true, windows: [0, 0, 0, 0], trunk: false, doors: [false, false, false, false], childLock: false },
  adas: { acc: 'active', lka: true, setKph: 110, gap: 2, bsd: false, fcw: false },
  media: { title: '밤의 고속도로', artist: 'Mutuus Session', pos: .42, source: 'Bluetooth' },
  climate: { temp: 22.0, fan: 3, auto: true, seatHeat: 0 },
  feature: null,   // {name, state: offer|active|safe_default|released|disabled}
  guidance: null,  // IC·JC 사전안내 {name, type, direction, lane, dist_m, phase} while the feature shows it
  live: { kph: 0, limit: 130, gear: 'D', lead: null, lane: -3, dist: 420, maneuver: '출구 12 Testfeld Nord', clock: '12:30', temp: 18, range: 412, soc: .78, turn: 0, ttc: null, brake: false, time: 'day' },
  dirty: true
};
const KO = { nav: '내비', media: '미디어', vehicle: '차량', adas: '주행 보조' };
const FEAT_ST = { offer: '체험 가능', active: '사용 중', safe_default: '일시 중지 · 기본 주행 보조', released: '해제됨', disabled: '꺼짐 (정책 OFF)' };

export function iviApply(set) { // vECU → IVI merge
  for (const k of ['screen', 'popup', 'platform', 'lang']) if (k in set) ivi[k] = set[k];
  for (const k of ['body', 'adas', 'media', 'climate']) if (set[k] && typeof set[k] === 'object') Object.assign(ivi[k], set[k]);
  if (set.popup && !set.popup.until) ivi.popup.until = performance.now() + (set.popup.ms || 6000);
  ivi.dirty = true;
}

/* ---------------- drawing helpers ---------------- */
const FONT = '"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif', MONO = '"IBM Plex Mono",ui-monospace,Menlo,monospace';
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function txt(g, s, x, y, size, color, align = 'left', weight = 500, font = FONT) { g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }
const C = { bg: '#0b0e13', panel: '#141922', line: '#243040', fg: '#e8eef5', mute: '#8794a5', acc: '#4cc3ff', ok: '#4ad58a', warn: '#ffb648', crit: '#ff5a4e', road: '#2d3747', route: '#4cc3ff' };

/* ---------------- cluster (12.3", 3:1) ---------------- */
export function drawCluster(g, w, h) {
  const L = ivi.live;
  g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
  const grad = g.createRadialGradient(w / 2, h * .55, 20, w / 2, h * .55, w * .6); grad.addColorStop(0, '#152033'); grad.addColorStop(1, C.bg); g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // speed
  txt(g, `${Math.round(L.kph)}`, w / 2, h * .46, h * .46, C.fg, 'center', 300, MONO);
  txt(g, 'km/h', w / 2, h * .74, h * .09, C.mute, 'center');
  // limit sign
  // limit sign clear of the speed digits (it overlapped them at w / 2 + h * .36)
  const sx = w / 2 + h * .62, sy = h * .22, sr = h * .1; g.beginPath(); g.arc(sx, sy, sr, 0, 6.283); g.fillStyle = '#fff'; g.fill(); g.lineWidth = sr * .22; g.strokeStyle = '#d62b1f'; g.stroke(); txt(g, `${L.limit}`, sx, sy + 1, sr * .95, '#111', 'center', 700);
  // gear + drive mode
  txt(g, L.gear, w / 2 - h * .6, h * .22, h * .12, C.fg, 'center', 600, MONO); txt(g, 'P  R  N', w / 2 - h * .7, h * .22, h * .085, C.mute, 'right', 500, MONO);   // PRN ends left of the gear letter
  // ADAS lane graphic (left)
  const ax = w * .17, ay = h * .55, aw = w * .18, ah = h * .62;
  g.save(); g.beginPath(); rr(g, ax - aw / 2, ay - ah / 2, aw, ah, 14); g.clip();
  const lk = ivi.adas.lka ? C.ok : C.line; g.strokeStyle = lk; g.lineWidth = 3;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(ax + s * aw * .42, ay + ah / 2); g.lineTo(ax + s * aw * .16, ay - ah / 2); g.stroke(); }
  g.setLineDash([10, 10]); g.strokeStyle = C.line; g.beginPath(); g.moveTo(ax + aw * .5, ay + ah / 2); g.lineTo(ax + aw * .2, ay - ah / 2); g.stroke(); g.setLineDash([]);
  // ego
  g.fillStyle = C.fg; rr(g, ax - 14, ay + ah * .22, 28, 48, 8); g.fill();
  if (L.lead) { const d = clamp(L.lead.gap / 90, 0, 1); const ly = ay + ah * .22 - 30 - (1 - Math.pow(1 - d, 2)) * ah * .55; const sc = lerp(1, .45, d);
    g.fillStyle = L.ttc != null && L.ttc < 2.5 ? C.crit : C.acc; rr(g, ax - 14 * sc, ly, 28 * sc, 40 * sc, 6); g.fill(); }
  // ACC gap bars
  const acc = ivi.adas.acc; const barC = acc === 'active' ? C.ok : acc === 'standby' ? C.warn : C.line;
  for (let i = 0; i < 3; i++) { g.fillStyle = i < ivi.adas.gap ? barC : C.line; rr(g, ax - 22 + i * 16, ay + ah * .36, 12, 8, 2); g.fill(); }
  g.restore();
  txt(g, acc === 'active' ? `ACC ${ivi.adas.setKph}` : acc === 'standby' ? 'ACC 대기' : 'ACC 꺼짐', ax, ay + ah / 2 + h * .07, h * .075, barC, 'center', 600);
  // right: energy + range + nav hint
  const rx = w * .83; txt(g, `${Math.round(L.range)} km`, rx, h * .36, h * .11, C.fg, 'center', 600, MONO); txt(g, '주행 가능 거리', rx, h * .47, h * .065, C.mute, 'center');
  g.fillStyle = C.line; rr(g, rx - w * .08, h * .54, w * .16, 10, 5); g.fill(); g.fillStyle = L.soc < .2 ? C.warn : C.ok; rr(g, rx - w * .08, h * .54, w * .16 * L.soc, 10, 5); g.fill();
  txt(g, `${Math.round(L.soc * 100)}%`, rx, h * .64, h * .07, C.mute, 'center', 500, MONO);
  const G = ivi.guidance;   // IC·JC 사전안내 (Feature Flag; overrides the route maneuver while shown)
  txt(g, G ? `${G.dist_m} m 후` : `${fmtDist(L.dist)} 후`, rx, h * .78, h * .07, C.acc, 'center', 600); txt(g, G ? `${G.name} · ${G.direction === 'left' ? '왼쪽' : '오른쪽'} ${G.type}` : L.maneuver, rx, h * .87, h * .065, C.fg, 'center');
  // status strip
  txt(g, L.clock, w * .04, h * .08, h * .07, C.mute, 'left', 500, MONO); txt(g, `${L.temp}°C  ·  ${ivi.platform}`, w * .96, h * .08, h * .065, C.mute, 'right');
  // turn indicators
  for (const s of [-1, 1]) { const on = L.turn === s && Math.floor(performance.now() / 400) % 2 === 0; g.fillStyle = on ? C.ok : C.line; const tx = w / 2 + s * h * .62, ty = h * .12;
    g.beginPath(); g.moveTo(tx + s * 18, ty); g.lineTo(tx - s * 4, ty - 12); g.lineTo(tx - s * 4, ty - 5); g.lineTo(tx - s * 20, ty - 5); g.lineTo(tx - s * 20, ty + 5); g.lineTo(tx - s * 4, ty + 5); g.lineTo(tx - s * 4, ty + 12); g.closePath(); g.fill(); }
  // warnings
  const warn = []; if (ivi.adas.fcw) warn.push(['전방 충돌 주의', C.crit]); if (!ivi.body.locked && L.kph > 10) warn.push(['도어 잠금 해제', C.warn]); if (ivi.body.trunk) warn.push(['트렁크 열림', C.warn]); if (L.brake) warn.push(['제동 중', C.mute]);
  warn.slice(0, 2).forEach(([t, c], i) => { txt(g, t, w / 2, h * .9 + i * h * .08, h * .065, c, 'center', 600); });
}

/* ---------------- centre display (16:9) ---------------- */
function fmtDist(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`; }
function drawMap(g, x, y, w, h, egoS, egoT, hdg) {
  g.save(); rr(g, x, y, w, h, 18); g.clip(); g.fillStyle = '#10151d'; g.fillRect(x, y, w, h);
  const scale = w / 420, cx = x + w / 2, cy = y + h * .68;
  const r0 = refAt(RD1, egoS); const ex = r0.x - Math.sin(r0.h) * egoT, ey = r0.y + Math.cos(r0.h) * egoT;
  const P = (X, Y) => { const dx = X - ex, dy = Y - ey; const a = -r0.h + Math.PI / 2; const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a); return [cx + u * scale, cy - v * scale]; };
  const road = (rd, wd, color, dash) => { g.beginPath(); for (let s = 0; s <= rd.length; s += 8) { const r = refAt(rd, s); const [px, py] = P(r.x - Math.sin(r.h) * wd, r.y + Math.cos(r.h) * wd); s === 0 ? g.moveTo(px, py) : g.lineTo(px, py); } g.strokeStyle = color; g.lineWidth = Math.abs(wd) > 1 ? 2 : 1; if (dash) g.setLineDash([6, 8]); g.stroke(); g.setLineDash([]); };
  // carriageways
  g.lineWidth = 18 * scale; g.strokeStyle = C.road; for (const [rd, off] of [[RD1, -8.6], [RD1, 8.6], [RD2, -2.9]]) { g.beginPath(); for (let s = 0; s <= rd.length; s += 8) { const r = refAt(rd, s); const [px, py] = P(r.x - Math.sin(r.h) * off, r.y + Math.cos(r.h) * off); s === 0 ? g.moveTo(px, py) : g.lineTo(px, py); } g.lineWidth = (rd === RD2 ? 6 : 14) * scale; g.stroke(); }
  road(RD1, 0, '#4a5668', false);
  // route: ego lane to the exit, then ramp
  g.lineCap = 'round'; g.lineWidth = 4; g.strokeStyle = C.route; g.beginPath(); let first = true;
  for (let s = Math.max(0, egoS - 20); s <= 480; s += 6) { const r = refAt(RD1, s); const t = lerp(egoT, -12.75, clamp((s - 330) / 150, 0, 1)); const [px, py] = P(r.x - Math.sin(r.h) * t, r.y + Math.cos(r.h) * t); first ? g.moveTo(px, py) : g.lineTo(px, py); first = false; }
  if (egoS < 480) for (let s = 0; s <= RD2.length; s += 8) { const r = refAt(RD2, s); const [px, py] = P(r.x - Math.sin(r.h) * -1.875, r.y + Math.cos(r.h) * -1.875); g.lineTo(px, py); }
  g.stroke();
  // ego arrow
  g.fillStyle = C.fg; g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx + 9, cy + 10); g.lineTo(cx, cy + 5); g.lineTo(cx - 9, cy + 10); g.closePath(); g.fill();
  g.restore();
}
export function drawCenter(g, w, h, nav) {
  const L = ivi.live;
  g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
  // status bar
  txt(g, L.clock, 28, 26, 20, C.fg, 'left', 600, MONO); txt(g, `${ivi.platform}  ·  ${L.temp}°C 외기`, w - 28, 26, 17, C.mute, 'right');
  g.fillStyle = C.ok; g.beginPath(); g.arc(w * .5, 26, 5, 0, 6.283); g.fill(); txt(g, '연결됨', w * .5 + 12, 26, 16, C.mute, 'left');
  // tab rail
  const tabs = ['nav', 'media', 'vehicle', 'adas']; const tw = 150;
  tabs.forEach((k, i) => { const x = 28 + i * (tw + 10), y = 52; const on = ivi.screen === k; g.fillStyle = on ? C.panel : 'transparent'; rr(g, x, y, tw, 40, 10); g.fill(); if (on) { g.fillStyle = C.acc; rr(g, x + 14, y + 33, tw - 28, 3, 1.5); g.fill(); } txt(g, KO[k], x + tw / 2, y + 19, 18, on ? C.fg : C.mute, 'center', on ? 600 : 500); });
  const top = 108;
  if (ivi.screen === 'nav') {
    drawMap(g, 28, top, w * .6 - 28, h - top - 88, nav.s, nav.t, nav.hdg);
    const px = w * .6 + 16, pw = w - px - 28; g.fillStyle = C.panel; rr(g, px, top, pw, 150, 18); g.fill();
    g.fillStyle = C.acc; rr(g, px + 18, top + 24, 44, 44, 10); g.fill(); g.fillStyle = C.bg; g.beginPath(); g.moveTo(px + 40, top + 32); g.lineTo(px + 54, top + 50); g.lineTo(px + 44, top + 50); g.lineTo(px + 44, top + 60); g.lineTo(px + 36, top + 60); g.lineTo(px + 36, top + 50); g.lineTo(px + 26, top + 50); g.closePath(); g.fill();
    const G = ivi.guidance;   // while the IC·JC guidance is shown it is the next maneuver (one distance on screen, as on the cluster)
    txt(g, G ? `${G.dist_m} m` : fmtDist(L.dist), px + 78, top + 44, 34, C.fg, 'left', 600, MONO); txt(g, G ? `${G.name} ${G.type} · ${G.direction === 'left' ? '왼쪽' : '오른쪽'}` : L.maneuver, px + 18, top + 100, 20, C.fg, 'left', 600); txt(g, `차선 ${Math.abs(L.lane) - 1} · 제한 ${L.limit} km/h`, px + 18, top + 128, 16, C.mute);
    g.fillStyle = C.panel; rr(g, px, top + 166, pw, h - top - 166 - 88, 18); g.fill();
    txt(g, '도착 예정', px + 18, top + 196, 16, C.mute); txt(g, `${L.clock.slice(0, 2)}:${String((+L.clock.slice(3) + 4) % 60).padStart(2, '0')}`, px + 18, top + 228, 30, C.fg, 'left', 600, MONO);
    txt(g, '남은 거리', px + pw / 2, top + 196, 16, C.mute); txt(g, `${(L.dist / 1000 + 2.4).toFixed(1)} km`, px + pw / 2, top + 228, 30, C.fg, 'left', 600, MONO);
    txt(g, '경로: 고속도로 → 출구 12 → Testfeld Nord', px + 18, top + 270, 16, C.mute);
    if (G) {   // IC·JC 사전안내 card: direction, remaining distance, lanes to take (right-most lanes highlighted for a right exit)
      const y0 = top + 166, ch = h - top - 166 - 88, right = G.direction !== 'left', col = G.phase === '임박' ? C.warn : C.acc;
      g.fillStyle = '#0f1a2b'; rr(g, px, y0, pw, ch, 18); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
      txt(g, `IC·JC 사전안내 · ${G.phase}`, px + 18, y0 + 30, 16, col, 'left', 700); txt(g, `${G.name} ${G.type}`, px + 18, y0 + 62, 22, C.fg, 'left', 600);
      txt(g, `${G.dist_m} m`, px + 18, y0 + 112, 44, C.fg, 'left', 700, MONO); txt(g, `${right ? '오른쪽' : '왼쪽'} 방향 · ${G.lane}`, px + 18, y0 + 150, 18, C.fg, 'left', 600);
      const n = 3, lw = 34, lx = px + pw - 28 - n * lw, ly = y0 + 70;
      for (let i = 0; i < n; i++) { const on = right ? i === n - 1 : i === 0; g.fillStyle = on ? col : C.line; rr(g, lx + i * lw + 3, ly, lw - 6, 70, 6); g.fill();
        g.strokeStyle = on ? C.bg : C.mute; g.lineWidth = 4; g.beginPath(); const cx = lx + i * lw + lw / 2; g.moveTo(cx, ly + 58); g.lineTo(cx, ly + 26);
        if (on) { g.lineTo(cx + (right ? 9 : -9), ly + 14); } g.stroke(); }
    }
  } else if (ivi.screen === 'media') {
    const m = ivi.media; g.fillStyle = C.panel; rr(g, 28, top, w - 56, h - top - 88, 18); g.fill();
    const art = g.createLinearGradient(60, top + 30, 260, top + 230); art.addColorStop(0, '#2b4a86'); art.addColorStop(1, '#8a2b4e'); g.fillStyle = art; rr(g, 60, top + 30, 200, 200, 16); g.fill();
    txt(g, m.title, 290, top + 70, 34, C.fg, 'left', 600); txt(g, m.artist, 290, top + 112, 20, C.mute); txt(g, m.source, 290, top + 142, 16, C.acc);
    g.fillStyle = C.line; rr(g, 290, top + 190, w - 380, 6, 3); g.fill(); g.fillStyle = C.acc; rr(g, 290, top + 190, (w - 380) * m.pos, 6, 3); g.fill();
    ['⏮', '⏸', '⏭'].forEach((s, i) => { g.fillStyle = C.line; g.beginPath(); g.arc(360 + i * 90, top + 260, 28, 0, 6.283); g.fill(); txt(g, s, 360 + i * 90, top + 261, 22, C.fg, 'center'); });
  } else if (ivi.screen === 'vehicle') {
    const b = ivi.body; const items = [['도어 잠금', b.locked ? '잠김' : '해제', b.locked ? C.ok : C.warn], ['트렁크', b.trunk ? '열림' : '닫힘', b.trunk ? C.warn : C.fg], ['차일드 락', b.childLock ? '켜짐' : '꺼짐', C.fg],
      ['창문 (앞/뒤)', `${b.windows[0]}% · ${b.windows[1]}% / ${b.windows[2]}% · ${b.windows[3]}%`, C.fg], ['공조', `${ivi.climate.temp.toFixed(1)}°C · 풍량 ${ivi.climate.fan}${ivi.climate.auto ? ' · AUTO' : ''}`, C.fg], ['시트 열선', ivi.climate.seatHeat ? `${ivi.climate.seatHeat}단` : '꺼짐', C.fg]];
    items.forEach(([k, v, c], i) => { const x = 28 + (i % 2) * (w / 2 - 14), y = top + Math.floor(i / 2) * 96; g.fillStyle = C.panel; rr(g, x, y, w / 2 - 42, 84, 16); g.fill(); txt(g, k, x + 20, y + 28, 16, C.mute); txt(g, v, x + 20, y + 58, 22, c, 'left', 600); });
    txt(g, '차량 API 상태 — vECU가 body 명령으로 갱신', 28, h - 108, 15, C.mute);
  } else {
    const a = ivi.adas; const items = [['스마트 크루즈 컨트롤', a.acc === 'active' ? `작동 중 · ${a.setKph} km/h · 간격 ${a.gap}` : a.acc === 'standby' ? '대기' : '꺼짐', a.acc === 'active' ? C.ok : C.mute],
      ['차로 유지 보조', a.lka ? '켜짐' : '꺼짐', a.lka ? C.ok : C.mute], ['후측방 충돌 경고', a.bsd ? '감지' : '정상', a.bsd ? C.warn : C.fg], ['전방 충돌 방지 보조', a.fcw ? '경고' : '정상', a.fcw ? C.crit : C.fg],
      ['선행 차량', L.lead ? `${L.lead.gap.toFixed(0)} m · ${Math.round(L.lead.v * 3.6)} km/h` : '없음', C.fg], ['충돌 예상 시간', L.ttc != null ? `${L.ttc.toFixed(1)} s` : '—', L.ttc != null && L.ttc < 2.5 ? C.crit : C.fg]];
    // a feature delivered by Feature Flag (virtual validation shows the vehicle-side state the driver would see)
    const f = ivi.feature; if (f) items.unshift([f.name, FEAT_ST[f.state] || f.state, f.state === 'active' ? C.ok : f.state === 'safe_default' ? C.warn : C.mute]);
    items.forEach(([k, v, c], i) => { const x = 28 + (i % 2) * (w / 2 - 14), y = top + Math.floor(i / 2) * 96; g.fillStyle = C.panel; rr(g, x, y, w / 2 - 42, 84, 16); g.fill(); txt(g, k, x + 20, y + 28, 16, C.mute); txt(g, v, x + 20, y + 58, 22, c, 'left', 600); });
  }
  // climate bar
  g.fillStyle = C.panel; rr(g, 28, h - 74, w - 56, 54, 16); g.fill();
  txt(g, `${ivi.climate.temp.toFixed(1)}°`, 60, h - 47, 24, C.fg, 'left', 600, MONO); txt(g, ivi.climate.auto ? 'AUTO' : '수동', 150, h - 47, 16, C.acc); txt(g, `풍량 ${ivi.climate.fan}`, 230, h - 47, 16, C.mute);
  txt(g, `${Math.round(L.kph)} km/h`, w / 2, h - 47, 18, C.mute, 'center', 500, MONO); txt(g, `${ivi.climate.temp.toFixed(1)}°`, w - 60, h - 47, 24, C.fg, 'right', 600, MONO);
  // popup
  const p = ivi.popup; if (p && (!p.until || performance.now() < p.until)) { const pw = w * .6, ph = 110, px = (w - pw) / 2, py = h * .3; const c = p.level === 'crit' ? C.crit : p.level === 'warn' ? C.warn : C.acc;
    g.fillStyle = 'rgba(11,14,19,.92)'; rr(g, px, py, pw, ph, 18); g.fill(); g.strokeStyle = c; g.lineWidth = 2; g.stroke(); txt(g, p.title || '알림', px + 24, py + 36, 22, c, 'left', 700); txt(g, p.text || '', px + 24, py + 74, 18, C.fg); }
  else if (p && p.until && performance.now() >= p.until) ivi.popup = null;
}

/* ---------------- textures + panel mirroring ---------------- */
export class IviScreens {
  constructor() {
    this.cl = document.createElement('canvas'); this.cl.width = 1536; this.cl.height = 512;
    this.cc = document.createElement('canvas'); this.cc.width = 1280; this.cc.height = 720;
    this.gl = this.cl.getContext('2d'); this.gc = this.cc.getContext('2d');
    this.texCl = new THREE.CanvasTexture(this.cl); this.texCc = new THREE.CanvasTexture(this.cc);
    for (const t of [this.texCl, this.texCc]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }
    this.last = 0; this.version = 0;   // version: bumped on every redraw (IVI focus copies only new frames)
  }
  update(nav, force) {
    const now = performance.now(); if (!force && now - this.last < 100) return; this.last = now;
    drawCluster(this.gl, this.cl.width, this.cl.height); drawCenter(this.gc, this.cc.width, this.cc.height, nav);
    this.texCl.needsUpdate = true; this.texCc.needsUpdate = true; this.version++;
    if (this.mirror) { const [a, b] = this.mirror; a.getContext('2d').drawImage(this.cl, 0, 0, a.width, a.height); b.getContext('2d').drawImage(this.cc, 0, 0, b.width, b.height); }
  }
}
