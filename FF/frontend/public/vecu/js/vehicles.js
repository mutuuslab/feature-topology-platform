// Vehicles: procedural exteriors (sedan / SUV / van / truck / motorcycle), a detailed cabin with IVI screens,
// wheels, paint, lamps, the Hyundai ego catalog and glTF import.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, R, rng, hash1, vnoise, col, canvasTex, normalTex, std, box } from './util.js';

/* ---------------- shared materials ---------------- */
const flakeTex = normalTex(128, (x, y) => hash1(x * 3.7 + y * 91.3) * .5 + .25 * vnoise(x * .6, y * .6), 1.4); flakeTex.repeat.set(26, 26);
const leatherN = normalTex(256, (x, y) => .5 + .5 * vnoise(x * .9, y * .9) * .6 + .4 * (hash1(x * 1.3 + y * 7.7) - .5) * .4, 1.2); leatherN.repeat.set(3, 3);
export const GLASS = new THREE.MeshPhysicalMaterial({ color: col('#131a22'), metalness: 0, roughness: .03, clearcoat: 1, clearcoatRoughness: .03, transparent: true, opacity: .34, depthWrite: false, envMapIntensity: 1.5, side: THREE.DoubleSide });
export const CHROME = std('#dfe3e7', 1, .14, { envMapIntensity: 1.3 });
export const TIRE = std('#1b1c1e', 0, .9), RIM = std('#c9cdd2', .95, .22, { envMapIntensity: 1.2 }), DARK = std('#15171a', .25, .72), RUBBER = std('#0d0e10', 0, .95);
const DISC = std('#8b8f94', 1, .45), CALIPER = std('#b3151d', .3, .5);
// cabin palette: dark grey upper trim, dove-grey lower trim and seats, light fabric headliner (two-tone, as in current EVs)
const LEATHER = new THREE.MeshStandardMaterial({ color: col('#55585e'), roughness: .62, metalness: 0, normalMap: leatherN, normalScale: new THREE.Vector2(.5, .5) });
const LEATHER2 = new THREE.MeshStandardMaterial({ color: col('#a49d93'), roughness: .66, metalness: 0, normalMap: leatherN, normalScale: new THREE.Vector2(.5, .5) });
const DASH = std('#2f3237', 0, .78, { normalMap: leatherN, normalScale: new THREE.Vector2(.18, .18) }), WHEEL = std('#1f2125', 0, .55, { normalMap: leatherN, normalScale: new THREE.Vector2(.4, .4) }), DASH_LOW = std('#8a8780', 0, .86), PIANO = new THREE.MeshPhysicalMaterial({ color: col('#0a0b0d'), metalness: .1, roughness: .08, clearcoat: 1, clearcoatRoughness: .05 });
const ALLOY = std('#5f646b', .8, .38), UNDER = std('#16171a', 0, .95);   // dark aero alloy (glb ego), underbody
const ALU = std('#b4b9bf', .9, .32), FABRIC = std('#b3b0a8', 0, .96), CARPET = std('#2a2b2e', 0, 1), SCREEN_OFF = std('#06070a', .2, .15);
const AMBIENT = new THREE.MeshStandardMaterial({ color: col('#0b1a2a'), emissive: col('#3aa0ff'), emissiveIntensity: 1.2, roughness: .5 });

export function paintMat(hex) { return new THREE.MeshPhysicalMaterial({ color: col(hex), metalness: .32, roughness: .36, clearcoat: 1, clearcoatRoughness: .045, normalMap: flakeTex, normalScale: new THREE.Vector2(.07, .07), envMapIntensity: 1 }); }
export function lamps(base) {
  const tail = new THREE.MeshStandardMaterial({ color: col('#4a0a0a'), emissive: col('#ff2a1a'), emissiveIntensity: base, roughness: .25, envMapIntensity: .8 });
  const head = new THREE.MeshStandardMaterial({ color: col('#d8dde2'), emissive: col('#e9f1ff'), emissiveIntensity: base * .6, roughness: .15, metalness: .3, envMapIntensity: 1 });
  return { tail, head };
}
const glowTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
export function setGlow(sp, op) { sp.material.opacity = op; sp.visible = op > .02; }
export function glow(c, sc, x, y, z) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.set(sc, sc, 1); sp.position.set(x, y, z); sp.visible = false; return sp; }
const shadowTex = canvasTex(128, 64, (g, w, h) => { const gr = g.createRadialGradient(64, 32, 4, 64, 32, 34); gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(.7, 'rgba(0,0,0,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
export function contactShadow(L, W) { const m = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.08, W * 1.25), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .025; m.renderOrder = 1; m.userData.contact = true; return m; }
export function plateTex(txt) { return canvasTex(256, 56, (g, w, h) => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#1d3f9a'; g.fillRect(5, 5, 24, h - 10); g.fillStyle = '#111'; g.font = 'bold 34px "Helvetica Neue",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2 + 12, h / 2 + 2); }); }

/* ---------------- wheel ---------------- */
export function wheel(r, w, spokes = 10, rimMat = RIM) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 36).rotateX(Math.PI / 2), TIRE); t.castShadow = true; g.add(t);
  const rr = r * .66, prof = [new THREE.Vector2(rr * .35, -w * .5), new THREE.Vector2(rr, -w * .5), new THREE.Vector2(rr, -w * .36), new THREE.Vector2(rr * .9, -w * .28), new THREE.Vector2(rr * .9, w * .1), new THREE.Vector2(rr, w * .16), new THREE.Vector2(rr, w * .5), new THREE.Vector2(rr * .35, w * .5)];
  const rim = new THREE.Mesh(new THREE.LatheGeometry(prof, 32).rotateX(Math.PI / 2), rimMat); g.add(rim);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(rr * .38, rr * .38, w * .3, 16).rotateX(Math.PI / 2), rimMat); dish.position.z = -w * .25; g.add(dish);
  for (let i = 0; i < spokes; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(rr * 1.75, r * .09, w * .16), rimMat); sp.rotation.z = i * Math.PI / spokes; sp.position.z = -w * .22; g.add(sp); }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr * .78, rr * .78, .02, 24).rotateX(Math.PI / 2), DISC); g.add(disc);
  const cal = new THREE.Mesh(new THREE.BoxGeometry(rr * .5, rr * .25, .05), CALIPER); cal.position.set(-rr * .45, rr * .35, .02); cal.rotation.z = .5; g.add(cal);
  g.userData.outward = 1; return g;
}

/* ---------------- interior ---------------- */
/** Box with rounded edges (seat cushions, console, door cards). */
function rbox(x, y, z, m, r = .03) { const me = new THREE.Mesh(new RoundedBoxGeometry(x, y, z, 3, Math.min(r, x / 2, y / 2, z / 2)), m); me.castShadow = true; return me; }
function bar(a, b, r, mat) { const d = new THREE.Vector3().subVectors(b, a), l = d.length(); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 8), mat); m.position.copy(a).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; return m; }
/** Cabin for the template bodies. `s` = {L,W,H,k,belt,roof,dashTop,kind}. Returns {grp, screens:{cluster,center}} */
export function buildInterior(s, ivi) {
  const { L, W, H, k } = s, g = new THREE.Group(), DZ = -.37; // driver side (left-hand drive) = -z
  const belt = s.belt, roofY = s.roof, cab0 = -.34 * L, cab1 = .215 * L, cw = W - .2;
  const floor = box(cab1 - cab0, .04, cw, CARPET); floor.position.set((cab0 + cab1) / 2, .34, 0); floor.receiveShadow = true; g.add(floor);
  const tunnel = box(cab1 - cab0 - .4, .14, .34, CARPET); tunnel.position.set((cab0 + cab1) / 2 + .1, .4, 0); g.add(tunnel);
  // dashboard
  const ds = new THREE.Shape(); const X0 = .055 * L, X1 = .22 * L, Y0 = .52 * k, Y1 = s.dashTop;
  ds.moveTo(X0, Y0); ds.lineTo(X0, .78 * k); ds.quadraticCurveTo(X0 + .005 * L, .84 * k, X0 + .03 * L, .86 * k); ds.lineTo(X0 + .11 * L, Y1); ds.lineTo(X1 - .02 * L, Y1); ds.quadraticCurveTo(X1, Y1, X1, Y1 - .06 * k); ds.lineTo(X1, Y0); ds.lineTo(X0, Y0);
  const dash = new THREE.Mesh(new THREE.ExtrudeGeometry(ds, { depth: cw, bevelEnabled: true, bevelThickness: .02, bevelSize: .015, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, -cw / 2), DASH); dash.castShadow = true; dash.receiveShadow = true; g.add(dash);
  const trim = box(.004, .05, cw * .9, ALU); trim.position.set(X0 - .003, .70 * k, 0); g.add(trim);
  const cowl = box(.07 * L, .012, cw * 1.02, RUBBER); cowl.position.set(X1 + .035 * L, s.belt + .015, 0); g.add(cowl);   // wiper cowl in front of the dash (black, as on real cars)
  const inlay = rbox(.012, .07, cw * .9, LEATHER2, .005); inlay.position.set(X0 - .004, .63 * k, 0); g.add(inlay);   // trim band under the vents
  const lower = rbox(.05, .18 * k, cw * .92, DASH_LOW, .02); lower.position.set(X0 + .02, .5 * k, 0); g.add(lower);
  const amb = box(.003, .006, cw * .88, AMBIENT); amb.position.set(X0 - .003, .745 * k, 0); g.add(amb);
  const face = (m, dir) => { m.lookAt(m.position.clone().add(dir)); m.userData.n = dir.clone().normalize(); };
  const bezel = (plane, w, h, mat) => { const b = box(w, h, .02, mat); b.position.copy(plane.position).addScaledVector(plane.userData.n, -.012); b.rotation.copy(plane.rotation); return b; };
  // cluster (12.3") standing on the dash behind the wheel, with a hood
  const cl = new THREE.Mesh(new THREE.PlaneGeometry(.315, .105), ivi ? new THREE.MeshBasicMaterial({ map: ivi.texCl, color: new THREE.Color(2.4, 2.4, 2.4), toneMapped: true }) : SCREEN_OFF);
  cl.position.set(X0 + .022 * L, .905 * k, DZ); face(cl, new THREE.Vector3(-1, .16, 0)); g.add(cl);
  g.add(bezel(cl, .36, .14, PIANO));
  // no separate cluster hood: both screens sit in one integrated display housing (added below, once both are placed)
  // centre display (14.6" 16:9 for Pleos, 12.3" otherwise), angled toward the driver
  const big = s.platform === 'Pleos Connect', sw = big ? .323 : .29, sh = big ? .182 : .13;
  const cc = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), ivi ? new THREE.MeshBasicMaterial({ map: ivi.texCc, color: new THREE.Color(2.4, 2.4, 2.4), toneMapped: true }) : SCREEN_OFF);
  cc.position.set(X0 + .018 * L, .9 * k, .02); face(cc, new THREE.Vector3(-1, .12, -.22)); g.add(cc);
  g.add(bezel(cc, sw + .05, sh + .04, PIANO));
  // integrated display housing from the cluster to the centre screen: a rounded shell behind both panels, a stem down
  // into the dash, so neither screen floats
  { const zA = cl.position.z - .2, zB = cc.position.z + sw / 2 + .03, hz = zB - zA, hy = Math.max(sh, .105) + .06;
    const shell = rbox(.04, hy, hz, DASH, .015); shell.position.set(Math.max(cl.position.x, cc.position.x) + .045, (cl.position.y + cc.position.y) / 2, (zA + zB) / 2); g.add(shell);   // behind both screens
    const stem = rbox(.08, .1, hz * .7, DASH, .02); stem.position.set(shell.position.x + .03, shell.position.y - hy / 2 - .02, shell.position.z); g.add(stem); }
  const glassC = new THREE.Mesh(new THREE.PlaneGeometry(sw + .04, sh + .03), new THREE.MeshPhysicalMaterial({ color: col('#111'), transparent: true, opacity: .1, roughness: .02, clearcoat: 1, depthWrite: false, envMapIntensity: .6 })); glassC.position.copy(cc.position).addScaledVector(cc.userData.n, .003); glassC.rotation.copy(cc.rotation); g.add(glassC);
  // vents + hazard / climate strip under the display
  for (const z of [-.62, -.2, .2, .62]) { const v = box(.02, .04, .12, DARK); v.position.set(X0 - .005, .64 * k, z * cw / 2 * .9); g.add(v); for (let i = 0; i < 4; i++) { const fin = box(.012, .035, .003, ALU); fin.position.set(X0 - .012, .64 * k, z * cw / 2 * .9 - .045 + i * .03); g.add(fin); } }
  const strip = box(.015, .03, .34, PIANO); strip.position.set(X0 - .004, .58 * k, .02); g.add(strip);
  // steering wheel + column
  const sw2 = new THREE.Group(); sw2.position.set(X0 - .03 * L, .74 * k, DZ); sw2.rotation.set(0, 0, -.38);
  // two-spoke wheel: leather rim, rounded rectangular hub, spokes with button pads
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.185, .021, 14, 48).rotateY(Math.PI / 2), WHEEL); sw2.add(ring);
  const hub = rbox(.05, .1, .14, WHEEL, .03); sw2.add(hub);
  const hubFace = rbox(.006, .07, .1, PIANO, .02); hubFace.position.x = -.026; sw2.add(hubFace);
  for (const sgn of [-1, 1]) { const sp = rbox(.035, .045, .1, WHEEL, .018); sp.position.set(0, -.01, sgn * .12); sw2.add(sp);
    const pad = rbox(.006, .03, .05, PIANO, .01); pad.position.set(-.019, -.01, sgn * .11); sw2.add(pad); }
  const low = rbox(.03, .09, .035, WHEEL, .014); low.position.set(0, -.12, 0); sw2.add(low);
  sw2.traverse(o => { if (o.isMesh) o.castShadow = true; }); g.add(sw2);
  g.add(bar(new THREE.Vector3(X0 - .03 * L, .74 * k, DZ), new THREE.Vector3(X0 + .01 * L, .68 * k, DZ), .028, DASH));
  const colCover = box(.12, .1, .12, DASH); colCover.position.set(X0 - .005 * L, .69 * k, DZ); g.add(colCover);
  // seats
  const seat = (x, z, w) => { const sg = new THREE.Group(); const cush = rbox(.52, .13, w, LEATHER, .05); cush.position.set(x, .56, z); sg.add(cush);
    const back = rbox(.13, .64, w * .96, LEATHER, .05); back.position.set(x - .3, .9, z); back.rotation.z = .22; sg.add(back);
    const pad = rbox(.03, .5, w * .5, LEATHER2, .012); pad.position.set(x - .23, .9, z); pad.rotation.z = .22; sg.add(pad);   // centre panel of the backrest
    const bol = rbox(.5, .07, .07, LEATHER, .03); bol.position.set(x, .62, z + w / 2 - .035); sg.add(bol); const bol2 = bol.clone(); bol2.position.z = z - w / 2 + .035; sg.add(bol2);
    const hr = rbox(.1, .16, .26, LEATHER, .045); hr.position.set(x - .42, 1.3, z); sg.add(hr); sg.add(bar(new THREE.Vector3(x - .38, 1.18, z), new THREE.Vector3(x - .4, 1.24, z), .01, ALU));
    const rail = box(.5, .05, .08, DARK); rail.position.set(x, .44, z); sg.add(rail); sg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return sg; };
  g.add(seat(-.03 * L, DZ, .5), seat(-.03 * L, -DZ, .5));
  const rear = new THREE.Group(); const rc = rbox(.5, .14, cw * .9, LEATHER, .05); rc.position.set(-.27 * L, .56, 0); rear.add(rc); const rb = rbox(.14, .6, cw * .9, LEATHER, .05); rb.position.set(-.32 * L, .88, 0); rb.rotation.z = .25; rear.add(rb);
  for (const z of [-.33, 0, .33]) { const hr = rbox(.1, .13, .22, LEATHER, .04); hr.position.set(-.4 * L, 1.26, z); rear.add(hr); } rear.traverse(o => { if (o.isMesh) o.castShadow = true; }); g.add(rear);
  // centre console
  const con = rbox(.5 * (X0 - cab0), .2, .3, DASH_LOW, .04); con.position.set((X0 + cab0 * .4) / 2 + .02 * L, .66, 0); g.add(con);
  const conTop = rbox(.5 * (X0 - cab0) * .96, .02, .26, PIANO, .008); conTop.position.set(con.position.x, .765, 0); g.add(conTop);
  const arm = rbox(.3, .07, .22, LEATHER2, .03); arm.position.set(-.04 * L, .79, 0); g.add(arm);
  const shifter = bar(new THREE.Vector3(.03 * L, .76, -.06), new THREE.Vector3(.03 * L, .84, -.06), .012, ALU); g.add(shifter); const knob = new THREE.Mesh(new THREE.SphereGeometry(.03, 14, 10), PIANO); knob.position.set(.03 * L, .86, -.06); g.add(knob);
  for (const z of [.05, .13]) { const cup = new THREE.Mesh(new THREE.TorusGeometry(.038, .006, 8, 20).rotateX(Math.PI / 2), ALU); cup.position.set(-.02 * L, .765, z); g.add(cup); }
  // door cards + armrests + pillars
  for (const sgn of [-1, 1]) {
    const z = sgn * (W / 2 - .09); const card = rbox(cab1 - cab0 - .05, belt - .36, .05, DASH_LOW, .02); card.position.set((cab0 + cab1) / 2, .36 + (belt - .36) / 2, z); g.add(card);
    const rail = rbox(cab1 - cab0 - .08, .07, .07, DASH, .025); rail.position.set((cab0 + cab1) / 2, belt - .03, z - sgn * .02); g.add(rail);
    const arm2 = rbox(.5, .05, .1, LEATHER2, .02); arm2.position.set(.02 * L, .72, z - sgn * .05); g.add(arm2);
    const handle = box(.12, .02, .015, ALU); handle.position.set(.1 * L, .83, z - sgn * .03); g.add(handle);
    const spk = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .01, 24).rotateX(Math.PI / 2), DARK); spk.position.set(.1 * L, .48, z - sgn * .028); g.add(spk);
    const pod = rbox(.14, .015, .05, PIANO, .006); pod.position.set(-.02 * L, .755, z - sgn * .07); g.add(pod);
    const amb2 = box(.6, .004, .01, AMBIENT); amb2.position.set(.02 * L, .78, z - sgn * .035); g.add(amb2);
    const ap = bar(new THREE.Vector3(X1 - .01 * L, belt, sgn * (W / 2 - .12)), new THREE.Vector3(.05 * L, roofY - .02, sgn * (W / 2 - .17)), .026, FABRIC); g.add(ap);
    const bp = bar(new THREE.Vector3(-.09 * L, belt, sgn * (W / 2 - .1)), new THREE.Vector3(-.1 * L, roofY - .02, sgn * (W / 2 - .13)), .03, FABRIC); g.add(bp);
    const cp = bar(new THREE.Vector3(-.3 * L, belt, sgn * (W / 2 - .12)), new THREE.Vector3(-.22 * L, roofY - .02, sgn * (W / 2 - .16)), .026, FABRIC); g.add(cp);
  }
  // headliner, rear shelf, mirror, visors
  // spans the whole cabin (windscreen header to rear window) so the painted roof shell is never seen from inside
  const head = box((cab1 - cab0) * .98, .02, cw * .94, FABRIC); head.position.set((cab0 + cab1) / 2, roofY - .065, 0); g.add(head);   // below the inner face of the roof shell
  const shelf = box(.12 * L, .02, cw * .9, CARPET); shelf.position.set(-.4 * L, belt - .02, 0); g.add(shelf);
  g.add(bar(new THREE.Vector3(.07 * L + .01, roofY - .095, 0), new THREE.Vector3(.07 * L + .03, roofY - .06, 0), .009, DASH_LOW));   // mirror stalk
  const mir = rbox(.035, .065, .23, PIANO, .015); mir.position.set(.07 * L, roofY - .12, 0); g.add(mir); const mirGlass = new THREE.Mesh(new THREE.PlaneGeometry(.2, .05), CHROME); mirGlass.position.set(.07 * L - .016, roofY - .12, 0); mirGlass.rotation.y = -Math.PI / 2; g.add(mirGlass);
  for (const z of [DZ, -DZ]) { const vis = rbox(.16, .018, .3, FABRIC, .008); vis.position.set(.09 * L, roofY - .085, z); g.add(vis); }
  const overhead = rbox(.16, .03, .22, DASH_LOW, .012); overhead.position.set(.05 * L, roofY - .085, 0); g.add(overhead);   // map lights / SOS console
  for (const z of [-.05, .05]) { const lens = rbox(.05, .005, .04, ALU, .004); lens.position.set(.05 * L, roofY - .101, z); g.add(lens); }
  for (const sgn of [-1, 1]) { const grip = rbox(.18, .025, .03, DASH_LOW, .012); grip.position.set(-.12 * L, roofY - .1, sgn * (W / 2 - .2)); g.add(grip); }   // grab handles
  for (const [x, z] of [[.1 * L, DZ], [.1 * L, -DZ], [-.2 * L, DZ], [-.2 * L, -DZ]]) { const mat = rbox(.4, .012, .42, RUBBER, .02); mat.position.set(x, .365, z); g.add(mat); }   // floor mats
  for (const z of [DZ - .08, DZ + .06]) { const ped = box(.03, .1, .06, RUBBER); ped.position.set(.15 * L, .45, z); ped.rotation.z = .4; g.add(ped); }
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  return { grp: g, cluster: cl, center: cc, eye: new THREE.Vector3(-.075 * L, lerp(1.13, 1.3, (H - 1.42) / .4), DZ) };
}

/* ---------------- exteriors ---------------- */
/* Hollow glass canopy: outer profile minus an inset profile, plus flat side panes (so the cabin is not filled with glass). */
function canopy(outer, gw, inset, bevel) {
  const pts = outer.getPoints(24), belt = Math.min(...pts.map(p => p.y)) + .003;
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);
  // arch = profile without its bottom (belt) edge; the shell is the arch minus an inset arch, open at the bottom
  let arch = pts.filter((p, i) => p.y > belt || i === 0 || i === pts.length - 1); if (arch[arch.length - 1].y <= belt && arch[arch.length - 2].y <= belt) arch.pop();
  const inner = arch.map(p => { const q = p.clone().sub(c).multiplyScalar(1 - inset).add(c); if (p.y <= belt) q.y = p.y; return q; });
  const shell = new THREE.Shape([...arch, ...inner.slice().reverse()]);
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shell, { depth: gw, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .4, bevelSegments: 2, curveSegments: 16 }).translate(0, 0, -gw / 2), GLASS); m.castShadow = true; g.add(m);
  for (const sgn of [-1, 1]) { const pane = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(inner), 12), GLASS); pane.position.z = sgn * gw / 2; g.add(pane); }
  return g;
}

const seam = (grp, x, y0, y1, z, mat) => { const m = box(.012, y1 - y0, .006, mat || RUBBER); m.position.set(x, (y0 + y1) / 2, z); grp.add(m); };
export function buildSedan(o) {
  const grp = new THREE.Group(), L = o.L, W = o.W, H = o.H, k = H / 1.46, wb = o.wb, P = (fx, y) => [fx * L, y * k];
  const paint = paintMat(o.color);
  const sh = new THREE.Shape(), ac = .37, ar = .43, a0 = Math.asin((.26 - ac) / ar);
  sh.moveTo(-L / 2 + .04, .27); sh.lineTo(...P(-.5, .52)); sh.lineTo(...P(-.497, .8)); sh.quadraticCurveTo(...P(-.495, .97), ...P(-.45, .99));
  sh.lineTo(...P(-.33, 1.0)); if (o.interior) { sh.lineTo(-.33 * L, .40); sh.lineTo(.215 * L, .40); sh.lineTo(...P(.215, .99)); } sh.lineTo(...P(.21, .99)); sh.quadraticCurveTo(...P(.34, .965), ...P(.465, .85)); sh.quadraticCurveTo(...P(.505, .8), ...P(.5, .62));
  sh.lineTo(...P(.49, .36)); sh.lineTo(L / 2 - .06, .26);
  sh.absarc(wb / 2, ac, ar, a0, Math.PI - a0, false); sh.absarc(-wb / 2, ac, ar, a0, Math.PI - a0, false); sh.lineTo(-L / 2 + .04, .27);
  const dz = W - .16, body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: dz, bevelEnabled: true, bevelThickness: .09, bevelSize: .055, bevelSegments: 4, curveSegments: 24 }).translate(0, 0, -dz / 2), paint);
  body.castShadow = true; body.receiveShadow = true; grp.add(body);
  if (o.interior) for (const s of [-1, 1]) { const door = box(.545 * L, .985 * k - .40, .1, paint); door.position.set(-.0575 * L, (.40 + .985 * k) / 2, s * (W / 2 - .04)); door.castShadow = true; grp.add(door); }
  const gs = new THREE.Shape(); gs.moveTo(...P(-.335, .985)); gs.quadraticCurveTo(...P(-.27, 1.25), ...P(-.19, 1.4)); gs.quadraticCurveTo(...P(-.07, 1.465), ...P(.05, 1.46)); gs.quadraticCurveTo(...P(.12, 1.44), ...P(.215, .985)); gs.lineTo(...P(-.335, .985));
  const gw = W * .82 - .1; if (o.interior) grp.add(canopy(gs, gw, .07, .05)); else { const glass = new THREE.Mesh(new THREE.ExtrudeGeometry(gs, { depth: gw, bevelEnabled: true, bevelThickness: .05, bevelSize: .02, bevelSegments: 2, curveSegments: 16 }).translate(0, 0, -gw / 2), GLASS); glass.castShadow = true; grp.add(glass); }
  const rs = new THREE.Shape(); rs.moveTo(...P(-.205, 1.375)); rs.quadraticCurveTo(...P(-.07, 1.475), ...P(.05, 1.47)); rs.quadraticCurveTo(...P(.11, 1.455), ...P(.14, 1.42)); rs.lineTo(...P(.13, 1.395)); rs.quadraticCurveTo(...P(.05, 1.43), ...P(-.19, 1.355));
  const rw = W * .82 - .06, roof = new THREE.Mesh(new THREE.ExtrudeGeometry(rs, { depth: rw, bevelEnabled: true, bevelThickness: .04, bevelSize: .012, bevelSegments: 2, curveSegments: 12 }).translate(0, 0, -rw / 2), paint); roof.castShadow = true; grp.add(roof);
  const lm = lamps(.35); const glows = [];
  for (const s of [-1, 1]) {
    glows.push(glow(0xff3322, .9, -L / 2 - .08, .9 * k, s * (W / 2 - .32)), glow(0xfff1d0, 1.3, L / 2 + .12, .74 * k, s * (W / 2 - .3)));
    const hh = box(.1, .11 * k, .5, DARK); hh.position.set(L / 2 - .02, .74 * k, s * (W / 2 - .3)); grp.add(hh);
    const hl = box(.06, .06 * k, .42, lm.head); hl.position.set(L / 2 + .03, .74 * k, s * (W / 2 - .3)); grp.add(hl);
    const proj = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .04, 16).rotateZ(Math.PI / 2), CHROME); proj.position.set(L / 2 + .035, .74 * k, s * (W / 2 - .38)); grp.add(proj);
    const tl = box(.06, .1 * k, .46, lm.tail); tl.position.set(-L / 2 - .005, .88 * k, s * (W / 2 - .32)); grp.add(tl);
    const tl2 = box(.3, .08 * k, .04, lm.tail); tl2.position.set(-L / 2 + .18, .88 * k, s * (W / 2 + .012)); grp.add(tl2);
    const mir = box(.18, .12, .16, paint); mir.position.set(.21 * L - .12, 1.04 * k, s * (W / 2 + .08)); grp.add(mir); const mirG = new THREE.Mesh(new THREE.PlaneGeometry(.1, .14), CHROME); mirG.position.set(.21 * L - .21, 1.04 * k, s * (W / 2 + .08)); mirG.rotation.y = Math.PI / 2; grp.add(mirG);
    const sill = box(wb - .95, .07, .03, DARK); sill.position.set(0, .33, s * (W / 2 + .012)); grp.add(sill);
    const trim = box(wb * .95, .025, .02, CHROME); trim.position.set(-.05 * L, .985 * k + .01, s * (W / 2 - .035)); grp.add(trim);
    const crease = box(L * .62, .018, .012, std(o.color, .4, .3)); crease.position.set(-.02 * L, .73 * k, s * (W / 2 + .03)); grp.add(crease);
    const bpil = box(.06, .45 * k, .01, PIANO); bpil.position.set(-.09 * L, 1.2 * k, s * (W * .41 + .01)); bpil.rotation.z = .1; grp.add(bpil);
    for (const x of [.17 * L, -.08 * L]) { seam(grp, x, .36, .97 * k, s * (W / 2 + .034)); const hd = box(.14, .03, .02, CHROME); hd.position.set(x - .1, .8 * k, s * (W / 2 + .035)); grp.add(hd); }
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .1, 12).rotateZ(Math.PI / 2), CHROME); ex.position.set(-L / 2 - .02, .3, s * (W / 2 - .3)); grp.add(ex);
  }
  const grille = box(.06, .2, W * .52, DARK); grille.position.set(L / 2 + .03, .47, 0); grp.add(grille);
  const gtrim = box(.05, .03, W * .54, CHROME); gtrim.position.set(L / 2 + .045, .58, 0); grp.add(gtrim);
  const intake = box(.05, .1, W * .4, RUBBER); intake.position.set(L / 2 + .02, .31, 0); grp.add(intake);
  const drl = box(.03, .02, W * .78, lm.head); drl.position.set(L / 2 + .055, .80 * k, 0); grp.add(drl);
  const lbar = box(.03, .025, W * .6, lm.tail); lbar.position.set(-L / 2 - .025, .93 * k, 0); grp.add(lbar);
  const diff = box(.08, .1, W * .6, DARK); diff.position.set(-L / 2 - .02, .36, 0); grp.add(diff);
  const fin = box(.14, .05, .04, paint); fin.position.set(-.15 * L, 1.47 * k, 0); grp.add(fin);
  if (o.plate) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(.52, .115), new THREE.MeshStandardMaterial({ map: plateTex(o.plate), roughness: .5 })); pl.rotation.y = -Math.PI / 2; pl.position.set(-L / 2 - .075, .6, 0); grp.add(pl); }
  const wheels = []; for (const x of [wb / 2, -wb / 2]) for (const s of [-1, 1]) { const w = wheel(.35, .245); w.position.set(x, .35, s * (W / 2 - .2)); if (s < 0) w.rotation.y = Math.PI; grp.add(w); wheels.push(w); }
  glows.forEach(g => grp.add(g));
  let interior = null; if (o.interior) { interior = buildInterior({ L, W, H, k, belt: .985 * k, roof: 1.42 * k, dashTop: .95 * k, kind: 'sedan', platform: o.platform }, o.ivi); grp.add(interior.grp); }
  return { grp, paint, wheels, wr: .35, lamps: [lm.tail, lm.head], tail: lm.tail, glows, interior };
}
export function buildSUV(o) {
  const grp = new THREE.Group(), L = o.L, W = o.W, H = o.H, k = H / 1.70, wb = o.wb, P = (fx, y) => [fx * L, y * k];
  const paint = paintMat(o.color);
  const sh = new THREE.Shape(), ac = .40, ar = .47, cl = .34, a0 = Math.asin((cl - ac) / ar);
  sh.moveTo(-L / 2 + .05, cl + .02); sh.lineTo(...P(-.5, .62)); sh.lineTo(...P(-.497, 1.0)); sh.quadraticCurveTo(...P(-.494, 1.07), ...P(-.47, 1.08));
  if (o.interior) { sh.lineTo(-.47 * L, .40); sh.lineTo(.17 * L, .40); } sh.lineTo(...P(.17, 1.07)); sh.quadraticCurveTo(...P(.33, 1.05), ...P(.46, .98)); sh.quadraticCurveTo(...P(.505, .94), ...P(.5, .70));
  sh.lineTo(...P(.49, .42)); sh.lineTo(L / 2 - .06, cl);
  sh.absarc(wb / 2, ac, ar, a0, Math.PI - a0, false); sh.absarc(-wb / 2, ac, ar, a0, Math.PI - a0, false); sh.lineTo(-L / 2 + .05, cl + .02);
  const dz = W - .16, body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: dz, bevelEnabled: true, bevelThickness: .09, bevelSize: .055, bevelSegments: 4, curveSegments: 24 }).translate(0, 0, -dz / 2), paint);
  body.castShadow = true; body.receiveShadow = true; grp.add(body);
  if (o.interior) for (const s of [-1, 1]) { const door = box(.64 * L, 1.07 * k - .40, .1, paint); door.position.set(-.15 * L, (.40 + 1.07 * k) / 2, s * (W / 2 - .04)); door.castShadow = true; grp.add(door); }
  const gs = new THREE.Shape(); gs.moveTo(...P(-.475, 1.07)); gs.lineTo(...P(-.455, 1.58)); gs.quadraticCurveTo(...P(-.44, 1.66), ...P(-.39, 1.67)); gs.lineTo(...P(.04, 1.68)); gs.quadraticCurveTo(...P(.10, 1.67), ...P(.13, 1.62)); gs.lineTo(...P(.18, 1.07)); gs.lineTo(...P(-.475, 1.07));
  const gw = W * .84 - .1; if (o.interior) grp.add(canopy(gs, gw, .06, .05)); else { const glass = new THREE.Mesh(new THREE.ExtrudeGeometry(gs, { depth: gw, bevelEnabled: true, bevelThickness: .05, bevelSize: .02, bevelSegments: 2, curveSegments: 12 }).translate(0, 0, -gw / 2), GLASS); glass.castShadow = true; grp.add(glass); }
  const rs = new THREE.Shape(); rs.moveTo(...P(-.45, 1.63)); rs.lineTo(...P(.07, 1.665)); rs.lineTo(...P(.07, 1.70)); rs.lineTo(...P(-.44, 1.69));
  const rw = W * .84 - .04, roof = new THREE.Mesh(new THREE.ExtrudeGeometry(rs, { depth: rw, bevelEnabled: true, bevelThickness: .04, bevelSize: .012, bevelSegments: 2 }).translate(0, 0, -rw / 2), paint); roof.castShadow = true; grp.add(roof);
  const lm = lamps(.35), glows = [];
  for (const s of [-1, 1]) {
    glows.push(glow(0xff3322, .9, -L / 2 - .08, 1.0 * k, s * (W / 2 - .3)), glow(0xfff1d0, 1.3, L / 2 + .1, .86 * k, s * (W / 2 - .3)));
    const hh = box(.1, .1 * k, .5, DARK); hh.position.set(L / 2 - .02, .86 * k, s * (W / 2 - .3)); grp.add(hh);
    const tl = box(.06, .12 * k, .42, lm.tail); tl.position.set(-L / 2 - .01, 1.0 * k, s * (W / 2 - .3)); grp.add(tl);
    const hl = box(.06, .06 * k, .44, lm.head); hl.position.set(L / 2 + .025, .86 * k, s * (W / 2 - .3)); grp.add(hl);
    const mir = box(.2, .13, .17, paint); mir.position.set(.17 * L - .1, 1.13 * k, s * (W / 2 + .08)); grp.add(mir);
    const clad = box(wb - .95, .16, .03, RUBBER); clad.position.set(0, .42, s * (W / 2 + .012)); grp.add(clad);
    const arch = box(.9, .5, .03, RUBBER); for (const x of [wb / 2, -wb / 2]) { const a = arch.clone(); a.position.set(x, .62, s * (W / 2 + .01)); grp.add(a); }
    const rail = box(L * .42, .04, .05, CHROME); rail.position.set(-.13 * L, 1.71 * k, s * (W * .36)); grp.add(rail);
    for (const x of [.17 * L, -.08 * L]) { seam(grp, x, .5, 1.05 * k, s * (W / 2 + .034)); const hd = box(.14, .03, .02, CHROME); hd.position.set(x - .1, .86 * k, s * (W / 2 + .035)); grp.add(hd); }
    const bpil = box(.06, .55 * k, .01, PIANO); bpil.position.set(-.09 * L, 1.36 * k, s * (W * .42 + .01)); grp.add(bpil);
  }
  const grille = box(.06, .3, W * .6, DARK); grille.position.set(L / 2 + .03, .58, 0); grp.add(grille);
  const skid = box(.08, .1, W * .5, CHROME); skid.position.set(L / 2 + .02, .4, 0); grp.add(skid);
  const lbar = box(.03, .025, W * .66, lm.tail); lbar.position.set(-L / 2 - .025, 1.05 * k, 0); grp.add(lbar);
  const drl = box(.03, .02, W * .82, lm.head); drl.position.set(L / 2 + .055, .95 * k, 0); grp.add(drl);
  if (o.plate) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(.52, .115), new THREE.MeshStandardMaterial({ map: plateTex(o.plate), roughness: .5 })); pl.rotation.y = -Math.PI / 2; pl.position.set(-L / 2 - .075, .72, 0); grp.add(pl); }
  const wheels = []; for (const x of [wb / 2, -wb / 2]) for (const s of [-1, 1]) { const w = wheel(.38, .26); w.position.set(x, .38, s * (W / 2 - .21)); if (s < 0) w.rotation.y = Math.PI; grp.add(w); wheels.push(w); }
  glows.forEach(g => grp.add(g));
  let interior = null; if (o.interior) { interior = buildInterior({ L, W, H, k, belt: 1.07 * k, roof: 1.64 * k, dashTop: 1.02 * k, kind: 'suv', platform: o.platform }, o.ivi); grp.add(interior.grp); }
  return { grp, paint, wheels, wr: .38, lamps: [lm.tail, lm.head], tail: lm.tail, glows, interior };
}
export function buildVan(o) {
  const grp = new THREE.Group(), L = 5.0, W = 1.95, wb = 3.2, paint = paintMat(o.color);
  const sh = new THREE.Shape(), ac = .39, ar = .45, a0 = Math.asin((.3 - ac) / ar);
  sh.moveTo(-L / 2, .3); sh.lineTo(-L / 2, 1.88); sh.quadraticCurveTo(-L / 2, 1.98, -L / 2 + .12, 1.98); sh.lineTo(1.25, 1.98); sh.lineTo(2.1, 1.22); sh.quadraticCurveTo(2.5, 1.1, 2.5, .9); sh.lineTo(2.48, .32); sh.lineTo(L / 2 - .1, .3);
  sh.absarc(wb / 2, ac, ar, a0, Math.PI - a0, false); sh.absarc(-wb / 2, ac, ar, a0, Math.PI - a0, false); sh.lineTo(-L / 2, .3);
  const dz = W - .12; const body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: dz, bevelEnabled: true, bevelThickness: .06, bevelSize: .04, bevelSegments: 2, curveSegments: 12 }).translate(0, 0, -dz / 2), paint); body.castShadow = true; grp.add(body);
  const ws = new THREE.Shape(); ws.moveTo(1.3, 1.92); ws.lineTo(2.08, 1.25); ws.lineTo(2.0, 1.2); ws.lineTo(1.2, 1.88);
  grp.add(new THREE.Mesh(new THREE.ExtrudeGeometry(ws, { depth: W * .86, bevelEnabled: false }).translate(.03, 0, -W * .43), GLASS));
  for (const s of [-1, 1]) { const sw = box(3.0, .48, .02, GLASS); sw.position.set(-.55, 1.58, s * (W / 2 + .045)); grp.add(sw); const fw = box(.75, .5, .02, GLASS); fw.position.set(1.32, 1.55, s * (W / 2 + .045)); grp.add(fw); }
  const lm = lamps(.35), glows = []; for (const s of [-1, 1]) { const tl = box(.05, .32, .14, lm.tail); tl.position.set(-L / 2 - .06, 1.1, s * (W / 2 - .12)); grp.add(tl); const hl = box(.05, .12, .36, lm.head); hl.position.set(2.53, .85, s * (W / 2 - .3)); grp.add(hl);
    glows.push(glow(0xff3322, .9, -L / 2 - .1, 1.1, s * (W / 2 - .12)), glow(0xfff1d0, 1.3, 2.62, .85, s * (W / 2 - .3))); }
  glows.forEach(g => grp.add(g));
  const bump = box(.12, .22, W, DARK); bump.position.set(2.5, .42, 0); grp.add(bump);
  const wheels = []; for (const x of [wb / 2, -wb / 2]) for (const s of [-1, 1]) { const w = wheel(.36, .22, 6); w.position.set(x, .36, s * (W / 2 - .18)); if (s < 0) w.rotation.y = Math.PI; grp.add(w); wheels.push(w); }
  return { grp, paint, wheels, wr: .36, lamps: [lm.tail, lm.head], tail: lm.tail, glows, interior: null };
}
export function buildTruck(o) {
  const grp = new THREE.Group(), L = 16.5, cab = paintMat(o.color), trM = std('#e7e9ec', .05, .55, { envMapIntensity: .5 });
  const c = box(2.3, 2.8, 2.5, cab); c.position.set(L / 2 - 1.15, 1.95, 0); grp.add(c);
  const ws = box(.04, 1.0, 2.25, GLASS); ws.position.set(L / 2, 2.55, 0); grp.add(ws);
  const t = box(13.4, 2.9, 2.55, trM); t.position.set(-L / 2 + 6.7, 2.7, 0); grp.add(t);
  const st = box(13.42, .22, 2.57, std('#1f4f9d', .2, .5)); st.position.set(t.position.x, 1.55, 0); grp.add(st);
  const ch = box(L - .4, .35, 2.1, DARK); ch.position.set(0, .8, 0); grp.add(ch);
  const lm = lamps(.35), glows = []; for (const s of [-1, 1]) { const tl = box(.05, .14, .3, lm.tail); tl.position.set(-L / 2 - .03, 1.05, s * 1.0); grp.add(tl); const hl = box(.05, .14, .32, lm.head); hl.position.set(L / 2 + .03, .95, s * .9); grp.add(hl);
    glows.push(glow(0xff3322, .9, -L / 2 - .08, 1.05, s), glow(0xfff1d0, 1.3, L / 2 + .1, .95, s * .9)); }
  glows.forEach(g => grp.add(g));
  const wheels = []; for (const x of [L / 2 - 1.2, L / 2 - 3.7, -L / 2 + 1.4, -L / 2 + 2.7, -L / 2 + 4.0]) for (const s of [-1, 1]) { const w = wheel(.52, .4, 8); w.position.set(x, .52, s * 1.02); if (s < 0) w.rotation.y = Math.PI; grp.add(w); wheels.push(w); }
  return { grp, wheels, wr: .52, lamps: [lm.tail, lm.head], tail: lm.tail, glows, interior: null };
}
export function buildMoto(o) {
  const grp = new THREE.Group(), paint = paintMat(o.color), suit = std('#202327', .1, .8);
  const fr = box(1.3, .32, .28, paint); fr.position.set(0, .66, 0); grp.add(fr);
  const tank = box(.55, .26, .36, paint); tank.position.set(.25, .9, 0); grp.add(tank);
  const torso = box(.34, .62, .4, suit); torso.position.set(-.12, 1.28, 0); torso.rotation.z = -.42; grp.add(torso);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(.16, 14, 10), std('#e9eaec', .3, .3)); helm.position.set(.08, 1.62, 0); helm.castShadow = true; grp.add(helm);
  for (const s of [-1, 1]) { const leg = box(.5, .14, .14, suit); leg.position.set(-.05, .86, s * .2); leg.rotation.z = .5; grp.add(leg); }
  const lm = lamps(.35); const tl = box(.04, .08, .18, lm.tail); tl.position.set(-.75, .86, 0); grp.add(tl); const hl = box(.05, .12, .14, lm.head); hl.position.set(.78, .92, 0); grp.add(hl);
  const glows = [glow(0xff3322, .6, -.8, .86, 0), glow(0xfff1d0, .9, .86, .92, 0)]; glows.forEach(g => grp.add(g));
  const wheels = []; for (const x of [.72, -.72]) { const w = wheel(.31, .12, 5); w.position.set(x, .31, 0); grp.add(w); wheels.push(w); }
  return { grp, paint, wheels, wr: .31, lamps: [lm.tail, lm.head], tail: lm.tail, glows, interior: null };
}

/* ---------------- Hyundai ego catalog (dimensions mm: L, W, H, wheelbase) ---------------- */
export const CATALOG = [
  { grp: 'Pleos Connect 탑재', items: [
    { id: 'grandeur-pleos', name: '더 뉴 그랜저', os: 'Pleos Connect', body: 'sedan', dims: [5035, 1880, 1460, 2895], note: '2026.05 · 치수는 GN7 기준' },
    { id: 'avante-pleos', name: '디 올 뉴 아반떼', os: 'Pleos Connect', body: 'sedan', dims: [4765, 1855, 1425, 2750], note: '2026 공개 제원' },
    { id: 'tucson-pleos', name: '신형 투싼 (출시 예정)', os: 'Pleos Connect (예정)', body: 'suv', dims: [4640, 1865, 1665, 2755], note: '제원 미공개 · NX4 F/L 치수 대입' }] },
  { grp: 'ccNC 탑재', items: [
    { id: 'grandeur-gn7', name: '디 올 뉴 그랜저 (GN7)', os: 'ccNC', body: 'sedan', dims: [5035, 1880, 1460, 2895] },
    { id: 'sonata-dn8', name: '쏘나타 디 엣지 (DN8 F/L)', os: 'ccNC', body: 'sedan', dims: [4910, 1860, 1445, 2840] },
    { id: 'ioniq6-fl', name: '아이오닉 6 (F/L)', os: 'ccNC', body: 'sedan', dims: [4930, 1880, 1495, 2950], note: '치수 확인 필요',
      // licensed exterior supplied by the user (local file, not bundled): CC BY 4.0, attribution shown while in use; pre-facelift 2022 body
      glb: 'assets/user/ioniq6.glb', credit: '"2022 Hyundai Ioniq 6" © RADMATTER12 (Sketchfab), <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, logos removed' },
    { id: 'kona-sx2', name: '디 올 뉴 코나 (SX2)', os: 'ccNC', body: 'suv', dims: [4350, 1825, 1580, 2660] },
    { id: 'tucson-nx4', name: '더 뉴 투싼 (NX4 F/L)', os: 'ccNC', body: 'suv', dims: [4640, 1865, 1665, 2755] },
    { id: 'santafe-mx5', name: '디 올 뉴 싼타페 (MX5)', os: 'ccNC', body: 'suv', dims: [4830, 1900, 1720, 2815] },
    { id: 'palisade-lx3', name: '팰리세이드 (LX3)', os: 'ccNC', body: 'suv', dims: [5060, 1980, 1805, 2970] },
    { id: 'ioniq5-fl', name: '아이오닉 5 (F/L)', os: 'ccNC', body: 'suv', dims: [4655, 1890, 1605, 3000] },
    { id: 'ioniq5-n', name: '아이오닉 5 N', os: 'ccNC', body: 'suv', dims: [4715, 1940, 1585, 3000] },
    { id: 'ioniq9', name: '아이오닉 9', os: 'ccNC', body: 'suv', dims: [5060, 1980, 1790, 3130] },
    { id: 'nexo-nh2', name: '넥쏘 (NH2)', os: 'ccNC', body: 'suv', dims: [4750, 1865, 1640, 2790] },
    { id: 'staria-fl', name: '더 뉴 스타리아', os: 'ccNC', body: 'van', dims: [5255, 1995, 1990, 3275] }] },
  { grp: '데모 에셋', items: [
    { id: 'concept', name: 'Car Concept (glTF 데모)', os: '—', body: 'gltf', dims: null },
    { id: 'orig-sedan', name: '오리지널 세단', os: '—', body: 'sedan', dims: [4950, 1880, 1460, 2900] }] }
];
export const CAT = {}; CATALOG.forEach(g => g.items.forEach(it => { CAT[it.id] = it; }));

/* ---------------- glTF ---------------- */
const LEFT_CAR = new THREE.Vector3(0, 0, -1);
export function gltfLoader() { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); return l; }
export function prepareModel(gltf) {
  const root = gltf.scene || gltf.scenes[0];
  const wrap = new THREE.Group(), inner = new THREE.Group(); inner.add(root); wrap.add(inner);
  inner.rotation.y = Math.PI / 2; wrap.updateMatrixWorld(true);
  let bx = new THREE.Box3().setFromObject(wrap), sz = bx.getSize(new THREE.Vector3());
  let sc = 1; if (sz.x < 1 || sz.x > 25) sc = 4.9 / sz.x;
  inner.scale.setScalar(sc); wrap.updateMatrixWorld(true);
  bx = new THREE.Box3().setFromObject(wrap); sz = bx.getSize(new THREE.Vector3()); const c = bx.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -bx.min.y, -c.z); wrap.updateMatrixWorld(true);
  const info = { wrap, inner, L: sz.x, W: sz.z, H: sz.y, paint: null, tail: null, head: [], wheels: [] };
  const mats = new Set();
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); }
    if (/^wheel/i.test(o.name) && !/rim|brake|disc|pad/i.test(o.name) && o.parent && !/^wheel/i.test(o.parent.name)) info.wheels.push(o); });
  for (const m of mats) { const n = (m.name || '').toLowerCase();
    if (m.envMapIntensity !== undefined) m.envMapIntensity = 1;
    if (/light ?glass|lamp ?glass|lens/.test(n)) { m.transparent = true; m.opacity = .16; m.color && m.color.set('#ffffff'); m.roughness = .05; m.metalness = 0; m.depthWrite = false; }  // clear lamp cover over the red/white lamps
    else if (/glass|window|windshield/.test(n)) { m.transparent = true; m.opacity = .32; m.color && m.color.set('#0d1318'); m.roughness = .03; m.metalness = 0; if ('transmission' in m) m.transmission = 0; m.depthWrite = false; m.envMapIntensity = 1.6; }
    else if (/paint 1/.test(n) || (!info.paint && /paint|body|carpaint/.test(n) && !/paint 2/.test(n))) info.paint = m;
    if (/brake ?light|taillight|rear ?light|backuplight/.test(n)) { m.emissive = col('#ff2010'); info.tail = m; }
    if (/headlight|head ?lamp|frontled/.test(n)) { m.emissive = col('#dfe9ff'); info.head.push(m); }
    if (/signal/.test(n)) { m.emissive = col('#ff8a1a'); m.emissiveIntensity = .15; }
    if (n === 'license') { const t = plateTex('MUTUUS'); t.flipY = false; m.map = t; m.color && m.color.set(0xffffff); m.needsUpdate = true; }
  }
  // downloaded models often ship matte, untextured paint and black lamp lenses: give paint a clear-coat-like finish and
  // tail lamps a red lens so the rear does not read as dead when the lamps are off
  if (info.paint && info.paint.roughness > .5) { info.paint.roughness = .3; info.paint.metalness = Math.max(info.paint.metalness || 0, .35); }
  for (const m of mats) { const n = (m.name || '').toLowerCase();
    if (/light|lamp/.test(n) && !/front|head|glass|signal/.test(n) && m.color && m.color.getHSL({}).l < .12) m.color.set('#5a0c0a');
    // red-dominant lamp parts (light bars, spoiler lamps) glow like lit position lamps instead of reading black in daylight
    if (/light|lamp/.test(n) && m.color && m.color.r > .2 && m.color.g < .25 * m.color.r && m !== info.tail) { m.emissive = col('#ff1a10'); m.emissiveIntensity = .55; } }
  // no manufacturer marks (project rule): hide emblem/logo meshes of user-supplied models
  root.traverse(o => { if (o.isMesh && [].concat(o.material).some(m => /logo|emblem|badge/i.test(m.name || '')) || /logo|emblem|badge/i.test(o.name || '')) o.visible = false; });
  wrap.updateMatrixWorld(true); const qw = new THREE.Quaternion();
  info.wheelAxes = info.wheels.map(w => { w.getWorldQuaternion(qw); return LEFT_CAR.clone().applyQuaternion(qw.invert()).normalize(); });
  return info;
}

/**
 * Body-only models (no tyres: the model is shorter than the published height and its sills rest on the ground) get
 * template wheels in their arches and are lifted to the published height. The arches are found from the geometry: along
 * the length, the lowest point of the body sides rises well above the sill line over each arch.
 * m: prepareModel() result already fitted to spec (wrap scale k), spec: CATALOG entry. Returns the wheels or null.
 */
export function addGlbWheels(m, spec) {
  const [L, W, H] = spec.dims.map(v => v / 1000), lift = H - m.H; if (!(lift > .08 && lift < .3)) return null;
  const k = m.wrap.scale.x, inv = new THREE.Matrix4(), v = new THREE.Vector3(), M = new THREE.Matrix4(), BIN = .05;
  m.wrap.updateMatrixWorld(true); inv.copy(m.wrap.matrixWorld).invert();
  const n = Math.ceil(m.L / k / BIN) + 2, x0 = -m.L / k / 2 - BIN, low = new Float32Array(n).fill(Infinity);
  m.inner.traverse(o => { if (!o.isMesh || !o.visible || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position; M.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i += 2) { v.fromBufferAttribute(pos, i).applyMatrix4(M);
      if (Math.abs(v.z) < m.W / k * .3) continue;   // body sides only (not the underfloor)
      const b = Math.floor((v.x - x0) / BIN); if (b >= 0 && b < n && v.y < low[b]) low[b] = v.y; } });
  const sill = Math.min(...low.filter(Number.isFinite)), arch = [...low].map(y => Number.isFinite(y) && y > sill + .18 / k);
  const groups = []; for (let i = 0; i < n; i++) if (arch[i]) { if (groups.length && groups.at(-1)[1] === i - 1) groups.at(-1)[1] = i; else groups.push([i, i]); }
  const wide = groups.filter(([a, b]) => (b - a + 1) * BIN * k > .35).map(([a, b]) => x0 + (a + b + 1) / 2 * BIN);
  if (wide.length < 2) return null;
  const xs = [wide[0], wide.at(-1)], r = .352, tw = .245;   // 245/40 R20
  m.inner.position.y += lift / k;
  // the model has no floor either: a dark underbody between the sills keeps the road from showing through under the car
  const floor = box(m.L / k * .82, .04 / k, (W - .3) / k, UNDER); floor.position.set((xs[0] + xs[1]) / 2, (lift + .02) / k, 0); m.wrap.add(floor);
  const wheels = [];
  for (const x of xs) for (const sgn of [-1, 1]) {
    const w = wheel(r, tw, 5, ALLOY); w.scale.setScalar(1 / k); w.position.set(x, r / k, sgn * (W / 2 - .2) / k); if (sgn < 0) w.rotation.y = Math.PI;
    w.traverse(o => { if (o.isMesh) o.castShadow = true; }); m.wrap.add(w); wheels.push(w);
  }
  m.H = H; m.wheelbase = (xs[1] - xs[0]) * k;
  return wheels;
}
export const IDB = { p: null,
  open() { if (this.p) return this.p; this.p = new Promise(res => { try { const r = indexedDB.open('ausfahrt-cars', 1); r.onupgradeneeded = () => r.result.createObjectStore('glb'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }); return this.p; },
  async tx(mode, fn) { const db = await this.open(); if (!db) return null; return new Promise(res => { try { const t = db.transaction('glb', mode), st = t.objectStore('glb'), rq = fn(st); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (e) { res(null); } }); },
  get(k) { return this.tx('readonly', st => st.get(k)); }, put(k, v) { return this.tx('readwrite', st => st.put(v, k)); }, del(k) { return this.tx('readwrite', st => st.delete(k)); }, keys() { return this.tx('readonly', st => st.getAllKeys()); } };
