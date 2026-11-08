Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { createHash, verify } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { GX_SOURCE_SCHEMA, jcs } from '@ff/contracts';
import { bootApp } from '../helpers';

afterAll(() => { delete process.env.FF_SCHEDULER; });
it('GET supplies actual domain-separated signed public facts and raw Gate decisions without changing native approval or policy', async () => {
  const { app, http } = await bootApp({ at: '2026-11-09T00:00:00.000Z' });
  try {
    const before = (await http().get('/api/policies/POL-00001').expect(200)).body;
    const source = (await http().get('/api/policies/POL-00001/exception-sources').expect(200)).body;
    expect(source.payload).toMatchObject({ schema: GX_SOURCE_SCHEMA, observedAt: '2026-11-09T00:00:00.000Z', validUntil: '2026-11-10T00:00:00.000Z', policy: { policyId: 'POL-00001', revision: before.policy.revision, contentHash: before.policy.contentHash } });
    const { schema, observedAt, validUntil, sourceRevision, ...facts } = source.payload;
    expect(sourceRevision).toBe('sha256:' + createHash('sha256').update(jcs(facts)).digest('hex'));
    const keys = (await http().get('/api/pki/keys').expect(200)).body.items;
    const key = keys.find((k: any) => k.keyId === source.signature.kid);
    expect(key.purpose).toBe('gate');
    expect(verify(null, Buffer.from(jcs(source.payload)), key.publicKeyPem, Buffer.from(source.signature.value, 'base64url'))).toBe(true);
    expect(verify(null, Buffer.from(jcs({ ...source.payload, schema: 'ffp-gate-decision/1' })), key.publicKeyPem, Buffer.from(source.signature.value, 'base64url'))).toBe(false);
    const gates = (await http().get(`/api/features/${before.policy.featureId}/versions/${before.policy.featureVersion}/gates`).expect(200)).body.gates;
    expect(gates.length).toBe(9);
    for (const g of gates.filter((g: any) => g.latest)) {
      expect(g.decisionRecord.payload).toMatchObject({ schema: 'ffp-gate-decision/1', gateRecordId: g.latest.gateRecordId });
      const signingKey = keys.find((k: any) => k.keyId === g.decisionRecord.signature.kid);
      expect(verify(null, Buffer.from(jcs(g.decisionRecord.payload)), signingKey.publicKeyPem, Buffer.from(g.decisionRecord.signature.value, 'base64url'))).toBe(true);
    }
    expect((await http().get('/api/policies/POL-00001').expect(200)).body.policy).toEqual(before.policy);
    await http().get('/api/policies/POL-99999/exception-sources').expect(404);
  } finally { await app.close(); }
});
