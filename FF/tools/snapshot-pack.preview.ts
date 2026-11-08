// Local-only deployment harness. Uses the production gate/resolver and disk-backed ASSETS; no origin API proxy.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { handle } from '../functions/_middleware.ts';
import { onRequest } from '../functions/api-snapshot/[[path]].ts';
import { artifactFingerprint } from './snapshot-pack.provenance.ts';
const rootArg = process.argv[2], port = Number(process.argv[3] ?? 9477);
if (!rootArg || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('usage: node tools/snapshot-pack.preview.ts <packed-dist> [port9477]');
const root = resolve(rootArg), provenance = artifactFingerprint(root);
const localGateSecret = randomBytes(32).toString('hex');
// Match the deployment's global asset-header block. Dynamic gate/resolver responses remain production responses.
const deployedHeaders = new Headers(); let globalBlock = false;
for (const line of readFileSync(join(root, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith('#')) continue;
  if (!/^\s/.test(line)) { globalBlock = line.trim() === '/*'; continue; }
  if (!globalBlock) continue;
  const remove = /^\s+!\s*(\S+)\s*$/.exec(line);
  if (remove) { deployedHeaders.delete(remove[1]); continue; }
  const header = /^\s+([^:\s]+):\s*(.*)$/.exec(line);
  if (!header) throw new Error('Malformed global deployment header');
  deployedHeaders.append(header[1], header[2]);
}
function assetResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(deployedHeaders);
  new Headers(init.headers).forEach((value, key) => { headers.set(key, value); });
  return new Response(body, { ...init, headers });
}
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain', '.log': 'text/plain', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function asset(request: Request, packetOnly = false): Response {
  const url = new URL(request.url);
  if (packetOnly && !/^\/api-snapshot\/(vehicle-query-packets|resource-query-packets)\/[0-9a-f]{64}\.json$/.test(url.pathname)) return assetResponse(null, { status: 404 });
  if (!packetOnly && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__auth/'))) return assetResponse(null, { status: 404 });
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return assetResponse(null, { status: 400 }); }
  if (path.includes('\\') || path.includes('\0') || path.split('/').some((p) => p === '..' || p === '.')) return assetResponse(null, { status: 404 });
  let file = resolve(root, '.' + path), rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) return assetResponse(null, { status: 404 });
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
    if (packetOnly || path.startsWith('/api-snapshot/') || path.startsWith('/assets/') || path.startsWith('/brand/') || !(request.headers.get('Accept') ?? '').includes('text/html')) return assetResponse(null, { status: 404 });
    file = join(root, 'index.html');
  }
  const bytes = readFileSync(file);
  return assetResponse(request.method === 'HEAD' ? null : new Uint8Array(bytes).buffer as ArrayBuffer, { headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-cache' } });
}
const env = { FF_GATE_SECRET: localGateSecret, ASSETS: { fetch: async (request: Request) => asset(request, true) } };
const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host;
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) { outgoing.writeHead(400).end(); return; }
    const base = `http://${host}`, url = new URL(incoming.url ?? '/', base);
    if (url.origin !== base) { outgoing.writeHead(400).end(); return; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of incoming) { const bytes = Buffer.from(chunk); size += bytes.length; if (size <= 8192) chunks.push(bytes); }
    if (size > 8192) { outgoing.writeHead(413).end(); return; }
    const method = incoming.method ?? 'GET';
    const request = new Request(url, { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(chunks).toString('utf8') } : {}) });
    const response = await handle(request, env, () => onRequest({ request, env, next: async () => asset(request) }));
    const responseHeaders: Record<string, string> = {}; response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"preview failed"}'); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://localhost:${port}/`, source: root, provenance, external_api_proxy: false, production_gate_and_resolver: true })));
