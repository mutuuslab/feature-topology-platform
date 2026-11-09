import { compareVersion } from '@ff/contracts';
import { classificationCompleteness, LIFECYCLE_OWNER_STATES } from '../../../../../contracts/src/rules/ads-change';
import { classificationConfirmHash } from '../../../../../contracts/src/rules/ads-publish';
import { sha256 } from '../../software';
import { registerSimReader } from '../engine';
import type { SimReadContext } from '../types';
import { fail, feature, items, LOCAL, merge, source, write } from './ads-shared';

const CLASS = 'adsClassification', BASE = 'adsMarketBaseline';
const key = (id: string, ver: string) => id + '@' + ver;
async function baselines(ctx: SimReadContext) { return merge((await items(ctx, 'adsMarketBaselines')).map(b => ({ ...b, localKey: b.featureId + '@' + b.version + '#' + b.market })), ctx.list(BASE), 'localKey'); }
async function view(ctx: SimReadContext, id: string, ver: string) {
  const f = await feature(ctx, id, ver), own = ctx.get<any>(CLASS, key(id, ver));
  const base = await source(ctx, 'adsClassification', { id, ver });
  const classification = own?.classification ?? base.classification;
  return { ...base, featureId: id, version: ver, lifecycle: f.lifecycle, classification, completeness: classificationCompleteness(classification), baselines: (await baselines(ctx)).filter(b => b.featureId === id && b.version === ver), ownerHistory: [...(base.ownerHistory ?? []), ...(own?.ownerHistory ?? [])], ruleEnabled: true };
}
registerSimReader('adsClassification', ctx => view(ctx, ctx.req.params.id, ctx.req.params.ver));
registerSimReader('adsMarketBaselines', async ctx => ({ items: (await baselines(ctx)).filter(b => (!ctx.req.query.featureId || b.featureId === ctx.req.query.featureId) && (!ctx.req.query.version || b.version === ctx.req.query.version)) }));
registerSimReader('adsUnclassified', async ctx => {
  const fs = await ctx.read<any>('listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(fs?.items)) fail('INTERNAL', 'Feature classification source is unavailable.');
  const latest = new Map<string, any>();
  for (const f of fs.items) if (!latest.has(f.featureId) || compareVersion(f.version, latest.get(f.featureId).version) > 0) latest.set(f.featureId, f);
  const scope = [...latest.values()].filter(f => !['RELEASED', 'DEPRECATED', 'RETIRED'].includes(f.lifecycle)), result: any[] = [];
  for (const f of scope) {
    const v = await view(ctx, f.featureId, f.version), c = v.completeness;
    if (!c.classified) result.push({ featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, gaps: c.gaps, inferred: c.inferred });
  }
  return { items: result.sort((a, b) => a.featureId.localeCompare(b.featureId)), scope: scope.length, ruleEnabled: true };
});
write('updateAdsClassification', 'ADS_CLASSIFICATION_UPDATE', 'D01-01', async ctx => {
  const { id, ver } = ctx.req.params, b = ctx.req.body, current = await view(ctx, id, ver), before = current.classification;
  const lifecycleOwners = { ...(before?.lifecycleOwners ?? {}), ...b.lifecycleOwners };
  const draft = { featureId: id, version: ver, adsFeature: b.adsFeature, ddtImpact: b.ddtImpact, safetyRelated: b.safetyRelated, owner: b.owner, source: 'MANUAL', status: 'DRAFT', confirmedBy: null, confirmedAt: null, lifecycleOwners, confirmHash: null, provenance: LOCAL };
  const same = before?.status === 'CONFIRMED' && classificationConfirmHash(before) === classificationConfirmHash(draft as any);
  const next = same ? { ...before, source: 'MANUAL', provenance: LOCAL } : draft;
  const previous = ctx.get<any>(CLASS, key(id, ver));
  const ownerHistory = [...(previous?.ownerHistory ?? [])];
  for (const state of LIFECYCLE_OWNER_STATES) if (Object.hasOwn(b.lifecycleOwners, state) && before?.lifecycleOwners?.[state] !== lifecycleOwners[state]) ownerHistory.push({ state, ownerId: lifecycleOwners[state] ?? null, assignedAt: ctx.iso(), assignedBy: ctx.actor.id });
  ctx.put(CLASS, key(id, ver), { classification: next, ownerHistory });
  // ctx.read is committed-state only; return the actual staged result explicitly.
  return { ...current, classification: next, completeness: classificationCompleteness(next as any), ownerHistory: [...((await source(ctx, 'adsClassification', { id, ver })).ownerHistory ?? []), ...ownerHistory] };
});
write('confirmAdsClassification', 'ADS_CLASSIFICATION_CONFIRM', 'D01-01', async ctx => {
  const { id, ver } = ctx.req.params, current = await view(ctx, id, ver), c = current.classification;
  if (!c) fail('GUARD_FAILED', 'Feature classification must be authored first.');
  if (c.status === 'CONFIRMED') fail('CONFLICT', 'Classification is already confirmed.');
  const gaps = classificationCompleteness({ ...c, status: 'CONFIRMED' }).gaps;
  if (gaps.length) fail('GUARD_FAILED', 'Classification is incomplete.', { gaps });
  const next = { ...c, status: 'CONFIRMED', confirmedBy: ctx.actor.id, confirmedAt: ctx.iso(), confirmHash: 'sha256:' + await sha256(classificationConfirmHash(c)), provenance: LOCAL };
  ctx.put(CLASS, key(id, ver), { ...ctx.get<any>(CLASS, key(id, ver)), classification: next, ownerHistory: ctx.get<any>(CLASS, key(id, ver))?.ownerHistory ?? [] });
  return { ...current, classification: next, completeness: classificationCompleteness(next) };
});
write('putMarketBaseline', 'ADS_MARKET_BASELINE_PUT', 'D01-01', async ctx => {
  const { id, ver, market } = ctx.req.params, b = ctx.req.body; await feature(ctx, id, ver);
  if (!/^[A-Z]{2,6}$/.test(market)) fail('VALIDATION', 'Market code must contain 2–6 uppercase letters.');
  if (b.oddProfileRef) {
    const own = ctx.get<any>('adsOddProfile', b.oddProfileRef), p = own ?? (await source(ctx, 'oddProfile', { id: b.oddProfileRef })).profile;
    if (!p || p.status !== 'APPROVED' || p.featureId !== id || p.featureVersion !== ver) fail('GUARD_FAILED', 'ODD must be approved for this exact Feature Version.');
  }
  const { reason: _reason, ...body } = b, row = { ...body, market, featureId: id, version: ver, assumed: false, localKey: id + '@' + ver + '#' + market, provenance: LOCAL };
  ctx.put(BASE, row.localKey, row, { created: true }); return row;
});
