// FEAT-00023 '급가속 억제' (ASIL B, control points Flag + Parameter; FUNC-000058 Acceleration Suppression,
// FUNC-000059 Torque Ramp Service). When the driver floors the pedal, the vehicle limits the resulting acceleration and
// its rise rate (jerk) instead of passing the demand through.
// PROVISIONAL parameters: the FF platform has no values for this feature yet (2026-10-12) — keep them here, in one place.
export const DEFAULT_CONFIG = {
  a_max: 2.0,           // m/s², suppressed acceleration ceiling (가정값)
  jerk_max: 3.0,        // m/s³, rise-rate limit while suppressing (가정값)
  trigger_a: 2.2,       // m/s², driver demand regarded as 급가속 (가정값)
  base_tau: .25,        // s, the vehicle's own longitudinal response without the feature
  over_suppress_a: .3,  // m/s², ceiling under the injected fault "과억제" (limit parameter corrupted)
};

/** Driver model: hold the cruise speed; pedal events [{at_s, accel_req, dur_s}] override the demand. */
export function driverDemand(sc, t, v) {
  const ev = (sc.pedal || []).find(p => t >= p.at_s && t < p.at_s + p.dur_s);
  if (ev) return ev.accel_req;
  return Math.max(-1.5, Math.min(1.2, .6 * (sc.lead_kph / 3.6 - v)));
}

export function createRuntime(cfg = {}, sc = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg }, F = sc.fault || null;
  const rt = { cfg: c, state: 'ACTIVE', a_cmd: 0, killed_at: null, fault_active: false };
  rt.applyKill = t => { if (rt.state !== 'SAFE_DEFAULT') { rt.state = 'SAFE_DEFAULT'; rt.killed_at = t; } return rt.state; };
  rt.step = (t, dt, aReq) => {
    rt.fault_active = !!F && t >= F.at_s;
    const limit = rt.fault_active ? (F.limit_a != null ? F.limit_a : c.over_suppress_a) : c.a_max, prev = rt.a_cmd;
    let suppressing = false;
    if (rt.state === 'ACTIVE') {
      const target = aReq > c.trigger_a || rt.fault_active ? Math.min(aReq, limit) : aReq;
      suppressing = aReq > target + 1e-6;
      // rises are jerk-limited, releases and braking are not (the driver lifting off must take effect at once)
      rt.a_cmd = target > rt.a_cmd ? rt.a_cmd + Math.min(target - rt.a_cmd, c.jerk_max * dt) : target;
    } else rt.a_cmd += (aReq - rt.a_cmd) * Math.min(1, dt / c.base_tau);   // OFF / Safe Default: unsuppressed base response
    return { feature_state: rt.state, fault_active: rt.fault_active, a_req: aReq, a_cmd: rt.a_cmd, limit, suppressing, jerk: (rt.a_cmd - prev) / dt };
  };
  return rt;
}
