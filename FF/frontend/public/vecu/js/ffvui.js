// FF virtual validation at the pre-deployment verification gate (G5): a policy package with its test plan -> run each test
// case in the scene like a vehicle test (lead car, fault injection, Kill over a simulated link, flag queries/updates sent by
// the vehicle) -> per-test verdict (gate vs info criteria) -> gate verdict -> gate evidence package. Logic lives in
// ffval.js; this module wires it to the simulation, the panels and the IVI.
import { loadPackage, forTest, evaluate, ValidationRun, FEATURES, gateVerdict, gateReportHtml, FFVAL_VERSION } from './ffval.js';
import { zip } from './zip.js';

const RES = { TRUE: '✔', FALSE: '✖', UNKNOWN: '?', SKIP: '–' }, STI = { pass: '✔', fail: '✖', pending: '…', na: '–' };
const STAGE_C = { '정상': '#5cc47d', '주의': '#f0b445', '위험': '#ef5b4c' };
const EV_LABEL = { fault_injected: '오류 주입', kill_issued: '긴급 차단', deact_accepted: '차단 수락', onboard_fault: '차량 내 감지', feature_base_only: 'BASE_ONLY', kill_rejected: 'DC4 거부' };
const TC_ST = { PASS: '통과', FAIL: '불합격', RUNNING: '진행 중', NOT_RUN: '미실시' };
const EXP_SHORT = { CONFIRMED: '일치', DIVERGED: '불일치', DUPLICATE: '중복', ACCEPTED: '접수', REJECTED: '거부' };   // request log column; error codes show as the HTTP status
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(d));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** ctx: {$, sim, veh, T, ego, tLane, wrapS, SCENE, press, setCam, shotCamera, ivi, iviApply, canvas, THREE, scene, sceneLabel} */
export function initFFV(ctx) {
  const { $, sim, ivi } = ctx;
  const S = { pkg: null, sel: 0, results: {}, run: null, tc: null, queue: [], caps: [], capReq: null, cursor: null, evN: 0, lastA: 0, worstTg: Infinity, worstCapT: -9, sched: [], uiT: 0, open: false, prevScn: null };
  const tcs = () => (S.pkg ? S.pkg.tests : []);
  const baseVehicle = () => S.pkg && S.pkg.fleet.find(v => v.vin === $('#ffvVeh').value);
  const home = () => (S.pkg && S.pkg.policy.featureId === 'FEAT-00024' ? 'nav' : 'adas');   // IVI screen where the feature under test shows
  const provisional = () => !!(S.pkg && FEATURES[S.pkg.policy.featureId] && FEATURES[S.pkg.policy.featureId].provisional);
  const unofficial = () => !S.pkg || !S.pkg.policy.contentHash || /sample|not-hashed/i.test(S.pkg.policy.contentHash) || provisional();
  const tcVehicle = tc => ({ ...baseVehicle(), ...((tc.preconditions && tc.preconditions.vehicle) || {}) });

  /* ---------------- package, test plan, evaluation ---------------- */
  async function setPackage(json, label) {
    try { S.pkg = loadPackage(json); } catch (e) { $('#ffvNote').textContent = e.message; return; }
    const P = S.pkg.policy, F = FEATURES[P.featureId];
    $('#ffvGate').textContent = `${S.pkg.gate.name} (${S.pkg.gate.id})`;
    $('#ffvFeat').innerHTML = `<b>${esc(P.featureId)} v${esc(P.featureVersion)}</b> ${F ? esc(F.name) : ''} · <code>${esc(P.flagKey)}</code> · ${esc(P.policyId)} r${P.revision} ${esc(P.status)} · ${!P.contentHash || /sample|not-hashed/i.test(P.contentHash) ? '<b style="color:var(--crit)">해시 없음 · 비공식</b>' : `<span title="${esc(P.contentHash)}">#${esc(String(P.contentHash).slice(0, 10))}</span>`}${provisional() ? ' · <b style="color:var(--crit)" title="FF 사양 미정 — 공식 Gate 증적으로 쓸 수 없음">가정 기준</b>' : ''}${label ? ` · ${esc(label)}` : ''}`;
    const sel = $('#ffvVeh'); sel.innerHTML = S.pkg.fleet.map(v => `<option value="${esc(v.vin)}">${esc(v.vin)} · ${esc(v.label || v.vehicleModel)}</option>`).join('');
    if (S.pkg.vehicleVin) sel.value = S.pkg.vehicleVin;
    S.results = {}; $('#ffvNote').textContent = F ? '' : `${P.featureId}: 차량 측 런타임이 아직 없습니다 (현재 FEAT-00022만 지원)`;
    await selectTc(0); gateChip();
  }
  async function selectTc(i) {
    if (!S.pkg) return; S.sel = i; const tc = tcs()[i], sc = tc.scenario;
    $('#ffvTcInfo').innerHTML = `<p>${esc(tc.purpose)}</p>${tc.steps.length ? `<details><summary>절차 ${tc.steps.length}단계</summary><ol>${tc.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}${tc.expected.length ? `<details><summary>기대 결과</summary><ul>${tc.expected.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
    $('#ffvScnName').textContent = `${tc.id}`; $('#ffvLead').value = sc.lead_kph; $('#ffvGap').value = sc.target_gap_m; $('#ffvFaultOn').checked = !!sc.fault; $('#ffvFault').value = sc.fault ? sc.fault.at_s : 17;
    $('#ffvKillOn').checked = !!sc.kill; $('#ffvKill').value = sc.kill ? sc.kill.at_s : 48; $('#ffvLat').value = sc.link_latency_ms; $('#ffvDur').value = sc.duration_s;
    tcList(); await reevaluate(); panels(); drawChart($('#ffvChart'));
  }
  async function reevaluate() {
    if (!S.pkg) return; const tc = tcs()[S.sel], p = forTest(S.pkg, tc), v = tcVehicle(tc);
    const f = await evaluate(p, v, { assumeDeployed: $('#ffvDeploy').checked }), chip = $('#ffvFlag');
    chip.className = `chip ${f.value ? 'on' : 'off'}`; chip.textContent = f.value ? 'ON' : 'OFF';
    $('#ffvReason').textContent = `${v.vin} · ${f.decision} · ${f.reason}${S.pkg.policy.status !== 'DEPLOYED' && $('#ffvDeploy').checked ? ' (배포 가정)' : ''}`;
    const good = t => (t.step === 'KILL' ? { TRUE: 'FALSE', FALSE: 'TRUE' }[t.result] || t.result : t.result);   // no Kill in force = pass
    $('#ffvTrace').innerHTML = f.trace.map(t => `<li title="${esc(t.step)}: ${esc(t.result)} — ${esc(t.detail)}"><span class="r ${good(t)}">${RES[good(t)] || t.result}</span><span>${t.step}</span><span>${esc(t.detail)}</span></li>`).join('');
    return f;
  }
  function scenarioFromInputs(tc) {
    const n = id => +$(id).value, sc = tc.scenario;
    sc.lead_kph = n('#ffvLead'); sc.target_gap_m = n('#ffvGap'); sc.link_latency_ms = n('#ffvLat'); sc.duration_s = n('#ffvDur');
    sc.fault = $('#ffvFaultOn').checked ? Object.assign({ ramp_s: 8, bias_max: 2.4 }, sc.fault || {}, { at_s: n('#ffvFault') }) : null;
    sc.kill = $('#ffvKillOn').checked ? Object.assign({}, sc.kill || {}, { at_s: n('#ffvKill') }) : null;
  }
  function tcList() {
    $('#ffvTcs').innerHTML = tcs().map((t, i) => { const r = S.results[t.id], st = S.tc === t && S.run && !S.run.done ? 'RUNNING' : r ? r.overall : 'NOT_RUN';
      return `<li class="${i === S.sel ? 'sel' : ''}" data-i="${i}"><span class="id">${esc(t.id)}</span><span class="st ${st}">${TC_ST[st]}</span><span class="nm">${esc(t.name)}</span></li>`; }).join('');
  }
  function gateChip() {
    const c = $('#ffvGateChip'); if (!S.pkg) { c.className = 'chip READY'; c.textContent = 'Gate 미실시'; return; }
    const g = gateVerdict(S.pkg, S.results), running = !!(S.run && !S.run.done) || S.queue.length > 0 || S.next != null, n = Object.keys(S.results).length;
    c.className = `chip ${running ? 'RUNNING' : g.overall}`;
    const cur = S.tc ? tcs().indexOf(S.tc) + 1 : S.next != null ? S.next + 1 : n;
    c.textContent = running ? `Gate 시험 중 · ${cur}/${tcs().length}번째` : { PASS: `Gate 통과 · ${n}/${tcs().length} 완료${unofficial() ? ' (비공식)' : ''}`, FAIL: `Gate 불합격 · ${n}/${tcs().length} 완료`, INCOMPLETE: n ? `Gate 미완료 · ${n}/${tcs().length} 완료` : 'Gate 미실시' }[g.overall];
    $('#ffvExport').disabled = !n || running;
  }

  /* ---------------- run (one test case) ---------------- */
  function arrange(sc, mode) {
    const { T, ego, tLane, wrapS, SCENE, veh } = ctx, vL = sc.lead_kph / 3.6, lead = T.white;
    if (mode === 'free') sc = { ...sc, target_gap_m: 240 };   // far ahead: the feature under test is not about following
    sim.scn.enabled = false; ctx.press('scn', 'free');
    const s0 = SCENE ? SCENE.s_ego0 : 120;
    ego.s = s0; ego.t = tLane(-3); ego.v = vL; ego.vSet = vL; ego.lc = null;
    lead.road = 1; lead.lc = null; lead.s = wrapS(s0 + sc.target_gap_m + (ego.L + lead.L) / 2); lead.t = tLane(-3); lead.v = lead.vSet = vL;
    // everyone else out of the ego lane (the inner lane), except one follower well behind the ego
    [['cut', 70], ['silver', 130], ['truck', 210], ['moto', -45], ['green', -110], ['van', 300]].forEach(([n, ds], i) => { const v = T[n]; if (!v) return; v.road = 1; v.lc = null; v.exiting = false; v.s = wrapS(s0 + ds); v.t = tLane(-2); v.v = v.vSet = vL * (1.04 + .03 * i); });
    if (T.grey) { const g = T.grey; g.road = 1; g.lc = null; g.s = wrapS(s0 - 75); g.t = tLane(-3); g.v = g.vSet = vL; }
    for (const v of veh) v.tRate = 0;
  }
  const viewCam = () => { ctx.shotCamera({ back: 12, up: 7, left: .4, look: 14, lookUp: -3, fov: 60 }); sim.snapCam = true; };
  async function start(i) {
    if (!S.pkg) return; abortRun();
    const tc = tcs()[i]; if (S.sel !== i) await selectTc(i); scenarioFromInputs(tc);
    const p = forTest(S.pkg, tc), vehicle = tcVehicle(tc), flag = await evaluate(p, vehicle, { assumeDeployed: $('#ffvDeploy').checked });
    if (S.prevScn == null) S.prevScn = sim.scn.enabled;
    arrange(tc.scenario, FEATURES[p.policy.featureId].arrange); viewCam(); sim.timeScale = +$('#ffvSpeed').value; sim.paused = false;
    S.tc = tc; S.run = new ValidationRun({ pkg: p, vehicle, flag, sceneId: ctx.sceneLabel(), simVersion: FFVAL_VERSION });
    Object.assign(S, { caps: [], capReq: null, cursor: null, evN: 0, lastA: 0, worstTg: -Infinity, worstCapT: -9, capKeys: new Set(), sched: [{ t: 1, name: '01_start', label: '시험 시작' }] });
    ivi.feature = { name: FEATURES[p.policy.featureId].name, state: S.run.on ? 'active' : 'disabled' }; ivi.guidance = null;
    ctx.iviApply({ screen: home() });
    sim.longCtl = (dt, ego) => {
      const r = S.run; if (!r || r.done) return null;
      const ld = ego.ld, a = r.step(dt, { gap_true: ld ? ld.gap : 150, ego_mps: ego.v, lead_mps: ld ? ld.v : ego.v, ego_a: S.lastA });
      S.lastA = a == null ? 0 : a; return a;
    };
    buttons(); tcList(); gateChip();
  }
  async function runAll() { if (!S.pkg) return; S.results = {}; S.queue = tcs().map((_, i) => i).slice(1); await start(0); }
  function abortRun() { sim.longCtl = null; if (S.run && !S.run.done) { S.run.done = true; S.run.ev('run_end', '사용자가 중지'); } S.run = null; S.tc = null; S.finishing = false; if (marker) marker.visible = false; }
  function restoreSim() { sim.timeScale = 1; if (S.prevScn != null) { sim.scn.enabled = S.prevScn; ctx.press('scn', S.prevScn ? 'cutin' : 'free'); S.prevScn = null; } }
  function stopAll() { S.queue = []; S.next = null; abortRun(); restoreSim(); buttons(); tcList(); gateChip(); panels(); }
  function buttons() {
    const running = !!(S.run && !S.run.done);
    $('#ffvRun').disabled = $('#ffvRunAll').disabled = running || S.next != null || !S.pkg || !FEATURES[S.pkg.policy.featureId]; $('#ffvStop').disabled = !running && !S.queue.length && S.next == null;
    $('#rqSend').disabled = !running;
  }
  async function finish() {
    const r = S.run, tc = S.tc; sim.longCtl = null;
    const chartPng = await chartBytes(r);
    S.results[tc.id] = { overall: r.verdict().overall, run: r, caps: S.caps, chartPng };   // caps: same array — the last PNGs are still encoding
    if (S.queue.length) { S.next = S.queue.shift(); tcList(); gateChip(); buttons(); setTimeout(() => { const n = S.next; S.next = null; if (n != null) start(n); }, 1200); return; }   // S.next: between test cases
    sim.paused = true; restoreSim(); buttons(); tcList(); gateChip(); S.uiT = 0;
  }
  function onEvents() {
    const r = S.run; while (S.evN < r.events.length) {
      const e = r.events[S.evN++];
      if (e.type === 'fault_injected') S.sched.push({ t: e.t + 4, name: '02_fault', label: `오류 주입 4초 후 · ${e.detail}` });
      if (e.type === 'deact_accepted' && e.deact_class === 'DC2') {   // DC2 takeover warning: the feature still drives, the driver is asked to take over
        ctx.iviApply({ popup: { title: '운전자 인계 요청', text: `${ivi.feature.name}이(가) 곧 중지됩니다 — 직접 차간 거리를 확인하세요`, level: 'warn', ms: 4000 } });
        S.sched.push({ t: e.t + .3, name: '03_takeover', label: `원격 차단 수락 → 인계 경고 (지연 ${e.latency_ms} ms)` });
      }
      if (e.type === 'onboard_fault') S.sched.push({ t: e.t + .1, name: '03_onboard', label: `차량 내 감지 · ${e.detail}` });
      if (e.type === 'feature_base_only') {
        ivi.feature.state = 'safe_default';
        ctx.iviApply({ screen: 'adas', popup: { title: '기능 일시 중지', text: `${ivi.feature.name}이(가) ${r.g && r.g.detectAt != null ? "차량 고장 감지로" : "원격으로"} 중지되어 기본 주행 보조로 전환했습니다`, level: 'warn', ms: 8000 } });
        S.sched.push({ t: e.t + .3, name: '04_base_only', label: `기능 효과 제거 → BASE_ONLY (${e.state})` });
        S.sched.push({ t: e.t + 3, name: '05_base_only', label: 'BASE_ONLY 3초 후' });
      }
      if (e.type === 'feature_active' && r.t > .1) { ivi.feature.state = 'active'; ctx.iviApply({ screen: home(), popup: { title: '주행 보조 기능 사용 가능', text: `${ivi.feature.name} · ${e.detail}`, level: 'info', ms: 5000 } }); }
      if (e.type === 'feature_disabled' && r.t > .1) { ivi.feature.state = 'disabled'; ctx.iviApply({ screen: home(), popup: { title: '주행 보조 기능 꺼짐', text: `${ivi.feature.name} · ${e.detail}`, level: 'warn', ms: 5000 } }); }
      if (e.type === 'platform_response') {
        const q = e.response, rec = r.reqs.find(x => x.id === q.id) || {}, what = respText(q), key = `${rec.label || rec.kind}|${what}`;
        if (!S.capKeys.has(key)) { S.capKeys.add(key); S.sched.push({ t: e.t + .4, name: `07_${q.id}`, label: `차량 요청 ${q.id} 응답 ${what}${rec.expect ? (rec.match ? ' · 기대 일치' : ` · 기대 ${rec.expect} 불일치`) : ''}` }); }   // repeats (e.g. the 429 burst) are captured once
      }
      if (e.type === 'suppression') { ctx.iviApply({ popup: { title: '급가속 억제 동작', text: '가속을 부드럽게 제한합니다', level: 'info', ms: 2500 } }); if (!S.caps.some(c => c.name === '08_suppression.png')) S.sched.push({ t: e.t + .8, name: '08_suppression', label: e.detail }); }
      if (e.type === 'guidance_shown') S.sched.push({ t: e.t + .5, name: '08_guidance', label: e.detail });
      if (e.type === 'junction_passed') S.sched.push({ t: e.t, name: '09_passed', label: e.detail });
      if (e.type === 'anomaly_advice') { S.sched.push({ t: e.t + .2, name: '08_anomaly', label: e.detail }); ctx.iviApply({ popup: { title: '이상 징후 보고됨', text: e.detail, level: e.advice === 'KILL' ? 'warn' : 'info', ms: 5000 } }); }
      if (e.type === 'run_end') { S.capReq = { name: '06_end', label: '시험 종료' }; S.finishing = true; }
      S.sched.sort((a, b) => a.t - b.t);
    }
  }
  /** Operator buttons: requests the vehicle sends during the test (manual steps of the test procedure). */
  const req = (o, label) => { if (S.run && !S.run.done) { S.run.request(Object.assign(o, { label: `수동 · ${label}` })); S.uiT = 0; } };

  /* ---------------- per frame ---------------- */
  function afterRender(now) {
    const r = S.run; if (!S.open) return;
    if (r) {
      onEvents();
      if (!S.capReq && S.sched.length && r.t >= S.sched[0].t) S.capReq = S.sched.shift();
      const w = r.feature.worst(r.m), score = w ? (w.lowerIsWorse ? -w.v : w.v) : -Infinity;   // "worst" moment of this feature (min gap, peak accel, max error)
      if (!S.capReq && w && score > S.worstTg + .03 && r.t - S.worstCapT > .5 && r.t > 2) { S.worstTg = score; S.worstCapT = r.t; S.capReq = { name: '03_worst', label: w.label }; }
      if (r.out && 'guidance' in r.out && JSON.stringify(ivi.guidance) !== JSON.stringify(r.out.guidance)) { ivi.guidance = r.out.guidance; ivi.dirty = true; }
      if (S.capReq) { capture(S.capReq); S.capReq = null; if (S.finishing) { S.finishing = false; finish(); S.uiT = 0; } }
      gapMarker();
    }
    if (now - S.uiT > 200) { S.uiT = now; panels(); drawChart($('#ffvChart')); }
  }
  // ribbon on the road from the ego's front to the lead's rear, coloured by the true stage (visible in captures too)
  let marker = null;
  function gapMarker() {
    const { THREE, ego } = ctx, ld = ego.ld, tl = lastTel();
    if (!marker) { marker = new THREE.Mesh(new THREE.BoxGeometry(1, .02, .7), new THREE.MeshBasicMaterial({ color: 0x5cc47d, transparent: true, opacity: .6, depthWrite: false })); marker.renderOrder = 2; ctx.scene.add(marker); }
    marker.visible = !!(S.open && S.run && ld && tl && S.run.feature.arrange === 'follow');   // gap features only; stays on the final frame
    if (!marker.visible) return;
    const a = ego.grp.position, b = ld.o.grp.position, f = new THREE.Vector3(Math.cos(ego.hw), 0, -Math.sin(ego.hw));
    const p0 = a.clone().addScaledVector(f, ego.L / 2), p1 = b.clone().addScaledVector(f, -ld.o.L / 2), len = Math.max(.1, p0.distanceTo(p1));
    marker.position.copy(p0).lerp(p1, .5); marker.position.y += .04; marker.scale.set(len, 1, 1); marker.rotation.set(0, ego.hw, 0);
    marker.material.color.set(STAGE_C[tl.stage_true] || '#5cc47d');
  }
  /** Platform answer in a few words (request log, captures). */
  function respText(q) {
    if (q.error) return `거부 ${q.status} ${q.error}`;
    if (q.outcome === 'DUPLICATE') return '중복 (재전송 · 효과 없음)';
    if (q.readback) return `회신 ${q.readback.status === 'CONFIRMED' ? '일치' : '불일치'} (결정 ${q.readback.desired ? 'ON' : 'OFF'} / 차량 ${q.readback.observed ? 'ON' : 'OFF'})`;
    if (q.advice) return `접수 · 권고 ${q.advice}`;
    return `${q.value ? 'ON' : 'OFF'}${q.metadata ? ` (${q.metadata.decision}${q.reason ? ` · ${q.reason}` : ''})` : ''}`;
  }
  /** One-line state of the feature under test (HUD, captures); html adds emphasis. */
  function describe(tl, html) {
    const fid = S.run ? S.run.pkg.policy.featureId : '', b = (cond, t) => (html && cond ? `<span class="bad">${t}</span>` : t);
    if (fid === 'FEAT-00023') return `${tl.feature_state} · 운전자 요구 ${fmt(tl.a_req)} → 실제 ${fmt(tl.a_cmd)} m/s² (한계 ${fmt(tl.a_limit)})${tl.suppressing ? ` · ${b(false, '억제 중')}` : ''}${tl.fault_active && tl.feature_state === 'ACTIVE' ? ` · ${b(true, '오류 주입 중')}` : ''} · 자차 ${fmt(tl.ego_kph, 0)} km/h`;
    if (fid === 'FEAT-00024') return `${tl.feature_state} · ${tl.guidance ? `안내 ${tl.guidance} · ${tl.direction === 'left' ? '왼쪽' : '오른쪽'} ${tl.dist_shown} m` : '안내 없음'} · 실제 남은 거리 ${fmt(tl.dist_true, 0)} m${tl.guidance && Math.abs(tl.dist_shown - Math.max(0, tl.dist_true)) > 20 ? ` · ${b(true, '⚠ 거리 오차')}` : ''} · 자차 ${fmt(tl.ego_kph, 0)} km/h`;
    const bad = tl.stage_feature && tl.stage_feature !== tl.stage_true;
    return `${tl.feature_state} · 기능 ${tl.stage_feature || '—'} | 실제 ${b(tl.stage_true === '위험', tl.stage_true)} · 추정 ${fmt(tl.gap_est)} m / 실제 ${fmt(tl.gap_true)} m · 차간 시간 ${fmt(tl.gap_true / Math.max(tl.ego_kph / 3.6, 1), 2)} s · 자차 ${fmt(tl.ego_kph, 0)} / 지령 ${fmt(tl.cmd_kph, 0)} km/h${tl.ttc != null ? ` · TTC ${fmt(tl.ttc)} s` : ''}${bad ? ` ${b(true, '⚠ 판단 불일치')}` : ''}`;
  }
  function lastTel() { const r = S.run; return r && r.tel.length ? r.tel[r.tel.length - 1] : null; }
  function capture({ name, label }) {
    const src = ctx.canvas, r = S.run, tl = lastTel(), k = Math.min(1, 1600 / src.width), c = document.createElement('canvas');
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k); const g = c.getContext('2d');
    g.drawImage(src, 0, 0, c.width, c.height);   // same task as the render: the WebGPU canvas still holds this frame
    const P = r.pkg.policy, lines = [`${S.tc.id} · ${P.featureId} ${P.flagKey} · t=${r.t.toFixed(1)} s · ${label}`,
      tl ? `상태 ${describe(tl, false)}` : ''];
    const cc = document.querySelector('#iviCc');
    if (cc && cc.width) { const iw = Math.round(c.width * .36), ih = Math.round(iw * cc.height / cc.width), ix = c.width - iw - 10; g.fillStyle = 'rgba(10,13,18,.85)'; g.fillRect(ix - 4, 30, iw + 8, ih + 24); g.drawImage(cc, ix, 46, iw, ih); g.fillStyle = '#e8edf3'; g.font = '600 11px "Malgun Gothic",system-ui,sans-serif'; g.fillText('운전자 IVI · 센터 디스플레이', ix, 41); }
    g.fillStyle = 'rgba(10,13,18,.78)'; g.fillRect(0, c.height - 52, c.width, 52); g.font = '600 15px "Malgun Gothic",system-ui,sans-serif'; g.fillStyle = '#e8edf3';
    g.fillText(lines[0], 12, c.height - 31); g.font = '13px "Malgun Gothic",system-ui,sans-serif'; g.fillText(lines[1], 12, c.height - 11);
    g.fillStyle = 'rgba(122,29,29,.85)'; g.fillRect(0, 0, 196, 24); g.fillStyle = '#fff'; g.font = '600 12px "Malgun Gothic",system-ui,sans-serif'; g.fillText('사내 검증용 · 외부 배포 금지', 8, 16);
    const t = +r.t.toFixed(2), caps = S.caps;
    c.toBlob(b => b && b.arrayBuffer().then(buf => { const i = caps.findIndex(x => x.name === `${name}.png`); if (i >= 0) caps.splice(i, 1); caps.push({ name: `${name}.png`, label, t, bytes: new Uint8Array(buf) }); }), 'image/png');
  }
  function panels() {
    const kept = S.pkg && S.results[tcs()[S.sel].id], r = S.run || (kept && kept.run), ov = $('#ffvOverall');
    buttons();
    if (!S.pkg) { $('#ffvHud').textContent = '정책 패키지(시험 계획 포함)를 열거나 샘플을 고르세요'; return; }
    if (!r) { ov.className = 'chip READY'; ov.textContent = '대기'; $('#ffvRTitle').textContent = `판정 · ${tcs()[S.sel].id}`; $('#ffvCrit').innerHTML = ''; $('#ffvReqs').innerHTML = ''; $('#ffvHud').textContent = '시험 항목을 고르고 ▶ 실행'; return; }
    const v = r.verdict(), tl = r.tel.length ? r.tel[r.tel.length - 1] : null, tc = r.pkg.test;
    $('#ffvRTitle').textContent = `판정 · ${tc ? tc.id : ''}`;
    const over = v.items.filter(i => i.role === 'info' && i.status === 'fail').length;
    ov.className = `chip ${v.overall === 'PASS' && over && r.done ? 'WARN' : v.overall}`;
    ov.textContent = v.overall === 'FAIL' && !r.done ? 'FAIL 확정 · 진행 중' : { PASS: r.done ? `PASS · 통과${over ? ` (참고 ${over}건 초과)` : ''}` : '진행 중', FAIL: 'FAIL · 불합격', RUNNING: '진행 중' }[v.overall];
    $('#ffvTime').textContent = `${r.t.toFixed(1)} / ${r.sc.duration_s} s${sim.timeScale > 1 && !r.done ? ` · ×${sim.timeScale}` : ''}`;
    $('#ffvCrit').innerHTML = v.items.map(i => `<tr class="${i.role === 'info' ? 'info' : ''}" data-at="${i.at == null ? '' : i.at}" title="${esc(i.label)} (${esc(i.op)} ${i.limit} ${esc(i.unit)})${i.role === 'info' ? ' · 참고 기준: Gate 판정에 쓰지 않음' : ''}${i.at != null ? ` · ${i.at} s — 누르면 타임라인에 표시` : ''}"><td class="s ${i.role === 'info' && i.status === 'fail' ? 'over' : i.status}" title="${i.role === 'info' && i.status === 'fail' ? '참고 초과' : ''}">${i.role === 'info' && i.status === 'fail' ? '!' : STI[i.status]}</td><td>${esc(i.label)} <span class="vnote">${i.op === '<=' ? '≤' : '≥'} ${i.limit} ${esc(i.unit)}</span></td><td class="role">${i.role === 'info' ? '참고' : '판정'}</td><td class="v">${i.value == null ? (i.id === 'min_ttc' && i.status === 'pass' ? '접근 없음' : '—') : i.value === Infinity ? '미완료' : `${i.value} ${esc(i.unit)}`}</td></tr>`).join('');
    $('#ffvReqs').innerHTML = `<colgroup><col style="width:24px"><col style="width:44px"><col><col style="width:74px"><col style="width:42px"><col style="width:50px"></colgroup><tr><th>#</th><th>t</th><th>요청</th><th>응답</th><th>지연</th><th>기대</th></tr>` + (r.reqs.length ? '' : '<tr><td colspan="6" style="color:var(--muted)">요청 없음</td></tr>') + r.reqs.slice(-6).map(q => `<tr title="${esc(q.id)} ${esc(q.label)}${q.response ? ` → ${esc(respText(q.response))}` : ''}${q.expect ? ` · 기대 ${esc(q.expect)}` : ''}"><td>${q.id.replace(/^REQ-/, '')}</td><td>${fmt(q.t_req, 1)}s</td><td title="${esc(q.label)}">${esc((q.label || '').replace(/^수동 · /, '✋ ')) || ({ FLAGS: '조회', CONTEXT: '문맥 보고', TRIAL_ACCEPT: '체험권 수락', OVERRIDE: 'Flag 변경', HELLO: 'HELLO', FAULT: '오류 보고', READBACK: '적용 회신' }[q.type] || esc(q.kind))}</td><td>${!q.response ? '…' : q.response.error ? `거부 ${q.response.status}` : q.response.outcome === 'DUPLICATE' ? '중복' : q.response.readback ? (q.response.readback.status === 'CONFIRMED' ? '회신 일치' : '회신 불일치') : q.response.advice ? `권고 ${q.response.advice}` : `${q.response.value ? 'ON' : 'OFF'} ${esc(q.response.metadata.decision)}`}</td><td>${q.latency_s == null ? '' : `${Math.round(q.latency_s * 1000)}ms`}</td><td class="${q.expect ? (q.match === false ? 'bad' : q.match ? 'ok' : '') : ''}">${q.expect ? `${EXP_SHORT[q.expect] || (q.response && q.response.status) || q.expect}${q.match == null ? '' : q.match ? ' ✔' : ' ✖'}` : ''}</td></tr>`).join('');
    if (tl) $('#ffvHud').innerHTML = `${esc(tc ? tc.id : '')} · ${describe(tl, true)}`;
  }
  /** Timeline from the feature's chart spec (series, reference line, two bands, legend) + events, vehicle requests, now / selected criterion. */
  function drawChart(cv, W, H, run) {
    const dpr = W ? 1 : Math.min(2, devicePixelRatio || 1); W = W || cv.clientWidth; H = H || cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const kept = S.pkg && S.results[tcs()[S.sel].id], r = run || S.run || (kept && kept.run), sc = r ? r.sc : S.pkg && tcs()[S.sel].scenario; if (!sc) return;
    const F = FEATURES[S.pkg.policy.featureId]; if (!F) return;
    const spec = F.chart(sc), padL = 48, padR = 88, padT = 8, band = 11, padB = 18 + 2 * band + 4, D = sc.duration_s, tel = r ? r.tel : [];
    const ymin = spec.ymin || 0, ymax = Math.max(spec.ymax, ...tel.flatMap(t => spec.series.map(q => t[q.key] || 0))) * (spec.ymin != null ? 1 : 1.05);
    let step = spec.step || 20; while ((ymax - ymin) / step > 6) step *= 2;
    const X = t => padL + (W - padL - padR) * t / D, Y = v => padT + (H - padT - padB) * (1 - (v - ymin) / (ymax - ymin));
    g.font = '10px "IBM Plex Mono",monospace'; g.fillStyle = 'rgba(232,237,243,.55)'; g.strokeStyle = 'rgba(232,237,243,.12)'; g.lineWidth = 1;
    for (let v = Math.ceil(ymin / step) * step; v <= ymax; v += step) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W - padR, Y(v)); g.stroke(); if (v !== ymin) g.fillText(`${v} ${spec.unit}`, 2, Y(v) + 3); }
    for (let t = 0; t <= D; t += 10) g.fillText(`${t}s`, X(t) - 8, H - 3);
    if (spec.ref) { g.setLineDash([4, 4]); g.strokeStyle = 'rgba(232,237,243,.35)'; g.beginPath(); g.moveTo(X(0), Y(spec.ref.v)); g.lineTo(X(D), Y(spec.ref.v)); g.stroke(); g.setLineDash([]); }
    // two bands under the plot (e.g. what the feature believed / the truth, or suppression / feature state)
    const bw = Math.max(1, X(.06) - X(0)), yb = [H - padB + 3, H - padB + band + 5];
    for (const t of tel) spec.bands.forEach((bd, i) => { g.fillStyle = bd.color(t) || '#555'; g.fillRect(X(t.sim_t), yb[i], bw, band - 1); });
    g.font = '9px "Malgun Gothic",system-ui,sans-serif'; g.fillStyle = 'rgba(232,237,243,.75)'; spec.bands.forEach((bd, i) => g.fillText(bd.label, 2, yb[i] + 9));
    spec.legend.forEach(([k, c], i) => { g.fillStyle = c; g.fillRect(W - padR + 4, padT + 58 + i * 11, 8, 8); g.fillStyle = 'rgba(232,237,243,.7)'; g.fillText(k, W - padR + 15, padT + 65 + i * 11); });
    for (const q of spec.series) { g.strokeStyle = q.color; g.lineWidth = q.width || 1.6; g.setLineDash(q.dash || []); g.beginPath(); let on = false;
      for (const t of tel) { if (t[q.key] == null) { on = false; continue; } on ? g.lineTo(X(t.sim_t), Y(t[q.key])) : g.moveTo(X(t.sim_t), Y(t[q.key])); on = true; } g.stroke(); g.setLineDash([]); }
    g.font = '10px "IBM Plex Mono",monospace';
    let lastX = -1e9, row = 0;
    for (const e of r ? r.events : []) {
      const lbl = EV_LABEL[e.type] || (e.type === 'vehicle_request' ? `요청 ${e.request.id.slice(-2)}` : e.type === 'anomaly_advice' ? `권고 ${e.advice}` : e.type === 'junction_passed' ? '통과' : null); if (!lbl) continue;
      const x = X(e.t); row = x - lastX < 70 ? row + 1 : 0; if (row === 0) lastX = x;   // stagger labels of close events
      g.strokeStyle = e.type === 'fault_injected' ? '#ef5b4c' : e.type === 'vehicle_request' ? '#a479e2' : e.type === 'anomaly_advice' ? '#f0b445' : '#3d7cf0'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke(); if (row < 3) { const tw = g.measureText(lbl).width, ty = padT + 9 + row * 11; g.fillStyle = 'rgba(11,15,20,.82)'; g.fillRect(x + 2, ty - 9, tw + 3, 11); g.fillStyle = g.strokeStyle; g.fillText(lbl, x + 3, ty); }   // backed so plot lines don't run through the text
    }
    if (S.cursor != null) { g.fillStyle = 'rgba(240,180,69,.18)'; g.fillRect(X(S.cursor) - 3, padT, 6, H - padT - padB); }
    if (r && !r.done) { g.strokeStyle = 'rgba(232,237,243,.7)'; g.beginPath(); g.moveTo(X(Math.min(r.t, D)), padT); g.lineTo(X(Math.min(r.t, D)), H - padB); g.stroke(); }
    g.font = '9.5px "Malgun Gothic",system-ui,sans-serif';
    [...spec.series.map(q => [`${q.dash ? '--' : '—'} ${q.label}`, q.color]), ...(spec.ref ? [[`-- ${spec.ref.label}`, 'rgba(232,237,243,.55)']] : []), ['| 차량 요청', '#a479e2']].forEach(([t, c], i) => { g.fillStyle = c; g.fillText(t, W - padR + 4, padT + 9 + i * 12); });
  }
  async function chartBytes(run) {
    const off = document.createElement('canvas'); drawChart(off, 1600, 360, run);
    const bg = document.createElement('canvas'); bg.width = 1600; bg.height = 360; const b2 = bg.getContext('2d'); b2.fillStyle = '#0c1015'; b2.fillRect(0, 0, 1600, 360); b2.drawImage(off, 0, 0);
    return new Promise(res => bg.toBlob(b => b.arrayBuffer().then(x => res(new Uint8Array(x))), 'image/png'));
  }
  /** Gate evidence package: gate_report.html + gate.json + one folder per executed test case. */
  async function exportGate() {
    if (!S.pkg || !Object.keys(S.results).length) return;
    const files = [], runs = {}, stamp = new Date();
    for (const t of tcs()) {
      const res = S.results[t.id]; if (!res) continue;
      const ev = res.run.evidence({ captures: [...res.caps].sort((a, b) => a.t - b.t), chartPng: res.chartPng, testId: `TEST-${t.id}-${ymd(stamp)}-${String(stamp.getTime()).slice(-5)}` });
      runs[t.id] = { overall: res.overall, testId: ev.testId }; ev.files.forEach(f => files.push({ name: `${t.id}/${f.name}`, data: f.data }));
    }
    const g = gateVerdict(S.pkg, runs), veh = baseVehicle();
    files.unshift({ name: 'gate.json', data: JSON.stringify({ ...g, vehicle: veh, assumedDeployed: $('#ffvDeploy').checked, generatedAt: stamp.toISOString(), internalOnly: true, simulator: FFVAL_VERSION }, null, 1) });
    files.unshift({ name: 'gate_report.html', data: gateReportHtml(g, veh, Object.fromEntries(tcs().filter(t => S.results[t.id]).map(t => [t.id, S.results[t.id].run.verdict()]))) });
    // integrity: SHA-256 of every file (the gate system records these hashes as the evidence reference)
    const enc = new TextEncoder(), sha = async d => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof d === 'string' ? enc.encode(d) : d))].map(b => b.toString(16).padStart(2, '0')).join('');
    files.push({ name: 'manifest.json', data: JSON.stringify({ generatedAt: stamp.toISOString(), simulator: FFVAL_VERSION, files: await Promise.all(files.map(async f => ({ name: f.name, bytes: typeof f.data === 'string' ? enc.encode(f.data).length : f.data.length, sha256: await sha(f.data) }))) }, null, 1) });
    const name = `GATE-${S.pkg.gate.id}-${S.pkg.policy.featureId}-${ymd(stamp)}-${String(stamp.getTime()).slice(-5)}.zip`;
    const blob = new Blob([zip(files)], { type: 'application/zip' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('#ffvNote').textContent = `Gate 증적 저장: ${name} (시험 ${Object.keys(runs).length}/${tcs().length}, 파일 ${files.length}개)`;
  }

  /* ---------------- wiring ---------------- */
  function open(on) { S.open = on; document.body.classList.toggle('ffv-on', on); if (!on) { stopAll(); ivi.feature = null; } panels(); }
  $('#ffvClose').onclick = () => open(false);
  $('#ffvOpen').onclick = () => $('#ffvFile').click();
  $('#ffvFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (!f) return; f.text().then(t => setPackage(JSON.parse(t), f.name)).catch(err => { $('#ffvNote').textContent = `파일을 읽지 못했습니다: ${err.message}`; }); e.target.value = ''; });
  $('#ffvSample').onclick = () => { const f = `${$('#ffvSampleSel').value}_sample.json`; if (S.run && !S.run.done) return; fetch(`./ff/${f}`).then(r => r.json()).then(j => setPackage(j, f)); };
  for (const id of ['#ffvVeh', '#ffvDeploy']) $(id).addEventListener('change', reevaluate);
  $('#ffvTcs').addEventListener('click', e => { const li = e.target.closest('li'); if (li && !(S.run && !S.run.done)) selectTc(+li.dataset.i); });
  $('#ffvRun').onclick = () => { S.queue = []; start(S.sel); }; $('#ffvRunAll').onclick = runAll; $('#ffvStop').onclick = stopAll; $('#ffvExport').onclick = exportGate; $('#ffvView').onclick = viewCam;
  $('#ffvSpeed').onchange = () => { if (S.run && !S.run.done) sim.timeScale = +$('#ffvSpeed').value; };
  $('#ffvCrit').addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr && tr.dataset.at !== '') { S.cursor = +tr.dataset.at; drawChart($('#ffvChart')); } });
  // operator-issued vehicle requests; the last three are negative checks the vehicle channel must refuse
  $('#rqSend').onclick = () => {
    const k = $('#rqSel').value, sw = $('#rqSw').value.trim(), other = (S.pkg.fleet.find(v => S.run && v.vin !== S.run.vehicle.vin) || {}).vin;
    const R = { query: [{ kind: 'query' }, 'Flag 조회'], trial: [{ kind: 'trial_accept' }, '체험 수락'], stale: [{ kind: 'update', set: { quality: 'STALE' } }, '통신 품질 저하'],
      trusted: [{ kind: 'update', set: { quality: 'TRUSTED' } }, '통신 회복'], sw: [{ kind: 'update', set: { swVersion: sw } }, `SW ${sw}`],
      scope: [{ kind: 'query', vin: other, expect: 'REJECTED' }, `다른 차량 ${other} 조회`], trim: [{ kind: 'update', set: { trim: 'Modern' }, expect: 'REJECTED' }, 'trim 변경'],
      override: [{ kind: 'override', value: false, expect: 'REJECTED' }, 'Flag 직접 변경'],
      readback: [{ kind: 'readback' }, '적용 회신'], hello: [{ kind: 'hello' }, '재부팅 HELLO'], fault: [{ kind: 'fault', code: 'SELF_DIAG', severity: 'CRITICAL' }, '오류 보고 CRITICAL'],
      oldboot: [{ kind: 'update', bootId: 'BOOT-0', sequence: 1, set: { link: 'ONLINE' }, expect: 'BOOT_MISMATCH' }, '옛 부팅 키로 보고'] }[k];
    if (R) req(R[0], R[1]);
  };
  buttons();
  return { open, afterRender, start, runAll, stop: stopAll, exportGate, setPackage, state: S, isOpen: () => S.open };
}
