// GitLab · JIRA · codeBeamer 양방향 연계 화면 — 외부 항목 칩(새 탭 링크·동기 상태·G2 재검토), Feature 연계 탭(문제 목록),
// 변경요청 목록(플랫폼 정책 상태와 어긋남 = 핵심 메시지), 정책 근거 CR 연결, 외부 연계 충돌 처리. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppProvider } from '../store';
import { ExtRefChip } from '../design';
import { ExtLinksTab } from '../screens/features/ExtLinksTab';
import { ChangesScreen } from '../screens/master/Trace';
import { PolicyCrPanel } from '../screens/policy/PolicyCr';
import { ExtSyncTab } from '../screens/ext/ExtSyncTab';
import { ApprovalInboxScreen } from '../screens/home/Inbox';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: unknown }[];

const REF = (o: Record<string, unknown>) => ({ system: 'JIRA', kind: 'CHANGE_REQUEST', key: 'FFCR-1', url: 'https://jira.ff.example/browse/FFCR-1', title: 'Flag 신설', status: 'In Review', revision: 1, syncState: 'SYNCED', syncedAt: null, stale: false, extra: {}, linkId: 1, entity: 'FEATURE', entityId: 'FEAT-00022@1.0.0', createdAt: '2026-10-18T00:00:00.000Z', ...o });

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

const mount = (role: string, node: ReactNode, path = '/') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="*" element={node} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('외부 항목 칩', () => {
  it('도구 이름은 글자로, 키는 새 탭 링크, 동기 문제·G2 재검토는 글자와 아이콘으로', () => {
    mount('viewer', <ExtRefChip r={REF({ system: 'CODEBEAMER', kind: 'REQUIREMENT', key: 'CB-10001', url: 'https://codebeamer.ff.example/cb/issue/10001', syncState: 'CONFLICT', stale: true }) as never} />);
    const a = screen.getByRole('link', { name: 'CB-10001' });
    expect(a.getAttribute('href')).toBe('https://codebeamer.ff.example/cb/issue/10001');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('codeBeamer')).toBeTruthy();
    expect(screen.getByText('충돌')).toBeTruthy();
    expect(screen.getByText('G2 재검토')).toBeTruthy();
  });
});

describe('Feature 연계 탭', () => {
  it('없는 요구 ID·개정된 요구·Epic 상태 불일치·충돌을 문제로 먼저 보이고, 정책의 근거 CR이 없으면 표시', async () => {
    handler = (url) =>
      url.startsWith('/api/integrations/sync/features/')
        ? {
            body: {
              featureId: 'FEAT-00022',
              version: '1.0.0',
              lifecycle: 'RELEASED',
              epicStatusExpected: 'Released',
              requirements: [REF({ system: 'CODEBEAMER', kind: 'REQUIREMENT', key: 'CB-10001', stale: true, extra: { reqId: 'REQ-CARE-0001' } })],
              missingRequirements: ['REQ-X-9'],
              epic: REF({ kind: 'EPIC', key: 'FFE-3', status: 'In Progress' }),
              changeRequests: [REF({})],
              defects: [],
              mergeRequests: [REF({ system: 'GITLAB', kind: 'MERGE_REQUEST', key: 'vehicle/feature-sw!101', status: 'merged', extra: { sourceBranch: 'feature/feat-00022-1.0.0', pipeline: { status: 'success' } } })],
              pipelines: [],
              policies: [{ policyId: 'POL-00001', flagKey: 'care_00022_param', status: 'DEPLOYED', changeRequests: [] }],
              conflicts: [{ conflictId: 1, key: 'FFE-3' }],
              stale: ['CB-10001'],
            },
          }
        : undefined;
    mount('viewer', <ExtLinksTab id="FEAT-00022" ver="1.0.0" />);
    const tab = await screen.findByTestId('ext-links');
    const issues = within(tab).getByRole('list', { name: /추적/ });
    expect(within(issues).getByText(/REQ-X-9/)).toBeTruthy();
    expect(within(issues).getByText(/개정된 요구 1건/)).toBeTruthy();
    expect(within(issues).getByText(/'In Progress'.*'Released'/)).toBeTruthy();
    expect(within(issues).getByText(/충돌 1건/)).toBeTruthy();
    expect(within(tab).getByText('feature/feat-00022-1.0.0')).toBeTruthy();
    expect(within(tab).getByText('근거 변경요청 없음')).toBeTruthy();
  });
});

describe('변경요청 목록 (JIRA)', () => {
  it('플랫폼 정책 상태와 어긋난 CR 수가 핵심 메시지, 기대 JIRA 상태를 나란히', async () => {
    handler = (url) =>
      url === '/api/integrations/sync/change-requests'
        ? {
            body: {
              items: [
                { ...REF({ key: 'FFCR-1', status: 'In Review' }), policies: [{ policyId: 'POL-00001', flagKey: 'care_00022_param', status: 'APPROVED', stage: null, expectedCrStatus: 'Approved' }], features: ['FEAT-00022@1.0.0'] },
                { ...REF({ key: 'FFCR-2', status: 'Deployed' }), policies: [{ policyId: 'POL-00002', flagKey: 'care_00022_signal', status: 'DEPLOYED', stage: 10000, expectedCrStatus: 'Deployed' }], features: [] },
              ],
            },
          }
        : url.startsWith('/api/changes')
          ? { body: { items: [] } }
          : undefined;
    mount('viewer', <ChangesScreen />, '/change/cr');
    await screen.findByRole('link', { name: 'FFCR-1' });
    const key = document.querySelector('[data-key-message]')!;
    expect(key.querySelector('.ds-key__value')?.textContent).toBe('1');
    expect(key.textContent).toContain('플랫폼 정책 상태와 다릅니다');
    const table = screen.getByRole('table', { name: 'JIRA 변경요청' });
    // 어긋난 CR이 먼저
    expect(within(table).getAllByRole('link', { name: /^FFCR-/ }).map((l) => l.textContent)).toEqual(['FFCR-1', 'FFCR-2']);
    expect(within(table).getByRole('link', { name: 'POL-00001' }).getAttribute('href')).toBe('/policies/POL-00001');
  });
});

describe('정책 근거 CR', () => {
  it('연결이 없으면 안내, 작성자는 CR 키로 연결(POST change-request)', async () => {
    let linked = false;
    handler = (url, init) => {
      if (url === '/api/policies/POL-00009/change-request' && init?.method === 'POST') {
        linked = true;
        return { body: { items: [REF({ key: 'FFCR-7' })] } };
      }
      if (url === '/api/policies/POL-00009/ext-links') return { body: { items: linked ? [REF({ key: 'FFCR-7', entity: 'POLICY', entityId: 'POL-00009' })] : [] } };
      return undefined;
    };
    mount('author', <PolicyCrPanel policyId="POL-00009" />);
    expect(await screen.findByText(/연결된 변경요청이 없습니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/변경요청 키/), { target: { value: 'ffcr-7' } });
    fireEvent.click(screen.getByRole('button', { name: '변경요청 연결' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && (c.body as { crKey: string }).crKey === 'FFCR-7')).toBe(true));
    expect(await screen.findByRole('link', { name: 'FFCR-7' })).toBeTruthy();
  });

  it('조회 역할에는 연결 입력을 보이지 않는다', async () => {
    handler = () => ({ body: { items: [] } });
    mount('viewer', <PolicyCrPanel policyId="POL-00009" />);
    expect(await screen.findByText(/연결된 변경요청이 없습니다/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '변경요청 연결' })).toBeNull();
  });
});

describe('외부 연계 — 양방향 탭', () => {
  it('충돌은 사유를 적어야 고를 수 있고, 플랫폼 값 다시 보내기를 누르면 처리 요청', async () => {
    handler = (url) => {
      if (url === '/api/integrations/sync') return { body: { items: [{ system: 'JIRA', ifId: 'IF-14', mode: 'mock', baseUrl: '', links: 120, pending: 0, failed: 1, conflicts: 1, rejected: 2, lastInboundAt: null, lastOutboundAt: null }], ownership: [{ fact: 'Feature Lifecycle', owner: 'PLATFORM', reverse: '전이 요청' }] } };
      if (url.startsWith('/api/integrations/sync/conflicts')) return { body: { items: [{ conflictId: 4, system: 'JIRA', key: 'FFE-9', field: 'status', platformValue: 'Deprecated', externalValue: 'Closed', createdAt: '2026-10-18T01:00:00.000Z' }] } };
      return undefined;
    };
    mount('integrator', <ExtSyncTab />);
    const table = await screen.findByRole('table', { name: /충돌/ });
    const btn = within(table).getByRole('button', { name: '플랫폼 값 다시 보내기' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '플랫폼 Lifecycle 기준' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(calls.find((c) => c.url === '/api/integrations/sync/conflicts/4/resolve')?.body).toEqual({ choose: 'PLATFORM', reason: '플랫폼 Lifecycle 기준' }));
    expect(screen.getByText('Feature Platform')).toBeTruthy();
  });
});

describe('검토함 — 외부 연계 충돌', () => {
  it('열린 동기화 충돌은 시스템 연계 담당의 내 차례, 외부 연계 화면으로 간다', async () => {
    handler = (url) => (url.startsWith('/api/integrations/sync/conflicts') ? { body: { items: [{ conflictId: 4, system: 'JIRA', key: 'FFE-9', field: 'status', platformValue: 'Deprecated', externalValue: 'Closed', createdAt: '2026-10-18T01:00:00.000Z' }] } } : undefined);
    mount('integrator', <ApprovalInboxScreen />, '/admin/approval');
    const table = await screen.findByRole('table', { name: '외부 연계 충돌' });
    const row = within(table).getByText('JIRA FFE-9').closest('tr')!;
    expect(within(row).getByText('status: Deprecated ↔ Closed')).toBeTruthy();
    expect(within(row).getByRole('link', { name: '열기' }).getAttribute('href')).toBe('/integration/connectors?tab=sync');
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('1');
  });
});
