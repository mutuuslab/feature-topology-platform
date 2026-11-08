// Deploy-artifact transform only. Browser builds and the unpacked static harness remain unchanged.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PACK_DIR, PACK_INDEX, PACK_VERSION, packetFile, packedRequest, type PacketIndex, type VehiclePacket } from './snapshot-pack-format.ts';
import { packResources, resourceLogicalFiles } from './snapshot-resource-pack.ts';
import { PAGES_MAX_FILE_BYTES } from './snapshot-resource-format.ts';
const contracts = createRequire(import.meta.url)('../contracts/dist/index.js') as { routeUrl(n: string, p?: Record<string, string>, q?: Record<string, string>): string; snapshotFile(url: string): string };
export const PAGES_FREE_FILE_LIMIT = 20000;
export const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const fail = (s: string): never => { throw new Error(`snapshot-pack: ${s}`); };
const regular = (p: string) => { const st = lstatSync(p); if (!st.isFile() || st.isSymbolicLink()) fail(`not a regular file: ${p}`); };
function within(root: string, file: string): string {
  const absolute = resolve(root, file), rel = relative(resolve(root), absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('path leaves the artifact snapshot directory');
  if (existsSync(absolute)) { const real = relative(realpathSync(root), realpathSync(absolute)); if (!real || real.startsWith('..') || isAbsolute(real)) fail('resolved path leaves the artifact snapshot directory'); }
  return absolute;
}
function apiRoot(artifact: string): string {
  const root = resolve(artifact), dir = join(root, 'api-snapshot');
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || !lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) fail('artifact and api-snapshot must be real directories');
  return dir;
}
export function logicalFile(name: string, p: Record<string, string> = {}, q: Record<string, string> = {}): string { return basename(contracts.snapshotFile(contracts.routeUrl(name, p, q))); }
function readJson(dir: string, file: string): any { const path = within(dir, file); regular(path); return JSON.parse(readFileSync(path, 'utf8')); }
const strings = (values: unknown[], label: string) => {
  if (!values.length || values.some((s) => typeof s !== 'string' || !s)) fail(`invalid ${label}`);
  return [...new Set(values as string[])].sort();
};
export function context(dir: string) {
  const vehicles = readJson(dir, logicalFile('vehicles')).items;
  const products = readJson(dir, logicalFile('listProducts')).items;
  const policies = readJson(dir, logicalFile('listPolicies')).items;
  if (![vehicles, products, policies].every(Array.isArray)) fail('canonical input lists are missing');
  const vins = strings(vehicles.map((v: any) => v.vin), 'VINs');
  if (vins.length !== vehicles.length) fail('duplicate canonical VIN');
  return { vins, catalogIds: strings(products.map((p: any) => p.catalogId), 'catalogs'), flagKeys: strings(policies.filter((p: any) => p.status === 'DEPLOYED').map((p: any) => p.flagKey), 'deployed flags') };
}
export function expectedFiles(vin: string, catalogIds: string[], flagKeys: string[]): string[] {
  const entries = [...catalogIds.map((catalogId) => logicalFile('vehicleEligibility', { vin }, { catalogId })), ...flagKeys.map((flagKey) => logicalFile('activationDecide', {}, { vin, flagKey }))];
  for (const file of entries) if (packedRequest(file)?.vin !== vin) fail(`unsupported or ambiguous logical name: ${file}`);
  if (new Set(entries).size !== entries.length) fail('logical file collision');
  return entries.sort();
}
export function physicalFiles(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((n, d) => { if (d.isSymbolicLink()) fail('symlinks are not deployable artifact files'); return n + (d.isDirectory() ? physicalFiles(join(dir, d.name)) : 1); }, 0);
}
export function assertPagesFileCount(artifact: string): number {
  const n = physicalFiles(resolve(artifact));
  if (n > PAGES_FREE_FILE_LIMIT) fail(`Pages artifact has ${n} files; maximum ${PAGES_FREE_FILE_LIMIT}`);
  return n;
}
/** Validate packets against the retained canonical lists; return the original logical filenames for coverage. */
export function packedLogicalFiles(dir: string, allowOriginals = false): string[] {
  if (!existsSync(join(dir, PACK_INDEX))) return resourceLogicalFiles(dir, allowOriginals);
  const index = readJson(dir, PACK_INDEX) as PacketIndex, source = context(dir);
  if (index.version !== PACK_VERSION || JSON.stringify(index.vins) !== JSON.stringify(source.vins) || JSON.stringify(index.catalogIds) !== JSON.stringify(source.catalogIds) || JSON.stringify(index.flagKeys) !== JSON.stringify(source.flagKeys) || !Array.isArray(index.packets) || index.packets.length !== source.vins.length) fail('packet index does not cover the canonical source');
  const logical: string[] = [];
  for (const vin of source.vins) {
    const records = index.packets.filter((p) => p.vin === vin);
    if (records.length !== 1) fail('missing or duplicate VIN packet');
    const info = records[0], expectedPath = packetFile(hash(vin));
    if (info.file !== expectedPath) fail('invalid packet path');
    const path = within(dir, info.file); regular(path);
    const bytes = readFileSync(path);
    if (bytes.length !== info.bytes || hash(bytes) !== info.sha256) fail(`packet integrity failed: ${vin}`);
    const packet = JSON.parse(bytes.toString('utf8')) as VehiclePacket;
    const files = expectedFiles(vin, source.catalogIds, source.flagKeys);
    if (packet.version !== PACK_VERSION || packet.vin !== vin || !packet.responses || Array.isArray(packet.responses) || JSON.stringify(Object.keys(packet.responses).sort()) !== JSON.stringify(files)) fail(`packet entries do not cover VIN: ${vin}`);
    for (const file of files) {
      const entry = packet.responses[file];
      if (!entry || typeof entry.body !== 'string' || entry.bytes !== Buffer.byteLength(entry.body) || hash(entry.body) !== entry.sha256) fail(`response integrity failed: ${file}`);
      JSON.parse(entry.body);
      if (!allowOriginals && existsSync(within(dir, file))) fail(`unremoved packed original: ${file}`);
      logical.push(file);
    }
  }
  if (logical.length !== index.logicalFiles || new Set(logical).size !== logical.length) fail('logical count or filename collision');
  return [...logical, ...resourceLogicalFiles(dir, allowOriginals)];
}
export function packArtifact(artifact: string) {
  const dir = apiRoot(artifact), before = physicalFiles(artifact), source = context(dir);
  if (existsSync(join(dir, PACK_INDEX))) {
    packedLogicalFiles(dir);
    packResources(dir);
    const logical = packedLogicalFiles(dir);
    return { before, after: physicalFiles(artifact), logical: logical.length, packets: source.vins.length, idempotent: true, ...source };
  }
  const index: PacketIndex = { version: PACK_VERSION, ...source, logicalFiles: 0, packets: [] };
  const packets: { file: string; body: string }[] = [], originals: { file: string; sha256: string }[] = [];
  for (const vin of source.vins) {
    const packet: VehiclePacket = { version: PACK_VERSION, vin, responses: Object.create(null) };
    for (const file of expectedFiles(vin, source.catalogIds, source.flagKeys)) {
      const path = within(dir, file); regular(path);
      const bytes = readFileSync(path), body = bytes.toString('utf8');
      if (!Buffer.from(body, 'utf8').equals(bytes)) fail(`invalid UTF-8: ${file}`);
      JSON.parse(body);
      const sha256 = hash(bytes);
      packet.responses[file] = { body, sha256, bytes: bytes.length };
      originals.push({ file, sha256 });
    }
    const file = packetFile(hash(vin)), body = JSON.stringify(packet);
    if (Buffer.byteLength(body) > PAGES_MAX_FILE_BYTES) fail('VIN packet exceeds 25MiB');
    packets.push({ file, body });
    index.packets.push({ vin, file, sha256: hash(body), bytes: Buffer.byteLength(body) });
  }
  const expected = new Set(originals.map((p) => p.file));
  if (expected.size !== originals.length) fail('logical filename collision');
  for (const file of readdirSync(dir)) if (packedRequest(file) && !expected.has(file)) fail(`unaccounted family response: ${file}`);
  const packetDir = within(dir, PACK_DIR);
  if (existsSync(packetDir) && (!lstatSync(packetDir).isDirectory() || lstatSync(packetDir).isSymbolicLink())) fail('packet directory is not a real directory');
  mkdirSync(packetDir, { recursive: true });
  for (const p of packets) {
    const path = within(dir, p.file);
    if (existsSync(path)) { regular(path); if (readFileSync(path, 'utf8') !== p.body) fail('refusing to replace an unrelated packet'); }
    else writeFileSync(path, p.body);
  }
  index.logicalFiles = originals.length;
  const indexPath = within(dir, PACK_INDEX), tempIndex = within(dir, PACK_INDEX + '.tmp');
  if (existsSync(tempIndex)) fail('unfinished index temp file exists');
  writeFileSync(tempIndex, JSON.stringify(index)); renameSync(tempIndex, indexPath);
  packedLogicalFiles(dir, true);
  // Validate the exact original bytes again before unlinking only the explicit two-family file list.
  for (const p of originals) { const path = within(dir, p.file); regular(path); if (hash(readFileSync(path)) !== p.sha256) fail(`source changed during packing: ${p.file}`); }
  for (const p of originals) unlinkSync(within(dir, p.file));
  packResources(dir);
  const logical = packedLogicalFiles(dir);
  return { before, after: physicalFiles(artifact), logical: logical.length, packets: packets.length, idempotent: false, ...source };
}
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const countOnly = process.argv[2] === '--check-file-count', artifact = process.argv[countOnly ? 3 : 2];
    if (!artifact) fail('usage: node tools/snapshot-pack.ts [--check-file-count] <final-dist>');
    if (countOnly) console.log(`Pages files ${assertPagesFileCount(artifact)}/${PAGES_FREE_FILE_LIMIT}`);
    else { const { vins, catalogIds, flagKeys, ...report } = packArtifact(artifact); console.log(JSON.stringify({ ...report, vins: vins.length, catalogs: catalogIds.length, flags: flagKeys.length })); }
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
