// Offline Flag Code is an explicit, byte-backed DEMO repository. No GitHub/OIDC request is made or attested.
import { compareVersion, effectiveBasisPoints } from '@ff/contracts';
import { canonicalJson } from '../../../../../contracts/src/rules/canonical';
import { domainAbbrOf } from '../../../../../contracts/src/rules/refdb/domain-alias';
import { codeRemovalDue } from '../../../../../contracts/src/rules/retirement';
import { flagPackageOf, planFeatureFlags, flagScaffoldBranch, flagRemovalBranch, flagConstantName, flagFeatureDir, reconcileFlag, summarizeFlagCoverage, flagReleaseGate, evaluateFlagPrCheck, FLAG_CODE_REQUIRED_LIFECYCLES } from '../../../../../contracts/src/rules/flag-coverage';
import { flagPrText, flagPrResumable } from '../../../../../contracts/src/rules/flag-scaffold';
import { FLAG_WAIVER_MAX_DAYS, FlagSourceManifestV2 } from '../../../../../contracts/src/schemas/flag-code';
import { FlagSourceManifest, flagSourceUrl } from '../../../../../contracts/src/schemas/flag-source';
import { sha256 } from '../../software';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { FLAG_LOCAL_SOURCE as LOCAL, makeBundle, scanDemoBundles, signLocalFlag, verifyBundle, verifyLocalFlag, type DemoBundle } from './flag-demo-proof';

const REPO = 'flagLocalRepository', PR = 'flagLocalPr', TREE = 'flagLocalTree', SCAN = 'flagLocalScan', RESULT = 'flagLocalResult', WAIVER = 'flagLocalWaiver', IMPORT = 'flagLocalImport', PLAN = 'flagLocalPlan';
const fail = (code: string, message: string, details?: unknown): never => { throw new SimError(code, message, details); };
const asList = (value: any, name: string): any[] => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : fail('INTERNAL', `Flag source list is unavailable: ${name}`);
async function source(ctx: SimReadContext, name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) { return await ctx.snapshot<any>(name, params, query) ?? fail('INTERNAL', `Flag source is unavailable: ${name}`); }
const merge = (a: any[], b: any[], key: string) => [...new Map([...a, ...b].map(row => [row[key], row])).values()];
async function repos(ctx: SimReadContext) { return merge(asList(await source(ctx, 'flagRepositories'), 'flagRepositories'), ctx.list(REPO), 'repoId'); }
async function repo(ctx: SimReadContext, id: string) { return (await repos(ctx)).find(r => r.repoId === id) ?? fail('NOT_FOUND', 'Flag repository is missing.'); }
function demo(r: any) { if (r.mode !== 'DEMO_MIRROR') fail('NOT_IMPLEMENTED', 'Offline mode cannot contact GitHub, GitLab or Actions OIDC. Use an explicit DEMO repository.'); }
async function prs(ctx: SimReadContext) { return merge(asList(await source(ctx, 'flagPullRequests'), 'flagPullRequests'), ctx.list(PR), 'prId').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.prId.localeCompare(a.prId)); }
async function scans(ctx: SimReadContext) { return merge(asList(await source(ctx, 'flagScans'), 'flagScans'), ctx.list(SCAN), 'scanId'); }
async function fs(ctx: SimReadContext) { const value = await ctx.read<any>('listFeatures', {}, { latestOnly: false }); return asList(value, 'listFeatures'); }
async function feature(ctx: SimReadContext, id: string, ver: string) { return (await ctx.read<any>('featureDetail', { id, ver }))?.feature ?? fail('NOT_FOUND', `Feature ${id}@${ver} is missing.`); }
async function policies(ctx: SimReadContext) { return asList(await ctx.read('listPolicies'), 'listPolicies'); }
async function retirements(ctx: SimReadContext) { return asList(await ctx.read('flagRetirements'), 'flagRetirements'); }
async function baseCoverage(ctx: SimReadContext) { const result = await source(ctx, 'flagCoverage'); if (!Array.isArray(result.rows)) fail('INTERNAL', 'Flag coverage source is unavailable.'); return result; }
async function plans(ctx: SimReadContext, f: any) {
  const base = (await baseCoverage(ctx)).rows.filter((r: any) => r.featureId === f.featureId && r.package && r.controlPoint);
  const allPolicies = (await policies(ctx)).filter(p => p.featureId === f.featureId);
  let pkg = base[0]?.package;
  if (!pkg) {
    const primary = f.featureRefs?.find((r: any) => r.role === 'PRIMARY'), ref = primary ? await ctx.read<any>('refDetail', { refId: primary.refId }) : null;
    if (primary && !ref?.ref) fail('INTERNAL', 'Primary Feature DB domain source is unavailable.');
    pkg = flagPackageOf({ domainAbbr: ref ? domainAbbrOf(ref.ref.domain) ?? null : null, ownerId: f.ownerId, tags: f.tags });
  }
  const retired = new Set((await retirements(ctx)).filter(r => r.status === 'RETIRED' || r.steps?.CODE_REMOVED).map(r => r.flagKey));
  const computed = planFeatureFlags(f, pkg, [...new Map(allPolicies.map(p => [p.flagKey, { flagKey: p.flagKey, controlPoint: p.controlPoint }])).values()]);
  return computed.filter(e => !retired.has(e.flagKey));
}
function write(name: string, action: string, component: string, fn: (ctx: SimWriteContext) => Promise<any>) {
  registerSimHandler(name, async ctx => {
    const target = ctx.req.params.id ?? ctx.req.body.featureId ?? ctx.req.body.flagKey ?? name;
    try {
      const value = await fn(ctx);
      ctx.audit({ action, target, after: { saved: true, provenance: LOCAL }, reason: ctx.req.body.reason ?? ctx.req.body.comment ?? null, componentId: component });
      ctx.emit(action.toLowerCase().replaceAll('_', '.'), target, { provenance: LOCAL, by: ctx.actor.id }, { componentId: component }); return value;
    } catch (e) { if (e instanceof SimError) ctx.fail(e.code, e.message, e.details, { action, target, reason: e.message, componentId: component, result: ['SEPARATION_OF_DUTY', 'FORBIDDEN'].includes(e.code) ? 'DENIED' : 'FAILED' }); throw e; }
  });
}
registerSimReader('flagRepositories', async ctx => ({ items: await repos(ctx) }));
registerSimReader('flagPullRequests', async ctx => ({ items: (await prs(ctx)).filter(p => Object.entries(ctx.req.query).every(([k, v]) => !['repoId', 'featureId', 'kind', 'state'].includes(k) || !v || p[k] === v)).sort((a, b) => b.prId.localeCompare(a.prId)) }));
write('createFlagRepository', 'FLAG_REPO_CREATE', 'D04-01', async ctx => {
  const b = ctx.req.body; demo(b); const all = await repos(ctx);
  if (all.some(r => r.repository === b.repository)) fail('CONFLICT', 'Repository is already registered.');
  const row = { ...b, repoId: ctx.nextId('FREPO', all.map(r => r.repoId), 3), provider: new URL(b.repository).hostname.includes('gitlab') ? 'GITLAB' : 'GITHUB', status: 'ACTIVE', webhook: { state: 'NOT_CONFIGURED', lastDeliveryId: null, lastDeliveryAt: null, failureCount: 0, lastError: null }, lastScan: null, createdAt: ctx.iso(), createdBy: ctx.actor.id, provenance: LOCAL };
  ctx.put(REPO, row.repoId, row, { created: true }); return row;
});
write('updateFlagRepository', 'FLAG_REPO_UPDATE', 'D04-01', async ctx => {
  const before = await repo(ctx, ctx.req.params.id), { reason: _reason, ...patch } = ctx.req.body, row = { ...before, ...patch, provenance: LOCAL };
  if (row.scanIntervalMinutes > 0 && row.scanIntervalMinutes < 15) fail('VALIDATION', 'Scheduled scans must be at least 15 minutes apart.');
  ctx.put(REPO, row.repoId, row); return row;
});

async function initializeTree(ctx: SimReadContext, r: any, ref: string) {
  demo(r);
  const existing = ctx.get<any>(TREE, r.repoId + '@' + ref);
  if (existing) return existing;
  if (ref !== r.defaultBranch) fail('GUARD_FAILED', 'This local DEMO branch has no retained scaffold source.');
  const latest = new Map<string, any>();
  for (const f of await fs(ctx)) if (FLAG_CODE_REQUIRED_LIFECYCLES.includes(f.lifecycle) && (!latest.has(f.featureId) || compareVersion(f.version, latest.get(f.featureId).version) > 0)) latest.set(f.featureId, f);
  const captured = (await baseCoverage(ctx)).rows;
  const bundles: DemoBundle[] = [];
  for (const row of latest.values()) {
    const knownPackage = captured.find((r: any) => r.featureId === row.featureId && r.package)?.package;
    if (knownPackage && !r.packages.some((p: any) => p.name === knownPackage)) continue;
    const f = await feature(ctx, row.featureId, row.version), plan = await plans(ctx, f);
    if (plan.length && r.packages.some((p: any) => p.name === plan[0].package)) bundles.push(await makeBundle(f, plan));
  }
  return { repoId: r.repoId, ref, bundles, commit: null, generation: 'EXACT_FF_SCAFFOLD_FROM_LOCAL_PLAN', provenance: LOCAL };
}
async function verifiedResult(ctx: SimReadContext, result: any) {
  if (!result || result.provenance !== 'DEMO' || result.simulationSource !== LOCAL) return false;
  if (!await verifyLocalFlag(ctx, 'SCAN', result.manifest, result.localSignature)) return false;
  try {
    const checked = await scanDemoBundles(result.bundles, result.scanPaths), same = canonicalJson({ usages: checked.usages, unresolved: checked.unresolved, filesScanned: checked.files.length });
    const expectedCommit = await sha256('FF-LOCAL-DEMO-TREE/1\n' + canonicalJson({ repoId: result.repoId, ref: result.manifest.ref, files: checked.files.map(f => ({ path: f.path, sha256: f.sha256 })).sort((a, b) => a.path.localeCompare(b.path)) }));
    return result.manifest.commit === expectedCommit && canonicalJson(result.files) === canonicalJson(checked.files) && same === canonicalJson({ usages: result.manifest.usages, unresolved: result.manifest.unresolved, filesScanned: result.manifest.filesScanned });
  } catch { return false; }
}
async function scanTree(ctx: SimWriteContext, r: any, tree: any, trigger: string, prCheck: any = null) {
  demo(r); if (r.status !== 'ACTIVE') fail('GUARD_FAILED', 'Paused repositories cannot be scanned.');
  const checked = await scanDemoBundles(tree.bundles, r.scanPaths);
  const commit = await sha256('FF-LOCAL-DEMO-TREE/1\n' + canonicalJson({ repoId: r.repoId, ref: tree.ref, files: checked.files.map(f => ({ path: f.path, sha256: f.sha256 })).sort((a, b) => a.path.localeCompare(b.path)) }));
  const manifest = FlagSourceManifestV2.parse({ format: 'ff-flag-source/v2', provider: r.provider, repository: r.repository, ref: tree.ref, commit, scannedAt: ctx.iso(), scanner: { name: 'ff-flag-scan', version: '0.0.0' }, filesScanned: checked.files.length, usages: checked.usages, unresolved: checked.unresolved });
  const previous = ctx.list<any>(RESULT).find(x => x.repoId === r.repoId && x.manifest.commit === commit), withoutTime = (m: any) => canonicalJson({ ...m, scannedAt: '' });
  if (previous && withoutTime(previous.manifest) !== withoutTime(manifest)) fail('CONFLICT', 'An immutable local commit already has different scan content.');
  const allScans = await scans(ctx), resultId = previous?.resultId ?? ctx.nextId('FRES', [...allScans.map(s => s.resultId).filter(Boolean), ...ctx.list<any>(RESULT).map(r => r.resultId)], 6);
  const localSignature = previous?.localSignature ?? await signLocalFlag(ctx, 'SCAN', manifest);
  const result = previous ?? { resultId, repoId: r.repoId, manifest, localSignature, bundles: tree.bundles, scanPaths: r.scanPaths, files: checked.files, provenance: 'DEMO', simulationSource: LOCAL, verificationBoundary: 'EXACT_TEMPLATE_BYTES_SHA256_AND_LOCAL_ED25519', commitAlgorithm: 'LOCAL_TREE_SHA256_NOT_REMOTE_GIT_HEAD' };
  if (!await verifiedResult(ctx, result)) fail('GUARD_FAILED', 'Local DEMO signature or retained exact source bytes do not verify.');
  const scan = { scanId: ctx.nextId('FSCAN', allScans.map(s => s.scanId), 6), repoId: r.repoId, trigger, ref: tree.ref, commit, baseCommit: null, prNumber: null, status: 'SUCCEEDED', queuedAt: ctx.iso(), finishedAt: ctx.iso(), resultId, summary: { filesScanned: manifest.filesScanned, usages: manifest.usages.length, flagKeys: new Set(manifest.usages.map(u => u.flagKey)).size, unresolved: manifest.unresolved.length }, attestation: { kind: 'FF_SCANNER', keyId: localSignature.keyId, signature: localSignature.signature }, prCheck, error: null, requestedBy: ctx.actor.id, deliveryId: null, provenance: LOCAL, verificationBoundary: result.verificationBoundary };
  ctx.put(RESULT, resultId, result, { created: !previous }); ctx.put(SCAN, scan.scanId, scan, { created: true });
  ctx.put(TREE, r.repoId + '@' + tree.ref, { ...tree, commit });
  if (tree.ref === r.defaultBranch) ctx.put(REPO, r.repoId, { ...r, lastScan: { scanId: scan.scanId, commit, at: scan.finishedAt, status: scan.status }, provenance: LOCAL });
  return scan;
}
write('rescanFlagRepository', 'FLAG_SCAN_REQUEST', 'D04-01', async ctx => {
  const r = await repo(ctx, ctx.req.params.id); demo(r);
  return scanTree(ctx, r, await initializeTree(ctx, r, ctx.req.body.ref ?? r.defaultBranch), 'MANUAL');
});
registerSimReader('flagScans', async ctx => {
  const q = ctx.req.query;
  if (q.cursor) fail('VALIDATION', 'Reload the local DEMO scan list instead of reusing a server cursor.');
  const all = (await scans(ctx)).filter(s => (!q.repoId || s.repoId === q.repoId) && (!q.status || s.status === q.status) && (!q.trigger || s.trigger === q.trigger)).sort((a, b) => b.scanId.localeCompare(a.scanId));
  return { items: all.slice(0, Math.min(200, Math.max(1, Number(q.limit) || 50))), nextCursor: null };
});
registerSimReader('flagScanDetail', async ctx => {
  const scan = ctx.get<any>(SCAN, ctx.req.params.id);
  if (!scan) return source(ctx, 'flagScanDetail', ctx.req.params);
  const result = ctx.get<any>(RESULT, scan.resultId), verified = await verifiedResult(ctx, result);
  return { scan, manifest: result?.manifest ?? null, provenance: 'DEMO', verified, simulationSource: LOCAL, verificationBoundary: result?.verificationBoundary, sourceFiles: result?.files ?? [] };
});

async function openPr(ctx: SimWriteContext, r: any, input: { kind: string; featureId: string; version: string; flagKeys: string[]; branch: string; title: string; body: string; bundle: DemoBundle; retirementId: string | null }) {
  demo(r); if (r.status !== 'ACTIVE') fail('GUARD_FAILED', 'Paused repositories cannot receive PRs.');
  const all = await prs(ctx), prior = all.find(p => p.repoId === r.repoId && p.branch === input.branch);
  if (prior && !['FAILED', 'CLOSED'].includes(prior.state) && !flagPrResumable(prior, ctx.now().getTime())) fail('CONFLICT', 'The same DEMO branch already has an active or merged PR.');
  await verifyBundle(input.bundle);
  const number = Math.max(0, ...all.filter(p => p.repoId === r.repoId).map(p => p.number ?? 0)) + 1;
  const row = { prId: prior?.prId ?? ctx.nextId('FPR', all.map(p => p.prId), 6), repoId: r.repoId, kind: input.kind, featureId: input.featureId, version: input.version, flagKeys: input.flagKeys, branch: input.branch, number, url: null, title: input.title, state: 'OPEN', checkConclusion: 'PENDING', files: input.bundle.files.map(f => ({ path: f.path, change: input.kind === 'REMOVAL' ? 'MODIFY' : 'ADD' })), createdAt: ctx.iso(), createdBy: ctx.actor.id, mergedAt: null, mergedBy: null, mergeCommit: null, retirementId: input.retirementId, failure: null, provenance: LOCAL, body: input.body, sourceBundle: input.bundle };
  ctx.put(PR, row.prId, row, { created: !prior });
  ctx.put(TREE, r.repoId + '@' + row.branch, { repoId: r.repoId, ref: row.branch, bundles: [input.bundle], commit: null, generation: 'EXACT_FF_SCAFFOLD_PR', provenance: LOCAL });
  return row;
}
write('createFlagPr', 'FLAG_PR_CREATE', 'D01-06', async ctx => {
  const b = ctx.req.body, r = await repo(ctx, b.repoId); demo(r);
  const f = await feature(ctx, b.featureId, b.version);
  if (['PROPOSED', 'RETIRED'].includes(f.lifecycle)) fail('GUARD_FAILED', 'Flag scaffold PRs require an approved, non-retired Feature Version.');
  const plan = await plans(ctx, f);
  if (!plan.length) fail('GUARD_FAILED', 'This Feature has no defined control points or active Flag plan.');
  if ((b.flagKeys ?? []).some((k: string) => !plan.some(e => e.flagKey === k))) fail('VALIDATION', 'Requested Flag key is not in this Feature plan.');
  if (!r.packages.some((p: any) => p.name === plan[0].package)) fail('GUARD_FAILED', 'The Feature package is not connected to this repository.');
  for (const entry of plan) ctx.put(PLAN, entry.flagKey, { ...entry, plannedAt: ctx.iso(), provenance: LOCAL }, { created: !ctx.get(PLAN, entry.flagKey) });
  const text = flagPrText('SCAFFOLD', f, b.flagKeys?.length ? b.flagKeys : plan.map(e => e.flagKey), 'https://offline-demo.invalid');
  return openPr(ctx, r, { kind: 'SCAFFOLD', featureId: f.featureId, version: f.version, flagKeys: b.flagKeys?.length ? b.flagKeys : plan.map(e => e.flagKey), branch: flagScaffoldBranch(f.featureId, f.version), ...text, bundle: await makeBundle(f, plan), retirementId: null });
});
write('createFlagRemovalPr', 'FLAG_PR_CREATE', 'D01-01', async ctx => {
  const b = ctx.req.body, r = await repo(ctx, b.repoId); demo(r);
  const retirement = (await retirements(ctx)).find(x => x.retirementId === b.retirementId) ?? fail('NOT_FOUND', 'Retirement request is missing.');
  if (retirement.flagKey !== b.flagKey) fail('VALIDATION', 'Flag does not match the Retirement request.');
  if (retirement.status !== 'APPROVED' || !retirement.approvedAt) fail('GUARD_FAILED', 'Only an approved Flag Retirement can create a removal PR.');
  const tree = await initializeTree(ctx, r, r.defaultBranch), original = tree.bundles.find((x: DemoBundle) => x.feature.featureId === retirement.featureId) as DemoBundle | undefined;
  if (!original || !original.plan.some(p => p.flagKey === b.flagKey)) fail('GUARD_FAILED', 'The local retained DEMO source has no call to remove. Rescan its exact source first.');
  const f = await feature(ctx, retirement.featureId, retirement.featureVersion), entry = original.plan.find(p => p.flagKey === b.flagKey)!;
  const deployed = (await policies(ctx)).filter(p => p.flagKey === b.flagKey && p.status === 'DEPLOYED').at(-1), finalValue = !!deployed && deployed.enabled !== false;
  const bundle = await makeBundle(f, original.plan.filter(p => p.flagKey !== b.flagKey).map(p => ({ ...p, version: f.version })), [...original.removed, { entry: { ...entry, version: f.version }, finalValue }]);
  const text = flagPrText('REMOVAL', f, [b.flagKey], 'https://offline-demo.invalid');
  return openPr(ctx, r, { kind: 'REMOVAL', featureId: f.featureId, version: f.version, flagKeys: [b.flagKey], branch: flagRemovalBranch(b.flagKey), ...text, bundle, retirementId: b.retirementId });
});
write('demoMergeFlagPr', 'FLAG_PR_DEMO_MERGE', 'D01-06', async ctx => {
  const p = (await prs(ctx)).find(p => p.prId === ctx.req.params.id) ?? fail('NOT_FOUND', 'Flag PR is missing.'), r = await repo(ctx, p.repoId); demo(r);
  if (p.state !== 'OPEN') fail('GUARD_FAILED', 'Only an open local DEMO PR can be merged.');
  // Native PR summaries do not capture their source bytes. They cannot be promoted by a simulated merge.
  if (p.provenance !== LOCAL || !p.sourceBundle) fail('GUARD_FAILED', 'Captured PR source bytes are not retained. Create a new explicit local DEMO scaffold PR.');
  await verifyBundle(p.sourceBundle);
  const before = await initializeTree(ctx, r, r.defaultBranch), bundles = [...before.bundles.filter((b: DemoBundle) => b.feature.featureId !== p.featureId), p.sourceBundle];
  const baseFound = await scanDemoBundles(before.bundles, r.scanPaths), headFound = await scanDemoBundles(bundles, r.scanPaths), known = new Set((await baseCoverage(ctx)).rows.filter((r: any) => r.featureId).map((r: any) => r.flagKey));
  for (const e of ctx.list<any>(PLAN)) known.add(e.flagKey);
  const retiring = new Set((await retirements(ctx)).filter(r => ['APPROVED', 'RETIRED'].includes(r.status)).map(r => r.flagKey));
  const prCheck = evaluateFlagPrCheck({ base: baseFound.usages, head: headFound.usages, baseUnresolved: baseFound.unresolved, headUnresolved: headFound.unresolved, registryState: key => retiring.has(key) ? 'RETIRING' : known.has(key) ? 'ACTIVE' : null });
  if (prCheck.conclusion !== 'success') fail('GUARD_FAILED', 'DEMO PR checks reject this merge.', { prCheck });
  const scan = await scanTree(ctx, r, { ...before, bundles }, 'PUSH', prCheck), merged = { ...p, state: 'MERGED', checkConclusion: 'SUCCESS', mergedAt: ctx.iso(), mergedBy: ctx.actor.id, mergeCommit: scan.commit };
  ctx.put(PR, p.prId, merged); return { pullRequest: merged, scan };
});

async function waiverRows(ctx: SimReadContext) {
  return merge(asList(await source(ctx, 'flagGateWaivers'), 'flagGateWaivers'), ctx.list(WAIVER), 'waiverId').map(w => Date.parse(w.expiresAt) <= ctx.now().getTime() && ['REQUESTED', 'APPROVED'].includes(w.state) ? { ...w, state: 'EXPIRED' } : w);
}
async function requiredDeciders(ctx: SimReadContext, w: any) {
  const p = (await ctx.read<any>('safetyProfile', { id: w.featureId, ver: w.version }))?.profile;
  if (!p || !/^F[0-4]$/.test(p.fClass)) fail('GUARD_FAILED', 'Feature safety classification source is missing.');
  return ['F0', 'F1'].includes(p.fClass) ? ['FEATURE_APPROVER'] : ['FEATURE_APPROVER', 'SAFETY_OFFICER'];
}
function decisionValue(w: any, d: any) { return { schema: 'ff.local.flag-waiver/1', waiverId: w.waiverId, flagKey: w.flagKey, featureId: w.featureId, version: w.version, coverageStatus: w.coverageStatus, expiresAt: w.expiresAt, requestedBy: w.requestedBy, reason: w.reason, decision: d.decision, by: d.by, role: d.role, at: d.at }; }
async function verifiedWaiver(ctx: SimReadContext, w: any) {
  if (w.provenance !== LOCAL) return true; // Immutable captured observation, never a local signing anchor.
  const need = await requiredDeciders(ctx, w), decisions = w.decisions ?? [];
  if (decisions.some((d: any) => d.by === w.requestedBy || !need.includes(d.role))) return false;
  if (new Set(decisions.map((d: any) => d.by)).size !== decisions.length || new Set(decisions.map((d: any) => d.role)).size !== decisions.length) return false;
  for (const d of decisions) if (!await verifyLocalFlag(ctx, 'APPROVAL', decisionValue(w, d), d.signature)) return false;
  return w.state !== 'APPROVED' || need.every(r => decisions.some((d: any) => d.role === r && d.decision === 'APPROVE'));
}
registerSimReader('flagGateWaivers', async ctx => ({ items: (await waiverRows(ctx)).filter(w => (!ctx.req.query.flagKey || w.flagKey === ctx.req.query.flagKey) && (!ctx.req.query.state || w.state === ctx.req.query.state)) }));

// Only code facts are replaced by local scans. Other captured observations remain: a local source scan
// cannot repair Unleash, deployment, vehicle readback, or erase historical stale warnings.
async function coverage(ctx: SimReadContext, scope?: { featureId: string; version: string }) {
  const full = await baseCoverage(ctx), scoped = scope ? await ctx.snapshot<any>('flagCoverage', {}, scope) : null;
  if (scope && !scoped?.rows && !ctx.list<any>(PLAN).some(p => p.featureId === scope.featureId && p.version === scope.version)) fail('GUARD_FAILED', 'Version-specific captured code evidence is unavailable.');
  const base = scoped?.rows ? { ...full, rows: scoped.rows } : full, repository = await repos(ctx), allPrs = await prs(ctx), waivers = await waiverRows(ctx), retirement = await retirements(ctx);
  const rows: any[] = structuredClone(base.rows), localPlans = ctx.list<any>(PLAN), touched = new Map<string, any>();
  for (const r of repository) {
    const results = ctx.list<any>(RESULT).filter(x => x.repoId === r.repoId && x.manifest.ref === r.defaultBranch).sort((a, b) => b.manifest.scannedAt.localeCompare(a.manifest.scannedAt) || b.resultId.localeCompare(a.resultId));
    const result = results[0];
    if (result) { if (!await verifiedResult(ctx, result)) fail('GUARD_FAILED', 'Latest local source signature, template or SHA is invalid.'); touched.set(r.repoId, result); }
    else if (ctx.get<any>(REPO, r.repoId)) {
      const original = asList(await source(ctx, 'flagRepositories'), 'flagRepositories').find(x => x.repoId === r.repoId);
      if (original && original.defaultBranch !== r.defaultBranch) touched.set(r.repoId, null);
    }
  }
  for (const p of localPlans) if (!rows.some(r => r.flagKey === p.flagKey)) {
    const f = await feature(ctx, p.featureId, p.version);
    rows.push({ flagKey: p.flagKey, featureId: f.featureId, version: f.version, featureName: f.name, lifecycle: f.lifecycle, package: p.package, controlPoint: p.controlPoint, planSource: p.source, policy: null, code: { usages: [], lastScanAt: null, lastSeen: null }, pullRequest: null, unleash: { configured: false, present: false, revision: null, archived: false }, deploy: null, report: null, findings: [], waiver: null });
  }
  for (const r of rows) {
    if (scope && r.featureId !== scope.featureId) continue;
    const affected = ctx.list<any>(PLAN).some(p => p.flagKey === r.flagKey) || ctx.list<any>(PR).some(p => p.flagKeys.includes(r.flagKey)) || ctx.list<any>(WAIVER).some(w => w.flagKey === r.flagKey) || r.code.usages.some((u: any) => touched.has(u.repoId)) || [...touched.values()].some(x => x?.manifest.usages.some((u: any) => u.flagKey === r.flagKey));
    if (!affected) continue;
    if (scope) { const f = await feature(ctx, scope.featureId, scope.version); r.version = f.version; r.lifecycle = f.lifecycle; }
    const previous = r.code.usages, kept = previous.filter((u: any) => !touched.has(u.repoId));
    for (const [repoId, result] of touched) if (result) for (const u of result.manifest.usages.filter((u: any) => u.flagKey === r.flagKey)) {
      const { flagKey: _flag, via: _via, ...loc } = u, scan = ctx.list<any>(SCAN).find(s => s.resultId === result.resultId);
      kept.push({ ...loc, repoId, scanId: scan?.scanId ?? null, repository: 'https://offline-demo.invalid', provider: result.manifest.provider, commit: result.manifest.commit, url: flagSourceUrl({ ...result.manifest, repository: 'https://offline-demo.invalid', path: u.path, line: u.line }), importedAt: result.manifest.scannedAt, importedBy: 'local-scanner', provenance: 'DEMO' });
    }
    const times = [...touched.values()].filter(Boolean).map(x => x.manifest.scannedAt);
    r.code = { usages: kept, lastScanAt: [r.code.lastScanAt, ...times].filter(Boolean).sort().at(-1) ?? null, lastSeen: !kept.length && previous.length ? { repoId: previous[0].repoId, commit: previous[0].commit, at: previous[0].importedAt } : kept.length ? null : r.code.lastSeen };
    const related = allPrs.filter(p => p.flagKeys.includes(r.flagKey)), scaffold = related.find(p => p.kind === 'SCAFFOLD'), pr = related[0];
    if (pr) r.pullRequest = { prId: pr.prId, kind: pr.kind, state: pr.state, number: pr.number, url: pr.url };
    const ret = retirement.find(x => x.flagKey === r.flagKey && ['APPROVED', 'RETIRED'].includes(x.status) && x.approvedAt), plan = localPlans.find(p => p.flagKey === r.flagKey);
    const approved = waivers.find(w => w.flagKey === r.flagKey && w.featureId === r.featureId && w.version === r.version && w.state === 'APPROVED' && Date.parse(w.expiresAt) > ctx.now().getTime());
    const valid = approved && await verifiedWaiver(ctx, approved) ? approved : null, current = valid ?? waivers.find(w => w.flagKey === r.flagKey && w.featureId === r.featureId && w.version === r.version && w.state === 'REQUESTED');
    const result = reconcileFlag({ now: ctx.now().toISOString(), flagKey: r.flagKey, registry: r.featureId ? { featureId: r.featureId, version: r.version, lifecycle: r.lifecycle, plannedAt: plan?.plannedAt ?? null, policy: r.policy, retirement: ret ? { approvedAt: ret.approvedAt, codeRemovalDueAt: codeRemovalDue(ret.approvedAt, ret.nextReleaseAt), codeRemoved: !!ret.steps?.CODE_REMOVED } : null, registryRetiredAt: r.lifecycle === 'RETIRED' ? ret?.approvedAt ?? ctx.now().toISOString() : null } : null, code: { current: kept.length, lastSeen: r.code.lastSeen, lastScanAt: r.code.lastScanAt }, pullRequest: scaffold ? { state: scaffold.state, openedAt: scaffold.createdAt } : null, unleash: r.unleash, deploy: r.deploy, report: r.report, rollout: null, lastEvaluatedAt: null, waiver: valid });
    for (const f of r.findings.filter((f: any) => !['NO_CODE', 'CALL_DELETED', 'PR_OPEN', 'UNREGISTERED_KEY', 'REMOVAL_DUE'].includes(f.status))) if (!result.findings.some(g => g.status === f.status)) result.findings.push(f);
    const priority = ['UNREGISTERED_KEY', 'CALL_DELETED', 'NO_CODE', 'UNLEASH_MISMATCH', 'REMOVAL_DUE', 'PR_OPEN', 'STALE', 'DYNAMIC_KEY', 'OK'];
    result.status = (priority.find(s => result.findings.some(f => f.status === s)) ?? 'OK') as any;
    result.severity = (['BLOCKER', 'WARNING', 'INFO'].find(s => result.findings.some(f => f.severity === s)) ?? 'OK') as any;
    const blocking = result.findings.filter(f => ['NO_CODE', 'CALL_DELETED', 'PR_OPEN', 'UNLEASH_MISMATCH', 'UNREGISTERED_KEY'].includes(f.status) && (f.severity === 'BLOCKER' || f.status === 'PR_OPEN'));
    result.waived = !!valid && blocking.length > 0 && blocking.every(f => f.status === valid.coverageStatus); result.releaseBlocking = blocking.length > 0 && !result.waived;
    Object.assign(r, result, { waiver: current ? { waiverId: current.waiverId, state: current.state, expiresAt: current.expiresAt } : null });
  }
  const fileFindings = base.fileFindings.filter((f: any) => !touched.has(f.repoId));
  for (const [repoId, result] of touched) if (result) for (const call of result.manifest.unresolved) fileFindings.push({ repoId, commit: result.manifest.commit, status: 'DYNAMIC_KEY', call, since: result.manifest.scannedAt });
  return { generatedAt: ctx.now().toISOString(), summary: { ...summarizeFlagCoverage(rows), repositories: repository.map(r => ({ repoId: r.repoId, displayName: r.displayName, lastScanAt: r.lastScan?.at ?? null, commit: r.lastScan?.commit ?? null, webhook: r.webhook.state })) }, rows: scope ? rows.filter(r => r.featureId === scope.featureId) : rows, fileFindings };
}
registerSimReader('flagCoverage', async ctx => {
  const q = ctx.req.query, c = await coverage(ctx, q.featureId && q.version ? { featureId: q.featureId, version: q.version } : undefined), statuses = q.status?.split(','), needle = q.q?.trim().toLowerCase(), rr = q.repoId ? await repo(ctx, q.repoId) : null;
  return { ...c, rows: c.rows.filter(r => (!q.featureId || r.featureId === q.featureId) && (!q.version || r.version === q.version) && (!q.package || r.package === q.package) && (!statuses || statuses.some(s => r.status === s || r.findings.some((f: any) => f.status === s))) && (!rr || r.code.usages.some((u: any) => u.repoId === rr.repoId) || rr.packages.some((p: any) => p.name === r.package)) && (!needle || [r.flagKey, r.featureId, r.featureName].filter(Boolean).some(s => s.toLowerCase().includes(needle)))) };
});
async function releaseGate(ctx: SimReadContext, id: string, ver: string) {
  await feature(ctx, id, ver); const c = await coverage(ctx, { featureId: id, version: ver });
  return { featureId: id, version: ver, ...flagReleaseGate(c.rows.map(r => ({ flagKey: r.flagKey, result: r, waiverId: r.waiver?.waiverId, waiverExpiresAt: r.waiver?.expiresAt }))), checkedAt: ctx.now().toISOString() };
}
registerSimReader('flagReleaseGate', ctx => releaseGate(ctx, ctx.req.params.id, ctx.req.params.ver));
registerSimReader('flagCoverageDetail', async ctx => {
  const key = ctx.req.params.flagKey, row = (await coverage(ctx)).rows.find(r => r.flagKey === key) ?? fail('NOT_FOUND', 'Flag coverage is missing.'), old = await ctx.snapshot<any>('flagCoverageDetail', ctx.req.params), history = structuredClone(old?.history ?? []);
  for (const result of ctx.list<any>(RESULT)) if (await verifiedResult(ctx, result)) history.push({ repoId: result.repoId, scanId: ctx.list<any>(SCAN).find(s => s.resultId === result.resultId)?.scanId ?? null, commit: result.manifest.commit, at: result.manifest.scannedAt, usages: result.manifest.usages.filter((u: any) => u.flagKey === key).length });
  return { row, history: history.sort((a: any, b: any) => b.at.localeCompare(a.at)), pullRequests: (await prs(ctx)).filter(p => p.flagKeys.includes(key)), waivers: (await waiverRows(ctx)).filter(w => w.flagKey === key) };
});
write('requestFlagGateWaiver', 'FLAG_WAIVER_REQUEST', 'D01-01', async ctx => {
  const b = ctx.req.body, exp = Date.parse(b.expiresAt), now = ctx.now().getTime();
  if (exp <= now || exp - now > FLAG_WAIVER_MAX_DAYS * 86400000) fail('VALIDATION', 'Waivers require a future expiry within 30 days.');
  const blocker = (await releaseGate(ctx, b.featureId, b.version)).blockers.find(x => x.flagKey === b.flagKey);
  if (!blocker) fail('GUARD_FAILED', 'This Flag does not block the requested Feature Version.');
  const all = await waiverRows(ctx); if (all.some(w => w.flagKey === b.flagKey && w.featureId === b.featureId && w.version === b.version && w.state === 'REQUESTED')) fail('CONFLICT', 'A decision is already pending for this Flag and Version.');
  const row = { ...b, expiresAt: new Date(exp).toISOString(), waiverId: ctx.nextId('FWV', all.map(w => w.waiverId), 4), state: 'REQUESTED', coverageStatus: blocker.status, requestedBy: ctx.actor.id, requestedAt: ctx.iso(), decidedBy: null, decidedAt: null, comment: null, decisions: [], provenance: LOCAL };
  await requiredDeciders(ctx, row); ctx.put(WAIVER, row.waiverId, row, { created: true }); return row;
});
write('decideFlagGateWaiver', 'FLAG_WAIVER_DECIDE', 'D01-01', async ctx => {
  const w = (await waiverRows(ctx)).find(w => w.waiverId === ctx.req.params.id) ?? fail('NOT_FOUND', 'Waiver is missing.');
  if (w.state !== 'REQUESTED') fail('GUARD_FAILED', 'Only an unexpired pending waiver can be decided.');
  if (w.requestedBy === ctx.actor.id) fail('SEPARATION_OF_DUTY', 'The requester cannot decide their own waiver.');
  if (w.provenance !== LOCAL) fail('GUARD_FAILED', 'Captured private decision records are unavailable. Submit a new local request after the existing one ends.');
  const need = await requiredDeciders(ctx, w), decisions = [...w.decisions];
  if (!need.includes(ctx.actor.role)) fail('FORBIDDEN', 'This safety classification requires: ' + need.join(', '));
  if (decisions.some((d: any) => d.by === ctx.actor.id || d.role === ctx.actor.role)) fail('CONFLICT', 'This person or role has already decided.');
  if (!await verifiedWaiver(ctx, w)) fail('GUARD_FAILED', 'Existing decision signatures are invalid.');
  const d: any = { by: ctx.actor.id, role: ctx.actor.role, at: ctx.iso(), decision: ctx.req.body.decision }; d.signature = await signLocalFlag(ctx, 'APPROVAL', decisionValue(w, d)); decisions.push(d);
  const done = d.decision === 'REJECT' || need.every(r => decisions.some((d: any) => d.role === r && d.decision === 'APPROVE')), next = { ...w, decisions, ...(done ? { state: d.decision === 'REJECT' ? 'REJECTED' : 'APPROVED', decidedBy: ctx.actor.id, decidedAt: ctx.iso(), comment: ctx.req.body.comment } : {}) };
  if (!await verifiedWaiver(ctx, next)) fail('GUARD_FAILED', 'Local decision signature did not verify.'); ctx.put(WAIVER, next.waiverId, next); return next;
});
async function imports(ctx: SimReadContext) {
  const all = merge(asList(await source(ctx, 'listFlagSources'), 'listFlagSources'), ctx.list(IMPORT), 'manifestId').sort((a, b) => b.manifest.scannedAt.localeCompare(a.manifest.scannedAt) || b.manifestId.localeCompare(a.manifestId)), seen = new Set<string>();
  for (const row of all) { if (row.simulationSource === LOCAL && row.contentHash !== 'sha256:' + await sha256(canonicalJson(row.manifest))) fail('GUARD_FAILED', 'Declared source manifest hash is invalid.'); row.latest = !seen.has(row.manifest.repository); seen.add(row.manifest.repository); } return all;
}
registerSimReader('listFlagSources', imports);
write('importFlagSources', 'FLAG_SOURCE_IMPORT', 'D01-06', async ctx => {
  const manifest = FlagSourceManifest.parse(ctx.req.body), all = await imports(ctx), prior = all.find(x => x.manifest.repository === manifest.repository && x.manifest.commit === manifest.commit), content = (m: any) => canonicalJson({ ...m, scannedAt: '' });
  if (prior) { if (content(prior.manifest) !== content(manifest)) fail('CONFLICT', 'An existing repository commit is immutable.'); return prior; }
  const row = { manifestId: ctx.nextId('FSRC', all.map(x => x.manifestId), 6), manifest, contentHash: 'sha256:' + await sha256(canonicalJson(manifest)), importedAt: ctx.iso(), importedBy: ctx.actor.id, provenance: 'CI_IMPORT', simulationSource: LOCAL, verification: 'DECLARED_UNVERIFIED', latest: !all.some(x => x.manifest.repository === manifest.repository && x.manifest.scannedAt > manifest.scannedAt) };
  ctx.put(IMPORT, row.manifestId, row, { created: true }); return row;
});
export async function enrichFlagSources(ctx: SimReadContext, base: any[]) {
  if (!ctx.list(IMPORT).length && !ctx.list(RESULT).length && !ctx.list(PLAN).length) return base;
  const c = await coverage(ctx), imported = await imports(ctx), touched = new Set(ctx.list<any>(IMPORT).map(x => x.manifest.repository)), rows = structuredClone(base);
  if (!ctx.req.query.featureId && !ctx.req.query.version) for (const imp of imported.filter(x => x.latest)) for (const u of imp.manifest.usages) if (!rows.some(r => r.flagKey === u.flagKey) && !c.rows.some(r => r.flagKey === u.flagKey)) rows.push({ flagKey: u.flagKey, featureId: null, version: null, featureName: null, policy: null, sources: [], publication: null });
  for (const r of c.rows) if (!rows.some(x => x.flagKey === r.flagKey && x.featureId === r.featureId && x.version === r.version) && (!ctx.req.query.featureId || r.featureId === ctx.req.query.featureId) && (!ctx.req.query.version || r.version === ctx.req.query.version)) rows.push({ flagKey: r.flagKey, featureId: r.featureId, version: r.version, featureName: r.featureName, policy: r.policy, sources: [], publication: null });
  for (const row of rows) {
    row.sources = row.sources.filter((s: any) => !touched.has(s.repository) && !s.repoId);
    const code = c.rows.find(r => r.flagKey === row.flagKey); if (code) row.sources.push(...code.code.usages);
    for (const imp of imported.filter(x => x.latest && touched.has(x.manifest.repository))) for (const u of imp.manifest.usages.filter((u: any) => u.flagKey === row.flagKey)) { const { flagKey: _key, ...loc } = u; row.sources.push({ ...loc, repository: imp.manifest.repository, provider: imp.manifest.provider, commit: imp.manifest.commit, url: flagSourceUrl({ ...imp.manifest, path: u.path, line: u.line }), importedAt: imp.importedAt, importedBy: imp.importedBy, provenance: imp.provenance, verification: 'DECLARED_UNVERIFIED', simulationSource: LOCAL }); }
    row.sources = [...new Map(row.sources.map((s: any) => [s.repository + '@' + s.commit + ':' + s.path + ':' + s.line, s])).values()];
  } return rows;
}
