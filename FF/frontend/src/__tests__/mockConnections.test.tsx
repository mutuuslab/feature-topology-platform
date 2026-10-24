// readiness: RD-UX-04 — 모의 연계(메일·과금·OTA·Data Lake)는 화면에 '모의(연결 전)'·'연결 안 됨'으로 보이고, 결과를 실제처럼 표시하지 않는다.
// 표시 여부는 서버 설정(/api/system/connections)이 정한다 — 실제 연결(live)이면 표시가 사라진다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectionsResponse } from '@ff/contracts';
import { ConnectionBadge } from '../design';
import { connections as CN } from '../copy/connections';
import { AppProvider } from '../store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const status = (mode: 'production' | 'demo', mail: 'live' | 'mock' | 'off' = 'mock'): ConnectionsResponse => ({
  mode,
  items: [
    { key: 'mail', mode: mail, ifId: null, liveAdapter: mail === 'live' },
    { key: 'billing', mode: 'mock', ifId: null, liveAdapter: false },
    { key: 'ota', mode: 'mock', ifId: 'IF-05', liveAdapter: false },
    { key: 'datalake', mode: 'off', ifId: null, liveAdapter: false },
  ],
});
const EMAILS = { items: [{ id: 'EML-1', notificationId: 'NTF-00002', userId: 'usr-approver', address: 'a@oem.example', subject: '승인 요청', status: 'SENT', at: '2026-10-24T01:00:00.000Z' }] };

function stub(conn: ConnectionsResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/system/connections')) return json(conn);
      if (url.startsWith('/api/notifications/emails')) return json(EMAILS);
      if (url.startsWith('/api/notifications/preferences')) return json({ userId: 'usr-approver', email: { APPROVAL: true, SAFETY: true, DEPLOY: true, GATE: false, OPS: true, INTEGRATION: false }, locked: ['APPROVAL', 'SAFETY'], address: 'a@oem.example' });
      if (url.startsWith('/api/notifications')) return json({ items: [], unread: 0, byCategory: {} });
      return json({ items: [] });
    }),
  );
}

async function renderNotifications() {
  const { NotificationsScreen } = await import('../screens/home/Notifications');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>
          <NotificationsScreen />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('모의 연계 표시 (RD-UX-04)', () => {
  it('ConnectionBadge — 모의·연결 안 됨은 글자와 설명, 실제 연결이면 그리지 않는다', () => {
    const { container, rerender } = render(<ConnectionBadge state="mock" system={CN.system.mail} />);
    expect(screen.getByText(CN.label.mock)).toBeTruthy();
    expect(screen.getByText(CN.hint.mock(CN.system.mail))).toBeTruthy();
    rerender(<ConnectionBadge state="disconnected" system={CN.system.billing} />);
    expect(screen.getByText(CN.label.disconnected)).toBeTruthy();
    rerender(<ConnectionBadge state="none" system={CN.system.mail} />);
    expect(container.textContent).toBe('');
  });

  it('데모 설치 — 메일 기록에 모의(연결 전) 표시, 발송 상태는 "모의 발송"(SENT를 실제처럼 보이지 않는다)', async () => {
    stub(status('demo'));
    await renderNotifications();
    await waitFor(() => expect(document.querySelector('section[aria-labelledby="ntf-emails-h"] [data-connection="mock"]')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(CN.mail.mockStatus)).toBeTruthy());
    expect(screen.queryByText('SENT')).toBeNull();
  });

  it('운영 설치 — 같은 모의 메일이 "연결 안 됨"·"보내지 않음"', async () => {
    stub(status('production'));
    await renderNotifications();
    await waitFor(() => expect(document.querySelector('section[aria-labelledby="ntf-emails-h"] [data-connection="disconnected"]')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(CN.mail.notSent)).toBeTruthy());
  });

  it('실제 연결(live)이면 표시가 사라지고 서버 상태를 그대로 보인다', async () => {
    stub(status('production', 'live'));
    await renderNotifications();
    await waitFor(() => expect(screen.getByText('SENT')).toBeTruthy());
    expect(document.querySelector('section[aria-labelledby="ntf-emails-h"] [data-connection]')).toBeNull();
  });
});
