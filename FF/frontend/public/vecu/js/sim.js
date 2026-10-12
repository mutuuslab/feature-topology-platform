// Simulation: traffic on OpenDRIVE lane coordinates, ACC car-following, cut-in scenario,
// phenomenological radar (ideal / coarse), vECU WebSocket bridge.
import * as THREE from 'three/webgpu';
import { D2R, clamp, lerp, R, gauss, hash1, col } from './util.js';
import { roads, RD1, RD2, refAt, laneIdAt, tLane, LW, SCENE } from './odr.js';
import { STATIC } from './world.js';
import { buildSedan, buildSUV, buildVan, buildTruck, buildMoto, contactShadow } from './vehicles.js';
import { ivi, iviApply } from './ivi.js';

// loop range on road 1 (a captured scene's road is only ~0.7 km); the exit-ramp manoeuvre exists only on the authored road
export const S0 = 30, S1 = SCENE ? Math.floor(RD1.length - 60) : 1150, L1 = S1 - S0, EXIT_S = 480;
// outermost through lane: the authored road has three (-2..-4); captured motorways here have two, so the cut-in and
// slow traffic use the inner lane instead of driving on the shoulder
export const OUTER = SCENE ? -2 : -4;
export const wrapS = s => S0 + (((s - S0) % L1) + L1) % L1;
export const veh = []; window.__veh = veh;
export const sim = { scene: null, ego: null, simT: 0, paused: false, snapCam: true, scn: { enabled: true, gap: 18, dur: 3.0, vT: 24, state: 'idle' }, radar: 'ideal', detsA: [], detsB: [], lamp: .35, head: 0 };
const gtMat = new THREE.LineBasicMaterial({ color: 0xf0b445 });

export function addVeh(scene, kind, o) {
  const b = kind === 'sedan' ? buildSedan(o) : kind === 'suv' ? buildSUV(o) : kind === 'van' ? buildVan(o) : kind === 'truck' ? buildTruck(o) : buildMoto(o);
  const dims = { sedan: [o.L, o.W, o.H], suv: [o.L, o.W, o.H], van: [5.0, 1.95, 2.0], truck: [16.5, 2.55, 4.1], moto: [2.1, .8, 1.7] }[kind];
  const v = Object.assign({ kind, road: 1, dir: 1, a: 0, lc: null, tRate: 0, tg: 1.6, seed: R(), vis: true, L: dims[0], W: dims[1], H: dims[2], rcs: { sedan: 10, suv: 12, van: 14, truck: 21, moto: 1 }[kind] }, b, o);
  const body = b.grp, grp = new THREE.Group(); grp.add(body); v.body = body; v.grp = grp;
  const gt = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(v.L, v.H, v.W)), gtMat); gt.position.y = v.H / 2; gt.visible = false; grp.add(gt); v.gt = gt;
  grp.add(contactShadow(v.L, v.W)); v.lamps.forEach(m => m.userData.base = .35);
  scene.add(grp); veh.push(v); return v;
}
export function spawnTraffic(scene) {
  const T = {};
  T.cut = addVeh(scene, 'sedan', { L: 4.45, W: 1.82, H: 1.45, wb: 2.7, color: '#1d3b8f', s: 150, t: tLane(OUTER), v: 26, vSet: 26 });
  T.van = addVeh(scene, 'van', { color: '#e3c11c', s: 110, t: tLane(OUTER), v: 24, vSet: 24, exitPlan: !SCENE, exiting: !SCENE });
  T.moto = addVeh(scene, 'moto', { color: '#8a1d1d', s: 88, t: tLane(-2), v: 34, vSet: 34 });
  T.silver = addVeh(scene, 'sedan', { L: 4.75, W: 1.85, H: 1.42, wb: 2.85, color: '#b9bdc2', s: 195, t: tLane(-2), v: 35, vSet: 35 });
  T.white = addVeh(scene, 'suv', { L: 4.6, W: 1.86, H: 1.66, wb: 2.75, color: '#eceeed', s: 300, t: tLane(-3), v: 31.5, vSet: 31.5 });
  T.truck = addVeh(scene, 'truck', { color: '#c8ccd1', s: 370, t: tLane(OUTER), v: 23, vSet: 23 });
  T.grey = addVeh(scene, 'sedan', { L: 4.5, W: 1.8, H: 1.44, wb: 2.7, color: '#4b5058', s: 0, t: tLane(-3), v: 30.5, vSet: 31 });
  T.green = addVeh(scene, 'suv', { L: 4.85, W: 1.9, H: 1.72, wb: 2.88, color: '#29452f', s: -90, t: tLane(-2), v: 36, vSet: 36.5 });
  // oncoming carriageway: on the authored road it is next to the median; a captured road has its own (not modelled)
  if (!SCENE) [['#c2c5c9', 3, 40, 31, 'sedan'], ['#202226', 2, 180, 35, 'suv'], ['#7d1414', 4, 320, 27, 'sedan'], ['#e7e7e3', 3, 520, 30, 'suv'], ['#2b4f86', 2, 700, 34, 'sedan'], ['#5a5f66', 4, 900, 26, 'sedan'], ['#d7c7a1', 3, 1080, 29, 'suv']]
    .forEach(([c, l, s, v, k]) => addVeh(scene, k, { L: k === 'suv' ? 4.7 : 4.7, W: 1.86, H: k === 'suv' ? 1.68 : 1.45, wb: 2.8, color: c, s, t: tLane(l), v, vSet: v, dir: -1 }));
  for (const v of veh) if (v !== sim.ego) v.s = wrapS(v.s);
  sim.T = T; return T;
}
export function resetCut() { const { cut } = sim.T, ego = sim.ego; cut.s = wrapS(ego.s + 110); cut.t = tLane(OUTER); cut.v = 26; cut.vSet = 26; cut.lc = null; sim.scn.state = 'idle'; }

/* ---------------- dynamics ---------------- */
const dsAhead = (a, b) => { const d = (b.s - a.s) * a.dir; return ((d % L1) + L1) % L1; };
const relS = s => ((((s - sim.ego.s + L1 / 2) % L1) + L1) % L1) - L1 / 2;
function findLead(v) {
  let best = null, bd = 1e9;
  for (const o of veh) { if (o === v || o.road !== 1 || o.dir !== v.dir) continue; if (Math.abs(o.t - v.t) > 1.9) continue; const d = dsAhead(v, o); if (d > 0 && d < 170 && d < bd) { bd = d; best = o; } }
  return best ? { o: best, gap: bd - (best.L + v.L) / 2, v: best.v } : null;
}
function accFor(v, ld) { let a = clamp(.5 * (v.vSet - v.v), -2, 1.4); if (ld) { const des = 4 + v.v * v.tg; a = Math.min(a, .18 * (ld.gap - des) + .75 * (ld.v - v.v)); if (ld.gap < 2.5) a = -9; } return clamp(a, -9, 1.6); }
function respawnVan() { const { van } = sim.T, ego = sim.ego; van.road = 1; van.s = wrapS(ego.s + 80); van.t = tLane(OUTER); van.v = 24; van.vSet = 24; van.lc = null; van.exiting = van.s < 315; }
export function step(dt) {
  const ego = sim.ego, { cut } = sim.T, scn = sim.scn;
  for (const v of veh) v.ld = v.road === 1 ? findLead(v) : null;
  for (const v of veh) {
    v.a = v.road === 1 ? accFor(v, v.ld) : clamp(.5 * (v.vSet - v.v), -3, 1.2); if (v === ego && vecuDrives()) v.a = clamp(vecu.accelReq, -10, 4);
    // a feature under virtual validation drives the ego's longitudinal control (js/ffval.js); null = not driving
    if (v === ego && sim.longCtl) { const a = sim.longCtl(dt, ego); if (a != null) v.a = a; }
    v.v = Math.max(0, v.v + v.a * dt);
  }
  for (const v of veh) {
    const pt = v.t; v.s += v.v * dt * (v.road === 1 ? v.dir : 1);
    if (v.lc) { v.lc.p += dt / v.lc.dur; const p = Math.min(1, v.lc.p); v.t = v.lc.t0 + (v.lc.t1 - v.lc.t0) * (.5 - .5 * Math.cos(Math.PI * p)); if (v.lc.p >= 1) v.lc = null; }
    v.tRate = (v.t - pt) / dt;
    if (v.exitPlan && v.road === 1 && v.exiting) { if (!v.lc && v.s >= 330 && v.s < 470 && v.t > -12) v.lc = { t0: v.t, t1: -14.625, p: 0, dur: 3.2 }; if (v.s >= 480 && v.s < 540 && v.t < -14) { v.road = 2; v.s -= 480; v.t = -1.875; v.vSet = 18; } }
    if (v.road === 2 && v.s > RD2.length - 12) respawnVan();
    if (v.road === 1) { if (v.dir > 0 && v.s > S1) { v.s -= L1; if (v === ego) { sim.snapCam = true; ego.t = tLane(-3); resetCut(); } else if (v.exitPlan) v.exiting = true; } else if (v.dir < 0 && v.s < S0) v.s += L1; }
  }
  if (scn.enabled && scn.state === 'idle' && Math.abs(cut.t - tLane(OUTER)) < .3) { const g = dsAhead(ego, cut) - (ego.L + cut.L) / 2; if (g < scn.gap && g > scn.gap - 12) { cut.lc = { t0: cut.t, t1: tLane(-3), p: 0, dur: scn.dur }; cut.vSet = scn.vT; scn.state = 'lc'; } }
  if (scn.state === 'lc' && !cut.lc) scn.state = 'done';
}
export function place(dt, egoModel, egoYawFlip) {
  const ego = sim.ego;
  for (const v of veh) {
    const rd = roads[v.road]; const sR = v === ego ? ego.s : v.road === 1 ? ego.s + relS(v.s) : v.s;
    if (sR < .5 || sR > rd.length - .5) { v.grp.visible = false; v.vis = false; continue; }
    v.grp.visible = true; v.vis = true;
    const r = refAt(rd, sR), x = r.x - Math.sin(r.h) * v.t, y = r.y + Math.cos(r.h) * v.t;
    const yaw = v.dir > 0 ? Math.atan2(v.tRate || 0, Math.max(v.v, 2)) : 0;
    v.hw = r.h + (v.dir < 0 ? Math.PI : 0) + yaw; v.wx = x; v.wz = -y;
    v.grp.position.set(x, r.z + (v.road === 2 ? .015 : 0), -y); v.grp.rotation.y = v.hw;
    const spin = v.v * dt / v.wr;
    if (v === ego && egoModel) { const sg = egoYawFlip ? -1 : 1; egoModel.wheels.forEach((w, i) => w.rotateOnAxis(egoModel.wheelAxes[i], sg * v.v * dt / .36)); }
    else for (const w of v.wheels) w.rotation.z -= spin * (w.rotation.y ? -1 : 1);
    v.body.rotation.z = lerp(v.body.rotation.z, clamp(v.a * .007, -.05, .03), .15); v.body.rotation.x = lerp(v.body.rotation.x, clamp(-(v.tRate || 0) * .035, -.045, .045), .15);
    const braking = v.a < -1.2, base = v.lamps[0].userData.base;
    v.tail.emissiveIntensity = braking ? Math.max(3.2, base * 2) : base; v.lamps[1].emissiveIntensity = base * .6;
    if (v === ego && ego.gltfHeads) ego.gltfHeads.forEach(h => { h.emissiveIntensity = base * .9; });
  }
}

/* ---------------- radar ---------------- */
export const P_IDEAL = { sR: .03, sAz: .15 * D2R, spacing: .55, pd: 1, staticPd: .5, rcsN: .6, clutter: 0, qR: 0, qAz: 0 };
export const P_COARSE = { sR: .42, sAz: 1.4 * D2R, spacing: 1.25, pd: .62, staticPd: .2, rcsN: 3.5, clutter: 7, qR: .5, qAz: 1.5 * D2R };
const inFov = (r, az) => (r < 70 && Math.abs(az) < 50 * D2R) || (r < 180 && Math.abs(az) < 9 * D2R);
export function scan(P, out) {
  const ego = sim.ego; out.length = 0;
  const h = ego.hw, fx = Math.cos(h), fz = -Math.sin(h), lx = -Math.sin(h), lz = -Math.cos(h);
  const sx = ego.wx + fx * (ego.L / 2 + .05), sz = ego.wz + fz * (ego.L / 2 + .05), evx = fx * ego.v, evz = fz * ego.v; const tg = [];
  for (const v of veh) {
    if (v === ego || !v.vis) continue; const dx = v.wx - sx, dz = v.wz - sz; if (dx * dx + dz * dz > 210 * 210) continue;
    const vf = [Math.cos(v.hw), -Math.sin(v.hw)], vl = [-Math.sin(v.hw), -Math.cos(v.hw)]; let azMin = 1e9, azMax = -1e9, rMin = 1e9;
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const cx = v.wx + vf[0] * a * v.L / 2 + vl[0] * b * v.W / 2 - sx, cz = v.wz + vf[1] * a * v.L / 2 + vl[1] * b * v.W / 2 - sz;
      const F = cx * fx + cz * fz, Lt = cx * lx + cz * lz, az = Math.atan2(Lt, F); azMin = Math.min(azMin, az); azMax = Math.max(azMax, az); rMin = Math.min(rMin, Math.hypot(F, Lt)); }
    tg.push({ v, vf, vl, azMin, azMax, rMin });
  }
  const occl = (r, az, self) => { for (const t of tg) { if (t === self) continue; if (t.rMin < r - .8 && az > t.azMin && az < t.azMax) return true; } return false; };
  const push = (px, py, pz, vr, rcs, self) => {
    const dx = px - sx, dz = pz - sz, F = dx * fx + dz * fz, Lt = dx * lx + dz * lz; let r = Math.hypot(F, Lt), az = Math.atan2(Lt, F);
    if (!inFov(r, az) || occl(r, az, self)) return;
    r += gauss() * P.sR; az += gauss() * P.sAz; if (P.qR) r = Math.round(r / P.qR) * P.qR; if (P.qAz) az = Math.round(az / P.qAz) * P.qAz;
    const nf = r * Math.cos(az), nl = r * Math.sin(az); out.push({ x: sx + fx * nf + lx * nl, y: py, z: sz + fz * nf + lz * nl, vr, rcs: rcs + gauss() * P.rcsN });
  };
  for (const t of tg) {
    const v = t.v, vtx = t.vf[0] * v.v, vtz = t.vf[1] * v.v;
    for (const [n, off, len] of [[t.vf, v.L / 2, v.W], [[-t.vf[0], -t.vf[1]], v.L / 2, v.W], [t.vl, v.W / 2, v.L], [[-t.vl[0], -t.vl[1]], v.W / 2, v.L]]) {
      const cx = v.wx + n[0] * off, cz = v.wz + n[1] * off; if (n[0] * (sx - cx) + n[1] * (sz - cz) <= 0) continue;
      const tx = -n[1], tz = n[0], cnt = Math.max(1, Math.round(len / P.spacing));
      for (let i = 0; i < cnt; i++) { if (Math.random() > P.pd) continue;
        const u = ((i + .5) / cnt - .5) * len, px = cx + tx * u, pz = cz + tz * u, py = .3 + .55 * ((i * .618 + v.seed) % 1) * Math.min(1, v.H / 1.4);
        const dx = px - sx, dz = pz - sz, rr = Math.hypot(dx, dz) || 1, vr = ((vtx - evx) * dx + (vtz - evz) * dz) / rr * 3.6;
        push(px, py, pz, vr, v.rcs - 4 * Math.log10(cnt) + 3 * Math.cos(i * 1.7 + v.seed * 6), t); }
    }
  }
  for (let i = 0; i < STATIC.length; i += 3) { const px = STATIC[i], pz = STATIC[i + 2], dx = px - sx, dz = pz - sz, d2 = dx * dx + dz * dz; if (d2 > 95 * 95 || d2 < 4) continue;
    if ((P === P_IDEAL ? hash1(i) : Math.random()) > P.staticPd) continue; const rr = Math.sqrt(d2); push(px, STATIC[i + 1], pz, (-evx * dx - evz * dz) / rr * 3.6, -6, null); }
  for (let c = 0; c < P.clutter; c++) { const r = 8 + Math.random() * 60, az = (Math.random() - .5) * 80 * D2R, nf = r * Math.cos(az), nl = r * Math.sin(az); out.push({ x: sx + fx * nf + lx * nl, y: .2 + Math.random() * .8, z: sz + fz * nf + lz * nl, vr: (Math.random() - .5) * 40, rcs: -12 + Math.random() * 6 }); }
}
const DET_MAX = 700, detGeo = new THREE.SphereGeometry(1, 12, 8), detMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .45, metalness: 0, emissive: 0x111111 });
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
export function detMesh(scene, layer) { const m = new THREE.InstancedMesh(detGeo, detMat, DET_MAX); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; for (let i = 0; i < DET_MAX; i++) m.setColorAt(i, tmpC.setRGB(1, 1, 1)); m.count = 0; m.layers.set(layer); scene.add(m); return m; }
function velColor(vr, c) { if (vr >= 0) { const t = Math.min(vr / 150, 1); c.setHSL(lerp(.36, .61, t), .85, .5); } else { const t = Math.min(-vr / 220, 1); c.setHSL(lerp(.36, .0, t), .9, .5); } return c; }
export function fill(m, d) { const n = Math.min(d.length, DET_MAX); for (let i = 0; i < n; i++) { const q = d[i]; dummy.position.set(q.x, q.y, q.z); dummy.scale.setScalar(clamp(.07 + .017 * (q.rcs + 12), .06, .75)); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, velColor(q.vr, tmpC)); } m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }

/* ---------------- vECU bridge ---------------- */
export const vecu = { ws: null, state: 'off', ctl: false, accelReq: 0, lastRx: 0, rx: 0, tx: 0, seq: 0, lastTxT: -1, hwPrev: null, yawRate: 0, lastFrame: null, egoEntry: null, onShot: null, statusEl: null };
export const vecuDrives = () => vecu.ctl && vecu.state === 'open' && performance.now() - vecu.lastRx < 500;
export function vecuFrame() {
  const ego = sim.ego, e = vecu.egoEntry || {}; const h = ego.hw, fx = Math.cos(h), fz = -Math.sin(h), lx = -Math.sin(h), lz = -Math.cos(h);
  const r = refAt(RD1, ego.s), dExit = ((EXIT_S - ego.s) % L1 + L1) % L1; const objs = [];
  for (const v of veh) { if (v === ego || !v.vis) continue; const dx = v.wx - ego.wx, dz = v.wz - ego.wz; if (dx * dx + dz * dz > 200 * 200) continue;
    const vx = Math.cos(v.hw) * v.v - Math.cos(h) * ego.v, vz = -Math.sin(v.hw) * v.v + Math.sin(h) * ego.v;
    objs.push({ id: veh.indexOf(v), cls: v.kind === 'moto' ? 'motorcycle' : v.kind === 'truck' ? 'truck' : v.kind === 'van' ? 'van' : 'car', x: +(dx * fx + dz * fz).toFixed(2), y: +(dx * lx + dz * lz).toFixed(2), vx: +(vx * fx + vz * fz).toFixed(2), vy: +(vx * lx + vz * lz).toFixed(2), yaw: +(((v.hw - h + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI).toFixed(3), L: v.L, W: v.W, H: v.H }); }
  const dets = (sim.radar === 'coarse' ? sim.detsB : sim.detsA).slice(0, 128).map(d => { const dx = d.x - ego.wx, dz = d.z - ego.wz, F = dx * fx + dz * fz - ego.L / 2, Lt = dx * lx + dz * lz; return [+Math.hypot(F, Lt).toFixed(2), +Math.atan2(Lt, F).toFixed(4), +(d.vr / 3.6).toFixed(2), +d.rcs.toFixed(1)]; });
  const ld = ego.ld;
  return { type: 'frame', seq: vecu.seq++, t: +sim.simT.toFixed(3),
    vehicle: { model: e.id, name: e.name, platform: e.os, L: +ego.L.toFixed(3), W: +ego.W.toFixed(3), H: +ego.H.toFixed(3), WB: e.dims ? e.dims[3] / 1000 : null },
    ego: { v: +ego.v.toFixed(3), a: +ego.a.toFixed(3), yawRate: +vecu.yawRate.toFixed(4), heading: +h.toFixed(4), x: +r.x.toFixed(2), y: +r.y.toFixed(2), brakeLamp: ego.a < -1.2 },
    nav: { roadId: 1, laneId: laneIdAt(RD1, ego.s, ego.t), s: +ego.s.toFixed(2), tOffset: +ego.t.toFixed(3), speedLimitKph: 130, nextManeuver: 'Ausfahrt 12 Testfeld Nord', distToManeuver: +dExit.toFixed(1) },
    env: { time: ivi.live.time, weather: vecu.weather || 'clear' },
    acc: { setSpeedKph: +(ego.vSet * 3.6).toFixed(1), timeGap: ego.tg, leadGap: ld ? +ld.gap.toFixed(2) : null, leadSpeed: ld ? +ld.v.toFixed(2) : null, ttc: ld && ego.v - ld.v > .3 ? +(ld.gap / (ego.v - ld.v)).toFixed(2) : null, controlledBy: vecuDrives() ? 'vECU' : 'internal' },
    ivi: { platform: ivi.platform, screen: ivi.screen, popup: ivi.popup ? { title: ivi.popup.title, level: ivi.popup.level } : null, adas: ivi.adas, climate: ivi.climate },
    body: ivi.body,
    objects: objs,
    radar: { sensor: { x: +(ego.L / 2).toFixed(3), y: 0, z: .5, fovNearDeg: 100, fovFarDeg: 18, rangeNear: 70, rangeFar: 180 }, params: sim.radar === 'coarse' ? 'coarse' : 'ideal', detections: dets, fields: ['range_m', 'azimuth_rad', 'radialVel_mps', 'rcs_dBsm'] } };
}
export function vecuStatus(t, msg) { vecu.state = t; const m = { off: '연결 안 됨', connecting: '연결 중…', open: '연결됨', blocked: '연결할 수 없음' };
  if (vecu.statusEl) vecu.statusEl.textContent = msg || `${m[t] || t} · 송신 ${vecu.tx} · 수신 ${vecu.rx}` + (vecuDrives() ? ' · vECU 제어 중' : ''); if (vecu.connBtn) vecu.connBtn.textContent = t === 'open' || t === 'connecting' ? '끊기' : '연결'; }
export function vecuConnect(url) {
  if (vecu.ws) { try { vecu.ws.close(); } catch (e) { } vecu.ws = null; vecuStatus('off'); return; }
  vecuStatus('connecting'); let ws; try { ws = new WebSocket(url); } catch (e) { vecuStatus('blocked', '연결할 수 없음: 이 페이지 환경이 외부 WebSocket을 막고 있습니다. 로컬 패키지로 실행하세요.'); return; }
  vecu.ws = ws; const ego = sim.ego;
  ws.onopen = () => { vecuStatus('open'); ws.send(JSON.stringify({ type: 'hello', sim: 'Ausfahrt Test Drive', rateHz: 50, schema: 2 })); };
  ws.onmessage = ev => { vecu.rx++; vecu.lastRx = performance.now(); let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.cmd === 'control' && typeof m.accelReq === 'number') vecu.accelReq = m.accelReq;
    else if (m.cmd === 'laneChange' && !ego.lc) { const nl = clamp(laneIdAt(RD1, ego.s, ego.t) + (m.dir > 0 ? 1 : -1), OUTER === -2 ? -3 : -4, -2); ego.lc = { t0: ego.t, t1: tLane(nl), p: 0, dur: m.duration || 4 }; ivi.live.turn = m.dir > 0 ? -1 : 1; setTimeout(() => { ivi.live.turn = 0; }, (m.duration || 4) * 1000); }
    else if (m.cmd === 'setSpeed' && typeof m.v === 'number') { ego.vSet = clamp(m.v, 0, 200) / 3.6; ivi.adas.setKph = Math.round(m.v); }
    else if (m.cmd === 'scenario' && vecu.onShot) vecu.onShot(m.name);
    else if (m.cmd === 'ivi' && m.set) iviApply(m.set);
    else if (m.cmd === 'body' && m.set) iviApply({ body: m.set }); };
  ws.onerror = () => { if (vecu.state === 'connecting') vecuStatus('blocked', `연결할 수 없음 (${url}). 브리지가 실행 중인지, 이 페이지가 로컬에서 열렸는지 확인하세요.`); };
  ws.onclose = () => { vecu.ws = null; if (vecu.state !== 'blocked') vecuStatus('off'); };
}
export function vecuTick() {
  const ego = sim.ego; if (vecu.hwPrev != null) { let d = ego.hw - vecu.hwPrev; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; vecu.yawRate = lerp(vecu.yawRate, d / (1 / 60), .2); } vecu.hwPrev = ego.hw;
  if (sim.simT - vecu.lastTxT >= .02 || vecu.lastTxT > sim.simT) { vecu.lastTxT = sim.simT; if (vecu.state === 'open' && vecu.ws && vecu.ws.readyState === 1) { vecu.lastFrame = vecuFrame(); vecu.ws.send(JSON.stringify(vecu.lastFrame)); vecu.tx++; } }
}
