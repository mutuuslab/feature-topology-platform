// 홈·등록 v2 화면 (P10-C4) — 검토함(내 차례 판정은 contracts approvalCheck), 내 대시보드, Feature 제안·등록. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ApprovalInboxScreen, DefineScreen, HomeScreen, ProposeScreen } from '../screens/home/Inbox';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = handler(url, init) ?? { body: { items: [] } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, el: JSX.Element, extra?: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
            {extra}
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const inboxApi: Handler = (url) => {
  if (url.startsWith('/api/baselines/requests')) return { body: { items: [{ requestId: 'BR-1', featureId: 'FEAT-00022', version: '1.1.0', requestedBy: 'usr-author', requestedAt: '2026-10-12T01:00:00.000Z' }] } };
  if (url.startsWith('/api/policies')) return { body: { items: [{ policyId: 'POL-9', flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'VALIDATED', createdBy: 'usr-author', createdAt: '2026-10-12T02:00:00.000Z' }] } };
  if (url.startsWith('/api/kill-requests'))
    return {
      body: {
        items: [
          { killId: 'KILL-1', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'REQUESTED', fClass: 'F2', reasonCategory: 'SAFETY', requestedBy: 'usr-operator', requestedAt: '2026-10-12T03:00:00.000Z', approvals: [] },
          { killId: 'KILL-2', featureId: 'FEAT-00024', featureVersion: '1.0.0', status: 'ACTIVE', fClass: 'F2', reasonCategory: 'SAFETY', requestedBy: 'usr-operator', requestedAt: '2026-10-11T03:00:00.000Z', approvals: [{ approverId: 'usr-steward', role: 'FSM' }, { approverId: 'usr-coordinator', role: 'OPS_LEAD' }], restoreRequest: { status: 'REQUESTED', requestedBy: 'usr-operator', requestedAt: '2026-10-12T04:00:00.000Z', approvals: [] } },
        ],
      },
    };
};

describe('검토함 v2', () => {
  it('BOM 승인자·Safety Manager(steward) — Baseline·차단은 내 차례, 정책 승인과 내가 차단한 건의 복원은 아니다', async () => {
    handler = inboxApi;
    mount('steward', '/admin/approval', <ApprovalInboxScreen />);
    expect(await screen.findByText('FEAT-00022 1.1.0')).toBeTruthy();
    expect(await screen.findByText('KILL-1')).toBeTruthy();
    expect(screen.queryByText(/POL-9/)).toBeNull();
    expect(screen.queryByText('KILL-2')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /전체/ }));
    expect(await screen.findByText(/POL-9/)).toBeTruthy();
    const restore = screen.getByText('KILL-2').closest('tr')!;
    expect(within(restore).getByText('직전 차단을 승인한 사람은 복원을 승인할 수 없습니다')).toBeTruthy();
    expect(within(restore).getByRole('link', { name: '열기' }).getAttribute('href')).toBe('/ops/kill?id=KILL-2');
  });

  it('요청자 본인은 자기 차단 요청을 승인할 차례가 아니다(직무 분리)', async () => {
    handler = inboxApi;
    mount('operator', '/admin/approval', <ApprovalInboxScreen />);
    fireEvent.click(await screen.findByRole('radio', { name: /전체/ }));
    const row = (await screen.findByText('KILL-1')).closest('tr')!;
    expect(within(row).getByText(/요청자는 같은 명령을 승인할 수 없습니다/)).toBeTruthy();
  });
});

describe('내 대시보드 · Feature 제안 · 등록 v2', () => {
  it('내 대시보드 — 내 차례 수와 Lifecycle 분포 링크', async () => {
    handler = (url) => {
      if (url.startsWith('/api/features')) return { body: { items: [{ featureId: 'FEAT-1', version: '1.0.0', lifecycle: 'RELEASED' }, { featureId: 'FEAT-2', version: '0.1.0', lifecycle: 'PROPOSED' }] } };
      return inboxApi(url);
    };
    mount('steward', '/', <HomeScreen />);
    const link = await screen.findByRole('link', { name: /PROPOSED|제안/ });
    expect(link.getAttribute('href')).toBe('/features?lifecycle=PROPOSED');
  });

  it('Feature 제안 — 필수 항목 전에는 막히고, 등록하면 새 Feature 상세로 간다', async () => {
    handler = (url, init) => (url === '/api/features' && init?.method === 'POST' ? { status: 201, body: { featureId: 'FEAT-00500', version: '0.1.0' } } : undefined);
    mount('author', '/feature/propose', <ProposeScreen />, <Route path="/features/:id/:ver" element={<div>detail-page</div>} />);
    const submit = screen.getByRole('button', { name: '제안 등록' });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '좌석 열선 원격' } });
    fireEvent.change(screen.getByLabelText('설명'), { target: { value: '원격으로 좌석 열선을 켠다' } });
    fireEvent.change(screen.getByLabelText('담당'), { target: { value: 'Body Platform Team' } });
    fireEvent.change(screen.getByLabelText('요구사항 ID (쉼표로 구분)'), { target: { value: 'REQ-1, REQ-2' } });
    fireEvent.click(screen.getByRole('button', { name: '제안 등록' }));
    expect(await screen.findByText('detail-page')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ name: '좌석 열선 원격', requirementIds: ['REQ-1', 'REQ-2'], controlPoints: ['Flag'], asil: 'QM' });
  });

  it('Feature 등록 — 출시 전 Version만, 다음 할 일과 Gate PASS 수', async () => {
    handler = () => ({ body: { items: [{ featureId: 'FEAT-1', version: '1.0.0', name: 'a', lifecycle: 'RELEASED', ownerId: 'o', gates: {} }, { featureId: 'FEAT-2', version: '0.1.0', name: 'b', lifecycle: 'PROPOSED', ownerId: 'o', gates: { G1: 'PASS', G2: 'PASS', G3: 'REVIEW' } }] } });
    mount('author', '/master/define', <DefineScreen />);
    const row = (await screen.findByRole('link', { name: 'FEAT-2 0.1.0' })).closest('tr')!;
    expect(within(row).getByText('G1~G3 판정 → Feature 승인')).toBeTruthy();
    expect(within(row).getByText('2/9')).toBeTruthy();
    expect(screen.queryByText('FEAT-1 1.0.0')).toBeNull();
  });
});
