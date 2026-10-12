// FEAT-00024 'IC·JC 경로 사전안내' (QM, control points Flag + Signal; FUNC-000060 Highway Detailed Guidance,
// FUNC-000061 Highway Map Guidance Service). Ahead of an interchange/junction the IVI shows direction, remaining distance
// and the lane to take, and clears the guidance once the junction has been passed.
// PROVISIONAL parameters: the FF platform has no values for this feature yet (2026-10-12) — keep them here, in one place.
export const DEFAULT_CONFIG = {
  announce_m: 800,     // guidance appears this far before the junction (가정값)
  near_m: 400,         // '접근' phase (가정값)
  imminent_m: 150,     // '임박' phase (가정값)
  clear_after_s: 2.0,  // guidance stays this long after passing, then clears (가정값)
  round_m: 10,         // displayed distance resolution
};

/** sc.junction = {at_m (route distance from the start), name, type: 'IC'|'JC', direction: 'right'|'left', lane}; sc.fault = {at_s, offset_m}: stale map */
export function createRuntime(cfg = {}, sc = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg }, J = sc.junction || { at_m: 1e9 }, F = sc.fault || null;
  const rt = { cfg: c, state: 'ACTIVE', killed_at: null, fault_active: false, passedAt: null };
  rt.applyKill = t => { if (rt.state !== 'SAFE_DEFAULT') { rt.state = 'SAFE_DEFAULT'; rt.killed_at = t; } return rt.state; };
  rt.step = (t, _dt, traveledM) => {
    rt.fault_active = !!F && t >= F.at_s;
    const dTrue = J.at_m - traveledM, dBelieved = dTrue + (rt.fault_active ? F.offset_m || 0 : 0);
    if (dBelieved < 0 && rt.passedAt == null) rt.passedAt = t;   // where the feature thinks the junction is
    let g = null;
    if (rt.state === 'ACTIVE' && dBelieved <= c.announce_m && (rt.passedAt == null || t - rt.passedAt < c.clear_after_s)) {
      const d = Math.max(0, Math.round(dBelieved / c.round_m) * c.round_m);
      g = { name: J.name, type: J.type, direction: J.direction, lane: J.lane, dist_m: d, phase: dBelieved <= c.imminent_m ? '임박' : dBelieved <= c.near_m ? '접근' : '사전' };
    }
    return { feature_state: rt.state, fault_active: rt.fault_active, dist_true: dTrue, dist_shown: g ? g.dist_m : null, guidance: g };
  };
  return rt;
}
