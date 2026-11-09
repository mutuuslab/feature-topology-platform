// Gate Registry is derived from the actual local Feature and safety profile.
// Command history belongs to a Feature ID, so a new Version must not reset it.
import { DEFAULT_GATE_POLICY, SafetyProfile, type GateFeature, type GateLedger, type GatePolicy } from '@ff/contracts';
import { extendSimReader, SimError } from '../engine';
import type { SimReadContext } from '../types';

interface Snapshot {
  featureId: string;
  version: string;
  feature: GateFeature;
  ledger: GateLedger;
  policy: GatePolicy;
  nextSeq: number;
  window: { hours: number; deactivate: number; restore: number; cap: number };
}

function checkedLedger(value: GateLedger | undefined): GateLedger {
  if (!value || !Number.isInteger(value.last_order_seq) || value.last_order_seq! < 0 ||
      !Array.isArray(value.last_kill_approvers) || !value.last_kill_approvers.every(id => typeof id === 'string' && !!id) ||
      !Array.isArray(value.recent) || !value.recent.every(row => typeof row.request === 'string' && !!row.request && Number.isInteger(row.vehicles) && row.vehicles >= 0 && Number.isFinite(Date.parse(row.at))))
    throw new SimError('GUARD_FAILED', 'Complete Feature command ledger source is required.');
  return value;
}

function checkedSnapshot(value: Snapshot, id: string, ver: string): Snapshot {
  if (value.featureId !== id || value.version !== ver || value.feature?.version !== ver)
    throw new SimError('GUARD_FAILED', 'Captured Gate Registry identity does not match the requested Feature Version.');
  checkedLedger(value.ledger);
  const p = value.policy;
  if (!p || !Number.isFinite(p.max_command_ttl_hours) || p.max_command_ttl_hours <= 0 ||
      !Number.isFinite(p.canary_max_vehicles) || p.canary_max_vehicles < 0 ||
      !Number.isFinite(p.max_not_before_lead_hours) || p.max_not_before_lead_hours < 0 ||
      !Number.isFinite(p.kill_window_hours) || p.kill_window_hours <= 0 ||
      (p.max_clock_skew_seconds !== undefined && (!Number.isFinite(p.max_clock_skew_seconds) || p.max_clock_skew_seconds < 0)))
    throw new SimError('GUARD_FAILED', 'The captured Gate policy source is invalid.');
  return value;
}

async function inheritedSnapshot(ctx: SimReadContext, id: string, ver: string): Promise<Snapshot | null> {
  const captured = await ctx.snapshot<Snapshot>('gateSnapshot', { id, ver });
  if (captured) return checkedSnapshot(captured, id, ver);
  const key = `${id}@${ver}`, entity = ctx.get<any>('regFeature', key);
  if (!ctx.overlay.created.regFeature?.includes(key) || entity?.row?.featureId !== id || entity.row.version !== ver)
    throw new SimError('INTERNAL', 'Gate Registry source is unavailable for this Feature Version.');
  const history = await ctx.snapshot<any>('listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(history?.items) || history.nextCursor != null || history.items.length !== history.total)
    throw new SimError('GUARD_FAILED', 'Complete captured Feature history is required to verify the command ledger.');
  const versions = history.items.filter((f: any) => f.featureId === id);
  if (!versions.length) return null; // An actual newly created ID has no prior command history.
  for (const version of versions) {
    const source = await ctx.snapshot<Snapshot>('gateSnapshot', { id, ver: version.version });
    if (source) return checkedSnapshot(source, id, version.version);
  }
  throw new SimError('GUARD_FAILED', 'The existing Feature command ledger was not captured; a new Version cannot reset its history.');
}

extendSimReader('gateSnapshot', async (ctx) => {
  const { id, ver } = ctx.req.params, key = `${id}@${ver}`;
  if (ctx.overlay.data.regDeletedFeatures?.[key]) throw new SimError('NOT_FOUND', `${key}을(를) 찾을 수 없습니다.`);
  const entity = ctx.get<any>('regFeature', key), localProfile = ctx.get('regSafety', key);
  const localLedger = ctx.overlay.data.killLedger?.[id] as GateLedger | undefined;
  if (!entity && !localProfile && !localLedger) return undefined;
  const row = entity?.row ?? (await ctx.snapshot<any>('featureDetail', { id, ver }))?.feature;
  if (!row || row.featureId !== id || row.version !== ver) throw new SimError('NOT_FOUND', `${key}을(를) 찾을 수 없습니다.`);
  const base = await inheritedSnapshot(ctx, id, ver);
  const value = (await ctx.read<any>('safetyProfile', { id, ver }))?.profile;
  const parsed = SafetyProfile.safeParse(value);
  if (!parsed.success || parsed.data.featureId !== id || parsed.data.version !== ver)
    throw new SimError('GUARD_FAILED', 'The actual Feature safety profile is unavailable.');
  const p = parsed.data;
  const feature: GateFeature = {
    name: row.name, version: row.version,
    status: ['DEPRECATED', 'RETIRED'].includes(row.lifecycle) ? 'DECOMMISSIONED' : row.lifecycle,
    f_class: p.fClass, deact_class: p.deactClass, gsr_mandatory: p.gsrMandatory,
    max_vehicles: p.maxActivationScope?.vehicles ?? 0, max_per_window: p.maxActivationScope?.perWindow ?? 0,
    markets_approved: [...p.markets], type_approval_relevant: p.regClass !== 'R0', ads_feature: p.adsFeature,
    profile: { takeover_ms: p.takeoverMs, ramp_ms: p.rampMs, fault_ramp_ms: p.faultRampMs, max_pending_ms: p.maxPendingMs, max_cycle_wait_ms: p.maxCycleWaitMs },
  };
  const policy = base?.policy ?? DEFAULT_GATE_POLICY;
  const sourceLedger = checkedLedger(localLedger ?? base?.ledger ?? { last_order_seq: 0, last_kill_approvers: [], recent: [] });
  const since = ctx.now().getTime() - policy.kill_window_hours * 3600_000;
  const ledger = { ...sourceLedger, recent: (sourceLedger.recent ?? []).filter(r => Date.parse(r.at) >= since) };
  const sum = (request: string) => ledger.recent.filter(r => r.request === request).reduce((total, r) => total + r.vehicles, 0);
  return {
    featureId: id, version: ver, feature, ledger, policy, nextSeq: (ledger.last_order_seq ?? 0) + 1,
    window: { hours: policy.kill_window_hours, deactivate: sum('deactivate'), restore: sum('restore'), cap: feature.max_per_window },
  } satisfies Snapshot;
});
