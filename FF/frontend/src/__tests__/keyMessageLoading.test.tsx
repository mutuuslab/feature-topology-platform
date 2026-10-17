// 회귀: 핵심 메시지(3초 테스트)는 데이터가 오기 전에 판정하지 않는다 — 빈 목록을 '없음'으로 읽어 data-tone="ok"("…이 없습니다")를
// 보이면 거짓 안심이다(2026-10-17 지도 화면에서 발견: 불러오는 중에 "긴급 차단·미확인 차량이 없습니다").
// 응답이 오지 않는 동안 핵심 메시지는 있고(화면마다 1개), 판정 색은 neutral이어야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ApprovalInboxScreen, HomeScreen } from '../screens/home/Inbox';
import { NotificationsScreen } from '../screens/home/Notifications';
import { TopologyScreen } from '../screens/master/Topology';
import { FleetMapScreen } from '../screens/ops/FleetMap';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  // 응답이 끝내 오지 않는다 — 계속 불러오는 중
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, el: JSX.Element) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('핵심 메시지 — 불러오는 중에는 판정하지 않는다(거짓 안심 금지)', () => {
  for (const [name, path, el] of [
    ['내 대시보드', '/', <HomeScreen />],
    ['검토함', '/admin/approval', <ApprovalInboxScreen />],
    ['알림', '/notifications', <NotificationsScreen />],
    ['Topology', '/arch/topology', <TopologyScreen />],
    ['전세계 차량 지도', '/fleet/map', <FleetMapScreen />],
  ] as const)
    it(`${name}: 응답 전 핵심 메시지는 neutral`, async () => {
      mount(path, el);
      await new Promise((r) => setTimeout(r, 30));
      const key = document.querySelectorAll('[data-key-message]');
      expect(key).toHaveLength(1);
      expect(key[0].getAttribute('data-tone')).toBe('neutral');
    });
});
