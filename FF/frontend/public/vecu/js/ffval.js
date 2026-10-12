// Feature Flag virtual validation for the pre-deployment verification gate (G5): load an FF platform policy package with
// its gate test plan, decide ON/OFF for a virtual vehicle with the platform's own evaluator, drive the feature's
// vehicle-side runtime in the simulation (fault injection, Kill over a simulated link, flag queries and reports sent by the
// vehicle), judge each test case against its gate criteria and produce evidence in FF_IMP formats.
// No three.js / DOM here, so the whole run can be exercised under Node (tests/js/*.test.mjs).
import { evaluateFlag } from './vendor/ff_evaluate.js';
import { createRuntime as rt22, stageOf } from './features/feat00022.js';
import { createRuntime as rt23, driverDemand } from './features/feat00023.js';
import { createRuntime as rt24 } from './features/feat00024.js';

/** Simulator / validation tool identification recorded in every evidence file. */
export const FFVAL_VERSION = 'Ausfahrt Test Drive (vECU) · ffval 1.3 (2026-10-12) · FF evaluator @ff/contracts 0.81.0';
const RANK = { '정상': 0, '주의': 1, '위험': 2 };
const OBSERVED = ['swVersion', 'quality', 'link'];   // vehicle-reported (observed) attributes; everything else comes from trusted sources
const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Vehicle channel limits of the FF platform (contracts/src/rules/vehicle-requests.ts). */
export const VEHICLE_RATE_LIMIT = { requests: 30, windowMs: 10000 };
const REPORT_TYPES = { hello: 'HELLO', update: 'CONTEXT', context: 'CONTEXT', trial_accept: 'TRIAL_ACCEPT', fault: 'FAULT', readback: 'READBACK', override: 'OVERRIDE' };

// criteria shared by every feature
const C_KILL = { id: 'kill_latency', label: 'Kill → Safe Default 적용', unit: 's', op: '<=', limit: 1.0 };
const C_DECEL = { id: 'max_decel', label: '최대 감속', unit: 'm/s²', op: '<=', limit: 2.8 };
const C_REQ = [{ id: 'request_latency', label: '차량 요청 → 응답·반영 (최장)', unit: 's', op: '<=', limit: 1.0 },
  { id: 'request_expected', label: '차량 요청 응답 불일치 (기대 결과 대비)', unit: '건', op: '<=', limit: 0 }];
const STATE_C = { ACTIVE: '#5cc47d', SAFE_DEFAULT: '#f0b445', DISABLED: 'rgba(149,162,179,.35)' };

/**
 * Feature registry. Each entry is an adapter between the run and the feature's vehicle-side runtime:
 *  create(sc, v0)       -> runtime {state, applyKill(t), ...}
 *  step(run, rt, t, dt, inp) -> {accel (ego acceleration request or null = vehicle's own control), tel: {...}, ivi?}
 *  values(run, m, end)  -> {criterionId: [value, at] | 'na' | null}
 *  arrange              -> how the UI places the lead car ('follow': at the target gap, 'free': far ahead)
 *  chart / worst        -> what the UI plots and which moment is captured as "worst"
 */
export const FEATURES = {
  'FEAT-00022': {
    name: '전방 안전거리 3단계', asil: 'B', controlPoint: 'Parameter', arrange: 'follow',
    faultLabel: sc => `거리 추정 오류 주입 (최대 ×${sc.fault.bias_max})`,
    create: (sc, v0) => rt22({ target_gap_m: sc.target_gap_m, fault_at: sc.fault ? sc.fault.at_s : Infinity, fault_ramp: sc.fault ? sc.fault.ramp_s : 8, fault_bias_max: sc.fault ? sc.fault.bias_max : 1 }, v0),
    init: () => ({ misRun: 0, misMax: 0, misAt: null, danger: 0, dangerAt: null, minTtc: Infinity, minTtcAt: null, minTg: Infinity, minTgAt: null, recoveredAt: null, stage: null }),
    step(run, rt, t, dt, inp) {
      const m = run.m, out = rt.step(t, dt, inp.gap_true, inp.ego_mps, inp.lead_mps), feat = run.on ? out : { ...out, stage_feature: null };
      const closing = inp.ego_mps - inp.lead_mps, ttc = closing > .1 ? inp.gap_true / closing : null, tg = inp.gap_true / Math.max(inp.ego_mps, 1);
      if (feat.stage_true !== m.stage) { if (m.stage) run.ev('stage_true', `실제 단계 ${m.stage} → ${feat.stage_true}`); m.stage = feat.stage_true; }
      const mis = run.on && rt.state === 'ACTIVE' && feat.stage_feature && RANK[feat.stage_feature] < RANK[feat.stage_true];
      m.misRun = mis ? m.misRun + dt : 0; if (m.misRun > m.misMax) { m.misMax = m.misRun; m.misAt = t; }
      if (feat.stage_true === '위험') { m.danger += dt; if (m.dangerAt == null) m.dangerAt = t; }
      if (ttc != null && ttc < m.minTtc) { m.minTtc = ttc; m.minTtcAt = t; }
      if (tg < m.minTg) { m.minTg = tg; m.minTgAt = t; }
      if (run.k.killApplied != null && m.recoveredAt == null && feat.stage_true === '정상') m.recoveredAt = t;
      return { accel: clamp((out.cmd_mps - inp.ego_mps) / .6, -9, 4), fault: out.fault_active,   // the vehicle follows the feature command (first-order, as in FF_IMP)
        tel: { gap_true: r2(inp.gap_true), gap_est: r2(feat.gap_est), stage_feature: feat.stage_feature, stage_true: feat.stage_true, cmd_kph: r2(out.cmd_mps * 3.6), ttc: r2(ttc) } };
    },
    values: (run, m, end) => ({
      misjudge: [m.misMax, m.misAt], danger_time: [m.danger, m.dangerAt], min_ttc: [m.minTtc === Infinity ? null : m.minTtc, m.minTtcAt],
      recovery: run.k.killApplied == null ? (!run.sc.kill || !run.on ? 'na' : null) : m.recoveredAt != null ? [m.recoveredAt - run.k.killApplied, m.recoveredAt] : end ? [Infinity, null] : null }),
    criteria: [C_KILL,
      { id: 'misjudge', label: '기능 오판단 최장 지속 (실제보다 안전하다고 판단)', unit: 's', op: '<=', limit: 2.0 },
      { id: 'danger_time', label: "실제 '위험' 단계 누적", unit: 's', op: '<=', limit: 0 },
      { id: 'min_ttc', label: '최소 TTC', unit: 's', op: '>=', limit: 2.0 }, C_DECEL,
      { id: 'recovery', label: "Safe Default 후 실제 '정상' 복귀", unit: 's', op: '<=', limit: 15 }, ...C_REQ],
    worst: m => (m.minTg < Infinity ? { v: m.minTg, at: m.minTgAt, label: `최소 차간 시간 ${m.minTg.toFixed(2)} s`, lowerIsWorse: true } : null),
    summary: m => ({ minTimeGap: r2(m.minTg), minTimeGapAt: r2(m.minTgAt) }),
    chart: sc => ({ unit: 'm', ymax: Math.max(sc.target_gap_m * 1.6, 60), ref: { v: sc.target_gap_m, label: '목표 거리' },
      series: [{ key: 'gap_true', label: '실제 거리', color: '#e8edf3', width: 1.8 }, { key: 'gap_est', label: '기능 추정', color: '#f0b445', width: 1.6 }],
      bands: [{ label: '기능 판단', color: r => (r.stage_feature ? STAGE_C[r.stage_feature] : STATE_C.DISABLED) }, { label: '실제 단계', color: r => STAGE_C[r.stage_true] }],
      legend: [['정상', STAGE_C['정상']], ['주의', STAGE_C['주의']], ['위험', STAGE_C['위험']], ['비활성', STATE_C.DISABLED]] }),
  },
  'FEAT-00023': {
    name: '급가속 억제', asil: 'B', controlPoint: 'Parameter', arrange: 'free', provisional: true,
    faultLabel: sc => `억제 한계 파라미터 손상 → 과억제 (${sc.fault.limit_a != null ? sc.fault.limit_a : .3} m/s²)`,
    create: sc => rt23({}, sc),
    init: () => ({ aPeak: 0, aPeakAt: null, jPeak: 0, jPeakAt: null, resp: 0, respAt: null, ev: null, suppressN: 0, prevSup: false }),
    step(run, rt, t, dt, inp) {
      const m = run.m, sc = run.sc, aReq = driverDemand(sc, t, inp.ego_mps), out = rt.step(t, dt, aReq), active = run.on && rt.state === 'ACTIVE';
      if (active && out.a_cmd > m.aPeak) { m.aPeak = out.a_cmd; m.aPeakAt = t; }
      if (active && out.jerk > m.jPeak) { m.jPeak = out.jerk; m.jPeakAt = t; }
      if (out.suppressing && !m.prevSup && active) { m.suppressN++; run.ev('suppression', `급가속 억제 동작 (요구 ${aReq.toFixed(1)} → 한계 ${out.limit.toFixed(1)} m/s²)`); }
      m.prevSup = out.suppressing && active;
      // response: from the start of each strong pedal event until the vehicle reaches 90 % of the expected (suppressed) level
      const pe = (sc.pedal || []).find(p => t >= p.at_s && t < p.at_s + p.dur_s && p.accel_req > rt.cfg.trigger_a);
      if (pe && active) {
        m.strongSeen = true; if (!m.ev || m.ev.p !== pe) m.ev = { p: pe, done: false };
        const goal = .9 * Math.min(pe.accel_req, rt.cfg.a_max);
        if (!m.ev.done && (out.a_cmd >= goal || t + dt >= pe.at_s + pe.dur_s)) { m.ev.done = true; const r = t - pe.at_s; if (r > m.resp) { m.resp = out.a_cmd >= goal ? r : pe.dur_s; m.respAt = t; } }
      }
      return { accel: out.a_cmd, fault: out.fault_active, suppressing: out.suppressing && active,
        tel: { a_req: r2(aReq), a_cmd: r2(out.a_cmd), a_limit: active ? r2(out.limit) : null, suppressing: out.suppressing && active, jerk: r2(out.jerk) } };
    },
    values: (run, m, end) => {
      // response is judged only for strong pedal events that happen while the feature is active
      return { accel_peak: [m.aPeak, m.aPeakAt], jerk_peak: [m.jPeak, m.jPeakAt], accel_response: m.respAt != null ? [m.resp, m.respAt] : end ? 'na' : null };
    },
    criteria: [C_KILL,
      { id: 'accel_peak', label: '억제 중 최대 가속 (한계 2.0 + 0.1, 가정값)', unit: 'm/s²', op: '<=', limit: 2.1 },
      { id: 'jerk_peak', label: '최대 가속 상승률 (jerk, 가정값)', unit: 'm/s³', op: '<=', limit: 3.3 },
      { id: 'accel_response', label: '급가속 요구 → 억제 수준 도달 (과억제 감시, 가정값)', unit: 's', op: '<=', limit: 1.5 }, C_DECEL, ...C_REQ],
    worst: m => (m.aPeak > 0 ? { v: m.aPeak, at: m.aPeakAt, label: `억제 중 최대 가속 ${m.aPeak.toFixed(2)} m/s²` } : null),
    summary: m => ({ accelPeak: r2(m.aPeak), jerkPeak: r2(m.jPeak), suppressions: m.suppressN }),
    chart: () => ({ unit: 'm/s²', ymin: -1, ymax: 4.5, step: 1,
      series: [{ key: 'a_req', label: '운전자 요구', color: '#e8edf3', width: 1.4, dash: [4, 3] }, { key: 'a_cmd', label: '실제 가속', color: '#f0b445', width: 1.8 },
        { key: 'a_limit', label: '적용 한계', color: '#ef5b4c', width: 1, dash: [2, 3] }],   // the limit actually applied (drops under the over-suppression fault)
      bands: [{ label: '억제 동작', color: r => (r.suppressing ? '#3d7cf0' : 'rgba(149,162,179,.18)') }, { label: '기능 상태', color: r => STATE_C[r.feature_state] }],
      legend: [['억제 중', '#3d7cf0'], ['동작', STATE_C.ACTIVE], ['Safe Default', STATE_C.SAFE_DEFAULT], ['비활성', STATE_C.DISABLED]] }),
  },
  'FEAT-00024': {
    name: 'IC·JC 경로 사전안내', asil: 'QM', controlPoint: 'Signal', arrange: 'free', provisional: true,
    faultLabel: sc => `지도 거리 오류 주입 (+${sc.fault.offset_m} m, 오래된 지도)`,
    create: sc => rt24({}, sc),
    init: () => ({ firstAt: null, firstDist: null, errMax: 0, errAt: null, passT: null, clearT: null, offShown: 0, offAt: null, shown: false }),
    step(run, rt, t, dt, inp) {
      const m = run.m, out = rt.step(t, dt, run.dist), g = out.guidance, J = run.sc.junction || {};
      if (g && m.firstAt == null) { m.firstAt = t; m.firstDist = out.dist_true; run.ev('guidance_shown', `${J.type || ''} 안내 시작 · 남은 거리 ${Math.round(out.dist_true)} m (표시 ${g.dist_m} m)`); }
      if (g && out.dist_true >= 0) { const e = Math.abs(g.dist_m - out.dist_true); if (e > m.errMax) { m.errMax = e; m.errAt = t; } }
      if (out.dist_true < 0 && m.passT == null) { m.passT = t; run.ev('junction_passed', `${J.name || '분기점'} 통과`); }
      if (m.passT != null && m.clearT == null && !g) { m.clearT = t; run.ev('guidance_cleared', `안내 종료 (통과 후 ${(t - m.passT).toFixed(1)} s)`); }
      if (g && (!run.on || rt.state !== 'ACTIVE')) { m.offShown += dt; if (m.offAt == null) m.offAt = t; }
      // the vehicle just cruises (its own speed control); the feature only drives the IVI signal
      return { accel: clamp(.5 * (run.sc.lead_kph / 3.6 - inp.ego_mps), -1.5, 1.2), fault: out.fault_active, guidance: g,
        tel: { dist_true: r2(out.dist_true), dist_shown: g ? g.dist_m : null, guidance: g ? g.phase : null, direction: g ? g.direction : null } };
    },
    values: (run, m, end) => ({
      first_announce: m.firstAt != null ? [m.firstDist, m.firstAt] : m.passT != null || end ? (run.on ? [0, null] : 'na') : null,
      dist_error: m.firstAt != null ? [m.errMax, m.errAt] : end ? 'na' : null,
      clear_after_pass: m.passT == null ? (end ? 'na' : null) : m.clearT != null ? [m.clearT - m.passT, m.clearT] : end ? [Infinity, null] : null,
      off_no_guidance: [m.offShown, m.offAt] }),
    criteria: [C_KILL,
      { id: 'first_announce', label: '첫 안내 시점의 남은 거리 (가정값)', unit: 'm', op: '>=', limit: 700 },
      { id: 'dist_error', label: '안내 거리 오차 최대 (가정값)', unit: 'm', op: '<=', limit: 20 },
      { id: 'clear_after_pass', label: '통과 후 안내 종료 (가정값)', unit: 's', op: '<=', limit: 3 },
      { id: 'off_no_guidance', label: 'OFF·차단 중 안내 표시', unit: 's', op: '<=', limit: 0 }, ...C_REQ],
    worst: m => (m.errMax > 0 ? { v: m.errMax, at: m.errAt, label: `안내 거리 오차 ${m.errMax.toFixed(0)} m` } : null),
    summary: m => ({ firstAnnounceM: r2(m.firstDist), distErrorMax: r2(m.errMax) }),
    chart: sc => ({ unit: 'm', ymin: 0, ymax: Math.max(1000, ((sc.junction || {}).at_m || 800) * 1.05), step: 200, ref: { v: 800, label: '안내 시작 거리' },
      series: [{ key: 'dist_true', label: '실제 남은 거리', color: '#e8edf3', width: 1.8 }, { key: 'dist_shown', label: '안내 표시', color: '#f0b445', width: 1.8 }],
      bands: [{ label: '안내', color: r => ({ 사전: '#2b6cb0', 접근: '#3d7cf0', 임박: '#a479e2' }[r.guidance] || 'rgba(149,162,179,.18)') }, { label: '기능 상태', color: r => STATE_C[r.feature_state] }],
      legend: [['사전', '#2b6cb0'], ['접근', '#3d7cf0'], ['임박', '#a479e2'], ['Safe Default', STATE_C.SAFE_DEFAULT]] }),
  },
};
const STAGE_C = { '정상': '#5cc47d', '주의': '#f0b445', '위험': '#ef5b4c' };
export { stageOf };

const SCENARIO_DEFAULTS = { name: '기본', duration_s: 60, lead_kph: 80, target_gap_m: 40, fault: null, kill: null, link_latency_ms: 300, vehicle_requests: [], criteria: null, ops: null };

/**
 * Accepts a validation package ({policy, scope, fleet, vehicle, entitlementActive, scenario | tests[], gate}) or a bare FF
 * Policy. `tests` is the gate test plan: [{id, name, purpose, steps[], expected[], preconditions:{entitlementActive, vehicle},
 * scenario:{..., vehicle_requests[], criteria:{gate:[ids], info:[ids]}}}]; without it the single `scenario` is one test.
 */
export function loadPackage(json) {
  const p = json.policy ? json : { policy: json };
  if (!p.policy || !/^FEAT-\d{5}$/.test(p.policy.featureId || '')) throw new Error('FF 정책(Policy) 형식이 아닙니다: featureId(FEAT-00000) 필요');
  const fleet = p.fleet || [], scenario = Object.assign({}, SCENARIO_DEFAULTS, p.scenario || {});
  const tests = (p.tests && p.tests.length ? p.tests : [{ id: scenario.scenarioId || 'TC-01', name: scenario.name, scenario }])
    .map((t, i) => ({ id: t.id || `TC-${String(i + 1).padStart(2, '0')}`, name: t.name || t.id, purpose: t.purpose || '', steps: t.steps || [], expected: t.expected || [],
      preconditions: t.preconditions || {}, scenario: Object.assign({}, SCENARIO_DEFAULTS, t.scenario || {}, { name: t.name || (t.scenario && t.scenario.name) || SCENARIO_DEFAULTS.name }) }));
  return {
    policy: p.policy, scope: p.scope || null, fleet, vehicleVin: p.vehicle || (fleet[0] && fleet[0].vin) || null,
    entitlementActive: p.entitlementActive === undefined ? true : p.entitlementActive,
    scenario, tests, gate: Object.assign({ id: 'G5', name: '검증 Gate (배포 전)' }, p.gate || {}),
    supported: !!FEATURES[p.policy.featureId],
  };
}

/** The package as one test case sees it: its scenario and preconditions (entitlement, vehicle context overrides). */
export function forTest(pkg, test) {
  const pre = test.preconditions || {};
  return { ...pkg, scenario: test.scenario, test, entitlementActive: pre.entitlementActive === undefined ? pkg.entitlementActive : pre.entitlementActive, vehicleOverrides: pre.vehicle || null };
}

/** Platform evaluation. Before deployment the policy is not DEPLOYED, so `assumeDeployed` evaluates it as if it were. */
export async function evaluate(pkg, vehicle, { assumeDeployed = true, killed = false } = {}) {
  const policy = assumeDeployed && pkg.policy.status !== 'DEPLOYED' ? { ...pkg.policy, status: 'DEPLOYED' } : pkg.policy;
  const scope = pkg.scope || { country: vehicle.country, vehicleModel: vehicle.vehicleModel, trim: vehicle.trim };
  return evaluateFlag({ policy, scope, killed, vehicle, entitlementActive: pkg.entitlementActive });
}

/** FF anomaly rule (contracts/src/rules/anomaly.ts) for one vehicle's FAULT reports: CRITICAL, or ASIL ≥ B and ≥ 2 VINs -> KILL. */
export function anomalyAdvice(asil, faults) {
  const vins = new Set(faults.map(f => f.vin));
  if (faults.some(f => f.severity === 'CRITICAL') || vins.size >= 3 || (/^[BCD]$/.test(asil) && vins.size >= 2)) return 'KILL';
  return faults.some(f => f.severity === 'WARNING') ? 'INVESTIGATE' : 'MONITOR';
}

export class ValidationRun {
  /** @param o {pkg, vehicle, flag (FlagResult), clockBase?: Date, sceneId, simVersion} */
  constructor(o) {
    Object.assign(this, { pkg: o.pkg, vehicle: o.vehicle, flag: o.flag, sceneId: o.sceneId || '', simVersion: o.simVersion || '' });
    const sc = this.sc = o.pkg.scenario, F = this.feature = FEATURES[o.pkg.policy.featureId];
    if (!F) throw new Error(`${o.pkg.policy.featureId}: 이 시뮬레이터에 차량 측 런타임이 없습니다`);
    this.on = !!(o.flag && o.flag.value);
    this.rt = F.create(sc, sc.lead_kph / 3.6); this.m = F.init();
    if (!this.on) this.rt.applyKill(0);   // flag OFF: the vehicle runs its basic behaviour from the start
    this.base = (o.clockBase || new Date()).getTime();
    this.t = 0; this.frame = 0; this.done = false; this.tel = []; this.events = []; this.nextTel = 0; this.dist = 0; this.out = null;
    // vehicle-side context (changes with reports), flag requests/reports sent by the vehicle, the report channel state
    this.ctx = { ...o.vehicle }; this.ent = o.pkg.entitlementActive; this.killed = false;
    this.trial = o.pkg.trial || (this.ent ? 'ACTIVE' : 'NONE');   // OFFERED | ACTIVE | NONE (package field `trial`)
    this.reqs = []; this.sched = [...(sc.vehicle_requests || [])].sort((a, b) => a.at_s - b.at_s); this.roles = sc.criteria || null;
    this.boot = { id: 'BOOT-1', seq: 0, last: -1 }; this.seen = {}; this.window = []; this.faults = [];
    this.k = { maxDecel: 0, maxDecelAt: null, killIssued: null, killApplied: null };
    this.pendingKill = null; this.adviceKillAt = null;
    this.ev('policy_evaluated', `${o.flag ? `${o.flag.decision} · ${o.flag.reason} → ${this.on ? 'ON' : 'OFF'}` : '평가 없음'}`, { flag: o.flag });
    this.ev(this.on ? 'feature_active' : 'feature_disabled', this.on ? `${F.name} 동작` : `정책 OFF — 기본 동작으로 시험`);
  }
  iso(t) { return new Date(this.base + t * 1000).toISOString(); }
  ev(type, detail, extra) { this.events.push(Object.assign({ t: r2(this.t), type, detail }, extra || {})); }
  get state() { return !this.on ? 'DISABLED' : this.rt.state; }

  /** One simulation step. inp = {gap_true (m, bumper to bumper), ego_mps, lead_mps, ego_a}. Returns the ego acceleration request (null = vehicle's own control). */
  step(dt, inp) {
    if (this.done) return null;
    const t = this.t, sc = this.sc, k = this.k, F = this.feature;
    while (this.sched.length && t >= this.sched[0].at_s) { const q = this.sched.shift(); for (let i = 0; i < (q.repeat || 1); i++) this.request(q); }
    this.serveRequests(t);
    // Kill: scheduled by the scenario, or the operator acting on a KILL advice from the anomaly rule (scenario.ops)
    const killAt = Math.min(sc.kill ? sc.kill.at_s : Infinity, this.adviceKillAt != null ? this.adviceKillAt : Infinity);
    if (this.on && k.killIssued == null && t >= killAt) {
      k.killIssued = t; this.killed = true; const safeMode = (sc.kill && sc.kill.safe_mode) || 'SAFE_DEFAULT';
      this.ev('kill_issued', `긴급 차단 발동 (${safeMode})${this.adviceKillAt != null && t >= this.adviceKillAt ? ' · 이상 징후 KILL 권고에 따른 운영자 조치' : ''}`, { at: this.iso(t), safe_mode: safeMode });
      this.pendingKill = t + (sc.link_latency_ms || 0) / 1000;
    }
    if (this.pendingKill != null && t >= this.pendingKill) {
      this.pendingKill = null; this.rt.applyKill(t); k.killApplied = t; const ms = Math.round((t - k.killIssued) * 1000);
      this.ev('safe_default_applied', `Safe Default 적용 (${ms} ms)`, { at: this.iso(t), state: 'SAFE_DEFAULT', latency_ms: ms });
    }
    if (sc.fault && t < sc.fault.at_s && t + dt >= sc.fault.at_s) this.ev('fault_injected', F.faultLabel(sc));
    const out = this.out = F.step(this, this.rt, t, dt, inp);
    if (-(inp.ego_a || 0) > k.maxDecel) { k.maxDecel = -(inp.ego_a || 0); k.maxDecelAt = t; }
    this.dist += inp.ego_mps * dt;
    if (t >= this.nextTel) {
      this.nextTel += .05;   // 20 Hz telemetry: FF_IMP common fields, the feature's own fields, ego_a
      this.tel.push({ frame: this.frame++, sim_t: r2(t), ego_kph: r2(inp.ego_mps * 3.6), lead_kph: r2(inp.lead_mps * 3.6), feature_state: this.state, fault_active: !!out.fault, ...out.tel, ego_a: r2(inp.ego_a) });
    }
    this.t = t + dt;
    if (this.t >= sc.duration_s) { this.done = true; this.ev('run_end', '시나리오 종료'); }
    return out.accel;
  }

  /**
   * A request sent by the vehicle over the FF vehicle channel (scheduled in the scenario or issued by the operator):
   *  - query (POST /vehicle/v1/:vin/flags/:key): own VIN only, else 403 VEHICLE_SCOPE.
   *  - reports (POST /vehicle/v1/:vin/reports) in an envelope {bootId, sequence, observedAt}:
   *      HELLO        (kind 'hello')        new boot: bootId changes, sequences restart
   *      CONTEXT      ('update')            observed attributes only (swVersion|quality|link), else 400 TRUST_SOURCE_FIELD
   *      TRIAL_ACCEPT ('trial_accept')      accepts the offered trial: grant ACTIVE for 30 days -> ON (FF 2026-10-13: period
   *                                         trials OFFERED -> ACTIVE -> EXPIRED/DECLINED/CONVERTED); none offered or
   *                                         already running -> 422 GUARD_FAILED
   *      FAULT        ('fault')             {code, severity}; anomaly rule -> advice (CRITICAL -> KILL)
   *      READBACK     ('readback')          {observed}: compared with the platform's decision -> CONFIRMED | DIVERGED
   *      OVERRIDE     ('override')          always 403 VEHICLE_OVERRIDE_FORBIDDEN
   *    Same (vin, bootId, sequence) and body -> DUPLICATE (replayed, no effect); different body -> 409 IDEMPOTENCY_KEY_REUSED;
   *    sequence not increasing -> 409 OLD_SEQUENCE; unknown bootId without HELLO -> 409 BOOT_MISMATCH;
   *    more than 30 requests per VIN in 10 s -> 429 RATE_LIMITED (Retry-After).
   * Answers carry the re-evaluated flag (OFREP) and reach the vehicle after the link latency; for this vehicle they switch
   * the feature ON/OFF (a Kill in force always wins). `expect`: 'ON'|'OFF'|'REJECTED'|<error code>|'DUPLICATE'|'ACCEPTED'|'CONFIRMED'|'DIVERGED'.
   */
  request(req) {
    const t = this.t, P = this.pkg.policy, vin = req.vin || this.vehicle.vin, own = vin === this.vehicle.vin, kind = req.kind || 'query';
    const type = kind === 'query' ? 'FLAGS' : REPORT_TYPES[kind] || String(kind).toUpperCase();
    const rec = { id: `REQ-${String(this.reqs.length + 1).padStart(2, '0')}`, t_req: r2(t), kind, type, vin, flagKey: P.flagKey, label: req.label || '', expect: req.expect || null, set: req.set || null };
    for (const f of ['entitlementActive', 'value', 'code', 'severity', 'observed', 'detail']) if (req[f] !== undefined) rec[f] = req[f];
    if (type !== 'FLAGS') {   // report envelope
      rec.bootId = req.bootId || (type === 'HELLO' ? `BOOT-${Number(this.boot.id.split('-')[1]) + 1}` : this.boot.id);
      rec.sequence = req.sequence != null ? req.sequence : rec.bootId === this.boot.id ? Math.max(this.boot.seq, this.boot.last) + 1 : 0;
      if (rec.bootId === this.boot.id && req.sequence == null) this.boot.seq = rec.sequence;
      rec.observedAt = this.iso(t);
    }
    const reject = (status, code, message) => { rec.result = { rejected: { status, code, message } }; };
    rec.due = t + (this.sc.link_latency_ms || 0) / 1000;
    // FF processing order: own VIN -> rate limit -> idempotency -> ordering -> handler -> re-evaluation
    this.window = this.window.filter(w => t - w < VEHICLE_RATE_LIMIT.windowMs / 1000);
    const body = JSON.stringify({ type, set: rec.set, entitlementActive: rec.entitlementActive, value: rec.value, code: rec.code, severity: rec.severity, observed: rec.observed });
    const key = `${vin}|${rec.bootId}|${rec.sequence}`, prev = rec.bootId != null ? this.seen[key] : null;
    if (!own) reject(403, 'VEHICLE_SCOPE', '자기 VIN만 조회·보고 가능');
    else if (this.window.length >= VEHICLE_RATE_LIMIT.requests) reject(429, 'RATE_LIMITED', `VIN당 ${VEHICLE_RATE_LIMIT.requests}회/${VEHICLE_RATE_LIMIT.windowMs / 1000}s 초과 · Retry-After ${Math.max(1, Math.ceil(VEHICLE_RATE_LIMIT.windowMs / 1000 - (t - this.window[0])))} s`);
    else if (prev && prev.body === body) { rec.duplicateOf = prev.id; rec.result = { duplicate: true }; }
    else if (prev) reject(409, 'IDEMPOTENCY_KEY_REUSED', `${key} 에 다른 내용`);
    else if (type !== 'FLAGS' && type !== 'HELLO' && rec.bootId !== this.boot.id) reject(409, 'BOOT_MISMATCH', `현재 부팅 ${this.boot.id}, 보고 ${rec.bootId} — HELLO 먼저`);
    else if (type !== 'FLAGS' && type !== 'HELLO' && rec.sequence <= this.boot.last) reject(409, 'OLD_SEQUENCE', `sequence ${rec.sequence} ≤ ${this.boot.last}`);
    else if (type === 'OVERRIDE') reject(403, 'VEHICLE_OVERRIDE_FORBIDDEN', '차량은 Flag 값을 직접 바꿀 수 없음');
    else if (type === 'CONTEXT' && (Object.keys(rec.set || {}).some(k => !OBSERVED.includes(k)) || rec.entitlementActive !== undefined))
      reject(400, 'TRUST_SOURCE_FIELD', `신뢰 원천 속성 변경 불가: ${[...Object.keys(rec.set || {}).filter(k => !OBSERVED.includes(k)), ...(rec.entitlementActive !== undefined ? ['entitlementActive'] : [])].join(', ')}`);
    else if (type === 'TRIAL_ACCEPT' && this.trial !== 'OFFERED') reject(422, 'GUARD_FAILED', this.trial === 'ACTIVE' ? '이미 체험 중' : '제안된 체험 없음');
    else if (!['FLAGS', 'HELLO', 'CONTEXT', 'TRIAL_ACCEPT', 'FAULT', 'READBACK'].includes(type)) reject(400, 'VALIDATION', `알 수 없는 요청 ${kind}`);
    else {   // accepted: apply, then re-evaluate this vehicle's flag
      if (type === 'HELLO') { this.boot = { id: rec.bootId, seq: rec.sequence, last: rec.sequence }; rec.redeliver = []; }
      else if (type !== 'FLAGS') this.boot.last = rec.sequence;
      if (type === 'CONTEXT') Object.assign(this.ctx, rec.set || {});
      if (type === 'TRIAL_ACCEPT') {   // the offered trial starts today and runs 30 days
        const from = this.iso(t), to = new Date(Date.parse(from) + 30 * 864e5).toISOString();
        this.trial = 'ACTIVE'; this.ent = true; rec.grant = { grantId: `GR-${rec.id}`, status: 'ACTIVE', validFrom: from, validTo: to, daysLeft: 30 };
      }
      if (type === 'FAULT') { this.faults.push({ vin, severity: rec.severity || 'WARNING', code: rec.code, t }); rec.advice = anomalyAdvice(this.feature.asil, this.faults); }
      if (type === 'READBACK') { const decided = this.lastDecision != null ? this.lastDecision : !!(this.flag && this.flag.value); const obs = rec.observed != null ? !!rec.observed : this.on && this.rt.state === 'ACTIVE';
        rec.readback = { observed: obs, desired: decided, status: obs === decided ? 'CONFIRMED' : 'DIVERGED' }; }
      evaluate({ ...this.pkg, entitlementActive: this.ent }, this.ctx, { killed: this.killed }).then(r => { rec.result = r; });
    }
    if (rec.bootId != null && !(prev) && !(rec.result && rec.result.rejected && /BOOT_MISMATCH|OLD_SEQUENCE|RATE_LIMITED|VEHICLE_SCOPE/.test(rec.result.rejected.code))) this.seen[key] = { id: rec.id, body };
    if (own) this.window.push(t);
    this.reqs.push(rec);
    const set = [...Object.entries(rec.set || {}).map(([k, v]) => `${k}=${v}`), ...(rec.entitlementActive !== undefined ? [`사용권한=${rec.entitlementActive ? '유효' : '없음'}`] : [])].join(', ');
    const what = { FLAGS: '조회', HELLO: `HELLO (재부팅 ${rec.bootId})`, CONTEXT: `문맥 보고 ${set}`, TRIAL_ACCEPT: '체험권 수락', FAULT: `오류 보고 ${rec.code || ''} ${rec.severity || 'WARNING'}`,
      READBACK: `적용 회신 observed=${rec.observed != null ? rec.observed : '현재 상태'}`, OVERRIDE: `Flag 직접 변경 시도 (${rec.value})` }[type] || kind;
    this.ev('vehicle_request', `${rec.id} ${vin} → ${what}${rec.bootId ? ` [${rec.bootId}#${rec.sequence}]` : ''}${rec.label ? ` · ${rec.label}` : ''}`,
      { request: { id: rec.id, kind, type, vin, bootId: rec.bootId, sequence: rec.sequence, set: rec.set, entitlementActive: rec.entitlementActive, code: rec.code, severity: rec.severity, expect: rec.expect, at: this.iso(t) } });
    return rec;
  }
  serveRequests(t) {
    for (const rec of this.reqs) {
      if (rec.t_resp != null || !rec.result || t < rec.due) continue;
      rec.t_resp = r2(t); rec.latency_s = r2(t - rec.t_req); const ms = Math.round(rec.latency_s * 1000);
      const done = (detail, extra) => this.ev('platform_response', `${rec.id} ${rec.vin} ← ${detail} ${ms} ms${rec.expect ? (rec.match ? ' · 기대와 일치' : ` · 기대(${rec.expect})와 불일치`) : ''}`, { response: { id: rec.id, ...rec.response, ...extra, at: this.iso(t), latency_ms: ms, expect: rec.expect, match: rec.match } });
      if (rec.result.rejected) {   // refused by the vehicle-channel rules: no evaluation, no effect on the vehicle
        const j = rec.result.rejected; rec.response = { error: j.code, status: j.status, message: j.message };
        if (rec.expect) rec.match = rec.expect === 'REJECTED' || rec.expect === j.code;
        done(`거부 ${j.status} ${j.code}`); continue;
      }
      if (rec.result.duplicate) {   // same key and body: the stored answer (or the stored rejection) is replayed; nothing is applied again
        const o = this.reqs.find(q => q.id === rec.duplicateOf), orig = (o && o.response) || {};
        rec.response = { ...orig, outcome: orig.error ? undefined : 'DUPLICATE', replayOf: rec.duplicateOf };
        if (rec.expect) rec.match = rec.expect === 'DUPLICATE' || (orig.error && (rec.expect === 'REJECTED' || rec.expect === orig.error));
        done(`중복 (${rec.duplicateOf} ${orig.error ? `거부 ${orig.status} ${orig.error}` : '응답'} 재전송)`); continue;
      }
      const r = rec.result, val = r.value ? 'ON' : 'OFF';
      // OFREP-style flag (key/value/variant/reason + decision metadata); reports add outcome and their own extras
      rec.response = { key: rec.flagKey, value: r.value, variant: r.variant, reason: r.reason, metadata: { decision: r.decision, policyId: r.policyId, revision: r.revision },
        ...(rec.type !== 'FLAGS' ? { outcome: 'ACCEPTED' } : {}), ...(rec.advice ? { advice: rec.advice } : {}), ...(rec.readback ? { readback: rec.readback } : {}), ...(rec.grant ? { grant: rec.grant } : {}), ...(rec.redeliver ? { redeliver: rec.redeliver } : {}) };
      if (rec.expect) rec.match = rec.expect === val || rec.expect === 'ACCEPTED' || (rec.readback && rec.expect === rec.readback.status);
      done(`${rec.readback ? `회신 ${rec.readback.status} · ` : ''}${rec.advice ? `이상 징후 권고 ${rec.advice} · ` : ''}${val} (${r.decision} · ${r.reason})`);
      if (rec.advice) { this.ev('anomaly_advice', `이상 징후 (D06-12): ${rec.code || ''} ${rec.severity || ''} → 권고 ${rec.advice}`, { advice: rec.advice });
        const ops = this.sc.ops; if (rec.advice === 'KILL' && ops && ops.kill_on_advice && this.adviceKillAt == null) this.adviceKillAt = t + (ops.reaction_s || 0); }
      if (rec.readback && rec.readback.status === 'DIVERGED') this.ev('readback_diverged', `적용 불일치: 결정 ${rec.readback.desired ? 'ON' : 'OFF'} / 차량 ${rec.readback.observed ? 'ON' : 'OFF'}`);
      if (rec.vin !== this.vehicle.vin) continue;
      this.lastDecision = r.value;
      if (this.killed) continue;
      if (r.value && !this.on) { this.on = true; this.rt.state = 'ACTIVE'; this.ev('feature_active', `${rec.id} 응답으로 기능 활성`); }
      else if (!r.value && this.on) { this.on = false; this.rt.applyKill(t); this.ev('feature_disabled', `${rec.id} 응답으로 기능 비활성 — 기본 동작`); }
    }
  }

  /** Per-criterion result: pass / fail / pending / na, with the value and when it happened. */
  verdict() {
    const k = this.k, sc = this.sc, end = this.done, F = this.feature;
    const val = {
      // a Kill is expected when the scenario schedules one or the operator acts on KILL advice; none applied by the end = fail
      kill_latency: k.killApplied != null ? [k.killApplied - k.killIssued, k.killApplied] : k.killIssued == null && (!this.on || (!sc.kill && this.adviceKillAt == null)) ? (end || !sc.kill ? 'na' : null) : end ? [Infinity, null] : null,
      max_decel: [k.maxDecel, k.maxDecelAt], ...F.values(this, this.m, end),
    };
    // vehicle requests: slowest answer, and answers that differ from the test's expected result
    const planned = this.reqs.length + this.sched.reduce((n, q) => n + (q.repeat || 1), 0), answered = this.reqs.filter(q => q.t_resp != null);
    if (!planned) { val.request_latency = 'na'; val.request_expected = 'na'; }
    else {
      const slow = answered.reduce((m, q) => (q.latency_s > m[0] ? [q.latency_s, q.t_resp] : m), [0, null]);
      val.request_latency = end && answered.length < planned ? [Infinity, null] : answered.length ? slow : null;   // unanswered at the end = fail
      const exp = [...this.reqs, ...this.sched].filter(q => q.expect), bad = answered.filter(q => q.expect && !q.match);
      val.request_expected = !exp.length ? 'na' : bad.length ? [bad.length, bad[0].t_resp] : end ? [exp.length - answered.filter(q => q.expect).length, null] : null;
    }
    const role = id => (!this.roles ? 'gate' : (this.roles.gate || []).includes(id) ? 'gate' : (this.roles.info || []).includes(id) ? 'info' : null);
    const items = F.criteria.filter(c => role(c.id)).map(c => {
      const v = val[c.id];
      const R = { role: role(c.id) };
      if (v === 'na') return { ...c, ...R, status: 'na', value: null, at: null };
      if (v == null || v[0] == null) return { ...c, ...R, status: c.id === 'min_ttc' && end ? 'pass' : 'pending', value: null, at: null };
      const ok = c.op === '<=' ? v[0] <= c.limit + 1e-9 : v[0] >= c.limit - 1e-9;
      // a running maximum that already broke its limit cannot recover; minima/accumulators are final only at the end
      const status = ok ? (end || ['kill_latency', 'recovery', 'first_announce', 'clear_after_pass'].includes(c.id) ? 'pass' : 'pending') : 'fail';
      return { ...c, ...R, status, value: r2(v[0]), at: r2(v[1]) };
    });
    // only gate criteria decide; info criteria are reported (e.g. the danger a fault causes before the Kill)
    const overall = items.some(i => i.role === 'gate' && i.status === 'fail') ? 'FAIL' : end ? 'PASS' : 'RUNNING';
    return { overall, items, ...(F.summary ? F.summary(this.m) : {}) };
  }

  /** Evidence files (FF_IMP formats + verdict + report). captures: [{name, label, t, bytes:Uint8Array}] */
  evidence({ captures = [], chartPng = null, testId } = {}) {
    const P = this.pkg.policy, v = this.verdict(), d0 = new Date(this.base), ymd = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}${String(d0.getDate()).padStart(2, '0')}`;   // local date
    const id = testId || `TEST-${P.flagKey}-${ymd}-${String(this.base).slice(-5)}`;
    const summary = {
      testId: id, kind: 'FF virtual validation (simulator)', overall: v.overall, generatedAt: new Date().toISOString(), internalOnly: true,
      policy: { policyId: P.policyId, revision: P.revision, status: P.status, contentHash: P.contentHash, featureId: P.featureId, featureVersion: P.featureVersion, flagKey: P.flagKey },
      evaluation: this.flag && { value: this.flag.value, decision: this.flag.decision, reason: this.flag.reason, assumedDeployed: P.status !== 'DEPLOYED', trace: this.flag.trace },
      test: this.pkg.test ? { id: this.pkg.test.id, name: this.pkg.test.name, purpose: this.pkg.test.purpose, steps: this.pkg.test.steps, expected: this.pkg.test.expected } : null,
      vehicle: this.vehicle, vehicleFinal: this.ctx, scenario: this.sc, scene: this.sceneId, simulator: this.simVersion, criteria: v.items, minTimeGap: v.minTimeGap,
      requests: this.reqs.map(({ result, due, ...q }) => q),
      captures: captures.map(c => ({ file: `captures/${c.name}`, label: c.label, t: c.t })),
    };
    const files = [
      { name: 'verdict.json', data: JSON.stringify(summary, null, 1) },
      { name: 'policy.json', data: JSON.stringify(P, null, 1) },
      { name: 'telemetry.jsonl', data: this.tel.map(r => JSON.stringify(r)).join('\n') + '\n' },
      { name: 'events.json', data: JSON.stringify(this.events, null, 1) },
      ...captures.map(c => ({ name: `captures/${c.name}`, data: c.bytes })),
    ];
    if (chartPng) files.push({ name: 'captures/timeline.png', data: chartPng });
    files.unshift({ name: 'report.html', data: reportHtml(summary, this.events, !!chartPng) });
    return { testId: id, files, summary };
  }
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST = { pass: '통과', fail: '불합격', pending: '판정 전', na: '해당 없음' };
function reportHtml(s, events, chart) {
  const rows = s.criteria.map(c => `<tr class="${c.status}${c.role === 'info' ? ' info' : ''}"><td>${esc(c.label)}</td><td>${c.role === 'info' ? '참고' : '판정'}</td><td>${c.op === '<=' ? '≤' : '≥'} ${c.limit} ${esc(c.unit)}</td><td>${c.value == null ? (c.id === 'min_ttc' && c.status === 'pass' ? '접근 없음' : '—') : c.value === Infinity ? '미복귀' : `${c.value} ${esc(c.unit)}`}</td><td>${c.at == null ? '' : `${c.at} s`}</td><td>${ST[c.status]}</td></tr>`).join('');
  const trace = (s.evaluation && s.evaluation.trace || []).map(t => `<li><b>${esc(t.step)}</b> ${esc(t.result)} — ${esc(t.detail)}</li>`).join('');
  const caps = s.captures.map(c => `<figure><img src="${esc(c.file)}" alt="${esc(c.label)}"><figcaption>${esc(c.label)} · t=${c.t} s</figcaption></figure>`).join('');
  const ev = events.map(e => `<tr><td>${e.t}</td><td>${esc(e.type)}</td><td>${esc(e.detail)}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${esc(s.testId)} · 가상 검증 증적</title>
<style>body{font:14px/1.55 "Malgun Gothic",system-ui,sans-serif;margin:24px auto;max-width:1100px;color:#1b2430}h1{font-size:20px;margin:0}h2{font-size:15px;margin:22px 0 6px}
.banner{background:#7a1d1d;color:#fff;padding:8px 12px;border-radius:6px;font-weight:600;margin:10px 0}.v{display:inline-block;padding:2px 10px;border-radius:4px;color:#fff;font-weight:700}
.PASS{background:#1f7a3f}.FAIL{background:#b3261e}.RUNNING{background:#6b7280}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d7dde4;padding:5px 8px;text-align:left;vertical-align:top}
tr.fail td{background:#fdeceb}tr.info td{color:#667}tr.fail.info td{background:#fff6e0}tr.pass td:last-child{color:#1f7a3f;font-weight:600}tr.fail td:last-child{color:#b3261e;font-weight:600}figure{display:inline-block;margin:6px;width:48%}img{width:100%;border:1px solid #ccd}
figcaption{font-size:12px;color:#556}code{font-size:12px}.kv td:first-child{width:180px;color:#556}</style>
<h1>${esc(s.testId)} <span class="v ${s.overall}">${s.overall}</span></h1>
<p><b>${s.overall === 'FAIL' ? `불합격 기준: ${s.criteria.filter(c => c.status === 'fail' && c.role !== 'info').map(c => `${esc(c.label)} ${c.value} ${esc(c.unit)} (한계 ${c.op === '<=' ? '≤' : '≥'} ${c.limit} ${esc(c.unit)})`).join(' · ')}` : s.overall === 'PASS' ? `모든 판정 기준 통과${s.criteria.some(c => c.role === 'info' && c.status === 'fail') ? ` · 참고 기준 ${s.criteria.filter(c => c.role === 'info' && c.status === 'fail').length}건 초과 (Gate 판정 제외): ${s.criteria.filter(c => c.role === 'info' && c.status === 'fail').map(c => `${esc(c.label)} ${c.value} ${esc(c.unit)}`).join(' · ')}` : ''}` : '판정 미완료'}</b>${/sample|not-hashed/i.test(s.policy.contentHash || '') || !s.policy.contentHash ? '<br><b style="color:#b3261e">정책 해시 없음 — 공식 Gate 증적으로 쓸 수 없음 (샘플·미등록 정책)</b>' : ''}</p>
<div class="banner">사내 검증용 — 외부 배포 금지. 실사 장면은 NVIDIA PhysicalAI-Autonomous-Vehicles-NuRec(라이선스 4.6조: 2차 저작물 배포 금지)에서 만든 것입니다.</div>
<table class="kv"><tr><td>Feature / Flag</td><td>${esc(s.policy.featureId)} v${esc(s.policy.featureVersion)} · <code>${esc(s.policy.flagKey)}</code></td></tr>
<tr><td>정책</td><td>${esc(s.policy.policyId)} rev ${s.policy.revision} · ${esc(s.policy.status)} · <code>${esc(s.policy.contentHash)}</code></td></tr>
<tr><td>평가 결과</td><td>${s.evaluation ? `${s.evaluation.value ? 'ON' : 'OFF'} (${esc(s.evaluation.decision)} · ${esc(s.evaluation.reason)})${s.evaluation.assumedDeployed ? ' — 배포 가정 평가' : ''}` : '—'}</td></tr>
<tr><td>가상 차량</td><td>${esc(s.vehicle.vin)} · ${esc(s.vehicle.country)} / ${esc(s.vehicle.vehicleModel)} / ${esc(s.vehicle.trim)} · MY${esc(s.vehicle.modelYear)} · SW ${esc(s.vehicle.swVersion)} · ${esc(s.vehicle.quality)}</td></tr>
<tr><td>시나리오</td><td>${esc(s.scenario.name)} · 선행차 ${s.scenario.lead_kph} km/h · 목표 ${s.scenario.target_gap_m} m · 오류 ${s.scenario.fault ? `${s.scenario.fault.at_s} s` : '없음'} · 차단 ${s.scenario.kill ? `${s.scenario.kill.at_s} s (${esc(s.scenario.kill.safe_mode)})` : '없음'} · 통신 지연 ${s.scenario.link_latency_ms} ms</td></tr>
<tr><td>장면 · 시뮬레이터</td><td>${esc(s.scene)} · ${esc(s.simulator)} · 생성 ${esc(s.generatedAt)}</td></tr></table>
${s.test ? `<h2>시험 항목 ${esc(s.test.id)} · ${esc(s.test.name)}</h2><p>${esc(s.test.purpose)}</p>${s.test.steps.length ? `<ol>${s.test.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${s.test.expected.length ? `<p><b>기대 결과</b></p><ul>${s.test.expected.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` : ''}
<h2>판정 기준</h2><table><tr><th>기준</th><th>구분</th><th>한계</th><th>측정</th><th>시각</th><th>결과</th></tr>${rows}</table>
${chart ? '<h2>타임라인</h2><img src="captures/timeline.png" alt="타임라인" style="width:100%">' : ''}
${s.requests.length ? `<h2>차량 요청 (Flag 조회·업데이트)</h2><table><tr><th>ID</th><th>t (s)</th><th>종류</th><th>차량</th><th>내용</th><th>응답</th><th>응답 시간</th><th>기대</th></tr>${s.requests.map(q => `<tr class="${q.expect && q.match === false ? 'fail' : ''}"><td>${q.id}</td><td>${q.t_req}</td><td>${{ FLAGS: '조회', CONTEXT: '문맥 보고', TRIAL_ACCEPT: '체험권 수락', OVERRIDE: 'Flag 직접 변경', HELLO: '재부팅 HELLO', FAULT: '오류 보고', READBACK: '적용 회신' }[q.type] || esc(q.kind)}${q.bootId ? `<br><span style="color:#667;font-size:11px">${esc(q.bootId)}#${q.sequence}</span>` : ''}</td><td>${esc(q.vin)}</td><td>${esc([q.label, q.set ? JSON.stringify(q.set) : '', q.entitlementActive !== undefined ? `사용권한 ${q.entitlementActive ? '유효' : '없음'}` : '', q.code ? `${q.code} ${q.severity || ''}` : '', q.observed != null ? `observed=${q.observed}` : ''].filter(Boolean).join(' · '))}</td><td>${!q.response ? '응답 없음' : q.response.error ? `거부 ${q.response.status} ${esc(q.response.error)}` : q.response.outcome === 'DUPLICATE' ? `중복 (${esc(q.response.replayOf)} 재전송)` : `${q.response.readback ? `회신 ${q.response.readback.status} · ` : ''}${q.response.advice ? `이상 징후 권고 ${q.response.advice} · ` : ''}${q.response.value ? 'ON' : 'OFF'} · ${esc(q.response.metadata.decision)} · ${esc(q.response.reason)}`}</td><td>${q.latency_s == null ? '—' : `${Math.round(q.latency_s * 1000)} ms`}</td><td>${q.expect ? `${q.expect} ${q.match ? '✔' : '✖'}` : ''}</td></tr>`).join('')}</table>` : ''}
<h2>장면 캡처</h2>${caps || '<p>없음</p>'}
<h2>정책 평가 경로 (FF 플랫폼 평가기)</h2><ol>${trace}</ol>
<h2>이벤트</h2><table><tr><th>t (s)</th><th>종류</th><th>내용</th></tr>${ev}</table>
<p style="color:#667;font-size:12px">첨부: <a href="verdict.json">verdict.json</a> · <a href="policy.json">policy.json</a> · telemetry.jsonl (FF_IMP 형식 + ttc, ego_a) · events.json</p></html>`;
}

/** Gate verdict over the test plan: PASS only if every test case ran and passed its gate criteria. */
export function gateVerdict(pkg, results) {
  const tests = pkg.tests.map(t => { const r = results[t.id]; return { id: t.id, name: t.name, overall: r ? r.overall : 'NOT_RUN', testId: r ? r.testId : null }; });
  const overall = tests.some(t => t.overall === 'FAIL') ? 'FAIL' : tests.every(t => t.overall === 'PASS') ? 'PASS' : 'INCOMPLETE';
  // a policy without a content hash (sample / unregistered), or criteria not yet fixed by the FF spec, cannot back an official gate decision
  const F = FEATURES[pkg.policy.featureId], provisional = !!(F && F.provisional);
  const official = !!pkg.policy.contentHash && !/sample|not-hashed/i.test(pkg.policy.contentHash) && !provisional;
  return { official, provisional, gate: pkg.gate, featureId: pkg.policy.featureId, policyId: pkg.policy.policyId, revision: pkg.policy.revision, contentHash: pkg.policy.contentHash, overall, tests };
}
export function gateReportHtml(g, vehicle, verdicts = {}) {
  const V = { PASS: '통과', FAIL: '불합격', INCOMPLETE: '미완료', NOT_RUN: '미실시', RUNNING: '진행 중' };
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${esc(g.gate.id)} 가상 검증 · ${esc(g.featureId)}</title>
<style>body{font:14px/1.55 "Malgun Gothic",system-ui,sans-serif;margin:24px auto;max-width:1000px;color:#1b2430}h1{font-size:20px}.banner{background:#7a1d1d;color:#fff;padding:8px 12px;border-radius:6px;font-weight:600}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #d7dde4;padding:6px 8px;text-align:left}.PASS{color:#1f7a3f;font-weight:700}.FAIL{color:#b3261e;font-weight:700}.INCOMPLETE,.NOT_RUN{color:#6b7280;font-weight:700}</style>
<h1>${esc(g.gate.name)} (${esc(g.gate.id)}) · ${esc(g.featureId)} — <span class="${g.overall}">${V[g.overall]}${g.official ? '' : ' (비공식)'}</span></h1>
<div class="banner">사내 검증용 — 외부 배포 금지 (실사 장면: NVIDIA PhysicalAI-AV NuRec, 라이선스 4.6조)</div>
<p>정책 ${esc(g.policyId)} rev ${g.revision} · <code>${esc(g.contentHash)}</code> · 가상 차량 ${esc(vehicle.vin)} (${esc(vehicle.vehicleModel)} / ${esc(vehicle.trim)} / ${esc(vehicle.country)} · SW ${esc(vehicle.swVersion)})</p>
${/sample|not-hashed/i.test(g.contentHash || '') || !g.contentHash ? '<p style="color:#b3261e;font-weight:700">정책 해시 없음 — 이 패키지는 공식 Gate 증적으로 쓸 수 없습니다 (샘플·미등록 정책).</p>' : ''}
${g.provisional ? '<p style="color:#b3261e;font-weight:700">판정 기준이 가정값입니다 (FF 사양 미정) — 공식 Gate 증적으로 쓸 수 없습니다.</p>' : ''}
<table><tr><th>시험 항목</th><th>이름</th><th>결과</th><th>판정 기준 (측정값)</th><th>증적</th></tr>${g.tests.map(t => { const v = verdicts[t.id]; const kv = v ? v.items.filter(i => i.role !== 'info' && i.status !== 'na').map(i => `${esc(i.label)} ${i.value == null ? '—' : i.value}${esc(i.unit)} ${i.status === 'pass' ? '✔' : i.status === 'fail' ? '✖' : ''}`).join('<br>') + (v.items.some(i => i.role === 'info' && i.status === 'fail') ? `<br><span style="color:#a46a21">참고 초과: ${v.items.filter(i => i.role === 'info' && i.status === 'fail').map(i => esc(i.label)).join(', ')}</span>` : '') : '';
  return `<tr><td>${esc(t.id)}</td><td>${esc(t.name)}</td><td class="${t.overall}">${V[t.overall] || t.overall}</td><td style="font-size:12px">${kv}</td><td>${t.testId ? `<a href="${esc(t.id)}/report.html">${esc(t.testId)}</a>` : '—'}</td></tr>`; }).join('')}</table>
<table style="margin-top:18px"><tr><th style="width:25%">검증 수행</th><td></td><th style="width:25%">Gate 판정 (G5 검증 책임자)</th><td></td></tr><tr><th>일시</th><td></td><th>서명</th><td></td></tr></table>
<p style="color:#667;font-size:12px">Gate 판정: 모든 시험 항목이 실행되고 각 항목의 판정 기준(참고 기준 제외)을 통과해야 통과. 첨부: gate.json, 시험 항목별 폴더(report.html · verdict.json · telemetry.jsonl · events.json · captures/).</p></html>`;
}
