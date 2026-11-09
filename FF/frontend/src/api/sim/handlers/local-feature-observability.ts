// Reads for genuinely created local Feature targets. Captured observations remain native evidence.
import { compareVersion, FeatureFlagsQuery, flagKillOf } from '@ff/contracts';
import { EVAL_DEFAULT_DAYS, EVAL_MAX_DAYS, summarizeEvaluations } from '../../../../../contracts/src/rules/evaluation-stats';
import { featureTraceCoverage, groupTraceLinks, testCaseStatus } from '../../../../../contracts/src/rules/trace-link';
import { findingOpen } from '../../../../../contracts/src/rules/lake';
import type { TestEvidenceRow, TraceLinkRow } from '../../../../../contracts/src/schemas/trace-link';
import { extendSimReader, SimError } from '../engine';
import type { SimReadContext } from '../types';

type Row = Record<string, any> & { featureId: string; version: string };
const LOCAL = 'LOCAL_SIMULATION';
const keyOf = (r: Row) => `${r.featureId}@${r.version}`;
const rows = (value: any): any[] | undefined => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : undefined;
const merge = <T extends Record<string, any>>(before: T[], after: T[], key: string): T[] => [...new Map([...before, ...after].map(r => [r[key], r])).values()];
const unavailable = (source: string): never => { throw new SimError('NOT_FOUND', 'Required Feature source is unavailable.', { source }); };

/** A touched native row is not proof of creation. Require both its exact creation marker and row identity. */
async function localTarget(ctx: SimReadContext, id: string, version?: string) {
  const deleted = ctx.overlay.data.regDeletedFeatures ?? {};
  const local: Row[] = [];
  for (const key of ctx.overlay.created.regFeature ?? []) {
    if (!key.startsWith(id + '@') || (version && key !== `${id}@${version}`) || deleted[key]) continue;
    const row = ctx.get<{ row: Row }>('regFeature', key)?.row;
    if (!row || keyOf(row) !== key || row.featureId !== id) throw new SimError('GUARD_FAILED', 'Local Feature creation identity is inconsistent.', { key });
    local.push(row);
  }
  if (!local.length) return undefined;
  const source = await ctx.snapshot<any>('listFeatures', {}, { latestOnly: false });
  const captured = rows(source);
  if (!captured || source?.nextCursor || (typeof source?.total === 'number' && source.total > captured.length)) unavailable('listFeatures:complete-version-history');
  const native = captured!.filter(r => r.featureId === id);
  const created = local.filter(r => !native.some(n => n.version === r.version));
  if (!created.length) return undefined;
  return { local: created.sort((a, b) => compareVersion(a.version, b.version)), native, newId: native.length === 0 };
}

extendSimReader('featureFlags', async ctx => {
  const parsed = FeatureFlagsQuery.safeParse(ctx.req.query);
  if (!parsed.success) throw new SimError('VALIDATION', 'Invalid Feature Flag query.');
  const q = parsed.data;
  if (!q.featureId) return undefined;
  const target = await localTarget(ctx, q.featureId, q.version);
  if (!target) return undefined;
  const original = await ctx.snapshot<any>('featureFlags', {}, q);
  if (original !== null && !Array.isArray(original)) unavailable('featureFlags');
  const captured = await ctx.snapshot<any>('featureFlags', {}, {});
  if (!Array.isArray(captured)) unavailable('featureFlags:all');
  const policies = rows(await ctx.read('listPolicies'));
  if (!policies) unavailable('listPolicies');
  const localPlans = ctx.list<any>('flagLocalPlan');
  const killSource = rows(await ctx.read('killRequests'));
  if (!killSource) unavailable('killRequests');
  const kills = killSource!.map(k => {
    const p = k.publicationId ? ctx.get<any>('publication', k.publicationId) : null;
    return { ...k, delivery: p ? { confirmed: p.confirmed, denominator: p.denominator } : k.delivery ?? null };
  });
  const result = structuredClone(original ?? []);
  for (const f of target.local) {
    const selected = new Map<string, any>();
    for (const p of policies!) if (p.featureId === f.featureId && p.featureVersion === f.version) selected.set(p.flagKey, p);
    // A native or locally registered plan is an actual key declaration. Control points alone are not code evidence.
    const plans = [...captured.filter(r => r.featureId === f.featureId && !r.policy && r.version && compareVersion(r.version, f.version) <= 0), ...localPlans.filter(p => p.featureId === f.featureId && p.version && compareVersion(p.version, f.version) <= 0)];
    const keys = new Set([...selected.keys(), ...plans.map(p => p.flagKey)]);
    for (const flagKey of keys) {
      const p = selected.get(flagKey);
      const publication = p && typeof p.contentHash === 'string' ? ctx.list<any>('publication').filter(pub => pub.kind === 'POLICY' && pub.payload?.featureId === f.featureId && pub.payload.featureVersion === f.version && pub.payload.flagKey === flagKey && pub.payload.policy?.policyId === p.policyId && pub.payload.policy.revision === p.revision && pub.payload.policy.featureId === f.featureId && pub.payload.policy.featureVersion === f.version && pub.payload.policy.contentHash === p.contentHash).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.publicationId.localeCompare(a.publicationId))[0] : null;
      const row = { flagKey, featureId: f.featureId, version: f.version, featureName: f.name, policy: p ? { policyId: p.policyId, status: p.status, revision: p.revision, controlPoint: p.controlPoint } : null, sources: [], publication: publication ? { publicationId: publication.publicationId, status: publication.status, confirmed: publication.confirmed, denominator: publication.denominator } : null, kill: flagKillOf(f.featureId, kills), provenance: LOCAL, codeObservation: 'UNVERIFIED' };
      const i = result.findIndex((r: any) => r.flagKey === flagKey && r.featureId === f.featureId && r.version === f.version);
      if (i < 0) result.push(row);
    }
  }
  return result.sort((a: any, b: any) => `${a.flagKey}:${a.featureId}:${a.version}`.localeCompare(`${b.flagKey}:${b.featureId}:${b.version}`));
});

extendSimReader('featureEvaluations', async ctx => {
  const id = ctx.req.params.id, target = await localTarget(ctx, id);
  if (!target?.newId) return undefined; // This API covers every Version; a new Version cannot reset native counts.
  const n = ctx.req.query.days === undefined || ctx.req.query.days === '' ? EVAL_DEFAULT_DAYS : Number(ctx.req.query.days);
  if (!Number.isInteger(n) || n < 1 || n > EVAL_MAX_DAYS) throw new SimError('VALIDATION', 'Invalid evaluation period.', { field: 'days' });
  const policies = rows(await ctx.read('listPolicies'));
  if (!policies) unavailable('listPolicies');
  const flagKeys = [...new Set(policies!.filter(p => p.featureId === id).map(p => String(p.flagKey)))].sort();
  const end = new Date(`${ctx.now().toISOString().slice(0, 10)}T00:00:00.000Z`), start = new Date(end.getTime() - (n - 1) * 86_400_000);
  // No browser telemetry-ingest writer exists. Registration, previews, delivery ACKs and downloads are not SDK evaluation samples.
  return { ...summarizeEvaluations(id, flagKeys, [], start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), n), provenance: LOCAL, observationStatus: 'UNOBSERVED' };
});

extendSimReader('featureOpsMetrics', async ctx => {
  const id = ctx.req.params.id, target = await localTarget(ctx, id);
  if (!target?.newId) return undefined;
  const findings = ctx.list<any>('localHealthFinding').filter(f => f.featureId === id).map(f => ({ ...f, overdue: findingOpen(f.status) && Date.parse(f.dueAt) < ctx.now().getTime() }));
  // Absence of a Lake observation is not measured zero, an OK history, or a new connection.
  return { connected: false, asOf: null, featureId: id, versions: [], history: [], findings, provenance: LOCAL, observationStatus: 'UNOBSERVED' };
});

extendSimReader('featureTrace', async ctx => {
  const id = ctx.req.params.id, target = await localTarget(ctx, id);
  if (!target) return undefined;
  const f = target.local.at(-1)!;
  if (target.native.some(n => compareVersion(n.version, f.version) > 0)) return undefined;
  const original = await ctx.snapshot<any>('featureTrace', { id }, {});
  if (!target.newId && (!original?.feature || original.feature.featureId !== id || !Array.isArray(original.links) || !Array.isArray(original.evidence) || !Array.isArray(original.requirements))) unavailable('featureTrace');
  const captured = rows(await ctx.snapshot('traceLinks', {}, { status: 'ALL' }));
  if (!captured) unavailable('traceLinks:ALL');
  const links = merge(captured!.filter(l => l.featureId === id), ctx.list<TraceLinkRow>('localTraceLinks').filter(l => l.featureId === id), 'linkId');
  const evidence = merge<TestEvidenceRow>(original?.evidence ?? [], ctx.list<TestEvidenceRow>('localTestEvidence').filter(e => e.featureId === id), 'recordId');
  const requirements: { reqId: string; type: string }[] = (f.requirementIds ?? []).map((reqId: string) => ({ reqId, type: 'SYSTEM' }));
  if (f.swIds?.length) {
    const master = rows(await ctx.snapshot('masterSw', {}, {}));
    const exact = f.swIds.map((swId: string, i: number) => master?.find(s => s.swId === swId && s.version === f.swVersions?.[i]));
    // null is an explicit native "no requirement"; an absent property is an old/incomplete projection.
    if (exact.every((s: any) => s && Object.prototype.hasOwnProperty.call(s, 'requirementId') && (s.requirementId === null || typeof s.requirementId === 'string'))) {
      requirements.push(...exact.filter((s: any) => !!s.requirementId).map((s: any) => ({ reqId: s.requirementId, type: 'SW' })));
    } else {
      const previous = original?.feature?.version ? (await ctx.snapshot<any>('featureDetail', { id, ver: original.feature.version }, {}))?.feature : null;
      if (!previous || JSON.stringify([previous.swIds, previous.swVersions]) !== JSON.stringify([f.swIds, f.swVersions])) throw new SimError('GUARD_FAILED', 'Version-specific SW requirement source is unavailable.', { featureId: id, version: f.version });
      requirements.push(...original.requirements.filter((r: any) => r.type === 'SW'));
    }
  }
  const seen = new Set<string>(), unique = requirements.filter(r => !seen.has(r.reqId) && !!seen.add(r.reqId));
  const linked = new Set(links.filter(l => l.status === 'ACTIVE' && l.kind === 'REQUIREMENT').map(l => l.elementId));
  return { feature: { featureId: id, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId }, links: links.map(l => l.kind === 'TEST_CASE' ? { ...l, test: testCaseStatus(l, evidence) } : l), groups: groupTraceLinks(links.filter(l => l.status === 'ACTIVE')), requirements: unique.map(r => ({ ...r, linked: linked.has(r.reqId) })), evidence, coverage: featureTraceCoverage(links, evidence, unique.map(r => r.reqId)), provenance: LOCAL };
});
