// IVI focus: the cluster and centre display shown so they can be read and used, independent of the cabin's realism.
//  - 'sharp': in the cabin cameras both screens are DOM canvases mapped exactly onto the 3D screen quads (CSS matrix3d
//    homography) — native pixels, no TRAA/tone mapping/sharpening/texture filtering; the centre display takes taps.
//  - 'bench': both screens alone at full size over a dimmed scene (like a bench rig), in any camera.
// The 3D screens stay in the scene underneath; this layer only draws over them.

/** 3×3 helpers for the rectangle → quad homography (row-major). */
const adj = m => [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
const mulMM = (a, b) => { const c = Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; c[3 * i + j] = s; } return c; };
const mulMV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const basis = p => { const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1], v = mulMV(adj(m), [p[3][0], p[3][1], 1]); return mulMM(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); };

/** CSS matrix3d mapping the element rectangle (0,0)–(w,h) onto the quad q = [tl, tr, br, bl] (px), transform-origin 0 0. */
export function quadMatrix(w, h, q) {
  const t = mulMM(basis([q[0], q[1], q[3], q[2]]), adj(basis([[0, 0], [w, 0], [0, h], [w, h]])));
  const n = t.map(x => x / t[8]);
  return `matrix3d(${n[0]},${n[3]},0,${n[6]},${n[1]},${n[4]},0,${n[7]},0,0,1,0,${n[2]},${n[5]},0,${n[8]})`;
}

export function initIviFocus({ THREE, screens, camera, canvas, getInterior, isCabin, onTap }) {
  // right after the 3D canvas in the DOM: in 'sharp' mode it paints over the scene but under every panel
  const root = document.createElement('div'); root.id = 'ivf'; root.hidden = true; canvas.after(root);
  const mk = (src, cls, label) => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.className = cls; c.setAttribute('aria-label', label); root.appendChild(c); return c; };
  const cl = mk(screens.cl, 'ivf-scr ivf-cl', '클러스터 (선명)'), cc = mk(screens.cc, 'ivf-scr ivf-cc', '센터 디스플레이 (선명, 터치)');
  const bar = document.createElement('div'); bar.className = 'ivf-bar'; bar.innerHTML = '<span>IVI 화면</span><button class="btn" type="button" data-m="sharp">차 안</button><button class="btn" type="button" data-m="bench">화면만</button><button class="btn" type="button" data-m="off">닫기 (Esc)</button>'; root.appendChild(bar);
  const S = { mode: 'off', version: -1, onMode: null };
  // taps on the centre display: element-local coordinates are the canvas pixels (also under the matrix3d transform)
  cc.addEventListener('click', e => onTap(e.offsetX * cc.width / cc.clientWidth, e.offsetY * cc.height / cc.clientHeight));
  bar.addEventListener('click', e => { const m = e.target.dataset && e.target.dataset.m; if (m) setMode(m); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && S.mode !== 'off') setMode('off'); });

  function setMode(m) {
    S.mode = m; root.hidden = m === 'off'; root.className = m === 'bench' ? 'bench' : 'sharp';
    document.body.classList.toggle('ivf-clean', m !== 'off');   // panels, dock and labels out of the way while the screens are in focus
    for (const el of [cl, cc]) { el.style.transform = ''; el.style.visibility = ''; }
    bar.querySelectorAll('[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
    if (S.onMode) S.onMode(m);
  }
  const v = new THREE.Vector3();
  function place(el, mesh) {   // project the plane's corners; hide when a corner is behind the camera
    const g = mesh.geometry.parameters, w = g.width / 2, h = g.height / 2, r = canvas.getBoundingClientRect(), q = [];
    mesh.updateWorldMatrix(true, false);
    for (const [x, y] of [[-w, h], [w, h], [w, -h], [-w, -h]]) {
      v.set(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera);
      if (v.z > 1 || v.z < -1) { el.style.visibility = 'hidden'; return; }
      q.push([r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]);
    }
    el.style.visibility = ''; el.style.transform = quadMatrix(el.width, el.height, q);
  }
  /** After each rendered frame. */
  function update() {
    if (S.mode === 'off') return;
    if (screens.version !== S.version) {   // copy the live UIs (they redraw at 10 Hz)
      S.version = screens.version; cl.getContext('2d').drawImage(screens.cl, 0, 0); cc.getContext('2d').drawImage(screens.cc, 0, 0);
    }
    if (S.mode === 'bench') return;
    const it = getInterior(), cab = isCabin() && it && it.cluster && it.center;
    root.style.visibility = cab ? '' : 'hidden';   // 'sharp' only applies in the cabin cameras
    if (cab) { place(cl, it.cluster); place(cc, it.center); }
  }
  return { setMode, update, get mode() { return S.mode; }, set onMode(f) { S.onMode = f; }, root };
}
