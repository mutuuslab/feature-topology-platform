import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';

const files = new Map<string, unknown>();
let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine');
const nativeId = 'FEAT-00022';
const native = { featureId: nativeId, version: '1.0.0', name: 'Captured Feature', description: 'Native source', lifecycle: 'VERIFIED', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'UX기획팀', asil: 'QM', tags: [], controlPoints: ['Signal'], requirementIds: ['REQ-OLD'], swIds: [], swVersions: [], ecuPnos: [], functions: [], dependencyIds: [], catalogIds: [], gateRecordIds: [], baselineId: null, upgVc: [], featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY', refVersion: 'v1.3' }], _missing: {} };
const ref = { refId: 'AD-PRK-004', status: 'ACTIVE', registeredIn: 'v1.3', domain: 'ADAS & AD', component: 'Parking assistance', cluster: 'Parking', nameKo: 'Reference', nameEn: 'Reference', asilRep: 'QM', sourceIds: [], requires: [], excludes: [], lifecycle: 'Commodity', swStack: 'Application', tshirt: 'M', vehicleType: '공통', region: '글로벌' };
const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as any);
const put = (name: string, value: unknown, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => files.set('/' + snapshotFile(url(name, params, query)), value);
const run = (name: string, role = 'viewer', body?: unknown, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => sim.simCall<any>(ROUTES.find(r => r.name === name)!, url(name, params, query), { body, params, role });
const create = () => run('createFeature', 'author', { name: 'New local Feature', description: 'Actual local registration', country: 'KR', vehicleModel: 'NX4 PE', trim: 'LocalOnly', ownerId: 'UX기획팀', asil: 'QM', controlPoints: ['Signal'], requirementIds: ['REQ-NEW'], featureRefs: [{ refId: ref.refId, role: 'PRIMARY' }] });
const readFour = (id: string, version = '0.1.0') => Promise.all([
  run('featureFlags', 'viewer', undefined, {}, { featureId: id, version }),
  run('featureEvaluations', 'viewer', undefined, { id }),
  run('featureTrace', 'viewer', undefined, { id }),
  run('featureOpsMetrics', 'viewer', undefined, { id }),
]);

beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_DATA_MODE', 'static'); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-10T01:00:00Z')); localStorage.clear(); files.clear();
  put('auditChain', { ok: true, verified: 0, head: null }); put('events', { items: [] }); put('audit', { items: [], nextCursor: null }, {}, { limit: 500 });
  put('listFeatures', { items: [native], total: 1 }, {}, { latestOnly: false });
  put('featureDetail', { feature: native, meta: { createdBy: null, createdAt: null }, gates: {}, dependencies: { outgoing: [], incoming: [] }, trace: [], transitions: [] }, { id: nativeId, ver: '1.0.0' });
  put('refDetail', { ref, usedBy: [] }, { refId: ref.refId }); put('listRefs', { items: [ref], total: 1 }, {}, { limit: 200 });
  put('refTaxonomy', { items: [] }); put('refReleases', { items: [{ release: 'v1.3' }] });
  for (const name of ['listPolicies', 'killRequests', 'flagRetirements', 'baselines', 'baselineRequests', 'dependencies']) put(name, { items: [] });
  put('featureFlags', []); put('traceLinks', { items: [] }, {}, { status: 'ALL' });
  vi.stubGlobal('fetch', vi.fn(async (u: string) => files.has(String(u)) ? new Response(JSON.stringify(files.get(String(u))), { headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 })));
  sim = await import('../api/sim'); engine = await import('../api/sim/engine'); await sim.simReady();
  await import('../api/sim/handlers/local-feature-observability');
});
afterEach(() => { engine?.__resetSimForTest(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('actual registration has known empty Flag/evaluation history and unobserved operations, with no fabricated code or health', async () => {
  const f = await create();
  const before = structuredClone(engine.__overlayForTest());
  const [flags, evals, trace, metrics] = await readFour(f.featureId);
  expect(flags).toEqual([]);
  expect(evals).toMatchObject({ featureId: f.featureId, observationStatus: 'UNOBSERVED', period: { days: 14, from: '2026-10-28', to: '2026-11-10' }, totals: { evaluations: 0, on: 0, off: 0, safeDefault: 0, errors: 0 }, daily: [], bySource: [] });
  expect(trace).toMatchObject({ feature: { featureId: f.featureId, version: '0.1.0' }, requirements: [{ reqId: 'REQ-NEW', type: 'SYSTEM', linked: false }], links: [], evidence: [], coverage: { hasRequirementLink: false } });
  expect(metrics).toMatchObject({ connected: false, asOf: null, versions: [], history: [], findings: [], observationStatus: 'UNOBSERVED' });
  expect(engine.__overlayForTest()).toEqual(before); // Reads do not manufacture events, telemetry, approvals or audit.
});

it('unknown, merely touched, mismatched and tombstoned targets cannot manufacture empty success', async () => {
  const f = await create(), o = engine.__overlayForTest()!;
  for (const name of ['featureEvaluations', 'featureTrace', 'featureOpsMetrics']) await expect(run(name, 'viewer', undefined, { id: 'FEAT-99999' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const marker = o.created.regFeature; o.created.regFeature = [];
  await expect(run('featureEvaluations', 'viewer', undefined, { id: f.featureId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  o.created.regFeature = marker; o.entities.regFeature[f.featureId + '@0.1.0'].row.version = '9.9.9';
  await expect(run('featureEvaluations', 'viewer', undefined, { id: f.featureId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  o.entities.regFeature[f.featureId + '@0.1.0'].row.version = '0.1.0'; o.data.regDeletedFeatures = { [f.featureId + '@0.1.0']: { at: '2026-11-10' } };
  await expect(run('featureEvaluations', 'viewer', undefined, { id: f.featureId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('native IDs and native observation bytes are preserved when a genuinely new Version is created', async () => {
  const evals = { featureId: nativeId, totals: { evaluations: 83 }, observedAt: '2026-11-01', signature: 'captured-byte-marker' };
  const metrics = { connected: true, asOf: '2026-11-01', featureId: nativeId, versions: [{ version: '1.0.0', activeVehicles: 37 }], history: [{ version: '1.0.0', axes: { Safety: 'UNKNOWN' } }], findings: [] };
  const flag = { featureId: nativeId, version: '1.0.0', flagKey: 'native_signal', featureName: native.name, policy: null, publication: null, kill: null, sources: [{ commit: 'captured', signature: 'original-proof' }] };
  put('featureFlags', [flag], {}, { featureId: nativeId, version: '1.0.0' });
  put('featureEvaluations', evals, { id: nativeId }); put('featureOpsMetrics', metrics, { id: nativeId });
  put('featureTrace', { feature: native, links: [], evidence: [], requirements: [{ reqId: 'REQ-OLD', type: 'SYSTEM' }] }, { id: nativeId });
  const v = await run('createVersion', 'author', { baseVersion: '1.0.0', bump: 'minor', reason: 'New local revision', changes: { requirementIds: ['REQ-NEW'] } }, { id: nativeId });
  expect(v.feature.version).toBe('1.1.0');
  expect(await run('featureEvaluations', 'viewer', undefined, { id: nativeId })).toEqual(evals);
  expect(await run('featureOpsMetrics', 'viewer', undefined, { id: nativeId })).toEqual(metrics);
  expect(await run('featureFlags', 'viewer', undefined, {}, { featureId: nativeId, version: '1.0.0' })).toEqual([flag]);
  expect((await run('featureTrace', 'viewer', undefined, { id: nativeId })).requirements).toEqual([{ reqId: 'REQ-NEW', type: 'SYSTEM', linked: false }]);
  expect((await run('featureTrace', 'viewer', undefined, { id: nativeId })).feature.version).toBe('1.1.0');
  expect(evals.totals.evaluations).toBe(83); expect(metrics.asOf).toBe('2026-11-01');
});

it('local previews and downloaded-byte receipts do not impersonate ingested SDK telemetry', async () => {
  const f = await create(), o = engine.__overlayForTest()!;
  o.entities.softwareDownload = { D: { packageId: 'P', at: '2026-11-10T00:00:00Z', flagKey: 'local_signal', policy: { featureId: f.featureId, featureVersion: '0.1.0' }, evaluation: { value: true, decision: 'ENABLED' }, state: 'BROWSER_BLOB_READY', boundary: 'FILE_DOWNLOAD_ONLY' } };
  const evaluations = await run('featureEvaluations', 'viewer', undefined, { id: f.featureId });
  expect(evaluations.totals.evaluations).toBe(0); expect(evaluations.bySource).toEqual([]); expect(evaluations.observationStatus).toBe('UNOBSERVED');
});

it('exact Version flags use actual plans/policies only and never borrow old publication or code proof', async () => {
  const f = await create(), o = engine.__overlayForTest()!;
  o.entities.policy = { P1: { policyId: 'P1', featureId: f.featureId, featureVersion: '0.1.0', flagKey: 'local_signal', status: 'DRAFT', revision: 2, controlPoint: 'Signal', contentHash: 'sha256:new' }, OTHER: { policyId: 'OTHER', featureId: f.featureId, featureVersion: '0.2.0', flagKey: 'wrong_version', status: 'DEPLOYED', revision: 1 } };
  o.entities.publication = { PUB: { publicationId: 'PUB', kind: 'POLICY', status: 'CONFIRMED', confirmed: 2, denominator: 2, payload: { policy: { ...o.entities.policy.P1, revision: 1 } } } };
  const [flags, evaluations] = await readFour(f.featureId);
  expect(flags).toHaveLength(1); expect(flags[0]).toMatchObject({ flagKey: 'local_signal', version: '0.1.0', policy: { revision: 2, status: 'DRAFT' }, sources: [], publication: null, codeObservation: 'UNVERIFIED' });
  expect(evaluations.flagKeys).toEqual(['local_signal', 'wrong_version']); // Native evaluation scope is the entire ID, not one Version.
  expect(evaluations.totals.evaluations).toBe(0);
  await expect(run('featureFlags', 'viewer', undefined, {}, { featureId: f.featureId, version: '0.2.0' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('existing-ID new-Version flag plans retain active native kills without reusing old-version code sources', async () => {
  put('featureFlags', [{ flagKey: 'native_signal', featureId: nativeId, version: '1.0.0', policy: null, sources: [{ commit: 'old-version-only' }] }]);
  put('killRequests', { items: [{ killId: 'KILL-00001', featureId: nativeId, featureIds: [nativeId], status: 'ACTIVE', delivery: { confirmed: 2, denominator: 3 } }] });
  await run('createVersion', 'author', { baseVersion: '1.0.0', bump: 'minor', reason: 'New local revision', changes: {} }, { id: nativeId });
  const flags = await run('featureFlags', 'viewer', undefined, {}, { featureId: nativeId, version: '1.1.0' });
  expect(flags).toHaveLength(1); expect(flags[0]).toMatchObject({ version: '1.1.0', policy: null, sources: [], kill: { killId: 'KILL-00001', confirmed: 2, denominator: 3 }, codeObservation: 'UNVERIFIED' });
});

it('actual trace writes and append-only evidence are visible without promoting unverified requirements', async () => {
  const f = await create();
  const l = await run('createTraceLink', 'author', { featureId: f.featureId, kind: 'REQUIREMENT', elementId: 'REQ-NEW', elementType: 'SYSTEM', sourceSystem: 'CODEBEAMER' });
  expect(l.existence).toBe('NOT_CHECKED');
  const trace = await run('featureTrace', 'viewer', undefined, { id: f.featureId });
  expect(trace.links).toHaveLength(1); expect(trace.links[0]).toMatchObject({ linkId: l.linkId, existence: 'NOT_CHECKED' });
  expect(trace.requirements[0].linked).toBe(true); expect(trace.evidence).toEqual([]);
  await run('unlinkTraceLink', 'author', { reason: 'Keep unlink history' }, { id: l.linkId });
  const unlinked = await run('featureTrace', 'viewer', undefined, { id: f.featureId });
  expect(unlinked.links[0].status).toBe('UNLINKED'); expect(unlinked.requirements[0].linked).toBe(false);
  put('traceSourceLookup', { found: true, element: { elementType: 'HIL', name: 'Captured test case', version: '1' } }, {}, { kind: 'TEST_CASE', elementId: 'TC-1' });
  const tc = await run('createTraceLink', 'author', { featureId: f.featureId, kind: 'TEST_CASE', elementId: 'TC-1', elementType: 'HIL', sourceSystem: 'TMS', required: true });
  const body = { evidenceId: 'EV-1', executedAt: '2026-11-09T00:00:00Z', result: 'PASS', environment: 'Local HIL' };
  await run('createTestEvidence', 'quality', body, { id: tc.linkId });
  const completed = await run('featureTrace', 'viewer', undefined, { id: f.featureId });
  expect(completed.evidence).toHaveLength(1); expect(completed.coverage.test).toMatchObject({ required: 1, withEvidence: 1, ratio: 1 });
  await expect(run('createTestEvidence', 'quality', body, { id: tc.linkId })).rejects.toMatchObject({ code: 'CONFLICT' });
});

it('truncated Feature history fails closed instead of becoming zero', async () => {
  put('listFeatures', { items: [native], total: 2 }, {}, { latestOnly: false });
  const f = await create();
  await expect(run('featureOpsMetrics', 'viewer', undefined, { id: f.featureId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('missing complete trace history is not an empty source', async () => {
  files.delete('/' + snapshotFile(url('traceLinks', {}, { status: 'ALL' })));
  const f = await create();
  await expect(run('featureTrace', 'viewer', undefined, { id: f.featureId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('actual SW selection counts exact SW-Version source requirements and deduplicates the system denominator', async () => {
  const f = await create();
  put('masterSw', { items: [
    { swId: 'SW-1', version: '1.0.0', ecuPno: 'ECU-1', requirementId: 'REQ-SW-1' },
    { swId: 'SW-1', version: '2.0.0', ecuPno: 'ECU-1', requirementId: 'REQ-WRONG-VERSION' },
    { swId: 'SW-2', version: '1.0.0', ecuPno: 'ECU-1', requirementId: 'REQ-NEW' },
    { swId: 'SW-3', version: '1.0.0', ecuPno: 'ECU-1', requirementId: null },
  ] });
  put('masterEcu', { items: [{ ecuPno: 'ECU-1', lifecycle: 'ACTIVE' }] });
  await run('updateDraft', 'author', { swIds: ['SW-1', 'SW-2', 'SW-3'], swVersions: ['1.0.0', '1.0.0', '1.0.0'], ecuPnos: ['ECU-1', 'ECU-1', 'ECU-1'] }, { id: f.featureId, ver: f.version });
  const actual = await run('featureTrace', 'viewer', undefined, { id: f.featureId });
  expect(actual.requirements).toEqual([{ reqId: 'REQ-NEW', type: 'SYSTEM', linked: false }, { reqId: 'REQ-SW-1', type: 'SW', linked: false }]);
  expect(actual.coverage.requirement.total).toBe(2);
  expect(actual.links).toEqual([]); expect(actual.evidence).toEqual([]);
});

it('legacy SW captures without the requirement projection still fail closed for a new SW scope', async () => {
  const f = await create();
  put('masterSw', { items: [{ swId: 'SW-1', version: '1.0.0', ecuPno: 'ECU-1' }] });
  put('masterEcu', { items: [{ ecuPno: 'ECU-1', lifecycle: 'ACTIVE' }] });
  await run('updateDraft', 'author', { swIds: ['SW-1'], swVersions: ['1.0.0'], ecuPnos: ['ECU-1'] }, { id: f.featureId, ver: f.version });
  await expect(run('featureTrace', 'viewer', undefined, { id: f.featureId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});

it('evaluation period validates native bounds and local findings retain the actual status with no measured effect', async () => {
  const f = await create(), o = engine.__overlayForTest()!;
  o.entities.localHealthFinding = { F: { findingId: 'F', featureId: f.featureId, version: '0.1.0', status: 'VERIFYING', dueAt: '2026-11-01T00:00:00Z', effect: { after: null, met: null } } };
  const result = await run('featureOpsMetrics', 'viewer', undefined, { id: f.featureId });
  expect(result.findings[0]).toMatchObject({ status: 'VERIFYING', overdue: true, effect: { after: null, met: null } });
  expect(result.connected).toBe(false); expect(result.versions).toEqual([]); expect(result.history).toEqual([]);
  for (const days of ['0', '91', '1.5', 'bad']) await expect(run('featureEvaluations', 'viewer', undefined, { id: f.featureId }, { days })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await run('featureEvaluations', 'viewer', undefined, { id: f.featureId }, { days: '1' })).period).toMatchObject({ days: 1, from: '2026-11-10', to: '2026-11-10' });
});
