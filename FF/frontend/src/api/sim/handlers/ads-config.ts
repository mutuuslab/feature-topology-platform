import { belowSecurityMin, classifyVehicleConfig, compareDeploySettings, compatSummary, configSetRegistrationBlocker, CONFIG_REPORT_STALE_MS, countVerdicts, mergeSecurityMin, oddApprovalBlockedReason, ODD_SELF_APPROVAL, validateOddProfile, siteStatus } from '../../../../../contracts/src/rules/ads-config';
import { configSetApprovalBlocker, effectiveSecurityMins, securityMinApprovalBlocker, securityMinProposalBlocker, unregisteredSecurityMin, SECURITY_MIN_UNREGISTERED } from '../../../../../contracts/src/rules/ads-config-approval';
import { oddCompileBlockers, reactivationCandidate, recoveryDecisionBlockers, siteAdditionVerdict } from '../../../../../contracts/src/rules/ads-publish';
import { registerSimReader } from '../engine';
import type { SimReadContext } from '../types';
import { fail, feature, items, LOCAL, merge, source, write } from './ads-shared';

const PROFILE = 'adsOddProfile', SET = 'adsConfigSet', MIN = 'adsSecurityMin', SITE = 'adsOddSite', RECOVERY = 'adsRecovery';
async function profiles(ctx: SimReadContext) {
  const list = await items(ctx, 'oddProfiles');
  return Promise.all(list.map(async row => ctx.get(PROFILE, row.profileId) ?? (await source(ctx, 'oddProfile', { id: row.profileId })).profile));
}
async function profile(ctx: SimReadContext, id: string) { return (await profiles(ctx)).find(p => p?.profileId === id) ?? fail('NOT_FOUND', 'ODD profile is missing.'); }
async function sets(ctx: SimReadContext) { return merge(await items(ctx, 'configSets'), ctx.list(SET), 'setId'); }
async function set(ctx: SimReadContext, id: string) { return (await sets(ctx)).find(s => s.setId === id) ?? fail('NOT_FOUND', 'Configuration set is missing.'); }
async function mins(ctx: SimReadContext) { return merge(await items(ctx, 'securityMins'), ctx.list(MIN), 'entryId'); }
async function security(ctx: SimReadContext, ecuSw: any[], extra: any[]) {
  const table = effectiveSecurityMins(await mins(ctx)), missing = unregisteredSecurityMin(ecuSw, table);
  if (missing.length) fail('GUARD_FAILED', SECURITY_MIN_UNREGISTERED(missing));
  const relevant = table.filter(m => ecuSw.some(s => s.swId === m.swId)), securityMin = mergeSecurityMin(relevant, extra);
  const blocker = configSetRegistrationBlocker({ ecuSw, securityMin });
  if (blocker) fail('GUARD_FAILED', blocker);
  return securityMin;
}
async function siteRequests(ctx: SimReadContext, id: string) {
  const base = await source(ctx, 'oddProfile', { id });
  if (!Array.isArray(base.sites)) fail('INTERNAL', 'ODD site source is unavailable.');
  return merge(base.sites.filter((s: any) => s.requested).map((s: any) => ({ ...s, profileId: id })), ctx.list<any>(SITE).filter(s => s.profileId === id), 'siteId');
}
async function impact(ctx: SimReadContext, ref: string | null) {
  if (!ref) return null;
  const result = await ctx.read<any>('adsChangeImpacts');
  if (!Array.isArray(result?.items)) fail('INTERNAL', 'Change impact source is unavailable.');
  return result.items.find((d: any) => d.impactId === ref) ?? fail('NOT_FOUND', `Change impact ${ref} is missing.`);
}
async function profileView(ctx: SimReadContext, id: string) {
  const base = await source(ctx, 'oddProfile', { id }), p = await profile(ctx, id), all = await profiles(ctx), issues = validateOddProfile(p);
  if (!Array.isArray(base.deploy)) fail('INTERNAL', 'ODD deployment settings are unavailable.');
  const approved = all.filter(a => a.featureId === p.featureId && a.featureVersion === p.featureVersion && a.status === 'APPROVED').sort((a, b) => b.version - a.version)[0] ?? null;
  const deploy = compareDeploySettings(base.deploy, p.envelope), sites = [...p.sites.map((s: any) => ({ ...s, ...siteStatus(s, p) })), ...(await siteRequests(ctx, id)).map((r: any) => ({ ...r, impactConfirmed: r.status === 'APPROVED', ...siteStatus({ ...r, impactConfirmed: r.status === 'APPROVED' }, p), requested: true }))];
  return { ...base, profile: p, issues, blockedReason: p.status === 'DRAFT' ? oddApprovalBlockedReason(issues) : null, deploy, deployCounts: countVerdicts(deploy), sites, compile: [...new Set(base.deploy.map((s: any) => s.flagKey))].map(flagKey => ({ flagKey, against: approved?.profileId ?? null, blockers: oddCompileBlockers({ flagKey: String(flagKey), settings: base.deploy, profile: approved }) })), configSets: (await sets(ctx)).filter(s => s.oddProfileId === id).map(s => s.setId) };
}
registerSimReader('oddProfile', ctx => profileView(ctx, ctx.req.params.id));
registerSimReader('oddProfiles', async ctx => {
  const base = await source(ctx, 'oddProfiles'), all = await profiles(ctx), result: any[] = [], seen = new Set<string>(), summary = { WITHIN: 0, EXCEEDS: 0, UNDECIDABLE: 0 };
  for (const p of all) {
    const view = await profileView(ctx, p.profileId), sites = { APPROVED: 0, PENDING: 0, EXPOSURE_HOLD: 0 };
    view.sites.forEach(s => sites[s.status as keyof typeof sites]++);
    result.push({ ...base.items.find((i: any) => i.profileId === p.profileId), status: p.status, issues: view.issues.length, deploy: view.deployCounts, sites });
    const key = p.featureId + '@' + p.featureVersion;
    if (!seen.has(key)) {
      seen.add(key); const approved = all.filter(a => a.featureId === p.featureId && a.featureVersion === p.featureVersion && a.status === 'APPROVED').sort((a, b) => b.version - a.version)[0];
      const c = countVerdicts(compareDeploySettings((await source(ctx, 'oddProfile', { id: p.profileId })).deploy, approved?.envelope ?? []));
      if (!approved) summary.UNDECIDABLE += c.WITHIN + c.EXCEEDS + c.UNDECIDABLE; else { summary.WITHIN += c.WITHIN; summary.EXCEEDS += c.EXCEEDS; summary.UNDECIDABLE += c.UNDECIDABLE; }
    }
  }
  return { items: result, summary: { exceeds: summary.EXCEEDS, undecidable: summary.UNDECIDABLE, within: summary.WITHIN, total: summary.WITHIN + summary.EXCEEDS + summary.UNDECIDABLE } };
});
write('approveOddProfile', 'ODD_PROFILE_APPROVE', 'D02-01', async ctx => {
  const p = await profile(ctx, ctx.req.params.id);
  if (p.status === 'APPROVED') fail('CONFLICT', 'ODD profile is already approved.');
  if (p.createdBy === ctx.actor.id) fail('SEPARATION_OF_DUTY', ODD_SELF_APPROVAL);
  const issues = validateOddProfile(p), blocked = oddApprovalBlockedReason(issues);
  if (blocked) fail('GUARD_FAILED', blocked, { blockers: issues });
  const next = { ...p, status: 'APPROVED', approvedBy: ctx.actor.id, approvedAt: ctx.iso(), approvalReason: ctx.req.body.reason, provenance: LOCAL };
  ctx.put(PROFILE, p.profileId, next); return { ...await profileView(ctx, p.profileId), profile: next, blockedReason: null };
});
write('createConfigSet', 'CONFIG_SET_CREATE', 'D02-01', async ctx => {
  const b = ctx.req.body; await feature(ctx, b.featureId, b.featureVersion);
  const securityMin = await security(ctx, b.ecuSw, b.securityMin);
  if (b.oddProfileId && (await profile(ctx, b.oddProfileId)).status !== 'APPROVED') fail('GUARD_FAILED', 'Only an approved ODD profile may be linked.');
  const all = await sets(ctx), prefix = 'CFG-' + b.featureId, id = ctx.nextId(prefix, all.map(s => s.setId), 2), { reason: _reason, ...body } = b;
  const row = { ...body, securityMin, setId: id, status: 'PROPOSED', proposedBy: ctx.actor.id, proposedAt: ctx.iso(), approvedBy: null, approvedAt: null, provenance: LOCAL };
  ctx.put(SET, id, row, { created: true }); return row;
});
write('approveConfigSet', 'CONFIG_SET_APPROVE', 'D02-01', async ctx => {
  const s = await set(ctx, ctx.req.params.id), blocked = configSetApprovalBlocker(s, ctx.actor.id);
  if (blocked) fail(blocked.code === 'SELF_APPROVAL' ? 'SEPARATION_OF_DUTY' : 'CONFLICT', blocked.message);
  await security(ctx, s.ecuSw, s.securityMin);
  const next = { ...s, status: 'APPROVED', approvedBy: ctx.actor.id, approvedAt: ctx.iso(), approvalReason: ctx.req.body.reason, provenance: LOCAL };
  ctx.put(SET, s.setId, next); return next;
});
registerSimReader('securityMins', async ctx => {
  const all = await mins(ctx), current = effectiveSecurityMins(all), used = new Set((await sets(ctx)).flatMap(s => s.ecuSw.map((x: any) => x.swId)));
  return { items: all, current, pending: all.filter(m => m.status === 'PROPOSED').length, unregistered: [...used].filter(sw => !current.some(m => m.swId === sw)).sort() };
});
write('proposeSecurityMin', 'SECURITY_MIN_PROPOSE', 'D02-01', async ctx => {
  const b = ctx.req.body, all = await mins(ctx), blocked = securityMinProposalBlocker(all, b.swId, b.version);
  if (blocked) fail('GUARD_FAILED', blocked.message, { blockers: [blocked] });
  const row = { ...b, entryId: ctx.nextId('SMV', all.map(m => m.entryId), 4), status: 'PROPOSED', proposedBy: ctx.actor.id, proposedAt: ctx.iso(), approvedBy: null, approvedAt: null, approvalReason: null, provenance: LOCAL };
  ctx.put(MIN, row.entryId, row, { created: true }); return row;
});
write('approveSecurityMin', 'SECURITY_MIN_APPROVE', 'D02-01', async ctx => {
  const all = await mins(ctx), row = all.find(m => m.entryId === ctx.req.params.id) ?? fail('NOT_FOUND', 'Security minimum proposal is missing.'), blocked = securityMinApprovalBlocker(all, row, ctx.actor.id);
  if (blocked) fail(blocked.code === 'SELF_APPROVAL' ? 'SEPARATION_OF_DUTY' : blocked.code === 'ALREADY_APPROVED' ? 'CONFLICT' : 'GUARD_FAILED', blocked.message, { blockers: [blocked] });
  const next = { ...row, status: 'APPROVED', approvedBy: ctx.actor.id, approvedAt: ctx.iso(), approvalReason: ctx.req.body.reason, provenance: LOCAL };
  ctx.put(MIN, row.entryId, next); return next;
});
write('addOddSite', 'ODD_SITE_REQUEST', 'D02-01', async ctx => {
  const p = await profile(ctx, ctx.req.params.id), b = ctx.req.body, verdict = siteAdditionVerdict(await impact(ctx, b.changeImpactRef), p);
  const previous = (await Promise.all((await profiles(ctx)).map(p => siteRequests(ctx, p.profileId)))).flat(), n = Math.max(1000, ...previous.map(r => Number(r.siteId.replace(/^SITE-/, ''))).filter(Number.isFinite));
  const row = { ...b, siteId: 'SITE-' + (n + 1), profileId: p.profileId, status: 'PENDING', code: verdict.code ?? null, reason: verdict.reason, requestedBy: ctx.actor.id, requestedAt: ctx.iso(), approvedBy: null, approvedAt: null, provenance: LOCAL };
  ctx.put(SITE, row.siteId, row, { created: true }); return row;
});
write('approveOddSite', 'ODD_SITE_APPROVE', 'D02-01', async ctx => {
  const p = await profile(ctx, ctx.req.params.id), row = (await siteRequests(ctx, p.profileId)).find(r => r.siteId === ctx.req.params.siteId) ?? fail('NOT_FOUND', 'ODD site request is missing.');
  if (row.status === 'APPROVED') fail('CONFLICT', 'ODD site is already approved.');
  const v = siteAdditionVerdict(await impact(ctx, row.changeImpactRef), p);
  if (v.status !== 'APPROVED') fail('GUARD_FAILED', v.reason, { blockers: [{ code: v.code, message: v.reason, ref: row.changeImpactRef }] });
  const next = { ...row, status: 'APPROVED', code: null, reason: v.reason, approvedBy: ctx.actor.id, approvedAt: ctx.iso(), provenance: LOCAL };
  ctx.put(SITE, row.siteId, next); return next;
});

// Native public views do not include the full vehicle report/epoch. Preserve observations; new comparisons stay unconfirmed.
async function comparison(ctx: SimReadContext, s: any) {
  const f = await feature(ctx, s.featureId, s.featureVersion), vs = await ctx.read<any>('vehicles');
  if (!Array.isArray(vs?.items)) fail('INTERNAL', 'Vehicle scope source is unavailable.');
  const baseSets = await items(ctx, 'configSets'), captured = baseSets.some(b => b.setId === s.setId) ? await source(ctx, 'configSetVehicles', { id: s.setId }) : null;
  if (captured && !Array.isArray(captured.items)) fail('INTERNAL', 'Captured configuration comparison is unavailable.');
  if (!ctx.get(SET, s.setId) && captured) {
    const securityMin = mergeSecurityMin(effectiveSecurityMins(await mins(ctx)), s.securityMin);
    const rows = captured.items.map((r: any) => {
      const stale = !r.reportedAt || ctx.now().getTime() - Date.parse(r.reportedAt) > CONFIG_REPORT_STALE_MS;
      const low = belowSecurityMin(r.sw ?? [], securityMin);
      const verdict = stale ? { cls: 'UNCONFIRMED', code: 'CONFIG_STALE', reasons: ['Captured configuration observation is absent or stale.'] } : low.length ? { cls: 'BELOW_SECURITY_MIN', code: 'SECURITY_MIN_VIOLATION', reasons: low.map(x => `${x.swId} ${x.version} < ${x.min}`) } : r;
      return { ...r, ...verdict, reactivation: reactivationCandidate(verdict as any) };
    });
    return { ...captured, items: rows, set: { ...s, featureName: f.name }, summary: compatSummary(rows), now: ctx.now().toISOString() };
  }
  const rows = vs.items.filter((v: any) => v.fleet !== 'SAMPLE' && v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim).map((v: any) => {
    const verdict = classifyVehicleConfig(s, null, ctx.now().getTime());
    return { vin: v.vin, label: v.label, reportedAt: null, sw: [], ...verdict, reactivation: reactivationCandidate(verdict), sourceBoundary: 'FULL_CONFIGURATION_REPORT_NOT_CAPTURED' };
  });
  return { set: { ...s, featureName: f.name }, items: rows, summary: compatSummary(rows), staleAfterMs: CONFIG_REPORT_STALE_MS, now: ctx.now().toISOString(), sourceBoundary: 'FULL_CONFIGURATION_REPORT_NOT_CAPTURED' };
}
registerSimReader('configSetVehicles', async ctx => comparison(ctx, await set(ctx, ctx.req.params.id)));
registerSimReader('configSets', async ctx => {
  const base = await source(ctx, 'configSets'), all = await sets(ctx), result: any[] = [], byVin = new Map<string, any>();
  for (const s of all) {
    const view = await comparison(ctx, s), counts: any = { MATCH: 0, MISMATCH: 0, PARTIAL_RECOVERY: 0, BELOW_SECURITY_MIN: 0, UNCONFIRMED: 0 };
    view.items.forEach((r: any) => { counts[r.cls]++; if (s.status === 'APPROVED' && (!byVin.has(r.vin) || r.cls === 'MATCH')) byVin.set(r.vin, r); });
    result.push({ ...s, featureName: view.set.featureName, counts });
  }
  const rows = [...byVin.values()], counts: any = { MATCH: 0, MISMATCH: 0, PARTIAL_RECOVERY: 0, BELOW_SECURITY_MIN: 0, UNCONFIRMED: 0 }; rows.forEach(r => counts[r.cls]++);
  const policies = await ctx.read<any>('listPolicies');
  if (!Array.isArray(policies?.items)) fail('INTERNAL', 'Deployed policy source is unavailable.');
  const approved = new Set(all.filter(s => s.status === 'APPROVED').map(s => s.featureId + '@' + s.featureVersion)), pending = [...new Map(policies.items.filter((p: any) => p.status === 'DEPLOYED' && !approved.has(p.featureId + '@' + p.featureVersion)).map((p: any) => [p.featureId + '@' + p.featureVersion, p])).values()] as any[];
  const unverified: any[] = [];
  for (const p of pending) {
    const safety = await ctx.read<any>('safetyProfile', { id: p.featureId, ver: p.featureVersion }), fClass = safety?.profile?.fClass;
    if (fClass === 'F0' || fClass === 'F1') unverified.push({ featureId: p.featureId, version: p.featureVersion, name: (await feature(ctx, p.featureId, p.featureVersion)).name, fClass });
  }
  return { ...base, items: result, summary: { ...compatSummary(rows), counts }, unverified: { count: unverified.length, items: unverified }, pending: all.filter(s => s.status !== 'APPROVED').length, decisions: (await recoveries(ctx)).length };
});
async function recoveries(ctx: SimReadContext) { return merge(await items(ctx, 'recoveryDecisions'), ctx.list(RECOVERY), 'decisionId'); }
registerSimReader('recoveryDecisions', async ctx => ({ items: (await recoveries(ctx)).filter(r => !ctx.req.query.vin || r.vin === ctx.req.query.vin) }));
write('createRecoveryDecision', 'RECOVERY_DECISION', 'D02-01', async ctx => {
  const b = ctx.req.body, s = await set(ctx, b.configSetRef), vs = await ctx.read<any>('vehicles');
  if (!Array.isArray(vs?.items)) fail('INTERNAL', 'Vehicle source is unavailable.');
  if (!vs.items.some((v: any) => v.vin === b.vin)) fail('NOT_FOUND', 'Vehicle is missing.');
  if (s.status !== 'APPROVED') fail('GUARD_FAILED', 'Recovery requires an approved configuration set.');
  if (b.path === 'RESTORE_PREVIOUS' && !b.candidatePublicationId) fail('VALIDATION', 'Select a candidate publication for previous-version recovery.');
  const metadata = b.path === 'RESTORE_PREVIOUS' ? { ok: false, reasons: [{ code: 'RECOVERY_SOURCE_UNAVAILABLE', message: '검토 보류 — 전체 차량 형상·복구 후보·현재 HSM epoch 원문이 캡처되지 않았습니다. 실제 복구를 승인하지 않습니다.' }] } : { ok: true, reasons: [] };
  const blockers = recoveryDecisionBlockers({ path: b.path, set: s, report: null, metadata, now: ctx.now().getTime() }), verdict = classifyVehicleConfig(s, null, ctx.now().getTime()), all = await recoveries(ctx);
  const row = { ...b, decisionId: ctx.nextId('RCV', all.map(r => r.decisionId)), decidedBy: ctx.actor.id, decidedRole: ctx.actor.role, decidedAt: ctx.iso(), metadata, status: blockers.length ? 'REVIEW_REQUIRED' : 'RECORDED', blockers, verdict: { cls: verdict.cls, code: verdict.code, reasons: verdict.reasons }, reactivation: blockers.length ? { eligible: false, reason: metadata.reasons[0].message } : reactivationCandidate(verdict), provenance: LOCAL, vehicleApplicationPerformed: false };
  ctx.put(RECOVERY, row.decisionId, row, { created: true }); return row;
});
