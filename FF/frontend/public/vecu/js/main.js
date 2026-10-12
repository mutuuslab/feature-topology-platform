// Ausfahrt Test Drive — entry: renderer, world, ego, UI, loop, harness hooks.
import * as THREE from 'three/webgpu';
import { $, D2R, clamp, lerp, IS_MOBILE, col, fetchBin, setMaxAnisotropy } from './util.js';
import { XML, roads, RD1, RD2, refAt, laneIdAt, tLane, SCENE } from './odr.js';
import { buildWorld, world, crownMeshes, PRESETS, WEATHER, atmos, atmo, loadHDRI, setBackdrop } from './world.js';
import { SplatLayer } from './splat.js';
import { Fn, positionLocal, normalize, atan, asin, vec2, texture as tslTexture, uniform, PI } from 'three/tsl';
import { initFFV } from './ffvui.js';
import { bakeScene, packBake } from './bake.js';
import { rnd, initRenderer, initProbe, updateProbe, compileProbe, setSharpen, buildPipeline, setQuality, setBloom, renderMain, renderView } from './render.js';
import { buildSedan, buildSUV, buildVan, CATALOG, CAT, gltfLoader, prepareModel, addGlbWheels, IDB, glow, setGlow, GLASS } from './vehicles.js';
import { ivi, iviApply, IviScreens } from './ivi.js';
import { veh, sim, addVeh, spawnTraffic, resetCut, step, place, scan, fill, detMesh, P_IDEAL, P_COARSE, vecu, vecuFrame, vecuStatus, vecuConnect, vecuTick, wrapS, EXIT_S, L1, OUTER } from './sim.js';

const showErr = m => { const e = $('#err'); e.textContent = m; e.hidden = false; };
window.addEventListener('error', ev => showErr('장면을 불러오지 못했습니다: ' + (ev.message || '알 수 없는 오류')));

async function main() {
  const canvas = $('#gl');
  let renderer; try { renderer = await initRenderer(canvas); } catch (e) { showErr('이 기기에서 WebGPU/WebGL2를 사용할 수 없어 3D 장면을 표시할 수 없습니다.'); return; }
  setMaxAnisotropy(8);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(55, 1, .15, 2600);
  buildWorld(scene);
  const probeTex = initProbe(scene);
  const splat = new SplatLayer(); splat.group.visible = false; scene.add(splat.group);
  const screens = new IviScreens();

  /* ---------------- ego ---------------- */
  let egoEntry = CAT[SCENE && CAT['ioniq6-fl'] ? 'ioniq6-fl' : 'grandeur-pleos'], egoTemplate = null, egoModel = null, egoYawFlip = 0, gltfAsset = null, gltfFail = false, curPaint = '#9e1019'; const glbCache = {};
  const ego = addVeh(scene, 'sedan', { L: 5.035, W: 1.88, H: 1.46, wb: 2.895, color: curPaint, plate: 'MUTUUS', s: 40, t: tLane(-3), v: 30.5, vSet: 110 / 3.6, tg: 1.8, interior: true, ivi: screens, platform: egoEntry.os });
  ego.rcs = 0; sim.ego = ego; sim.scene = scene; egoTemplate = { grp: ego.body.children[0] }; // placeholder replaced by selectEgo
  const egoProc = { L: ego.L, W: ego.W };
  const egoLights = []; for (const s of [-1, 1]) { const sl = new THREE.SpotLight(0xfff0d2, 0, 90, .42, .55, 1.2); sl.position.set(ego.L / 2, .74, s * (ego.W / 2 - .3)); sl.target.position.set(ego.L / 2 + 40, -.6, s * 1.2); ego.body.add(sl, sl.target); egoLights.push(sl); }
  const egoGlowsG = []; for (const s of [-1, 1]) { const t = glow(0xff3322, .9, 0, 0, 0), h = glow(0xfff1d0, 1.4, 0, 0, 0); t.userData.kind = 't'; h.userData.kind = 'h'; t.userData.s = h.userData.s = s; t.visible = h.visible = false; ego.body.add(t, h); egoGlowsG.push(t, h); }
  const egoGlowFit = () => egoGlowsG.forEach(g => { const s = g.userData.s; if (g.userData.kind === 't') g.position.set(-ego.L / 2 - .05, ego.H * .62, s * ego.W * .36); else g.position.set(ego.L / 2 + .04, ego.H * .5, s * ego.W * .36); });
  // The reflection probe (LDR cube of the actual surroundings, no sun) lights the cabin: under the roof it gives the real
  // sky and road colours. Exteriors keep the scene environment (HDRI aligned to the sun): with the probe the paint lost its
  // highlights and looked dull. Interior materials are shared with exteriors, so the cabin gets its own copies.
  const applyProbe = grp => { const copies = new Map(); grp.traverse(o => {
    const m = o.material; if (!o.isMesh || !m || !(m.isMeshPhysicalMaterial || m.isMeshStandardMaterial)) return;
    if (!copies.has(m)) { const c = m.clone(); c.envMap = probeTex; copies.set(m, c); } o.material = copies.get(m); }); };
  const cabinOf = b => (b && b.interior && b.interior.grp) || null;
  const T = spawnTraffic(scene);
  const detA = detMesh(scene, 1), detB = detMesh(scene, 2);
  const fan = new THREE.Group(); { const mat = new THREE.MeshBasicMaterial({ color: 0xf0b445, transparent: true, opacity: .09, depthWrite: false, side: THREE.DoubleSide });
    for (const [r, a] of [[70, 50], [180, 9]]) { const s = new THREE.Shape(); s.moveTo(0, 0); s.absarc(0, 0, r, -a * D2R, a * D2R, false); s.lineTo(0, 0); const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 24), mat); m.rotation.x = -Math.PI / 2; fan.add(m); } fan.position.set(ego.L / 2 + .05, .06, 0); ego.grp.add(fan); }

  function setEgoLamps() { ego.lamps.forEach(m => { m.userData.base = sim.lamp; }); (ego.glows || []).forEach(sp => { setGlow(sp, clamp((sim.lamp - .6) * .7, 0, .75)); }); egoGlowsG.forEach(sp => { setGlow(sp, clamp((sim.lamp - .6) * .7, 0, .75)); }); egoLights.forEach(l => { l.intensity = sim.head * 3; }); }
  const dimsText = e => { const [L, W, H, WB] = e.dims; return `${L.toLocaleString()} × ${W.toLocaleString()} × ${H.toLocaleString()} mm · WB ${WB.toLocaleString()}`; };
  function egoFinish(label) {
    const cs = ego.grp.children.find(c => c.userData.contact); if (cs) cs.scale.set(ego.L / egoProc.L, ego.W / egoProc.W, 1);
    fan.position.x = ego.L / 2 + .05; egoLights.forEach(l => { l.position.x = ego.L / 2 - .1; l.position.y = Math.min(.8, ego.H * .5); l.target.position.x = ego.L / 2 + 40; });
    if (ego.paint) ego.paint.color.set(curPaint); setEgoLamps(); $('#egoLine').textContent = label;
    const sel = $('#egoSel'); if (sel && sel.value !== egoEntry.id) sel.value = egoEntry.id;
    $('#b-flip').disabled = !egoModel; $('#b-glbDel').disabled = !glbCache[egoEntry.id]; ivi.platform = egoEntry.os === '—' ? 'IVI' : egoEntry.os; ivi.dirty = true;
  }
  function useEgoAsset(m, label) {
    dropBase(); if (egoTemplate) { ego.body.remove(egoTemplate.grp); egoTemplate = null; } if (egoModel) ego.body.remove(egoModel.wrap);
    egoModel = m; m.wrap.rotation.y = egoYawFlip; ego.body.add(m.wrap);
    ego.L = m.L; ego.W = Math.min(m.W, 2.1); ego.H = m.H; ego.paint = m.paint || null; ego.interior = null;
    // exterior-only models: the cabin cameras show the procedural interior (seats, cluster, IVI) of the same dimensions
    dropCabin(); if (egoEntry.dims) { const [L, W, H, WB] = egoEntry.dims.map(v => v / 1000);
      egoCabin = (egoEntry.body === 'suv' ? buildSUV : buildSedan)({ L, W, H, wb: WB, color: curPaint, plate: 'MUTUUS', interior: true, ivi: screens, platform: egoEntry.os });
      egoCabin.grp.visible = false; ego.body.add(egoCabin.grp); if (cabinOf(egoCabin)) applyProbe(cabinOf(egoCabin)); } cabinView(cabOn);
    const tail = m.tail || new THREE.MeshStandardMaterial(), head = m.head[0] || new THREE.MeshStandardMaterial(); ego.lamps = [tail, head]; ego.tail = tail; ego.gltfHeads = m.head; ego.glows = []; ego.wheels = [];
    egoGlowsG.forEach(g => { g.visible = true; }); egoGlowFit(); egoFinish(`${label} · ${(m.L * 1000).toFixed(0)} × ${(ego.W * 1000).toFixed(0)} × ${(m.H * 1000).toFixed(0)} mm`);
  }
  let egoCabin = null, cabOn = false;   // cabOn: a cabin camera (driver/IVI) is active
  const dropCabin = () => { if (egoCabin) { ego.body.remove(egoCabin.grp); egoCabin = null; } };
  function cabinView(on) { if (!egoModel || !egoCabin) return; egoModel.wrap.visible = !on; egoCabin.grp.visible = on; ego.interior = on ? egoCabin.interior : null; }
  const egoBase = [...ego.body.children]; const dropBase = () => { egoBase.forEach(c => ego.body.remove(c)); egoBase.length = 0; };
  function useEgoTemplate(e) {
    dropBase(); dropCabin(); if (egoModel) { ego.body.remove(egoModel.wrap); egoModel = null; } if (egoTemplate) ego.body.remove(egoTemplate.grp);
    const [L, W, H, WB] = e.dims.map(v => v / 1000), opt = { L, W, H, wb: WB, color: curPaint, plate: 'MUTUUS', interior: true, ivi: screens, platform: e.os };
    let b; if (e.body === 'suv') b = buildSUV(opt); else if (e.body === 'van') { b = buildVan({ color: curPaint }); b.grp.scale.set(L / 5.0, H / 2.0, W / 1.95); } else b = buildSedan(opt);
    b.grp.traverse(o => { if (o.isMesh) o.castShadow = true; }); if (cabinOf(b)) applyProbe(cabinOf(b));
    egoTemplate = b; ego.body.add(b.grp);
    Object.assign(ego, { paint: b.paint, wheels: b.wheels, wr: b.wr, lamps: b.lamps, tail: b.tail, glows: b.glows, interior: b.interior, L, W, H }); ego.gltfHeads = null;
    egoGlowsG.forEach(g => { g.visible = false; }); egoFinish(`Ego: ${e.name} · ${e.os} · ${dimsText(e)}${e.note ? ' · ' + e.note : ''}`);
  }
  async function selectEgo(id) {
    const e = CAT[id]; if (!e) return; egoEntry = e; vecu.egoEntry = e; egoYawFlip = 0;
    if (e.body === 'gltf') { if (gltfAsset) useEgoAsset(gltfAsset, 'Ego: Car Concept (glTF 데모)'); else $('#kAsset').textContent = gltfFail ? '에셋: 데모 glTF를 불러오지 못했습니다.' : '에셋: 데모 glTF를 불러오는 중입니다.'; return; }
    let a = glbCache[id], bundled = null; if (!a) { const rec = await IDB.get(id); if (rec && rec.buf) { try { a = await parseGLB(rec.buf); glbCache[id] = a; } catch (err) { } } }
    // a licensed model the user placed next to the app for this entry (CATALOG .glb/.credit); a per-browser upload wins
    if (!a && e.glb) { bundled = bundledCache[id] || (bundledCache[id] = fetch(e.glb).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then(parseGLB).then(m => fitToSpec(m, e)).catch(err => { console.warn('ego glb', e.glb, err); return null; })); a = await bundled; }
    if (egoEntry !== e) return; showCredit(a && bundled ? e.credit : null);
    if (a) { useEgoAsset(a, `Ego: ${e.name} · ${e.os} · ${bundled ? '라이선스 glTF' : '사용자 glTF'}`); if (bundled && e.yawFlip) { egoYawFlip = Math.PI; a.wrap.rotation.y = egoYawFlip; } } else useEgoTemplate(e);
  }
  // downloaded models are rarely to scale: fit uniformly to the catalogue's published length
  const fitToSpec = (m, e) => { const k = e.dims[0] / 1000 / m.L; if (Math.abs(k - 1) > .02) { m.wrap.scale.setScalar(k); m.L *= k; m.W *= k; m.H *= k; }
    const wh = addGlbWheels(m, e); if (wh) { m.wheels.push(...wh); m.wheelAxes.push(...wh.map(w => new THREE.Vector3(0, 0, w.rotation.y ? 1 : -1))); }   // body-only model: template wheels
    return m; };
  const bundledCache = {}, creditsEl = $('#credits'), creditsBase = creditsEl ? creditsEl.innerHTML : '';
  const showCredit = c => { if (creditsEl) creditsEl.innerHTML = c ? `${creditsBase} · ${c}` : creditsBase; };
  const parseGLBraw = buf => new Promise((res, rej) => gltfLoader().parse(buf, '', res, rej));
  const parseGLB = buf => parseGLBraw(buf).then(prepareModel);
  function assetStatus() {
    const parts = [gltfAsset ? '차량 glTF ✓' : gltfFail ? '차량 glTF 실패' : '차량 glTF 불러오는 중', world.hdrState[atmo.time] === 'ok' ? 'HDRI ✓' : world.hdrState[atmo.time] === 'fallback' ? 'HDRI 실패' : 'HDRI 불러오는 중',
      `${rnd.backend} · ${rnd.fx.ok ? ({ base: '후처리 끔', high: 'GTAO·블룸·TRAA', ultra: 'GTAO·SSR·블룸·TRAA' })[rnd.quality] : '후처리 미지원'} · ${bg.mode === 'splat' ? 'Neutral' : 'AgX'}`];
    if (bg.msg) parts.push(bg.msg);
    $('#kAsset').textContent = '에셋: ' + parts.join(' · ');
  }
  fetchBin('assets/car.glb.b64.txt').then(parseGLBraw).then(g => { gltfAsset = prepareModel(g); if (egoEntry.id === 'concept') selectEgo('concept'); assetStatus(); }).catch(err => { gltfFail = true; assetStatus(); console.warn('car.glb', err); });
  async function refreshEgoOptions() { const ks = new Set((await IDB.keys()) || []); document.querySelectorAll('#egoSel option').forEach(o => { const it = CAT[o.value]; if (it) o.textContent = it.name + (ks.has(it.id) ? '  ● glb' : ''); }); }
  $('#glbFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return; const target = egoEntry; const rd = new FileReader();
    rd.onload = async () => { try { const a = await parseGLB(rd.result); glbCache[target.id] = a; await IDB.put(target.id, { name: f.name, buf: rd.result }); if (egoEntry === target) useEgoAsset(a, `Ego: ${target.name} · ${target.os} · 사용자 glTF`); $('#kAsset').textContent = `에셋: "${f.name}"을(를) ${target.name}에 연결했습니다 (이 브라우저에만 저장)`; refreshEgoOptions(); }
      catch (err) { $('#kAsset').textContent = '에셋: 이 파일을 glTF로 읽지 못했습니다. .glb 단일 파일을 선택하세요.'; } };
    rd.readAsArrayBuffer(f); e.target.value = '';
  });

  /* ---------------- backdrop: procedural world or captured splat scene ---------------- */
  // Under a splat the captured photo colours should reach the screen unchanged: Neutral tone mapping is the identity
  // below ~0.76, and the splat exposure cancels toneMappingExposure (see frame()).
  const bg = { mode: 'proc', url: null, gain: 1, msg: '' };
  // Photo sky of a captured scene (tools/nurec_sky.py: equirect from the clip's camera photos, simulator frame) in place of
  // the procedural sky dome. Same colour path as the splats (exposure-compensated, so it reaches the screen as captured).
  const photoSky = { mesh: null, expo: uniform(1) };
  function loadPhotoSky(name) {
    new THREE.TextureLoader().load(`./splat/${name}.sky.png`, tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 4;
      const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false }); m.toneMapped = false; m.lights = false;
      m.colorNode = Fn(() => { const d = normalize(positionLocal); return tslTexture(tex, vec2(atan(d.z, d.x).div(PI.mul(2)).add(.5), asin(d.y.clamp(-1, 1)).div(PI).add(.5))).rgb.mul(photoSky.expo); })();
      // radius inside the far planes of the camera (2600) and of the reflection probe (900); drawn first without depth,
      // so everything — splats kilometres away included — still lands in front of it
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), m); mesh.renderOrder = -10; mesh.frustumCulled = false; mesh.name = 'photoSky';
      photoSky.mesh = mesh; scene.add(mesh); applySky();
    }, undefined, () => console.warn('no photo sky for', name));
  }
  function applySky() {
    const ph = !!photoSky.mesh && bg.mode === 'splat';
    if (photoSky.mesh) photoSky.mesh.visible = ph; world.sky.visible = !ph; world.clouds.visible = !ph;
  }
  function setBackdropMode(m) {
    if (m === 'splat' && !splat.n) { loadSplat(bg.url || SPLAT_DEFAULT); return; }
    bg.mode = m; splat.group.visible = m === 'splat'; setBackdrop(m); press('bg', m); applyActors(); applySky();
    rnd.probeSlow = m === 'splat' ? 4 : 1; setSharpen(m === 'splat' && !new URLSearchParams(location.search).has('nosharp'));   // under a splat the probe only reflects the sky, the road proxy and the cars
    applyAtmosphere();   // exposure of the lit 3D parts depends on the backdrop
    renderer.toneMapping = m === 'splat' ? THREE.NeutralToneMapping : THREE.AgXToneMapping; assetStatus();
  }
  // loading progress (top centre): download -> decode (worker) -> recorded vehicles
  const loadEl = $('#load'), MB = b => (b / 1048576).toFixed(1);
  function progress(title, f, detail) {
    if (f == null) { loadEl.hidden = true; return; }
    const pc = Math.round(f * 100); loadEl.hidden = false; $('#loadT').textContent = title; $('#loadV').textContent = detail || `${pc}%`;
    $('#loadBar').style.width = `${(f * 100).toFixed(1)}%`; loadEl.setAttribute('aria-valuenow', String(pc));
  }
  const splatProgress = (lo, hi) => (stage, f, info) => stage === 'download'
    ? progress('실사 장면 내려받는 중', lo + (hi - lo) * .8 * f, `${MB(info.loaded)} / ${MB(info.total)} MB`)
    : progress('스플랫 처리 중', lo + (hi - lo) * (.8 + .2 * f));
  async function loadSplat(src, name, span = [0, 1]) {
    bg.msg = '스플랫 불러오는 중'; assetStatus(); progress('실사 장면 불러오는 중', span[0]);
    try {
      const T0 = performance.now(), mark = {}, pr0 = splatProgress(span[0], span[1]);
      const pr = (st, f, i) => { if (!mark[st]) mark[st] = performance.now() - T0; if (f >= 1) mark[st + '1'] = performance.now() - T0; pr0(st, f, i); };
      if (src instanceof ArrayBuffer) await splat.loadBuffer(src, pr); else await splat.load(src, pr);
      mark.ready = performance.now() - T0; requestAnimationFrame(() => requestAnimationFrame(() => { mark.frame = performance.now() - T0; console.log('[load] splat ms', JSON.stringify(mark, (k, v) => (typeof v === 'number' ? Math.round(v) : v))); }));
      bg.url = typeof src === 'string' ? src : null; bg.msg = `스플랫 ${(name || bg.url || '').split('/').pop()} · ${splat.n.toLocaleString()}개`;
      setBackdropMode('splat');
    } catch (e) { console.warn('splat', e); bg.msg = '스플랫을 불러오지 못했습니다 (' + (e.message || e) + ')'; setBackdropMode('proc'); }
    if (span[1] >= 1) progress(null);
    return splat.n;
  }
  const SPLAT_DEFAULT = './splat/scene.aspl';
  // Recorded vehicles of a captured scene as photoreal traffic (tools/nurec_actors.py -> splat/<scene>_actors/). Only the
  // sides the recording car saw are reconstructed, so vehicles ahead of the ego (seen from behind by the chase camera)
  // get rear-observed actors and those behind get front-observed ones. The procedural body stays for proc backdrop.
  const actors = [];
  async function loadActors(name) {
    if (new URLSearchParams(location.search).has('noactors')) { await warmUp(); progress(null); return; }   // diagnostics: scene without recorded vehicles
    const ix = await fetch(`./splat/${name}_actors/index.json`).then(r => (r.ok ? r.json() : [])).catch(() => []);
    const pool = ix.filter(r => r.aspl), used = new Set();
    const take = f => { const r = pool.filter(q => !used.has(q.id) && f(q)).sort((a, b) => b.n - a.n)[0]; if (r) used.add(r.id); return r; };
    const car = q => q.cls === 'automobile' && q.L < 5, seen = (q, k) => q.seen.some(x => x.includes(k));
    const plan = [['white', q => car(q) && seen(q, 'rear')], ['silver', q => car(q) && seen(q, 'rear')], ['cut', q => car(q) && seen(q, 'rear')],
      ['grey', q => car(q) && seen(q, 'front')], ['green', q => car(q) && seen(q, 'front')], ['van', q => q.cls === 'automobile' && q.L >= 5], ['truck', q => q.cls === 'heavy_truck' && seen(q, 'rear')]];
    const jobs = plan.map(([vn, f]) => [vn, T[vn] && take(f)]).filter(j => j[1]); let k = 0;
    for (const [vn, r] of jobs) {
      const v = T[vn]; progress('실제 차량 불러오는 중', .9 + .1 * k / jobs.length, `${++k} / ${jobs.length}`);
      try {
        const layer = new SplatLayer(); await layer.load(`./splat/${name}_actors/${r.aspl}`); layer.mesh.renderOrder = -4; layer.mesh.name = 'actor:' + r.id;
        // grp: ground origin, unscaled (the body group carries the template's offsets/scale)
        const hidden = [...v.body.children]; v.grp.add(layer.group); actors.push({ v, layer, hidden, r, dims: { L: v.L, W: v.W, H: v.H } });
      } catch (e) { console.warn('actor', r.id, e); }
    }
    applyActors(); bg.msg = `${bg.msg} · 실제 차량 ${actors.length}대`; assetStatus();
    await warmUp(); progress(null);
  }
  // First use of every new material/pipeline compiles shaders in the GPU process (seconds for the splat shader on D3D12),
  // which shows up as stalls right after loading. Compile what is visible now, asynchronously, while the bar is up.
  // Compile for the targets the frame really draws into: the post-processing scene pass (MRT) or the canvas, and the
  // reflection probe's cube. While compiling no frames are drawn (they would only queue behind the compiles: ~5 s longer).
  let warming = false;
  async function warmUp() {
    const t0 = performance.now(); warming = !new URLSearchParams(location.search).has('warmrender');
    const post = !!rnd.pipeline && rnd.quality !== 'base' && rnd.fx.scenePass; splat.usePost(post); actors.forEach(a => a.layer.usePost(post));
    const jobs = [post ? () => rnd.fx.scenePass.compileAsync(renderer) : () => renderer.compileAsync(scene, camera), () => compileProbe(scene, egoHide())];
    for (const [i, job] of jobs.entries()) {
      progress('셰이더 준비 중', .97 + .03 * i / jobs.length, `${i + 1} / ${jobs.length}`);
      try { await job(); } catch (e) { console.warn('compileAsync', e); }
    }
    // the first real frames still build the shadow and post-processing passes: let them happen under the bar
    warming = false; progress('셰이더 준비 중', 1, '첫 화면'); for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
    console.log('[load] warm-up ms', Math.round(performance.now() - t0));
  }
  // A recorded vehicle is reconstructed only on the sides the recording car saw (r.seen). Looked at from elsewhere at close
  // range its splats are a smeared blob: there the template body takes over; far away the splats stay. A hard switch with
  // hysteresis (enter < 35°, leave > 45° from an observed direction): a cross-fade showed blob and template at once.
  const SEEN_AZ = { front: 0, 'front-left': 45, left: 90, 'rear-left': 135, rear: 180, 'rear-right': 225, right: 270, 'front-right': 315 };
  const _cl = new THREE.Vector3();
  function actorView(a, dt) {
    a.v.grp.worldToLocal(_cl.copy(camera.position));   // vehicle frame: x forward, y up, z right
    const az = Math.atan2(-_cl.z, _cl.x) * 180 / Math.PI, far = Math.hypot(_cl.x, _cl.z) > ACTOR_NEAR;
    const off = Math.min(Infinity, ...a.r.seen.map(k => Math.abs((((az - SEEN_AZ[k]) % 360) + 540) % 360 - 180)));   // degrees from the nearest observed direction
    const splatOk = far || off < (a.body ? ACTOR_VALID_DEG : ACTOR_VALID_DEG + 10), body = !splatOk;
    a.fade = splatOk ? 1 : 0; a.layer.opacity.value = a.fade;
    if (a.body !== body) { a.body = body; a.hidden.forEach(o => { o.visible = body; }); }
  }
  const ACTOR_NEAR = 45, ACTOR_VALID_DEG = 35;
  function applyActors() {
    const on = bg.mode === 'splat';
    for (const a of actors) { a.layer.group.visible = on; a.hidden.forEach(o => { o.visible = !on; }); a.body = !on; a.fade = 1; a.layer.opacity.value = 1; Object.assign(a.v, on ? { L: a.r.L, W: a.r.W, H: a.r.H } : a.dims); }
  }
  $('#asplFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (!f) return; progress('파일 읽는 중', 0); f.arrayBuffer().then(b => loadSplat(b, f.name)); e.target.value = ''; });

  /* ---------------- atmosphere ---------------- */
  function applyAtmosphere() { const ctx = {}; atmos(renderer, atmo.time, atmo.weather, ctx); sim.lamp = ctx.lamp; sim.head = ctx.head; vecu.weather = atmo.weather; ivi.live.time = atmo.time;
    for (const v of veh) if (v !== ego && v.lamps) { v.lamps.forEach(m => { m.userData.base = ctx.lamp; }); v.glows.forEach(sp => { setGlow(sp, clamp((ctx.lamp - .6) * .7, 0, .75)); }); }
    setEgoLamps(); setBloom(atmo.weather !== 'clear' ? .16 : atmo.time === 'dusk' ? .45 : .2); loadHDRI(renderer, atmo.time, () => { atmos(renderer, atmo.time, atmo.weather, {}); assetStatus(); }); }

  /* ---------------- camera ---------------- */
  const ui = { radar: 'ideal', cam: 'chase', gt: false, fov: true, quad: false }; let shotCam = null, camYaw = 0, camPitch = 0;
  const camLook = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
  function updateCam(dt) {
    const f3 = new THREE.Vector3(Math.cos(ego.hw), 0, -Math.sin(ego.hw)), ep = ego.grp.position, k = sim.snapCam ? 1 : 1 - Math.exp(-dt * 6);
    if (ui.cam === 'shot' && shotCam) {
      const l3 = new THREE.Vector3(-Math.sin(ego.hw), 0, -Math.cos(ego.hw));
      const want = new THREE.Vector3(ep.x - f3.x * shotCam.back + l3.x * shotCam.left, ep.y + shotCam.up, ep.z - f3.z * shotCam.back + l3.z * shotCam.left);
      const look = new THREE.Vector3(ep.x + f3.x * shotCam.look + l3.x * (shotCam.lookLeft || 0), ep.y + (shotCam.lookUp || .8), ep.z + f3.z * shotCam.look + l3.z * (shotCam.lookLeft || 0));
      camera.position.lerp(want, k); camLook.lerp(look, k); camera.lookAt(camLook); sim.snapCam = false; return;
    }
    if (ui.cam === 'driver' || ui.cam === 'ivi') {
      const eye = ego.interior ? ego.interior.eye.clone() : new THREE.Vector3(-.09 * ego.L, ego.H * .78, -.37);
      if (ui.cam === 'ivi') { eye.add(new THREE.Vector3(.02, .02, .1)); tmpL.copy(ego.interior ? ego.interior.center.position : new THREE.Vector3(.13 * ego.L, .83, 0)); }
      else { eye.y += camPitch * .05; tmpL.copy(eye).add(new THREE.Vector3(Math.cos(camYaw) * 14, -1.5 - camPitch * 4, -Math.sin(camYaw) * 14)); }   // ~6° down: road, dash and the wheel rim in view
      ego.body.localToWorld(tmpV.copy(eye)); ego.body.localToWorld(tmpL);
      camera.position.copy(tmpV); camLook.copy(tmpL); camera.lookAt(camLook); sim.snapCam = false; return;
    }
    const cfg = { chase: [9.5, 2.9, 5], high: [30, 17, 22], orbit: [11.5, 3.2, 0], close: [6.2, 1.6, 2.5] }[ui.cam] || [9.5, 2.9, 5];
    const yaw = camYaw + (ui.cam === 'orbit' ? sim.simT * .18 : 0), back = f3.clone().applyAxisAngle(UP, yaw).multiplyScalar(-cfg[0]);
    const want = new THREE.Vector3(ep.x + back.x, ep.y + cfg[1] + camPitch * cfg[0], ep.z + back.z); want.y = Math.max(want.y, ep.y + .8);
    const look = new THREE.Vector3(ep.x + f3.x * cfg[2], ep.y + 1.1, ep.z + f3.z * cfg[2]);
    camera.position.lerp(want, k); camLook.lerp(look, sim.snapCam ? 1 : 1 - Math.exp(-dt * 10)); camera.lookAt(camLook); sim.snapCam = false;
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); $('#hint').style.opacity = 0; });
  canvas.addEventListener('pointermove', e => { if (!drag) return; camYaw -= (e.clientX - drag.x) * .006; camPitch = clamp(camPitch + (e.clientY - drag.y) * .003, -.15, 1.2); drag = { x: e.clientX, y: e.clientY }; });
  const endDrag = () => { drag = null; }; canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('dblclick', () => { camYaw = 0; camPitch = 0; });
  setTimeout(() => { $('#hint').style.opacity = 0; }, 7000);

  /* ---------------- UI ---------------- */
  const GROUPS = [
    { label: '레퍼런스 샷', key: 'shot', opts: [['ausfahrt', 'Ausfahrt'], ['radar', '레이더 비교'], ['variants', '4분할 변형']], val: null },
    { label: '시나리오', key: 'scn', opts: [['cutin', '컷인'], ['free', '자유주행']], val: 'cutin', extra: { id: 'vary', text: '파라미터 변형' } },
    { label: '레이더', key: 'radar', opts: [['off', '끔'], ['ideal', 'Ideal'], ['coarse', 'Coarse'], ['split', '비교']], val: 'ideal' },
    { label: '시간', key: 'time', opts: [['day', '낮'], ['dusk', '석양']], val: 'day' },
    { label: '날씨', key: 'fog', opts: [['clear', '맑음'], ['rain', '비'], ['fog', '안개']], val: 'clear' },
    { label: '카메라', key: 'cam', opts: [['chase', '추적'], ['close', '근접'], ['driver', '운전석'], ['ivi', 'IVI'], ['high', '상공'], ['orbit', '회전']], val: 'chase' },
    { label: '표시', key: 'show', toggles: [['gt', 'GT 박스', false], ['fov', 'FOV', true]], button: { id: 'odrOpen', text: 'OpenDRIVE' } },
    { label: 'IVI · vECU', key: 'io', buttons: [['iviOpen', 'IVI 화면'], ['vecuOpen', 'I/O · 연결'], ['ffvMode', 'FF 가상 검증']] },
    { label: '배경', key: 'bg', opts: [['proc', '절차 생성'], ['splat', '실사 스플랫']], val: 'proc', extra: { id: 'asplOpen', text: '.aspl 열기' } },
    { label: '그래픽', key: 'q', opts: [['base', '기본'], ['high', '고급'], ['ultra', '최상']], val: rnd.quality },
    { label: 'Ego 차종 (현대자동차)', key: 'egoCat', custom: true },
    { label: 'Ego 도장', key: 'paint', swatches: [['#9e1019', '레드'], ['#15171b', '블랙'], ['#e6e7e3', '화이트 펄'], ['#1f3a6b', '블루'], ['#6b6f75', '그래파이트']], val: '#9e1019' }
  ];
  const groupsEl = $('#groups');
  for (const g of GROUPS) {
    const el = document.createElement('div'); el.className = 'grp'; el.innerHTML = `<span>${g.label}</span>`; const row = document.createElement('div'); row.className = 'row'; el.appendChild(row);
    if (g.opts) { const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', g.label);
      for (const [v, t] of g.opts) { const b = document.createElement('button'); b.type = 'button'; b.id = `b-${g.key}-${v}`; b.textContent = t; b.setAttribute('aria-pressed', String(v === g.val)); b.onclick = () => { seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); onOpt(g.key, v); }; seg.appendChild(b); }
      row.appendChild(seg); }
    if (g.extra) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = g.extra.id; b.textContent = g.extra.text; row.appendChild(b); }
    if (g.toggles) for (const [v, t, on] of g.toggles) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = `b-${v}`; b.textContent = t; b.setAttribute('aria-pressed', String(on)); b.onclick = () => { const n = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(n)); onOpt(v, n); }; row.appendChild(b); }
    if (g.swatches) for (const [c, t] of g.swatches) { const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.id = `b-paint-${c.slice(1)}`; b.style.background = c; b.title = t; b.setAttribute('aria-label', `도장: ${t}`); b.setAttribute('aria-pressed', String(c === g.val)); b.onclick = () => { row.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', String(x === b))); curPaint = c; if (ego.paint) ego.paint.color.set(c); }; row.appendChild(b); }
    if (g.button) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = g.button.id; b.textContent = g.button.text; row.appendChild(b); }
    if (g.buttons) for (const [id, t] of g.buttons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = id; b.textContent = t; row.appendChild(b); }
    if (g.custom) { const sel = document.createElement('select'); sel.id = 'egoSel'; sel.setAttribute('aria-label', 'Ego 차종');
      for (const grp of CATALOG) { const og = document.createElement('optgroup'); og.label = grp.grp; for (const it of grp.items) { const o = document.createElement('option'); o.value = it.id; o.textContent = it.name; og.appendChild(o); } sel.appendChild(og); }
      sel.value = egoEntry.id; sel.onchange = () => selectEgo(sel.value); row.appendChild(sel);
      for (const [id, t] of [['b-glbAdd', '.glb 연결'], ['b-glbDel', '연결 해제'], ['b-flip', '앞뒤 반전']]) { const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'btn'; bt.id = id; bt.textContent = t; row.appendChild(bt); } }
    groupsEl.appendChild(el);
  }
  const press = (key, val) => document.querySelectorAll(`[id^="b-${key}-"]`).forEach(b => b.setAttribute('aria-pressed', String(b.id === `b-${key}-${val}`)));
  function onOpt(k, v) {
    if (k === 'scn') sim.scn.enabled = v === 'cutin';
    if (k === 'radar') { ui.radar = v; sim.radar = v; $('#legend').hidden = v === 'off'; }
    if (k === 'time') { atmo.time = v; ui.quad = false; press('shot', 'none'); applyAtmosphere(); }
    if (k === 'fog') { atmo.weather = v; ui.quad = false; press('shot', 'none'); applyAtmosphere(); }
    if (k === 'cam') { ui.cam = v; ui.quad = false; shotCam = null; camera.fov = v === 'driver' ? 62 : v === 'ivi' ? 48 : 55; camYaw = 0; camPitch = 0; sim.snapCam = true; press('shot', 'none'); if (world.csm && world.csm.mainFrustum) world.csm.updateFrustums(); }
    if (k === 'shot') shot(v);
    if (k === 'gt') { ui.gt = v; veh.forEach(x => { if (x !== ego) x.gt.visible = v; }); }
    if (k === 'fov') ui.fov = v;
    if (k === 'q') { setQuality(v, camera, resize); assetStatus(); }
    if (k === 'bg') setBackdropMode(v);
  }
  $('#b-glbAdd').onclick = () => { if (egoEntry.body === 'gltf') { $('#kAsset').textContent = '에셋: 데모 차량에는 연결할 수 없습니다. 현대 차종을 먼저 고르세요.'; return; } $('#glbFile').click(); };
  $('#b-glbDel').onclick = async () => { const id = egoEntry.id; delete glbCache[id]; await IDB.del(id); refreshEgoOptions(); selectEgo(id); };
  $('#b-flip').onclick = () => { if (!egoModel) return; egoYawFlip = egoYawFlip ? 0 : Math.PI; egoModel.wrap.rotation.y = egoYawFlip; };
  $('#asplOpen').onclick = () => $('#asplFile').click();
  $('#vary').onclick = () => { const s = sim.scn; s.gap = Math.round(lerp(10, 28, Math.random())); s.dur = +lerp(2, 4.5, Math.random()).toFixed(1); s.vT = lerp(20, 27.5, Math.random()); setParText(); resetCut(); };
  // Feature Flag virtual validation mode (docs/FF_VIRTUAL_VALIDATION.md)
  const ffvUI = initFFV({ $, sim, veh, T, ego, tLane, wrapS, SCENE, press, setCam: v => onOpt('cam', v), ivi, iviApply, canvas, THREE, scene,
    shotCamera: cfg => { ui.cam = 'shot'; ui.quad = false; shotCam = cfg; camera.fov = cfg.fov; press('cam', 'none'); press('shot', 'none'); sim.snapCam = true; },
    sceneLabel: () => (bg.mode === 'splat' ? (SCENE ? `NuRec ${SCENE.name} (실사, OpenDRIVE 정합)` : `스플랫 ${bg.url || ''}`) : '절차 생성 고속도로 (OpenDRIVE)') });
  $('#ffvMode').onclick = () => ffvUI.open(!ffvUI.isOpen());
  const drawers = ['odr', 'vecu', 'ivip']; const openDrawer = id => drawers.forEach(d => { $('#' + d).hidden = d !== id; });
  $('#odrOpen').onclick = () => openDrawer('odr'); $('#vecuOpen').onclick = () => openDrawer('vecu'); $('#iviOpen').onclick = () => openDrawer('ivip');
  for (const d of drawers) $(`#${d}Close`).onclick = () => { $('#' + d).hidden = true; };
  vecu.statusEl = $('#vecuState'); vecu.connBtn = $('#vecuConn'); vecu.onShot = n => shot(n);
  $('#vecuConn').onclick = () => vecuConnect($('#vecuUrl').value.trim());
  $('#vecuCtl').onclick = () => { vecu.ctl = !vecu.ctl; $('#vecuCtl').setAttribute('aria-pressed', String(vecu.ctl)); vecuStatus(vecu.state); };
  $('#vecuCopy').onclick = () => { const t = JSON.stringify(vecuFrame(), null, 1); const done = () => { $('#vecuCopy').textContent = '복사됨'; setTimeout(() => { $('#vecuCopy').textContent = '현재 프레임 복사'; }, 1400); };
    try { navigator.clipboard.writeText(t).then(done, () => { const r = document.createRange(); r.selectNodeContents($('#vecuFrame')); const se = getSelection(); se.removeAllRanges(); se.addRange(r); }); } catch (e) { } };
  $('#odrXml').textContent = XML; $('#odrMeta').textContent = `도로 ${Object.keys(roads).length}개 · 지오메트리 ${RD1.geoms.length + RD2.geoms.length}개 (line/arc/spiral) · 레인 섹션 ${RD1.sections.length + RD2.sections.length}개 · JS 작성 → DOMParser 파싱 → 메시 생성`;
  const setParText = () => { const s = sim.scn; $('#kPar').textContent = `ParameterDeclaration · CutInGap ${s.gap.toFixed(0)} m · LaneChangeDuration ${s.dur.toFixed(1)} s · TargetSpeed ${(s.vT * 3.6).toFixed(0)} km/h`; }; setParText();
  // IVI panel
  screens.mirror = [$('#iviCl'), $('#iviCc')];
  document.querySelectorAll('[data-ivi]').forEach(b => { b.onclick = () => { ivi.screen = b.dataset.ivi; ivi.dirty = true; document.querySelectorAll('[data-ivi]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }; });
  $('#iviLock').onclick = () => iviApply({ body: { locked: !ivi.body.locked } }); $('#iviTrunk').onclick = () => iviApply({ body: { trunk: !ivi.body.trunk } });
  $('#iviPop').onclick = () => iviApply({ popup: { title: '전방 차량 감지', text: 'vECU 테스트 알림 · 스마트 크루즈 컨트롤이 속도를 조절합니다', level: 'warn', ms: 5000 } });
  $('#iviAcc').onclick = () => iviApply({ adas: { acc: ivi.adas.acc === 'active' ? 'standby' : 'active' } });
  $('#iviCc').onclick = e => { const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 1280, y = (e.clientY - r.top) / r.height * 720; if (y > 52 && y < 92) { const i = Math.floor((x - 28) / 160); const k = ['nav', 'media', 'vehicle', 'adas'][i]; if (k) { ivi.screen = k; ivi.dirty = true; document.querySelectorAll('[data-ivi]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ivi === k))); } } };

  /* ---------------- shots ---------------- */
  function arrange(cfg) {
    ego.s = cfg.ego[0]; ego.t = tLane(cfg.ego[1]); ego.v = cfg.ego[2] || 30.5; ego.lc = null;
    const all = [T.cut, T.van, T.moto, T.silver, T.white, T.truck, T.grey, T.green]; all.forEach((v, i) => { v.road = 1; v.lc = null; v.s = wrapS(ego.s - 200 - i * 25); v.t = tLane(i % 2 ? -2 : OUTER); });
    for (const [vn, ds, ln, sp] of cfg.place) { const v = T[vn]; v.road = 1; v.s = wrapS(ego.s + ds); v.t = tLane(ln); if (sp) { v.v = sp; v.vSet = sp; } }
    if (cfg.van != null) { T.van.road = 2; T.van.s = cfg.van; T.van.t = -1.875; T.van.v = 18; T.van.vSet = 18; T.van.exiting = false; }
    sim.scn.state = cfg.scnState || 'idle'; for (const v of veh) v.tRate = 0; sim.snapCam = true;
  }
  const SHOTS = {
    ausfahrt: { time: 'day', weather: 'clear', radar: 'off', quad: false, ego: [512, -4, 30.5], place: [['moto', 40, -3, 33], ['truck', 170, -2, 24], ['white', 240, -3, 31], ['cut', 130, -2, 34]], van: 92, scnState: 'done', cam: { back: 8.747, up: 3.695, left: 2.814, look: 2.0, lookUp: -0.355, fov: 41.901, lookLeft: -.6 } },
    radar: { time: 'dusk', weather: 'clear', radar: 'split', quad: false, ego: [905, -4, 29], place: [['cut', 16, -3, 28], ['moto', 23, -2, 30], ['white', 95, -3, 30], ['silver', 120, -2, 33], ['grey', 150, -4, 28]], scnState: 'done', cam: { back: 12.517, up: 3.2, left: 0.25, look: 2.0, lookUp: -0.54, fov: 55.0 } },
    variants: { time: 'day', weather: 'clear', radar: 'off', quad: true, ego: [180, -3, 29], place: [['truck', 64, -2, 24], ['silver', 46, -3, 27], ['white', 120, -2, 30]], scnState: 'done', cam: { back: 7.932, up: 3.782, left: 0.721, look: 2.044, lookUp: 0.328, fov: 49.883 } },
    cabin: { time: 'day', weather: 'clear', radar: 'off', quad: false, ego: [300, -3, 30.5], place: [['white', 42, -3, 30], ['silver', 60, -2, 33], ['truck', 120, -4, 24]], scnState: 'done', cam: null, view: 'driver' },
    // captured scene (?scene=<name>): ego where the recording vehicle started, on the real lanes
    ...(SCENE ? { scene: { time: 'day', weather: 'clear', radar: 'off', quad: false, ego: [SCENE.s_ego0, -3, 29], place: [['white', 38, -3, 29], ['silver', 22, -2, 31], ['truck', 95, -2, 24], ['moto', 140, -3, 30]], scnState: 'done', cam: { back: 8.2, up: 2.7, left: 1.2, look: 2.0, lookUp: -0.2, fov: 50 } } } : {})
  };
  function shot(name, opts) {
    const S = SHOTS[name]; if (!S) return; opts = opts || {};
    atmo.time = S.time; atmo.weather = S.weather; press('time', atmo.time); press('fog', atmo.weather);
    ui.radar = S.radar; sim.radar = S.radar; press('radar', ui.radar); $('#legend').hidden = ui.radar === 'off';
    ui.quad = S.quad; if (S.cam) { ui.cam = 'shot'; shotCam = S.cam; camera.fov = S.cam.fov; } else { ui.cam = S.view; shotCam = null; camera.fov = 62; }
    press('cam', S.view || 'none'); press('shot', name); arrange(S); applyAtmosphere(); sim.paused = !!opts.freeze; if (world.csm && world.csm.mainFrustum) world.csm.updateFrustums();
  }

  /* ---------------- HUD / IVI live ---------------- */
  function hud() {
    const ld = ego.ld; $('#kSpd').textContent = `${(ego.v * 3.6).toFixed(1)} km/h`;
    if (ld) { $('#kGap').textContent = `${ld.gap.toFixed(1)} m`; const cl = ego.v - ld.v; $('#kTtc').textContent = cl > .3 ? `${(ld.gap / cl).toFixed(1)} s` : '∞'; } else { $('#kGap').textContent = '—'; $('#kTtc').textContent = '—'; }
    const lid = laneIdAt(RD1, ego.s, ego.t); $('#kOdr').textContent = `lane ${lid} · s ${ego.s.toFixed(1)}`;
    $('#kDet').textContent = ui.radar === 'off' ? '—' : ui.radar === 'split' ? `${sim.detsA.length} / ${sim.detsB.length}` : `${(ui.radar === 'ideal' ? sim.detsA : sim.detsB).length}`;
    let st = 'free', txt = '자유 주행'; if (sim.scn.state === 'lc') { st = 'cutin'; txt = '컷인 진행 중'; } else if (ego.a < -1.5) { st = 'brake'; txt = `ACC 제동 ${ego.a.toFixed(1)} m/s²`; } else if (ld) { st = 'follow'; txt = '선행차 추종'; }
    const chip = $('#state'); chip.dataset.s = st; chip.querySelector('span').textContent = txt;
  }
  function iviLive() {
    const L = ivi.live, ld = ego.ld; L.kph = ego.v * 3.6; L.lead = ld ? { gap: ld.gap, v: ld.v } : null; L.ttc = ld && ego.v - ld.v > .3 ? ld.gap / (ego.v - ld.v) : null; L.lane = laneIdAt(RD1, ego.s, ego.t);
    L.dist = ((EXIT_S - ego.s) % L1 + L1) % L1; L.brake = ego.a < -1.2; const t = 12 * 3600 + 30 * 60 + sim.simT; L.clock = `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
    L.temp = atmo.time === 'dusk' ? 14 : 18; L.range = 412 - sim.simT * .012; L.soc = .78 - sim.simT * .00002; L.turn = ego.lc ? (ego.lc.t1 > ego.lc.t0 ? -1 : 1) : (L.turn === 0 ? 0 : L.turn);
    if (!ego.lc && L.turn && !vecu.ws) L.turn = 0; ivi.adas.setKph = Math.round(ego.vSet * 3.6); ivi.adas.acc = vecuDrivesNow() ? 'active' : ivi.adas.acc; ivi.adas.fcw = L.ttc != null && L.ttc < 1.8;
    screens.update({ s: ego.s, t: ego.t, hdg: ego.hw });
  }
  const vecuDrivesNow = () => vecu.ctl && vecu.state === 'open';

  /* ---------------- quality / pipeline / resize ---------------- */
  buildPipeline(scene, camera);
  const dockEl = $('#dock');
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (world.csm && world.csm.mainFrustum) world.csm.updateFrustums(); document.documentElement.style.setProperty('--dockH', dockEl.offsetHeight + 'px'); }
  addEventListener('resize', resize);
  setQuality(rnd.quality, camera, resize); press('q', rnd.quality); if (!rnd.fx.ok) ['high', 'ultra'].forEach(k => { $('#b-q-' + k).disabled = true; });
  applyAtmosphere(); loadHDRI(renderer, 'dusk'); selectEgo(egoEntry.id); resetCut(); assetStatus(); refreshEgoOptions();

  /* ---------------- loop ---------------- */
  let last = performance.now(), acc = 0, radarT = 0, hudT = 0;
  const lblA = $('#lblA'), lblB = $('#lblB');
  const qLbl = ['Fog · 가시거리 220 m', 'Rain · 젖은 노면', 'Clear · 낮', 'Sunset · 석양'].map(t => { const d = document.createElement('div'); d.className = 'vlabel'; d.textContent = t; d.hidden = true; $('#app').appendChild(d); return d; });
  const placeQuad = (on, w, h) => qLbl.forEach((d, i) => { d.hidden = !on; if (on) { d.style.left = (i % 2 ? w / 2 + 16 : 16) + 'px'; d.style.top = (i < 2 ? (w < 700 ? h / 2 - 40 : 16) : h / 2 + 16) + 'px'; if (i < 2 && w >= 700) d.style.top = (16 + ($('#info').offsetHeight + 12) * (i === 0 ? 1 : 0)) + 'px'; } });
  const placeLabels = (split, vertical, w, h) => { lblA.hidden = lblB.hidden = !split; if (!split) return; const dockTop = h - dockEl.offsetHeight - 16;
    if (vertical) { lblA.style.left = '16px'; lblA.style.top = (h / 2 - 36) + 'px'; lblB.style.left = '16px'; lblB.style.top = Math.min(dockTop - 34, h - 36) + 'px'; } else { lblA.style.left = '16px'; lblA.style.top = (dockTop - 36) + 'px'; lblB.style.left = (w / 2 + 16) + 'px'; lblB.style.top = (dockTop - 36) + 'px'; } };
  const egoHide = () => [ego.body, splat.group, ...actors.map(a => a.layer.group)];   // the splat is sorted for the main view only; keep it out of the cube probe
  // Inside the cabin the windscreen is seen from both faces: thin it out and calm the screen-space effects.
  function cabinMode(on) {
    if (on === cabOn) return; cabOn = on; cabinView(on);
    GLASS.opacity = on ? .08 : .34; GLASS.envMapIntensity = on ? .25 : 1.5; GLASS.clearcoat = on ? .3 : 1;
    if (rnd.fx.ssr) rnd.fx.ssr.opacity.value = on ? .25 : .85; setBloom(on ? .08 : .2);
  }
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; acc += dt * (sim.timeScale || 1); if (sim.paused) acc = 0;   // timeScale: faster-than-real-time gate test runs
    while (acc >= 1 / 60) { step(1 / 60); sim.simT += 1 / 60; acc -= 1 / 60; }
    place(dt, egoModel, egoYawFlip);
    radarT += dt; if (radarT > 1 / 15 && ui.radar !== 'off') { radarT = 0; if (ui.radar === 'ideal' || ui.radar === 'split') { scan(P_IDEAL, sim.detsA); fill(detA, sim.detsA); } if (ui.radar === 'coarse' || ui.radar === 'split') { scan(P_COARSE, sim.detsB); fill(detB, sim.detsB); } }
    fan.visible = ui.radar !== 'off' && ui.fov && ui.cam !== 'driver' && ui.cam !== 'ivi';
    cabinMode(ui.cam === 'driver' || ui.cam === 'ivi');
    updateCam(dt); if (splat.group.visible) { splat.exposure.value = bg.gain / renderer.toneMappingExposure; splat.update(camera); }
    for (const a of actors) if (a.layer.group.visible && a.v.vis !== false) { actorView(a, dt); a.layer.exposure.value = splat.exposure.value; if (!a.body) a.layer.update(camera); }   // no sorting while the template stands in
    if (window.__sim) { const d = new THREE.Vector3(); camera.getWorldDirection(d); window.__sim.lastCam = { pos: camera.position.toArray(), dir: d.toArray(), ego: ego.grp.position.toArray(), cam: ui.cam, frame: rnd.frame }; }
    if (world.rain.visible || ui.quad) { world.rain.position.copy(camera.position); world.rain.position.y = camera.position.y - 6; world.updateRain(sim.paused ? .016 : dt, Math.cos(ego.hw) * ego.v, -Math.sin(ego.hw) * ego.v); }
    const ep = ego.grp.position, sd = world.sunDir; world.sun.position.set(ep.x + sd.x * 400, ep.y + sd.y * 400, ep.z + sd.z * 400); world.sun.target.position.copy(ep);
    world.sky.position.copy(camera.position); if (photoSky.mesh) { photoSky.mesh.position.copy(camera.position); photoSky.expo.value = splat.exposure.value; } world.clouds.position.x = camera.position.x; world.clouds.position.z = camera.position.z; world.texCloud.offset.set(sim.simT * .0012 + camera.position.x / 9000, sim.simT * .0005 - camera.position.z / 9000);
    iviLive();
    const w = canvas.clientWidth, h = canvas.clientHeight; rnd.frame++;
    const post = !ui.quad && ui.radar !== 'split' && !!rnd.pipeline && rnd.quality !== 'base'; splat.usePost(post); actors.forEach(a => a.layer.usePost(post));
    if (ui.quad) {
      renderer.setScissorTest(true); const hw = w / 2, hh = h / 2; camera.aspect = hw / hh; camera.updateProjectionMatrix(); camera.layers.set(0);
      const pw = atmo.weather, pt = atmo.time;
      for (const [x, y, tk, wk] of [[0, hh, 'day', 'fog'], [hw, hh, 'day', 'rain'], [0, 0, 'day', 'clear'], [hw, 0, 'dusk', 'clear']]) { atmos(renderer, tk, wk, {}); world.rain.visible = wk === 'rain'; renderView(scene, camera, x, y, hw, hh); }
      atmos(renderer, pt, pw, {}); renderer.setScissorTest(false); placeQuad(true, w, h); placeLabels(false);
    } else if (ui.radar === 'split') {
      placeQuad(false); const vert = h > w; renderer.setScissorTest(true);
      for (const [x, y, vw, vh, layer] of (vert ? [[0, h / 2, w, h / 2, 1], [0, 0, w, h / 2, 2]] : [[0, 0, w / 2, h, 1], [w / 2, 0, w / 2, h, 2]])) { camera.aspect = vw / vh; camera.updateProjectionMatrix(); camera.layers.set(0); camera.layers.enable(layer); renderView(scene, camera, x, y, vw, vh); }
      renderer.setScissorTest(false); placeLabels(true, vert, w, h);
    } else {
      camera.aspect = w / h; camera.updateProjectionMatrix(); camera.layers.set(0); if (ui.radar === 'ideal') camera.layers.enable(1); if (ui.radar === 'coarse') camera.layers.enable(2);
      if (!warming) {   // while shaders compile, frames would only queue behind the compiles: keep the last frame
        if (ui.cam !== 'driver' && ui.cam !== 'ivi') updateProbe(scene, ego.grp, egoHide());
        renderMain(scene, camera, w, h);
      }
      ffvUI.afterRender(now); placeLabels(false); placeQuad(false);
    }
    vecuTick();
    hudT += dt; if (hudT > .12) { hudT = 0; hud(); if (!$('#vecu').hidden) { $('#vecuFrame').textContent = JSON.stringify(vecu.lastFrame || vecuFrame(), null, 1).slice(0, 6000); vecuStatus(vecu.state); } }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------------- harness hooks ---------------- */
  window.__sim = {
    shot: (n, o) => shot(n, o), pause: () => { sim.paused = true; }, play: () => { sim.paused = false; }, ui: on => document.body.classList.toggle('clean', !on),
    tune: o => { for (const k in o) { const [tk, key] = k.split('.'); if (PRESETS[tk] && key in PRESETS[tk]) PRESETS[tk][key] = o[k]; else if (WEATHER[tk] && key) WEATHER[tk][key] = o[k]; } applyAtmosphere(); return true; },
    getTune: () => JSON.parse(JSON.stringify({ PRESETS, WEATHER })), getCams: () => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(SHOTS).filter(([, v]) => v.cam).map(([k, v]) => [k, v.cam])))),
    frameInfo: (name, cam) => {
      if (cam) Object.assign(SHOTS[name].cam, cam); if (!(ui.cam === 'shot' && shotCam === SHOTS[name].cam)) shot(name, { freeze: true });
      shotCam = SHOTS[name].cam; camera.fov = shotCam.fov; place(0, egoModel, egoYawFlip); sim.snapCam = true; updateCam(0);
      const w = canvas.clientWidth, h = canvas.clientHeight; camera.aspect = ui.quad ? w / h : ui.radar === 'split' ? (w / 2) / h : w / h; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      const bx = new THREE.Box3(); scene.updateMatrixWorld(true);
      ego.body.traverse(o => { if (o.isMesh && o.visible && !o.isSprite) { let vis = true, q = o; while (q && q !== ego.body) { if (!q.visible) vis = false; q = q.parent; } if (vis) bx.expandByObject(o); } });
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0; const v = new THREE.Vector3();
      for (let i = 0; i < 8; i++) { v.set(i & 1 ? bx.max.x : bx.min.x, i & 2 ? bx.max.y : bx.min.y, i & 4 ? bx.max.z : bx.min.z).project(camera); const X = (v.x + 1) / 2, Y = (1 - v.y) / 2; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
      const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize(); const hp = camera.position.clone().addScaledVector(f, 2400).project(camera); return { x0, x1, y0, y1, hy: (1 - hp.y) / 2 };
    },
    quality: q => { setQuality(q, camera, resize); press('q', rnd.quality); assetStatus(); }, cam: v => onOpt('cam', v), ego: id => selectEgo(id), ivi: set => iviApply(set),
    dbg: () => ({ ego, scene, camera, rnd, world, THREE, refAt, RD1, RD2, roads, ivi, actors }),
    bake: o => { const ex = [world.sky, world.clouds, world.rain, fan, detA, detB, splat.group, ...veh.map(v => v.grp)].filter(Boolean); const b = bakeScene(scene, Object.assign({ exclude: ex }, o || {})); return { n: b.n, b64: packBake(b) }; },
    splat: (url) => loadSplat(url || SPLAT_DEFAULT), backdrop: m => setBackdropMode(m), splatGain: g => { bg.gain = g; }, splatVis: on => { splat.group.visible = on; }, splat3dExp: k => { world.splat3dExp = k; applyAtmosphere(); },
    // alignment nudge (simulator coords, metres / degrees about Y): refine here, then bake into nurec2splat --offset/--yaw
    splatXf: o => { if (o) { const g = splat.group; if ('x' in o) g.position.x = o.x; if ('y' in o) g.position.y = o.y; if ('z' in o) g.position.z = o.z; if ('yaw' in o) g.rotation.y = o.yaw * D2R; } return { x: splat.group.position.x, y: splat.group.position.y, z: splat.group.position.z, yaw: splat.group.rotation.y / D2R }; },
    ready: () => ({ splat: { n: splat.n, sorted: splat.ready, mode: bg.mode, msg: bg.msg, actors: actors.map(a => `${a.layer.mesh.name}@${Object.keys(T).find(k => T[k] === a.v)}`) }, car: !!gltfAsset || gltfFail, hdr: !!(world.hdrState.day && world.hdrState.day !== 'loading'), hdrDusk: world.hdrState.dusk || null, backend: rnd.backend, post: rnd.fx.ok, asset: $('#kAsset').textContent })
  };
  const qs = new URLSearchParams(location.search);
  if (qs.has('ffv')) {   // ?ffv opens the console with a sample; ?ffv=FEAT-000xx picks that sample when it exists
    const want = qs.get('ffv'), sel = $('#ffvSampleSel'); if (want && [...sel.options].some(o => o.value === want)) sel.value = want;
    ffvUI.open(true); $('#ffvSample').click();
  }
  if (qs.has('splat')) loadSplat(qs.get('splat') || SPLAT_DEFAULT);
  // ?aspl=<file>: a variant of the scene's splats (e.g. tools/aspl_clean.py output)
  else if (SCENE) { loadPhotoSky(SCENE.name); loadSplat(`./splat/${qs.get('aspl') || SCENE.name}.aspl`, null, [0, .9]).then(() => { if (!location.hash) shot('scene'); return loadActors(SCENE.name); }); }
  const h0 = (location.hash || '').slice(1); if (SHOTS[h0]) setTimeout(() => shot(h0), 50); if (h0 === 'vecu') openDrawer('vecu'); if (h0 === 'ivi') openDrawer('ivip');
}
main().catch(e => { console.error(e); showErr('초기화 오류: ' + (e.message || e)); });
