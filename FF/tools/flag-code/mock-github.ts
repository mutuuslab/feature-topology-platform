// 모의 GitHub(20-97 §8.1) — FF GitHub App 어댑터가 쓰는 최소 REST(App 설치 토큰·git refs/commits/trees/blobs·pulls·check-runs),
// Actions OIDC 발급(JWKS), FF로 보내는 서명된 webhook. 시험과 e2e가 쓴다. 메모리에만 두고 실제 GitHub에 연결하지 않는다.
// 직접 실행: node tools/flag-code/mock-github-serve.ts --port <코디네이터가 배정한 포트>  (8000 금지)
import { createHash, createHmac, createPublicKey, createVerify, generateKeyPairSync, randomUUID, sign as signRaw, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface MockGithub {
  url: string;
  close(): Promise<void>;
  /** 저장소를 만들고 기본 브랜치에 첫 커밋을 넣는다 — 커밋 sha */
  addRepo(fullName: string, branch: string, files: Record<string, string>): string;
  /** 브랜치에 커밋(파일 추가·변경, null이면 삭제) — 커밋 sha */
  commit(fullName: string, branch: string, files: Record<string, string | null>, message?: string): string;
  head(fullName: string, branch: string): string;
  /** 커밋의 파일 내용 */
  filesAt(commit: string): Record<string, string>;
  /** GitHub Actions OIDC 토큰(RS256) — 클레임은 기본값(iss·aud·exp)에 덧씌운다 */
  issueOidc(claims: Record<string, unknown>): string;
  /** FF에 webhook을 보낸다(X-Hub-Signature-256) */
  webhook(target: string, event: string, payload: unknown, opts: { secret: string; deliveryId?: string; badSignature?: boolean }): Promise<{ status: number; body: any }>;
  readonly pulls: { repo: string; number: number; title: string; head: string; base: string; body: string; html_url: string }[];
  readonly checkRuns: { repo: string; name: string; head_sha: string; conclusion: string; output: { title: string; summary: string } }[];
  readonly tokens: string[];
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** GitHub가 붙이는 webhook 머리글 — 원문(raw)을 그대로 보내야 서명이 맞는다(supertest 등에서 직접 보낼 때) */
export function githubWebhookRequest(event: string, payload: unknown, secret: string, deliveryId: string = randomUUID()) {
  const raw = JSON.stringify(payload);
  return { raw, headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': deliveryId, 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') } };
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** appPublicKey — FF가 쓰는 App 개인키의 공개키(주면 앱 JWT 서명을 확인한다) */
export async function startMockGithub(opts: { port?: number; host?: string; appPublicKey?: string | KeyObject } = {}): Promise<MockGithub> {
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, Map<string, string>>();
  const pulls: MockGithub['pulls'] = [];
  const checkRuns: MockGithub['checkRuns'] = [];
  const tokens: string[] = [];
  const oidc = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'mock-oidc-1';
  let seq = 0;

  const putBlob = (content: string) => {
    const s = sha1(`blob\0${content}`);
    blobs.set(s, content);
    return s;
  };
  const putTree = (entries: Map<string, string>) => {
    const s = sha1(`tree\0${[...entries].sort(([a], [b]) => a.localeCompare(b)).map(([p, b]) => `${p}=${b}`).join('\n')}`);
    trees.set(s, new Map(entries));
    return s;
  };
  const putCommit = (tree: string, parents: string[], message: string) => {
    const s = sha1(`commit\0${tree}\0${parents.join(',')}\0${message}\0${++seq}`);
    commits.set(s, { tree, parents, message });
    return s;
  };
  const write = (fullName: string, branch: string, files: Record<string, string | null>, message: string) => {
    const r = refs.get(fullName) ?? new Map<string, string>();
    refs.set(fullName, r);
    const parent = r.get(branch);
    const entries = new Map(parent ? trees.get(commits.get(parent)!.tree)! : []);
    for (const [p, c] of Object.entries(files)) c === null ? entries.delete(p) : entries.set(p, putBlob(c));
    const c = putCommit(putTree(entries), parent ? [parent] : [], message);
    r.set(branch, c);
    return c;
  };

  const verifyAppJwt = (auth: string) => {
    if (!opts.appPublicKey) return true;
    const [h, p, s] = auth.replace(/^Bearer\s+/, '').split('.');
    if (!h || !p || !s) return false;
    const key = typeof opts.appPublicKey === 'string' ? createPublicKey(opts.appPublicKey) : opts.appPublicKey;
    return createVerify('RSA-SHA256').update(`${h}.${p}`).verify(key, fromB64url(s));
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url ?? '/', 'http://mock');
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const auth = String(req.headers.authorization ?? '');
    if (url.pathname === '/.well-known/jwks') return send(200, { keys: [{ ...(oidc.publicKey.export({ format: 'jwk' }) as object), kid, alg: 'RS256', use: 'sig' }] });
    let m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (m && req.method === 'POST') {
      if (!verifyAppJwt(auth)) return send(401, { message: 'Bad credentials' });
      const token = `ghs_mock_${m[1]}_${randomUUID().replace(/-/g, '')}`;
      tokens.push(token);
      return send(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    m = /^\/repos\/([^/]+\/[^/]+)(\/.*)$/.exec(url.pathname);
    if (!m) return send(404, { message: 'Not Found' });
    if (!tokens.some((t) => auth === `token ${t}`)) return send(401, { message: 'Bad credentials' });
    const [, repo, rest] = m;
    const r = refs.get(repo);
    if (!r) return send(404, { message: 'Not Found' });
    let x: RegExpExecArray | null;
    if (req.method === 'GET' && (x = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      const s = r.get(decodeURIComponent(x[1]));
      return s ? send(200, { ref: `refs/heads/${x[1]}`, object: { sha: s, type: 'commit' } }) : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && (x = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest))) {
      const c = commits.get(x[1]);
      return c ? send(200, { sha: x[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message }) : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && (x = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest))) {
      const t = trees.get(x[1]);
      return t ? send(200, { sha: x[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, type: 'blob', mode: '100644', sha })) }) : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && (x = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
      const c = blobs.get(x[1]);
      return c === undefined ? send(404, { message: 'Not Found' }) : send(200, { sha: x[1], encoding: 'base64', content: Buffer.from(c, 'utf8').toString('base64') });
    }
    if (req.method === 'POST' && rest === '/git/blobs') return send(201, { sha: putBlob(String(body.content)) });
    if (req.method === 'POST' && rest === '/git/trees') {
      const entries = new Map(body.base_tree ? trees.get(body.base_tree) ?? [] : []);
      for (const t of body.tree as { path: string; sha: string | null }[]) t.sha === null ? entries.delete(t.path) : entries.set(t.path, t.sha);
      return send(201, { sha: putTree(entries) });
    }
    if (req.method === 'POST' && rest === '/git/commits') return send(201, { sha: putCommit(body.tree, body.parents ?? [], body.message ?? '') });
    if (req.method === 'POST' && rest === '/git/refs') {
      const branch = String(body.ref).replace(/^refs\/heads\//, '');
      if (r.has(branch)) return send(422, { message: 'Reference already exists' });
      r.set(branch, body.sha);
      return send(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (req.method === 'POST' && rest === '/pulls') {
      const number = pulls.filter((p) => p.repo === repo).length + 1;
      const pr = { repo, number, title: body.title, head: body.head, base: body.base, body: body.body ?? '', html_url: `https://github.com/${repo}/pull/${number}` };
      pulls.push(pr);
      return send(201, { number, html_url: pr.html_url, head: { ref: body.head, sha: r.get(body.head) }, base: { ref: body.base, sha: r.get(body.base) } });
    }
    if (req.method === 'POST' && rest === '/check-runs') {
      checkRuns.push({ repo, name: body.name, head_sha: body.head_sha, conclusion: body.conclusion, output: body.output });
      return send(201, { id: checkRuns.length });
    }
    return send(404, { message: 'Not Found' });
  });
  await new Promise<void>((ok) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', ok));
  const addr = server.address() as { port: number };
  const url = `http://${opts.host ?? '127.0.0.1'}:${addr.port}`;

  return {
    url,
    pulls,
    checkRuns,
    tokens,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
    addRepo: (fullName, branch, files) => write(fullName, branch, files, 'chore: 시작'),
    commit: (fullName, branch, files, message = 'change') => write(fullName, branch, files, message),
    head: (fullName, branch) => refs.get(fullName)!.get(branch)!,
    filesAt: (commit) => Object.fromEntries([...trees.get(commits.get(commit)!.tree)!].map(([p, b]) => [p, blobs.get(b)!])),
    issueOidc: (claims) => {
      const now = Math.floor(Date.now() / 1000);
      const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
      const payload = b64url(JSON.stringify({ iss: 'https://token.actions.githubusercontent.com', aud: 'ff-flag-scan', iat: now, nbf: now - 5, exp: now + 300, ...claims }));
      return `${head}.${payload}.${b64url(signRaw('sha256', Buffer.from(`${head}.${payload}`), oidc.privateKey))}`;
    },
    webhook: async (target, event, payload, o) => {
      const raw = JSON.stringify(payload);
      const sig = 'sha256=' + createHmac('sha256', o.badSignature ? `${o.secret}-wrong` : o.secret).update(raw).digest('hex');
      const res = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': o.deliveryId ?? randomUUID(), 'x-hub-signature-256': sig }, body: raw });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}
