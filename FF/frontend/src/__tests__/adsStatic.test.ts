import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ROUTES, routeUrl, snapshotFile } from '../../../contracts/src/routes';
import configFixture from '../../../data/fixtures/ads/config.json';
import { classifyChange, pathItems } from '../../../contracts/src/rules/ads-change';
import { classificationConfirmHash } from '../../../contracts/src/rules/ads-publish';
let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine'), snapshots: Record<string, any>;
const f = { featureId: 'FEAT-00004', version: '4.1.0', name: 'Synthetic ADS workflow', lifecycle: 'DEVELOPING', country: 'KR', vehicleModel: 'GN7', trim: 'Calligraphy', ownerId: 'team', asil: 'QM', swIds: [], swVersions: [], ecuPnos: [], tags: [], featureRefs: [], requirementIds: [], controlPoints: ['Flag'], upgVc: [] };
const profileId = 'ODD-FEAT-00004-v1', draftId = 'ODD-FEAT-00004-v2', vin = 'DEMO-VEHICLE-0001';
const u = (n: string, p = {}, q = {}) => routeUrl(n, p, q);
const run = (n: string, body?: any, role = 'viewer', params: Record<string, string> = {}, query = {}) => sim.simCall<any>(ROUTES.find(r => r.name === n)!, u(n, params, query), { body, role, params });
const get = (n: string, p: Record<string, string> = {}, q = {}) => run(n, undefined, 'viewer', p, q);
function setup() {
  const now = new Date().toISOString(), profile: any = { ...structuredClone(configFixture.oddProfiles[0]), createdBy: 'usr-author', createdAt: now, approvedBy: 'usr-quality', approvedAt: now };
  const ps = [profile, { ...structuredClone(profile), profileId: draftId, version: 2, status: 'DRAFT', approvedBy: null, approvedAt: null }];
  const facts = { oddWidened: true, oddChanged: true, swChanged: false, modelChanged: false, configChanged: false }, cls = classifyChange(facts, 'POLICY');
  const impact = { impactId: 'CI-0001', featureId: f.featureId, version: f.version, baseVersion: null, title: 'Synthetic ODD change', facts, declaredKind: 'POLICY', cls, scopeStatus: 'CONFIRMED', paths: pathItems(cls, {}), reharaRequestIds: [], rejudgeGates: ['G2'] };
  const report = { reportId: 'AIR-0001', featureId: f.featureId, featureVersion: f.version, vin, market: 'KR', summary: 'Synthetic report', occurredAt: null, awareAt: now, firstNoticeAt: null, activeWindow: { value: 'IN_WINDOW', basis: 'Synthetic captured event' }, configSet: 'CFG-DEMO', oddProfileRef: profileId, dssadCorrelationId: null, auditTarget: 'AIR-0001', shortTermSubmittedAt: null, events: [], determination: null, determinations: [], deadline: null, audit: [] };
  snapshots = {
    [u('auditChain')]: { head: 'ads-test', valid: true, count: 0 },
    [u('listFeatures')]: { items: [f], total: 1 }, [u('listFeatures', {}, { latestOnly: false })]: { items: [f], total: 1 },
    [u('featureDetail', { id: f.featureId, ver: f.version })]: { feature: f, meta: { createdBy: null, createdAt: null }, gates: {}, dependencies: { incoming: [], outgoing: [] }, functions: [], trace: [], baseline: null, products: [], transitions: [], versions: [{ version: f.version, lifecycle: f.lifecycle }] },
    [u('adsClassification', { id: f.featureId, ver: f.version })]: { featureId: f.featureId, version: f.version, lifecycle: f.lifecycle, classification: null, ownerHistory: [], baselines: [] },
    [u('adsMarketBaselines')]: { items: [] }, [u('oddProfiles')]: { items: ps.map(p => ({ profileId: p.profileId, featureId: p.featureId, featureVersion: p.featureVersion, version: p.version, status: p.status })) },
    [u('configSets')]: { items: [], unverified: [], summary: {}, pending: 0 }, [u('securityMins')]: { items: [], current: [], pending: 0, unregistered: [] },
    [u('recoveryDecisions')]: { items: [] }, [u('vehicles')]: { items: [{ vin, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }], total: 1 },
    [u('adsIncidentReport', { id: 'AIR-0001' })]: report, [u('adsIncidentReports')]: { items: [report], markets: [] },
    [u('adsEvidenceManifest', { id: 'EVM-0001' })]: { manifestId: 'EVM-0001', featureId: f.featureId, author: 'usr-author', findings: [] },
    [u('adsSafetyCase', { featureId: f.featureId })]: { featureId: f.featureId, featureVersion: f.version, findings: [], features: [{ featureId: f.featureId }], claims: [], counts: {}, promotion: { promotable: true, openMajor: 0 } },
    [u('adsChangeImpacts')]: { items: [impact], counts: {}, rejudgeGates: 1 },
    [u('supportDrills', { id: f.featureId, ver: f.version })]: { items: [] }, [u('listPolicies')]: { items: [] }, [u('publications')]: { items: [] }, [u('killRequests')]: { items: [] }, [u('pkiKeys')]: { items: [] },
  };
  for (const p of ps) snapshots[u('oddProfile', { id: p.profileId })] = { profile: p, feature: f, deploy: [], sites: p.sites.map(s => ({ ...s, status: 'APPROVED' })), compile: [], configSets: [], issues: [], logs: {} };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_DATA_MODE', 'static'); vi.stubGlobal('crypto', webcrypto); localStorage.clear(); setup();
  vi.stubGlobal('fetch', vi.fn(async (input: string) => { const key = Object.keys(snapshots).find(k => '/' + snapshotFile(k) === input || snapshotFile(k) === input); return key ? new Response(JSON.stringify(snapshots[key]), { headers: { 'Content-Type': 'application/json' } }) : new Response('<!doctype html>'); }));
  sim = await import('../api/sim'); engine = await import('../api/sim/engine');
});
afterEach(() => { engine?.__resetSimForTest(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });
const classification = { adsFeature: true, ddtImpact: 'FULL', safetyRelated: true, owner: 'ADS owner', lifecycleOwners: { CREATE: 'Author', OPERATE: 'Operations', SUSPEND: 'Safety', DISPOSE: 'Lifecycle' }, reason: 'Local classification authoring' };
const config = { featureId: f.featureId, featureVersion: f.version, hw: [{ ecuPno: 'ECU-DEMO', hwRevision: 'A' }], ecuSw: [{ ecuPno: 'ECU-DEMO', swId: 'SW-LOCAL', version: '2.0.0' }], model: null, calibration: null, oddProfileId: profileId, flagKey: null, securityMin: [], reason: 'Local configuration proposal' };
async function minimum(version = '1.0.0') { const p = await run('proposeSecurityMin', { swId: 'SW-LOCAL', version, rationale: 'Local minimum proposal' }, 'steward'); return run('approveSecurityMin', { reason: 'Independent security approval' }, 'integrator', { id: p.entryId }); }
async function approvedSet() { await minimum(); const s = await run('createConfigSet', config, 'steward'); return run('approveConfigSet', { reason: 'Independent safety approval' }, 'quality', { id: s.setId }); }
it('authors and confirms classification with real canonical hash, preserves same content and reopens confirmation after change', async () => {
  const p = { id: f.featureId, ver: f.version }; await run('updateAdsClassification', classification, 'author', p);
  const confirmed = await run('confirmAdsClassification', { reason: 'Safety confirmation' }, 'quality', p);
  const expected = 'sha256:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(classificationConfirmHash(confirmed.classification)))).toString('hex'); expect(confirmed.classification.confirmHash).toBe(expected);
  expect((await get('adsUnclassified')).items).toEqual([]);
  await run('updateAdsClassification', classification, 'author', p); expect((await get('adsClassification', p)).classification.status).toBe('CONFIRMED');
  await run('updateAdsClassification', { ...classification, ddtImpact: 'SUPPORT' }, 'author', p); expect((await get('adsClassification', p)).classification).toMatchObject({ status: 'DRAFT', confirmHash: null });
  expect((await get('adsClassification', p)).ownerHistory).toHaveLength(4);
});
it('rejects incomplete classification, wrong roles and wrong Feature ODD baselines; updates only the selected market', async () => {
  const p = { id: f.featureId, ver: f.version };
  await expect(run('updateAdsClassification', classification, 'viewer', p)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await run('updateAdsClassification', { ...classification, owner: null }, 'author', p); await expect(run('confirmAdsClassification', { reason: 'Cannot confirm incomplete input' }, 'quality', p)).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  const b = { approvalType: 'TYPE_APPROVAL', regulations: [{ reg: 'DEMO', series: '01' }], oddProfileRef: profileId, approvalStatus: 'APPROVED', note: 'Local record only', reason: 'Market review' };
  await run('putMarketBaseline', b, 'steward', { ...p, market: 'KR' }); await run('putMarketBaseline', { ...b, approvalStatus: 'PENDING' }, 'steward', { ...p, market: 'EU' });
  expect((await get('adsMarketBaselines')).items).toHaveLength(2);
  expect((await get('adsClassification', p)).baselines.map((b: any) => b.market)).toEqual(['KR', 'EU']);
  snapshots[u('oddProfile', { id: draftId })].profile.featureVersion = '9.9.9';
  await expect(run('putMarketBaseline', { ...b, oddProfileRef: draftId }, 'steward', { ...p, market: 'US' })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});
it('approves an independently authored valid ODD, and validates duplicate and self approval refusals', async () => {
  snapshots[u('oddProfile', { id: draftId })].profile.createdBy = 'usr-quality';
  await expect(run('approveOddProfile', { reason: 'Already approved' }, 'quality', { id: profileId })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(run('approveOddProfile', { reason: 'Self review' }, 'quality', { id: draftId })).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTY' });
  expect((await run('approveOddProfile', { reason: 'Independent ODD review' }, 'safety2', { id: draftId })).profile.status).toBe('APPROVED');
  expect((await get('oddProfile', { id: draftId })).profile.approvedBy).toBe('usr-safety2');
});
it('requires registered security floors and independent approvals, rechecks raised floors and persists configuration proposal/approval', async () => {
  await expect(run('createConfigSet', config, 'steward')).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  const own = await run('proposeSecurityMin', { swId: 'SW-SELF', version: '1.0.0', rationale: 'Self proposal' }, 'integrator');
  await expect(run('approveSecurityMin', { reason: 'Self approval attempt' }, 'integrator', { id: own.entryId })).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTY' });
  const s = await approvedSet(); expect(s.status).toBe('APPROVED'); expect((await get('configSets')).items[0].status).toBe('APPROVED');
  await expect(run('proposeSecurityMin', { swId: 'SW-LOCAL', version: '1.0.0', rationale: 'Lower or same' }, 'steward')).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  const pending = await run('createConfigSet', config, 'steward'); await minimum('3.0.0');
  await expect(run('approveConfigSet', { reason: 'Floor is now above ECU SW' }, 'quality', { id: pending.setId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  expect((await get('securityMins')).current.find((m: any) => m.swId === 'SW-LOCAL').version).toBe('3.0.0');
});
it('adds a site request, reevaluates confirmed impact and retains both pending and approved histories', async () => {
  const b = { name: 'Local site', kind: 'ROAD_SECTION', mapVersion: 'DEMO-MAP', infraVersion: 'DEMO-INFRA', changeImpactRef: 'CI-0001', reason: 'Add a site for local review' };
  const r = await run('addOddSite', b, 'author', { id: profileId }); expect(r.status).toBe('PENDING');
  expect((await run('approveOddSite', { reason: 'Confirmed impact reviewed' }, 'quality', { id: profileId, siteId: r.siteId })).status).toBe('APPROVED');
  expect((await get('oddProfile', { id: profileId })).sites.find((s: any) => s.siteId === r.siteId).requested).toBe(true);
  const pending = await run('addOddSite', { ...b, changeImpactRef: null }, 'author', { id: profileId });
  await expect(run('approveOddSite', { reason: 'No impact basis' }, 'quality', { id: profileId, siteId: pending.siteId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});
it('records safe recovery work and explicit review hold without inventing full vehicle reports, epoch or physical application', async () => {
  const s = await approvedSet();
  const safe = await run('createRecoveryDecision', { vin, path: 'SAFE_STATE', configSetRef: s.setId, rationale: 'Safe-state review' }, 'opslead'); expect(safe).toMatchObject({ status: 'RECORDED', vehicleApplicationPerformed: false, reactivation: { eligible: false } });
  const held = await run('createRecoveryDecision', { vin, path: 'RESTORE_PREVIOUS', configSetRef: s.setId, candidatePublicationId: 'PUB-00001', rationale: 'Review missing recovery evidence' }, 'quality');
  expect(held).toMatchObject({ status: 'REVIEW_REQUIRED', vehicleApplicationPerformed: false, metadata: { ok: false } }); expect(held.blockers.length).toBeGreaterThan(0);
  expect((await get('recoveryDecisions')).items).toHaveLength(2); expect((await get('configSetVehicles', { id: s.setId })).items[0]).toMatchObject({ cls: 'UNCONFIRMED', reportedAt: null });
});
it('keeps append-only incident determinations and recalculates list status rather than returning success without changing it', async () => {
  await run('adsIncidentDetermination', { decision: 'REPORTABLE', reason: 'Independent incident determination' }, 'quality', { id: 'AIR-0001' });
  expect((await get('adsIncidentReports')).summary.reportable).toBe(1);
  await run('adsIncidentDetermination', { decision: 'NOT_REPORTABLE', reason: 'Corrected determination with retained history' }, 'steward', { id: 'AIR-0001' });
  const d = await get('adsIncidentReport', { id: 'AIR-0001' }); expect(d.reportStatus).toBe('NOT_REPORTABLE'); expect(d.determinations.map((d: any) => d.version)).toEqual([1, 2]); expect(d.audit).toHaveLength(2);
});
it('blocks an Evidence author from reviewing and persists independent major findings into both manifest and promotion', async () => {
  const m = snapshots[u('adsEvidenceManifest', { id: 'EVM-0001' })]; m.author = 'usr-quality';
  await expect(run('adsReviewFindingCreate', { manifestId: m.manifestId, severity: 'MAJOR', summary: 'Independent review required' }, 'quality')).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTY' });
  const r = await run('adsReviewFindingCreate', { manifestId: m.manifestId, severity: 'MAJOR', summary: 'Local major finding' }, 'safety2');
  expect(r.reviewerIndependent).toBe(true); expect((await get('adsSafetyCase', { featureId: f.featureId })).promotion).toEqual({ promotable: false, openMajor: 1 }); expect((await get('adsEvidenceManifest', { id: m.manifestId })).findings).toHaveLength(1);
});
it('closes only the assigned change approval path and persists updated counts and duplicate refusal', async () => {
  await expect(run('adsCloseImpactPath', { reason: 'Wrong path owner' }, 'quality', { id: 'CI-0001', path: 'R156' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const before = await get('adsChangeImpacts'); await run('adsCloseImpactPath', { reason: 'Independent safety case closure' }, 'quality', { id: 'CI-0001', path: 'SAFETY_CASE' });
  const after = await get('adsChangeImpacts'); expect(after.counts.total).toBe(before.counts.total - 1); expect(after.items[0].paths.find((p: any) => p.path === 'SAFETY_CASE').closedBy).toBe('usr-quality');
  await expect(run('adsCloseImpactPath', { reason: 'Duplicate close' }, 'quality', { id: 'CI-0001', path: 'SAFETY_CASE' })).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('executes and persists actual support-end simulation checks with missing baseline/key failures and no vehicle execution', async () => {
  const r = await run('runSupportDrill', { horizonDays: 90, reason: 'Local support-end practice' }, 'coordinator', { id: f.featureId, ver: f.version });
  expect(r).toMatchObject({ passed: false, vehicleApplicationPerformed: false, provenance: 'LOCAL_SIMULATION' }); expect(r.checks.find((c: any) => c.id === 'BASELINE_KEPT').result).toBe('FAIL'); expect(r.checks.find((c: any) => c.id === 'KEY_RENEWAL').result).toBe('FAIL'); expect((await get('supportDrills', { id: f.featureId, ver: f.version })).items).toHaveLength(1);
});
it('fails closed on missing source and serializes independent incident revisions with auditable persisted writes', async () => {
  const p = { id: 'AIR-0001' }, body = { decision: 'REPORTABLE', reason: 'Concurrent local determinations' };
  await Promise.all([run('adsIncidentDetermination', body, 'quality', p), run('adsIncidentDetermination', body, 'steward', p)]);
  expect((await get('adsIncidentReport', p)).determinations.map((d: any) => d.version)).toEqual([1, 2]);
  delete snapshots[u('securityMins')]; await expect(run('proposeSecurityMin', { swId: 'SW-LOCAL', version: '1.0.0', rationale: 'Missing source must not be empty' }, 'steward')).rejects.toMatchObject({ code: 'INTERNAL' });
  const audits = engine.__overlayForTest()!.audit; expect(audits.every(a => !!a.hash)).toBe(true); expect(audits[0].result).toBe('FAILED');
});
