// Bakes the static procedural world into a Gaussian point set (surface samples with colours), used to produce a
// synthetic NuRec-format scene for exercising the splat pipeline before real captures are available.
import * as THREE from 'three/webgpu';

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpP = new THREE.Vector3();
const nm = new THREE.Matrix3(); const rc = new THREE.Raycaster(); rc.far = 4;

function imageData(tex) {
  if (!tex || !tex.image) return null; if (tex.userData.__px) return tex.userData.__px;
  const im = tex.image, w = im.width, h = im.height; if (!w || !h) return null;
  let cv = im; if (!(im instanceof HTMLCanvasElement)) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(im, 0, 0); }
  try { const px = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h); return tex.userData.__px = { w, h, d: px.data, flipY: tex.flipY, rx: tex.repeat.x, ry: tex.repeat.y }; } catch (e) { return null; }
}
function sampleTex(px, u, v) {
  u = ((u * px.rx) % 1 + 1) % 1; v = ((v * px.ry) % 1 + 1) % 1; if (px.flipY) v = 1 - v;
  const x = Math.min(px.w - 1, (u * px.w) | 0), y = Math.min(px.h - 1, (v * px.h) | 0), i = (y * px.w + x) * 4;
  return [px.d[i] / 255, px.d[i + 1] / 255, px.d[i + 2] / 255, px.d[i + 3] / 255];
}
const srgb = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);

/**
 * @param scene THREE.Scene
 * @param opts { exclude: Object3D[], box: {x0,x1,z0,z1}, density: n/m² (default 4), maxPerObject, maxTotal, floorY }
 * @returns {pos:Float32Array, nrm:Float32Array, col:Uint8Array, rad:Float32Array, n}
 */
export function bakeScene(scene, opts = {}) {
  const ex = new Set(opts.exclude || []), box = opts.box || { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };
  const density0 = opts.density || 4, maxObj = opts.maxPerObject || 250000, maxTotal = opts.maxTotal || 900000;
  const P = [], N = [], C = [], R = []; let total = 0;
  const skip = o => { for (let q = o; q; q = q.parent) if (ex.has(q) || q.visible === false) return true; return false; };
  scene.updateMatrixWorld(true);
  const meshes = []; scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && !o.isSprite && o.geometry && o.material && !skip(o)) meshes.push(o); });
  for (const m of meshes) {
    const g = m.geometry, pos = g.attributes.position; if (!pos) continue;
    const density = opts.densityFor ? opts.densityFor(m) : density0; if (!density) continue;
    const under = opts.occluders && opts.hideUnder && opts.hideUnder(m) ? opts.occluders : null;
    const mats = Array.isArray(m.material) ? m.material : [m.material]; if (mats.some(x => x.transparent && x.opacity < .5 && !x.alphaTest)) continue;
    const idx = g.index ? g.index.array : null, triN = idx ? idx.length / 3 : pos.count / 3;
    const uv = g.attributes.uv, vc = g.attributes.color, groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.length : pos.count, materialIndex: 0 }];
    const instN = m.isInstancedMesh ? m.count : 1, mInst = new THREE.Matrix4(), mw = new THREE.Matrix4();
    let objCount = 0;
    for (let inst = 0; inst < instN && objCount < maxObj; inst++) {
      if (m.isInstancedMesh) { m.getMatrixAt(inst, mInst); mw.multiplyMatrices(m.matrixWorld, mInst); } else mw.copy(m.matrixWorld);
      nm.getNormalMatrix(mw);
      // quick reject by instance origin
      tmpP.set(0, 0, 0).applyMatrix4(mw); if (m.isInstancedMesh && (tmpP.x < box.x0 - 30 || tmpP.x > box.x1 + 30 || tmpP.z < box.z0 - 30 || tmpP.z > box.z1 + 30)) continue;
      for (const grp of groups) {
        const mat = mats[grp.materialIndex] || mats[0], px = mat.map ? imageData(mat.map) : null, mc = mat.color || new THREE.Color(1, 1, 1);
        const t0 = grp.start / 3, t1 = (grp.start + grp.count) / 3;
        for (let t = t0; t < t1; t++) {
          const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
          tmpA.fromBufferAttribute(pos, a).applyMatrix4(mw); tmpB.fromBufferAttribute(pos, b).applyMatrix4(mw); tmpC.fromBufferAttribute(pos, c).applyMatrix4(mw);
          const cx = (tmpA.x + tmpB.x + tmpC.x) / 3, cz = (tmpA.z + tmpB.z + tmpC.z) / 3; if (cx < box.x0 || cx > box.x1 || cz < box.z0 || cz > box.z1) continue;
          tmpN.subVectors(tmpB, tmpA).cross(tmpP.subVectors(tmpC, tmpA)); const area2 = tmpN.length(); if (area2 < 1e-7) continue; tmpN.divideScalar(area2);
          const area = area2 / 2; let k = area * density; let n = Math.floor(k); if (Math.random() < k - n) n++;
          if (n === 0) continue; const rad = Math.min(2.5, Math.max(.05, .9 / Math.sqrt(density)));
          for (let i = 0; i < n && objCount < maxObj && total < maxTotal; i++) {
            let r1 = Math.random(), r2 = Math.random(); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; } const r0 = 1 - r1 - r2;
            const x = tmpA.x * r0 + tmpB.x * r1 + tmpC.x * r2, y = tmpA.y * r0 + tmpB.y * r1 + tmpC.y * r2, z = tmpA.z * r0 + tmpB.z * r1 + tmpC.z * r2;
            let cr = mc.r, cg = mc.g, cb = mc.b;
            if (vc) { cr *= vc.getX(a) * r0 + vc.getX(b) * r1 + vc.getX(c) * r2; cg *= vc.getY(a) * r0 + vc.getY(b) * r1 + vc.getY(c) * r2; cb *= vc.getZ(a) * r0 + vc.getZ(b) * r1 + vc.getZ(c) * r2; }
            if (px && uv) { const u = uv.getX(a) * r0 + uv.getX(b) * r1 + uv.getX(c) * r2, v = uv.getY(a) * r0 + uv.getY(b) * r1 + uv.getY(c) * r2; const s = sampleTex(px, u, v); if (mat.alphaTest && s[3] < mat.alphaTest) continue; cr *= srgb(s[0]); cg *= srgb(s[1]); cb *= srgb(s[2]); }
            if (mat.emissive && mat.emissiveIntensity) { cr += mat.emissive.r * mat.emissiveIntensity; cg += mat.emissive.g * mat.emissiveIntensity; cb += mat.emissive.b * mat.emissiveIntensity; }
            if (under) { rc.ray.origin.set(x, y + .02, z); rc.ray.direction.set(0, 1, 0); if (rc.intersectObjects(under, false).length) continue; }
            P.push(x, y, z); N.push(tmpN.x, tmpN.y, tmpN.z); C.push(cr, cg, cb); R.push(rad); objCount++; total++;
          }
        }
      }
    }
  }
  return { pos: new Float32Array(P), nrm: new Float32Array(N), col: new Float32Array(C), rad: new Float32Array(R), n: total };
}

/** Pack bake output as base64 (little-endian: n u32, then pos f32x3, nrm f32x3, col f32x3, rad f32) */
export function packBake(b) {
  const n = b.n, buf = new ArrayBuffer(4 + n * (12 + 12 + 12 + 4)); const dv = new DataView(buf); dv.setUint32(0, n, true);
  new Float32Array(buf, 4, n * 3).set(b.pos); new Float32Array(buf, 4 + n * 12, n * 3).set(b.nrm); new Float32Array(buf, 4 + n * 24, n * 3).set(b.col); new Float32Array(buf, 4 + n * 36, n).set(b.rad);
  const u8 = new Uint8Array(buf); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s);
}
