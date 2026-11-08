// Test-only upgrade of the old policy-ops fixture: explicit known-empty exception,
// compliance, code and ADS facts. Production never supplies this fallback.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { decisionPayload, GX_SOURCE_SCHEMA, gxFeatureFacts, jcs, routeUrl, snapshotFile } from '@ff/contracts';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signature = (p: unknown) => ({ alg: 'EdDSA', kid: 'TEST-LEGACY-GATE', value: sign(null, Buffer.from(jcs(p)), privateKey).toString('base64url') });
const hash = (p: unknown) => 'sha256:' + createHash('sha256').update(jcs(p)).digest('hex');
const rel = (name: string, params = {}) => snapshotFile(routeUrl(name, params));
export function gxLegacyFacts(path: string, original: any, load: (rel: string) => any): any {
  const now = new Date().toISOString();
  if (path === rel('exceptionPolicies')) return { items: [] };
  if (path === rel('pkiKeys')) return { items: [{ keyId: 'TEST-LEGACY-GATE', alg: 'Ed25519', purpose: 'gate', status: 'ACTIVE', createdAt: '2020-01-01T00:00:00Z', notAfter: '2099-01-01T00:00:00Z', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), fingerprint: 'sha256:' + createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16) }] };
  const policies = load(rel('listPolicies'))?.items ?? [];
  for (const p of policies) {
    if (path !== rel('policyExceptionSources', { id: p.policyId })) continue;
    const feature = load(rel('featureDetail', { id: p.featureId, ver: p.featureVersion }))?.feature;
    const facts = { policy: Object.fromEntries(['policyId', 'revision', 'contentHash', 'featureId', 'featureVersion', 'flagKey'].map((k) => [k, p[k]])), feature: gxFeatureFacts(feature), compliance: { rules: [], market: 'KR', cal: null, at: now }, flagCode: { connected: false, row: { flagKey: p.flagKey, featureId: p.featureId, version: p.featureVersion, findings: [], waiver: null } }, ads: { settings: [], profile: null, classification: null, sets: [], baselines: [], fClass: null, enforced: false, vehicles: [] } };
    const payload = { schema: GX_SOURCE_SCHEMA, observedAt: now, validUntil: new Date(Date.now() + 86400_000).toISOString(), sourceRevision: hash(facts), ...facts };
    return { payload, signature: signature(payload) };
  }
  if (original?.gates && Array.isArray(original.gates)) {
    const value = structuredClone(original);
    for (const row of value.gates.filter((g: any) => g.latest)) {
      const r = row.latest, feature = load(rel('featureDetail', { id: r.featureId, ver: r.featureVersion }))?.feature;
      const payload = decisionPayload(r, { id: 'fixture-judge', role: 'GATE_JUDGE' }, 'IMPORT', feature?.baselineId ?? null);
      row.decisionRecord = { payload, signature: signature(payload), signedAt: r.judgedAt };
    }
    return value;
  }
  return original;
}
