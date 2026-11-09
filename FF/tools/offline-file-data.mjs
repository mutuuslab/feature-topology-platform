// Read-only source archive for a file:// shell. This does not run, approve or re-sign native data.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARD_LIMIT = 1024 * 1024;
const PART_BYTES = 512 * 1024;
const EAGER_LIMIT = 8 * 1024 * 1024;
const BOOT_FILES = ['boot-check.js', 'recovery.html', 'recovery.js'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(`offline-file-data: ${message}`); };
const posix = (name) => name.split(sep).join('/');
const within = (root, file) => { const rel = relative(root, file); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };

function directory(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is required`);
  const path = resolve(value);
  if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) fail(`${label} must be a real directory`);
  return realpathSync(path);
}
function regular(file, root) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || !within(root, realpathSync(file))) fail(`unsafe input file: ${file}`);
}
function outputDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) fail('outDir is required');
  const path = resolve(value);
  let ancestor = path;
  while (!existsSync(ancestor)) { const next = resolve(ancestor, '..'); if (next === ancestor) fail('output has no real ancestor'); ancestor = next; }
  // Junctions in the output ancestry must not redirect writes to an input or outside the named target.
  for (let part = ancestor; ; part = resolve(part, '..')) {
    if (lstatSync(part).isSymbolicLink()) fail('output ancestry contains a symlink');
    const parent = resolve(part, '..'); if (parent === part) break;
  }
  mkdirSync(path, { recursive: true });
  return directory(path, 'outDir');
}
function listFiles(root, skip = () => false) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.' || entry.name === '..' || /[\\/\0]/.test(entry.name)) fail('invalid input name');
      const file = join(dir, entry.name), rel = posix(relative(root, file));
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) fail(`symlink input refused: ${rel}`);
      if (!within(root, realpathSync(file))) fail(`input leaves source root: ${rel}`);
      if (skip(rel, file, stat.isDirectory())) continue;
      if (stat.isDirectory()) walk(file);
      else { if (!stat.isFile()) fail(`non-regular input: ${rel}`); files.push({ file, rel }); }
    }
  };
  walk(root);
  return files.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}
function mimeOf(file) {
  return ({ '.json': 'application/json', '.geojson': 'application/geo+json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.txt': 'text/plain', '.csv': 'text/csv', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.pdf': 'application/pdf', '.map': 'application/json', '.gz': 'application/gzip', '.zip': 'application/zip' })[extname(file).toLowerCase()] ?? 'application/octet-stream';
}
function captureOf(value) {
  let result = value;
  if (typeof value === 'string') { const file = resolve(value); regular(file, realpathSync(resolve(file, '..'))); result = JSON.parse(readFileSync(file, 'utf8').replace(/^\ufeff/, '')); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('captureManifest must be an object or JSON file');
  const referenceTime = result.referenceTime ?? result.captureEndedAt ?? result.capturedAt;
  if (typeof referenceTime !== 'string' || !Number.isFinite(Date.parse(referenceTime))) fail('capture manifest has no valid reference time');
  return { metadata: result, referenceTime };
}

export function buildOfflineData({ snapshotDir, publicDir, uiDir, outDir, captureManifest, frontendSourceCommit }) {
  const snapshot = directory(snapshotDir, 'snapshotDir'), pub = directory(publicDir, 'publicDir'), ui = directory(uiDir, 'uiDir');
  if (typeof outDir !== 'string' || !outDir.trim()) fail('outDir is required');
  if (within(snapshot, resolve(outDir)) || within(pub, resolve(outDir))) fail('output must not be inside snapshot/public inputs');
  const out = outputDirectory(outDir);
  if (within(snapshot, out) || within(pub, out)) fail('output must not be inside snapshot/public inputs');
  const commit = String(frontendSourceCommit ?? '').trim();
  if (!/^[a-f\d]{7,64}$/i.test(commit)) fail('frontendSourceCommit must be a Git SHA');
  const capture = captureOf(captureManifest);
  const safeOutput = (file) => {
    if (!within(out, resolve(file))) fail('output path leaves target');
    let stat; try { stat = lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) fail('unsafe output file');
  };
  for (const name of ['offline-manifest.js', 'offline-provenance.json', ...BOOT_FILES]) safeOutput(join(out, name));
  const records = [
    ...listFiles(snapshot).map((r) => ({ ...r, root: snapshot, path: 'api-snapshot/' + r.rel, source: 'snapshot' })),
    ...listFiles(pub, (rel) => rel === 'api-snapshot' || rel === '_headers' || rel === '_redirects').map((r) => ({ ...r, root: pub, path: r.rel, source: 'public' })),
    ...listFiles(ui, (rel, file, dir) => {
      const top = rel.split('/')[0];
      return ['data', 'archive', 'api-snapshot'].includes(top) || ['offline-manifest.js', 'offline-provenance.json', '_headers', '_redirects'].includes(rel) || /\.(?:zip|tar|tgz|7z)$/i.test(rel) || (dir && out !== ui && within(out, file));
    }).map((r) => ({ ...r, root: ui, path: r.rel, source: 'ui' })),
  ];
  const dataDir = join(out, 'data');
  if (existsSync(dataDir) && (lstatSync(dataDir).isSymbolicLink() || !lstatSync(dataDir).isDirectory())) fail('unsafe output data directory');
  mkdirSync(dataDir, { recursive: true });
  for (const name of readdirSync(dataDir)) if (/^part\d+\.js$/.test(name)) { const file = join(dataDir, name); regular(file, out); unlinkSync(file); }
  const paths = Object.create(null), chunks = Object.create(null), blobs = [], byContent = new Map(), eager = new Set(), rawTree = createHash('sha256');
  const stats = { inputFilesRead: 0, logicalFiles: 0, originalBytes: 0, uniqueContentBytes: 0, uniqueBlobs: 0, shards: 0, archiveScriptBytes: 0, snapshotFiles: 0, snapshotBytes: 0 };
  let shard = Object.create(null), shardBytes = 0, shardNumber = 0;
  const shardId = () => 'part' + String(shardNumber + 1).padStart(5, '0');
  const flush = () => {
    if (!Object.keys(shard).length) return;
    const id = shardId(), code = `globalThis.__FF_OFFLINE_REGISTER__(${JSON.stringify(id)},${JSON.stringify(shard)});\n`;
    if (Buffer.byteLength(code) > SHARD_LIMIT) fail('internal shard size overflow');
    writeFileSync(join(dataDir, id + '.js'), code);
    chunks[id] = 'data/' + id + '.js'; stats.archiveScriptBytes += Buffer.byteLength(code); shardNumber++; shard = Object.create(null); shardBytes = 0;
  };
  for (const record of records) {
    regular(record.file, record.root);
    const data = readFileSync(record.file), digest = sha(data), mime = mimeOf(record.path), contentKey = mime + ':' + digest;
    stats.inputFilesRead++;
    if (record.source === 'snapshot') { rawTree.update(record.rel + '\0' + digest + '\n'); stats.snapshotFiles++; stats.snapshotBytes += data.length; }
    const prior = paths[record.path];
    if (prior !== undefined) {
      if (blobs[prior].sha256 !== digest || blobs[prior].mime !== mime || blobs[prior].bytes !== data.length) fail(`conflicting logical path: ${record.path}`);
      if (record.source === 'ui' && /worker[^/]*\.(?:m?js)$/i.test(basename(record.path)) && data.length <= EAGER_LIMIT) eager.add(prior);
      continue;
    }
    let id = byContent.get(contentKey);
    if (id === undefined) {
      id = blobs.length; const blob = { sha256: digest, bytes: data.length, mime, parts: [] }; blobs.push(blob); byContent.set(contentKey, id); stats.uniqueContentBytes += data.length;
      for (let offset = 0, part = 0; offset < data.length || part === 0; offset += PART_BYTES, part++) {
        const value = data.subarray(offset, Math.min(data.length, offset + PART_BYTES)).toString('base64'), key = `B${id}.${part}`, size = Buffer.byteLength(JSON.stringify(key) + ':' + JSON.stringify(value)) + 1;
        if (shardBytes && shardBytes + size + 100 > SHARD_LIMIT) flush();
        const chunk = shardId(); shard[key] = value; shardBytes += size; blob.parts.push({ chunk, key });
      }
    }
    paths[record.path] = id; stats.logicalFiles++; stats.originalBytes += data.length;
    if (record.path === 'map/world-land.geojson' || (record.source === 'ui' && /worker[^/]*\.(?:m?js)$/i.test(basename(record.path)) && data.length <= EAGER_LIMIT)) eager.add(id);
  }
  flush();
  stats.uniqueBlobs = blobs.length; stats.shards = shardNumber;
  stats.snapshotAggregateSha256 = rawTree.digest('hex');
  if (capture.metadata.aggregateSha256 && capture.metadata.aggregateSha256 !== stats.snapshotAggregateSha256) fail('snapshot input differs from capture manifest');
  const manifest = { schema: 'ff.offline.file/1', paths, blobs, chunks, eager: [...eager].sort((a, b) => a - b), referenceTime: capture.referenceTime, frontendSourceCommit: commit, captureMetadata: capture.metadata, anchor: { referenceTime: capture.referenceTime, sourceSHA: commit, applicationSourceCommit: capture.metadata.applicationSourceCommit ?? null, captureToolCommit: capture.metadata.captureToolCommit ?? null } };
  // JSON.parse keeps unusual path keys as data rather than object-literal prototype setters.
  writeFileSync(join(out, 'offline-manifest.js'), 'globalThis.__FF_OFFLINE_MANIFEST__=JSON.parse(' + JSON.stringify(JSON.stringify(manifest)) + ');\n');
  const provenance = { schema: manifest.schema, anchor: manifest.anchor, captureMode: capture.metadata.captureMode ?? null, backgroundCallbacksReplayed: capture.metadata.backgroundCallbacksReplayed ?? false, originalSignaturesPreserved: true, stats };
  writeFileSync(join(out, 'offline-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  for (const name of BOOT_FILES) { const source = join(pub, name); if (existsSync(source)) { regular(source, pub); const target = join(out, name); if (existsSync(target) && lstatSync(target).isSymbolicLink()) fail('unsafe boot output'); copyFileSync(source, target); } }
  return { manifest, stats, manifestFile: join(out, 'offline-manifest.js'), provenanceFile: join(out, 'offline-provenance.json') };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const values = Object.create(null), allowed = new Set(['snapshot-dir', 'public-dir', 'ui-dir', 'out-dir', 'capture-manifest', 'frontend-source-commit']);
  for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i]?.replace(/^--/, ''); if (!allowed.has(key) || !process.argv[i + 1]) fail('use --snapshot-dir --public-dir --ui-dir --out-dir --capture-manifest --frontend-source-commit'); values[key] = process.argv[i + 1]; }
  const result = buildOfflineData({ snapshotDir: values['snapshot-dir'], publicDir: values['public-dir'], uiDir: values['ui-dir'], outDir: values['out-dir'], captureManifest: values['capture-manifest'], frontendSourceCommit: values['frontend-source-commit'] });
  console.log(JSON.stringify(result.stats));
}
