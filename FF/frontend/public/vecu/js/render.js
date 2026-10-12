// Renderer: WebGPU (WebGL 2 fallback), AgX tone mapping, cascaded shadows, reflection probe for the ego,
// and a TSL post pipeline: GTAO → SSR → bloom → TRAA.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, velocity, metalness, roughness, sample, directionToColor, colorToDirection, screenUV, vec2 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { IS_MOBILE } from './util.js';
import { enableCSM, world, crownMeshes } from './world.js';

export const rnd = { renderer: null, backend: 'none', pipeline: null, quality: IS_MOBILE ? 'high' : 'ultra', fx: {}, probe: null, probeRT: null, probeEvery: 2, probeSlow: 1, frame: 0 };

export async function initRenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: !navigator.gpu });
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = .7;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  rnd.renderer = renderer; rnd.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  return renderer;
}

/** Cube-map probe around the ego: car paint and glass reflect the actual surroundings. */
export function initProbe(scene) {
  const rt = new THREE.CubeRenderTarget(IS_MOBILE ? 96 : 160); rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter; rt.texture.magFilter = THREE.LinearFilter;
  rnd.probeRT = rt; rnd.probe = new THREE.CubeCamera(.6, 900, rt); rnd.probe.layers.set(0);
  // Materials get the PMREM of the cube, rebuilt after every probe render. The cube render target itself cannot be used
  // as envMap: three only builds PMREMs from cube textures with six images, so it gave no light at all (black cabin,
  // reflection-less paint).
  rnd.pmrem = new THREE.PMREMGenerator(rnd.renderer); rnd.probeEnv = rnd.pmrem.fromCubemap(rt.texture);
  return rnd.probeEnv.texture;
}
export function updateProbe(scene, egoGroup, hideList) {
  if (!rnd.probe || rnd.quality === 'base' || (rnd.frame % (rnd.probeEvery * rnd.probeSlow))) return;   // probeSlow: fewer updates when little 3D is reflected
  const vis = []; for (const o of hideList) { if (o.visible) { vis.push(o); o.visible = false; } }
  rnd.probe.position.copy(egoGroup.position).y += .9; rnd.probe.update(rnd.renderer, scene);
  rnd.pmrem.fromCubemap(rnd.probeRT.texture, rnd.probeEnv);
  for (const o of vis) o.visible = true;
}

/** Compile the pipelines of the probe's cube target ahead of its first update (hideList: objects kept out of the probe). */
export async function compileProbe(scene, hideList) {
  if (!rnd.probe || rnd.quality === 'base') return;
  const r = rnd.renderer, prev = r.getRenderTarget(), vis = hideList.filter(o => o.visible); vis.forEach(o => { o.visible = false; });
  try { r.setRenderTarget(rnd.probeRT, 0); await r.compileAsync(scene, rnd.probe.children[0]); } finally { r.setRenderTarget(prev); vis.forEach(o => { o.visible = true; }); }
}
export function buildPipeline(scene, camera) {
  const renderer = rnd.renderer, fx = rnd.fx;
  try {
    const rp = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output: output, normal: directionToColor(normalView), metalrough: vec2(metalness, roughness), velocity: velocity }));
    const color = scenePass.getTextureNode('output'), depth = scenePass.getTextureNode('depth'), nrmTex = scenePass.getTextureNode('normal'), mr = scenePass.getTextureNode('metalrough'), vel = scenePass.getTextureNode('velocity');
    scenePass.getTexture('normal').type = THREE.UnsignedByteType; scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;
    const nrm = sample(uv => colorToDirection(nrmTex.sample(uv)));
    const aoPass = ao(depth, nrm, camera); aoPass.resolutionScale = IS_MOBILE ? .5 : .75; aoPass.radius.value = .35; aoPass.distanceExponent.value = 1.2; aoPass.thickness.value = .9;
    const ssrPass = ssr(color, depth, nrm, mr.r, mr.g, camera); ssrPass.resolutionScale = .5; ssrPass.maxDistance.value = 40; ssrPass.thickness.value = .25; ssrPass.opacity.value = .85; ssrPass.quality.value = .5;
    const aoTex = aoPass.getTextureNode().sample(screenUV).r;
    const litUltra = color.mul(aoTex).add(ssrPass.rgb), litHigh = color.mul(aoTex);
    const bloomU = bloom(litUltra, .2, .55, 1.6), bloomH = bloom(litHigh, .2, .55, 1.6);
    fx.ultra = traa(litUltra.add(bloomU), depth, vel, camera); fx.high = traa(litHigh.add(bloomH), depth, vel, camera);
    // contrast-adaptive sharpening (noise-aware) for captured scenes: the splat road is reconstructed at ~10 cm and TRAA
    // softens it further; off for the procedural world
    fx.ultraS = sharpen(fx.ultra, .7, true); fx.highS = sharpen(fx.high, .7, true);   // 0 = strongest, 2 = none
    fx.bloomU = bloomU; fx.bloomH = bloomH; fx.ao = aoPass; fx.ssr = ssrPass; fx.scenePass = scenePass;
    rp.outputNode = fx.ultra; rnd.pipeline = rp; fx.ok = true;
  } catch (e) { console.warn('post-processing unavailable', e); fx.ok = false; rnd.pipeline = null; }
  return fx.ok;
}

export function setQuality(q, camera, onResize) {
  if (!rnd.fx.ok && q !== 'base') q = 'base';
  rnd.quality = q;
  const ultra = q === 'ultra';
  if (rnd.pipeline) rnd.pipeline.outputNode = rnd.sharp ? (ultra ? rnd.fx.ultraS : rnd.fx.highS) : (ultra ? rnd.fx.ultra : rnd.fx.high);
  rnd.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, IS_MOBILE ? (q === 'base' ? 1.5 : 1.25) : (ultra ? 1.5 : 1.75)));
  enableCSM(camera, q !== 'base');
  rnd.probeEvery = ultra ? 2 : 4;
  onResize && onResize();
}
export function setSharpen(on) {
  rnd.sharp = !!on; if (!rnd.pipeline || !rnd.fx.ok) return;
  const ultra = rnd.quality === 'ultra', node = rnd.sharp ? (ultra ? rnd.fx.ultraS : rnd.fx.highS) : (ultra ? rnd.fx.ultra : rnd.fx.high);
  if (rnd.pipeline.outputNode !== node) { rnd.pipeline.outputNode = node; rnd.pipeline.needsUpdate = true; }
}
export function setBloom(strength) { if (rnd.fx.bloomU) { rnd.fx.bloomU.strength.value = strength; rnd.fx.bloomH.strength.value = strength; } }

/** Full-frame render (post when quality allows). */
export function renderMain(scene, camera, w, h) {
  const r = rnd.renderer; r.setViewport(0, 0, w, h);
  if (rnd.pipeline && rnd.quality !== 'base') rnd.pipeline.render(); else r.render(scene, camera);
}
/** Direct render into a scissor rectangle (split / quad views, no post). */
export function renderView(scene, camera, x, y, w, h) { const r = rnd.renderer; r.setViewport(x, y, w, h); r.setScissor(x, y, w, h); r.render(scene, camera); }
export const hideForProbe = () => [...crownMeshes.filter(() => false)];
