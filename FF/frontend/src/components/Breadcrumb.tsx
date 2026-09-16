import { NavLink, useLocation } from 'react-router-dom';
import { SCREEN_NAV, locatePath, useT } from '../i18n';
import { areaIdOfRoute } from '../data/uiLinks';

/**
 * 이동 경로 표시는 라우트에서 정본 IA(업무 그룹 ▸ 업무 영역 ▸ 화면)를 다시 계산한다.
 * 페이지마다 그룹 이름을 손으로 적으면 MENU 1.3과 어긋나므로(예: /master/bom → Feature 관리) 단일 규칙만 쓴다.
 * `title`은 화면 안에서 더 좁은 대상을 가리킬 때만 넘긴다(예: Topology Graph).
 *
 * 메뉴는 기준 화면 하나만 올린다. 그래서 한 화면이 구현 경로를 여러 개 가질 때는 이 「구현 뷰」 행이
 * 그 화면의 나머지 경로로 가는 유일한 이동점이 된다(경로 목록은 메뉴와 같은 표에서 나온다).
 */
export function Breadcrumb({ title }: { title?: string }) {
  const loc = useLocation();
  const { t, navDomain, navItem } = useT();
  const at = locatePath(loc.pathname);
  const here = loc.pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const screen = at ? SCREEN_NAV[at.screen.id] : undefined;
  const views = screen && screen.views.length > 1 ? screen.views : [];
  const areaId = areaIdOfRoute(here);

  const label = title || (at?.item ? navItem(at.item) : at?.screen.ko) || loc.pathname;
  const segs: string[] = [];
  if (at?.domain) segs.push(t(navDomain(at.domain)));
  if (at?.screen && at.screen.ko !== label) segs.push(t(at.screen.ko));
  segs.push(label);

  const uniq: string[] = [];
  segs.forEach((s) => { if (s && s !== uniq[uniq.length - 1]) uniq.push(s); });

  return (
    <div className="crumb-block">
      <div className="breadcrumb" data-screen={at?.screen.id || ''}>
        {at?.screen.id && <em className="crumb-id">{at.screen.id}</em>}
        <span>{uniq.join(' ▸ ')}</span>
        {areaId && <span className="crumb-area" title="정본 상세 영역">{areaId}</span>}
      </div>
      {views.length > 0 && (
        <nav className="views" aria-label="구현 뷰">
          <span className="views-lb">구현 뷰</span>
          {views.map(v => (
            <NavLink key={v.to} to={v.to} end={v.to === '/'} className={v.to === here ? 'active' : ''}>{navItem(v)}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
