// FEAT-00022 '전방 안전거리 3단계' — vehicle-side runtime, a 1:1 port of FF_IMP beamng/feature_runtime.py v2 (engine-neutral).
// Cross-checked against the Python original by tests/js/ffval_features.test.mjs (golden series tests/fixtures/feat00022_golden.json,
// regenerated with tests/gen_feat00022_golden.py from the FF_IMP code).
// State = the vehicle Safety Guard state (status_report v2): ACTIVE / DEACT_PENDING_* / DEACT_WARNING (the feature still drives),
// DEACT_RAMP (feature command → base command, linear over the ramp), DISABLED / INACTIVE (safe state BASE_ONLY: the basic
// time-gap assist). An injected fault inflates the feature's distance estimate without the feature noticing.
// Extension over the port (ffval 2.0): setGuardState(t, 'DEACT_RAMP', rampS) takes the ramp length of that ramp — the on-board
// fault ramp (Registry faultRampMs) is shorter than the remote one (rampMs). Without it the port is unchanged.

export const STAGES = ['정상', '주의', '위험'];
// Guard states in which the feature still controls the vehicle — every other state is base control (BASE_ONLY)
export const FEATURE_STATES = ['ACTIVE', 'DEACT_PENDING_IDLE', 'DEACT_PENDING_CYCLE', 'DEACT_WARNING', 'DEACT_RAMP'];

export function stageOf(gapM, speedMps) {
  const tg = gapM / Math.max(speedMps, 1.0);   // time gap (s)
  if (tg >= 1.6) return '정상';
  if (tg >= 0.9) return '주의';
  return '위험';
}

export const DEFAULT_CONFIG = {
  target_gap_m: 40.0, fault_at: 17.0, fault_ramp: 8.0, fault_bias_max: 2.4,
  base_time_gap_s: 2.2,   // safe state BASE_ONLY: the existing time-gap control
  ramp_s: 3.0,            // DEACT_RAMP length — Registry rampMs (FEAT-00022 3000 ms)
  max_speed_mps: 33.0, gain_feature: 0.30, gain_default: 0.22,
  max_accel_mps2: 1.6,    // command rate limits (no harsh accel/decel)
  max_decel_mps2: 2.8,
};

export function createRuntime(cfg = {}, initialCmdMps = 22.0) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const rt = { cfg: c, state: 'ACTIVE', fault_active: false, fault_reported: false, cmd_mps: initialCmdMps, deact_at: null, ramp_at: null, ramp_s: c.ramp_s, disabled_at: null };
  // fault_at = null/Infinity: no fault injected
  rt.bias = t => {
    if (!(t >= c.fault_at)) return 1.0;
    const k = Math.min(1.0, (t - c.fault_at) / c.fault_ramp);
    return 1.0 + (c.fault_bias_max - 1.0) * (k * k * (3 - 2 * k));
  };
  /** The state the vehicle Guard decided — receiving the same state again keeps the first timestamps. */
  rt.setGuardState = (t, state, rampS) => {
    if (state === rt.state) return state;
    if (state.startsWith('DEACT_') && rt.deact_at == null) rt.deact_at = t;
    if (state === 'DEACT_RAMP') { rt.ramp_at = t; rt.ramp_s = rampS != null ? rampS : c.ramp_s; }
    if (!FEATURE_STATES.includes(state) && state !== 'RESTORE_PENDING' && rt.disabled_at == null) rt.disabled_at = t;
    if (state === 'ACTIVE') rt.deact_at = rt.ramp_at = rt.disabled_at = null;
    rt.state = state;
    return state;
  };
  /** Share of the feature command (0..1) — 1 → 0 during the ramp. */
  rt.weight = t => {
    if (rt.state === 'DEACT_RAMP') return Math.max(0.0, 1.0 - (t - (rt.ramp_at != null ? rt.ramp_at : t)) / Math.max(rt.ramp_s, 1e-6));
    return FEATURE_STATES.includes(rt.state) ? 1.0 : 0.0;
  };
  /** The feature switched off by the platform (flag OFF / answer OFF): base control at once, no ramp. */
  rt.applyKill = t => rt.setGuardState(t, 'DISABLED');
  rt.step = (t, dt, gapTrue, egoMps, leadMps) => {
    rt.fault_active = t >= c.fault_at;
    const w = rt.weight(t);
    const gapEst = w > 0 ? gapTrue * rt.bias(t) : gapTrue;
    const wantFeature = leadMps + c.gain_feature * (gapEst - c.target_gap_m);
    const desired = c.base_time_gap_s * Math.max(egoMps, 5.0);
    const wantBase = leadMps + c.gain_default * (gapTrue - desired);
    let want = w * wantFeature + (1.0 - w) * wantBase;
    want = Math.max(0.0, Math.min(c.max_speed_mps, want));
    let dv = want - rt.cmd_mps;
    dv = Math.max(-c.max_decel_mps2 * dt, Math.min(c.max_accel_mps2 * dt, dv));
    rt.cmd_mps += dv;
    return {
      feature_state: rt.state, feature_weight: Math.round(w * 1000) / 1000, fault_active: rt.fault_active, gap_true: gapTrue, gap_est: gapEst,
      stage_feature: w > 0 ? stageOf(gapEst, egoMps) : null, stage_true: stageOf(gapTrue, egoMps), cmd_mps: rt.cmd_mps,
    };
  };
  return rt;
}
