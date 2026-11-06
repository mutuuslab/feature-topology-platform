// 활성화 판단 — 차량 목록이 정책 목록보다 먼저 오면 Fleet 조회가 flagKey 없이 나갔다(2026-10-25, 정적 데모 e2e:static이 응답 순서에 따라
// /activation/decide 스냅샷 누락으로 흔들렸다). flagKey가 정해지기 전에는 Fleet 조회를 하지 않는다 — 응답 순서를 시험이 정한다.
// 2026-11-06 ORC-UI02: 서버 정책 평가는 '정책 평가' 탭(?tab=policy)으로 옮겼다 — 첫 화면은 VIN 지원 판정이다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { ActivationScreen } from '../screens/policy/Runtime';

const calls: string[] = [];
let releasePolicies: () => void = () => {};
let policyRows: { flagKey: string; status: string }[];
let vehicleRows: { vin: string; label: string; quality: string }[];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const DECISION = (vin: string, flagKey: string) => ({
  vehicle: { vin, label: vin, quality: 'OK' },
  result: { flagKey, value: true, variant: 'on', decision: 'ALLOW', reason: 'RULE', policyId: 'POL-00001', revision: 1, trace: [] },
  entitlement: { active: true },
});

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  policyRows = [{ flagKey: 'care_00022_param', status: 'DEPLOYED' }];
  vehicleRows = [{ vin: 'ego-01', label: 'ego', quality: 'OK' }, { vin: 'lead-01', label: 'lead', quality: 'OK' }];
  // 정책 목록은 시험이 풀어 줄 때까지 오지 않는다 — 차량 목록이 먼저 도착하는 순서
  const policies = new Promise<void>((ok) => (releasePolicies = ok));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('/api/vehicles')) return json({ items: vehicleRows });
      if (url.startsWith('/api/policies')) {
        await policies;
        return json({ items: policyRows });
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
  const mount = (path = '/activation/decide?tab=policy') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AppProvider><ActivationScreen /></AppProvider></MemoryRouter></QueryClientProvider>);

  it('주소의 미배포 Flag는 선택 표기와 요청을 일치시키고 안내하며, 다른 배포 Flag로 바꾸기 전에는 평가하지 않는다', async () => {
    mount('/activation/decide?tab=policy&vin=ego-01&flagKey=showcase_00280_review');
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/vehicles'))).toBe(true));
    expect(calls.filter((u) => u.startsWith('/api/activation/decide'))).toEqual([]);
    releasePolicies();
    expect(await screen.findByText('선택한 Flag에는 배포된 정책이 없습니다')).toBeTruthy();
    expect(screen.getByLabelText('flagKey')).toHaveValue('showcase_00280_review');
    expect(calls.filter((u) => u.startsWith('/api/activation/decide') || u.startsWith('/ofrep/'))).toEqual([]);
    fireEvent.change(screen.getByLabelText('flagKey'), { target: { value: 'care_00022_param' } });
    await waitFor(() => expect(calls.some((u) => u.includes('flagKey=care_00022_param'))).toBe(true));
    expect(calls.some((u) => u.includes('showcase_00280_review'))).toBe(false);
  });

  it('480대는 화면의25대만 평가하고 검색·다음쪽도 보이는 차량만 요청한다', async () => {
    vehicleRows = Array.from({ length: 480 }, (_, i) => ({ vin: `SHOWCASE-${String(i + 1).padStart(4, '0')}`, label: `가상 차량 ${i + 1}`, quality: 'OK' }));
    policyRows = [{ flagKey: 'aaa_draft', status: 'DRAFT' }, ...policyRows];
    mount(); releasePolicies();
    await screen.findByRole('table', { name: 'Fleet 전체 판단' });
    await waitFor(() => expect(calls.filter((u) => u.startsWith('/api/activation/decide')).length).toBeGreaterThanOrEqual(25));
    expect(new Set(calls.filter((u) => u.startsWith('/api/activation/decide'))).size).toBe(25);
    expect(calls.some((u) => u.includes('aaa_draft'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Fleet 전체 판단 다음' }));
    await waitFor(() => expect(calls.some((u) => u.includes('vin=SHOWCASE-0050'))).toBe(true));
    expect(calls.some((u) => u.includes('vin=SHOWCASE-0051'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Fleet 차량 검색'), { target: { value: 'SHOWCASE-0480' } });
    await waitFor(() => expect(calls.some((u) => u.includes('vin=SHOWCASE-0480'))).toBe(true));
    expect(calls.some((u) => u.includes('vin=SHOWCASE-0479'))).toBe(false);
  });

  it('차량 목록이 먼저 와도 flagKey 없는 판단 조회가 없고(오류도 없고), 정책이 오면 차량마다 한 번씩 묻는다', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/activation/decide?tab=policy']}>
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
