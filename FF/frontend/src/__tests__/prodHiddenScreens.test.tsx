// 운영 설치에서 숨기는 데모·개발 화면(결정 D-RD-8) — 디자인 시스템 갤러리(/_design)와 표준 따라하기(/learn·가이드 패널).
// 운영 빌드(VITE_AUTH=oidc)는 라우트·메뉴·⌘K 항목이 없고 직접 주소는 '찾는 항목이 없습니다', 데모·개발 빌드는 그대로 보인다.
// 빌드 상수는 모듈을 읽을 때 정해지므로 env를 바꾼 뒤 모듈을 새로 읽는다(authOidc.test와 같은 방식).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const HIDDEN = ['/learn', '/learn/:id', '/_design'];

async function load(mode: 'oidc' | 'demo') {
  vi.stubEnv('VITE_AUTH', mode === 'oidc' ? 'oidc' : '');
  vi.stubEnv('VITE_DATA_MODE', '');
  vi.resetModules();
  const routes = await import('../routes');
  const palette = await import('../shell/CommandPalette');
  const docks = await import('../shell/docks');
  const patterns = await import('../components/patterns');
  const learn = await import('../shell/learn');
  return { ...routes, ...palette, ...docks, ...patterns, learn };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe('운영 빌드 — 갤러리·표준 따라하기 숨김(D-RD-8)', { timeout: 30_000 }, () => {
  it('라우트·메뉴·⌘K에 /_design·/learn이 없다', async () => {
    const m = await load('oidc');
    expect(m.ROUTES.map((r) => r.path).filter((p) => HIDDEN.includes(p))).toEqual([]);
    expect(m.MENU.flatMap((g) => g.items.map((r) => r.menu)).filter((p) => p === '/learn' || p === '/_design')).toEqual([]);
    expect(m.routeOf('/learn')).toBeUndefined();
    expect(m.routeOf('/learn/CS-01')).toBeUndefined();
    expect(m.routeOf('/_design')).toBeUndefined();
    expect(m.paletteItems('').map((i) => i.to)).not.toContain('/learn');
    expect(m.paletteItems('').map((i) => i.to)).not.toContain('/_design');
    // 검색해도 화면 항목은 없다 — Feature 검색 줄 하나만
    expect(m.paletteItems('따라하기').map((i) => i.to)).toEqual([`/features?q=${encodeURIComponent('따라하기')}`]);
    expect(m.paletteItems('디자인 시스템').filter((i) => !i.to.startsWith('/features?'))).toEqual([]);
  });

  it('직접 주소는 기존 찾을 수 없음 화면(앱과 같은 라우트 표)', async () => {
    const m = await load('oidc');
    for (const path of ['/_design', '/learn', '/learn/CS-01']) {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {m.ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={<span data-route={r.path} />} />
            ))}
            <Route path="*" element={<m.NotFound />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(document.querySelector('[data-not-found]'), path).toBeTruthy();
      expect(document.querySelector('[data-route]'), path).toBeNull();
      cleanup();
    }
  });

  it('브라우저에 따라하기 진행 상태가 남아 있어도 가이드 패널을 그리지 않는다', async () => {
    localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: 'CS-01', step: 0, mode: 'view', startedAt: '2026-10-24T00:00:00.000Z' }));
    const m = await load('oidc');
    m.learn.learnStore.reload();
    expect(m.learn.learnStore.get()).not.toBeNull();
    const { container } = render(
      <MemoryRouter>
        <m.GuideDockHost />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('데모·개발 빌드 — 그대로 보인다', { timeout: 30_000 }, () => {
  it('라우트·메뉴·⌘K에 /_design·/learn이 있다', async () => {
    const m = await load('demo');
    expect(m.ROUTES.map((r) => r.path)).toEqual(expect.arrayContaining(HIDDEN));
    const menu = m.MENU.flatMap((g) => g.items.map((r) => r.menu));
    expect(menu).toContain('/learn');
    expect(menu).toContain('/_design');
    expect(m.routeOf('/learn/CS-01')?.path).toBe('/learn/:id');
    expect(m.paletteItems('따라하기').map((i) => i.to)).toContain('/learn');
  });
});
