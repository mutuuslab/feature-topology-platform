import { changedKeys, gatesToRejudge } from '@ff/contracts';
import { adsIncidentSummary, adsIncidentView, promotionVerdict, reviewerIndependenceBlocker } from '../../../../../contracts/src/rules/ads-evidence';
import { ADS_IMPACT_PATHS, classifyChange, openPathCounts, pathItems, PATH_CLOSER, type AdsImpactPath } from '../../../../../contracts/src/rules/ads-change';
import { registerSimReader } from '../engine';
import type { SimReadContext } from '../types';
import { fail, feature, items, LOCAL, merge, source, write } from './ads-shared';

const DETERMINATION = 'adsDetermination', FINDING = 'adsFinding', CLOSURE = 'adsImpactClosure';
async function incident(ctx: SimReadContext, id: string) {
  const base = await source(ctx, 'adsIncidentReport', { id });
  if (base.reportId !== id || !Array.isArray(base.determinations)) fail('INTERNAL', 'Incident determination source is unavailable.');
  const determinations = merge(base.determinations.map((d: any) => ({ ...d, localKey: d.reportId + '@' + d.version })), ctx.list<any>(DETERMINATION).filter(d => d.reportId === id), 'localKey');
  const computed = adsIncidentView(base, base.deadline, determinations, ctx.now());
  const audits = ctx.overlay.audit.filter(a => a.target === id && a.action === 'ADS_INCIDENT_DETERMINE').slice().reverse().map(a => ({ at: a.at, actor: a.actorId, role: a.actorRole, action: a.action, result: a.result }));
  return { ...base, ...computed, at: ctx.now().toISOString(), determinations, audit: [...(base.audit ?? []), ...audits] };
}
registerSimReader('adsIncidentReport', ctx => incident(ctx, ctx.req.params.id));
registerSimReader('adsIncidentReports', async ctx => {
  const base = await source(ctx, 'adsIncidentReports');
  if (!Array.isArray(base.items)) fail('INTERNAL', 'Incident list source is unavailable.');
  const result = await Promise.all(base.items.map((r: any) => incident(ctx, r.reportId)));
  return { ...base, items: result, summary: adsIncidentSummary(result), at: ctx.now().toISOString() };
});
write('adsIncidentDetermination', 'ADS_INCIDENT_DETERMINE', 'D04-05', async ctx => {
  const id = ctx.req.params.id, current = await incident(ctx, id), version = (current.determination?.version ?? 0) + 1;
  const row = { reportId: id, version, ...ctx.req.body, decidedBy: ctx.actor.id, decidedRole: ctx.actor.role, decidedAt: ctx.iso(), localKey: id + '@' + version, provenance: LOCAL };
  ctx.put(DETERMINATION, row.localKey, row, { created: true });
  const determinations = [...current.determinations, row];
  return { ...current, ...adsIncidentView(current, current.deadline, determinations, ctx.now()), determinations };
});
async function findings(ctx: SimReadContext, id: string) {
  const base = await source(ctx, 'adsSafetyCase', { featureId: id });
  if (!Array.isArray(base.findings)) fail('INTERNAL', 'Safety Case findings source is unavailable.');
  const all = merge(base.findings, ctx.list<any>(FINDING).filter(f => f.featureId === id), 'findingId');
  return { base, all };
}
registerSimReader('adsSafetyCase', async ctx => {
  const { base, all } = await findings(ctx, ctx.req.params.featureId);
  return { ...base, findings: all, promotion: promotionVerdict(all) };
});
registerSimReader('adsEvidenceManifest', async ctx => {
  const base = await source(ctx, 'adsEvidenceManifest', ctx.req.params);
  if (!base.featureId || !base.manifestId) fail('INTERNAL', 'Evidence manifest source is unavailable.');
  const all = (await findings(ctx, base.featureId)).all;
  return { ...base, findings: all.filter(f => f.manifestId === base.manifestId) };
});
write('adsReviewFindingCreate', 'ADS_REVIEW_FINDING', 'D06-07', async ctx => {
  const b = ctx.req.body, manifest = await source(ctx, 'adsEvidenceManifest', { id: b.manifestId });
  if (manifest.manifestId !== b.manifestId) fail('NOT_FOUND', 'Evidence manifest is missing.');
  const blocker = reviewerIndependenceBlocker(ctx.actor.id, manifest);
  if (blocker) fail('SEPARATION_OF_DUTY', blocker);
  const all = await findings(ctx, manifest.featureId);
  // All captured cases expose their finding IDs; never allocate over another Feature's existing record.
  const featureIds = [...new Set([manifest.featureId, ...(all.base.features ?? []).map((f: any) => f.featureId)])];
  const history = (await Promise.all(featureIds.map(id => findings(ctx, String(id))))).flatMap(r => r.all);
  const row = { ...b, findingId: ctx.nextId('RF', history.map(f => f.findingId), 4), featureId: manifest.featureId, status: 'OPEN', reviewer: ctx.actor.id, reviewerIndependent: true, openedAt: ctx.iso(), closedAt: null, closeReason: null, provenance: LOCAL };
  ctx.put(FINDING, row.findingId, row, { created: true }); return row;
});
async function impactViews(ctx: SimReadContext) {
  const base = await source(ctx, 'adsChangeImpacts');
  if (!Array.isArray(base.items)) fail('INTERNAL', 'Change impact source is unavailable.');
  const result: any[] = [];
  for (const d of base.items) {
    const cls = classifyChange(d.facts, d.declaredKind), recorded = Object.fromEntries(d.paths.map((p: any) => [p.path, p]));
    for (const closure of ctx.list<any>(CLOSURE).filter(c => c.impactId === d.impactId)) recorded[closure.path] = { ...recorded[closure.path], ...closure };
    const paths = pathItems(cls, recorded), reharaOpen = paths.some(p => p.path === 'REHARA' && p.status === 'OPEN') || (d.reharaRequestIds?.length ?? 0) > 0;
    const f = await feature(ctx, d.featureId, d.version), before = d.baseVersion ? await feature(ctx, d.featureId, d.baseVersion) : null;
    const gates = new Set<string>(before ? gatesToRejudge(changedKeys(before, f), f.lifecycle) : []);
    if (cls.paths.includes('REHARA') && paths.some(p => p.path === 'REHARA' && p.status === 'OPEN')) gates.add('G2');
    result.push({ ...d, cls, paths, lifecycle: f.lifecycle, name: f.name, rejudgeGates: [...gates].sort(), reharaOpenAfterRelease: f.lifecycle === 'RELEASED' && reharaOpen });
  }
  return { base, result };
}
registerSimReader('adsChangeImpacts', async ctx => {
  const { base, result } = await impactViews(ctx), q = ctx.req.query;
  const filtered = result.filter(d => (!q.featureId || d.featureId === q.featureId) && (q.status !== 'OPEN' || d.cls.primary === 'UNKNOWN' || d.paths.some((p: any) => p.status === 'OPEN')) && (q.status !== 'DONE' || (d.cls.primary !== 'UNKNOWN' && d.paths.every((p: any) => p.status !== 'OPEN'))));
  return { ...base, items: filtered, counts: openPathCounts(filtered), rejudgeGates: filtered.reduce((n, d) => n + d.rejudgeGates.length, 0) };
});
write('adsCloseImpactPath', 'ADS_IMPACT_PATH_CLOSE', 'D06-05', async ctx => {
  const { id, path } = ctx.req.params;
  if (!(ADS_IMPACT_PATHS as readonly string[]).includes(path)) fail('VALIDATION', 'Unknown change approval path.');
  const p = path as AdsImpactPath, row = (await impactViews(ctx)).result.find(d => d.impactId === id) ?? fail('NOT_FOUND', 'Change impact is missing.');
  if (ctx.actor.role !== PATH_CLOSER[p]) fail('FORBIDDEN', 'Only the assigned safety or cybersecurity role can close this path.');
  if (row.cls.primary === 'UNKNOWN') fail('PRECONDITION_FAILED', 'Unknown changes cannot close approval paths.');
  const before = row.paths.find((x: any) => x.path === path);
  if (before?.status !== 'OPEN') fail('CONFLICT', 'Approval path is already closed or not required.');
  const closure = { impactId: id, path, status: 'DONE', note: ctx.req.body.reason, ref: ctx.req.body.ref ?? null, closedBy: ctx.actor.id, closedAt: ctx.iso(), provenance: LOCAL };
  ctx.put(CLOSURE, id + '/' + path, closure, { created: true });
  return (await impactViews(ctx)).result.find(d => d.impactId === id);
});
