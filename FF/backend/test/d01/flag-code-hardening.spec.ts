// Flag 코드 연결 보강 회귀(20-97 하네스 리뷰 2026-11-06) — 기본 브랜치 대사 원천 오염(포크 PR·오래된 기준 커밋·CI PR 업로드·미래 scannedAt),
// 다른 PR 번호의 닫힘 webhook, 처리 중 실패한 배달의 재전송, 다른 Version 해제의 오적용, 멈춘 PLANNED PR 다시 만들기.
import { INestApplication } from '@nestjs/common';
import { FlagCoverageResponse, FlagReleaseGate } from '@ff/contracts';
import { generateKeyPairSync } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { githubWebhookRequest, startMockGithub, type MockGithub } from '../../../tools/flag-code/mock-github';
import { FlagCodeService } from '../../src/domains/d01-policy/flag-code/flag-code.service';
import { GithubAdapter } from '../../src/domains/d01-policy/flag-code/github.adapter';
import { actor, bootApp } from '../helpers';
import { writeFlagCodeFixture } from './flag-code-fixture';

const DEV = actor('usr-dev', 'IMPLEMENTER');
const RM = actor('usr-rm', 'RELEASE_MANAGER');

describe('Flag 코드 연결 보강 — GitHub App(모의 GitHub)', () => {
  let app: INestApplication;
  let http: () => any;
  let gh: MockGithub;
  let svc: FlagCodeService;
  const SECRET = 'flag-code-hardening-secret';
  const FULL = 'mutuuslab/vehicle-apps-hard';
  const URL_ = `https://github.com/${FULL}`;
  const CI = 'https://github.com/mutuuslab/vehicle-apps-hard-ci';
  const saved: Record<string, string | undefined> = {};
  const env = (k: string, v: string) => ((saved[k] = process.env[k]), (process.env[k] = v));
  const hook = (event: string, payload: unknown, deliveryId?: string) => {
    const req = githubWebhookRequest(event, payload, SECRET, deliveryId);
    return http().post('/api/flag-code/webhooks/github').set(req.headers).send(req.raw);
  };
  const coverage = async () => FlagCoverageResponse.parse((await http().get('/api/flag-code/coverage').expect(200)).body);
  const mainCommit = async (repoId = 'FREPO-001') => (await coverage()).summary.repositories.find((r) => r.repoId === repoId)?.commit;
  const push = (commit: string, deliveryId?: string) => hook('push', { ref: 'refs/heads/main', before: '0'.repeat(40), after: commit, repository: { html_url: URL_ }, installation: { id: 88 } }, deliveryId);
  const file = (key: string) => `export const a = (c) => c.getBooleanValue('care_00022_signal', false);\nexport const b = (c) => c.getBooleanValue('${key}', false);\n`;

  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    gh = await startMockGithub({ appPublicKey: publicKey });
    env('FF_GITHUB_API_URL', gh.url);
    env('FF_GITHUB_APP_ID', '434343');
    env('FF_GITHUB_APP_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    env('FF_GITHUB_WEBHOOK_SECRET', SECRET);
    env('FF_GITHUB_OIDC_JWKS_URL', `${gh.url}/.well-known/jwks`);
    let get: <T>(t: unknown) => T;
    ({ app, http, get } = (await bootApp()) as any);
    svc = get<FlagCodeService>(FlagCodeService);
    get<GithubAdapter>(GithubAdapter).reset();
    gh.addRepo(FULL, 'main', { 'packages/adas/src/a.ts': file('care_00022_param') });
    const packages = ['adas', 'ivi', 'body', 'chassis', 'powertrain', 'safety', 'connectivity', 'platform'].map((name) => ({ name, path: `packages/${name}` }));
    await http().post('/api/flag-code/repositories').set(RM).send({ repository: URL_, displayName: '보강 시험', mode: 'GITHUB_APP', packages, installationId: 88 }).expect(201);
    await http().post('/api/flag-code/repositories').set(RM).send({ repository: CI, displayName: 'CI 업로드 보강', mode: 'ACTIONS_OIDC', packages: [{ name: 'body', path: 'packages/body' }] }).expect(201);
    await push(gh.head(FULL, 'main')).expect(202);
  });
  afterAll(async () => {
    await app?.close();
    await gh?.close();
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });

  it('포크 PR의 머리 브랜치 이름이 기본 브랜치와 같아도 그 스캔은 기본 브랜치 대사 원천이 아니다', async () => {
    const main = gh.head(FULL, 'main');
    const forkHead = gh.commit(FULL, 'attacker-main', { 'packages/adas/src/a.ts': file('adas_88888_fork') });
    const payload = { action: 'opened', repository: { html_url: URL_ }, pull_request: { number: 11, head: { sha: forkHead, ref: 'main', repo: { full_name: 'attacker/vehicle-apps-hard' } }, base: { sha: main, ref: 'main' } } };
    expect((await hook('pull_request', payload).expect(202)).body).toMatchObject({ outcome: 'PR_CHECKED', conclusion: 'failure' });
    const c = await coverage();
    expect(c.rows.some((r) => r.flagKey === 'adas_88888_fork')).toBe(false);
    expect(c.summary.repositories.find((r) => r.repoId === 'FREPO-001')?.commit).toBe(main);
  });

  it('PR의 기준 커밋이 오래된 기본 브랜치 커밋이어도 대사는 가장 최근 기본 브랜치 스캔을 유지한다', async () => {
    const mid = gh.commit(FULL, 'main', { 'packages/adas/src/a.ts': file('adas_77777_old') });
    const latest = gh.commit(FULL, 'main', { 'packages/adas/src/a.ts': file('care_00022_param') });
    await push(latest).expect(202);
    expect(await mainCommit()).toBe(latest);
    const head = gh.commit(FULL, 'feature/late', { 'packages/adas/src/a.ts': file('care_00022_param') });
    const payload = { action: 'opened', repository: { html_url: URL_ }, pull_request: { number: 12, head: { sha: head, ref: 'feature/late' }, base: { sha: mid, ref: 'main' } } };
    await hook('pull_request', payload).expect(202);
    expect(await mainCommit()).toBe(latest);
    expect((await coverage()).rows.some((r) => r.flagKey === 'adas_77777_old')).toBe(false);
  });

  it('다른 PR 번호의 닫힘 webhook은 같은 브랜치 이름의 FF Flag PR을 닫지 않는다', async () => {
    const pr = (await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: 'FEAT-00022', version: '1.0.0', repoId: 'FREPO-001' }).expect(201)).body;
    expect(pr).toMatchObject({ state: 'OPEN', number: expect.any(Number) });
    const closed = (number: number) => ({ action: 'closed', repository: { html_url: URL_ }, pull_request: { number, merged: false, head: { sha: gh.head(FULL, pr.branch), ref: pr.branch, repo: { full_name: 'attacker/vehicle-apps-hard' } }, base: { sha: gh.head(FULL, 'main'), ref: 'main' } } });
    await hook('pull_request', closed(pr.number + 500)).expect(202);
    expect((await http().get('/api/flag-code/pull-requests?featureId=FEAT-00022').expect(200)).body.items[0].state).toBe('OPEN');
    await hook('pull_request', closed(pr.number)).expect(202);
    expect((await http().get('/api/flag-code/pull-requests?featureId=FEAT-00022').expect(200)).body.items[0].state).toBe('CLOSED');
  });

  it('같은 App의 다른 설치가 보낸 배달은 서명이 맞아도 받지 않는다(저장소 사칭)', async () => {
    const commit = gh.commit(FULL, 'main', { 'packages/adas/src/a.ts': file('adas_55555_spoof') });
    const before = await mainCommit();
    const r = await hook('push', { ref: 'refs/heads/main', after: commit, repository: { html_url: URL_ }, installation: { id: 9999 } }, 'delivery-other-install').expect(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    expect(await mainCommit()).toBe(before);
    expect((await http().get('/api/flag-code/repositories').expect(200)).body.items.find((x: { repoId: string }) => x.repoId === 'FREPO-001').webhook).toMatchObject({ state: 'FAILING', lastDeliveryId: 'delivery-other-install' });
  });

  it('처리 중 실패한 배달은 같은 배달 ID로 다시 보내면 중복이 아니라 다시 처리한다', async () => {
    const commit = gh.commit(FULL, 'main', { 'packages/adas/src/a.ts': file('care_00022_param'), 'README.md': '# 재전송\n' });
    const orig = (svc as any).serverScan;
    (svc as any).serverScan = async () => {
      throw new Error('일시 장애');
    };
    try {
      await push(commit, 'delivery-retry').expect(500);
    } finally {
      (svc as any).serverScan = orig;
    }
    const again = (await push(commit, 'delivery-retry').expect(202)).body;
    expect(again).toMatchObject({ outcome: 'SCANNED', status: 'SUCCEEDED' });
    expect(await mainCommit()).toBe(commit);
  });

  it('CI 업로드 — PR 맥락(refs/pull/N/merge)의 결과는 기본 브랜치 원천이 아니고, 미래 scannedAt은 거부한다', async () => {
    const usage = (key: string) => ({ flagKey: key, path: 'packages/body/src/x.ts', line: 1, symbol: 'c.getBooleanValue', method: 'getBooleanValue', safeDefault: 'EXPLICIT_FALSE', contentHash: 'sha256:' + 'c'.repeat(64), via: 'LITERAL' });
    const manifest = (commit: string, key: string, scannedAt = new Date().toISOString()) => ({ format: 'ff-flag-source/v2', provider: 'GITHUB', repository: CI, ref: 'main', commit, scannedAt, scanner: { name: 'ff-flag-scan', version: '2.0.0' }, filesScanned: 1, usages: [usage(key)], unresolved: [] });
    const token = (sha: string, ref: string) => gh.issueOidc({ repository: 'mutuuslab/vehicle-apps-hard-ci', sha, ref, run_id: '7', sub: `repo:mutuuslab/vehicle-apps-hard-ci:ref:${ref}`, workflow_ref: 'mutuuslab/vehicle-apps-hard-ci/.github/workflows/ff-flag-check.yml@refs/heads/main' });
    const c1 = '1'.repeat(40);
    await http().post('/api/flag-code/scans/upload').set(DEV).send({ manifest: manifest(c1, 'care_00022_signal'), oidcToken: token(c1, 'refs/heads/main') }).expect(201);
    expect(await mainCommit('FREPO-002')).toBe(c1);
    // PR 업로드가 manifest.ref를 기본 브랜치로 적어도 기본 브랜치 대사 원천이 되지 않는다
    const pr = '2'.repeat(40);
    await http().post('/api/flag-code/scans/upload').set(DEV).send({ manifest: manifest(pr, 'body_66666_pr'), oidcToken: token(pr, 'refs/pull/5/merge'), prNumber: 5 }).expect(201);
    expect(await mainCommit('FREPO-002')).toBe(c1);
    expect((await coverage()).rows.some((r) => r.flagKey === 'body_66666_pr')).toBe(false);
    // 먼 미래 scannedAt으로 최신 자리를 차지할 수 없다
    const future = '3'.repeat(40);
    await http().post('/api/flag-code/scans/upload').set(DEV).send({ manifest: manifest(future, 'care_00022_signal', '2099-01-01T00:00:00.000Z'), oidcToken: token(future, 'refs/heads/main') }).expect(400);
  });
});

describe('Flag 코드 연결 보강 — 시연 픽스처', () => {
  const NOW = '2026-11-06T01:00:00.000Z';
  let app: INestApplication;
  let http: () => any;
  let svc: FlagCodeService;
  let dir: string;

  beforeAll(async () => {
    dir = writeFlagCodeFixture();
    let get: <T>(t: unknown) => T;
    ({ app, http, get } = (await bootApp({ at: NOW, flagCode: dir })) as any);
    svc = get<FlagCodeService>(FlagCodeService);
  });
  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('다른 Version에 승인된 해제는 이 Version의 출시 관문을 풀지 않는다', async () => {
    const gate = async () => FlagReleaseGate.parse((await http().get('/api/features/FEAT-00014/versions/1.0.0/flag-code-gate').expect(200)).body);
    expect((await gate()).blockers.map((b) => b.flagKey)).toContain('ivi_00014_enable');
    svc['store'].insertWaiver({ waiverId: 'FWV-0900', flagKey: 'ivi_00014_enable', featureId: 'FEAT-00014', version: '0.9.0', reason: '다른 Version의 해제 — 이 Version에는 적용되지 않아야 한다', expiresAt: '2026-11-20T00:00:00.000Z', state: 'APPROVED', coverageStatus: 'PR_OPEN', requestedBy: 'usr-dev', requestedAt: NOW, decidedBy: 'lee.approver', decidedAt: NOW, comment: '승인', decisions: [] });
    const g = await gate();
    expect(g.blockers.map((b) => b.flagKey)).toContain('ivi_00014_enable');
    expect(g.waived.map((w) => w.flagKey)).not.toContain('ivi_00014_enable');
  });

  it('Version 지정 대사 — 그 Version으로 판정한 행이 오고, 출시 차단 행이 출시 관문 차단 목록과 같다', async () => {
    for (const ver of ['2.1.0', '2.2.0']) {
      const c = FlagCoverageResponse.parse((await http().get(`/api/flag-code/coverage?featureId=FEAT-00001&version=${ver}`).expect(200)).body);
      const g = FlagReleaseGate.parse((await http().get(`/api/features/FEAT-00001/versions/${ver}/flag-code-gate`).expect(200)).body);
      expect(c.rows.map((r) => r.flagKey).sort()).toEqual(['adas_00001_enable', 'adas_00001_param', 'adas_00001_signal']);
      expect(c.rows.every((r) => r.version === ver)).toBe(true);
      expect(c.rows.filter((r) => r.releaseBlocking).map((r) => r.flagKey).sort()).toEqual(g.blockers.map((b) => b.flagKey).sort());
    }
  });

  it('GitHub 호출 중 멈춰 PLANNED로 남은 Flag PR은 일정 시간 뒤 다시 만들 수 있다', async () => {
    const branch = 'ff/flags/feat-00002-1.6.0';
    svc['store'].insertPr({ prId: 'FPR-000900', repoId: 'FREPO-001', kind: 'SCAFFOLD', featureId: 'FEAT-00002', version: '1.6.0', flagKeys: ['adas_00002_enable'], branch, number: null, url: null, title: 'Flag 뼈대', state: 'PLANNED', checkConclusion: null, files: [], createdAt: '2026-11-06T00:00:00.000Z', createdBy: 'system:flag-code', mergedAt: null, mergedBy: null, mergeCommit: null, retirementId: null, failure: null });
    const pr = (await http().post('/api/flag-code/pull-requests').set(DEV).send({ featureId: 'FEAT-00002', version: '1.6.0', repoId: 'FREPO-001' }).expect(201)).body;
    expect(pr).toMatchObject({ prId: 'FPR-000900', state: 'OPEN', branch });
  });
});
