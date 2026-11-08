import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FLAG_PR_RESUME_AFTER_MS, FlagPullRequest, FlagRepository } from '@ff/contracts';
import { AppProvider } from '../store';
import { flagCode as T } from '../copy/flag-code';
import { ResumePrButton } from '../screens/flag-code/common';

const repository = 'https://github.com/demo-owner/recovery';
const repos = [FlagRepository.parse({ repoId: 'FREPO-002', provider: 'GITHUB', repository, displayName: 'Original repository', mode: 'GITHUB_APP', defaultBranch: 'main', scanPaths: [], packages: [{ name: 'adas', path: 'packages/adas' }], scanIntervalMinutes: 0, status: 'ACTIVE', installationId: 42, webhook: { state: 'ACTIVE', lastDeliveryId: null, lastDeliveryAt: null, failureCount: 0, lastError: null }, lastScan: null, createdAt: '2026-11-01T00:00:00Z', createdBy: 'release' })];
const initial = () => FlagPullRequest.parse({ prId: 'FPR-000042', repoId: 'FREPO-002', kind: 'SCAFFOLD', featureId: 'FEAT-00022', version: '1.0.0', flagKeys: ['care_00022_signal', 'care_00022_param'], branch: 'ff/flags/feat-00022-1.0.0', number: null, url: null, title: 'Original intent', state: 'FAILED', checkConclusion: null, files: [], createdAt: new Date(Date.now() - 3_600_000).toISOString(), createdBy: 'original-implementer', mergedAt: null, mergedBy: null, mergeCommit: null, retirementId: null, failure: 'GitHub POST pulls → 503' });
let current: FlagPullRequest;
let writes: { url: string; body: any; role: string }[];
let reads: number;
let mode: 'success' | 'lost' | 'failed' | 'forbidden' | 'unconfirmed';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  localStorage.clear(); current = initial(); writes = []; reads = 0; mode = 'success';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') { reads++; return json({ items: [current] }); }
    writes.push({ url, body: JSON.parse(String(init.body)), role: (init.headers as Record<string, string>)['X-Actor-Role'] });
    if (mode === 'forbidden') return json({ error: { code: 'FORBIDDEN', message: 'Denied' } }, 403);
    if (mode === 'failed') return json(current, 201);
    if (mode === 'unconfirmed') throw new TypeError('response lost before acceptance');
    current = { ...current, state: 'OPEN', number: 7, url: `${repository}/pull/7`, failure: null };
    if (mode === 'lost') throw new TypeError('accepted response lost');
    return json(current, 201);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(role = 'integrator', repositoryList = repos) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter><AppProvider><ResumePrButton prId={current.prId} repos={repositoryList} /></AppProvider></MemoryRouter></QueryClientProvider>);
}
async function resume() {
  await screen.findByRole('button', { name: T.actions.resumePr });
  await waitFor(() => expect(screen.getByRole('button', { name: T.actions.resumePr })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: T.actions.resumePr }));
}

describe('manual Flag PR resume', () => {
  it('reuses the original repository/version and complete Flag set, then shows the confirmed open PR', async () => {
    mount(); await resume();
    expect(await screen.findByRole('link', { name: /#7/ })).toHaveAttribute('href', `${repository}/pull/7`);
    expect(writes).toEqual([{ url: '/api/flag-code/pull-requests', role: 'IMPLEMENTER', body: { featureId: 'FEAT-00022', version: '1.0.0', repoId: 'FREPO-002', flagKeys: ['care_00022_signal', 'care_00022_param'] } }]);
  });
  it('resumes an old PLANNED request through the same POST', async () => {
    current.state = 'PLANNED'; mount(); await resume();
    expect(await screen.findByRole('link', { name: /#7/ })).toBeVisible(); expect(writes).toHaveLength(1);
  });
  it('blocks PLANNED at the exact 10-minute boundary with a visible explanation', async () => {
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
    current = { ...current, state: 'PLANNED', createdAt: new Date(now - FLAG_PR_RESUME_AFTER_MS).toISOString() };
    mount(); await screen.findByText(T.actions.resumeWaiting);
    expect(screen.getByRole('button', { name: T.actions.resumePr })).toBeDisabled(); expect(writes).toHaveLength(0);
  });
  it('keeps read-only users disabled and explains their permission', async () => {
    mount('viewer'); await screen.findByText(T.actions.resumeNote);
    await waitFor(() => expect(screen.getByRole('button', { name: T.actions.resumePr })).toBeDisabled());
    expect(screen.getByText(/구현 담당자 역할/)).toBeVisible(); expect(writes).toHaveLength(0);
  });
  it('refuses a paused or missing original repository instead of choosing another one', async () => {
    mount('integrator', [{ ...repos[0], status: 'PAUSED' }]);
    await screen.findByText(T.actions.resumeNoRepo);
    expect(screen.getByRole('button', { name: T.actions.resumePr })).toBeDisabled(); expect(writes).toHaveLength(0);
  });
  it('recovers a lost API response only after a successful GET confirms the same prId OPEN', async () => {
    mode = 'lost'; mount(); await resume();
    expect(await screen.findByText(T.actions.resumeRecovered)).toBeVisible();
    expect(screen.getByRole('link', { name: /#7/ })).toBeVisible(); expect(reads).toBeGreaterThan(1); expect(writes).toHaveLength(1);
  });
  it('keeps an unconfirmed lost response as an error and allows a later manual resume', async () => {
    mode = 'unconfirmed'; mount(); await resume();
    expect(await screen.findByText(T.actions.resumeUnconfirmed)).toBeVisible();
    expect(screen.queryByText(T.actions.resumeRecovered)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.actions.resumePr })).toBeEnabled(); expect(writes).toHaveLength(1);
  });
  it('does not turn a permission error into recovery success', async () => {
    mode = 'forbidden'; mount(); await resume();
    await screen.findByRole('alert'); expect(reads).toBe(1);
    expect(screen.queryByText(T.actions.resumeRecovered)).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
  });
  it('shows 201 FAILED as failure rather than an open PR', async () => {
    mode = 'failed'; mount(); await resume();
    expect(await screen.findByText(T.actions.createPrFailed(current.failure!))).toBeVisible();
    expect(screen.queryByText(T.actions.resumeDone)).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /#7/ })).not.toBeInTheDocument();
  });
  it('preserves the original Retirement when resuming a removal PR', async () => {
    current = { ...current, kind: 'REMOVAL', flagKeys: ['care_00022_signal'], retirementId: 'RET-00042' };
    mount(); await resume(); await screen.findByRole('link', { name: /#7/ });
    expect(writes[0]).toMatchObject({ url: '/api/flag-code/removal-pull-requests', body: { flagKey: 'care_00022_signal', repoId: 'FREPO-002', retirementId: 'RET-00042' } });
  });
});
