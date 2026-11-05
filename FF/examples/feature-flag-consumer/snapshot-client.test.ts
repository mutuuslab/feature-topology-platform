import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { canonicalJson, SignedUnleashCache, type SignedUnleashSnapshot } from '@ff/contracts';
import { distanceDecision } from './distance.ts';
import { infotainmentDecision } from './infotainment.ts';
import { SnapshotFlagClient, type LocalGuardResolver } from './snapshot-client.ts';

const START = Date.parse('2026-11-05T00:00:00.000Z'), VIN = 'VIRTUAL-VEHICLE-001';
const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const SIGNING_KID = 'example-activate-key';
const OFF = { detail: false, banner: false, voice: false, guide: false };
const BASE = { mode: 'BASE_CONTROL', warning: false, parameterEnabled: false };

function envelope(vin = VIN): SignedUnleashSnapshot {
  const flag = (flagKey: string, value: boolean, fClass: 'F1' | 'F2') => ({ flagKey, value, featureId: flagKey.startsWith('care_') ? 'FEAT-00022' : 'FEAT-00027', policyId: 'POL-example', revision: 1, contentHash: 'sha256:example-policy', fClass, guardRequired: fClass === 'F2', reason: value ? 'TARGETING_MATCH' : 'UNLEASH_DISABLED' });
  const payload: SignedUnleashSnapshot['payload'] = { schema: 'FF-UNLEASH-SNAPSHOT/1', source: 'UNLEASH_EDGE', vin, sequence: 1, issuedAt: new Date(START).toISOString(), expiresAt: new Date(START + 60000).toISOString(), flags: [
    flag('care_00022_signal', true, 'F2'), flag('care_00022_param', true, 'F2'),
    flag('ivi_00027_detail', false, 'F1'), flag('ivi_00027_banner', true, 'F1'), flag('ivi_00027_voice', true, 'F1'), flag('ivi_00024_guide', false, 'F1'),
  ] };
  return { payload, signature: { alg: 'EdDSA', kid: SIGNING_KID, value: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64url') } };
}

function vehicle(purpose: 'activate' | 'policy' = 'activate') {
  let now = START;
  // This trust map is provisioned separately; it never comes from an evaluation response.
  const trusted = new Map([[SIGNING_KID, { purpose, publicKeyPem, notAfter: START + 86400000 }]]);
  const cache = new SignedUnleashCache(VIN, (canonical, signature) => {
    const key = trusted.get(signature.kid);
    return signature.alg === 'EdDSA' && !!key && key.purpose === 'activate' && now < key.notAfter && verify(null, Buffer.from(canonical), key.publicKeyPem, Buffer.from(signature.value, 'base64url'));
  });
  const client = (guard?: LocalGuardResolver, clock = () => now) => new SnapshotFlagClient(cache, clock, guard);
  return { cache, client, now: () => now, advance: (time: number) => { now = time; } };
}

test('real Ed25519-signed Edge envelope feeds actual asynchronous distance and infotainment decisions', async () => {
  const v = vehicle(); assert.equal(v.cache.accept(envelope(), v.now()).accepted, true);
  const client = v.client(() => ({ localGuardAllows: true }));
  assert.deepEqual(await distanceDecision(client, VIN, 10), { mode: 'FEATURE', warning: true, parameterEnabled: true });
  assert.deepEqual(await infotainmentDecision(client, VIN), { detail: false, banner: true, voice: true, guide: false });
});

test('Edge true does not infer the F2 Safety Guard; eligible IVI flags remain independent', async () => {
  const v = vehicle(); v.cache.accept(envelope(), v.now());
  assert.deepEqual(await distanceDecision(v.client(), VIN, 5), BASE);
  assert.deepEqual(await infotainmentDecision(v.client(), VIN), { detail: false, banner: true, voice: true, guide: false });
});

test('local kill overrides the signed ON without changing unrelated IVI flags', async () => {
  const v = vehicle(); v.cache.accept(envelope(), v.now());
  const killed = new Set(['care_00022_signal', 'ivi_00027_banner']);
  const client = v.client((key, vin) => { assert.equal(vin, VIN); return { localGuardAllows: true, killed: killed.has(key) }; });
  assert.deepEqual(await distanceDecision(client, VIN, 5), BASE);
  assert.deepEqual(await infotainmentDecision(client, VIN), { detail: false, banner: false, voice: true, guide: false });
});

test('wrong context VIN is false before a local Guard is consulted; foreign signed VIN is rejected', async () => {
  const v = vehicle(); assert.equal(v.cache.accept(envelope('OTHER-VIN'), v.now()).reason, 'VIN');
  v.cache.accept(envelope(), v.now()); let consulted = 0;
  const client = v.client(() => { consulted++; return { localGuardAllows: true }; });
  assert.deepEqual(await distanceDecision(client, 'OTHER-VIN', 5), BASE);
  assert.deepEqual(await infotainmentDecision(client, 'OTHER-VIN'), OFF); assert.equal(consulted, 0);
});

test('last verified snapshot works offline within TTL and both consumers switch off exactly at expiry', async () => {
  const v = vehicle(); const signed = envelope(); v.cache.accept(signed, v.now());
  const client = v.client(() => ({ localGuardAllows: true }));
  v.advance(START + 59999); assert.equal((await distanceDecision(client, VIN, 10)).mode, 'FEATURE');
  v.advance(START + 60000); assert.deepEqual(await distanceDecision(client, VIN, 10), BASE); assert.deepEqual(await infotainmentDecision(client, VIN), OFF);
  assert.equal(v.cache.accept(signed, v.now()).reason, 'TTL');
});

test('wrong-purpose trust, tampered signatures, clock failure and Guard failure cannot activate either consumer', async () => {
  const wrongPurpose = vehicle('policy'); assert.equal(wrongPurpose.cache.accept(envelope(), wrongPurpose.now()).reason, 'SIGNATURE');
  assert.deepEqual(await distanceDecision(wrongPurpose.client(), VIN, 5), BASE); assert.deepEqual(await infotainmentDecision(wrongPurpose.client(), VIN), OFF);
  const v = vehicle(), bad = envelope(); bad.payload.flags[0].value = false;
  assert.equal(v.cache.accept(bad, v.now()).reason, 'SIGNATURE'); assert.deepEqual(await infotainmentDecision(v.client(), VIN), OFF);
  v.cache.accept(envelope(), v.now());
  const brokenGuard = v.client(() => { throw new Error('Guard unavailable'); });
  assert.deepEqual(await distanceDecision(brokenGuard, VIN, 5), BASE); assert.deepEqual(await infotainmentDecision(brokenGuard, VIN), OFF);
  const brokenClock = v.client(() => ({ localGuardAllows: true }), () => { throw new Error('Clock unavailable'); });
  assert.deepEqual(await distanceDecision(brokenClock, VIN, 5), BASE); assert.deepEqual(await infotainmentDecision(brokenClock, VIN), OFF);
});

test('expiry while awaiting an asynchronous local Guard still switches the control off', async () => {
  const v = vehicle(); v.cache.accept(envelope(), v.now());
  const client = v.client(async () => { await Promise.resolve(); v.advance(START + 60000); return { localGuardAllows: true }; });
  assert.deepEqual(await distanceDecision(client, VIN, 5), BASE);
});
