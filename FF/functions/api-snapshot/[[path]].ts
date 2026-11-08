// Only explicit packed snapshot read families. The root middleware authenticates before next().
import { PACK_VERSION, packetFile, packedRequest, type VehiclePacket } from '../../tools/snapshot-pack-format.ts';
import { PAGES_MAX_FILE_BYTES, RESOURCE_VERSION, resourceCandidate, resourcePacketFile, resourceRequest, type ResourcePacket } from '../../tools/snapshot-resource-format.ts';
interface Context { request: Request; env: { ASSETS: { fetch(request: Request): Promise<Response> } }; next(): Promise<Response> }
const encoder = new TextEncoder();
const digest = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const failure = (status: number, request: Request) => new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: { code: status === 404 ? 'NOT_FOUND' : 'SNAPSHOT_UNAVAILABLE' } }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
export async function onRequest(ctx: Context): Promise<Response> {
  const url = new URL(ctx.request.url);
  const m = /^\/api-snapshot\/([^/]+\.json)$/.exec(url.pathname);
  const target = m && packedRequest(m[1]);
  const resource = m && resourceRequest(m[1]);
  if (!m) return ctx.next();
  if (!target && !resource) return m[1].startsWith('activation_decide_vin_') || resourceCandidate(m[1]) || (m[1].startsWith('vehicles_') && m[1].includes('_eligibility_catalogId_')) ? failure(404, ctx.request) : ctx.next();
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  try {
    const asset = new URL(ctx.request.url);
    asset.pathname = '/api-snapshot/' + (resource ? resourcePacketFile(await digest(`${resource.kind}:${resource.id}`)) : packetFile(await digest(target!.vin)));
    asset.search = ''; asset.hash = ''; asset.username = ''; asset.password = '';
    const response = await ctx.env.ASSETS.fetch(new Request(asset, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' } }));
    if (response.status === 404 || (response.ok && !(response.headers.get('Content-Type') ?? '').includes('json'))) return failure(404, ctx.request);
    if (!response.ok) return failure(502, ctx.request);
    const raw = await response.text();
    if (encoder.encode(raw).length > PAGES_MAX_FILE_BYTES) return failure(502, ctx.request);
    const packet = JSON.parse(raw) as VehiclePacket & ResourcePacket;
    if (resource ? packet.version !== RESOURCE_VERSION || packet.kind !== resource.kind || packet.id !== resource.id : packet.version !== PACK_VERSION || packet.vin !== target!.vin) return failure(502, ctx.request);
    if (!packet.responses || typeof packet.responses !== 'object' || Array.isArray(packet.responses)) return failure(502, ctx.request);
    if (!Object.prototype.hasOwnProperty.call(packet.responses, m[1])) return failure(404, ctx.request);
    const entry = packet.responses[m[1]];
    if (!entry || typeof entry.body !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || entry.bytes !== encoder.encode(entry.body).length || await digest(entry.body) !== entry.sha256) return failure(502, ctx.request);
    JSON.parse(entry.body);
    return new Response(ctx.request.method === 'HEAD' ? null : entry.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(entry.bytes) } });
  } catch { return failure(502, ctx.request); }
}
