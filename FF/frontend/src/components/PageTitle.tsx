import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { canonTitleOf, useT } from '../i18n';

/**
 * 화면 머리(h1) — 정본 IA 이름이 있으면 그 이름을 쓰고, 없으면 화면이 넘긴 이름을 쓴다.
 *
 * 제목을 화면마다 손으로 적으면 MENU 1.3(기준 화면 이름)·정본 상세 영역 표와 어긋난다.
 * 그래서 제목의 근거를 경로 하나로 모으고, 화면은 자기 사정(기록 ID·실시간 표시)만 덧붙인다.
 *
 * - `fallback`  정본 제목이 없는 화면의 이름. `/feature/:id` 처럼 대상이 기록마다 달라지는 상세 화면에 쓴다.
 * - `detail`    제목 뒤에 ` · ` 로 붙는 좁은 대상 (예: 변경요청 · Revision 비교 · v1.0 ↔ v1.1).
 * - `suffix`    구분자 없이 바로 붙는 표식 (예: UI04·C03 pill, LIVE 표시).
 */
export function PageTitle({ fallback, detail, suffix, className = 'page-title' }: {
  fallback?: ReactNode;
  detail?: ReactNode;
  suffix?: ReactNode;
  className?: string;
}) {
  const { pathname } = useLocation();
  const { lang } = useT();
  const title = canonTitleOf(pathname, lang) ?? fallback;
  if (title == null) return null;
  return (
    <h1 className={className}>
      {title}
      {detail != null ? <span className="title-detail"> · {detail}</span> : null}
      {suffix != null ? <> {suffix}</> : null}
    </h1>
  );
}
