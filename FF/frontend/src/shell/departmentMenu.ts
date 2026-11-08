// 부서 메뉴 = 그 부서가 수행·책임지는 활동의 화면(주 업무) + 협의·통보 활동의 화면(참조)을 실제 메뉴 경로로 바꾼 것.
// 활동 화면은 경로 패턴(예 /features/:id/:ver)이라 메뉴가 있는 가장 가까운 상위 화면으로 올린다.
import type { DepartmentSummary } from '@ff/contracts';
import { DESKTOP_BUILD, routesFor, screenShipped, type AppRoute } from '../routes';
import { departmentNavigation as N } from '../copy/department-navigation';

export interface DeptMenuItem {
  to: string;
  title: string;
  /** 이 항목으로 모은 활동 화면·지정 진입 화면 패턴 */
  screens: string[];
}

export interface DeptMenuGroup {
  key: keyof typeof N.categories;
  title: string;
  items: DeptMenuItem[];
}

/** Navigation categories preserve existing department RACI and access rules. */
export function departmentMenuGroups(items: readonly DeptMenuItem[]): DeptMenuGroup[] {
  const category = (to: string): DeptMenuGroup['key'] => {
    if (to.startsWith('/procurement/')) return 'cost';
    if (to.startsWith('/supplier/')) return 'supplier';
    if (to.startsWith('/consults') || to === '/admin/approval') return 'consultation';
    if (to === '/data/workbench' || to === '/biz/trials' || to.startsWith('/experiments')) return 'analysis';
    if (to.startsWith('/feature') || to.startsWith('/planning')) return 'feature';
    if (to.startsWith('/arch') || to.startsWith('/variants') || to.startsWith('/support') || to.startsWith('/integration/openfeature') || to.startsWith('/integration/code-repositories')) return 'configuration';
    if (to.startsWith('/master')) return 'master';
    if (to.startsWith('/verify') || to.startsWith('/scenarios') || to.startsWith('/analysis')) return 'verification';
    if (to.startsWith('/policies') || to.startsWith('/deployments')) return 'release';
    if (to.startsWith('/products') || to.startsWith('/entitlements') || to.startsWith('/orders')) return 'product';
    if (to.startsWith('/fleet') || to.startsWith('/ops')) return 'monitoring';
    if (to.startsWith('/audit') || to.startsWith('/reports')) return 'assurance';
    if (to.startsWith('/admin/settings') || to.startsWith('/admin/iam') || to.startsWith('/admin/security') || to === '/_design') return 'settings';
    return 'integration';
  };
  const groups = new Map<DeptMenuGroup['key'], DeptMenuGroup>();
  for (const item of items) {
    const key = category(item.to);
    const group = groups.get(key) ?? { key, title: N.categories[key], items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** 작업공간 내비가 따로 그리는 항목 — 홈(작업공간)·업무 절차 */
export const FIXED_ITEMS = ['/', '/procedures', '/procedures/work'];

// 구매본부의 지정 진입점. 메뉴 탐색 우선순위이며 RACI·계정 권한을 부여하지 않는다.
const PRIMARY_ENTRIES: Record<string, readonly string[]> = {
  'DEP-PUR': ['/procurement/sw-cost', '/procurement/sw-cost/basis', '/supplier/portal'],
};

/** 경로 패턴 → 메뉴가 있는 가장 가까운 화면(자기 자신 또는 상위). 이 빌드에 싣지 않은 화면(데스크톱 배포본)은 메뉴로 올리지 않는다 */
export function menuRouteOf(pattern: string, desktop = DESKTOP_BUILD): AppRoute | undefined {
  if (!screenShipped(pattern, desktop)) return undefined;
  const routes = routesFor(desktop);
  let cur = routes.find((r) => r.path === pattern);
  for (let i = 0; cur && i < 8; i++) {
    if (cur.menu) return cur;
    const parent: string | undefined = cur.parent;
    cur = parent ? routes.find((r) => r.path === parent) : undefined;
  }
  return undefined;
}

function toItems(patterns: readonly string[], skip: ReadonlySet<string>, desktop: boolean): DeptMenuItem[] {
  const out: DeptMenuItem[] = [];
  for (const s of patterns) {
    const r = menuRouteOf(s, desktop);
    if (!r || skip.has(r.menu!)) continue;
    const hit = out.find((x) => x.to === r.menu);
    if (hit) hit.screens.push(s);
    else out.push({ to: r.menu!, title: r.title, screens: [s] });
  }
  return out;
}

export function departmentMenu(d: DepartmentSummary, desktop = DESKTOP_BUILD): { primary: DeptMenuItem[]; reference: DeptMenuItem[] } {
  const fixed = new Set(FIXED_ITEMS);
  const primary = toItems([...(PRIMARY_ENTRIES[d.id] ?? []), ...d.screens.primary], fixed, desktop);
  const reference = toItems(d.screens.reference, new Set([...fixed, ...primary.map((x) => x.to)]), desktop);
  return { primary, reference };
}
