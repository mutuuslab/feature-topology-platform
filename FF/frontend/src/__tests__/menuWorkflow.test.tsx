import { describe, expect, it } from 'vitest';
import { MENU, ROUTES, routeOf, trailOf } from '../routes';
import { paletteItems } from '../shell/CommandPalette';
import { departmentById } from '../data/departments';
import { departmentMenu } from '../shell/departmentMenu';

describe('업무 목적에 맞는 메뉴 진입', () => {
  it('구매·SW 개발비는 별도 대메뉴이고 산정·기준·협력사 납품을 함께 찾는다', () => {
    const purchase = MENU.find((group) => group.key === 'procurement');
    expect(purchase?.ko).toBe('구매·SW 개발비');
    expect(purchase?.items.map((item) => item.menu)).toEqual([
      '/procurement/sw-cost', '/procurement/sw-cost/basis', '/supplier/portal',
    ]);
    const department = departmentMenu(departmentById('DEP-PUR')!);
    expect(department.primary.map((item) => item.to)).toEqual(expect.arrayContaining([
      '/procurement/sw-cost', '/procurement/sw-cost/basis', '/supplier/portal',
    ]));
    expect(department.reference.some((item) => department.primary.some((primary) => primary.to === item.to))).toBe(false);
  });

  it('분석은 운영, 연결 대상 구성은 구성, 시스템 관리는 설정에서 열린다', () => {
    const expected = {
      '/biz/trials': 'ops', '/data/workbench': 'ops',
      '/integration/openfeature': 'config', '/integration/code-repositories': 'config',
      '/admin/iam': 'settings', '/admin/security': 'settings', '/admin/settings': 'settings',
      '/deployments': 'release',
    };
    for (const [path, group] of Object.entries(expected)) {
      expect(routeOf(path)?.group, path).toBe(group);
      const item = paletteItems('').find((entry) => entry.to === path);
      expect(item?.group, path).toBe(MENU.find((entry) => entry.key === group)?.ko);
      expect(trailOf(path)[0]?.title, path).toBe(item?.group);
    }
  });

  it('상세 화면과 이전 주소도 이동한 부모의 그룹을 따라간다', () => {
    for (const path of [
      '/procurement/sw-cost/EST-0001', '/supplier/package', '/decisions/supplier',
      '/integration/code-repositories/repo-1', '/integration/code-scans',
      '/admin/users', '/admin/permissions', '/admin/org', '/insights/business', '/insights/reports', '/cost',
    ]) {
      const route = routeOf(path)!;
      expect(route, path).toBeTruthy();
      const parent = ROUTES.find((item) => item.path === route.parent);
      expect(parent?.group, path).toBe(route.group);
      expect(trailOf(path)[0]?.title, path).toBe(MENU.find((item) => item.key === route.group)?.ko);
    }
  });
});
