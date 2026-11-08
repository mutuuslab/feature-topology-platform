// 부서 메뉴(데모 부서 보기) — 8그룹 레일·패널 대신 그 부서의 업무 화면만. 구조는 하나이고 배치는 화면 유형이 정한다(shell.css
// [data-workspace]): SW개발비 및 정보보안은 위쪽 가로 메뉴, 상품기획·표준 검토함·엔지니어링 검토·배포 및 모니터링은 왼쪽 세로 메뉴.
// 메뉴에 없는 화면도 주소로 열 수 있다(데모 — 화면 차단 없음). '전체 메뉴 보기'는 전체 보기(8그룹)로 돌아간다.
import { useEffect, useMemo, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { DepartmentSummary } from '@ff/contracts';
import { departments as D } from '../copy/departments';
import { departmentNavigation as N } from '../copy/department-navigation';
import { Icon } from '../design';
import { routeOf, ROUTES } from '../routes';
import { departmentMenu, departmentMenuGroups, type DeptMenuItem } from './departmentMenu';
import { departmentLabel } from '../data/departments';
import { useAppShell } from '../store';
import { procedurePanel } from '../copy/procedure-panel';
import './department-navigation.css';

const horizontal = (w: string) => w === 'portal';
/** 번들 검사 표식 — 운영 빌드(OIDC)에 이 문자열이 있으면 데모 부서 보기가 실린 것이다(tools/prod-bundle.test.ts) */
export const DEPT_VIEW_MARKER = 'ff-dept-view-v1';

function isActive(path: string, item: DeptMenuItem): boolean {
  const cur = routeOf(path);
  if (!cur) return false;
  if (cur.menu === item.to || cur.path === item.to) return true;
  let r = ROUTES.find((x) => x.path === cur.path);
  for (let i = 0; r?.parent && i < 6; i++) {
    if (r.parent === item.to) return true;
    const parent: string = r.parent;
    r = ROUTES.find((x) => x.path === parent);
  }
  return false;
}

export function DepartmentNav({ dept, procCount, onAll }: { dept: DepartmentSummary; procCount: number; onAll: () => void }) {
  const loc = useLocation();
  const { lang } = useAppShell();
  const name = departmentLabel(dept, lang);
  const menu = useMemo(() => departmentMenu(dept), [dept, lang]);
  const rnr = loc.pathname === '/procedures/roles' && new URLSearchParams(loc.search).get('view') === 'dept';
  const work = loc.pathname === '/procedures/work';
  const dashboard = loc.pathname === '/' ? new URLSearchParams(loc.search).get('dashboard') : null;
  // 가로 메뉴의 '더 보기'는 본문 위에 뜬다 — 화면을 옮기면 닫고 Esc로도 닫는다
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && more.current?.open) more.current.open = false;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const flat = horizontal(dept.workspace);
  const link = (item: DeptMenuItem) => (
    <li key={item.to}>
      <NavLink to={item.to} className={() => (!rnr && isActive(loc.pathname, item) ? 'active' : '')} end={item.to === '/'}>
        {item.title}
      </NavLink>
    </li>
  );
  const groups = (items: DeptMenuItem[], kind: string) => departmentMenuGroups(items).map((g) => {
    const id = `dnav-${dept.id}-${kind}-${g.key}`;
    return <section className="dnav-group" key={g.key} data-dept-category={g.key}>
      <h3 className="dnav-group__title" id={id}>{g.title}</h3>
      <ul className="sh-dnav__list" aria-labelledby={id}>{g.items.map(link)}</ul>
    </section>;
  });
  return (
    <nav className="sh-dnav" aria-label={D.nav.label(name)} data-dept-nav={dept.id} data-dept-marker={DEPT_VIEW_MARKER} data-zone={dept.workspace === 'console' ? 'ops' : undefined}>
      <div className="sh-dnav__head">
        <p className="sh-dnav__eyebrow">{D.workspace[dept.workspace]}</p>
        <p className="sh-dnav__name">{name}</p>
        {!flat && <p className="sh-dnav__counts">{D.counts(dept.counts.R, dept.counts.A, dept.counts.C)}</p>}
      </div>
      <ul className="sh-dnav__list sh-dnav__list--fixed">
        <li>
          <NavLink to="/" end className={() => (loc.pathname === '/' && !dashboard ? 'active' : '')}>
            <Icon name="home" size={16} />
            {D.nav.home}
          </NavLink>
        </li>
        <li>
          <NavLink to="/procedures" className={() => (!rnr && !work && loc.pathname.startsWith('/procedures') ? 'active' : '')} aria-label={procCount ? procedurePanel.turnCount(D.nav.procedures, procCount) : undefined}>
            <Icon name="layers" size={16} />
            {D.nav.procedures}
            {procCount > 0 && (
              <span className="sh-panel__count" aria-hidden>
                {procCount}
              </span>
            )}
          </NavLink>
        </li>
      </ul>
      <ul className="sh-dnav__list"><li><NavLink to="/procedures/work">{N.work}</NavLink></li></ul>
      <section className="dnav-group dnav-group--boards">
        <h3 className="dnav-group__title" id={`dnav-${dept.id}-boards`}>{N.dashboards}</h3>
        <ul className="sh-dnav__list" aria-labelledby={`dnav-${dept.id}-boards`}>
          <li><NavLink to="/?dashboard=department" className={() => dashboard === 'department' ? 'active' : ''}>{N.departmentBoard}</NavLink></li>
          <li><NavLink to="/?dashboard=role" className={() => dashboard === 'role' ? 'active' : ''}>{N.roleBoard}</NavLink></li>
        </ul>
      </section>
      <div className="dnav-primary" aria-label={D.nav.primary}>{groups(menu.primary, 'primary')}</div>
      {menu.reference.length > 0 && <details className="sh-dnav__more dnav-reference" ref={more}>
        <summary>{D.nav.reference}</summary>
        <div className="dnav-reference__groups">{groups(menu.reference, 'reference')}</div>
      </details>}
      <div className="sh-dnav__foot">
        <NavLink to={`/procedures/roles?view=dept&dept=${dept.id}`} className={() => `sh-dnav__rnr${rnr ? ' active' : ''}`}>
          {D.nav.rnr}
        </NavLink>
        <button type="button" className="sh-dnav__all" onClick={onAll} title={D.nav.allMenuHint}>
          {D.nav.allMenu}
        </button>
      </div>
    </nav>
  );
}
