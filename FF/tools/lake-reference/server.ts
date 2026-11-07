// 참조 Lake 중계 서버(TL-M07) — IF-15 Data Lake의 차량 입구(POST /v1/vehicle/messages)와 FF 중계(GET /v1/relay/{stream}·/v1/relay/status)만
// 계약(docs/80-integration/datalake-if15.openapi.json, datalake-if15/*.schema.json, 설계 80-75 3·4장)대로 흉내 낸다.
//   npm run lake:reference -- [--port 9547]   비밀: LAKE_REF_RELAY_TOKEN(중계 토큰, lake.relay) · LAKE_REF_GATEWAYS(게이트웨이 인증서 주체, 쉼표)
// 의존성 없음(node:http·node:crypto만), FF 코드를 가져오지 않는다 — 진짜 Lake 서버(LK1, 별도 workspace)를 만드는 쪽이 이 파일로 동작을 확인한다.
// 메모리 저장(재시작하면 빈다) — 영속·보관 7일·분석 사본·텔레메트리·FF 라벨·조회는 진짜 Lake 몫이다.
// · 전송 인증(mTLS)은 TLS를 끝낸 프록시가 넘기는 인증서 주체 머리글(x-client-cert-subject)로 흉내 낸다. 차량 주체 = 가명(결정 U-12), 게이트웨이는 등록된 주체.
// · Lake는 차량 키가 없다 — 서명(auth.mac)을 검증하지 않고 형식·본문 해시만 본다. 받은 메시지는 한 글자도 바꾸지 않고 중계한다(4.1).
// · faults: 일부러 계약을 어기는 동작 — 적합성 검사(conformance.ts)가 실제로 잡는지 보는 시험용.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

export const STREAMS = ['safety', 'normal'] as const;
export type Stream = (typeof STREAMS)[number];
export const MESSAGE_RESULT_STATUSES = ['STORED', 'DUPLICATE', 'INVALID'] as const;
export const MESSAGE_RESULT_REASONS = ['NOT_SCHEMA', 'BODY_HASH_MISMATCH', 'BODY_TOO_LARGE', 'UNKNOWN_KIND'] as const;
export const RELAY_PAGE_KEYS = ['stream', 'items', 'next_after', 'more', 'lag'] as const;
export const SUBJECT_HEADER = 'x-client-cert-subject';
const KINDS = ['STATUS_REPORT', 'INBOX_ACK', 'VEHICLE_REPORT'];
const MAX_MESSAGES = 50;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_WAIT_SEC = 25;
const MAX_LIMIT = 500;

export const KNOWN_FAULTS = ['mutate-message', 'no-dedup', 'single-stream', 'no-long-wait', 'relay-without-token', 'no-subject-check', 'reorder'] as const;
export type Fault = (typeof KNOWN_FAULTS)[number];

export interface LakeReferenceOptions {
  port?: number;
  host?: string;
  /** FF 중계 토큰(lake.relay) */
  relayToken: string;
  /** OEM 텔레매틱스 게이트웨이 인증서 주체 — 여러 차량을 대신 보낼 수 있다 */
  gatewaySubjects?: string[];
  faults?: Fault[];
  log?: (e: Record<string, unknown>) => void;
}

interface RelayItem {
  relay_seq: number;
  stream: 'SAFETY' | 'NORMAL';
  received_at: string;
  message: Record<string, unknown>;
}

const RX = {
  pseudonym: /^[a-f0-9]{16,64}$/,
  messageId: /^[a-f0-9]{16,64}:[A-Za-z0-9_-]{16,64}$/,
  nonce: /^[A-Za-z0-9_-]{16,64}$/,
  timestamp: /^\d{10,16}$/,
  mac: /^[A-Za-z0-9_-]{22}$/,
  b64: /^[A-Za-z0-9+/]*={0,2}$/,
  sha: /^[a-f0-9]{64}$/,
};

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);

/** vehicle-message.schema.json 검사 — 형식이 틀리면 INVALID 사유 */
export function messageProblem(m: unknown): (typeof MESSAGE_RESULT_REASONS)[number] | null {
  if (!isObj(m)) return 'NOT_SCHEMA';
  if (typeof m.kind !== 'string' || !KINDS.includes(m.kind)) return isObj(m) && 'kind' in m ? 'UNKNOWN_KIND' : 'NOT_SCHEMA';
  if (!onlyKeys(m, ['schema', 'message_id', 'pseudonym', 'kind', 'ref', 'auth', 'body_b64', 'body_sha256'])) return 'NOT_SCHEMA';
  if (m.schema !== 'ff.vehicle.msg/1' || typeof m.message_id !== 'string' || !RX.messageId.test(m.message_id) || typeof m.pseudonym !== 'string' || !RX.pseudonym.test(m.pseudonym)) return 'NOT_SCHEMA';
  if (m.kind === 'INBOX_ACK' ? typeof m.ref !== 'string' || m.ref.length < 1 || m.ref.length > 80 : m.ref !== null) return 'NOT_SCHEMA';
  const a = m.auth;
  if (!isObj(a) || !onlyKeys(a, ['scheme', 'key_epoch', 'timestamp', 'nonce', 'mac'])) return 'NOT_SCHEMA';
  if (a.scheme !== 'FFV1-MSG' || !Number.isInteger(a.key_epoch) || a.key_epoch < 1 || a.key_epoch > 999_999_999) return 'NOT_SCHEMA';
  if (typeof a.timestamp !== 'string' || !RX.timestamp.test(a.timestamp) || typeof a.nonce !== 'string' || !RX.nonce.test(a.nonce) || typeof a.mac !== 'string' || !RX.mac.test(a.mac)) return 'NOT_SCHEMA';
  if (typeof m.body_b64 !== 'string' || !RX.b64.test(m.body_b64) || typeof m.body_sha256 !== 'string' || !RX.sha.test(m.body_sha256)) return 'NOT_SCHEMA';
  const body = Buffer.from(m.body_b64, 'base64');
  if (body.length > MAX_BODY_BYTES) return 'BODY_TOO_LARGE';
  if (createHash('sha256').update(body).digest('hex') !== m.body_sha256) return 'BODY_HASH_MISMATCH';
  return null;
}

const streamOf = (kind: string): Stream => (kind === 'VEHICLE_REPORT' ? 'normal' : 'safety');

/** 인증서 주체 → CN(없으면 값 전체) */
const cnOf = (raw: string) => (/(?:^|[,/])\s*CN\s*=\s*([^,/+]+)/i.exec(raw)?.[1] ?? raw).trim();

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function startLakeReference(o: LakeReferenceOptions) {
  const faults = new Set(o.faults ?? []);
  const gateways = new Set((o.gatewaySubjects ?? []).map(cnOf));
  const log = o.log ?? (() => {});
  const streams: Record<Stream, RelayItem[]> = { safety: [], normal: [] };
  const lastRead: Record<Stream, number | null> = { safety: null, normal: null };
  const byId = new Map<string, { seq: number; stream: Stream }>();
  const waiters: Record<Stream, Set<() => void>> = { safety: new Set(), normal: new Set() };
  let seq = 0;

  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(JSON.stringify(body));
  };
  const problem = (res: ServerResponse, status: number, title: string, code: string) => send(res, status, { type: 'about:blank', title, status, code }, 'application/problem+json');

  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer | null>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      req.on('data', (c: Buffer) => {
        n += c.length;
        if (n > MAX_REQUEST_BYTES) {
          resolve(null);
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const lag = (s: Stream) => {
    const items = streams[s];
    const after = lastRead[s] ?? 0;
    const unread = items.filter((r) => r.relay_seq > after);
    return { stream: s, head_seq: items.at(-1)?.relay_seq ?? 0, last_read_after: lastRead[s], backlog: unread.length, oldest_unread_age_ms: unread.length ? Date.now() - Date.parse(unread[0].received_at) : null };
  };

  async function ingest(req: IncomingMessage, res: ServerResponse) {
    const subject = req.headers[SUBJECT_HEADER];
    if (typeof subject !== 'string' || !subject.trim()) return problem(res, 401, '클라이언트 인증서가 없습니다', 'CLIENT_CERT_REQUIRED');
    const cn = cnOf(subject);
    const raw = await readBody(req);
    if (!raw) return problem(res, 413, '256 KiB를 넘었습니다', 'TOO_LARGE');
    let body: any;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return problem(res, 400, '본문을 읽을 수 없습니다', 'BAD_JSON');
    }
    if (!isObj(body) || !Array.isArray(body.messages) || body.messages.length < 1) return problem(res, 400, 'messages 배열이 필요합니다', 'BAD_REQUEST');
    if (body.messages.length > MAX_MESSAGES) return problem(res, 413, `한 번에 ${MAX_MESSAGES}건까지`, 'TOO_MANY');
    // 차량 직접이면 인증서 주체 = 메시지 가명(U-12). 게이트웨이는 여러 차량을 대신 보낸다
    if (!gateways.has(cn) && !faults.has('no-subject-check')) for (const m of body.messages) if (isObj(m) && typeof m.pseudonym === 'string' && m.pseudonym !== cn) return problem(res, 403, '인증서 주체와 차량 가명이 다릅니다', 'SUBJECT_MISMATCH');
    const results: { message_id: string | null; status: string; reason?: string; relay_seq?: number }[] = [];
    const woke = new Set<Stream>();
    for (const m of body.messages) {
      const id = isObj(m) && typeof m.message_id === 'string' ? m.message_id : null;
      const bad = messageProblem(m);
      if (bad) {
        results.push({ message_id: id, status: 'INVALID', reason: bad });
        continue;
      }
      const seen = byId.get(id!);
      if (seen && !faults.has('no-dedup')) {
        results.push({ message_id: id, status: 'DUPLICATE', relay_seq: seen.seq });
        continue;
      }
      const s = faults.has('single-stream') ? 'safety' : streamOf(m.kind);
      const item: RelayItem = { relay_seq: ++seq, stream: s === 'safety' ? 'SAFETY' : 'NORMAL', received_at: new Date().toISOString(), message: structuredClone(m) };
      // reorder 결함: 같은 차량의 앞 기록보다 앞에 끼워 넣는다(순서 보존 위반)
      let prev = -1;
      if (faults.has('reorder')) for (let i = streams[s].length - 1; i >= 0 && prev < 0; i--) if (streams[s][i].message.pseudonym === m.pseudonym) prev = i;
      if (prev >= 0) streams[s].splice(prev, 0, item);
      else streams[s].push(item);
      byId.set(id!, { seq: item.relay_seq, stream: s });
      results.push({ message_id: id, status: 'STORED', relay_seq: item.relay_seq });
      woke.add(s);
    }
    // 영속 저장 뒤에만 답한다(참조 구현은 메모리) — 대기 중인 FF 요청을 깨운다
    for (const s of woke) for (const w of [...waiters[s]]) w();
    log({ event: 'vehicle.messages', subject: cn, results: results.map((r) => r.status) });
    send(res, 202, { results });
  }

  async function pull(req: IncomingMessage, res: ServerResponse, s: Stream, q: URLSearchParams) {
    const auth = req.headers.authorization ?? '';
    if (!faults.has('relay-without-token') && !(auth.startsWith('Bearer ') && same(auth.slice(7), o.relayToken))) return problem(res, 401, '중계 토큰(lake.relay)이 필요합니다', 'UNAUTHENTICATED');
    const after = Number(q.get('after'));
    const limit = q.has('limit') ? Number(q.get('limit')) : 200;
    const wait = q.has('wait') ? Number(q.get('wait')) : MAX_WAIT_SEC;
    if (!q.has('after') || !Number.isInteger(after) || after < 0) return problem(res, 400, 'after(0 이상 정수)가 필요합니다', 'BAD_REQUEST');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT || !Number.isInteger(wait) || wait < 0 || wait > MAX_WAIT_SEC) return problem(res, 400, `limit 1~${MAX_LIMIT}, wait 0~${MAX_WAIT_SEC}`, 'BAD_REQUEST');
    lastRead[s] = Math.max(lastRead[s] ?? 0, after);
    const page = () => {
      const pending = streams[s].filter((r) => r.relay_seq > after);
      const items = pending.slice(0, limit).map((r) => (faults.has('mutate-message') ? { ...r, message: { ...r.message, body_b64: Buffer.from(JSON.stringify(JSON.parse(Buffer.from(String(r.message.body_b64), 'base64').toString('utf8')), null, 1)).toString('base64') } } : r));
      return { stream: s, items, next_after: items.length ? Math.max(...items.map((r) => r.relay_seq)) : after, more: pending.length > items.length, lag: lag(s) };
    };
    const first = page();
    if (first.items.length || wait === 0 || faults.has('no-long-wait')) return send(res, 200, first);
    // 긴 대기 — 새 기록이 오면 곧바로, 아니면 wait초 뒤 빈 묶음
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        waiters[s].delete(done);
        resolve();
      };
      const t = setTimeout(done, wait * 1000);
      waiters[s].add(done);
      req.on('close', done);
    });
    if (!res.writableEnded && !res.destroyed) send(res, 200, page());
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://lake.invalid');
    const p = url.pathname;
    const run = async () => {
      if (req.method === 'GET' && p === '/v1/health/live') return send(res, 200, { status: 'ok', version: 'reference' });
      if (req.method === 'GET' && p === '/v1/health/ready') return send(res, 200, { status: 'ok', version: 'reference', checks: { relay_store: 'ok' } });
      if (req.method === 'POST' && p === '/v1/vehicle/messages') return ingest(req, res);
      if (req.method === 'GET' && p === '/v1/relay/status') {
        const auth = req.headers.authorization ?? '';
        if (!(auth.startsWith('Bearer ') && same(auth.slice(7), o.relayToken))) return problem(res, 401, '토큰이 필요합니다', 'UNAUTHENTICATED');
        return send(res, 200, { streams: STREAMS.map(lag) });
      }
      const m = /^\/v1\/relay\/([a-z]+)$/.exec(p);
      if (req.method === 'GET' && m && (STREAMS as readonly string[]).includes(m[1])) return pull(req, res, m[1] as Stream, url.searchParams);
      return problem(res, 404, '없는 경로', 'NOT_FOUND');
    };
    run().catch((e) => {
      log({ event: 'error', message: String(e) });
      if (!res.headersSent) problem(res, 500, '내부 오류', 'INTERNAL');
    });
  });
  await new Promise<void>((resolve) => server.listen(o.port ?? 0, o.host ?? '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state: () => ({ seq, safety: streams.safety.length, normal: streams.normal.length }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of STREAMS) for (const w of [...waiters[s]]) w();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ── 명령줄 ──
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const token = process.env.LAKE_REF_RELAY_TOKEN ?? 'lake-relay-reference-token';
  const ref = await startLakeReference({
    port: Number(arg('port') ?? process.env.LAKE_REF_PORT ?? 9547),
    relayToken: token,
    gatewaySubjects: (process.env.LAKE_REF_GATEWAYS ?? 'CN=oem-gateway-reference').split(',').map((s) => s.trim()).filter(Boolean),
    log: (e) => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })),
  });
  console.log(JSON.stringify({ event: 'listening', url: ref.url, streams: STREAMS }));
  const stop = () => void ref.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
