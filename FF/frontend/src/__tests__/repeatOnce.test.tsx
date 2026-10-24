// 회귀: 같은 말을 한 번만(3초 테스트 잔여 UX3-09·10·11, 2026-10-23).
// ① UX3-09 핵심 메시지가 "…이 없습니다"인데 빈 상자가 같은 말과 일반 안내를 또 보였다(검토함·Baseline, Baseline 필터 "확정 0 반려 0 전체 0").
// ② UX3-10 셸 메뉴 제목이 H1과 같아도 그렸다. 알림 배지는 긴급 차단이 없어도 빨강이라 모든 화면에서 가장 진한 요소였다.
// ③ UX3-11 Panel 제목이 H1이나 지금 탭 이름과 같아도 머리를 그렸다.
// ④ 3초 ⑩(D-UX3-2, 2026-10-24) 숫자 없는 neutral 핵심 메시지가 '없습니다'인데 Retirement·CARLA 가상검증이 빈 상자를 또 보였다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { MotionProvider } from '../state/motion';
import { AsyncView, PageHeader, PageTitleProvider, Panel, Tabs } from '../design';
import { ApprovalInboxScreen } from '../screens/home/Inbox';
import BaselineQueue from '../screens/bom/BaselineQueue';
import { NotificationBell } from '../shell/NotificationBell';
import { Shell } from '../shell/Shell';
import { GROUPS } from '../routes';
import { RetirementsScreen } from '../screens/policy/Retirements';
import { VirtualValidationScreen } from '../screens/policy/Virtual';
import { ExperimentsScreen } from '../screens/ext/Experiments';
import { IntegrationsScreen } from '../screens/ext/Integrations';
import { extSync } from '../copy/ext-sync';
import { p10 } from '../copy/p10';

type Handler = (url: string) => { status?: number; body: unknown } | undefined;
let handler: Handler;

beforeEach(() => {
  localStorage.clear();
  handler = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const r = handler(url) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (path: string, el: JSX.Element, role = 'steward', routePath = path.split('?')[0]) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <MotionProvider>
          <AppProvider>
            <Routes>
              <Route path={routePath} element={el} />
            </Routes>
          </AppProvider>
        </MotionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('UX3-09 빈 상자 생략', () => {
  it('emptyHidden이면 빈 상자 글자를 그리지 않고 data-state 표식만 남긴다', () => {
    render(<AsyncView state="empty" emptyHidden empty={{ title: '기다리는 일이 없습니다' }} />);
    const box = document.querySelector('[data-state="empty"]')!;
    expect(box).toBeTruthy();
    expect(box.textContent).toBe('');
    expect(screen.queryByText('기다리는 일이 없습니다')).toBeNull();
  });

  it('검토함: 내 차례가 없으면 핵심 메시지만 말하고, 전체로 바꾸면 빈 상자', async () => {
    wrap('/admin/approval', <ApprovalInboxScreen />);
    expect(await screen.findByText('내 차례인 승인·확정이 없습니다')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeTruthy());
    expect(screen.queryByText('기다리는 일이 없습니다')).toBeNull();
    expect(screen.queryByText(/아직 기록이 없습니다/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /전체/ }));
    expect(await screen.findByText('기다리는 일이 없습니다')).toBeTruthy();
  });

  it('Baseline 확정 요청 탭: 요청이 없으면 "확정 0 반려 0 전체 0" 필터와 빈 상자를 그리지 않는다', async () => {
    wrap('/baselines?tab=requests', <BaselineQueue />);
    expect(await screen.findByText('확정 승인 대기가 없습니다')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[role="tabpanel"] [data-state="empty"]')).toBeTruthy());
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('대기 중인 확정 요청이 없습니다')).toBeNull();
  });

  it('Baseline: 요청이 있으면 필터를 보이고, 대기 필터가 비어도 핵심 메시지가 말하므로 빈 상자는 없다', async () => {
    handler = (url) => (url.startsWith('/api/baselines/requests') ? { body: { items: [{ requestId: 'BR-1', featureId: 'FEAT-00022', version: '1.0.0', status: 'APPROVED', requestedBy: 'usr-author', requestedAt: '2026-10-12T01:00:00.000Z', baselineId: 'BL-1', reason: '' }] } } : undefined);
    wrap('/baselines', <BaselineQueue />);
    expect(await screen.findByRole('radiogroup')).toBeTruthy();
    expect(screen.queryByText('대기 중인 확정 요청이 없습니다')).toBeNull();
  });
  // ⑩ — 빈 상자 표식(data-empty-hidden)만 남고 글자 상자(.ds-state)는 없다
  const emptyHidden = async () => {
    await waitFor(() => expect(document.querySelector('[data-state="empty"][data-empty-hidden]')).toBeTruthy());
    expect(document.querySelector('.ds-state')).toBeNull();
  };

  it('⑩ Flag Retirement: 기록이 없으면 핵심 메시지만 "Retirement 기록이 없습니다"', async () => {
    wrap('/flag-retirements', <RetirementsScreen />, 'author');
    expect(await screen.findByText('Retirement 기록이 없습니다')).toBeTruthy();
    await emptyHidden();
    expect(screen.queryByText('진행 중인 Retirement가 없습니다')).toBeNull();
  });

  const SIM = { available: true, mode: 'auto', simulator: 'CARLA', host: '127.0.0.1', port: 2100, server: { version: '0.9.16', map: 'Town04', synchronous: false, vehicles: 0, foreignVehicles: 0 }, runner: 'r', python: 'py', reason: null, queue: { running: 0, waiting: 0 } };
  const COMBO = { featureId: 'FEAT-00022', group: ['FEAT-00022'], safetyFlags: ['FEAT-00022'], strength: 1, requestedStrength: 1, basis: 'b', array: { factors: ['FEAT-00022'], strength: 1, rows: [[true]], tuples: 1, covered: 1, infeasible: 0 }, negatives: [] };
  // 가상검증 키트 Feature가 등록된 설치(데모) — 빈 설치는 아래 RD-OPS-02 시험
  const KIT = { body: { items: [{ featureId: 'FEAT-00022', version: '1.0.0' }] } };
  const sim = (status: unknown): Handler => (url) => (url.startsWith('/api/sim/status') ? { body: status } : url.startsWith('/api/virtual-validations/combinations') ? { body: COMBO } : url.startsWith('/api/features') ? KIT : undefined);

  it('⑩ CARLA 가상검증: 실행 기록이 없으면 핵심 메시지만 — 서버 미연결(warn)이면 빈 상자는 그대로', async () => {
    handler = sim(SIM);
    wrap('/validations/virtual', <VirtualValidationScreen />, 'quality');
    expect(await screen.findByText('차량 내 감지 실행 기록이 아직 없습니다')).toBeTruthy();
    await emptyHidden();
  });

  it('빈 설치(RD-OPS-02): 가상검증 키트 Feature가 없으면 시나리오·조합 대신 안내하고, 없는 Feature를 조회하지 않는다', async () => {
    const seen: string[] = [];
    handler = (url) => (seen.push(url), url.startsWith('/api/sim/status') ? { body: SIM } : undefined);
    wrap('/validations/virtual', <VirtualValidationScreen />, 'quality');
    expect(await screen.findByText('가상검증 시나리오가 연결된 Feature가 아직 없습니다')).toBeTruthy();
    expect(seen.some((u) => u.startsWith('/api/virtual-validations/combinations'))).toBe(false);
  });

  it('⑩ CARLA 가상검증: 서버 미연결이면 핵심 메시지가 "없습니다"가 아니므로 빈 상자를 보인다', async () => {
    handler = sim({ ...SIM, available: false, server: null, reason: 'down' });
    wrap('/validations/virtual', <VirtualValidationScreen />, 'quality');
    expect(await screen.findByText('검증 서버 미연결 — 실행할 수 없습니다')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.ds-state[data-state="empty"]')).toBeTruthy());
  });
});

describe('UX3-11 Panel 제목 = H1·탭 이름이면 머리 생략', () => {
  it('H1과 같은 제목은 그리지 않고, 영역 이름은 H1에서 온다. 다른 제목은 그린다', () => {
    render(
      <PageTitleProvider>
        <PageHeader title="Baseline 확정" />
        <Panel title="Baseline 확정" id="same">
          본문
        </Panel>
        <Panel title="확정 이력" id="other">
          본문
        </Panel>
      </PageTitleProvider>,
    );
    const h2s = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2s).toEqual(['확정 이력']);
    const h1 = screen.getByRole('heading', { level: 1 });
    const same = document.querySelector('[data-title-same]')!;
    expect(same.getAttribute('aria-labelledby')).toBe(h1.id);
    expect(screen.getByRole('region', { name: 'Baseline 확정' })).toBe(same);
  });

  it('지금 탭 이름과 같은 제목도 그리지 않는다(영역 이름은 탭)', () => {
    render(
      <MemoryRouter initialEntries={['/x']}>
        <Tabs tabs={[{ key: 'a', label: '확정 요청' }, { key: 'b', label: '확정된 Baseline' }]}>
          {() => (
            <Panel title="확정 요청" actions={<button type="button">새로 고침</button>}>
              본문
            </Panel>
          )}
        </Tabs>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeTruthy();
    expect(document.querySelector('.ds-panel')!.getAttribute('aria-labelledby')).toBe('tab-a');
  });
});

const renderShell = (title: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/approval']}>
        <MotionProvider>
          <AppProvider>
            <Shell>
              <PageHeader title={title} />
            </Shell>
          </AppProvider>
        </MotionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('UX3-10 셸 — 위치 한 번, 알림 배지 색', () => {
  const home = GROUPS.find((g) => g.key === 'home')!.ko;

  it('메뉴 제목이 H1과 같으면 메뉴 제목을 그리지 않는다(메뉴 영역 이름은 남는다)', () => {
    renderShell(home);
    const panel = screen.getByRole('complementary', { name: home });
    expect(within(panel).queryByRole('heading', { name: home })).toBeNull();
  });

  it('H1과 다르면 메뉴 제목을 그린다', () => {
    renderShell('검토함');
    const panel = screen.getByRole('complementary', { name: home });
    expect(within(panel).getByRole('heading', { name: home })).toBeTruthy();
  });

  it('배지 기본 색은 위험색이 아니다 — 위험색은 [data-alarm]에만', () => {
    const css = readFileSync(join(__dirname, '..', 'shell', 'shell.css'), 'utf8');
    const base = css.match(/\.sh-ntf__badge \{[^}]*\}/)![0];
    expect(base).not.toContain('--danger');
    expect(css.match(/\.sh-ntf__badge\[data-alarm\] \{[^}]*\}/)?.[0]).toContain('var(--danger)');
  });

  const notifications = { body: { items: [], unread: 2, byCategory: {} } };
  it('긴급 차단이 없으면 배지는 중립, 상업 비활성화만 있어도 중립', async () => {
    handler = (url) => (url.startsWith('/api/notifications') ? notifications : url.startsWith('/api/kill-requests') ? { body: { items: [{ reasonCategory: 'COMMERCIAL' }] } } : undefined);
    wrap('/', <NotificationBell />, 'approver');
    const badge = await screen.findByTestId('notify-badge');
    expect(badge.textContent).toBe('2');
    await new Promise((r) => setTimeout(r, 20));
    expect(badge.hasAttribute('data-alarm')).toBe(false);
  });

  it('긴급 차단이 걸려 있으면 배지는 위험색(data-alarm)', async () => {
    handler = (url) => (url.startsWith('/api/notifications') ? notifications : url.startsWith('/api/kill-requests') ? { body: { items: [{ reasonCategory: 'SAFETY' }] } } : undefined);
    wrap('/', <NotificationBell />, 'approver');
    const badge = await screen.findByTestId('notify-badge');
    await waitFor(() => expect(badge.hasAttribute('data-alarm')).toBe(true));
  });

});

// ⑩ — 마지막 허용 목록 두 화면(3판 통합 때 해소): 핵심 메시지가 '없음'이면 빈 상자로 되풀이하지 않는다
describe('3초 ⑩ 실험·외부 연계', () => {
  it('⑩ 실험: 실험이 없으면 핵심 메시지만 "진행 중인 실험이 없습니다"', async () => {
    wrap('/experiments', <ExperimentsScreen />, 'author');
    expect(await screen.findByText(p10.experiment.key.none)).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-state="empty"][data-empty-hidden]')).toBeTruthy());
    expect(screen.queryByText(p10.experiment.empty)).toBeNull();
  });
  it('⑩ 외부 연계 현황: 주고받은 변경이 없으면 수신함 빈 상자를 그리지 않고, 주고받은 뒤에는 보인다', async () => {
    wrap('/integration/connectors', <IntegrationsScreen />, 'integrator');
    expect(await screen.findByText(extSync.sync.key.idle)).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-state="empty"][data-empty-hidden]')).toBeTruthy());
    expect(screen.queryByText(extSync.sync.inboxEmpty)).toBeNull();
    cleanup();
    const row = { system: 'JIRA', ifId: 'IF-14', mode: 'mock', baseUrl: 'mock://jira', links: 1, pending: 0, failed: 0, conflicts: 0, rejected: 0, lastInboundAt: null, lastOutboundAt: '2026-10-20T00:00:00.000Z' };
    handler = (url) => (url.split('?')[0] === '/api/integrations/sync' ? { body: { items: [row], ownership: [] } } : undefined);
    wrap('/integration/connectors', <IntegrationsScreen />, 'integrator');
    expect(await screen.findByText(extSync.sync.inboxEmpty)).toBeTruthy();
  });
});
