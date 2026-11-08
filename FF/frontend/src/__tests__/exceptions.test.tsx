// 예외 승인 화면(/verify/exceptions, GX — FR-EXC-001·002·FR-REG-005-010)·정책 상세 '출시·예외' 패널(FR-RDD-001-006). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ExceptionsScreen } from '../screens/policy/Exceptions';
import { ExceptionPanel } from '../screens/policy/ExceptionPanel';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="*" element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const row = (o: Record<string, unknown>) => ({
  exceptionId: 'EXC-00002',
  kind: 'GATE_PENDING',
  kindLabel: 'Gate 예외',
  featureId: 'FEAT-00001',
  featureVersion: '2.2.0',
  policyId: null,
  checks: [],
  ruleIds: [],
  gates: ['G8', 'G9'],
  restriction: 'LIMITED',
  restrictionLabel: '제한 배포',
  capBasisPoints: 500,
  reason: '현장 품질 문의 대응',
  periodHours: 72,
  dueDate: '2026-11-21',
  residualRisk: '장기 내구 관측 미완',
  status: 'ACTIVE',
  statusLabel: '적용 중',
  requestedBy: 'usr-coordinator',
  requestedAt: '2026-11-07T00:00:00.000Z',
  approvals: [
    { by: 'usr-quality', role: 'SAFETY_OFFICER', at: '2026-11-07T00:10:00.000Z', reason: '확인', expiresAt: '2026-11-09T00:00:00.000Z' },
    { by: 'usr-opslead', role: 'OPS_LEAD', at: '2026-11-07T00:20:00.000Z', reason: '확인', expiresAt: '2026-11-10T00:00:00.000Z' },
  ],
  rejection: null,
  appliedAt: '2026-11-07T00:20:00.000Z',
  expiresAt: '2026-11-09T00:00:00.000Z',
  applications: [],
  closedAt: null,
  revert: null,
  active: true,
  remainingMs: 36 * 3_600_000,
  scope: 'PENDING Gate G8·G9',
  ...o,
});
const WAITING = row({ exceptionId: 'EXC-00003', featureVersion: '3.2.0', status: 'APPROVING', statusLabel: '1차 승인', approvals: [row({}).approvals[0]], appliedAt: null, expiresAt: null, active: false, remainingMs: null, restriction: 'PILOT', restrictionLabel: 'Pilot', capBasisPoints: 100 });

describe('예외 승인 화면', () => {
  it('적용 중·승인 대기 수, 목록, 예외로 열 수 있는 검사와 우회 불가 4가지', async () => {
    handler = (url) => (url.startsWith('/api/exceptions') ? { body: { items: [row({}), WAITING], active: 1 } } : undefined);
    mount('coordinator', '/verify/exceptions', <ExceptionsScreen />);
    expect(await screen.findByText('EXC-00002')).toBeTruthy();
    expect(screen.getByText('EXC-00003')).toBeTruthy();
    expect(screen.getAllByText('우회 불가')).toHaveLength(4);
    expect(screen.getByText('서명·무결성')).toBeTruthy();
    expect(screen.getByText('멈추기(0%)')).toBeTruthy();
  });

  it('상세 — 이미 1차 승인한 사람은 두 번째로 승인할 수 없다(다른 사람이 승인)', async () => {
    handler = (url) => (url.startsWith('/api/exceptions/EXC-00003') ? { body: { ...WAITING, history: [{ at: '2026-11-07T00:00:00.000Z', kind: 'REQUESTED', actorId: 'usr-coordinator', reason: '현장' }] } } : url.startsWith('/api/exceptions') ? { body: { items: [WAITING], active: 0 } } : undefined);
    mount('quality', '/verify/exceptions?id=EXC-00003', <ExceptionsScreen />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/이미 승인했습니다/)).toBeTruthy();
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: '범위 확인' } });
    expect((within(dialog).getByRole('button', { name: '승인' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('상세 — 다른 승인자는 만료 일시와 함께 승인한다', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { body: row({}) };
      return url.startsWith('/api/exceptions/EXC-00003') ? { body: { ...WAITING, history: [] } } : url.startsWith('/api/exceptions') ? { body: { items: [WAITING], active: 0 } } : undefined;
    };
    mount('opslead', '/verify/exceptions?id=EXC-00003', <ExceptionsScreen />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('1차 승인');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: '중단 기준 확인' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/exceptions/EXC-00003/decision')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ decision: 'APPROVE', reason: '중단 기준 확인', expiresAt: expect.stringMatching(/Z$/) });
  });
});

describe('정책 상세 출시·예외 패널', () => {
  const policy = { policyId: 'POL-00031', featureId: 'FEAT-00001', featureVersion: '2.2.0', status: 'APPROVED', exceptionScope: null };
  it('출시 전 Version은 Shadow만 — 미통과 출시 Gate를 보인다', async () => {
    handler = (url) => (url.includes('/release-gate') ? { body: { allowed: false, shadowOnly: true, cap: 0, restriction: null, exceptionIds: [], pendingGates: ['G8', 'G9'], message: '' } } : { body: { items: [] } });
    mount('coordinator', '/policies/POL-00031', <ExceptionPanel policy={policy} />);
    expect(await screen.findByText(/출시 전 Version — Shadow/)).toBeTruthy();
    expect(screen.getByText('미통과 Gate G8·G9')).toBeTruthy();
  });
  it('Gate 예외가 덮으면 제한 범위와 적용 중 예외를 보인다', async () => {
    handler = (url) => (url.includes('/release-gate') ? { body: { allowed: true, shadowOnly: false, cap: 500, restriction: 'LIMITED', exceptionIds: ['EXC-00002'], pendingGates: ['G8', 'G9'], message: '' } } : { body: { items: [row({})], active: 1 } });
    mount('coordinator', '/policies/POL-00031', <ExceptionPanel policy={policy} />);
    expect(await screen.findByText('Gate 예외로 5%까지만 배포할 수 있다')).toBeTruthy();
    expect(await screen.findByText('EXC-00002')).toBeTruthy();
    expect(calls.some((c) => c.url.startsWith('/api/exceptions?featureId=FEAT-00001&featureVersion=2.2.0&active=true'))).toBe(true);
  });
});
