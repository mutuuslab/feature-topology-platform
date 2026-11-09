// Pure reads for genuine browser-created Feature versions; native evidence remains immutable.
import { canonicalJson, compareVersion, FeatureVariability, variabilityOf, computeCompleteness, cyberRequired,
  WP_GATE_STAGES, WP_KINDS, WP_RELATIONS, WORK_PRODUCT, wpStageBlockers,
  type Blocker, type Lifecycle, type WpItem, type WpRelation } from '@ff/contracts';
import { extendSimReader, registerSimListener, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { p10Registry as R } from './registry';
import { readLocalWp, localWpPolicyBasis } from './alm-local';
import { browserDemoExt as E, extUrl } from './ext-mock';

const VAR = 'localFeatureVariability';
const keyOf = (id: string, ver: string) => `${id}@${ver}`;
const unavailable = (message: string): never => { throw new SimError('GUARD_FAILED', message); };
async function nativeFeatures(ctx: SimReadContext): Promise<any[]> {
  const source = await ctx.snapshot<any>('listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(source?.items) || (source.total != null && source.total > source.items.length))
    return unavailable('The complete captured Feature/version index is unavailable.');
  return source.items;
}
async function localTarget(ctx: SimReadContext, id: string, ver: string, allowDeclaration = false) {
  const key = keyOf(id, ver), created = ctx.overlay.created.regFeature?.includes(key), declared = allowDeclaration && !!ctx.get(VAR, key);
  if (ctx.overlay.data.regDeletedFeatures?.[key]) throw new SimError('NOT_FOUND', 'The Feature/version was deleted.');
  if (!created && !declared) return undefined;
  const local = ctx.get<any>('regFeature', key);
  if (local?.row?.featureId !== id || local.row.version !== ver) return unavailable('The local Feature/version creation or declaration has no matching registry row.');
  const found = await R.featureOf(ctx, id, ver);
  if (!found) throw new SimError('NOT_FOUND', 'The Feature/version does not exist.');
  const native = await nativeFeatures(ctx), same = native.some(f => f.featureId === id && f.version === ver);
  // A created marker never authorizes replacing an existing native version.
  if (created && same && !declared) return undefined;
  if (!created && !same) return unavailable('The edited native Feature/version is not present in the captured registry.');
  return { row: found.row, meta: found.meta, native, newFeature: !native.some(f => f.featureId === id), created: !!created };
}
async function refsById(ctx: SimReadContext): Promise<Map<string, any>> {
  const refs = new Map<string, any>(); let total: number | undefined;
  for (let offset = 0; total === undefined || offset < total; offset += 200) {
    const page = await ctx.snapshot<any>('listRefs', {}, { offset: offset || undefined, limit: 200 });
    if (!Array.isArray(page?.items) || !Number.isInteger(page.total) || page.total < 0 || (total !== undefined && total !== page.total) || (offset < page.total && !page.items.length))
      return unavailable('The complete Feature DB reference source is unavailable.');
    total = page.total;
    for (const ref of page.items) refs.set(ref.refId, ref);
  }
  for (const ref of ctx.list<any>('refRow')) refs.set(ref.refId, ref);
  return refs;
}
function normalized(profile: unknown, row: any, refs: Map<string, any>) {
  const parsed = FeatureVariability.safeParse(profile);
  if (!parsed.success) return unavailable('The declared variability profile is invalid.');
  const primary = row.featureRefs?.find((r: any) => r.role === 'PRIMARY')?.refId;
  if (parsed.data.parentRefId && (parsed.data.parentRefId === primary || !refs.has(parsed.data.parentRefId)))
    return unavailable('The variability parent must be a different declared Feature DB reference.');
  const derived = variabilityOf(row, refs);
  return { ...parsed.data, variationPoints: derived?.variationPoints ?? parsed.data.variationPoints };
}
function baseVersion(ctx: SimReadContext, id: string, ver: string): string | undefined {
  const key = keyOf(id, ver);
  const audit = ctx.overlay.audit.find(a => a.action === 'FEATURE_VERSION_CREATE' && a.target === key && a.result === 'ALLOWED');
  const before = audit?.before as { baseVersion?: string } | undefined;
  const event = ctx.overlay.events.find(e => e.type === 'feature.version.created' && e.aggregate === key);
  return before?.baseVersion ?? (event?.payload.baseVersion as string | undefined);
}
async function variabilityView(ctx: SimReadContext, id: string, ver: string, seen = new Set<string>()): Promise<any> {
  const key = keyOf(id, ver); if (seen.has(key)) return unavailable('The recorded Feature version lineage contains a cycle.'); seen.add(key);
  const target = await localTarget(ctx, id, ver, true);
  if (!target) {
    const captured = await ctx.snapshot<any>('featureVariability', { id, ver });
    if (!captured || !Object.prototype.hasOwnProperty.call(captured, 'variability')) return unavailable('The native variability source is unavailable.');
    return structuredClone(captured);
  }
  const refs = await refsById(ctx), row = target.row, primary = row.featureRefs?.find((r: any) => r.role === 'PRIMARY')?.refId;
  if (primary && !refs.has(primary)) return unavailable('The declared primary Feature DB reference is unavailable.');
  const stored = ctx.get<any>(VAR, key), proposed = variabilityOf(row, refs);
  let profile = proposed, source: string | null = proposed ? 'PROPOSED' : null, inheritedFrom: string | null = null;
  if (stored) { profile = normalized(stored.variability, row, refs); source = stored.source; }
  else if (row.variability) { profile = normalized(row.variability, row, refs); source = 'EDITED'; }
  else if (!target.newFeature || ctx.overlay.events.some(e => e.type === 'feature.version.created' && e.aggregate === key)) {
    const base = baseVersion(ctx, id, ver); if (!base || base === ver) return unavailable('The actual base-version relation is unavailable.');
    const before = await R.featureOf(ctx, id, base); if (!before) return unavailable('The recorded base Feature/version source is unavailable.');
    const prev = await variabilityView(ctx, id, base, seen), changed = ['controlPoints', 'swIds'].some(k => canonicalJson(before.row[k] ?? []) !== canonicalJson(row[k] ?? [])) || before.row.featureRefs?.find((r: any) => r.role === 'PRIMARY')?.refId !== primary;
    inheritedFrom = base;
    if (prev.variability) {
      if (!changed) { profile = structuredClone(prev.variability); source = prev.source; }
      else if (prev.source === 'EDITED') { profile = { ...structuredClone(prev.variability), variationPoints: proposed?.variationPoints ?? prev.variability.variationPoints }; source = 'EDITED'; }
      else { profile = proposed; source = proposed ? 'AUTO' : null; }
    }
  }
  let history: any[] = [];
  if (!target.created) { const original = await ctx.snapshot<any>('featureVariability', { id, ver }); if (!Array.isArray(original?.history)) return unavailable('The native variability history is unavailable.'); history = structuredClone(original.history); }
  return { featureId: id, version: ver, variability: profile, source,
    updatedBy: stored?.updatedBy ?? (inheritedFrom ? target.meta.createdBy : null), updatedAt: stored?.updatedAt ?? (inheritedFrom ? target.meta.createdAt : null),
    history, localOnly: true, inheritedFrom, availability: { state: profile ? 'DEFINED' : 'UNDEFINED', nextActions: profile ? ['REVIEW_VARIABILITY'] : ['SELECT_PRIMARY_REFERENCE'] } };
}
// Preserve the validated input that the existing create handler otherwise omits from its row.
// The listener runs in the same staged transaction; failed creation cannot leave a declaration.
registerSimListener(['feature.created', 'feature.updated', 'feature.version.created'], async (ctx, event) => {
  const body = ctx.req.name === 'createVersion' ? ctx.req.body?.changes : ctx.req.body;
  if (!['createFeature', 'createVersion', 'updateDraft'].includes(ctx.req.name) || body?.variability === undefined) return;
  const id = String(event.payload.featureId), ver = String(event.payload.version), key = keyOf(id, ver), entity = ctx.get<any>('regFeature', key);
  if (entity?.row?.featureId !== id || entity.row.version !== ver) return unavailable('The declared variability has no matching registry transaction.');
  const refs = await refsById(ctx), profile = normalized(body.variability, entity.row, refs), proposed = variabilityOf(entity.row, refs);
  ctx.put(VAR, key, { variability: profile, source: canonicalJson(profile) === canonicalJson(proposed) ? 'AUTO' : 'EDITED', updatedBy: ctx.actor.id, updatedAt: ctx.iso() });
});
extendSimReader('featureVariability', async ctx => {
  if (!await localTarget(ctx, ctx.req.params.id, ctx.req.params.ver, true)) return undefined;
  return variabilityView(ctx, ctx.req.params.id, ctx.req.params.ver);
});

async function featureRows(ctx: SimReadContext, target: NonNullable<Awaited<ReturnType<typeof localTarget>>>) {
  const id = target.row.featureId, rows = new Map<string, any>();
  for (const summary of target.native.filter(f => f.featureId === id)) {
    const entity = await R.featureOf(ctx, id, summary.version); if (!entity) return unavailable('A known native Feature/version detail is unavailable.'); rows.set(summary.version, entity.row);
  }
  for (const entity of ctx.list<any>('regFeature').filter(e => e.row?.featureId === id)) {
    const actual = await R.featureOf(ctx, id, entity.row.version); if (actual) rows.set(actual.row.version, actual.row);
  }
  return [...rows.values()].sort((a, b) => compareVersion(a.version, b.version));
}
async function capturedViews(ctx: SimReadContext, target: NonNullable<Awaited<ReturnType<typeof localTarget>>>) {
  const views: any[] = [];
  for (const f of target.native.filter(f => f.featureId === target.row.featureId)) {
    const v = await ctx.snapshot<any>('almWorkProducts', { id: f.featureId, ver: f.version });
    if (!v?.result || !Array.isArray(v.items)) return unavailable('The existing native ALM work-product source is unavailable.'); views.push(v);
  }
  return views;
}
function relationsOf(view: any): WpRelation[] {
  try {
    const source = JSON.parse(view.result.basis);
    if (!Array.isArray(source.relations)) return unavailable('Captured ALM relation evidence is malformed.');
    return source.relations.map((r: any[]) => { if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'string' || !WP_RELATIONS.includes(r[2])) return unavailable('Captured ALM relation evidence is malformed.'); return { from: r[0], to: r[1], kind: r[2], suspect: !!r[3] }; });
  } catch { return unavailable('Captured ALM relation evidence is malformed.'); }
}
async function workProducts(ctx: SimReadContext, target: NonNullable<Awaited<ReturnType<typeof localTarget>>>, fresh = false) {
  const id = target.row.featureId, ver = target.row.version, existing = await readLocalWp(ctx, id, ver); if (existing && !fresh) return existing;
  const versions = await featureRows(ctx, target), views = await capturedViews(ctx, target), basis = await localWpPolicyBasis(ctx, views);
  const connection = await ctx.snapshot<any>('extSync');
  if (!Array.isArray(connection?.items)) return unavailable('The captured ALM connection configuration is unavailable.');
  const config = connection.items.find((x: any) => x.system === 'CODEBEAMER');
  if (!config || !['mock', 'off', 'live'].includes(config.mode)) return unavailable('The codeBeamer connection mode is unavailable.');
  const reqs = new Set<string>(versions.flatMap(f => f.requirementIds ?? [])); let source: any[] = [];
  if (config.mode === 'mock') {
    const captured = await ctx.snapshot<any>('mockExtItems', { system: 'codebeamer' });
    if (!Array.isArray(captured?.items)) return unavailable('The complete captured DEMO work-product items are unavailable.');
    source = (await E.items(ctx, 'CODEBEAMER')).filter(i => i.fields.ffFeatureId === id || typeof i.fields.reqId === 'string' && reqs.has(i.fields.reqId));
  }
  if (source.length && basis.approvalStatuses.size !== 1) return unavailable('The captured codeBeamer approval-state configuration is unavailable.');
  const approvalStatus = [...basis.approvalStatuses][0];
  const fetched: WpItem[] = source.map(i => ({ key: i.key, kind: WP_KINDS.includes(i.fields.wpKind) ? i.fields.wpKind : 'SYS_REQ', title: i.title, status: i.status, approved: String(i.status).trim().toLowerCase() === approvalStatus, version: i.revision, ffVersion: i.fields.ffVersion ?? null, allocationRationale: i.fields.allocationRationale ?? null, obsolete: i.status === 'Obsolete', reqId: typeof i.fields.reqId === 'string' ? i.fields.reqId : null }));
  const relations: WpRelation[] = source.flatMap(i => {
    if (i.fields.relations !== undefined && !Array.isArray(i.fields.relations)) return unavailable('The DEMO work-product relation source is malformed.');
    return (i.fields.relations ?? []).map((r: any) => { if (typeof r.to !== 'string' || !WP_RELATIONS.includes(r.kind)) return unavailable('The DEMO work-product relation source is malformed.'); return { from: i.key, to: r.to, kind: r.kind, suspect: false }; });
  });
  const previous = views.map(v => ctx.get<any>('localAlmWorkProducts', keyOf(v.featureId, v.version))?.view ?? v);
  if (existing && !previous.some(v => v.version === ver)) previous.push(existing);
  const priorItems = new Map<string, WpItem>(); for (const view of previous) for (const item of view.items) if (!priorItems.has(item.key) || priorItems.get(item.key)!.version < item.version) priorItems.set(item.key, item);
  const priorSuspects = previous.flatMap(relationsOf).filter(r => r.suspect), changed = fetched.filter(i => { const before = priorItems.get(i.key); return before?.approved && i.version > before.version; });
  for (const r of relations) { const now = fetched.find(i => i.key === r.from), before = priorItems.get(r.from); r.suspect = priorSuspects.some(p => p.from === r.from && p.to === r.to && p.kind === r.kind) && !(now?.approved && before && now.version > before.version) || changed.some(i => i.key === r.to); }
  const profile = await ctx.read<any>('safetyProfile', { id, ver }); if (!profile?.profile) return unavailable('The local safety profile is unavailable.');
  let hasTara = false;
  for (const f of versions) {
    if (target.native.some(n => n.featureId === id && n.version === f.version)) {
      const original = await ctx.snapshot<any>('analysisEvidence', { id, ver: f.version }); if (!original?.current || !Array.isArray(original.history)) return unavailable('The native analysis evidence source is unavailable.');
    }
    const analysis = await R.analysisView(ctx, id, f.version); hasTara ||= !!analysis?.current?.TARA || (analysis?.history ?? []).some((r: any) => r.kind === 'TARA');
  }
  const cyber = cyberRequired({ regClass: profile.profile.regClass, adsFeature: profile.profile.adsFeature, hasTara, refDomains: (target.row.featureRefs ?? []).map((r: any) => r.refId.slice(0, 2)), name: target.row.name, tags: target.row.tags });
  const result = computeCompleteness({ featureId: id, version: ver, ctx: { asil: target.row.asil, cyber: cyber.required }, items: fetched, relations });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(result.basis)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const items = fetched.filter(i => !i.obsolete && (!i.ffVersion || i.ffVersion === ver)).map(i => ({ ...i, url: extUrl('CODEBEAMER', 'REQUIREMENT', i.key), suspect: relations.some(r => r.from === i.key && r.suspect) })), keys = new Set(items.map(i => i.key)), known = new Set(items.filter(i => i.kind === 'SYS_REQ' && i.reqId).map(i => i.reqId));
  const changes = previous.flatMap(v => v.changes ?? []).filter((x, n, all) => keys.has(x.itemKey) && all.findIndex(y => y.itemKey === x.itemKey && y.toVersion === x.toVersion) === n);
  return { featureId: id, version: ver, result, cyberWhy: cyber.why, items, hash, computedAt: ctx.now().toISOString(), gateMode: basis.gateMode,
    stages: WP_GATE_STAGES.map(st => ({ judgeGate: st.judgeGate, to: st.to, blockers: wpStageBlockers(result, st) })), evidence: existing?.evidence ?? views.find(v => v.version === ver)?.evidence ?? [], changes,
    requirementCheck: { missing: (target.row.requirementIds ?? []).filter((r: string) => !known.has(r)), unlisted: [...known].filter(r => !target.row.requirementIds?.includes(r)) }, suspectDiff: [],
    rejudge: ctx.list<any>('localAlmRejudge').filter(r => r.featureId === id && r.version === ver), localOnly: true, remoteVerified: false, remoteReads: 0,
    availability: { state: config.mode === 'mock' ? source.length ? 'DEMO_SOURCE' : 'UNLINKED' : 'NOT_COLLECTED', mode: config.mode, nextActions: config.mode === 'mock' ? ['LINK_WORK_PRODUCTS', 'REFRESH_WORK_PRODUCTS'] : ['CONFIGURE_DEMO_SOURCE'] } };
}
extendSimReader('almWorkProducts', async ctx => {
  const target = await localTarget(ctx, ctx.req.params.id, ctx.req.params.ver); if (!target) return undefined;
  return workProducts(ctx, target);
});

/** Same enforce-only conditions as native AlmGateService. No command succeeds on a display-only cached result. */
async function guardTarget(ctx: SimReadContext, row: any) {
  const native = await nativeFeatures(ctx), exact = native.some(f => f.featureId === row.featureId && f.version === row.version);
  const local = await localTarget(ctx, row.featureId, row.version);
  if (local) return local;
  if (!exact) return unavailable('The ALM target has no verified native or local Feature/version.');
  const entity = await R.featureOf(ctx, row.featureId, row.version); if (!entity) return unavailable('The ALM target Feature/version is unavailable.');
  return { row: entity.row, meta: entity.meta, native, newFeature: false, created: false };
}
async function guardMode(ctx: SimReadContext, row: any) {
  const target = await guardTarget(ctx, row);
  return { target, basis: await localWpPolicyBasis(ctx) };
}
async function freshGuardView(ctx: SimReadContext, state: Awaited<ReturnType<typeof guardMode>>) {
  const views = await capturedViews(ctx, state.target);
  const connection = await ctx.snapshot<any>('extSync');
  const mode = connection?.items?.find((c: any) => c.system === 'CODEBEAMER')?.mode;
  // Native live mode uses its captured collection, never a synthetic remote refresh.
  if (mode === 'live') {
    const view = await readLocalWp(ctx, state.target.row.featureId, state.target.row.version) ?? views.find(v => v.version === state.target.row.version);
    if (view?.result && Array.isArray(view.requirementCheck?.missing)) return view;
  }
  return workProducts(ctx, state.target, true);
}
async function openGuardRejudges(ctx: SimReadContext, row: any) {
  const source = await ctx.snapshot<any>('almRejudge', {}, { status: 'OPEN' });
  if (!Array.isArray(source?.items) || source.items.length >= 500 || source.total != null && source.total > source.items.length)
    return unavailable('The complete captured open ALM rejudge source is unavailable.');
  return [...new Map([...source.items, ...ctx.list<any>('localAlmRejudge')].map(r => [r.rejudgeId, r])).values()]
    .filter(r => r.featureId === row.featureId && r.version === row.version && r.status === 'OPEN');
}
export async function localAlmTransitionBlockers(ctx: SimReadContext, row: any, to: Lifecycle): Promise<Blocker[]> {
  try {
    const state = await guardMode(ctx, row); if (state.basis.gateMode !== 'enforce') return [];
    const out: Blocker[] = [], stage = WP_GATE_STAGES.find(s => s.to === to);
    let view: any;
    if (stage) {
      view = await freshGuardView(ctx, state);
      for (const p of wpStageBlockers(view.result, stage)) out.push({ code: 'WORK_PRODUCT', message: `${WORK_PRODUCT[p.kind].ko}: ${p.why}`, ref: stage.judgeGate });
      if (to === 'APPROVED' && view.requirementCheck.missing.length) out.push({ code: 'WORK_PRODUCT', message: `요구 ID ${view.requirementCheck.missing.join(', ')}이(가) codeBeamer에 없습니다 — 요구 ID를 확인하거나 codeBeamer에 등록하세요.`, ref: 'G2' });
    }
    const open = await openGuardRejudges(ctx, row);
    for (const r of open) out.push({ code: 'REJUDGE_OPEN', message: `산출물 ${r.itemKey}(${r.itemTitle})이(가) 승인 뒤 바뀌었습니다(v${r.fromVersion} → v${r.toVersion}) — ${r.gate}을(를) 다시 판정한 뒤 전이할 수 있습니다.`, ref: r.gate });
    // Current mock revisions may precede an explicit refresh. A read must not hide that a used item changed.
    if (view) for (const ev of view.evidence ?? []) for (const used of ev.items ?? []) {
      const item = view.items.find((i: any) => i.key === used.key);
      if (item && item.version > used.version && !open.some(r => r.gate === ev.gate && r.itemKey === item.key))
        out.push({ code: 'REJUDGE_OPEN', message: `산출물 ${item.key}이(가) ${ev.gate} 승인 근거 v${used.version} 이후 v${item.version}(으)로 바뀌었습니다 — 다시 판정하세요.`, ref: ev.gate });
    }
    return out;
  } catch (error) {
    if (!(error instanceof SimError)) throw error;
    return [{ code: 'WORK_PRODUCT', message: error.message, ref: 'ALM_SOURCE' }];
  }
}
export async function localAlmGateCheck(ctx: SimReadContext, row: any, gate: string, result: string) {
  const stage = WP_GATE_STAGES.find(s => s.judgeGate === gate);
  if (result !== 'PASS' || !stage) return { blockers: [] as Blocker[], view: undefined as any };
  const state = await guardMode(ctx, row); if (state.basis.gateMode !== 'enforce') return { blockers: [] as Blocker[], view: undefined as any };
  const view = await freshGuardView(ctx, state);
  return { view, blockers: wpStageBlockers(view.result, stage).map(p => ({ code: 'WORK_PRODUCT', message: `${WORK_PRODUCT[p.kind].ko}: ${p.why}`, ref: gate })) };
}
export async function recordLocalAlmJudgment(ctx: SimWriteContext, row: any, gate: string, gateRecordId: string, view?: any) {
  const source = await ctx.snapshot<any>('almRejudge', {}, { status: 'OPEN' });
  const known = [...new Map([...(Array.isArray(source?.items) ? source.items : []), ...ctx.list<any>('localAlmRejudge')].map(r => [r.rejudgeId, r])).values()];
  for (const r of known) if (r.featureId === row.featureId && r.version === row.version && r.gate === gate && r.status === 'OPEN')
    ctx.put('localAlmRejudge', String(r.rejudgeId), { ...r, status: 'RESOLVED', resolvedBy: ctx.actor.id, localOnly: true });
  if (!view) return;
  const evidence = { gate, gateRecordId, hash: view.hash, at: ctx.iso(), backfilled: false, items: view.items.map((i: any) => ({ key: i.key, version: i.version, status: i.status })), localOnly: true };
  ctx.put('localAlmWorkProducts', keyOf(row.featureId, row.version), { view: { ...view, evidence: [...(view.evidence ?? []).filter((e: any) => e.gate !== gate), evidence] }, localOnly: true });
}
