import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { FlagRepository } from '@ff/contracts';
import { GithubAdapter, type FlagGitPort } from '../../src/domains/d01-policy/flag-code/github.adapter';
import { startMockGithub, type MockGithub } from '../../../tools/flag-code/mock-github';
import { actor, bootApp } from '../helpers';
import { FlagCodeService } from '../../src/domains/d01-policy/flag-code/flag-code.service';

// Real HTTP transport to the existing App/JWT demo, with failures before/after a remote write.
// Only request method/path are retained; credentials and remote error bodies never enter evidence.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fullName = 'demo-owner/recovery';
const repository = `https://github.com/${fullName}`;
const repo = { repository, installationId: 42, mode: 'GITHUB_APP' } as FlagRepository;
const pr = { branch: 'ff/flag-recovery', base: 'main', title: 'Add Flag guards', body: 'Reviewed scaffold intent', message: 'Add Flag guards', files: [{ path: 'src/guard.ts', content: 'export const enabled = true;\n' }] };
type Fault = { method: string; path: string; status: number; after?: boolean; transform?: (body: any) => any };

describe('GitHub PR recovery over the real demo HTTP transport', () => {
  let gh: MockGithub;
  let proxy: Server;
  let port: FlagGitPort;
  let faults: Fault[];
  let calls: string[];
  beforeEach(async () => {
    gh = await startMockGithub({ appPublicKey: keys.publicKey });
    gh.addRepo(fullName, 'main', { 'README.md': 'demo base', 'src/old.ts': 'keep me' });
    faults = []; calls = [];
    proxy = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', gh.url);
      const method = req.method!;
      calls.push(`${method} ${url.pathname}`);
      const f = faults.find((x) => x.method === method && x.path === url.pathname);
      if (f) faults.splice(faults.indexOf(f), 1);
      if (f && !f.after && !f.transform) {
        res.writeHead(f.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'private remote diagnostic must not escape' })); return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const upstream = await fetch(url, { method, headers: { authorization: String(req.headers.authorization ?? ''), 'content-type': 'application/json' }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const text = await upstream.text();
      res.writeHead(f?.status ?? upstream.status, { 'content-type': 'application/json' });
      res.end(f?.transform ? JSON.stringify(f.transform(JSON.parse(text))) : text);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address() as { port: number };
    port = new GithubAdapter().port(repo, { FF_GITHUB_APP_ID: '123', FF_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), FF_GITHUB_API_URL: `http://127.0.0.1:${address.port}` })!;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => proxy?.close(() => resolve()));
    await gh?.close();
  });
  const route = (path: string) => `/repos/${fullName}${path}`;
  const count = (method: string, path: string) => calls.filter((x) => x === `${method} ${route(path)}`).length;

  it('resumes after branch creation succeeds and PR POST fails, preserving the original commit even when main advances', async () => {
    faults.push({ method: 'POST', path: route('/pulls'), status: 503 });
    await expect(port.createPullRequest(repo, pr)).rejects.toMatchObject({ status: 503 });
    const branch = gh.head(fullName, pr.branch);
    expect(branch).toMatch(/^[a-f0-9]{40}$/);
    gh.commit(fullName, 'main', { 'README.md': 'main advanced' });
    const opened = await port.createPullRequest(repo, pr);
    expect(opened).toMatchObject({ number: 1, headCommit: branch });
    expect(gh.head(fullName, pr.branch)).toBe(branch);
    expect(gh.filesAt(branch)).toMatchObject({ 'README.md': 'demo base', 'src/guard.ts': pr.files[0].content });
    expect(count('POST', '/git/refs')).toBe(1);
    expect(gh.pulls).toHaveLength(1);
  });

  it('recovers an accepted PR whose HTTP response was lost and never creates a duplicate on later retries', async () => {
    faults.push({ method: 'POST', path: route('/pulls'), status: 502, after: true });
    const first = await port.createPullRequest(repo, pr);
    expect(await port.createPullRequest(repo, pr)).toEqual(first);
    expect(gh.pulls).toHaveLength(1);
    expect(count('POST', '/pulls')).toBe(1);
    expect(count('POST', '/git/refs')).toBe(1);
    expect(calls.some((x) => /^(PATCH|PUT|DELETE) /.test(x))).toBe(false);
  });

  it('recovers an accepted ref whose HTTP response was lost on the next attempt', async () => {
    faults.push({ method: 'POST', path: route('/git/refs'), status: 502, after: true });
    await expect(port.createPullRequest(repo, pr)).rejects.toMatchObject({ status: 502 });
    const head = gh.head(fullName, pr.branch);
    expect(await port.createPullRequest(repo, pr)).toMatchObject({ number: 1, headCommit: head });
    expect(count('POST', '/git/refs')).toBe(1);
  });

  it('handles a concurrent ref creation without moving the ref', async () => {
    faults.push({ method: 'POST', path: route('/git/refs'), status: 422, after: true });
    const opened = await port.createPullRequest(repo, pr);
    expect(opened.headCommit).toBe(gh.head(fullName, pr.branch));
    expect(count('POST', '/git/refs')).toBe(1);
  });

  it('uses a stable intent for reordered files, including deletions, and retains unrelated base files', async () => {
    const files = [{ path: 'src/old.ts', content: null }, ...pr.files];
    const first = await port.createPullRequest(repo, { ...pr, files });
    expect(await port.createPullRequest(repo, { ...pr, files: [...files].reverse() })).toEqual(first);
    expect(gh.filesAt(first.headCommit)).toEqual({ 'README.md': 'demo base', 'src/guard.ts': pr.files[0].content });
    expect(count('POST', '/pulls')).toBe(1);
  });

  it('concurrent callers converge on one branch commit and one PR without force updates', async () => {
    const [a, b] = await Promise.all([port.createPullRequest(repo, pr), port.createPullRequest(repo, pr)]);
    expect(a).toEqual(b);
    expect(a.headCommit).toBe(gh.head(fullName, pr.branch));
    expect(gh.pulls).toHaveLength(1);
    expect(calls.some((x) => /^(PATCH|PUT|DELETE) /.test(x))).toBe(false);
  });

  it('refuses an existing foreign or subsequently changed commit and leaves it untouched', async () => {
    faults.push({ method: 'POST', path: route('/pulls'), status: 503 });
    await expect(port.createPullRequest(repo, pr)).rejects.toMatchObject({ status: 503 });
    const foreign = gh.commit(fullName, pr.branch, { 'src/guard.ts': 'foreign edit' }, 'human changed branch');
    await expect(port.createPullRequest(repo, pr)).rejects.toMatchObject({ status: 409 });
    expect(gh.head(fullName, pr.branch)).toBe(foreign);
    expect(gh.filesAt(foreign)['src/guard.ts']).toBe('foreign edit');
    expect(count('POST', '/pulls')).toBe(1);
    expect(count('POST', '/git/refs')).toBe(1);
    expect(calls.some((x) => /^(PATCH|PUT|DELETE) /.test(x))).toBe(false);
  });

  it('refuses a changed request on the same branch even if a valid old PR exists', async () => {
    await port.createPullRequest(repo, pr);
    const head = gh.head(fullName, pr.branch);
    await expect(port.createPullRequest(repo, { ...pr, files: [{ path: 'src/guard.ts', content: 'different intent' }] })).rejects.toMatchObject({ status: 409 });
    expect(gh.head(fullName, pr.branch)).toBe(head);
    expect(count('POST', '/pulls')).toBe(1);
  });

  it('checks the full expected tree instead of trusting the intent marker alone', async () => {
    const opened = await port.createPullRequest(repo, pr);
    faults.push({ method: 'GET', path: route(`/git/commits/${opened.headCommit}`), status: 200, transform: (c) => ({ ...c, tree: { sha: 'a'.repeat(40) } }) });
    await expect(port.createPullRequest(repo, pr)).rejects.toThrow('파일 트리');
    expect(count('POST', '/pulls')).toBe(1);
    expect(gh.head(fullName, pr.branch)).toBe(opened.headCommit);
  });

  it('refuses a base history that no longer contains the original parent', async () => {
    await port.createPullRequest(repo, pr);
    const parent = gh.head(fullName, 'main');
    const advanced = gh.commit(fullName, 'main', { 'README.md': 'advanced' });
    faults.push({ method: 'GET', path: route(`/compare/${parent}...${advanced}`), status: 200, transform: () => ({ status: 'diverged', merge_base_commit: { sha: advanced } }) });
    await expect(port.createPullRequest(repo, pr)).rejects.toThrow('기준 커밋');
    expect(count('POST', '/pulls')).toBe(1);
  });

  it.each(['sha', 'repo', 'base', 'title', 'body', 'url'] as const)('refuses an existing PR with mismatched %s without another POST', async (field) => {
    const first = await port.createPullRequest(repo, pr);
    faults.push({ method: 'GET', path: route('/pulls'), status: 200, transform: ([p]) => [{ ...p, ...(field === 'sha' ? { head: { ...p.head, sha: 'a'.repeat(40) } } : field === 'repo' ? { head: { ...p.head, repo: { full_name: 'foreign/fork' } } } : field === 'base' ? { base: { ...p.base, ref: 'foreign-base' } } : field === 'url' ? { html_url: 'https://foreign.invalid/pr' } : { [field]: 'foreign intent' }) }] });
    await expect(port.createPullRequest(repo, pr)).rejects.toMatchObject({ status: 409 });
    expect(count('POST', '/pulls')).toBe(1);
    expect(gh.head(fullName, pr.branch)).toBe(first.headCommit);
  });

  it('refuses ambiguous PR discovery rather than creating a third PR', async () => {
    await port.createPullRequest(repo, pr);
    faults.push({ method: 'GET', path: route('/pulls'), status: 200, transform: ([p]) => [p, { ...p, number: 999 }] });
    await expect(port.createPullRequest(repo, pr)).rejects.toThrow('모호');
    expect(count('POST', '/pulls')).toBe(1);
  });

  it('detects a branch edit between lookup and POST without opening a PR', async () => {
    faults.push({ method: 'GET', path: route('/pulls'), status: 200, transform: (rows) => { gh.commit(fullName, pr.branch, { 'README.md': 'concurrent edit' }); return rows; } });
    await expect(port.createPullRequest(repo, pr)).rejects.toThrow('브랜치가 변경');
    expect(count('POST', '/pulls')).toBe(0);
    expect(gh.pulls).toHaveLength(0);
  });

  it('does not hide a PR permission error or expose its remote diagnostic', async () => {
    faults.push({ method: 'POST', path: route('/pulls'), status: 403 });
    const failure = await port.createPullRequest(repo, pr).catch((e: unknown) => e);
    expect(failure).toMatchObject({ status: 403 });
    expect(String(failure)).not.toContain('private remote diagnostic');
    expect(count('GET', '/pulls')).toBe(1);
    expect(gh.pulls).toHaveLength(0);
  });

  it('refreshes a revoked installation token during recovery without another PR write', async () => {
    const first = await port.createPullRequest(repo, pr);
    faults.push({ method: 'GET', path: route('/pulls'), status: 401 });
    expect(await port.createPullRequest(repo, pr)).toEqual(first);
    expect(gh.tokens).toHaveLength(2);
    expect(count('POST', '/pulls')).toBe(1);
  });

  it('recovers FAILED and stale PLANNED records through native Feature Platform HTTP with the same prId', async () => {
    const address = proxy.address() as { port: number };
    vi.stubEnv('FF_GITHUB_API_URL', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('FF_GITHUB_APP_ID', '123');
    vi.stubEnv('FF_GITHUB_APP_PRIVATE_KEY', keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const boot = await bootApp({ at: '2026-11-06T01:00:00.000Z' });
    try {
      boot.get<GithubAdapter>(GithubAdapter).reset();
      const rm = actor('recovery-rm', 'RELEASE_MANAGER'), dev = actor('recovery-dev', 'IMPLEMENTER');
      const packages = ['adas', 'ivi', 'body', 'chassis', 'powertrain', 'safety', 'connectivity', 'platform'].map((name) => ({ name, path: `packages/${name}` }));
      const repoId = (await boot.http().post('/api/flag-code/repositories').set(rm).send({ repository, displayName: 'HTTP recovery demo', mode: 'GITHUB_APP', packages, installationId: 42 }).expect(201)).body.repoId;
      const body = { featureId: 'FEAT-00022', version: '1.0.0', repoId };
      await boot.http().post('/api/flag-code/pull-requests').set(actor('viewer', 'COST_VIEWER')).send(body).expect(403);
      faults.push({ method: 'POST', path: route('/pulls'), status: 503 });
      const failed = (await boot.http().post('/api/flag-code/pull-requests').set(dev).send(body).expect(201)).body;
      expect(failed).toMatchObject({ state: 'FAILED', number: null });
      const head = gh.head(fullName, failed.branch);
      const opened = (await boot.http().post('/api/flag-code/pull-requests').set(dev).send(body).expect(201)).body;
      expect(opened).toMatchObject({ prId: failed.prId, state: 'OPEN', number: 1 });
      expect(gh.head(fullName, failed.branch)).toBe(head);
      const service = boot.get<FlagCodeService>(FlagCodeService);
      // Reconstruct the exact durable state left by a crash before saving the successful response.
      service['store'].updatePr({ ...opened, state: 'PLANNED', number: null, url: null, createdAt: '2026-11-06T01:00:00.000Z' }, '2026-11-06T01:00:00.000Z');
      await boot.http().post('/api/flag-code/pull-requests').set(dev).send(body).expect(409);
      expect(gh.pulls).toHaveLength(1);
      service['store'].updatePr({ ...opened, state: 'PLANNED', number: null, url: null, createdAt: '2026-11-06T00:00:00.000Z' }, '2026-11-06T00:00:00.000Z');
      const restored = (await boot.http().post('/api/flag-code/pull-requests').set(dev).send(body).expect(201)).body;
      expect(restored).toMatchObject({ prId: failed.prId, state: 'OPEN', number: 1 });
      const listed = (await boot.http().get('/api/flag-code/pull-requests?featureId=FEAT-00022').expect(200)).body.items;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ prId: failed.prId, state: 'OPEN', number: 1 });
      expect(gh.pulls).toHaveLength(1);
      expect(count('POST', '/git/refs')).toBe(1);
      expect(count('POST', '/pulls')).toBe(2); // first 503 + one accepted PR; PLANNED restore is read-only
    } finally { await boot.app.close(); vi.unstubAllEnvs(); }
  });
});
