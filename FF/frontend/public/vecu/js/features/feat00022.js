// FEAT-00022 '전방 안전거리 3단계' — vehicle-side runtime, a 1:1 port of FF_IMP beamng/feature_runtime.py (engine-neutral).
// Cross-checked against the Python original by tests/test_feat00022_port.py (golden series from the FF_IMP code).
// State: ACTIVE (feature drives; an injected fault inflates its distance estimate without it noticing) or SAFE_DEFAULT
// (Kill applied: back to the basic time-gap assist).

export const STAGES = ['정상', '주의', '위험'];

export function stageOf(gapM, speedMps) {
  const tg = gapM / Math.max(speedMps, 1.0);   // time gap (s)
  if (tg >= 1.6) return '정상';
  if (tg >= 0.9) return '주의';
  return '위험';
}

export const DEFAULT_CONFIG = {
  target_gap_m: 40.0, fault_at: 17.0, fault_ramp: 8.0, fault_bias_max: 2.4, safe_default_time_gap_s: 2.2,
  max_speed_mps: 33.0, gain_feature: 0.30, gain_default: 0.22,
  max_accel_mps2: 1.6,   // command rate limits (no harsh accel/decel)
  max_decel_mps2: 2.8,
};

export function createRuntime(cfg = {}, initialCmdMps = 22.0) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const rt = { cfg: c, state: 'ACTIVE', fault_active: false, fault_reported: false, cmd_mps: initialCmdMps, killed_at: null };
  // fault_at = null/Infinity: no fault injected
  rt.bias = t => {
    if (!(t >= c.fault_at)) return 1.0;
    const k = Math.min(1.0, (t - c.fault_at) / c.fault_ramp);
    return 1.0 + (c.fault_bias_max - 1.0) * (k * k * (3 - 2 * k));
  };
  rt.applyKill = t => { if (rt.state !== 'SAFE_DEFAULT') { rt.state = 'SAFE_DEFAULT'; rt.killed_at = t; } return rt.state; };
  rt.step = (t, dt, gapTrue, egoMps, leadMps) => {
    rt.fault_active = t >= c.fault_at;
    const gapEst = rt.state === 'ACTIVE' ? gapTrue * rt.bias(t) : gapTrue;
    let want;
    if (rt.state === 'ACTIVE') want = leadMps + c.gain_feature * (gapEst - c.target_gap_m);
    else { const desired = c.safe_default_time_gap_s * Math.max(egoMps, 5.0); want = leadMps + c.gain_default * (gapTrue - desired); }
    want = Math.max(0.0, Math.min(c.max_speed_mps, want));
    let dv = want - rt.cmd_mps;
    dv = Math.max(-c.max_decel_mps2 * dt, Math.min(c.max_accel_mps2 * dt, dv));
    rt.cmd_mps += dv;
    return {
      feature_state: rt.state, fault_active: rt.fault_active, gap_true: gapTrue, gap_est: gapEst,
      stage_feature: rt.state === 'ACTIVE' ? stageOf(gapEst, egoMps) : null, stage_true: stageOf(gapTrue, egoMps), cmd_mps: rt.cmd_mps,
    };
  };
  return rt;
}
