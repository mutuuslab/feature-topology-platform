import { useLocation } from 'react-router-dom';
import { locatePath, useT } from '../i18n';

/**
 * 이동 경로 표시는 라우트에서 정본 IA(업무 그룹 ▸ 업무 영역 ▸ 화면)를 다시 계산한다.
 * 페이지마다 그룹 이름을 손으로 적으면 MENU 1.3과 어긋나므로(예: /master/bom → Feature 관리) 단일 규칙만 쓴다.
 * `title`은 화면 안에서 더 좁은 대상을 가리킬 때만 넘긴다(예: Topology Graph).
 */
export function Breadcrumb({ title }: { title?: string }) {
  const loc = useLocation();
  const { t, navDomain, navItem } = useT();
  const at = locatePath(loc.pathname);

  const label = title || (at?.item ? navItem(at.item) : at?.screen.ko) || loc.pathname;
  const segs: string[] = [];
  if (at?.domain) segs.push(t(navDomain(at.domain)));
  if (at?.screen && at.screen.ko !== label) segs.push(t(at.screen.ko));
  segs.push(label);

  const uniq: string[] = [];
  segs.forEach((s) => { if (s && s !== uniq[uniq.length - 1]) uniq.push(s); });

  return <div className="breadcrumb" data-screen={at?.screen.id || ''}>{uniq.join(' ▸ ')}</div>;
}
