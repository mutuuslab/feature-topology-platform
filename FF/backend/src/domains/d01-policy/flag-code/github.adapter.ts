// GitHub App 어댑터(20-97 §1.4) — 설치 토큰으로 커밋 파일 읽기·Flag PR 만들기·Check Run 결과 남기기, Actions OIDC 토큰 검증.
// 비밀(FF_GITHUB_APP_PRIVATE_KEY·FF_GITHUB_WEBHOOK_SECRET)은 서버 설정에서만 읽고 계약·DB·응답에 넣지 않는다. API 주소는 FF_GITHUB_API_URL(모의 GitHub로 바꿀 수 있다).
// 시연 미러(DEMO_MIRROR)는 FF_FLAG_DEMO_REPO 아래의 로컬 Git 저장소를 읽는다(쓰지 않는다).
import { Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, createPublicKey, createSign, createVerify, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { FlagRepository } from '@ff/contracts';
import { FLAG_SOURCE_FILE, type FlagSourceFile } from './scanner';

export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const OIDC_AUDIENCE = 'ff-flag-scan';
/** 공개 저장소에 적힌 모의 webhook 비밀 — 운영 모드에서는 쓰지 않는다 */
export const MOCK_GITHUB_WEBHOOK_SECRET = 'ff-mock-github-secret';
const MAX_FILES = 20_000;

export class GithubError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

/** owner/name — https://github.com/owner/name */
export const repoPath = (repository: string) => new URL(repository).pathname.replace(/^\/+|\/+$/g, '');

/** X-Hub-Signature-256 확인 — 원문 바이트의 HMAC-SHA256. 비밀이 비었으면 모두 거부 */
export function verifyGithubSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const want = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}
export const githubWebhookSecret = (env: Record<string, string | undefined> = process.env) => env.FF_GITHUB_WEBHOOK_SECRET?.trim() || (env.FF_ENV === 'production' ? '' : MOCK_GITHUB_WEBHOOK_SECRET);

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface PullRequestFile {
  path: string;
  /** null이면 지운다 */
  content: string | null;
}

type PullRequestInput = { branch: string; base: string; title: string; body: string; message: string; files: PullRequestFile[] };
const gitSha = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new GithubError('GitHub 커밋·트리 식별자가 올바르지 않습니다.');
  return value;
};

/** 저장소 읽기·쓰기 창구 — 모드별 구현 */
export interface FlagGitPort {
  readonly canWrite: boolean;
  headOf(repo: FlagRepository, branch: string): Promise<string>;
  files(repo: FlagRepository, commit: string): Promise<FlagSourceFile[]>;
  createPullRequest(repo: FlagRepository, pr: PullRequestInput): Promise<{ number: number; url: string; headCommit: string }>;
  checkRun(repo: FlagRepository, run: { headSha: string; conclusion: 'success' | 'failure'; title: string; summary: string }): Promise<void>;
}

/** GitHub App — 설치 토큰(1시간)을 앱 JWT로 받는다 */
class GithubAppPort implements FlagGitPort {
  readonly canWrite = true;
  private readonly tokens = new Map<number, { token: string; until: number }>();
  constructor(private readonly env: Record<string, string | undefined>) {}

  private get api() {
    return (this.env.FF_GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/$/, '');
  }

  private appJwt(): string {
    const appId = this.env.FF_GITHUB_APP_ID?.trim();
    const key = this.env.FF_GITHUB_APP_PRIVATE_KEY?.trim();
    if (!appId || !key) throw new GithubError('FF GitHub App이 설정되지 않았습니다(FF_GITHUB_APP_ID·FF_GITHUB_APP_PRIVATE_KEY).');
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.replace(/\\n/g, '\n'));
    return `${head}.${body}.${b64url(sig)}`;
  }

  private async token(repo: FlagRepository): Promise<string> {
    if (!repo.installationId) throw new GithubError('GitHub App 설치 번호가 없습니다.');
    const cached = this.tokens.get(repo.installationId);
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const r = await this.raw('POST', `/app/installations/${repo.installationId}/access_tokens`, `Bearer ${this.appJwt()}`);
    if(typeof r.token!=='string'||!r.token.trim()||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=Date.now())throw new GithubError('GitHub 설치 토큰의 값·만료 시각이 올바르지 않습니다.');
    const token = r.token;
    this.tokens.set(repo.installationId, { token, until: Date.parse(r.expires_at) });
    return token;
  }

  private async raw(method: string, path: string, auth: string, body?: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(this.api + path, { method, headers: { authorization: auth, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'ff-flag-code', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),redirect:'error' });
    } catch (e) {
      throw new GithubError('GitHub에 연결하지 못했습니다. 연결 주소와 인증 설정을 확인하세요.');
    }
    const text = await res.text();
    if (!res.ok) throw new GithubError(`GitHub ${method} ${path.split('?')[0]} → ${res.status}`, res.status);
    return text ? JSON.parse(text) : {};
  }

  private async call(repo: FlagRepository, method: string, path: string, body?: unknown) {
    const route=`/repos/${repoPath(repo.repository)}${path}`;
    try{return await this.raw(method,route,`token ${await this.token(repo)}`,body);}
    catch(e){if(!(e instanceof GithubError)||e.status!==401)throw e;this.tokens.delete(repo.installationId!);return this.raw(method,route,`token ${await this.token(repo)}`,body);}
  }

  async headOf(repo: FlagRepository, branch: string) {
    return String((await this.call(repo, 'GET', `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`)).object.sha);
  }

  async files(repo: FlagRepository, commit: string): Promise<FlagSourceFile[]> {
    const c = await this.call(repo, 'GET', `/git/commits/${commit}`);
    const tree = await this.call(repo, 'GET', `/git/trees/${c.tree.sha}?recursive=1`);
    if (tree.truncated) throw new GithubError('저장소 트리가 너무 커서 한 번에 읽지 못했습니다 — 스캔 경로를 줄이세요.');
    const inScope = (p: string) => !repo.scanPaths.length || repo.scanPaths.some((s) => p === s || p.startsWith(s.replace(/\/$/, '') + '/'));
    const blobs = (tree.tree as { path: string; type: string; sha: string }[]).filter((t) => t.type === 'blob' && FLAG_SOURCE_FILE.test(t.path) && inScope(t.path));
    if (blobs.length > MAX_FILES) throw new GithubError(`소스 파일이 ${MAX_FILES}개를 넘습니다.`);
    const out: FlagSourceFile[] = [];
    for (const b of blobs) {
      const blob = await this.call(repo, 'GET', `/git/blobs/${b.sha}`);
      out.push({ path: b.path, source: blob.encoding === 'base64' ? Buffer.from(String(blob.content), 'base64').toString('utf8') : String(blob.content) });
    }
    return out;
  }

  private async treeFor(repo: FlagRepository, parent: string, files: PullRequestFile[]) {
    const baseCommit = await this.call(repo, 'GET', `/git/commits/${parent}`);
    if (baseCommit.sha !== parent) throw new GithubError('GitHub 기준 커밋이 일치하지 않습니다.');
    const tree: { path: string; mode: string; type: string; sha: string | null }[] = [];
    for (const f of files) {
      if (f.content === null) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      else tree.push({ path: f.path, mode: '100644', type: 'blob', sha: gitSha((await this.call(repo, 'POST', '/git/blobs', { content: f.content, encoding: 'utf-8' })).sha) });
    }
    return gitSha((await this.call(repo, 'POST', '/git/trees', { base_tree: gitSha(baseCommit.tree?.sha), tree })).sha);
  }

  private async branchOrMissing(repo: FlagRepository, branch: string) {
    try { return gitSha(await this.headOf(repo, branch)); }
    catch (e) { if (e instanceof GithubError && e.status === 404) return null; throw e; }
  }

  /** A retry may reuse only our exact intent and expected tree. Never move/force an existing ref. */
  private async verifiedBranch(repo: FlagRepository, pr: PullRequestInput, head: string, message: string, base: string) {
    const c = await this.call(repo, 'GET', `/git/commits/${head}`);
    if (c.sha !== head || c.message !== message || !Array.isArray(c.parents) || c.parents.length !== 1) throw new GithubError('기존 PR 브랜치의 생성 의도가 다릅니다 — 브랜치를 덮어쓰지 않습니다.', 409);
    const parent = gitSha(c.parents[0]?.sha);
    if (parent !== base) {
      const comparison = await this.call(repo, 'GET', `/compare/${parent}...${base}`);
      if (!['ahead', 'identical'].includes(comparison.status) || comparison.merge_base_commit?.sha !== parent) throw new GithubError('기존 PR의 기준 커밋이 대상 브랜치 이력과 다릅니다.', 409);
    }
    const expectedTree = await this.treeFor(repo, parent, pr.files);
    if (c.tree?.sha !== expectedTree) throw new GithubError('기존 PR 브랜치의 파일 트리가 예상과 다릅니다 — 브랜치를 덮어쓰지 않습니다.', 409);
    return head;
  }

  private pullResult(repo: FlagRepository, pr: PullRequestInput, head: string, opened: any) {
    const fullName = repoPath(repo.repository);
    if (!Number.isSafeInteger(opened?.number) || opened.number < 1 || opened.state !== 'open' || opened.head?.sha !== head || opened.head?.ref !== pr.branch || opened.base?.ref !== pr.base || opened.head?.repo?.full_name?.toLowerCase() !== fullName.toLowerCase() || opened.base?.repo?.full_name?.toLowerCase() !== fullName.toLowerCase() || opened.title !== pr.title || (opened.body ?? '') !== pr.body || opened.html_url !== `https://github.com/${fullName}/pull/${opened.number}`) throw new GithubError('기존/생성된 PR의 저장소·브랜치·커밋·의도가 예상과 다릅니다.', 409);
    return { number: opened.number as number, url: opened.html_url as string, headCommit: head };
  }

  private async openPull(repo: FlagRepository, pr: PullRequestInput, head: string) {
    const query = new URLSearchParams({ state: 'open', head: `${repoPath(repo.repository).split('/')[0]}:${pr.branch}`, base: pr.base, per_page: '100' });
    const found = await this.call(repo, 'GET', `/pulls?${query}`);
    // Exact head/base has at most one open PR. Ambiguous/invalid replies never trigger another POST.
    if (!Array.isArray(found) || found.length > 1) throw new GithubError('기존 PR 조회가 모호합니다 — 중복 PR을 만들지 않습니다.', 409);
    return found.length ? this.pullResult(repo, pr, head, found[0]) : null;
  }

  async createPullRequest(repo: FlagRepository, pr: PullRequestInput) {
    const files = [...pr.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (new Set(files.map((f) => f.path)).size !== files.length) throw new GithubError('PR에 중복 파일 경로가 있습니다.');
    const intent = createHash('sha256').update(JSON.stringify({ version: 1, repository: repoPath(repo.repository).toLowerCase(), branch: pr.branch, base: pr.base, title: pr.title, body: pr.body, message: pr.message, files })).digest('hex');
    const message = `${pr.message}\n\nFF-PR-Intent: ${intent}`;
    const base = gitSha(await this.headOf(repo, pr.base));
    let head = await this.branchOrMissing(repo, pr.branch);
    if (head) head = await this.verifiedBranch(repo, pr, head, message, base);
    else {
      const tree = await this.treeFor(repo, base, files);
      head = gitSha((await this.call(repo, 'POST', '/git/commits', { message, tree, parents: [base] })).sha);
      try { await this.call(repo, 'POST', '/git/refs', { ref: `refs/heads/${pr.branch}`, sha: head }); }
      catch (e) {
        if (!(e instanceof GithubError) || ![409, 422].includes(e.status ?? 0)) throw e;
        const raced = await this.branchOrMissing(repo, pr.branch);
        if (!raced) throw e;
        head = await this.verifiedBranch(repo, pr, raced, message, base);
      }
    }
    const existing = await this.openPull(repo, pr, head);
    if (await this.branchOrMissing(repo, pr.branch) !== head) throw new GithubError('PR 생성 중 브랜치가 변경됐습니다.', 409);
    if (existing) return existing;
    try {
      const opened = await this.call(repo, 'POST', '/pulls', { title: pr.title, head: pr.branch, base: pr.base, body: pr.body });
      return this.pullResult(repo, pr, head, opened);
    } catch (e) {
      // The server may have accepted a POST whose response was lost. Do not hide auth/permission errors.
      if (!(e instanceof GithubError) || (e.status !== null && e.status < 500 && ![408, 409, 422].includes(e.status))) throw e;
      const recovered = await this.openPull(repo, pr, head);
      if (recovered && await this.branchOrMissing(repo, pr.branch) === head) return recovered;
      throw e;
    }
  }

  async checkRun(repo: FlagRepository, run: { headSha: string; conclusion: 'success' | 'failure'; title: string; summary: string }) {
    await this.call(repo, 'POST', '/check-runs', { name: 'FF Flag 검사', head_sha: run.headSha, status: 'completed', conclusion: run.conclusion, output: { title: run.title, summary: run.summary.slice(0, 60_000) } });
  }
}

/** 시연 미러 — 생성기가 만든 로컬 Git 저장소(읽기만). 없으면 픽스처만으로 동작한다 */
class LocalMirrorPort implements FlagGitPort {
  readonly canWrite = false;
  constructor(private readonly dir: string) {}
  private git(repo: FlagRepository, ...args: string[]) {
    const name = basename(repoPath(repo.repository));
    const at = [join(this.dir, `${name}.git`), join(this.dir, name), this.dir].find((p) => existsSync(p) && (basename(p) === name || basename(p) === `${name}.git` || p === this.dir));
    if (!at) throw new GithubError(`시연 저장소 ${name}을(를) 찾지 못했습니다.`);
    return execFileSync('git', ['-c', `safe.directory=${resolve(at).replace(/\\/g, '/')}`, '-C', at, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  async headOf(repo: FlagRepository, branch: string) {
    return this.git(repo, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`).trim();
  }
  async files(repo: FlagRepository, commit: string) {
    const paths = this.git(repo, 'ls-tree', '-r', '--name-only', '-z', commit, '--', ...repo.scanPaths).split('\0').filter((p) => FLAG_SOURCE_FILE.test(p));
    return paths.map((path) => ({ path, source: this.git(repo, 'show', `${commit}:${path}`) }));
  }
  async createPullRequest(): Promise<never> {
    throw new GithubError('시연 미러에는 쓰지 않습니다.');
  }
  async checkRun() {}
}

@Injectable()
export class GithubAdapter {
  private app: GithubAppPort | null = null;

  /** 모드별 창구 — ACTIONS_OIDC는 서버가 저장소를 읽지 않는다(null) */
  port(repo: FlagRepository, env: Record<string, string | undefined> = process.env): FlagGitPort | null {
    if (repo.mode === 'GITHUB_APP') return (this.app ??= new GithubAppPort(env));
    if (repo.mode === 'DEMO_MIRROR' && env.FF_FLAG_DEMO_REPO?.trim()) return new LocalMirrorPort(env.FF_FLAG_DEMO_REPO.trim());
    return null;
  }

  /** 시험용 — 설정이 바뀌면 설치 토큰 캐시를 버린다 */
  reset() {
    this.app = null;
  }

  // ── Actions OIDC ──
  private jwks: { url: string; keys: { kid?: string; kty: string; n?: string; e?: string; alg?: string }[]; at: number } | null = null;

  /** GitHub Actions OIDC 토큰 검증 — 서명(RS256, JWKS)·발급자·aud·유효 기간. 클레임을 돌려준다(토큰은 저장하지 않는다) */
  async verifyOidc(token: string, env: Record<string, string | undefined> = process.env): Promise<Record<string, any>> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new GithubError('OIDC 토큰 형식이 아닙니다.');
    let header: { alg?: string; kid?: string };
    let claims: Record<string, any>;
    try {
      header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
      claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    } catch {
      throw new GithubError('OIDC 토큰을 읽지 못했습니다.');
    }
    if (header.alg !== 'RS256') throw new GithubError('OIDC 토큰 서명 방식이 RS256이 아닙니다.');
    const url = env.FF_GITHUB_OIDC_JWKS_URL?.trim() || `${OIDC_ISSUER}/.well-known/jwks`;
    if (!this.jwks || this.jwks.url !== url || Date.now() - this.jwks.at > 3_600_000 || !this.jwks.keys.some((k) => k.kid === header.kid)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch((e) => {
        throw new GithubError(`OIDC 공개키를 받지 못했습니다: ${(e as Error).message}`);
      });
      if (!res.ok) throw new GithubError(`OIDC 공개키를 받지 못했습니다(${res.status}).`);
      this.jwks = { url, keys: ((await res.json()) as { keys: any[] }).keys ?? [], at: Date.now() };
    }
    const jwk = this.jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new GithubError('OIDC 토큰의 키를 찾지 못했습니다.');
    const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(createPublicKey({ key: jwk as any, format: 'jwk' }), fromB64url(parts[2]));
    if (!ok) throw new GithubError('OIDC 토큰 서명이 맞지 않습니다.');
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== OIDC_ISSUER) throw new GithubError('OIDC 토큰 발급자가 GitHub Actions가 아닙니다.');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(OIDC_AUDIENCE)) throw new GithubError(`OIDC 토큰의 aud가 ${OIDC_AUDIENCE}가 아닙니다.`);
    if (typeof claims.exp !== 'number' || claims.exp < now - 60 || (typeof claims.nbf === 'number' && claims.nbf > now + 60)) throw new GithubError('OIDC 토큰이 만료됐거나 아직 유효하지 않습니다.');
    return claims;
  }
}
