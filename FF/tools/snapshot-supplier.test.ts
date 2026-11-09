import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ownedDemoSupplierAllowlist, snapshotSupplier, supplierMetadataOnly } from './snapshot-supplier.ts';

const hash = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
function fixture() {
  const feature = { featureId: 'FEAT-00001', version: '1.0.0', asil: 'QM', country: 'KR', vehicleModel: 'NX', trim: 'Base', swIds: ['SW-ONE'], swVersions: ['1.0.0'], ecuPnos: ['ECU-ONE'] };
  const pkg = { packageId: 'SPK-00001', featureId: feature.featureId, featureVersion: feature.version, version: '2.0.0', supplier: 'Demo supplier', status: 'ACCEPTED', createdBy: 'author', submittedBy: 'author', decidedBy: 'reviewer', submitNote: 'DEMO — 가상 산출물 검수 시연, 실차·실제 협력사 검증을 뜻하지 않음' };
  // Actual format emitted by the independent native showcase generator; not an archiver-produced fixture.
  const text = JSON.stringify({ openapi: '3.2.0', info: { title: 'DEMO contract', version: '2.0.0' }, paths: {}, 'x-ff-package': { featureId: feature.featureId, featureVersion: feature.version, packageVersion: '2.0.0' }, 'x-ff-provenance': { source: 'DEMO', synthetic: true, warning: 'Demonstration only. Not a real supplier test, safety approval or vehicle certification.' } });
  const artifact = { packageId: pkg.packageId, recordId: 'SPA-00001', type: 'API_CONTRACT', version: pkg.version, title: 'DEMO — API_CONTRACT', uri: 'https://supplier.example/demo/SPK-00001/API_CONTRACT', checksum: hash(text), integrity: 'VERIFIED', apiFormat: 'OPENAPI', text: null, contentUrl: '/api/supplier-artifacts/SPA-00001/content' };
  const privateArtifact = { ...artifact, recordId: 'SPA-00002', type: 'HUMAN_DOC', title: 'DEMO — HUMAN_DOC', uri: 'https://supplier.example/demo/SPK-00001/HUMAN_DOC', checksum: hash('PRIVATE BODY'), text: 'PRIVATE BODY', contentUrl: '/api/supplier-artifacts/SPA-00002/content' };
  const detail = { package: pkg, artifacts: [artifact, privateArtifact], latest: { API_CONTRACT: { ...artifact, text }, HUMAN_DOC: privateArtifact }, reviews: [{ decision: 'ACCEPT' }] };
  const content = { recordId: artifact.recordId, text, checksum: hash(text), declaredChecksum: hash(text), verified: true };
  return { feature, pkg, artifact, privateArtifact, detail, content };
}

test('DEMO metadata alone cannot authorize private bytes; exact ID/checksum/template allowlist is required', () => {
  const f = fixture(), allowed = ownedDemoSupplierAllowlist(f.detail, f.feature, []);
  assert.deepEqual(allowed.map(a => a.recordId), ['SPA-00001']);
  const clean = supplierMetadataOnly(f.detail, allowed);
  assert.equal(clean.artifacts[0].contentUrl, f.artifact.contentUrl); assert.equal(clean.artifacts[1].contentUrl, null);
  assert.equal(clean.latest.API_CONTRACT.text, null); assert.equal(clean.latest.HUMAN_DOC.text, null);
  assert.ok(!JSON.stringify(clean).includes('PRIVATE BODY')); assert.equal(f.detail.latest.HUMAN_DOC.text, 'PRIVATE BODY');
});
test('captures real metadata and only the allowed verified body, using the same UI query shapes', async () => {
  const f = fixture(), saved: { name: string; params: any; query: any; body: any }[] = [], contentReads: string[] = [];
  await snapshotSupplier(async (name, params = {}, query = {}, _headers, transform) => {
    let body: any = name === 'supplierPackages' ? { items: [f.pkg] } : name === 'featureDetail' ? { feature: f.feature } : name === 'supplierPackage' ? f.detail : { items: [] };
    if (name === 'supplierArtifactContent') { contentReads.push(params.id); assert.equal(params.id, 'SPA-00001'); body = f.content; }
    if (transform) body = transform(body); saved.push({ name, params, query, body }); return body;
  }, { features: [f.feature] });
  assert.deepEqual(contentReads, ['SPA-00001']);
  assert.ok(saved.some(s => s.name === 'supplierPackages' && s.query.featureId === f.feature.featureId && s.query.featureVersion === f.feature.version));
  assert.ok(saved.some(s => s.name === 'supplierGate' && s.params.id === f.feature.featureId && s.params.ver === f.feature.version));
  const detail = saved.find(s => s.name === 'supplierPackage')!.body; assert.ok(!JSON.stringify(detail).includes('PRIVATE BODY'));
  assert.equal(saved.find(s => s.name === 'supplierArtifactContent')!.body.text, f.content.text);
});
for (const change of ['text', 'checksum', 'record', 'verified']) test(`refuses ${change} mismatch before a body can be persisted`, async () => {
  const f = fixture(), content = structuredClone(f.content); let persisted = false;
  if (change === 'text') content.text += ' secret'; if (change === 'checksum') content.checksum = 'sha256:wrong'; if (change === 'record') content.recordId = 'SPA-99999'; if (change === 'verified') content.verified = false;
  await assert.rejects(snapshotSupplier(async (name, _params, _query, _headers, transform) => {
    const body = name === 'supplierPackages' ? { items: [f.pkg] } : name === 'featureDetail' ? { feature: f.feature } : name === 'supplierPackage' ? f.detail : name === 'supplierArtifactContent' ? content : { items: [] };
    const result = transform ? transform(body) : body; if (name === 'supplierArtifactContent') persisted = true; return result;
  }, { features: [f.feature] }), /allowlist/); assert.equal(persisted, false);
});
test('requires original Feature/version binding and independent native acceptance', () => {
  const f = fixture(); assert.equal(ownedDemoSupplierAllowlist(f.detail, { ...f.feature, version: '9.0.0' }, []).length, 0);
  assert.equal(ownedDemoSupplierAllowlist({ ...f.detail, package: { ...f.pkg, decidedBy: f.pkg.createdBy } }, f.feature, []).length, 0);
});
