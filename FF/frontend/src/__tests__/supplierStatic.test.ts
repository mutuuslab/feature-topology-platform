import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ROUTES, routeUrl, snapshotFile } from '../../../contracts/src/routes';
import { SUPPLIER_ARTIFACT_TYPES } from '../../../contracts/src/schemas/supplier';
import { acceptanceCheck, latestArtifacts } from '../../../contracts/src/rules/supplier';
import { publicArtifactUri as nativeUri, verifyArtifact as nativeVerify } from '../../../backend/src/domains/d05-ext/supplier/supplier-proof';

// Vite's browser-only barrel intentionally omits these native exports; expose their real modules for the native parity import.
vi.mock('@ff/contracts', async original => ({ ...await original<Record<string, unknown>>(), ...await import('../../../contracts/src/rules/supplier'), ...await import('../../../contracts/src/rules/canonical') }));

const f = { featureId: 'FEAT-00001', version: '1.0.0', name: 'Supplier regression', asil: 'QM', country: 'KR', vehicleModel: 'NX4', trim: 'ALL', swIds: ['SW-DEMO'], swVersions: ['1.0.0'], ecuPnos: ['ECU-DEMO'], lifecycle: 'IMPLEMENTED', ownerId: 'team', featureRefs: [], tags: [], requirementIds: [] };
let snapshots: Record<string, any>, sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine');
const url = (n: string, p = {}, q = {}) => routeUrl(n, p, q);
const run = (n: string, body?: any, role = 'integrator', params: Record<string, string> = {}, query = {}) => sim.simCall<any>(ROUTES.find(r => r.name === n)!, url(n, params, query), { role, params, body });
const get = (n: string, p: Record<string, string> = {}, query = {}) => run(n, undefined, 'viewer', p, query);
const setup = () => {
  const summary = { ...f, gates: {}, tags: [] };
  snapshots = {
    [url('auditChain')]: { valid: true, head: 'supplier-test', count: 0 },
    [url('listFeatures')]: { items: [summary], total: 1 },
    [url('listFeatures', {}, { latestOnly: false })]: { items: [summary], total: 1 },
    [url('featureDetail', { id: f.featureId, ver: f.version })]: { feature: f, meta: { createdBy: null, createdAt: null }, gates: {}, dependencies: { incoming: [], outgoing: [] }, functions: [{ functionId: 'FUNC-000001', featureId: f.featureId }], trace: [], baseline: null, products: [], transitions: [], versions: [{ version: f.version, lifecycle: f.lifecycle }] },
    [url('supplierPackages')]: { items: [] },
    [url('supplierMappings', {}, { featureId: f.featureId })]: { items: [] },
    [url('supplierCriteria', {}, { featureId: f.featureId })]: { items: [] },
    [url('masterSw')]: { items: [{ swId: 'SW-DEMO', version: '1.0.0', supplier: 'Demo-Supplier', ecuPno: 'ECU-DEMO' }] },
    [url('masterEcu')]: { items: [{ ecuPno: 'ECU-DEMO' }] },
    [url('dependencies')]: { items: [] },
    [url('supplierScope', { id: f.featureId, ver: f.version })]: { feature: f, suppliers: [], traceEvidence: { required: 0, withEvidence: 0 }, directory: { mode: 'UNAVAILABLE', source: 'UNCONFIRMED' } },
  };
};
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_DATA_MODE', 'static'); localStorage.clear(); setup();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const key = Object.keys(snapshots).find(u => '/' + snapshotFile(u) === input || snapshotFile(u) === input);
    return key ? new Response(JSON.stringify(snapshots[key]), { headers: { 'Content-Type': 'application/json' } }) : new Response('<!doctype html>');
  }));
  sim = await import('../api/sim'); engine = await import('../api/sim/engine');
});
afterEach(() => { engine?.__resetSimForTest(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });
const create = (version = '1.0.0', extra = {}) => run('createSupplierPackage', { featureId: f.featureId, featureVersion: f.version, supplier: 'Demo-Supplier', version, ...extra });
const createCriteria = (threshold = 80) => run('createSupplierCriteria', { featureId: f.featureId, reason: 'Independent acceptance criteria', items: [{ kind: 'MIN_COVERAGE', threshold }] }, 'quality');
const review = (id: string, decision = 'ACCEPT') => run('reviewSupplierPackage', { decision, comment: 'Independent work product inspection', items: SUPPLIER_ARTIFACT_TYPES.map(type => ({ type, result: decision === 'ACCEPT' ? 'PASS' : 'FAIL', comment: decision === 'ACCEPT' ? null : 'Please correct this work product' })) }, 'quality', { id });
function body(type: string, p: any, mappingId = 'SFM-00001') {
  const meta: Record<string, any> = {
    API_CONTRACT: { apiFormat: 'OPENAPI' }, FEATURE_MAPPING: { mappingIds: [mappingId] },
    CAPABILITY_MANIFEST: { capability: { hwVersions: ['1'], swVersions: [{ swId: 'SW-DEMO', version: '1.0.0' }], ecuCapabilities: [{ ecuPno: 'ECU-DEMO', capabilities: ['DEMO'] }] } },
    VARIANT_COMPAT: { variants: [{ vehicleModel: f.vehicleModel, region: f.country, trim: f.trim, modelYears: [2026] }] },
    DIAGNOSTICS: { diagnostics: { dtcs: [], events: ['DEMO'] } }, SAFETY_SECURITY: { safety: { asil: 'QM', cybersecurityClaim: 'Synthetic local evidence', certRef: null } },
    TEST_EVIDENCE: { testEvidence: { unitPassed: 1, unitTotal: 1, integrationPassed: 1, integrationTotal: 1, coveragePct: 90, buildStatus: 'SUCCESS', buildWarnings: 0, evidenceIds: ['DEMO-TEST'] } },
    RELEASE_NOTE: { releaseNote: { releaseId: 'DEMO-RELEASE', breakingChanges: false, migration: null } },
  }[type] ?? {};
  const binding = { featureId: p.featureId, featureVersion: p.featureVersion, packageVersion: p.version };
  const text = JSON.stringify(type === 'API_CONTRACT' ? { openapi: '3.2.0', info: { title: type, version: p.version }, paths: {}, 'x-ff-package': binding } : { package: binding, ...meta });
  return { type, version: p.version, title: type, uri: 'https://supplier.example/demo', checksum: '', text, ...meta };
}
async function add(type: string, p: any, extra = {}, mappingId?: string) {
  const b = body(type, p, mappingId); b.checksum = 'sha256:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(b.text))).toString('hex');
  return run('submitSupplierArtifact', { ...b, ...extra }, 'integrator', { id: p.packageId });
}
async function complete() {
  const m = await run('createSupplierMapping', { featureId: f.featureId, supplier: 'Demo-Supplier', supplierFunctionId: 'DEMO-FUNCTION', name: 'Demo function' }, 'author');
  await run('addSupplierSwc', { swcId: 'DEMO-COMPONENT', name: 'Demo component', swId: 'SW-DEMO', ecuPno: 'ECU-DEMO' }, 'integrator', { id: m.mapId });
  await createCriteria(); const p = await create();
  for (const type of SUPPLIER_ARTIFACT_TYPES) await add(type, p, {}, m.mapId);
  return p;
}
it('executes mapping/SWC → ten hashed bodies → submit → independent acceptance with actual rereads and audit chain', async () => {
  const p = await complete(), before = await get('supplierPackage', { id: p.packageId });
  expect(before.check.verdict).toBe('MET'); expect(before.artifacts).toHaveLength(10); expect(before.artifacts.every((a: any) => a.text === null && a.integrity === 'VERIFIED')).toBe(true);
  await run('submitSupplierPackage', { note: 'Ready for independent inspection' }, 'integrator', { id: p.packageId });
  expect((await get('supplierPackage', { id: p.packageId })).package.status).toBe('SUBMITTED');
  expect((await review(p.packageId)).package.status).toBe('ACCEPTED');
  const gate = await get('supplierGate', { id: f.featureId, ver: f.version }); expect(gate.accepted).toEqual([p.packageId]); expect(gate.blockers).toEqual([]);
  const first = before.artifacts[0], content = await get('supplierArtifactContent', { id: first.recordId }); expect(content.verified).toBe(true); expect(content.text).toContain(f.featureId);
  const scope = await get('supplierScope', { id: f.featureId, ver: f.version }); expect(scope.suppliers[0].latestPackage.packageId).toBe(p.packageId); expect(scope.suppliers[0].evidence.verification).toBe('VERIFIED');
  const audits = engine.__overlayForTest()!.audit; expect(audits.filter(a => a.action.startsWith('SUPPLIER_'))).toHaveLength(16); expect(JSON.stringify(audits)).not.toContain('"openapi"'); expect(audits.every(a => !!a.hash)).toBe(true);
});
it('enforces role, incomplete submission, duplicate versions/mappings and wrong supplier SW without fake writes', async () => {
  await expect(run('createSupplierPackage', { featureId: f.featureId, featureVersion: f.version, supplier: 'Demo-Supplier', version: '1.0.0' }, 'viewer')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const p = await create(); await expect(create()).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(run('submitSupplierPackage', {}, 'integrator', { id: p.packageId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  const b = { featureId: f.featureId, supplier: 'Other-Supplier', supplierFunctionId: 'DEMO-F', name: 'Other' }, m = await run('createSupplierMapping', b, 'author');
  await expect(run('createSupplierMapping', b, 'author')).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(run('addSupplierSwc', { swcId: 'DEMO-SWC', name: 'SW', swId: 'SW-DEMO' }, 'author', { id: m.mapId })).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  expect((await get('supplierMappings', {}, { featureId: f.featureId })).items[0].swcs).toEqual([]);
});
it('recomputes hashes and bindings, persists a mismatch as held evidence, and appends a replacement version', async () => {
  const p = await complete(); const invalid = await add('HUMAN_DOC', p, { checksum: 'sha256:' + '0'.repeat(64) }); expect(invalid.verification.integrity).toBe('MISMATCH');
  let d = await get('supplierPackage', { id: p.packageId }); expect(d.check.verdict).toBe('NOT_MET'); expect(d.artifacts).toHaveLength(11);
  await run('submitSupplierPackage', {}, 'integrator', { id: p.packageId }); await expect(review(p.packageId)).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  await review(p.packageId, 'REJECT'); await add('HUMAN_DOC', p); d = await get('supplierPackage', { id: p.packageId }); expect(d.artifacts).toHaveLength(12); expect(d.check.verdict).toBe('MET'); expect(d.reviews).toHaveLength(1);
  await expect(add('HUMAN_DOC', p, { uri: 'https://127.0.0.1/private' })).rejects.toMatchObject({ code: 'VALIDATION' });
});
it('checks separation against actual participants and blocks stale criteria after a completed acceptance', async () => {
  const p = await complete(); await run('submitSupplierPackage', {}, 'integrator', { id: p.packageId });
  const o = engine.__overlayForTest()!; o.entities.supplierPackage[p.packageId].createdBy = 'usr-quality';
  await expect(review(p.packageId)).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTY' });
  expect(engine.__overlayForTest()!.audit[0].result).toBe('DENIED'); o.entities.supplierPackage[p.packageId].createdBy = 'usr-integrator';
  await review(p.packageId); await createCriteria(95);
  const gate = await get('supplierGate', { id: f.featureId, ver: f.version }); expect(gate.accepted).toEqual([]); expect(gate.blockers).toHaveLength(1);
  expect((await get('supplierCriteria', {}, { featureId: f.featureId })).items.map((c: any) => c.revision)).toEqual([1, 2]);
});
it('carry-forward keeps original records and correctly invalidates bodies bound to the earlier package version', async () => {
  const p = await complete(); const carried = await create('2.0.0', { basedOn: p.packageId });
  const d = await get('supplierPackage', { id: carried.packageId }); expect(d.artifacts).toHaveLength(10); expect(d.artifacts.every((a: any) => a.carriedFrom && a.integrity === 'MISMATCH')).toBe(true); expect(d.check.verdict).toBe('NOT_MET');
  expect((await get('supplierPackage', { id: p.packageId })).artifacts.every((a: any) => a.integrity === 'VERIFIED')).toBe(true);
});
it('missing sources stay errors and imported VERIFIED labels cannot substitute for retained body bytes', async () => {
  delete snapshots[url('supplierMappings', {}, { featureId: f.featureId })];
  await expect(run('createSupplierMapping', { featureId: f.featureId, supplier: 'Demo-Supplier', supplierFunctionId: 'FN', name: 'Function' }, 'author')).rejects.toMatchObject({ code: 'INTERNAL' });
  expect(engine.__overlayForTest()!.entities.supplierMapping).toBeUndefined();
});
it('serializes competing duplicate package writes and appends one audit denial without losing the accepted record', async () => {
  const result = await Promise.allSettled([create(), create()]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect((await get('supplierPackages')).items).toHaveLength(1);
  expect(engine.__overlayForTest()!.audit.filter(a => a.action === 'SUPPLIER_PACKAGE_CREATE').map(a => a.result).sort()).toEqual(['ALLOWED', 'FAILED']);
});
it('rechecks captured artifact bytes instead of an imported VERIFIED label and keeps captured histories on local rejection', async () => {
  const p = { featureId: f.featureId, featureVersion: f.version, supplier: 'Demo-Supplier', version: '1.0.0', packageId: 'SPK-00009', status: 'SUBMITTED', createdBy: 'usr-integrator', submittedBy: 'usr-integrator', createdAt: '2026-11-01T00:00:00Z', submittedAt: '2026-11-01T00:00:00Z', basedOn: null };
  const a = { ...body('HUMAN_DOC', p), text: null, recordId: 'SPA-00011', packageId: p.packageId, submittedBy: 'usr-integrator', submittedAt: p.createdAt, carriedFrom: null, integrity: 'VERIFIED', contentUrl: null };
  snapshots[url('supplierPackages')] = { items: [p] };
  snapshots[url('supplierPackage', { id: p.packageId })] = { package: p, artifacts: [a], reviews: [], latest: { HUMAN_DOC: a } };
  let d = await get('supplierPackage', { id: p.packageId }); expect(d.artifacts[0].integrity).toBe('DECLARED');
  await review(p.packageId, 'REJECT');
  d = await get('supplierPackage', { id: p.packageId }); expect(d.package.status).toBe('REJECTED'); expect(d.artifacts).toHaveLength(1); expect(d.reviews).toHaveLength(1);
  await expect(get('supplierArtifactContent', { id: a.recordId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('browser WebCrypto proof matches native for valid, tampered, wrong-target, metadata and missing-body cases', async () => {
  const browser = await import('../api/sim/handlers/supplier-proof'), p = { featureId: f.featureId, featureVersion: f.version, version: '1.0.0' };
  const b = body('API_CONTRACT', p); b.checksum = 'sha256:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(b.text))).toString('hex');
  for (const candidate of [b, { ...b, text: b.text + ' ' }, { ...b, checksum: 'sha256:' + '0'.repeat(64) }, { ...b, text: null }, { ...b, version: '2.0.0' }, { ...b, uri: 'https://localhost/internal' }]) expect(await browser.verifyArtifact(p, candidate as any)).toEqual(nativeVerify(p, candidate as any));
  for (const uri of ['https://supplier.example/file', 'file:///tmp/private', 'http://supplier.example/file', 'https://192.168.0.1/private', 'https://a.internal/path']) expect(browser.publicArtifactUri(uri)).toBe(nativeUri(uri));
  const rows: any[] = []; expect(acceptanceCheck({ pkg: p, latest: latestArtifacts(rows), criteria: null, feature: f as any, featureVersions: [f.version], activeMappingIds: [] }).verdict).toBe('NO_CRITERIA');
});
