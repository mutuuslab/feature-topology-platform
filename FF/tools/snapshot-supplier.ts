// Supplier GET projection for a fresh isolated synthetic capture. No external URI is fetched.
// The allowlist is independently reconstructed from the owned showcase generator's exact bytes.
import { createHash } from 'node:crypto';

type Save = (name: string, params?: Record<string, string>, query?: Record<string, any>, headers?: Record<string, string>, transform?: (body: any) => any) => Promise<any>;
const TYPES = ['API_CONTRACT','HUMAN_DOC','FEATURE_MAPPING','CAPABILITY_MANIFEST','VARIANT_COMPAT','DIAGNOSTICS','SAFETY_SECURITY','SDK_STUB_MOCK','TEST_EVIDENCE','RELEASE_NOTE'];
const NOTE = 'DEMO — 가상 산출물 검수 시연, 실차·실제 협력사 검증을 뜻하지 않음';
const WARNING = 'Demonstration only. Not a real supplier test, safety approval or vehicle certification.';
const checksum = (text: string) => 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Allowed = { packageId: string; recordId: string; expectedChecksum: string; text: string };

/** Metadata labels alone never authorize bytes: the exact owned template must match its checksum. */
export function ownedDemoSupplierAllowlist(detail: any, feature: any, mappings: any[]): Allowed[] {
  const p = detail?.package;
  if (!p || p.status !== 'ACCEPTED' || p.submitNote !== NOTE || !p.decidedBy || !p.submittedBy || p.decidedBy === p.submittedBy || p.decidedBy === p.createdBy || p.featureId !== feature?.featureId || p.featureVersion !== feature?.version) return [];
  const result: Allowed[] = [];
  for (const a of detail.artifacts ?? []) {
    if (!/^SPA-\d{5}$/.test(a.recordId) || a.packageId !== p.packageId || !TYPES.includes(a.type) || a.integrity !== 'VERIFIED' || a.version !== p.version || a.title !== `DEMO — ${a.type}` || a.uri !== `https://supplier.example/demo/${p.packageId}/${a.type}`) continue;
    let metadata: Record<string, unknown> = {};
    if (a.type === 'FEATURE_MAPPING') {
      if (!Array.isArray(a.mappingIds) || a.mappingIds.length !== 1 || !mappings.some(m => m.mapId === a.mappingIds[0] && m.featureId === p.featureId && m.supplier === p.supplier)) continue;
      metadata = { mappingIds: a.mappingIds };
    } else if (a.type === 'CAPABILITY_MANIFEST') {
      const c = a.capability;
      if (!c || !Array.isArray(c.hwVersions) || !c.hwVersions.length || !same(c.swVersions, (feature.swIds ?? []).map((swId: string, i: number) => ({ swId, version: feature.swVersions?.[i] }))) || !Array.isArray(c.ecuCapabilities) || !c.ecuCapabilities.length || !c.ecuCapabilities.every((e: any) => feature.ecuPnos?.includes(e.ecuPno) && same(e.capabilities, ['DEMO-CAPABILITY']))) continue;
      metadata = { capability: c };
    } else if (a.type === 'VARIANT_COMPAT') {
      const variants = [{ vehicleModel: feature.vehicleModel, region: feature.country, trim: feature.trim, modelYears: [2026] }];
      if (!same(a.variants, variants)) continue; metadata = { variants };
    } else if (a.type === 'DIAGNOSTICS') {
      const diagnostics = { dtcs: [], events: ['DEMO-SCENARIO'] }; if (!same(a.diagnostics, diagnostics)) continue; metadata = { diagnostics };
    } else if (a.type === 'SAFETY_SECURITY') {
      const safety = { asil: feature.asil, cybersecurityClaim: 'DEMO — 가상 검수 시나리오. 실제 인증·실차 보안 시험 근거가 아님', certRef: null };
      if (!same(a.safety, safety)) continue; metadata = { safety };
    } else if (a.type === 'TEST_EVIDENCE') {
      const testEvidence = { unitPassed: 1, unitTotal: 1, integrationPassed: 1, integrationTotal: 1, coveragePct: 100, buildStatus: 'SUCCESS', buildWarnings: 0, evidenceIds: ['DEMO-SYNTHETIC-NOT-VEHICLE-TEST'] };
      if (!same(a.testEvidence, testEvidence)) continue; metadata = { testEvidence };
    } else if (a.type === 'RELEASE_NOTE') {
      const releaseNote = { releaseId: `DEMO-${feature.featureId}-${feature.version}`, breakingChanges: false, migration: null };
      if (!same(a.releaseNote, releaseNote)) continue; metadata = { releaseNote };
    }
    const binding = { featureId: feature.featureId, featureVersion: feature.version, packageVersion: p.version };
    const provenance = { source: 'DEMO', synthetic: true, warning: WARNING };
    if (a.type === 'API_CONTRACT' && a.apiFormat !== 'OPENAPI') continue;
    const text = JSON.stringify(a.type === 'API_CONTRACT' ? { openapi: '3.2.0', info: { title: 'DEMO contract', version: p.version }, paths: {}, 'x-ff-package': binding, 'x-ff-provenance': provenance } : { title: `DEMO ${a.type}`, package: binding, provenance, ...metadata });
    if (a.checksum !== checksum(text)) continue;
    result.push({ packageId: p.packageId, recordId: a.recordId, expectedChecksum: a.checksum, text });
  }
  return result;
}

export function supplierMetadataOnly(detail: any, allowed: readonly Allowed[]) {
  const ids = new Set(allowed.map(a => a.recordId));
  const strip = (a: any) => ({ ...a, text: null, ...(Object.hasOwn(a, 'contentUrl') ? { contentUrl: ids.has(a.recordId) ? a.contentUrl : null } : {}) });
  return { ...detail, artifacts: (detail.artifacts ?? []).map(strip), latest: Object.fromEntries(Object.entries(detail.latest ?? {}).map(([type, a]) => [type, strip(a)])) };
}
function verifyAllowedBody(body: any, allowed: Allowed) {
  if (body?.recordId !== allowed.recordId || body.verified !== true || body.checksum !== allowed.expectedChecksum || body.declaredChecksum !== allowed.expectedChecksum || typeof body.text !== 'string' || checksum(body.text) !== allowed.expectedChecksum || body.text !== allowed.text) throw new Error(`Supplier demo body failed explicit allowlist verification: ${allowed.recordId}`);
  const doc = JSON.parse(body.text), provenance = doc.provenance ?? doc['x-ff-provenance'];
  if (provenance?.source !== 'DEMO' || provenance.synthetic !== true) throw new Error(`Supplier body is not an owned synthetic demonstration: ${allowed.recordId}`);
  return body;
}

export async function snapshotSupplier(save: Save, ctx: { features: { featureId: string; version: string }[] }) {
  const list = await save('supplierPackages');
  if (!Array.isArray(list?.items)) throw new Error('Supplier package source is missing');
  const mappings = new Map<string, any[]>(), versions = new Set<string>();
  for (const f of ctx.features) {
    if (!mappings.has(f.featureId)) {
      const m = await save('supplierMappings', {}, { featureId: f.featureId });
      if (!Array.isArray(m?.items)) throw new Error(`Supplier mapping source is missing: ${f.featureId}`);
      mappings.set(f.featureId, m.items); await save('supplierCriteria', {}, { featureId: f.featureId });
    }
    const key = f.featureId + '@' + f.version; if (versions.has(key)) continue; versions.add(key);
    await save('supplierPackages', {}, { featureId: f.featureId, featureVersion: f.version });
    await save('supplierGate', { id: f.featureId, ver: f.version });
  }
  const allowlist: Omit<Allowed, 'text'>[] = [];
  for (const p of list.items) {
    const feature = (await save('featureDetail', { id: p.featureId, ver: p.featureVersion }))?.feature;
    let allowed: Allowed[] = [];
    await save('supplierPackage', { id: p.packageId }, {}, {}, (detail) => {
      if (detail?.package?.packageId !== p.packageId) throw new Error('Supplier package attribution mismatch');
      allowed = ownedDemoSupplierAllowlist(detail, feature, mappings.get(p.featureId) ?? []);
      return supplierMetadataOnly(detail, allowed);
    });
    for (const a of allowed) {
      await save('supplierArtifactContent', { id: a.recordId }, {}, {}, body => verifyAllowedBody(body, a));
      const { text: _text, ...entry } = a; allowlist.push(entry);
    }
  }
  return { packages: list.items.length, featureVersions: versions.size, allowedArtifacts: allowlist };
}
