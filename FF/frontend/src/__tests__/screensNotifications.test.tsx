// 알림 센터(D04-04) — 상단바 종(안 읽음 배지·최근 알림)과 /notifications 화면(목록·읽음·메일 설정·발송 기록). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { NotificationsScreen } from '../screens/home/Notifications';
import { NotificationBell } from '../shell/NotificationBell';

let calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[];

const n = (id: string, over: Record<string, unknown> = {}) => ({
  notificationId: id,
  eventSeq: Number(id.slice(-1)),
  eventType: 'kill.requested',
  aggregate: { type: 'kill', id: 'KILL-1' },
  category: 'APPROVAL',
  severity: 'CRITICAL',
  title: 'FEAT-00022 긴급 차단 승인 요청',
  fields: [
    { label: '사유', value: 'SAFETY' },
    { label: '요청자', value: 'usr-operator' },
  ],
  link: '/ops/kill?id=KILL-1',
  recipients: [{ kind: 'role', role: 'FSM' }],
  exclude: ['usr-operator'],
  requirementIds: [],
  createdAt: '2026-10-17T01:02:00.000Z',
  readAt: null,
  ...over,
});
const ITEMS = [n('NTF-00002'), n('NTF-00001', { category: 'OPS', severity: 'WARNING', title: '이상 징후 ANM-1', link: '/ops/anomalies?id=ANM-1', readAt: '2026-10-17T02:00:00.000Z', fields: [] })];
const PREFS = { userId: 'usr-approver', email: { APPROVAL: true, SAFETY: true, DEPLOY: true, GATE: false, OPS: true, INTEGRATION: false }, locked: ['APPROVAL', 'SAFETY'], address: 'approver@ff-demo.invalid' };

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let body: unknown = { items: [] };
      if (url.startsWith('/api/notifications/preferences')) body = method === 'GET' ? PREFS : { ...PREFS, email: (JSON.parse(String(init!.body)) as typeof PREFS).email };
      else if (url.startsWith('/api/notifications/emails')) body = { items: [{ id: 'EML-1', notificationId: 'NTF-00002', userId: 'usr-approver', address: 'approver@ff-demo.invalid', subject: '[긴급] FEAT-00022 긴급 차단 승인 요청', status: 'SENT', at: '2026-10-17T01:02:00.000Z' }] };
      else if (url.startsWith('/api/notifications/read-all')) body = { read: 1 };
      else if (/\/api\/notifications\/[^/]+\/read/.test(url)) body = { notificationId: 'NTF-00002', readAt: '2026-10-17T03:00:00.000Z' };
      else if (url.startsWith('/api/notifications')) {
        const unread = url.includes('unread=true');
        const items = unread ? ITEMS.filter((x) => !x.readAt) : ITEMS;
        body = { items, unread: 1, byCategory: { APPROVAL: 1 } };
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, el: JSX.Element, path = '/notifications') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
            <Route path="/ops/kill" element={<h1>긴급 차단 콘솔</h1>} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('알림 화면', () => {
  it('내 알림은 행위자 헤더로 읽고, 안 읽음만 보이다가 전체로 바꾸면 읽은 알림도 보인다', async () => {
    mount('approver', <NotificationsScreen />);
    expect(await screen.findByText('FEAT-00022 긴급 차단 승인 요청')).toBeTruthy();
    const get = calls.find((c) => c.url.startsWith('/api/notifications?') && c.url.includes('unread=true'))!;
    expect(get.headers['X-Actor-Id']).toBe('usr-approver');
    expect(screen.queryByText('이상 징후 ANM-1')).toBeNull();
    const row = screen.getAllByTestId('notification-row')[0];
    expect(within(row).getByText('긴급')).toBeTruthy();
    expect(within(row).getByText('승인 요청')).toBeTruthy();
    expect(within(row).getByText('usr-operator')).toBeTruthy();
    expect(within(row).getByRole('link', { name: '열기' }).getAttribute('href')).toBe('/ops/kill?id=KILL-1');
    fireEvent.click(screen.getByRole('radio', { name: /전체/ }));
    expect(await screen.findByText('이상 징후 ANM-1')).toBeTruthy();
    expect(screen.getByText(/^읽음 2026-10-17 02:00/)).toBeTruthy();
  });

  it('읽음·모두 읽음은 쓰기 요청으로 보낸다', async () => {
    mount('approver', <NotificationsScreen />);
    const row = (await screen.findAllByTestId('notification-row'))[0];
    fireEvent.click(within(row).getByRole('button', { name: '읽음' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/notifications/NTF-00002/read')).toBe(true));
    const post = calls.find((c) => c.url === '/api/notifications/NTF-00002/read')!;
    expect(post.headers['Idempotency-Key']).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '모두 읽음' })[0]);
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/notifications/read-all')).toBe(true));
  });

  it('메일 설정 — 승인 요청·긴급 차단은 끌 수 없고, 다른 범주를 바꾸면 전체 설정을 보낸다', async () => {
    mount('approver', <NotificationsScreen />);
    const approval = await screen.findByRole('checkbox', { name: '승인 요청' });
    expect((approval as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText('항상 발송')).toHaveLength(2);
    expect(screen.getByText('approver@ff-demo.invalid')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gate 판정' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/notifications/preferences')).toBe(true));
    const save = calls.find((c) => c.method === 'POST' && c.url === '/api/notifications/preferences')!;
    expect(save.body).toEqual({ email: { ...PREFS.email, GATE: true } });
    expect(await screen.findByText('메일 설정을 저장했습니다.')).toBeTruthy();
    expect(screen.getByText('[긴급] FEAT-00022 긴급 차단 승인 요청')).toBeTruthy();
  });
});

describe('상단바 알림', () => {
  it('안 읽음 수 배지 → 펼치면 최근 알림, Esc로 닫고, 알림을 누르면 읽음 처리 후 관련 화면으로 간다', async () => {
    mount('approver', <NotificationBell />, '/');
    expect((await screen.findByTestId('notify-badge')).textContent).toBe('1');
    const bell = screen.getByRole('button', { name: /안 읽음 1건/ });
    fireEvent.click(bell);
    const pop = screen.getByRole('dialog', { name: '최근 알림' });
    expect(within(pop).getByText('FEAT-00022 긴급 차단 승인 요청')).toBeTruthy();
    expect(within(pop).getByRole('link', { name: '알림 전체 보기' }).getAttribute('href')).toBe('/notifications');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(bell);
    fireEvent.click(within(screen.getByRole('dialog')).getByText('FEAT-00022 긴급 차단 승인 요청'));
    expect(await screen.findByRole('heading', { name: '긴급 차단 콘솔' })).toBeTruthy();
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/notifications/NTF-00002/read')).toBe(true));
  });
});
