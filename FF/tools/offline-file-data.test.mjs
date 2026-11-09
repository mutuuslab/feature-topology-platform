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

function supplement(f) {
  const directory=join(f.root,'cost-supplement');mkdirSync(directory);
  const path='cost_references_CH-BRK-009.json',value=Buffer.from('{"refId":"CH-BRK-009","source":"workbook-reference"}'),sha256=hash(value);
  writeFileSync(join(directory,path),value);
  const metadata={schema:'ff.cost.offline.references/1',sourceCommit:'c'.repeat(40),sourceDirty:false,sourceWorkbookSha256:'d'.repeat(64),supplementalTreeSha256:hash(path+'\0'+sha256+'\n'),files:1,records:[{path,bytes:value.length,sha256,referenceSha256:'e'.repeat(64)}],containsSupplierQuotes:false,containsParticipantOriginalFiles:false,originalCaptureFilesChanged:0};
  return {directory,metadata,path,value};
}
test('adds separately verified cost references without changing original capture bytes or its aggregate',t=>{
 const f=setup(t),original=Buffer.from('{"signature":"preserved-native-signature"}');writeFileSync(join(f.snapshot,'signed.json'),original);
 const originalTree=hash('signed.json\0'+hash(original)+'\n'),s=supplement(f);
 const result=buildOfflineData({...f.options,captureManifest:{...f.options.captureManifest,aggregateSha256:originalTree},supplementalDir:s.directory,supplementalManifest:s.metadata}),a=archive(f.out);
 assert.equal(result.stats.snapshotAggregateSha256,originalTree);assert.equal(result.stats.snapshotFiles,1);assert.equal(result.stats.supplementalFiles,1);
 assert.deepEqual(a.read('api-snapshot/signed.json'),original);assert.deepEqual(a.read('api-snapshot/'+s.path),s.value);assert.equal(a.manifest.supplementalMetadata.sourceWorkbookSha256,s.metadata.sourceWorkbookSha256);
 const first=a.manifest.id;buildOfflineData({...f.options,frontendSourceCommit:'f'.repeat(40),supplementalDir:s.directory,supplementalManifest:s.metadata});assert.notEqual(archive(f.out).manifest.id,first);
 assert.deepEqual(readFileSync(join(f.snapshot,'signed.json')),original);
});
test('refuses altered or private supplemental provenance and any shadowing of the original snapshot',t=>{
 const f=setup(t),s=supplement(f),opts={...f.options,supplementalDir:s.directory,supplementalManifest:s.metadata};
 assert.throws(()=>buildOfflineData({...opts,supplementalManifest:{...s.metadata,containsSupplierQuotes:true}}),/provenance/);
 assert.throws(()=>buildOfflineData({...opts,supplementalManifest:{...s.metadata,supplementalTreeSha256:'0'.repeat(64)}}),/tree hash/);
 writeFileSync(join(s.directory,s.path),'modified');assert.throws(()=>buildOfflineData(opts),/bytes differ/);
 writeFileSync(join(s.directory,s.path),s.value);writeFileSync(join(f.snapshot,s.path),s.value);assert.throws(()=>buildOfflineData(opts),/shadows an original/);
 assert.deepEqual(readFileSync(join(f.snapshot,s.path)),s.value);
});
