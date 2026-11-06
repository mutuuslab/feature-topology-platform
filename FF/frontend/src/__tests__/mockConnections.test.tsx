// readiness: RD-UX-04 — 모의 연계(과금·OTA·Data Lake — 알림 메일 채널은 없다, D-RD-7)는 화면에 '모의(연결 전)'·'연결 안 됨'으로 보이고, 결과를 실제처럼 표시하지 않는다.
// 표시 여부는 서버 설정(/api/system/connections)이 정한다 — 실제 연결(live)이면 표시가 사라진다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ConnectionsResponse } from '@ff/contracts';
import { connectionLabel, useConnectionLabel } from '../api/connections';
import { ConnectionBadge } from '../design';
import { connections as CN } from '../copy/connections';
import { ko } from '../copy/ko';
import { AppProvider } from '../store';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const status = (mode: 'production' | 'demo', billing: 'live' | 'mock' | 'off' = 'mock'): ConnectionsResponse => ({
  mode,
  items: [
    { key: 'billing', mode: billing, ifId: null, liveAdapter: billing === 'live' },
    { key: 'ota', mode: 'mock', ifId: 'IF-05', liveAdapter: false },
    { key: 'datalake', mode: 'off', ifId: null, liveAdapter: false },
  ],
});

function stub(conn: ConnectionsResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/system/connections')) return json(conn);
      if (url.startsWith('/api/notifications')) return json({ items: [], unread: 0, byCategory: {} });
      return json({ items: [] });
    }),
  );
}

/** 연결 하나를 서버 상태로 표시하는 화면 조각 — 과금 표시(체험 구매)와 같은 훅 */
function BillingProbe() {
  const l = useConnectionLabel('billing');
  return <p data-testid="probe">{l === 'none' ? CN.panel.live : <ConnectionBadge state={l} system={CN.system.billing} />}</p>;
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BillingProbe />
    </QueryClientProvider>,
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
  it('표시 규칙 — live는 표시 없음, 데모는 모의(연결 전), 운영·꺼짐은 연결 안 됨, 상태를 못 읽으면 모의', () => {
    expect(connectionLabel({ mode: 'live' }, 'production')).toBe('none');
    expect(connectionLabel({ mode: 'mock' }, 'demo')).toBe('mock');
    expect(connectionLabel({ mode: 'mock' }, 'production')).toBe('disconnected');
    expect(connectionLabel({ mode: 'off' }, 'demo')).toBe('disconnected');
    expect(connectionLabel(null, null)).toBe('mock');
  });

  it('ConnectionBadge — 모의·연결 안 됨은 글자와 설명, 실제 연결이면 그리지 않는다', () => {
    const { container, rerender } = render(<ConnectionBadge state="mock" system={CN.system.billing} />);
    expect(screen.getByText(CN.label.mock)).toBeTruthy();
    expect(screen.getByText(CN.hint.mock(CN.system.billing))).toBeTruthy();
    rerender(<ConnectionBadge state="disconnected" system={CN.system.billing} />);
    expect(screen.getByText(CN.label.disconnected)).toBeTruthy();
    rerender(<ConnectionBadge state="none" system={CN.system.billing} />);
    expect(container.textContent).toBe('');
  });

  it('데모 설치 — 모의 연결은 모의(연결 전)', async () => {
    stub(status('demo'));
    renderProbe();
    await waitFor(() => expect(document.querySelector('[data-testid="probe"] [data-connection="mock"]')).toBeTruthy());
  });

  it('운영 설치 — 같은 모의 연결이 "연결 안 됨"', async () => {
    stub(status('production'));
    renderProbe();
    await waitFor(() => expect(document.querySelector('[data-testid="probe"] [data-connection="disconnected"]')).toBeTruthy());
  });

  it('실제 연결(live)이면 표시가 사라진다', async () => {
    stub(status('production', 'live'));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(CN.panel.live));
    expect(document.querySelector('[data-testid="probe"] [data-connection]')).toBeNull();
  });

  it('알림 화면에는 메일 연결·발송 기록이 없다(D-RD-7 화면 알림만)', async () => {
    stub(status('demo'));
    await renderNotifications();
    await waitFor(() => expect(screen.getByText(ko.notify.channel.title)).toBeTruthy());
    expect(document.querySelector('[data-connection]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/메일 발송|모의 발송/);
  });
});
