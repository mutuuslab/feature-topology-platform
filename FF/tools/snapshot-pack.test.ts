import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { PACK_INDEX, packetFile } from './snapshot-pack-format.ts';
import { hash, logicalFile, packArtifact, packedLogicalFiles, physicalFiles } from './snapshot-pack.ts';
import { onRequest } from '../functions/api-snapshot/[[path]].ts';
import { handle, signToken, COOKIE } from '../functions/_middleware.ts';
import { compare, scanSource } from './snapshot-coverage.ts';
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ff-snapshot-pack-')); roots.push(root);
  const dist = join(root, 'dist'), api = join(dist, 'api-snapshot'); mkdirSync(api, { recursive: true });
  const json = (file: string, value: unknown) => writeFileSync(join(api, file), JSON.stringify(value));
  json(logicalFile('vehicles'), { items: [{ vin: 'ego-01' }] });
  json(logicalFile('listProducts'), { items: [{ catalogId: 'CAT-00001' }, { catalogId: 'CAT-00002' }] });
  json(logicalFile('listPolicies'), { items: [{ flagKey: 'flag_a', status: 'DEPLOYED' }, { flagKey: 'flag_b', status: 'DEPLOYED' }] });
  const files = [logicalFile('vehicleEligibility', { vin: 'ego-01' }, { catalogId: 'CAT-00001' }), logicalFile('vehicleEligibility', { vin: 'ego-01' }, { catalogId: 'CAT-00002' }), logicalFile('activationDecide', {}, { vin: 'ego-01', flagKey: 'flag_a' }), logicalFile('activationDecide', {}, { vin: 'ego-01', flagKey: 'flag_b' })];
  const originals = new Map(files.map((file, i) => [file, ` { "한글": "원문 ${i}", "value": ${i}, "quoted": "a\\nb" }\n`]));
  for (const [file, body] of originals) writeFileSync(join(api, file), body);
  json('unrelated.json', { keep: true }); writeFileSync(join(dist, 'index.html'), '<html>keep</html>');
  return { root, dist, api, files, originals };
}
afterEach(() => { for (const root of roots.splice(0)) { const abs = resolve(root); assert.ok(abs.startsWith(resolve(tmpdir()) + sep) && basename(abs).startsWith('ff-snapshot-pack-')); rmSync(abs, { recursive: true, force: true }); } });
const assets = (api: string, calls: string[]) => ({ fetch: async (request: Request) => { const url = new URL(request.url); calls.push(url.href); assert.equal(url.search, ''); assert.match(url.pathname, /^\/api-snapshot\/vehicle-query-packets\/[0-9a-f]{64}\.json$/); assert.equal(request.headers.get('Cookie'), null); const file = join(api, url.pathname.slice('/api-snapshot/'.length)); return existsSync(file) ? new Response(readFileSync(file, 'utf8'), { headers: { 'Content-Type': 'application/json' } }) : new Response(null, { status: 404 }); } });
test('VIN packets preserve every original UTF-8 byte, retain unrelated files, and are idempotent', () => {
  const f = fixture(), before = physicalFiles(f.dist), report = packArtifact(f.dist);
  assert.equal(report.logical, 4); assert.equal(report.after, before - 4 + 2);
  assert.deepEqual(packedLogicalFiles(f.api).sort(), f.files.sort());
  const packet = JSON.parse(readFileSync(join(f.api, packetFile(hash('ego-01'))), 'utf8'));
  for (const [file, body] of f.originals) { assert.equal(existsSync(join(f.api, file)), false); assert.equal(packet.responses[file].body, body); }
  assert.deepEqual(JSON.parse(readFileSync(join(f.api, 'unrelated.json'), 'utf8')), { keep: true });
  assert.equal(packArtifact(f.dist).idempotent, true);
});
test('missing input fails before any other original can be removed', () => {
  const f = fixture(); unlinkSync(join(f.api, f.files[1]));
  assert.throws(() => packArtifact(f.dist));
  assert.equal(existsSync(join(f.api, PACK_INDEX)), false);
  for (const file of f.files.filter((_, i) => i !== 1)) assert.equal(existsSync(join(f.api, file)), true);
});
test('coverage matches the original vehicle query URL after its physical file is packed', () => {
  const f = fixture(); packArtifact(f.dist);
  const routes = new Map([['vehicleEligibility', { name: 'vehicleEligibility', method: 'GET', path: '/api/vehicles/:vin/eligibility' }]]);
  const sites = scanSource('screen.tsx', "useApi('vehicleEligibility', { params: { vin: 'ego-01' }, query: { catalogId: 'CAT-00001' } })", routes);
  assert.equal(compare(sites, routes, [], new Set<string>()).gaps.length, 1);
  assert.equal(compare(sites, routes, packedLogicalFiles(f.api).map((s) => s.slice(0, -5)), new Set<string>()).gaps.length, 0);
});
test('coverage rejects corrupt packets and index paths before accepting logical files', () => {
  const f = fixture(); packArtifact(f.dist);
  const path = join(f.api, packetFile(hash('ego-01'))), original = readFileSync(path, 'utf8');
  writeFileSync(path, original + ' '); assert.throws(() => packedLogicalFiles(f.api), /integrity/); writeFileSync(path, original);
  const index = JSON.parse(readFileSync(join(f.api, PACK_INDEX), 'utf8')); index.packets[0].file = '../../outside.json'; writeFileSync(join(f.api, PACK_INDEX), JSON.stringify(index));
  assert.throws(() => packedLogicalFiles(f.api), /packet path/);
});
test('resolver GET returns exact original strings and HEAD preserves their UTF-8 length', async () => {
  const f = fixture(); packArtifact(f.dist); const calls: string[] = [], env = { ASSETS: assets(f.api, calls) };
  for (const [file, body] of f.originals) {
    const response = await onRequest({ request: new Request(`https://artifact.test/api-snapshot/${file}`), env, next: async () => new Response(null, { status: 404 }) });
    assert.equal(response.status, 200); assert.equal(await response.text(), body);
    const head = await onRequest({ request: new Request(`https://artifact.test/api-snapshot/${file}`, { method: 'HEAD' }), env, next: async () => new Response(null, { status: 404 }) });
    assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(head.headers.get('Content-Length'), String(Buffer.byteLength(body)));
  }
  assert.equal(calls.length, 8);
});
test('root gate runs before packet reads and preserves private caching after authentication', async () => {
  const f = fixture(); packArtifact(f.dist); const calls: string[] = [], env = { FF_GATE_SECRET: 'unit-fixture-gate-key-only-32-chars', ASSETS: assets(f.api, calls) };
  const url = `https://artifact.test/api-snapshot/${f.files[0]}`;
  const request = new Request(url);
  const denied = await handle(request, env, () => onRequest({ request, env, next: async () => new Response(null, { status: 404 }) }));
  assert.equal(denied.status, 401); assert.equal(calls.length, 0);
  const allowedRequest = new Request(url, { headers: { Cookie: `${COOKIE}=${await signToken(env.FF_GATE_SECRET, Date.now())}` } });
  const allowed = await handle(allowedRequest, env, () => onRequest({ request: allowedRequest, env, next: async () => new Response(null, { status: 404 }) }));
  assert.equal(allowed.status, 200); assert.match(allowed.headers.get('Cache-Control') ?? '', /private/);
});
test('unknown entries are404; upstream and corrupt data close without returning accepted data', async () => {
  const f = fixture(); packArtifact(f.dist); const calls: string[] = [], env = { ASSETS: assets(f.api, calls) };
  const run = (file: string, binding = env) => onRequest({ request: new Request(`https://artifact.test/api-snapshot/${file}`), env: binding, next: async () => new Response(null, { status: 404 }) });
  assert.equal((await run(logicalFile('activationDecide', {}, { vin: 'ego-01', flagKey: 'missing' }))).status, 404);
  assert.equal((await run(logicalFile('activationDecide', {}, { vin: 'unknown', flagKey: 'flag_a' }))).status, 404);
  const upstream = await run(f.files[0], { ASSETS: { fetch: async () => new Response('internal diagnostic', { status: 503 }) } });
  assert.equal(upstream.status, 502); assert.doesNotMatch(await upstream.text(), /internal diagnostic/);
  const path = join(f.api, packetFile(hash('ego-01'))), p = JSON.parse(readFileSync(path, 'utf8')); p.responses[f.files[0]].body = '{}'; writeFileSync(path, JSON.stringify(p));
  assert.equal((await run(f.files[0])).status, 502);
});
test('unrelated paths pass through; encoded traversal cannot select assets and writes are405', async () => {
  const f = fixture(); packArtifact(f.dist); const calls: string[] = [], env = { ASSETS: assets(f.api, calls) }; let next = 0;
  for (const path of ['/api-snapshot/accounts.json', '/api-snapshotx/activation_decide_vin_ego-01_flagKey_flag_a.json']) {
    const r = await onRequest({ request: new Request('https://artifact.test' + path), env, next: async () => { next++; return new Response('pass'); } }); assert.equal(await r.text(), 'pass');
  }
  const malformed = await onRequest({ request: new Request('https://artifact.test/api-snapshot/vehicles_%2f.._eligibility_catalogId_CAT-00001.json'), env, next: async () => new Response('pass') });
  assert.equal(malformed.status, 404); assert.equal(next, 2); assert.equal(calls.length, 0);
  const r = await onRequest({ request: new Request(`https://artifact.test/api-snapshot/${f.files[0]}`, { method: 'POST' }), env, next: async () => new Response('pass') });
  assert.equal(r.status, 405); assert.equal(calls.length, 0);
});
