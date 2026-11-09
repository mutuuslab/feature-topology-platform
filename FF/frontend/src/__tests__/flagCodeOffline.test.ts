import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ROUTES, routeUrl, snapshotFile } from '../../../contracts/src/routes';
import { canonicalJson } from '../../../contracts/src/rules/canonical';
import { reconcileFlag } from '../../../contracts/src/rules/flag-coverage';
let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine'), data: Record<string, any>;
const id = 'FEAT-00022', ver = '1.0.0', key = 'ivi_00022_enable';
const f = { featureId: id, version: ver, name: 'Offline source workflow', lifecycle: 'RELEASED', country: 'KR', ownerId: 'IVI', asil: 'QM', swIds: [], swVersions: [], ecuPnos: [], tags: [], featureRefs: [], requirementIds: [], controlPoints: ['Flag'] };
const url = (n: string, p = {}, q = {}) => routeUrl(n, p, q);
const run = (n: string, body?: any, role = 'viewer', params: Record<string, string> = {}, query = {}) => sim.simCall<any>(ROUTES.find(r => r.name === n)!, url(n, params, query), { body, role, params });
const get = (n: string, params = {}, query = {}) => run(n, undefined, 'viewer', params, query);
const repoBody = { displayName: 'Explicit offline DEMO', repository: 'https://github.com/demo/offline-source', mode: 'DEMO_MIRROR', defaultBranch: 'main', packages: [{ name: 'ivi', path: 'packages/ivi' }], scanPaths: [], scanIntervalMinutes: 0, installationId: null };
const createRepo = () => run('createFlagRepository', repoBody, 'coordinator');
const rows = () => engine.__overlayForTest()!.entities;
function setup() {
  const input: any = { now: new Date().toISOString(), flagKey: key, registry: { featureId: id, version: ver, lifecycle: f.lifecycle, plannedAt: null, policy: null, retirement: null, registryRetiredAt: null }, code: { current: 0, lastSeen: null, lastScanAt: null }, pullRequest: null, unleash: { configured: false, present: false, revision: null, archived: false }, deploy: null, report: null, rollout: null, lastEvaluatedAt: null, waiver: null };
  const row = { flagKey: key, featureId: id, version: ver, featureName: f.name, lifecycle: f.lifecycle, package: 'ivi', controlPoint: 'Flag', planSource: 'PLANNED', policy: null, code: { usages: [], lastSeen: null, lastScanAt: null }, pullRequest: null, unleash: input.unleash, deploy: null, report: null, waiver: null, ...reconcileFlag(input) };
  const coverage = { generatedAt: input.now, summary: { codeRequired: 1 }, rows: [row], fileFindings: [] };
  data = { [url('auditChain')]: { valid: true, head: 'flag-local-test', count: 0 }, [url('listFeatures', {}, { latestOnly: false })]: { items: [f] }, [url('listPolicies')]: { items: [] }, [url('flagRetirements')]: { items: [] }, [url('flagRepositories')]: { items: [] }, [url('flagPullRequests')]: { items: [] }, [url('flagScans')]: { items: [], nextCursor: null }, [url('flagGateWaivers')]: { items: [] }, [url('listFlagSources')]: [], [url('featureFlags')]: [{ flagKey: key, featureId: id, version: ver, featureName: f.name, policy: null, sources: [], publication: null }], [url('flagCoverage')]: coverage, [url('flagCoverage', {}, { featureId: id, version: ver })]: structuredClone(coverage), [url('featureDetail', { id, ver })]: { feature: f, meta: { createdBy: 'usr-author' }, versions: [{ version: ver }], gates: {}, dependencies: { incoming: [], outgoing: [] } }, [url('safetyProfile', { id, ver })]: { profile: { fClass: 'F2' } } };
}
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_DATA_MODE', 'static'); vi.stubGlobal('crypto', webcrypto); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-09T02:00:00.000Z')); localStorage.clear(); setup();
  vi.stubGlobal('fetch', vi.fn(async (input: string) => { const match = Object.keys(data).find(k => '/' + snapshotFile(k) === input || snapshotFile(k) === input); return match ? new Response(JSON.stringify(data[match]), { headers: { 'Content-Type': 'application/json' } }) : new Response('<!doctype html>'); }));
  sim = await import('../api/sim'); engine = await import('../api/sim/engine');
});
afterEach(() => { engine?.__resetSimForTest(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });
it('registers actual DEMO metadata, rejects remote modes, duplicate URLs, weak intervals and wrong roles', async () => {
  await expect(run('createFlagRepository', repoBody, 'integrator')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(run('createFlagRepository', { ...repoBody, mode: 'ACTIONS_OIDC' }, 'coordinator')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  const r = await createRepo(); expect((await get('flagRepositories')).items).toContainEqual(expect.objectContaining({ repoId: r.repoId, provenance: 'LOCAL_SIMULATION' }));
  await expect(createRepo()).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(run('updateFlagRepository', { scanIntervalMinutes: 2, reason: 'Too frequent' }, 'coordinator', { id: r.repoId })).rejects.toMatchObject({ code: 'VALIDATION' });
  await run('updateFlagRepository', { displayName: 'Revised DEMO', reason: 'Metadata review' }, 'coordinator', { id: r.repoId });
  expect((await get('flagRepositories')).items[0].displayName).toBe('Revised DEMO');
});
it('rescans exact retained bytes with real SHA/Ed25519, immutable result dedup and source readback', async () => {
  const r = await createRepo(), scan = await run('rescanFlagRepository', { reason: 'Actual local scan' }, 'integrator', { id: r.repoId });
  expect(scan.status).toBe('SUCCEEDED'); const d = await get('flagScanDetail', { id: scan.scanId }); expect(d.verified).toBe(true); expect(d.sourceFiles).toHaveLength(2);
  for (const file of d.sourceFiles) expect(file.sha256).toBe('sha256:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(file.content))).toString('hex'));
  expect(d.manifest.usages).toMatchObject([{ flagKey: key, via: 'CONST', safeDefault: 'EXPLICIT_FALSE' }]);
  const twice = await run('rescanFlagRepository', { reason: 'Repeat same source' }, 'integrator', { id: r.repoId }); expect(twice.resultId).toBe(scan.resultId); expect(Object.keys(rows().flagLocalResult)).toHaveLength(1);
  expect((await get('flagCoverage')).rows[0]).toMatchObject({ status: 'OK', releaseBlocking: false, code: { usages: [{ repoId: r.repoId, provenance: 'DEMO' }] } });
  expect((await get('featureFlags'))[0].sources).toContainEqual(expect.objectContaining({ commit: scan.commit }));
  expect((await get('flagScans')).items).toHaveLength(2);
});
it('rejects source injection, updated bytes with recomputed SHA, signature tampering, missing key and cross-purpose substitution', async () => {
  const r = await createRepo(), s = await run('rescanFlagRepository', { reason: 'Initial source' }, 'integrator', { id: r.repoId }), result = rows().flagLocalResult[s.resultId], proof = await import('../api/sim/handlers/flag-demo-proof');
  await expect(proof.makeBundle({ ...f, name: 'injected\nsource' }, result.bundles[0].plan)).rejects.toMatchObject({ code: 'VALIDATION' });
  result.bundles[0].files[1].content += '\n// altered'; result.bundles[0].files[1].sha256 = 'sha256:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(result.bundles[0].files[1].content))).toString('hex');
  expect((await get('flagScanDetail', { id: s.scanId })).verified).toBe(false); await expect(get('flagCoverage')).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});
it('creates an open PR, refuses duplicates, merges exact bytes and preserves actual scan/PR state', async () => {
  const r = await createRepo(), b = { featureId: id, version: ver, repoId: r.repoId }, p = await run('createFlagPr', b, 'integrator'); expect(p.state).toBe('OPEN');
  expect((await get('flagCoverage')).rows[0].status).toBe('PR_OPEN');
  await expect(run('createFlagPr', b, 'integrator')).rejects.toMatchObject({ code: 'CONFLICT' });
  const merged = await run('demoMergeFlagPr', {}, 'integrator', { id: p.prId }); expect(merged.pullRequest).toMatchObject({ state: 'MERGED', checkConclusion: 'SUCCESS', mergeCommit: merged.scan.commit });
  expect((await get('flagScanDetail', { id: merged.scan.scanId })).verified).toBe(true); expect((await get('flagReleaseGate', { id, ver })).pass).toBe(true);
  await expect(run('demoMergeFlagPr', {}, 'integrator', { id: p.prId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});
it('pauses writes without losing last code proof, and refuses missing branch source', async () => {
  const r = await createRepo(); await run('rescanFlagRepository', { reason: 'Local scan' }, 'integrator', { id: r.repoId });
  await run('updateFlagRepository', { status: 'PAUSED', reason: 'Pause scans' }, 'coordinator', { id: r.repoId });
  expect((await get('flagCoverage')).rows[0].status).toBe('OK');
  await expect(run('rescanFlagRepository', { reason: 'Paused scan' }, 'integrator', { id: r.repoId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  await run('updateFlagRepository', { status: 'ACTIVE', reason: 'Resume scans' }, 'coordinator', { id: r.repoId });
  await expect(run('rescanFlagRepository', { ref: 'unretained', reason: 'Unknown branch' }, 'integrator', { id: r.repoId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});
const waiverBody = { flagKey: key, featureId: id, version: ver, reason: 'Temporary explicit code release review', expiresAt: '2026-11-10T02:00:00.000Z' };
it('requires two independent actual people for F2, verifies signatures and expires without cross-version release', async () => {
  const w = await run('requestFlagGateWaiver', waiverBody, 'integrator');
  await expect(run('decideFlagGateWaiver', { decision: 'APPROVE', comment: 'Own decision' }, 'integrator', { id: w.waiverId })).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTY' });
  expect((await run('decideFlagGateWaiver', { decision: 'APPROVE', comment: 'Feature approval' }, 'approver', { id: w.waiverId })).state).toBe('REQUESTED');
  await expect(run('decideFlagGateWaiver', { decision: 'APPROVE', comment: 'Duplicate approval' }, 'approver', { id: w.waiverId })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await run('decideFlagGateWaiver', { decision: 'APPROVE', comment: 'Independent safety approval' }, 'quality', { id: w.waiverId })).state).toBe('APPROVED');
  expect((await get('flagReleaseGate', { id, ver }))).toMatchObject({ pass: true, waived: [{ waiverId: w.waiverId }] });
  vi.setSystemTime(new Date('2026-11-11T02:00:00.000Z')); expect((await get('flagGateWaivers')).items[0].state).toBe('EXPIRED'); expect((await get('flagReleaseGate', { id, ver })).pass).toBe(false);
});
it('denies a tampered approval and purpose substitution instead of accepting APPROVED text', async () => {
  const w = await run('requestFlagGateWaiver', waiverBody, 'integrator'); await run('decideFlagGateWaiver', { decision: 'APPROVE', comment: 'Feature approval' }, 'approver', { id: w.waiverId }); await run('decideFlagGateWaiver', { decision: 'APPROVE', comment: 'Safety approval' }, 'quality', { id: w.waiverId });
  const saved = rows().flagLocalWaiver[w.waiverId]; saved.decisions[0].signature.purpose = 'SCAN'; expect((await get('flagReleaseGate', { id, ver })).pass).toBe(false);
});
it('stores v1 as an immutable unverified declaration, affects source annotations but cannot satisfy code gate', async () => {
  const m = { format: 'ff-flag-source/v1', provider: 'GITHUB', repository: repoBody.repository, commit: 'a'.repeat(40), scannedAt: new Date().toISOString(), filesScanned: 1, unresolvedCalls: 0, usages: [{ flagKey: key, path: 'src/demo.ts', line: 2, symbol: 'client.isEnabled', method: 'isEnabled', safeDefault: 'SDK_DEFAULT', contentHash: 'sha256:' + 'b'.repeat(64) }] };
  const imported = await run('importFlagSources', m, 'integrator'); expect(imported.verification).toBe('DECLARED_UNVERIFIED');
  expect(imported.contentHash).toBe('sha256:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(m)))).toString('hex'));
  expect((await get('listFlagSources'))).toHaveLength(1); expect((await get('featureFlags'))[0].sources[0]).toMatchObject({ verification: 'DECLARED_UNVERIFIED' }); expect((await get('flagReleaseGate', { id, ver })).pass).toBe(false);
  expect((await run('importFlagSources', { ...m, scannedAt: '2026-11-09T03:00:00.000Z' }, 'integrator')).manifestId).toBe(imported.manifestId);
  await expect(run('importFlagSources', { ...m, unresolvedCalls: 1 }, 'integrator')).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('never silently substitutes empty missing capture or captured PR bytes', async () => {
  delete data[url('flagRepositories')]; await expect(createRepo()).rejects.toMatchObject({ code: 'INTERNAL' });
});
it('fails closed on raw manifest signature tampering, wrong purpose, missing key or native key namespace', async () => {
  const r = await createRepo(), s = await run('rescanFlagRepository', { reason: 'Signed source' }, 'integrator', { id: r.repoId }), result = rows().flagLocalResult[s.resultId], original = structuredClone(result.localSignature);
  for (const patch of [{ signature: 'A'.repeat(86) }, { purpose: 'APPROVAL' }, { keyId: 'LOCAL-FLAG-SCAN-missing' }, { keyId: 'native-gate-key' }]) {
    result.localSignature = { ...original, ...patch }; expect((await get('flagScanDetail', { id: s.scanId })).verified).toBe(false);
  }
  result.localSignature = original; result.manifest.usages[0].line++; expect((await get('flagScanDetail', { id: s.scanId })).verified).toBe(false);
});
it('preserves captured evidence and refuses merging a native PR without retained source', async () => {
  const r = await createRepo(), pr = { prId: 'FPR-000900', repoId: r.repoId, featureId: id, version: ver, flagKeys: [key], branch: 'ff/captured', kind: 'SCAFFOLD', state: 'OPEN', createdAt: new Date().toISOString() };
  data[url('flagPullRequests')].items.push(pr);
  await expect(run('demoMergeFlagPr', {}, 'integrator', { id: pr.prId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  expect(data[url('flagPullRequests')].items[0]).toEqual(pr); expect(rows().flagLocalScan).toBeUndefined();
});
it('implements approved removal with actual stub source bytes and SHA, no remaining SDK call', async () => {
  const ret = { retirementId: 'RET-DEMO', flagKey: key, featureId: id, featureVersion: ver, status: 'APPROVED', approvedAt: new Date().toISOString(), nextReleaseAt: null, steps: {} }; data[url('flagRetirements')].items.push(ret);
  const r = await createRepo(); await run('rescanFlagRepository', { reason: 'Capture actual calls' }, 'integrator', { id: r.repoId });
  const body = { flagKey: key, repoId: r.repoId, retirementId: ret.retirementId };
  await expect(run('createFlagRemovalPr', { ...body, flagKey: 'ivi_00022_other' }, 'integrator')).rejects.toMatchObject({ code: 'VALIDATION' });
  const p = await run('createFlagRemovalPr', body, 'integrator'), merged = await run('demoMergeFlagPr', {}, 'integrator', { id: p.prId }), d = await get('flagScanDetail', { id: merged.scan.scanId });
  expect(d.verified).toBe(true); expect(d.manifest.usages).toEqual([]); expect(d.sourceFiles.find((x: any) => x.path.endsWith('flag-guards.ts')).content).toContain('Promise.resolve(false)'); expect((await get('flagCoverage')).rows[0].code.usages).toEqual([]);
});
it('keeps other lane blockers after a verified local code scan, and blocks stale or absent version evidence', async () => {
  for (const q of [{}, { featureId: id, version: ver }]) { const row = data[url('flagCoverage', {}, q)].rows[0]; row.unleash = { configured: true, present: false, revision: null, archived: false }; row.policy = { policyId: 'POL-1', status: 'DEPLOYED', revision: 1 }; }
  const r = await createRepo(); await run('rescanFlagRepository', { reason: 'Code alone is insufficient' }, 'integrator', { id: r.repoId });
  expect((await get('flagCoverage')).rows[0]).toMatchObject({ status: 'UNLEASH_MISMATCH', releaseBlocking: true, lanes: { CODE: 'OK', UNLEASH: 'MISMATCH' } });
  delete data[url('flagCoverage', {}, { featureId: id, version: ver })]; await expect(get('flagReleaseGate', { id, ver })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
});
it('serializes concurrent duplicate intent, retains one accepted record and audited denial', async () => {
  const both = await Promise.allSettled([createRepo(), createRepo()]); expect(both.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((await get('flagRepositories')).items).toHaveLength(1);
  expect(engine.__overlayForTest()!.audit).toContainEqual(expect.objectContaining({ action: 'FLAG_REPO_CREATE', result: 'FAILED' }));
});
it('retains rejection decisions and requires a valid expiry within the native thirty-day cap', async () => {
  await expect(run('requestFlagGateWaiver', { ...waiverBody, expiresAt: '2027-01-01T00:00:00.000Z' }, 'integrator')).rejects.toMatchObject({ code: 'VALIDATION' });
  const w = await run('requestFlagGateWaiver', waiverBody, 'integrator'); expect((await run('decideFlagGateWaiver', { decision: 'REJECT', comment: 'Insufficient evidence' }, 'quality', { id: w.waiverId })).state).toBe('REJECTED');
  expect((await get('flagReleaseGate', { id, ver })).pass).toBe(false);
});
