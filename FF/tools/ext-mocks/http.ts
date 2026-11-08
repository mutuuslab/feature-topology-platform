// 독립 모의 서버 공용(80-50 §6, D-ALM-16) — node:http만, 새 의존성 없음. 경로 맞추기·인증·본문 읽기·상태 파일·호출 제한.
// 실서버 자리에 서는 서버라 FF 코드와 섞지 않는다(FF는 live 어댑터로 이 서버에 HTTP로 붙는다).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  raw: Buffer;
  /** JSON 본문(아니면 null) */
  body: any;
  /** multipart/form-data·x-www-form-urlencoded 필드 */
  form: Record<string, string>;
  /** 인증된 사용자 이름(Basic의 사용자 또는 Bearer 토큰에 묶인 이름) */
  user: string;
}
export interface Res {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
export type Handler = (r: Req) => Res | Promise<Res>;
export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** '/rest/api/3/issue/:key/comment' → 정규식·이름 */
export function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const src = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'));
  return { method, pattern: new RegExp(`^${src}$`), keys, handler };
}

export const json = (status: number, body?: unknown, headers?: Record<string, string>): Res => ({ status, body, headers });

/** 사용자 → 토큰. 환경 값 MOCK_USERS='alice:token1,bob:token2'(없으면 기본 계정 둘) */
export function users(env: Record<string, string | undefined>, fallback: Record<string, string>): Record<string, string> {
  const raw = env.MOCK_USERS?.trim();
  if (!raw) return fallback;
  return Object.fromEntries(raw.split(',').map((p) => p.trim().split(':')).filter((x) => x.length === 2 && x[0] && x[1]));
}

function authUser(headers: IncomingMessage['headers'], accounts: Record<string, string>): string | null {
  const h = String(headers.authorization ?? '');
  if (h.startsWith('Basic ')) {
    const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    return accounts[u] && accounts[u] === rest.join(':') ? u : null;
  }
  if (h.startsWith('Bearer ')) {
    const t = h.slice(7).trim();
    return Object.entries(accounts).find(([, v]) => v === t)?.[0] ?? null;
  }
  return null;
}

function parseForm(raw: Buffer, type: string): Record<string, string> {
  if (type.startsWith('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
  if (!type.startsWith('multipart/form-data') || !m) return {};
  const boundary = `--${m[1] ?? m[2]}`;
  const out: Record<string, string> = {};
  for (const part of raw.toString('utf8').split(boundary)) {
    const i = part.indexOf('\r\n\r\n');
    if (i < 0) continue;
    const name = /name="([^"]+)"/.exec(part.slice(0, i))?.[1];
    if (name) out[name] = part.slice(i + 4).replace(/\r\n$/, '');
  }
  return out;
}

/** 호출 제한 — 초당·분당 토큰(codeBeamer 실서버 초당 3회·분당 120회) */
export function throttle(perSecond: number, perMinute: number) {
  const hits: number[] = [];
  return (now = Date.now()): number | null => {
    while (hits.length && now - hits[0] >= 60_000) hits.shift();
    const lastSecond = hits.filter((t) => now - t < 1000).length;
    if (lastSecond >= perSecond) return 1;
    if (hits.length >= perMinute) return Math.ceil((60_000 - (now - hits[0])) / 1000);
    hits.push(now);
    return null;
  };
}

export interface MockServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

export interface ServeOptions {
  name: string;
  port: number;
  routes: Route[];
  accounts: Record<string, string>;
  /** 인증 없이 여는 경로(시험 조작 /_mock/*) */
  open?: (path: string) => boolean;
  /** 호출마다 — 429면 남은 초 */
  limit?: (path: string) => number | null;
  /** 오류 본문 모양 — 실서버마다 다르다 */
  error: (status: number, message: string, path: string) => unknown;
}

export function serve(o: ServeOptions): Promise<MockServer> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (r: Res) => {
      const headers: Record<string, string> = { ...(r.headers ?? {}) };
      if (r.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json;charset=UTF-8';
      res.writeHead(r.status, headers);
      res.end(r.body === undefined ? undefined : typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    };
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const u = new URL(req.url ?? '/', 'http://mock');
    const path = decodeURIComponent(u.pathname);
    try {
      if (!(o.open?.(path) ?? false)) {
        const wait = o.limit?.(path) ?? null;
        if (wait != null) return send(json(429, { ...(o.error(429, 'Too many requests', path) as object), retryAfterSecond: wait }, { 'retry-after': String(wait) }));
      }
      const r = o.routes.find((x) => x.method === req.method && x.pattern.test(path));
      if (!r) return send(json(404, o.error(404, `No route ${req.method} ${path}`, path)));
      const user = o.open?.(path) ? 'mock' : authUser(req.headers, o.accounts);
      if (!user) return send(json(401, o.error(401, 'Unauthorized', path), { 'www-authenticate': 'Basic realm="mock"' }));
      const m = r.pattern.exec(path)!;
      const type = String(req.headers['content-type'] ?? '');
      let body: any = null;
      if (raw.length && type.includes('json')) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          return send(json(400, o.error(400, 'Malformed JSON', path)));
        }
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      send(await r.handler({ method: req.method ?? 'GET', path, query: u.searchParams, params, headers: req.headers, raw, body, form: parseForm(raw, type), user }));
    } catch (e) {
      send(json(500, o.error(500, e instanceof Error ? e.message : String(e), path)));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', () => {
      const a = server.address();
      const port = typeof a === 'object' && a ? a.port : o.port;
      resolve({ server, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** 상태 파일 — FF_MOCK_DATA_DIR(기본 임시 폴더)/<name>.json. 쓰기는 임시 파일 → 이름 바꾸기 */
export function store<T>(name: string, init: () => T, env: Record<string, string | undefined> = process.env) {
  const dir = env.FF_MOCK_DATA_DIR || join(tmpdir(), 'ff-ext-mocks');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  let state: T = existsSync(file) && env.FF_MOCK_FRESH !== '1' ? (JSON.parse(readFileSync(file, 'utf8')) as T) : init();
  return {
    file,
    get: () => state,
    set: (next: T) => {
      state = next;
    },
    save: () => {
      writeFileSync(`${file}.tmp`, JSON.stringify(state));
      renameSync(`${file}.tmp`, file);
    },
    reset: () => {
      state = init();
    },
  };
}

/** 실서버 시간 표기 — JIRA: '2026-11-05T10:00:00.000+0900', codeBeamer: '2026-11-05T10:00:00.000'(시간대 없음) */
export const jiraTime = (ms: number) => new Date(ms).toISOString().replace('Z', '+0000');
export const cbTime = (ms: number) => new Date(ms).toISOString().replace('Z', '');

export const isMain = (url: string) => !!process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
