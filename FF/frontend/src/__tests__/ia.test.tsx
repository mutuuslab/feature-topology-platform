// IA 하네스 — MENU 2.0 규칙 (사용자 결정: 업무 기준 8그룹 + 내 역할 필터, 부서별·Plane별 모드 폐지).
// 메뉴 누락·고아 화면·중복 경로·깨진 메뉴 링크가 다시 생기면 실패한다.
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SPEC_MENU } from '../data/specMenu';
import { SCREEN_ENTRY } from '../data/uiLinks';
import { roles } from '../data/refdata';
import { GROUPS, MENU, ROUTES, rolesOf, routeOf, trailOf, uiCodeOf } from '../routes';
import { Shell } from '../shell/Shell';
import { ko } from '../copy/ko';
import { AppProvider } from '../store';
import { MotionProvider } from '../state/motion';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-present');
});

describe('MENU 2.0 구조', () => {
  it('업무 기준 8그룹, 순서 고정', () => {
    expect(GROUPS.map((g) => g.ko)).toEqual(['홈', 'Feature 정의', '구성·Topology', '기준정보', '검증·Gate', '상품·출시', '차량 운영·안전', '연계·감사·관리']);
  });

  it('그룹마다 메뉴 항목이 있다', () => {
    for (const g of MENU) expect(g.items.length, g.key).toBeGreaterThan(0);
  });

  it('라우트 경로·메뉴 링크·화면 이름이 중복되지 않는다', () => {
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    const links = ROUTES.filter((r) => r.menu).map((r) => r.menu);
    expect(new Set(links).size).toBe(links.length);
    const menuTitles = ROUTES.filter((r) => r.menu).map((r) => r.title);
    expect(new Set(menuTitles).size).toBe(menuTitles.length);
  });

  it('고아 화면 0 — 모든 라우트는 메뉴 항목이거나 실재하는 부모를 가진다', () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    const orphans = ROUTES.filter((r) => !r.menu && !(r.parent && paths.has(r.parent)));
    expect(orphans.map((r) => r.path)).toEqual([]);
  });

  it('부모 사슬에 순환이 없고, 같은 그룹 안에서 끝난다', () => {
    for (const r of ROUTES) {
      const seen = new Set<string>();
      let cur: typeof r | undefined = r;
      while (cur?.parent) {
        expect(seen.has(cur.path), `순환: ${r.path}`).toBe(false);
        seen.add(cur.path);
        const parent: typeof r | undefined = ROUTES.find((x) => x.path === cur!.parent);
        expect(parent?.group, `${r.path} → ${cur.parent}`).toBe(r.group);
        cur = parent;
      }
    }
  });

  it('메뉴 링크는 그 링크를 선언한 라우트로 열린다 (동적 경로에 먹히지 않는다)', () => {
    for (const r of ROUTES.filter((x) => x.menu)) expect(routeOf(r.menu!)?.path, r.menu).toBe(r.path);
    expect(routeOf('/ops/incident')?.path).toBe('/ops/incident');
    expect(routeOf('/ops/FEAT-00022')?.path).toBe('/ops/:id');
    expect(routeOf('/topology/edge')?.path).toBe('/topology/edge');
  });

  it('정본 화면 UI01~UI30의 진입 경로가 모두 MENU 2.0에서 열린다 (추적 보존)', () => {
    const ids = SPEC_MENU.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toHaveLength(30);
    for (const id of ids) {
      const entry = SCREEN_ENTRY[id];
      expect(entry, id).toBeTruthy();
      expect(routeOf(entry.split('?')[0]), `${id} → ${entry}`).toBeTruthy();
    }
    expect(uiCodeOf({ path: '/catalog' })).toBe('UI02');
  });

  it('breadcrumb은 그룹 › 부모 › 현재 순서', () => {
    expect(trailOf('/feature/FEAT-00022').map((t) => t.title)).toEqual(['Feature 정의', 'Feature Registry', 'Feature 상세']);
    expect(trailOf('/consistency/violation').map((t) => t.title)).toEqual(['구성·Topology', 'Topology·의존관계 검증', '정합성 규칙', '위반 상세']);
  });

  it('내 역할 필터: 모든 역할에 메뉴가 하나 이상 남는다', () => {
    for (const role of roles) {
      const n = MENU.flatMap((g) => g.items).filter((r) => { const rs = rolesOf(r); return rs === 'all' || rs.includes(role); }).length;
      expect(n, role).toBeGreaterThan(0);
    }
  });
});

const renderShell = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MotionProvider>
        <AppProvider>
          <Shell>
            <h1>본문</h1>
          </Shell>
        </AppProvider>
      </MotionProvider>
    </MemoryRouter>,
  );

describe('셸', () => {
  it('레일 8개, 현재 그룹의 메뉴, breadcrumb', () => {
    renderShell('/feature/FEAT-00022');
    const rail = screen.getAllByRole('button').filter((b) => b.className.includes('sh-rail__btn') && !b.className.includes('toggle'));
    expect(rail).toHaveLength(8);
    const panel = screen.getByRole('complementary', { name: 'Feature 정의' });
    expect(within(panel).getByRole('link', { name: 'Feature Registry' }).className).toContain('active');
    expect(screen.getByRole('navigation', { name: 'breadcrumb' }).textContent).toContain('Feature 상세');
  });

  it('운영·안전 그룹 화면은 본문이 관제실 톤(data-zone=ops)', () => {
    renderShell('/fleet');
    expect(document.getElementById('main')?.getAttribute('data-zone')).toBe('ops');
  });

  it('P 키로 시연 모드를 켜고 끈다 (입력 중에는 무시)', () => {
    renderShell('/catalog');
    fireEvent.keyDown(window, { key: 'p' });
    expect(document.documentElement.getAttribute('data-present')).toBe('on');
    const input = screen.getByLabelText(ko.shell.search);
    fireEvent.keyDown(input, { key: 'p' });
    expect(document.documentElement.getAttribute('data-present')).toBe('on');
    fireEvent.keyDown(window, { key: 'p' });
    expect(document.documentElement.getAttribute('data-present')).toBe('off');
  });
});
