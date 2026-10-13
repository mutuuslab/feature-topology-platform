// On-board plausibility monitor (ffval 2.0) — a port of FdPlaus_Step (report v1.1 code package c/src/fd_feature.c, TC-FF-21).
// The feature's distance estimate is compared with an independent reference measurement every cycle:
// band = max(rel_pct % of the reference, abs_m); outside the band for debounce_s in a row → latched (until the next power cycle).
// Latching is the vehicle's own fault detection — the Guard then removes the feature effect with the fault ramp, no cloud needed.
// Package defaults are the code package's (20 %, 2.0 m, 200 ms < FTTI of the item).

export const ONBOARD_DEFAULTS = { rel_pct: 20, abs_m: 2.0, debounce_s: 0.2 };

export function createPlausibility(o = {}) {
  const c = { ...ONBOARD_DEFAULTS, ...o };
  const st = { cfg: c, acc_s: 0, latched: false };
  /** One cycle; returns true once latched. */
  st.step = (estM, refM, dt) => {
    if (st.latched) return true;
    const band = Math.max((refM * c.rel_pct) / 100, c.abs_m);
    if (Math.abs(estM - refM) > band) {
      st.acc_s += dt;
      if (st.acc_s >= c.debounce_s - 1e-9) st.latched = true;
    } else st.acc_s = 0;
    return st.latched;
  };
  return st;
}
