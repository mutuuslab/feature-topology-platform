export interface OperationVehicle { vin: string; country?: string; vehicleModel?: string; trim?: string }
export interface OperationFlag { flagKey: string; publicationId: string | null; sequence: number | null; local: { value: boolean; reason: string }; drift: boolean }
export interface OperationRuntime { vin: string; scope: string; quality: string; link: string; flags: OperationFlag[]; last: { at: string; detail: string } | null }
export interface OperationPolicy { policyId: string; revision: number; featureId: string; featureVersion: string; flagKey: string; status: string }
export interface OperationFeature { featureId: string; version: string; country: string; vehicleModel: string }
export interface OperationPublication { publicationId: string; kind: string; status: string; createdAt: string; payload: { targets: string[]; flagKey: string | null; featureId: string; policy: { policyId: string; revision: number } | null } }
export interface OperationReadback { vin: string; publicationId: string; at: string; metricType: string; observed: string; rejectReason?: string }
export interface OperationSync { at: string; request: { policyId?: string; revision?: number; mode?: string }; response: { outcome?: string } }
export interface OperationFilters { country: string; model: string; flag: string }
export interface OperationInput { runtime: OperationRuntime[]; vehicles: OperationVehicle[]; policies: OperationPolicy[]; features: OperationFeature[]; publications: OperationPublication[]; readbacks: OperationReadback[]; syncs: OperationSync[] }
export type OperationState = 'ON' | 'OFF' | 'SAFE' | 'UNKNOWN';
export const UNKNOWN_GROUP = '__unknown__';
export interface OperationEvent { phase: 'DEPLOY' | 'SYNC' | 'READBACK'; at: string; to: string; label: string; failed: boolean }
export interface OperationPreparationIssue { publicationId: string; policyId: string; revision: number; reason: 'SYNC_UNKNOWN' | 'SYNC_LATE' | 'TIME_UNKNOWN' }
const time = (value: string) => Date.parse(value);

/** Received values only. No inferred ON from deployed policies, catalogues or missing bundles. */
export function receivedState(row: OperationRuntime, flag: string): OperationState {
  const flags = flag ? row.flags.filter((f) => f.flagKey === flag) : row.flags;
  if (row.quality !== 'TRUSTED' || !flags.length) return 'UNKNOWN';
  if (flags.some((f) => f.local.reason === 'KILL_SWITCH')) return 'SAFE';
  return flags.some((f) => f.local.value === true) ? 'ON' : 'OFF';
}

export function buildOperationModel(input: OperationInput, filters: OperationFilters) {
  const vehicleByVin = new Map(input.vehicles.map((v) => [v.vin, v]));
  const featureByVersion = new Map(input.features.map((f) => [`${f.featureId}@${f.version}`, f]));
  const allRows = input.runtime.map((runtime) => ({ runtime, vehicle: vehicleByVin.get(runtime.vin), state: receivedState(runtime, filters.flag) }));
  const matches = (value: string | undefined, filter: string) => !filter || (filter === UNKNOWN_GROUP ? !value : value === filter);
  const rows = allRows.filter(({ vehicle }) => matches(vehicle?.country, filters.country) && matches(vehicle?.vehicleModel, filters.model));
  const vins = new Set(rows.map((r) => r.runtime.vin));
  const flagFeatures = new Set(input.policies.filter((p) => p.flagKey === filters.flag).map((p) => p.featureId));
  const publications = input.publications.filter((p) => p.payload.targets.some((vin) => vins.has(vin)) && (!filters.flag || p.payload.flagKey === filters.flag || (!p.payload.flagKey && flagFeatures.has(p.payload.featureId))));
  const publicationById = new Map(input.publications.map((p) => [p.publicationId, p]));
  const publicationIds = new Set(publications.map((p) => p.publicationId));
  // ACK is transport acknowledgement, not an applied-value readback.
  const readbacks = input.readbacks.filter((r) => vins.has(r.vin) && publicationIds.has(r.publicationId) && r.metricType === 'READBACK');
  const latestReadback = new Map<string, OperationReadback>();
  for (const r of readbacks) if (Number.isFinite(time(r.at)) && (!latestReadback.has(r.vin) || time(latestReadback.get(r.vin)!.at) < time(r.at))) latestReadback.set(r.vin, r);
  const scopedPolicies = input.policies.filter((p) => {
    const feature = featureByVersion.get(`${p.featureId}@${p.featureVersion}`);
    return (!filters.flag || p.flagKey === filters.flag) && matches(feature?.country, filters.country) && matches(feature?.vehicleModel, filters.model);
  });
  const policyVersions = new Set(publications.flatMap((p) => p.payload.policy ? [`${p.payload.policy.policyId}@${p.payload.policy.revision}`] : []));
  const syncs = input.syncs.filter((s) => policyVersions.has(`${s.request?.policyId}@${s.request?.revision}`));
  // These are source-record checks, not a claim of vehicle delivery or current replica readiness.
  const preparationIssues: OperationPreparationIssue[] = publications.flatMap((p) => {
    const policy = p.payload.policy;
    if (!policy) return [];
    const successes = syncs.filter((s) => s.request.policyId === policy.policyId && s.request.revision === policy.revision && s.response.outcome === 'SYNCED');
    const valid = successes.map((s) => time(s.at)).filter(Number.isFinite);
    const reason = !successes.length ? 'SYNC_UNKNOWN' : !valid.length || !Number.isFinite(time(p.createdAt)) ? 'TIME_UNKNOWN' : Math.min(...valid) > time(p.createdAt) ? 'SYNC_LATE' : undefined;
    return reason ? [{ publicationId: p.publicationId, ...policy, reason }] : [];
  });
  const events: OperationEvent[] = [
    ...publications.map((p) => ({ phase: 'DEPLOY' as const, at: p.createdAt, to: `/deployments/${encodeURIComponent(p.publicationId)}`, label: p.publicationId, failed: ['DIVERGED', 'TIMEOUT'].includes(p.status) })),
    ...syncs.map((s) => ({ phase: 'SYNC' as const, at: s.at, to: `/policies/${encodeURIComponent(s.request.policyId!)}?tab=unleash`, label: `${s.request.policyId}@r${s.request.revision} ${s.response?.outcome ?? ''} (${s.request.mode ?? '?'})`, failed: s.response?.outcome !== 'SYNCED' })),
    ...readbacks.map((r) => ({ phase: 'READBACK' as const, at: r.at, to: `/fleet/vehicles/${encodeURIComponent(r.vin)}`, label: `${r.vin} ${r.rejectReason ?? r.metricType}`, failed: !!r.rejectReason || r.observed === 'REJECTED' })),
  ];
  const validEvents = events.filter((e) => Number.isFinite(time(e.at))).sort((a, b) => time(a.at) - time(b.at));
  const group = (key: 'country' | 'vehicleModel') => {
    const groups = new Map<string, { name: string; total: number; states: Record<OperationState, number> }>();
    for (const row of rows) {
      const name = row.vehicle?.[key] || UNKNOWN_GROUP;
      const current = groups.get(name) ?? { name, total: 0, states: { ON: 0, OFF: 0, SAFE: 0, UNKNOWN: 0 } };
      current.total++; current.states[row.state]++; groups.set(name, current);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  };
  return {
    rows: rows.map((row) => ({ ...row, flags: row.runtime.flags.filter((f) => !filters.flag || f.flagKey === filters.flag), readback: latestReadback.get(row.runtime.vin) })),
    deployed: new Set(scopedPolicies.filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey)).size,
    approvals: scopedPolicies.filter((p) => p.status === 'VALIDATED').length,
    received: rows.filter((r) => r.state !== 'UNKNOWN').length,
    unknown: rows.filter((r) => r.state === 'UNKNOWN').length,
    rejected: readbacks.filter((r) => !!r.rejectReason || r.observed === 'REJECTED').length,
    countryGroups: group('country'), modelGroups: group('vehicleModel'), events: validEvents,
    invalidTimes: events.length - validEvents.length, publicationById, preparationIssues,
    countries: [...new Set(allRows.map((r) => r.vehicle?.country || UNKNOWN_GROUP))].sort(),
    models: [...new Set(allRows.map((r) => r.vehicle?.vehicleModel || UNKNOWN_GROUP))].sort(),
    flags: [...new Set([...input.runtime.flatMap((r) => r.flags.map((f) => f.flagKey)), ...input.policies.map((p) => p.flagKey)])].sort(),
  };
}
