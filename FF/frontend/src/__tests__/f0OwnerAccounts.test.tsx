// 계정 상태 패널(/admin/iam)·컴플라이언스 룰 소유자 이관(D-GAP-1·B13) — 시스템 관리자만 기록·이관 버튼이 열리고, 다른 역할은 막힘 사유를 본다.
// 소유자가 사용 중이고 이관 이력이 없으면 이관 패널을 그리지 않는다(빈 칸 없음). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AccountView } from '@ff/contracts';
import { AppProvider } from '../store';
import { AccountsPanel } from '../screens/admin/AccountsPanel';
import { OwnerTransferPanel } from '../screens/master/OwnerTransfer';

let calls: { url: string; method: string; body: any; role: string | null; id: string | null }[];
const ACCOUNTS: AccountView[] = [
  { id: 'usr-steward', state: 'ACTIVE', roles: ['BOM_APPROVER', 'VARIANT_OWNER', 'REGULATORY_OWNER', 'REFDB_ADMIN'], changedAt: null, changedBy: null, reason: null },
  { id: 'usr-author', state: 'ACTIVE', roles: ['FEATURE_AUTHOR'], changedAt: null, changedBy: null, reason: null },
  { id: 'usr-safety2', state: 'INACTIVE', roles: ['SAFETY_OFFICER'], changedAt: '2026-11-07T01:00:00.000Z', changedBy: 'usr-sysadmin', reason: '부서 이동' },
  { id: 'usr-sysadmin', state: 'ACTIVE', roles: ['SYSTEM_ADMIN'], changedAt: null, changedBy: null, reason: null },
];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, role: h.get('X-Actor-Role'), id: h.get('X-Actor-Id') });
      const body = url.startsWith('/api/accounts') && (init?.method ?? 'GET') === 'GET' ? { items: ACCOUNTS } : { ok: true };
      return new Response(JSON.stringify(body), { status: init?.method && init.method !== 'GET' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, ui: React.ReactNode) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>{ui}</AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('계정 상태 패널', () => {
  it('시스템 관리자 — 사유를 적으면 비활성·재활성 버튼이 열리고, 자기 계정은 막힌다', async () => {
    mount('sysadmin', <AccountsPanel />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(4));
    expect(screen.getByText('비활성 계정 1개')).toBeTruthy();
    const rowOf = (name: RegExp) => screen.getAllByRole('row').find((r) => name.test(r.textContent ?? ''))!;
    const off = () => within(rowOf(/Feature 설계|작성/)).getByRole('button', { name: '비활성으로 기록' }) as HTMLButtonElement;
    expect(off().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/사유/), { target: { value: '퇴사 처리' } });
    await waitFor(() => expect(off().disabled).toBe(false));
    expect((within(rowOf(/서지훈\(시스템 관리자\)시스템 관리자/)).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(off());
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/accounts/usr-author/deactivate', body: { reason: '퇴사 처리' }, role: 'SYSTEM_ADMIN', id: 'usr-sysadmin' }));
    expect(within(rowOf(/부서 이동/)).getByRole('button', { name: '다시 사용 중으로' })).toBeTruthy();
  });

  it('다른 역할은 목록만 — 버튼은 권한 사유로 막힌다', async () => {
    mount('steward', <AccountsPanel />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '비활성으로 기록' }).length).toBeGreaterThan(0));
    for (const b of screen.getAllByRole('button', { name: /비활성으로 기록|다시 사용 중으로/ })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('소유자 이관 패널', () => {
  it('소유자가 사용 중이고 이력이 없으면 그리지 않는다', () => {
    const { container } = mount('sysadmin', <OwnerTransferPanel ruleId="CR-1" ownerId="usr-steward" ownerState="ACTIVE" transfers={[]} />);
    expect(container.querySelector('#owner-transfer')).toBeNull();
  });

  it('소유자가 없으면 — 시스템 관리자가 룰 담당 역할의 사용 중 계정만 골라 사유와 함께 이관한다', async () => {
    mount('sysadmin', <OwnerTransferPanel ruleId="CR-REG-009" ownerId="usr-reg-former" ownerState="ABSENT" transfers={[]} />);
    const select = (await screen.findByLabelText('새 소유자')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2)); // — + 법규 담당(steward). 비활성 safety2·역할 없는 author·관리자는 후보 아님
    expect(select.options[1].value).toBe('usr-steward');
    const go = screen.getByRole('button', { name: '소유자 이관' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'usr-steward' } });
    fireEvent.change(screen.getByLabelText('이관 사유'), { target: { value: '담당 퇴사 이관' } });
    // 막힘 사유가 풀리면 버튼이 다시 그려진다 — 다시 찾는다
    const ready = () => screen.getByRole('button', { name: '소유자 이관' }) as HTMLButtonElement;
    await waitFor(() => expect(ready().disabled).toBe(false));
    fireEvent.click(ready());
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/compliance-rules/CR-REG-009/owner-transfer', body: { toOwnerId: 'usr-steward', reason: '담당 퇴사 이관' }, role: 'SYSTEM_ADMIN' }));
  });

  it('다른 역할은 이관할 수 없고, 이관 이력은 보인다', async () => {
    mount('steward', <OwnerTransferPanel ruleId="CR-REG-008" ownerId="usr-steward" ownerState="ACTIVE" transfers={[{ entity: 'compliance-rule', recordId: 'CR-REG-008', fromOwnerId: 'usr-reg-former', fromState: 'ABSENT', toOwnerId: 'usr-steward', by: 'usr-sysadmin', at: '2026-11-07T02:00:00.000Z', reason: '담당 퇴사 이관' }]} />);
    expect(await screen.findByText('담당 퇴사 이관')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '소유자 이관' })).toBeNull();
  });
});
