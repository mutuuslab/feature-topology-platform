// World: road meshes from OpenDRIVE, barriers, terrain, vegetation, signs, sky, clouds, rain, atmosphere.
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { D2R, clamp, lerp, sstep, IS_MOBILE, R, rng, hash1, vnoise, fbm, col, canvasTex, normalTex, fetchBin, std } from './util.js';
import { RD1, RD2, roads, refAt, lanesOf, lanesAt, W3 } from './odr.js';

export const STATIC = [];          // static radar targets (x,y,z triples)
export const crownMeshes = [];     // alpha-tested foliage (kept out of screen-space passes)
export const world = { splat3dExp: 1.6, roadMeshes: [], scene: null, sky: null, sun: null, hemi: null, csm: null, clouds: null, rain: null, terrainMat: null, crownMats: [], roadDry: [], sunDir: new THREE.Vector3(), hdr: {}, hdrState: {} };

/* ---------------- geometry strip builder ---------------- */
class GB {
  constructor() { this.p = []; this.u = []; this.i = []; }
  strip(rows) { const b = this.p.length / 3; for (const r of rows) { this.p.push(r[0], r[1], r[2], r[3], r[4], r[5]); this.u.push(r[6], r[7], r[8], r[9]); }
    for (let k = 0; k < rows.length - 1; k++) { const a = b + k * 2; this.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  geo(flat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i);
    if (flat) { const n = new Float32Array(this.p.length); for (let k = 1; k < n.length; k += 3) n[k] = 1; g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); } else g.computeVertexNormals();
    g.computeBoundingSphere(); return g; }
}

/* ---------------- textures ---------------- */
const AS = IS_MOBILE ? 256 : 512;
const aggH = new Float32Array(AS * AS);
{ const r2 = rng(7); for (let i = 0; i < AS * AS; i++) { const x = i % AS, y = (i / AS) | 0; aggH[i] = .55 * r2() + .45 * vnoise(x * .35, y * .35) + .25 * (vnoise(x * .05, y * .05) - .5); } }
function asphalt(tracks) {
  return canvasTex(AS, AS, (g, w, h) => {
    const id = g.createImageData(w, h), d = id.data;
    for (let i = 0; i < w * h; i++) { const a = aggH[i]; const x = i % w; let v = 62 + a * 44 + (a > .93 ? 30 : 0);
      if (tracks) { const u = x / w; const tr = Math.exp(-Math.pow((u - .27) / .09, 2)) + Math.exp(-Math.pow((u - .73) / .09, 2)); v += tr * 9; v -= Math.exp(-Math.pow((u - .5) / .12, 2)) * 8; }
      d[i * 4] = v; d[i * 4 + 1] = v + 1; d[i * 4 + 2] = v + 3; d[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
    g.strokeStyle = 'rgba(22,22,24,.38)'; g.lineWidth = 1.2; const r3 = rng(11);
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = r3() * w, y = r3() * h; g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r3() - .5) * w * .12; y += r3() * h * .07; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 3; i++) { const x = r3() * w, y = r3() * h; g.fillStyle = 'rgba(30,30,32,.18)'; g.beginPath(); g.ellipse(x, y, w * .06, h * .03, r3() * 3, 0, 6.3); g.fill(); }
  }, true);
}
const texNormal = normalTex(AS, (x, y) => aggH[y * AS + x], 2.2);
const texRough = canvasTex(AS, AS, (g, w, h) => { const id = g.createImageData(w, h), d = id.data; for (let i = 0; i < w * h; i++) { const v = 200 + aggH[i] * 50; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); }, true, false);
const texLane = asphalt(true), texPlain = asphalt(false);
const texCloud = canvasTex(IS_MOBILE ? 256 : 512, IS_MOBILE ? 256 : 512, (g, w, h) => { const id = g.createImageData(w, h), d = id.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const n = fbm(x / w * 6 + 3, y / h * 6 + 9) + .3 * fbm(x / w * 20, y / h * 20);
    const a = sstep((n - .62) / .3) * .9; const ed = Math.min(x, y, w - 1 - x, h - 1 - y) / (w * .08); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a * 255 * clamp(ed, 0, 1); }
  g.putImageData(id, 0, 0); }, true);
const texGrass = canvasTex(256, 256, (g, w, h) => { const id = g.createImageData(w, h), d = id.data; const r4 = rng(3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const blade = r4() * 70; const patch = (vnoise(x * .06, y * .06) - .5) * 60; const v = 185 + blade + patch; d[i] = v * .97; d[i + 1] = v; d[i + 2] = v * .9; d[i + 3] = 255; }
  g.putImageData(id, 0, 0); }, true, false);
const texGrassN = normalTex(256, (x, y) => .5 + .5 * (vnoise(x * .25, y * .25) - .5) + .3 * (hash1(x * 7.1 + y * 13.3) - .5), 1.6);

/* ---------------- build ---------------- */
export function buildWorld(scene) {
  world.scene = scene; const n0 = scene.children.length;
  // --- roads ---
  const gbLane = new GB(), gbPlain = new GB(), gbMedian = new GB(), gbMark = new GB();
  const markStrip = (rd, s0, s1, tFn, w, y) => { const rows = []; const n = Math.max(1, Math.ceil((s1 - s0) / 1));
    for (let k = 0; k <= n; k++) { const s = lerp(s0, s1, k / n), t = tFn(s); const A = W3(rd, s, t + w / 2, y), B = W3(rd, s, t - w / 2, y); rows.push([...A, ...B, 0, 0, 1, 0]); } gbMark.strip(rows); };
  const addMarks = (rd, s0, s1, tFn, mk, y) => { if (!mk || mk.type === 'none') return; if (mk.type === 'solid') { markStrip(rd, s0, s1, tFn, mk.width, y); return; }
    const dash = mk.width >= .25 ? 3 : 6, gap = mk.width >= .25 ? 3 : 12, per = dash + gap; for (let a = Math.ceil(s0 / per) * per; a < s1; a += per) markStrip(rd, a, Math.min(a + dash, s1), tFn, mk.width, y); };
  for (const id of [1, 2]) {
    const rd = roads[id], yb = id === 2 ? .015 : 0;
    rd.sections.forEach((sec, si) => {
      const s0 = sec.s, s1 = si + 1 < rd.sections.length ? rd.sections[si + 1].s : rd.length, n = Math.ceil(s1 - s0);
      for (const l of [...sec.right, ...sec.left]) {
        const rows = []; let maxW = 0;
        for (let k = 0; k <= n; k++) { const s = lerp(s0, s1, k / n), e = lanesOf(sec, s - s0)[l.id]; maxW = Math.max(maxW, Math.abs(e.outer - e.inner));
          const A = W3(rd, s, e.inner, yb), B = W3(rd, s, e.outer, yb); rows.push(l.id > 0 ? [...B, ...A, 1, s / 6, 0, s / 6] : [...A, ...B, 0, s / 6, 1, s / 6]); }
        if (maxW < .05) continue;
        (l.type === 'driving' || l.type === 'exit' ? gbLane : l.type === 'median' ? gbMedian : gbPlain).strip(rows);
        addMarks(rd, s0, s1, s => lanesOf(sec, s - s0)[l.id].outer, l.mark, yb + .012);
      }
      if (sec.center && sec.center.mark) addMarks(rd, s0, s1, () => 0, sec.center.mark, yb + .014);
    });
  }
  const NS = new THREE.Vector2(IS_MOBILE ? .35 : .6, IS_MOBILE ? .35 : .6);
  const roadMats = {
    lane: std('#ffffff', 0, 1, { map: texLane, normalMap: texNormal, normalScale: NS, roughnessMap: texRough, side: THREE.DoubleSide, envMapIntensity: .35 }),
    plain: std('#d9d6cf', 0, 1, { map: texPlain, normalMap: texNormal, normalScale: NS, roughnessMap: texRough, side: THREE.DoubleSide, envMapIntensity: .3 }),
    median: std('#bdbab2', 0, 1, { map: texPlain, normalMap: texNormal, normalScale: NS, roughnessMap: texRough, side: THREE.DoubleSide, envMapIntensity: .3 }),
    mark: std('#e9e7df', 0, .55, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: .4 })
  };
  world.roadDry = [roadMats.lane, roadMats.plain, roadMats.median, roadMats.mark].map(m => [m, m.color.clone(), m.roughness, m.envMapIntensity]);
  for (const [gb, m] of [[gbLane, roadMats.lane], [gbPlain, roadMats.plain], [gbMedian, roadMats.median], [gbMark, roadMats.mark]]) { const me = new THREE.Mesh(gb.geo(true), m); me.receiveShadow = true; scene.add(me); world.roadMeshes.push(me); }

  // --- guardrails, delineators, noise barrier, median barrier ---
  const gbRail = new GB(), gbBarrier = new GB(); const posts = [], delin = [];
  const rail = (rd, s0, s1, tFn, out) => {
    const prof = [[.00, .50], [.07, .57], [.01, .64], [.01, .70], [.07, .77], [.00, .84]]; const n = Math.ceil((s1 - s0) / 2);
    for (let i = 0; i < prof.length - 1; i++) { const rows = [];
      for (let k = 0; k <= n; k++) { const s = lerp(s0, s1, k / n), t = tFn(s); const A = W3(rd, s, t - out * prof[i][0], prof[i][1]), B = W3(rd, s, t - out * prof[i + 1][0], prof[i + 1][1]); rows.push([...A, ...B, 0, s / 3, 1, s / 3]); }
      gbRail.strip(rows); }
    for (let s = s0; s <= s1; s += 4) posts.push(W3(rd, s, tFn(s) + out * .12, 0));
    for (let s = s0 + 25; s <= s1; s += 50) { const r = refAt(rd, s); delin.push({ p: W3(rd, s, tFn(s) + out * .55, 0), h: r.h }); }
    for (let s = s0; s <= s1; s += 2.5) { const p = W3(rd, s, tFn(s), .7); STATIC.push(p[0], p[1], p[2]); }
  };
  const right1 = s => lanesAt(RD1, s).rightEdge - .35, left1 = s => lanesAt(RD1, s).leftEdge + .35;
  rail(RD1, 4, 300, right1, -1); rail(RD1, 560, 1196, right1, -1); rail(RD1, 4, 1196, left1, 1); rail(RD2, 14, 386, s => lanesAt(RD2, s).rightEdge - .35, -1);
  { // noise barrier
    const nbT = s => lanesAt(RD1, s).rightEdge - 1.55, s0 = 660, s1 = 1196; const gbP = new GB(), gbC = new GB(); const n = Math.ceil((s1 - s0) / 2); const pr = [], cr = [];
    for (let k = 0; k <= n; k++) { const s = lerp(s0, s1, k / n), t = nbT(s); pr.push([...W3(RD1, s, t, .62), ...W3(RD1, s, t, 4.1), s / 4, 0, s / 4, 1]); cr.push([...W3(RD1, s, t, 0), ...W3(RD1, s, t, .62), 0, s / 4, 1, s / 4]); }
    gbP.strip(pr); gbC.strip(cr);
    const panelTex = canvasTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(150,190,160,.50)'); gr.addColorStop(1, 'rgba(110,150,120,.62)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(52,84,62,1)'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 12, w, 12); g.fillRect(0, h * .52, w, 6); g.fillRect(0, 0, 7, h); g.fillRect(w - 7, 0, 7, h);
      g.fillStyle = 'rgba(255,255,255,.10)'; for (let i = 0; i < 6; i++) g.fillRect(30 + i * 36, 14, 3, h * .5); }, true);
    const pm = new THREE.Mesh(gbP.geo(false), new THREE.MeshStandardMaterial({ map: panelTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: .15, metalness: .1, envMapIntensity: 1.2 })); pm.renderOrder = 2; scene.add(pm);
    const cm = new THREE.Mesh(gbC.geo(false), std('#9c9a92', 0, .92, { side: THREE.DoubleSide })); cm.castShadow = true; cm.receiveShadow = true; scene.add(cm);
    const np = []; for (let s = s0; s <= s1; s += 4) np.push(W3(RD1, s, nbT(s), 0));
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, 4.15, .16), std('#3e4a44', .5, .5), np.length); const o = new THREE.Object3D();
    np.forEach((q, i) => { o.position.set(q[0], 2.07, q[2]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.castShadow = true; im.frustumCulled = false; scene.add(im);
    for (let s = s0; s <= s1; s += 2.5) { const q = W3(RD1, s, nbT(s), 1.1 + hash1(s) * 1.8); STATIC.push(q[0], q[1], q[2]); }
  }
  { // median concrete barrier
    const prof = [[-.3, 0], [-.24, .12], [-.09, .55], [-.08, .9], [.08, .9], [.09, .55], [.24, .12], [.3, 0]];
    for (let i = 0; i < prof.length - 1; i++) { const rows = []; for (let s = 0; s <= 1200; s += 2) { const A = W3(RD1, s, prof[i][0], prof[i][1]), B = W3(RD1, s, prof[i + 1][0], prof[i + 1][1]); rows.push([...A, ...B, 0, s / 4, 1, s / 4]); } gbBarrier.strip(rows); }
    for (let s = 2; s < 1200; s += 2.5) for (const t of [-.26, .26]) { const p = W3(RD1, s, t, .5); STATIC.push(p[0], p[1], p[2]); }
  }
  { const m = new THREE.Mesh(gbRail.geo(false), std('#b9bec3', .8, .38, { side: THREE.DoubleSide, envMapIntensity: .9 })); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  { const post = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, 1.0, .08), std('#f2f2ee', 0, .5), delin.length), band = new THREE.InstancedMesh(new THREE.BoxGeometry(.125, .22, .085), std('#1a1a1c', 0, .6), delin.length);
    const o = new THREE.Object3D(); delin.forEach((d, i) => { o.position.set(d.p[0], .5, d.p[2]); o.rotation.set(0, d.h, 0); o.updateMatrix(); post.setMatrixAt(i, o.matrix); o.position.y = .78; o.updateMatrix(); band.setMatrixAt(i, o.matrix); });
    post.castShadow = true; post.frustumCulled = false; band.frustumCulled = false; scene.add(post, band); }
  { const m = new THREE.Mesh(gbBarrier.geo(false), std('#a9a8a2', 0, .9, { side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  { const im = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, .82, .08), std('#6d7277', .6, .5), posts.length); const o = new THREE.Object3D();
    posts.forEach((p, i) => { o.position.set(p[0], .41, p[2]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.castShadow = true; im.frustumCulled = false; scene.add(im); }

  // --- terrain ---
  const roadPts = [];
  for (let s = 0; s <= RD1.length; s += 6) { const p = W3(RD1, s, 0); roadPts.push(p[0], p[2], 17.6); }
  for (let s = 0; s <= RD2.length; s += 5) { const p = W3(RD2, s, -3); roadPts.push(p[0], p[2], 4.8); }
  const roadDist = (x, z) => { let m = 1e9; for (let i = 0; i < roadPts.length; i += 3) { const dx = x - roadPts[i], dz = z - roadPts[i + 1]; const d = Math.sqrt(dx * dx + dz * dz) - roadPts[i + 2]; if (d < m) m = d; } return m; };
  const terrainH = (x, z, d) => { const m = sstep((d - 7) / 90); const n = fbm(x * .0032 + 11, z * .0032 - 7); return -.09 + m * (4 + n * n * 62) + sstep((d - 350) / 500) * 45; };
  {
    const TW = 2800, TD = 2000, SX = IS_MOBILE ? 150 : 210, SZ = IS_MOBILE ? 110 : 150;
    const g = new THREE.PlaneGeometry(TW, TD, SX, SZ); g.rotateX(-Math.PI / 2); g.translate(575, 0, 40);
    const pos = g.attributes.position, cols = new Float32Array(pos.count * 3);
    const sand = col('#a3987c'), gA = col('#56682c'), gB = col('#7e8238'), gH = col('#465a2a'), gV = col('#8a8a45'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), d = roadDist(x, z), h = terrainH(x, z, d); pos.setY(i, h);
      c.copy(gA).lerp(gB, fbm(x * .02, z * .02)); c.lerp(gH, clamp(h / 50, 0, .7)); c.multiplyScalar(.92 + .16 * vnoise(x * .11, z * .11));
      c.lerp(gV, sstep(1 - (d - 3) / 9) * .6); c.lerp(sand, 1 - sstep((d - 2.2) / 5));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
    texGrass.repeat.set(TW / 7, TD / 7); texGrassN.repeat.set(TW / 7, TD / 7);
    world.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: texGrass, normalMap: texGrassN, normalScale: new THREE.Vector2(.5, .5), roughness: .95, metalness: 0 });
    const m = new THREE.Mesh(g, world.terrainMat); m.receiveShadow = true; scene.add(m);
  }

  // --- vegetation (textured cards, normals bent outward) ---
  {
    const leafTex = canvasTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); const r = rng(21);
      for (let i = 0; i < 1400; i++) { const a = r() * 6.283, rad = Math.pow(r(), .6) * w * .47, x = w / 2 + Math.cos(a) * rad, y = h / 2 + Math.sin(a) * rad * .9;
        const v = (150 + r() * 90) * (1 - .35 * rad / (w * .47)) * (y < h * .45 ? 1.08 : .92); g.fillStyle = `rgb(${v * .86 | 0},${v | 0},${v * .72 | 0})`;
        g.beginPath(); g.ellipse(x, y, 3 + r() * 6, 2 + r() * 3.2, r() * 3.14, 0, 6.283); g.fill(); } });
    const firTex = canvasTex(128, 256, (g, w, h) => { g.clearRect(0, 0, w, h); const r = rng(5); g.fillStyle = 'rgb(92,70,52)'; g.fillRect(w / 2 - 3, h * .55, 6, h * .45);
      for (let i = 0; i < 1700; i++) { const t = Math.pow(r(), .85), y = h * .02 + t * h * .86, half = (t * .46 + .04) * w * (.75 + .25 * Math.sin(t * 38));
        const x = w / 2 + (r() * 2 - 1) * half, v = (120 + r() * 90) * (.75 + .35 * (1 - t)); g.strokeStyle = `rgb(${v * .78 | 0},${v | 0},${v * .7 | 0})`; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x < w / 2 ? -1 : 1) * (3 + r() * 5), y + 2 + r() * 5); g.stroke(); } });
    const cards = (list, ctr) => {
      const P = [], N = [], U = [], I = []; const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (const c of list) {
        e.set(c.tx || 0, c.ry, 0, 'YXZ'); q.setFromEuler(e); const b = P.length / 3;
        for (const [cx, cy, u, vv] of [[-.5, -.5, 0, 0], [.5, -.5, 1, 0], [.5, .5, 1, 1], [-.5, .5, 0, 1]]) {
          v.set(cx * c.w, cy * c.h, 0).applyQuaternion(q).add(new THREE.Vector3(c.x, c.y, c.z)); P.push(v.x, v.y, v.z);
          const n = v.clone().sub(ctr); if (c.axial) n.y *= .25; n.normalize(); n.y += .35; n.normalize(); N.push(n.x, n.y, n.z); U.push(u, vv); }
        I.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g;
    };
    const rr = rng(77), C1 = new THREE.Vector3(0, 5.9, 0), C2 = new THREE.Vector3(0, .8, 0), C3 = new THREE.Vector3(0, 5, 0);
    const leafCards = []; for (let i = 0; i < 16; i++) { const a = rr() * 6.283, rad = Math.sqrt(rr()) * 1.9; leafCards.push({ x: Math.cos(a) * rad, y: 5.9 + (rr() * 2 - 1) * 1.9, z: Math.sin(a) * rad, w: 2.7 + rr() * 1.1, h: 2.5 + rr() * 1.0, ry: rr() * 3.14, tx: (rr() * 2 - 1) * .7 }); }
    leafCards.push({ x: 0, y: 5.9, z: 0, w: 5.4, h: 4.9, ry: 0 }, { x: 0, y: 5.9, z: 0, w: 5.4, h: 4.9, ry: Math.PI / 2 });
    const leafy = cards(leafCards, C1), conifer = cards([0, 1, 2].map(i => ({ x: 0, y: 5.6, z: 0, w: 5.2, h: 11, ry: i * Math.PI / 3, axial: true })), C3);
    const bushCards = []; for (let i = 0; i < 7; i++) { const a = rr() * 6.283; bushCards.push({ x: Math.cos(a) * .5, y: .75 + rr() * .4, z: Math.sin(a) * .5, w: 1.5 + rr() * .6, h: 1.3 + rr() * .5, ry: rr() * 3.14, tx: (rr() * 2 - 1) * .5 }); }
    const bush = cards(bushCards, C2), trunk = new THREE.CylinderGeometry(.14, .28, 4.6, 7).translate(0, 2.3, 0);
    const nC = IS_MOBILE ? 520 : 900, nL = IS_MOBILE ? 900 : 1700, nB = IS_MOBILE ? 320 : 560;
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: leafTex, alphaTest: .5, side: THREE.DoubleSide, roughness: .85, metalness: 0 });
    const firMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: firTex, alphaTest: .5, side: THREE.DoubleSide, roughness: .85, metalness: 0 });
    world.crownMats = [crownMat, firMat];
    const mk = (geo, n, mat, cast) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = false; if (mat.alphaTest) crownMeshes.push(m); scene.add(m); return m; };
    const iC = mk(conifer, nC, firMat, true), iL = mk(leafy, nL, crownMat, true), iB = mk(bush, nB, crownMat, false), iT = mk(trunk, nC + nL, std('#4a3a2c', 0, .9), true);
    const o = new THREE.Object3D(), c = new THREE.Color(); let ti = 0;
    const place = (im, n, dmin, dmax, palette, sMin, sMax, withTrunk) => {
      let k = 0, guard = 0;
      while (k < n && guard++ < n * 60) {
        let x, z; const mode = R();
        if (mode < .6) { const i = Math.floor(R() * roadPts.length / 3) * 3, ang = R() * 6.283, rr2 = roadPts[i + 2] + dmin + R() * 48; x = roadPts[i] + Math.cos(ang) * rr2; z = roadPts[i + 1] + Math.sin(ang) * rr2; }
        else if (mode < .88) { x = lerp(-150, 1300, R()); z = lerp(-480, 520, R()); } else { x = lerp(-800, 1950, R()); z = lerp(-940, 1020, R()); }
        const d = roadDist(x, z); if (d < dmin || d > dmax) continue;
        const y = terrainH(x, z, d) - .25, sc = lerp(sMin, sMax, R());
        o.position.set(x, y, z); o.rotation.set(0, R() * 6.28, 0); o.scale.set(sc, sc * lerp(.85, 1.2, R()), sc); o.updateMatrix();
        im.setMatrixAt(k, o.matrix); c.copy(palette[Math.floor(R() * palette.length)]).multiplyScalar(lerp(.8, 1.1, R())); im.setColorAt(k, c);
        if (withTrunk) iT.setMatrixAt(ti++, o.matrix); k++;
      }
      im.count = k;
    };
    place(iC, nC, 15, 900, [col('#43643c'), col('#4d6e43'), col('#3b5a3a')], .9, 1.7, false);
    place(iL, nL, 14, 700, [col('#5f7c37'), col('#6c8b40'), col('#56722f'), col('#7a9147')], 1.0, 1.85, true);
    place(iB, nB, 3, 14, [col('#54712f'), col('#618235'), col('#48652b')], .6, 1.4, false);
    iT.count = ti; for (const m of [iC, iL, iB]) m.instanceColor.needsUpdate = true;
  }

  // --- signs ---
  const signTex = kind => canvasTex(kind === 'exit' ? 640 : 512, kind === 'exit' ? 200 : kind === 'brown' ? 366 : 300, (g, w, h) => {
    g.fillStyle = kind === 'brown' ? '#6b3824' : '#1f4f9d'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 9; g.strokeRect(12, 12, w - 24, h - 24); g.fillStyle = '#fff'; g.textBaseline = 'middle';
    if (kind === 'exit') { g.font = 'bold 104px "Helvetica Neue",Arial,sans-serif'; g.fillText('Ausfahrt', 38, h / 2 + 4);
      g.beginPath(); g.moveTo(w - 150, h / 2 - 34); g.lineTo(w - 80, h / 2 - 34); g.lineTo(w - 80, h / 2 - 62); g.lineTo(w - 34, h / 2); g.lineTo(w - 80, h / 2 + 62); g.lineTo(w - 80, h / 2 + 34); g.lineTo(w - 150, h / 2 + 34); g.closePath(); g.fill(); }
    else if (kind === 'brown') { g.beginPath(); g.moveTo(40, 250); g.quadraticCurveTo(130, 150, 230, 190); g.quadraticCurveTo(330, 90, 470, 120); g.lineTo(470, 250); g.closePath(); g.fill();
      g.fillStyle = '#6b3824'; g.beginPath(); g.moveTo(40, 250); g.bezierCurveTo(160, 210, 240, 250, 320, 205); g.bezierCurveTo(380, 175, 430, 190, 470, 170); g.lineTo(470, 200); g.bezierCurveTo(420, 215, 380, 205, 330, 232); g.bezierCurveTo(250, 272, 160, 240, 40, 268); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.fillRect(352, 56, 16, 58); g.fillRect(380, 40, 22, 74); g.fillRect(412, 62, 14, 52); g.fillRect(346, 104, 86, 14); g.font = 'bold 54px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'center'; g.fillText('Rheinland', w / 2, h - 46); }
    else { g.strokeStyle = '#fff'; g.lineWidth = 7; g.strokeRect(36, 40, 112, 96); g.font = 'bold 76px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'center'; g.fillText('12', 92, 92);
      g.textAlign = 'left'; g.font = 'bold 58px "Helvetica Neue",Arial,sans-serif'; g.fillText('Testfeld', 176, 74); g.fillText('Nord', 176, 138); g.font = 'bold 64px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'right'; g.fillText('500 m', w - 40, 226); }
  });
  const addSign = (rd, s, t, w, h, kind, poleH) => {
    const r = refAt(rd, s), p = W3(rd, s, t, 0), grp = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std('#ffffff', 0, .45, { map: signTex(kind) })); face.position.y = poleH + h / 2; face.castShadow = true; grp.add(face);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std('#8e9398', .4, .6)); back.rotation.y = Math.PI; back.position.set(0, poleH + h / 2, -.03); grp.add(back);
    for (const sx of [-w * .32, w * .32]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, poleH + h, 8), std('#9aa0a6', .6, .4)); pole.position.set(sx, (poleH + h) / 2, -.08); pole.castShadow = true; grp.add(pole); }
    grp.position.set(p[0], p[1], p[2]); grp.rotation.y = r.h - Math.PI / 2; scene.add(grp);
  };
  addSign(RD1, 150, -17.2, 3.4, 2.0, 'adv', 1.6); addSign(RD2, 95, 3.0, 3.2, 1.0, 'exit', 1.7); addSign(RD1, 960, -18.4, 2.7, 1.93, 'brown', 3.0);

  world.statics = scene.children.slice(n0).filter(o => !world.roadMeshes.includes(o));   // hidden under a splat backdrop

  // --- sky, clouds, rain, lights ---
  const sky = new SkyMesh(); sky.scale.setScalar(4500); sky.turbidity.value = 3.2; sky.rayleigh.value = 1.3; sky.mieCoefficient.value = .004; sky.mieDirectionalG.value = .86; scene.add(sky); world.sky = sky;
  world.cloudMat = new THREE.MeshBasicMaterial({ map: texCloud, transparent: true, depthWrite: false, fog: false, opacity: .9 });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), world.cloudMat); clouds.rotation.x = Math.PI / 2; clouds.position.y = 650; clouds.renderOrder = -0.5; clouds.frustumCulled = false; scene.add(clouds); world.clouds = clouds; world.texCloud = texCloud;
  const RAIN_N = IS_MOBILE ? 1400 : 3200, RB = [80, 26, 80], rainPos = new Float32Array(RAIN_N * 6), rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = (R() - .5) * RB[0]; rainSeed[i * 3 + 1] = R() * RB[1]; rainSeed[i * 3 + 2] = (R() - .5) * RB[2]; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xd4dbe2, transparent: true, opacity: .42, depthWrite: false })); rain.frustumCulled = false; rain.visible = false; scene.add(rain); world.rain = rain;
  world.updateRain = (dt, vx, vz) => {
    const fall = 17, wrapv = (v, L) => ((v + L / 2) % L + L) % L - L / 2;
    for (let i = 0; i < RAIN_N; i++) { const k = i * 3;
      rainSeed[k] = wrapv(rainSeed[k] - vx * dt, RB[0]); rainSeed[k + 2] = wrapv(rainSeed[k + 2] - vz * dt, RB[2]); rainSeed[k + 1] -= fall * dt; if (rainSeed[k + 1] < 0) rainSeed[k + 1] += RB[1];
      const x = rainSeed[k], y = rainSeed[k + 1], z = rainSeed[k + 2], o = i * 6; rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z; rainPos[o + 3] = x + vx * .03; rainPos[o + 4] = y + fall * .03 + .25; rainPos[o + 5] = z + vz * .03; }
    rainGeo.attributes.position.needsUpdate = true;
  };
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true; const SM = IS_MOBILE ? 2048 : 4096; sun.shadow.mapSize.set(SM, SM);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 900 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = .04;
  scene.add(sun); scene.add(sun.target); world.sun = sun;
  world.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, .6); scene.add(world.hemi);
  scene.fog = new THREE.Fog(0xc3d6e6, 300, 1500);
  return world;
}

/**
 * Backdrop: 'proc' = procedural world; 'splat' = captured Gaussian-splat scene. Under a splat the procedural scenery is
 * hidden and the drivable road surfaces stay as invisible proxies that only catch the vehicles' shadows (and give GTAO /
 * TRAA a ground depth); lane markings are dropped so the shadow is not doubled.
 */
let catcher = null;
export function setBackdrop(mode) {
  const sp = mode === 'splat'; world.backdrop = sp ? 'splat' : 'proc';
  if (sp && !catcher) { catcher = new THREE.ShadowNodeMaterial({ opacity: .55, side: THREE.DoubleSide }); catcher.depthWrite = true; }
  for (const o of world.statics) o.visible = !sp;
  world.roadMeshes.forEach((m, i) => { if (!m.userData.mat) m.userData.mat = m.material; m.material = sp ? catcher : m.userData.mat; m.renderOrder = sp ? 1 : 0; m.visible = !(sp && i === 3); });
}

/** Cascaded shadow maps (ultra/high). Falls back to the plain shadow camera on failure. */
export function enableCSM(camera, on) {
  const sun = world.sun;
  if (on && !world.csm) { try { world.csm = new CSMShadowNode(sun, { cascades: 3, maxFar: 260, mode: 'practical' }); sun.shadow.shadowNode = world.csm; } catch (e) { console.warn('CSM unavailable', e); world.csm = null; } }
  if (!on && world.csm) { sun.shadow.shadowNode = null; world.csm.dispose(); world.csm = null; }
}

/* ---------------- atmosphere presets ---------------- */
export const PRESETS = {
  day: { el: 38, az: 318, sunCol: '#fff3df', sunI: 3.1, hs: '#cfe0f0', hg: '#56653e', hi: .2, exp: .65, fogN: 280, fogF: 1500, lamp: .35, cloud: '#ffffff', cloudA: .9, head: 0, veg: 1.35, road: 1.15, roadWarm: .2, terr: .5, terrWarm: .1, turb: 3.2, ray: 1.3, mie: .004, envI: 1 },
  dusk: { el: 4.5, az: 38, sunCol: '#ffbf8a', sunI: 2.8, hs: '#e7b896', hg: '#3a3540', hi: .95, exp: .5, fogN: 260, fogF: 1500, lamp: 1.8, cloud: '#f6b48c', cloudA: .8, head: 7, veg: 1.2, road: .7, roadWarm: .25, terr: 1, terrWarm: .3, turb: 6, ray: 2.6, mie: .012, envI: 1 }
};
export const WEATHER = {
  clear: { sun: 1, hemi: 1, wet: 0, rain: 0, glow: 1, cloud: 1, exp: 1, envI: 1 },
  rain: { day: { hor: '#8f959a', hs: '#a3a7aa', hg: '#3d3f3a' }, dusk: { hor: '#7f6f6a' }, sun: .22, hemi: 2.2, fogN: 10, fogF: 460, wet: 1, rain: 1, glow: .15, cloud: 0, exp: 1.36, envI: .35, turb: 20 },
  fog: { day: { hor: '#a9aeb3', hs: '#b4b8bb', hg: '#4a4c47' }, dusk: { hor: '#a08e86' }, sun: .3, hemi: 1.25, fogN: 0, fogF: 220, wet: .35, rain: 0, glow: .25, cloud: 0, exp: .88, envI: .4, turb: 30 }
};
// HDRI image-based lighting; sun azimuth of each file (equirect, from the brightest texel) used to rotate the map onto the scene sun
const HDRI = { day: { url: 'assets/quarry_01_1k.hdr.b64.txt', az: 35.9 }, dusk: { url: 'assets/venice_sunset_1k.hdr.b64.txt', az: 35.9 } };
export function loadHDRI(renderer, key, onDone) {
  const st = world.hdrState; if (st[key]) return; st[key] = 'loading';
  fetchBin(HDRI[key].url).then(buf => {
    const d = new HDRLoader().parse(buf);
    const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type); tex.colorSpace = THREE.LinearSRGBColorSpace; tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = true; tex.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose();
    world.hdr[key] = env; st[key] = 'ok'; onDone && onDone();
  }).catch(e => { console.warn('HDRI', key, e); st[key] = 'fallback'; onDone && onDone(); });
}

export const atmo = { time: 'day', weather: 'clear', fogHex: '#c5d8e8' };
/** Apply time/weather look. `veh` is the vehicle list (lamp brightness), `ego` for headlights. */
export function atmos(renderer, tk, wk, ctx) {
  const p = PRESETS[tk], W = WEATHER[wk], ov = W[tk] || {}, s = world;
  const el = p.el * D2R, az = p.az * D2R; s.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az)).normalize();
  s.sky.sunPosition.value.copy(s.sunDir); s.sky.turbidity.value = W.turb || p.turb; s.sky.rayleigh.value = p.ray; s.sky.mieCoefficient.value = p.mie * W.glow; s.sky.mieDirectionalG.value = .86;
  s.sun.color.set(p.sunCol); s.sun.intensity = p.sunI * W.sun * 2.4;
  s.hemi.color.set(ov.hs || p.hs); s.hemi.groundColor.set(ov.hg || p.hg); s.hemi.intensity = p.hi * W.hemi * 1.2;
  // under a splat the tone mapping is Neutral (photo colours pass unchanged) instead of AgX, whose toe lifts shadows: the lit
  // 3D parts (cars, cabin) need more exposure to sit at the same brightness (the splat exposure compensates, see main.js)
  renderer.toneMappingExposure = p.exp * (W.exp || 1) * 1.05 * (s.backdrop === 'splat' ? s.splat3dExp : 1);
  const hor = ov.hor || (tk === 'day' ? '#c5d8e8' : '#eab386'); atmo.fogHex = hor; s.scene.fog.color.set(hor); s.scene.fog.near = W.fogN != null ? W.fogN : p.fogN; s.scene.fog.far = W.fogF != null ? W.fogF : p.fogF;
  const env = s.hdr[tk]; s.scene.environment = env || null; s.scene.environmentIntensity = p.envI * W.envI * .9;
  if (env) { const phiS = -az, phiH = HDRI[tk].az * D2R; s.scene.environmentRotation.set(0, phiS - phiH, 0); }
  const rk = p.road * (1 - .55 * W.wet);
  s.roadDry.forEach(([m, c, r, e]) => { m.color.setRGB(c.r * rk * (1 + p.roadWarm), c.g * rk, c.b * rk * (1 - p.roadWarm)); m.roughness = lerp(r, .42, W.wet); m.envMapIntensity = lerp(e, .5, W.wet); });
  if (s.terrainMat) s.terrainMat.color.setRGB(p.terr * (1 + p.terrWarm), p.terr, p.terr * (1 - p.terrWarm));
  for (const cm of s.crownMats) cm.color.setRGB(p.veg * (1 + p.terrWarm * .4), p.veg, p.veg * (1 - p.terrWarm * .6));
  s.rain.visible = !!W.rain; s.cloudMat.color.set(p.cloud); s.cloudMat.opacity = W.cloud ? p.cloudA : 0;
  const lamp = p.lamp + (wk === 'clear' ? 0 : .9);
  if (ctx) { ctx.lamp = lamp; ctx.head = p.head + (W.rain ? 3 : 0); }
  return { lamp };
}
