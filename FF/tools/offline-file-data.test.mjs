import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildOfflineData } from './offline-file-data.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
function setup(t) {
  const base = realpathSync(tmpdir()), root = mkdtempSync(join(base, 'ff-file-data-'));
  assert.equal(dirname(root), base); t.after(() => { assert.equal(dirname(root), base); rmSync(root, { recursive: true, force: true }); });
  const dirs = Object.fromEntries(['snapshot', 'public', 'ui', 'out'].map((k) => { const path = join(root, k); mkdirSync(path); return [k, path]; }));
  return { root, ...dirs, options: { snapshotDir: dirs.snapshot, publicDir: dirs.public, uiDir: dirs.ui, outDir: dirs.out, captureManifest: { referenceTime: '2026-11-09T00:56:54.995Z', applicationSourceCommit: 'a'.repeat(40), originalSignaturesPreserved: true }, frontendSourceCommit: 'b'.repeat(40) } };
}
function archive(out) {
  const parts = new Map(), context = { __FF_OFFLINE_REGISTER__: (id, values) => parts.set(id, values) };
  runInNewContext(readFileSync(join(out, 'offline-manifest.js'), 'utf8'), context);
  const manifest = context.__FF_OFFLINE_MANIFEST__;
  for (const [id, file] of Object.entries(manifest.chunks)) { const code = readFileSync(join(out, file)); assert.ok(code.length <= 1024 * 1024); runInNewContext(code.toString(), context); assert.ok(parts.has(id)); }
  const read = (path) => { const b = manifest.blobs[manifest.paths[path]], data = Buffer.concat(b.parts.map((p) => Buffer.from(parts.get(p.chunk)[p.key], 'base64'))); assert.equal(data.length, b.bytes); assert.equal(hash(data), b.sha256); return data; };
  return { manifest, read };
}
test('round-trips signed UTF-8 and binary bytes, MIME-aware dedup, multipart shards, eager workers and physical boot files', (t) => {
  const f = setup(t), signed = Buffer.from(JSON.stringify({ signature: 'original-signature', observedAt: '2026-11-09T00:00:00Z', content: '한글 원문' }));
  writeFileSync(join(f.snapshot, 'signed.json'), signed); writeFileSync(join(f.public, 'one.bin'), Buffer.from([0, 255, 1])); writeFileSync(join(f.public, 'two.bin'), Buffer.from([0, 255, 1])); writeFileSync(join(f.public, 'same.txt'), Buffer.from([0, 255, 1]));
  const big = Buffer.alloc(1_350_000); for (let i = 0; i < big.length; i++) big[i] = i % 251; writeFileSync(join(f.ui, 'large.wasm'), big);
  mkdirSync(join(f.public, 'map')); writeFileSync(join(f.public, 'map/world-land.geojson'), '{"type":"FeatureCollection","features":[]}');
  writeFileSync(join(f.public, 'sample-worker.mjs'), 'self.onmessage=()=>{};'); writeFileSync(join(f.ui, 'sample-worker.mjs'), 'self.onmessage=()=>{};');
  writeFileSync(join(f.public, '_headers'), 'must not archive'); writeFileSync(join(f.public, '_redirects'), 'must not archive');
  for (const file of ['boot-check.js', 'recovery.html', 'recovery.js']) writeFileSync(join(f.public, file), 'original ' + file);
  writeFileSync(join(f.out, 'index.html'), 'keep owned shell');
  const result = buildOfflineData(f.options), a = archive(f.out);
  assert.equal(a.manifest.schema, 'ff.offline.file/1'); assert.equal(a.manifest.referenceTime, f.options.captureManifest.referenceTime);
  assert.deepEqual(a.read('api-snapshot/signed.json'), signed); assert.deepEqual(a.read('large.wasm'), big);
  assert.equal(a.manifest.paths['one.bin'], a.manifest.paths['two.bin']); assert.notEqual(a.manifest.paths['one.bin'], a.manifest.paths['same.txt']);
  assert.ok(a.manifest.blobs[a.manifest.paths['large.wasm']].parts.length >= 3);
  assert.ok(a.manifest.eager.includes(a.manifest.paths['map/world-land.geojson'])); assert.ok(a.manifest.eager.includes(a.manifest.paths['sample-worker.mjs']));
  assert.equal(a.manifest.paths._headers, undefined); assert.equal(a.manifest.paths._redirects, undefined);
  assert.equal(existsSync(join(f.out, 'api-snapshot')), false); assert.equal(readFileSync(join(f.out, 'index.html'), 'utf8'), 'keep owned shell');
  for (const file of ['boot-check.js', 'recovery.html', 'recovery.js']) assert.equal(readFileSync(join(f.out, file), 'utf8'), 'original ' + file);
  assert.ok(result.stats.uniqueContentBytes < result.stats.originalBytes); assert.deepEqual(readFileSync(join(f.snapshot, 'signed.json')), signed);
});
test('is deterministic and removes only stale owned shard files on rerun', (t) => {
  const f = setup(t); writeFileSync(join(f.snapshot, 'one.json'), '{"value":1}'); buildOfflineData(f.options);
  const before = readFileSync(join(f.out, 'offline-manifest.js')); writeFileSync(join(f.out, 'data/part99999.js'), 'stale'); writeFileSync(join(f.out, 'data/owned.txt'), 'preserve');
  buildOfflineData(f.options); assert.deepEqual(readFileSync(join(f.out, 'offline-manifest.js')), before); assert.equal(existsSync(join(f.out, 'data/part99999.js')), false); assert.equal(readFileSync(join(f.out, 'data/owned.txt'), 'utf8'), 'preserve');
});
test('does not recursively ingest its own data/archive results when UI and output share a directory', (t) => {
  const f = setup(t); writeFileSync(join(f.out, 'app.js'), 'console.log(1)'); mkdirSync(join(f.out, 'archive')); writeFileSync(join(f.out, 'archive/old.js'), 'old'); writeFileSync(join(f.out, 'previous.zip'), 'archive');
  const opts = { ...f.options, uiDir: f.out }; buildOfflineData(opts); const before = readFileSync(join(f.out, 'offline-manifest.js')); buildOfflineData(opts);
  const a = archive(f.out); assert.equal(a.manifest.paths['archive/old.js'], undefined); assert.equal(a.manifest.paths['previous.zip'], undefined); assert.equal(a.manifest.paths['offline-manifest.js'], undefined); assert.deepEqual(readFileSync(join(f.out, 'offline-manifest.js')), before);
});
test('refuses source/output symlink escapes and refuses output inside immutable input before creating it', (t) => {
  const f = setup(t), external = join(f.root, 'external'); mkdirSync(external); writeFileSync(join(external, 'keep'), 'unchanged');
  symlinkSync(external, join(f.snapshot, 'escape'), 'junction'); assert.throws(() => buildOfflineData(f.options), /symlink/); rmdirSync(join(f.snapshot, 'escape'));
  const nested = join(f.public, 'new-output'); assert.throws(() => buildOfflineData({ ...f.options, outDir: nested }), /inside/); assert.equal(existsSync(nested), false);
  symlinkSync(external, join(f.out, 'offline-manifest.js'), 'junction'); assert.throws(() => buildOfflineData(f.options), /unsafe output/); assert.equal(readFileSync(join(external, 'keep'), 'utf8'), 'unchanged');
});
test('rejects conflicting paths and mismatched capture hashes without rewriting source records', (t) => {
  const f = setup(t); writeFileSync(join(f.snapshot, 'one.json'), 'original'); writeFileSync(join(f.public, 'same.js'), 'one'); writeFileSync(join(f.ui, 'same.js'), 'two');
  assert.throws(() => buildOfflineData(f.options), /conflicting logical path/); rmSync(join(f.ui, 'same.js'));
  assert.throws(() => buildOfflineData({ ...f.options, captureManifest: { ...f.options.captureManifest, aggregateSha256: '0'.repeat(64) } }), /differs from capture/);
  assert.equal(readFileSync(join(f.snapshot, 'one.json'), 'utf8'), 'original');
});
