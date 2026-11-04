// Windows 데스크톱(Tauri) 배포본 — 42 컴포넌트 아키텍처 화면은 배포본 메뉴·라우트·부서 메뉴에서 빠진다.
import { describe, expect, it } from 'vitest';
import { DEPARTMENTS } from '../data/departments';
import { DESKTOP_EXCLUDED, ROUTES, routesFor, screenShipped } from '../routes';
import { departmentMenu, menuRouteOf } from '../shell/departmentMenu';

describe('데스크톱 배포본 라우트', () => {
  it('웹 빌드는 42 컴포넌트 아키텍처를 유지한다', () => {
    expect(ROUTES.some((r) => r.path === '/arch/components')).toBe(true);
    expect(routesFor(false)).toBe(ROUTES);
  });

  it('데스크톱 빌드는 42 컴포넌트 아키텍처 라우트와 메뉴를 뺀다', () => {
    const desktop = routesFor(true);
    expect(DESKTOP_EXCLUDED.has('/arch/components')).toBe(true);
    expect(desktop.some((r) => r.path === '/arch/components' || r.menu === '/arch/components')).toBe(false);
    expect(desktop.some((r) => /42 컴포넌트/.test(r.title))).toBe(false);
    expect(desktop.length).toBe(routesFor(false).length - 1);
  });

  it('데스크톱 빌드도 준비 중 화면(Feature DB·SW 개발비 산정)은 그대로 싣는다', () => {
    const paths = new Set(routesFor(true).map((r) => r.path));
    expect(paths.has('/master/feature-db')).toBe(true);
    expect(paths.has('/procurement/sw-cost')).toBe(true);
  });

  it('데스크톱 빌드에 남은 라우트의 부모는 모두 남아 있다', () => {
    const desktop = routesFor(true);
    const paths = new Set(desktop.map((r) => r.path));
    for (const r of desktop) if (r.parent) expect(paths.has(r.parent), `${r.path} → ${r.parent}`).toBe(true);
  });
});

describe('업무 절차의 화면 링크', () => {
  it('데스크톱 배포본에서는 뺀 화면을 링크하지 않는다', () => {
    expect(screenShipped('/arch/components', false)).toBe(true);
    expect(screenShipped('/arch/components', true)).toBe(false);
    expect(screenShipped('/arch/topology', true)).toBe(true);
  });
});

describe('부서 메뉴', () => {
  const items = (desktop: boolean) =>
    DEPARTMENTS.departments.flatMap((d) => {
      const m = departmentMenu(d, desktop);
      return [...m.primary, ...m.reference];
    });

  it('웹 빌드는 42 컴포넌트 아키텍처를 부서 메뉴에 올린다', () => {
    expect(menuRouteOf('/arch/components', false)?.menu).toBe('/arch/components');
    expect(items(false).some((x) => x.to === '/arch/components')).toBe(true);
  });

  it('데스크톱 빌드는 어느 부서 메뉴도 뺀 화면을 가리키지 않는다', () => {
    expect(menuRouteOf('/arch/components', true)).toBeUndefined();
    const all = items(true);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((x) => DESKTOP_EXCLUDED.has(x.to) || x.screens.some((s) => DESKTOP_EXCLUDED.has(s)))).toBe(false);
    // 남은 항목은 모두 데스크톱 빌드에 메뉴가 있는 화면이다
    const menus = new Set(routesFor(true).filter((r) => r.menu).map((r) => r.menu));
    for (const x of all) expect(menus.has(x.to), x.to).toBe(true);
  });
});
