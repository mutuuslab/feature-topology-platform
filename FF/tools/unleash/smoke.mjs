// Actual running-stack check. Reads private local connection data; prints only assertions, never credentials.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonicalJson, SignedUnleashCache } from '../../contracts/dist/index.js';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const { signVehicleRequest, vehicleKeyFromRoot } = require('../../backend/dist/kernel/vehicle-auth-client.js');
const data = resolve(process.env.FF_RUNTIME_DATA ?? '.unleash-runtime');
const env = JSON.parse(readFileSync(resolve(data, 'connection.json'), 'utf8'));
const status = JSON.parse(readFileSync(resolve(data, 'status.json'), 'utf8'));
const base = `http://127.0.0.1:${status.ports.ff}`;
const get = async (path) => { const r = await fetch(base + path, { signal: AbortSignal.timeout(10000) }); assert.equal(r.status, 200, path); return r.json(); };
assert.equal((await get('/api/health')).status, 'ok');
assert.equal((await get('/api/unleash/status')).version, '8.3.1');
assert.equal((await get('/api/unleash/status')).mode, 'live');
const db = new Client({ connectionString: env.FF_DB_URL, connectionTimeoutMillis: 5000 });
await db.connect();
try {
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'feature_platform');
  assert.ok((await db.query('SELECT count(*) AS count FROM schema_migrations')).rows[0].count > 0);
} finally { await db.end(); }
const foreignUrl = new URL(env.FF_DB_URL); foreignUrl.pathname = '/unleash';
const foreign = new Client({ connectionString: foreignUrl.toString(), connectionTimeoutMillis: 5000 });
try { await assert.rejects(() => foreign.connect(), (error) => error.code === '42501'); } finally { await foreign.end(); }
const policies = (await get('/api/policies?status=DEPLOYED')).items;
assert.ok(policies.length > 0, 'Seed or customer deployed policies required for the vehicle smoke check');
for (const p of policies) { const v = await get(`/api/policies/${p.policyId}/unleash`); assert.ok(v.plan.ready); assert.deepEqual(v.drift, []); }
const vin = process.env.FF_SMOKE_VIN ?? 'ego-01', path = `/vehicle/v1/${vin}/signed-flags`, text = '{}';
const now = process.env.FF_CLOCK_AT ? Date.parse(process.env.FF_CLOCK_AT) : Date.now();
const headers = signVehicleRequest({ vin, epoch: 1, vehicleKey: vehicleKeyFromRoot(Buffer.from(env.FF_HSM_VEHICLE_ROOT, 'base64'), 1, vin), method: 'POST', path, body: text, now });
let response;
for (let i = 0; i < 30; i++) {
  response = await fetch(base + path, { method: 'POST', headers: { ...headers, ...signVehicleRequest({ vin, epoch: 1, vehicleKey: vehicleKeyFromRoot(Buffer.from(env.FF_HSM_VEHICLE_ROOT, 'base64'), 1, vin), method: 'POST', path, body: text, now }), 'Content-Type': 'application/json' }, body: text, signal: AbortSignal.timeout(10000) });
  if (response.ok) break;
  const err = await response.json(); if (err.error?.details?.code !== 'EDGE_DRIFT') throw new Error(`Vehicle smoke failed: HTTP ${response.status}, ${err.error?.details?.code ?? err.error?.code}`);
  await new Promise((r) => setTimeout(r, 200));
}
assert.equal(response.status, 200);
const signed = await response.json();
const key = (await get('/api/pki/keys')).items.find((k) => k.keyId === signed.signature.kid);
assert.equal(key.purpose, 'activate');
const cache = new SignedUnleashCache(vin, (canonical, s) => s.kid === key.keyId && verify(null, Buffer.from(canonical), key.publicKeyPem, Buffer.from(s.value, 'base64url')));
assert.ok(cache.accept(signed, now).accepted);
assert.equal(cache.resolve(signed.payload.flags[0].flagKey, Date.parse(signed.payload.expiresAt)).value, false);
const proof = { checkedAt: new Date().toISOString(), result: 'PASS', ffDatabase: 'feature_platform', server: '8.3.1', edge: '20.6.0', postgres: '18.3', deployedPolicies: policies.length, vehicleAuthentication: 'CMAC', signature: 'Ed25519 activate-purpose; provisioned public key', snapshotTtlMs: Date.parse(signed.payload.expiresAt) - Date.parse(signed.payload.issuedAt), expired: 'SAFE_OFF' };
writeFileSync(resolve(data, 'live-proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
