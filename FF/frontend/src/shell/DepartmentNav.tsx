// 부서 메뉴(데모 부서 보기) — 8그룹 레일·패널 대신 그 부서의 업무 화면만. 구조는 하나이고 배치는 화면 유형이 정한다(shell.css
// [data-workspace]): 기획 스튜디오·검토 포털은 위쪽 가로 메뉴, 심사 결재함·엔지니어링 콘솔·관제실은 왼쪽 세로 메뉴.
// 메뉴에 없는 화면도 주소로 열 수 있다(데모 — 화면 차단 없음). '전체 메뉴 보기'는 전체 보기(8그룹)로 돌아간다.
import { useEffect, useMemo, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { DepartmentSummary } from '@ff/contracts';
import { departments as D } from '../copy/departments';
import { Icon } from '../design';
import { routeOf, ROUTES } from '../routes';
import { departmentMenu, type DeptMenuItem } from './departmentMenu';

const horizontal = (w: string) => w === 'studio' || w === 'portal';
/** 번들 검사 표식 — 운영 빌드(OIDC)에 이 문자열이 있으면 데모 부서 보기가 실린 것이다(tools/prod-bundle.test.ts) */
export const DEPT_VIEW_MARKER = 'ff-dept-view-v1';
/** 가로 메뉴에 펼쳐 두는 주 업무 수 */
const FLAT_MAX = 6;

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
  const menu = useMemo(() => departmentMenu(dept), [dept]);
  const rnr = loc.pathname === '/procedures/roles' && new URLSearchParams(loc.search).get('view') === 'dept';
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
  return (
    <nav className="sh-dnav" aria-label={D.nav.label(dept.name)} data-dept-nav={dept.id} data-dept-marker={DEPT_VIEW_MARKER} data-zone={dept.workspace === 'console' ? 'ops' : undefined}>
      <div className="sh-dnav__head">
        <p className="sh-dnav__eyebrow">{D.workspace[dept.workspace]}</p>
        <p className="sh-dnav__name">{dept.name}</p>
        {!flat && <p className="sh-dnav__counts">{D.counts(dept.counts.R, dept.counts.A, dept.counts.C)}</p>}
      </div>
      <ul className="sh-dnav__list sh-dnav__list--fixed">
        <li>
          <NavLink to="/" end className={() => (loc.pathname === '/' ? 'active' : '')}>
            <Icon name="home" size={16} />
            {D.nav.home}
          </NavLink>
        </li>
        <li>
          <NavLink to="/procedures" className={() => (!rnr && loc.pathname.startsWith('/procedures') ? 'active' : '')} aria-label={procCount ? `${D.nav.procedures} — 내 차례 ${procCount}건` : undefined}>
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
      {flat ? (
        <>
          {/* 가로 메뉴는 한 줄에 — 주 업무 앞쪽만 펼치고 나머지 주 업무·협의·참조는 '더 보기'에 */}
          <ul className="sh-dnav__list" aria-label={D.nav.primary}>
            {menu.primary.slice(0, FLAT_MAX).map(link)}
          </ul>
          {menu.primary.length + menu.reference.length > FLAT_MAX && (
            <details className="sh-dnav__more" ref={more}>
              <summary>{D.nav.more}</summary>
              <div className="sh-dnav__drop">
                {/* 두 묶음 모두 머리말을 단다 — 펼친 주 업무의 나머지(내 업무)와 협의·참조 */}
                {menu.primary.length > FLAT_MAX && (
                  <>
                    <p className="sh-dnav__section" id={`dnav-mp-${dept.id}`}>
                      {D.nav.primary}
                    </p>
                    <ul className="sh-dnav__list" aria-labelledby={`dnav-mp-${dept.id}`}>
                      {menu.primary.slice(FLAT_MAX).map(link)}
                    </ul>
                  </>
                )}
                {menu.reference.length > 0 && (
                  <>
                    <p className="sh-dnav__section" id={`dnav-mr-${dept.id}`}>
                      {D.nav.reference}
                    </p>
                    <ul className="sh-dnav__list" aria-labelledby={`dnav-mr-${dept.id}`}>
                      {menu.reference.map(link)}
                    </ul>
                  </>
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        <>
          <p className="sh-dnav__section" id={`dnav-p-${dept.id}`}>
            {D.nav.primary}
          </p>
          <ul className="sh-dnav__list" aria-labelledby={`dnav-p-${dept.id}`}>
            {menu.primary.map(link)}
          </ul>
          {menu.reference.length > 0 && (
            <details className="sh-dnav__more">
              <summary>{D.nav.reference}</summary>
              <ul className="sh-dnav__list">{menu.reference.map(link)}</ul>
            </details>
          )}
        </>
      )}
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
