// Gaussian-splat layer for the simulator (three.js WebGPURenderer, WebGL 2 fallback) written in TSL.
// Splat data (centre, 3-D covariance, colour) lives in RGBA32F data textures; a Web Worker keeps a back-to-front
// order for the current view and hands back a Float32 index list that drives an instanced quad per Gaussian.
import * as THREE from 'three/webgpu';
import { Fn, instancedBufferAttribute, cameraProjectionMatrix, modelViewMatrix, modelWorldMatrix, viewportSize, mrt, output, varying, vec2, vec3, vec4, float, int, ivec2, exp, dot, sqrt, max, min, normalize, select, Discard, positionGeometry, mat3, texture, uniform } from 'three/tsl';

const TEXW = 4096;                       // 1024 splats per texel row (4 texels each)

const workerSrc = `
let pos = null, n = 0, lastKey = '';
onmessage = e => {
  const m = e.data;
  if (m.type === 'data') { pos = m.pos; n = m.n; return; }
  if (m.type === 'sort') {
    if (!pos) return;
    const v = m.vp; const key = v.map(x => x.toFixed(2)).join(',');
    if (key === lastKey && !m.force) { postMessage({ type: 'same' }); return; }
    lastKey = key;
    // view depth = row 3 of view-projection (clip w). Bins are logarithmic in depth: captured scenes hold road detail a
    // few metres away and hills kilometres away; linear bins over that range put a whole pole and the ground behind it
    // into one bin (drawn in file order). 65536 log bins over 0.2 m .. 100 km: ~2 mm at 10 m, ~2 cm at 100 m.
    const d = new Float32Array(n); let mx = 1;
    for (let i = 0; i < n; i++) { const w = v[3] * pos[i * 3] + v[7] * pos[i * 3 + 1] + v[11] * pos[i * 3 + 2] + v[15]; d[i] = w; if (w > mx) mx = w; }
    const D0 = .2, L0 = Math.log(D0), B = 65536, cnt = new Uint32Array(B), inv = (B - 1) / Math.max(1e-6, Math.log(Math.min(mx, 1e5)) - L0), q = new Uint32Array(n);
    for (let i = 0; i < n; i++) { const w = d[i]; const k = w <= D0 ? 0 : Math.min(B - 1, ((Math.log(w) - L0) * inv) | 0); q[i] = k; cnt[k]++; }
    // back-to-front: largest depth (farthest, most positive w) first
    const start = new Uint32Array(B); let s = 0; for (let k = B - 1; k >= 0; k--) { start[k] = s; s += cnt[k]; }
    const idx = new Float32Array(n); for (let i = 0; i < n; i++) idx[start[q[i]]++] = i;
    postMessage({ type: 'order', idx, mx }, [idx.buffer]);
  }
};`;

/** Parse an ASPL v2 container (see tools/splatfmt.py) into typed arrays. */
export function parseASPL(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'ASPL') throw new Error('not an ASPL file');
  const ver = dv.getUint32(4, true), n = dv.getUint32(8, true), jl = dv.getUint32(12, true); const meta = JSON.parse(new TextDecoder().decode(u8.subarray(16, 16 + jl)));
  // v3: float32 positions; v2: u16 quantised over the bbox
  let o = 16 + jl; const pf = ver >= 3 ? new Float32Array(buf.slice(o, o + n * 12)) : null, q = ver >= 3 ? null : new Uint16Array(buf.slice(o, o + n * 6)); o += n * (ver >= 3 ? 12 : 6); const ls = u8.subarray(o, o + n * 3); o += n * 3; const v3 = ver >= 3, rq = v3 ? new Int16Array(buf.slice(o, o + n * 8)) : u8.subarray(o, o + n * 4); o += n * (v3 ? 8 : 4); const c = u8.subarray(o, o + n * 4);
  const [mn, mx] = meta.bbox, smin = Math.log(meta.smin), smax = Math.log(meta.smax);
  const pos = new Float32Array(n * 3), scale = new Float32Array(n * 3), rot = new Float32Array(n * 4), col = new Float32Array(n * 4);
  const srgb = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = srgb(i);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = pf ? pf[i * 3 + k] : mn[k] + q[i * 3 + k] / 65535 * (mx[k] - mn[k]); scale[i * 3 + k] = Math.exp(smin + ls[i * 3 + k] / 255 * (smax - smin)); }
    for (let k = 0; k < 4; k++) rot[i * 4 + k] = v3 ? rq[i * 4 + k] / 32767 : (rq[i * 4 + k] - 127.5) / 127.5;
    col[i * 4] = LUT[c[i * 4]]; col[i * 4 + 1] = LUT[c[i * 4 + 1]]; col[i * 4 + 2] = LUT[c[i * 4 + 2]]; col[i * 4 + 3] = c[i * 4 + 3] / 255;
  }
  return { n, meta, pos, scale, rot, col };
}

/** 3-D covariance (upper triangle) from scale + quaternion (w,x,y,z). */
function covariance(scale, rot, n) {
  const A = new Float32Array(n * 3), B = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const sx = scale[i * 3], sy = scale[i * 3 + 1], sz = scale[i * 3 + 2]; let w = rot[i * 4], x = rot[i * 4 + 1], y = rot[i * 4 + 2], z = rot[i * 4 + 3];
    const l = Math.hypot(w, x, y, z) || 1; w /= l; x /= l; y /= l; z /= l;
    // R * S  (columns)
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
    const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
    const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
    const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz, m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz, m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz;
    // Σ = M Mᵀ
    A[i * 3] = m00 * m00 + m01 * m01 + m02 * m02; A[i * 3 + 1] = m00 * m10 + m01 * m11 + m02 * m12; A[i * 3 + 2] = m00 * m20 + m01 * m21 + m02 * m22;
    B[i * 3] = m10 * m10 + m11 * m11 + m12 * m12; B[i * 3 + 1] = m10 * m20 + m11 * m21 + m12 * m22; B[i * 3 + 2] = m20 * m20 + m21 * m21 + m22 * m22;
  }
  return { A, B };
}

/** Pack parsed splats into the RGBA32F layout the shader reads (4 texels per splat: centre+alpha, Σ row 0 + r, Σ row 1 + g, b). */
function packSplats(d, progress) {
  const n = d.n, { A, B } = covariance(d.scale, d.rot, n), TW = 4096;
  const rows = Math.ceil(n / (TW / 4)), tex = new Float32Array(TW * 4 * rows), step = Math.max(1, (n / 20) | 0);
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    tex[o] = d.pos[i * 3]; tex[o + 1] = d.pos[i * 3 + 1]; tex[o + 2] = d.pos[i * 3 + 2]; tex[o + 3] = d.col[i * 4 + 3];
    tex[o + 4] = A[i * 3]; tex[o + 5] = A[i * 3 + 1]; tex[o + 6] = A[i * 3 + 2]; tex[o + 7] = d.col[i * 4];
    tex[o + 8] = B[i * 3]; tex[o + 9] = B[i * 3 + 1]; tex[o + 10] = B[i * 3 + 2]; tex[o + 11] = d.col[i * 4 + 1];
    tex[o + 12] = d.col[i * 4 + 2];
    if (progress && i % step === 0) progress(i / n);
  }
  return { n, meta: d.meta, tex, rows, pos: d.pos };
}
// Decoding a few million splats takes seconds: done off the main thread so the page keeps drawing (and can show progress).
const decodeSrc = `${parseASPL}
${covariance}
${packSplats}
onmessage = e => { try { const p = packSplats(parseASPL(e.data), f => postMessage({ type: 'progress', f })); postMessage({ type: 'done', p }, [p.tex.buffer, p.pos.buffer]); }
  catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); } };`;

export class SplatLayer {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'splat'; this.mesh = null; this.n = 0; this.worker = null; this.sorting = false; this.pending = false; this.ready = false;
    this.exposure = uniform(1.0); this.opacity = uniform(1.0); this.lowpass = uniform(.3); this.tint = uniform(new THREE.Color(1, 1, 1)); this.lastVP = new Float32Array(16); this.frameSkip = 0; this.meta = null;
    // unjittered view-projection of this and the previous frame (world space) -> per-splat motion vectors for TRAA
    this.curVP = uniform(new THREE.Matrix4()); this.prevVP = uniform(new THREE.Matrix4()); this._vpInit = false;
    this.prevM = uniform(new THREE.Matrix4()); this._curM = new THREE.Matrix4();   // previous model matrix: moving actors (traffic)
  }
  /** onProgress(stage, fraction, info): stage 'download' (info = {loaded, total} bytes) then 'decode'. */
  async load(url, onProgress) {
    const res = await fetch(url); if (!res.ok) throw new Error('splat fetch ' + res.status);
    const total = +res.headers.get('content-length') || 0; let buf;
    if (res.body && total && onProgress) {
      const out = new Uint8Array(total), rd = res.body.getReader(); let loaded = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; out.set(value, loaded); loaded += value.length; onProgress('download', loaded / total, { loaded, total }); }
      buf = out.buffer;
    } else buf = await res.arrayBuffer();
    return this.loadBuffer(buf, onProgress);
  }
  /** Decode an ASPL ArrayBuffer in a worker (the buffer is transferred). */
  loadBuffer(buf, onProgress) {
    return new Promise((resolve, reject) => {
      const w = new Worker(URL.createObjectURL(new Blob([decodeSrc], { type: 'text/javascript' })));
      w.onmessage = e => { const m = e.data;
        if (m.type === 'progress') { onProgress && onProgress('decode', m.f); return; }
        w.terminate(); if (m.type === 'error') { reject(new Error(m.message)); return; }
        onProgress && onProgress('decode', 1); resolve(this.setPacked(m.p)); };
      w.onerror = e => { w.terminate(); reject(new Error(e.message || 'decode worker failed')); };
      w.postMessage(buf, [buf]);
    });
  }
  setData(d) { return this.setPacked(packSplats(d)); }
  setPacked({ n, meta, tex, rows, pos }) {
    this.dispose(); this.n = n; this.meta = meta; const d = { pos };
    const dt = new THREE.DataTexture(tex, TEXW, rows, THREE.RGBAFormat, THREE.FloatType); dt.magFilter = dt.minFilter = THREE.NearestFilter; dt.generateMipmaps = false; dt.needsUpdate = true; this.tex = dt;
    // instanced quad
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const idx = new Float32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    this.idxAttr = new THREE.InstancedBufferAttribute(idx, 1); this.idxAttr.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iIdx', this.idxAttr); g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); g.boundingBox = null;
    this.matPost = this.material(dt, true); this.matPlain = this.material(dt, false); const mat = this.matPlain; const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = -5; mesh.name = 'splatMesh';
    this.mesh = mesh; this.group.add(mesh);
    // sort worker
    const blob = new Blob([workerSrc], { type: 'text/javascript' }); this.worker = new Worker(URL.createObjectURL(blob));
    this.worker.onmessage = e => { const m = e.data; this.sorting = false; if (m.type === 'order') { this.idxAttr.array.set(m.idx); this.idxAttr.needsUpdate = true; this.ready = true; } if (this.pending) { this.pending = false; this.requestSort(this.lastVP, true); } };
    this.worker.postMessage({ type: 'data', pos: d.pos, n });
    this.lastVP.fill(0); this.requestSort(this.lastVP, true);
    return this;
  }
  material(dt, withVelocity) {
    const m = new THREE.MeshBasicNodeMaterial(); m.transparent = true; m.depthWrite = false; m.depthTest = true; m.toneMapped = false; m.side = THREE.DoubleSide; m.fog = false;
    m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.lights = false;
    const vCol = varying(vec4(0), 'vSplatCol'), vUV = varying(vec2(0), 'vSplatUV'), vVel = varying(vec2(0), 'vSplatVel');
    const iIdx = instancedBufferAttribute(this.idxAttr, 'float');
    const tex = texture(dt);
    const expo = this.exposure, opa = this.opacity, lp = this.lowpass, tint = this.tint, curVP = this.curVP, prevVP = this.prevVP, prevM = this.prevM;
    m.vertexNode = Fn(() => {
      const id = int(iIdx.add(.5)); const px = id.mod(int(TEXW / 4)).mul(4), py = id.div(int(TEXW / 4));
      const t0 = tex.load(ivec2(px, py)), t1 = tex.load(ivec2(px.add(1), py)), t2 = tex.load(ivec2(px.add(2), py)), t3 = tex.load(ivec2(px.add(3), py));
      const centre = t0.xyz, alpha = t0.w, colour = vec3(t1.w, t2.w, t3.x);
      const cam = modelViewMatrix.mul(vec4(centre, 1.0)); const clip = cameraProjectionMatrix.mul(cam);
      const tz = cam.z, tx = cam.x, ty = cam.y, invz = float(1.0).div(tz);
      const fx = cameraProjectionMatrix.element(0).element(0).mul(viewportSize.x).mul(.5), fy = cameraProjectionMatrix.element(1).element(1).mul(viewportSize.y).mul(.5);
      const j0 = vec3(fx.mul(invz), 0.0, fx.mul(tx).mul(invz).mul(invz).negate()), j1 = vec3(0.0, fy.mul(invz), fy.mul(ty).mul(invz).mul(invz).negate());
      const c0 = modelViewMatrix.element(0).xyz, c1 = modelViewMatrix.element(1).xyz, c2 = modelViewMatrix.element(2).xyz;
      const W = mat3(c0, c1, c2), Wt = mat3(vec3(c0.x, c1.x, c2.x), vec3(c0.y, c1.y, c2.y), vec3(c0.z, c1.z, c2.z));
      const S = mat3(vec3(t1.x, t1.y, t1.z), vec3(t1.y, t2.x, t2.y), vec3(t1.z, t2.y, t2.z));
      const M = W.mul(S).mul(Wt);
      const a0 = dot(j0, M.mul(j0)), b = dot(j0, M.mul(j1)), d0 = dot(j1, M.mul(j1));
      const a = a0.add(lp), d = d0.add(lp);
      // the 0.3 px² low-pass keeps sub-pixel splats from aliasing; scale opacity by the area it adds so very thin
      // splats (1 mm road discs, poles, barrier faces) are not inflated into opaque smears (Mip-Splatting compensation)
      const comp = sqrt(max(a0.mul(d0).sub(b.mul(b)), 0.0).div(a.mul(d).sub(b.mul(b))));
      const mid = a.add(d).mul(.5), det = a.mul(d).sub(b.mul(b)), r = sqrt(max(.1, mid.mul(mid).sub(det)));
      const l1 = mid.add(r), l2 = max(mid.sub(r), .1);
      const dir = select(b.abs().lessThan(1e-5), select(a.greaterThan(d), vec2(1, 0), vec2(0, 1)), normalize(vec2(b, l1.sub(a))));
      const major = dir.mul(min(sqrt(l1.mul(2.0)), 1024.0)), minor = vec2(dir.y, dir.x.negate()).mul(min(sqrt(l2.mul(2.0)), 1024.0));
      const ndc = clip.xy.div(clip.w);
      const off = positionGeometry.x.mul(major).add(positionGeometry.y.mul(minor)).mul(2.0).div(viewportSize);
      vCol.assign(vec4(colour.mul(tint).mul(expo), alpha.mul(comp).mul(opa))); vUV.assign(positionGeometry.xy);
      const wc = modelWorldMatrix.mul(vec4(centre, 1.0)), cc = curVP.mul(wc), pc = prevVP.mul(prevM.mul(vec4(centre, 1.0)));
      vVel.assign(select(cc.w.greaterThan(.01).and(pc.w.greaterThan(.01)), cc.xy.div(cc.w).sub(pc.xy.div(pc.w)), vec2(0.0)));
      const visible = tz.lessThan(-.15).and(ndc.x.abs().lessThan(1.4)).and(ndc.y.abs().lessThan(1.4)).and(alpha.greaterThan(.004));
      return select(visible, vec4(ndc.add(off).mul(clip.w), clip.z, clip.w), vec4(0.0, 0.0, 2.0, 1.0));
    })();
    // colour/opacity through the regular material output (not fragmentNode) so the scene pass MRT (normal, velocity, ...)
    // stays complete; premultiplied colour + One/OneMinusSrcAlpha blending. Velocity is the splat centre's NDC motion,
    // weighted by coverage like the colour, so TRAA reprojects the captured background instead of using the sky's motion.
    const B = Fn(() => { const A = dot(vUV, vUV).negate(); Discard(A.lessThan(-4.0)); return exp(A).mul(vCol.w); })();
    m.colorNode = vec4(vCol.xyz.mul(B), B);
    // only for renders through the post pipeline: outside an MRT pass a material mrtNode replaces the output targets
    if (withVelocity) m.mrtNode = mrt({ output, velocity: vec4(vVel.mul(B), 0.0, B) });
    return m;
  }
  /** true while rendering through the MRT post pipeline (velocity for TRAA), false for direct renders. */
  usePost(on) { if (this.mesh) this.mesh.material = on ? this.matPost : this.matPlain; }
  /** Call once per frame with the camera used for the main view. */
  update(camera) {
    if (!this.mesh) return;
    camera.updateMatrixWorld(); this.group.updateMatrixWorld();
    const vp = this._vp || (this._vp = new THREE.Matrix4()); vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevVP.value.copy(this._vpInit ? this.curVP.value : vp); this.curVP.value.copy(vp);
    this.prevM.value.copy(this._vpInit ? this._curM : this.mesh.matrixWorld); this._curM.copy(this.mesh.matrixWorld); this._vpInit = true;
    vp.multiply(this.mesh.matrixWorld);   // sort in splat-local space (the layer may be nudged for alignment)
    const e = vp.elements; let moved = false; for (let i = 0; i < 16; i++) if (Math.abs(e[i] - this.lastVP[i]) > 1e-4) { moved = true; break; }
    if (moved) { this.lastVP.set(e); this.requestSort(this.lastVP, false); }
  }
  requestSort(vp, force) {
    if (!this.worker) return; if (this.sorting) { this.pending = true; return; }
    this.sorting = true; this.worker.postMessage({ type: 'sort', vp: Array.from(vp), force });
  }
  dispose() { if (this.worker) { this.worker.terminate(); this.worker = null; } if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); this.matPost.dispose(); this.matPlain.dispose(); this.mesh = null; } if (this.tex) { this.tex.dispose(); this.tex = null; } this.ready = false; }
}
