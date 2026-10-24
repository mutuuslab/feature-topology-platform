// 활성화 판단 — 차량 목록이 정책 목록보다 먼저 오면 Fleet 조회가 flagKey 없이 나갔다(2026-10-25, 정적 데모 e2e:static이 응답 순서에 따라
// /activation/decide 스냅샷 누락으로 흔들렸다). flagKey가 정해지기 전에는 Fleet 조회를 하지 않는다 — 응답 순서를 시험이 정한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { ActivationScreen } from '../screens/policy/Runtime';

const calls: string[] = [];
let releasePolicies: () => void = () => {};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const DECISION = (vin: string, flagKey: string) => ({
  vehicle: { vin, label: vin, quality: 'OK' },
  result: { flagKey, value: true, variant: 'on', decision: 'ALLOW', reason: 'RULE', policyId: 'POL-00001', revision: 1, trace: [] },
  entitlement: { active: true },
});

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  // 정책 목록은 시험이 풀어 줄 때까지 오지 않는다 — 차량 목록이 먼저 도착하는 순서
  const policies = new Promise<void>((ok) => (releasePolicies = ok));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('/api/vehicles')) return json({ items: [{ vin: 'ego-01', label: 'ego', quality: 'OK' }, { vin: 'lead-01', label: 'lead', quality: 'OK' }] });
      if (url.startsWith('/api/policies')) {
        await policies;
        return json({ items: [{ flagKey: 'care_00022_param', status: 'DEPLOYED' }] });
      }
      if (url.startsWith('/api/activation/decide')) {
        const q = new URL(url, 'http://x').searchParams;
        return json(DECISION(q.get('vin') ?? '', q.get('flagKey') ?? ''));
      }
      return json({ items: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('활성화 판단 — Fleet 조회는 flagKey가 정해진 뒤에만', () => {
  it('차량 목록이 먼저 와도 flagKey 없는 판단 조회가 없고(오류도 없고), 정책이 오면 차량마다 한 번씩 묻는다', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/activation/decide']}>
          <AppProvider>
            <ActivationScreen />
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/vehicles'))).toBe(true));
    // 차량 목록이 화면에 반영될 때까지(정책은 아직)
    await waitFor(() => expect(qc.getQueryCache().findAll({ queryKey: ['vehicles'] }).some((q) => q.state.status === 'success')).toBe(true));
    const early = qc.getQueryCache().findAll({ queryKey: ['activationDecide'] });
    // 수정 전: 차량마다 { vin, flagKey: '' } 조회가 나가(정적 데모는 없는 스냅샷, 실서버는 400) 오류가 됐다
    expect(early.filter((q) => q.state.status === 'error' || q.state.fetchStatus === 'fetching')).toEqual([]);
    expect(calls.filter((u) => u.startsWith('/api/activation/decide'))).toEqual([]);

    releasePolicies();
    await waitFor(() => expect(calls.filter((u) => u.startsWith('/api/activation/decide')).length).toBeGreaterThanOrEqual(2));
    const decided = calls.filter((u) => u.startsWith('/api/activation/decide'));
    expect(decided.every((u) => /[?&]flagKey=care_00022_param(&|$)/.test(u))).toBe(true);
    expect(await screen.findAllByText(/care_00022_param/)).not.toEqual([]);
  });
});
