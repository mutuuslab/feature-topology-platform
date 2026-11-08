// Full saved-artifact differential through the production resolver; no network, source edits or deletes.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { onRequest } from '../functions/api-snapshot/[[path]].ts';
import { packedLogicalFiles, physicalFiles, assertPagesFileCount } from './snapshot-pack.ts';
import { PACK_INDEX, packedRequest, type PacketIndex } from './snapshot-pack-format.ts';
const [originalArg, packedArg] = process.argv.slice(2);
if (!originalArg || !packedArg) throw new Error('usage: node tools/snapshot-pack.verify.ts <original-dist> <packed-dist>');
const original = resolve(originalArg), packed = resolve(packedArg), originalApi = join(original, 'api-snapshot'), packedApi = join(packed, 'api-snapshot');
if (original === packed) throw new Error('original and packed artifacts must differ');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
const logical = packedLogicalFiles(packedApi), logicalSet = new Set(logical), packetCache = new Map<string, string>();
const env = { ASSETS: { fetch: async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (!/^\/api-snapshot\/vehicle-query-packets\/[0-9a-f]{64}\.json$/.test(path)) throw new Error('resolver attempted an unrelated asset');
  let body = packetCache.get(path);
  if (body === undefined) { body = readFileSync(join(packedApi, path.slice('/api-snapshot/'.length)), 'utf8'); packetCache.set(path, body); }
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
} } };
let cursor = 0, verified = 0, unchanged = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  for (;;) {
    const at = cursor++; if (at >= logical.length) return;
    const file = logical[at], request = new Request(`https://artifact.invalid/api-snapshot/${file}`);
    const response = await onRequest({ request, env, next: async () => new Response(null, { status: 404 }) });
    const bytes = readFileSync(join(originalApi, file));
    if (response.status !== 200 || !Buffer.from(await response.arrayBuffer()).equals(bytes)) throw new Error(`resolver output differs: ${file}`);
    verified++;
  }
}));
const originalFiles = walk(original), originalNames = new Set(originalFiles.map((f) => relative(original, f).replaceAll('\\', '/')));
for (const file of originalFiles) {
  const rel = relative(original, file).replaceAll('\\', '/'), snapshot = rel.startsWith('api-snapshot/') ? rel.slice('api-snapshot/'.length) : null;
  if (snapshot && logicalSet.has(snapshot)) continue;
  if (snapshot && packedRequest(snapshot)) throw new Error(`unaccounted original family response: ${rel}`);
  if (!readFileSync(file).equals(readFileSync(join(packed, rel)))) throw new Error(`unrelated artifact file changed: ${rel}`);
  unchanged++;
}
const index = JSON.parse(readFileSync(join(packedApi, PACK_INDEX), 'utf8')) as PacketIndex;
const additions = new Set(['api-snapshot/' + PACK_INDEX, ...index.packets.map((p) => 'api-snapshot/' + p.file)]);
for (const file of walk(packed)) { const rel = relative(packed, file).replaceAll('\\', '/'); if (!originalNames.has(rel) && !additions.has(rel)) throw new Error(`unexpected added artifact file: ${rel}`); }
const first = logical[0], request = new Request(`https://artifact.invalid/api-snapshot/${first}`, { method: 'HEAD' });
const head = await onRequest({ request, env, next: async () => new Response(null, { status: 404 }) });
if (head.status !== 200 || (await head.arrayBuffer()).byteLength || Number(head.headers.get('Content-Length')) !== readFileSync(join(originalApi, first)).length) throw new Error('artifact HEAD differs');
console.log(JSON.stringify({ verified_get_responses: verified, unchanged_other_artifact_files: unchanged, verified_head: 1, original_files: physicalFiles(original), packed_files: assertPagesFileCount(packed), origin_requests: 0 }));
