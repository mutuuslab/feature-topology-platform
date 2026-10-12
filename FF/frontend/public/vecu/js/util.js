// Shared helpers: deterministic random, noise, canvas textures, small math.
import * as THREE from 'three/webgpu';

export const D2R = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const IS_MOBILE = Math.min(innerWidth, innerHeight) < 700 || /Android|iPhone|iPad/i.test(navigator.userAgent);
export const $ = s => document.querySelector(s);

export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const R = rng(20261011);
export function gauss() { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }
export const hash1 = i => { const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y) { let s = 0, a = .5, fq = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * fq, y * fq); fq *= 2.03; a *= .5; } return s; }

/** Colour from sRGB hex (three converts to the linear working space). */
export const col = h => new THREE.Color(h);

let maxAniso = 8;
export function setMaxAnisotropy(n) { maxAniso = n; }
/** Canvas-drawn texture. `srgb` for colour maps; data maps (normals, roughness) stay linear. */
export function canvasTex(w, h, draw, repeat, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxAniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
/** Tileable normal map from a height-field callback h(x,y) in [0,1]. */
export function normalTex(n, hf, k = 2.2) {
  const H = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) H[y * n + x] = hf(x, y);
  return canvasTex(n, n, (g, w, h) => {
    const id = g.createImageData(w, h), d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, L = H[y * w + ((x - 1 + w) % w)], Rr = H[y * w + ((x + 1) % w)], U = H[((y - 1 + h) % h) * w + x], D = H[((y + 1) % h) * w + x];
      let nx = (L - Rr) * k, ny = (U - D) * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      d[i * 4] = (nx * .5 + .5) * 255; d[i * 4 + 1] = (ny * .5 + .5) * 255; d[i * 4 + 2] = (nz * .5 + .5) * 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, true, false);
}

/** Binary assets ship as base64 text (the host serves only web media types). */
export function fetchBin(url) {
  return fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(t => { const b = atob(t.replace(/\s+/g, '')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; });
}

export const std = (c, m, r, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: col(c), metalness: m, roughness: r }, extra || {}));
export const box = (x, y, z, m) => { const me = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), m); me.castShadow = true; return me; };
