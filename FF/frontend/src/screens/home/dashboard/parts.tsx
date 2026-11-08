// 가젯 본문 공통 부품 — Jira 가젯처럼: 회색 머리 줄 표, 파란 키 링크, 상태 Lozenge, 이니셜 아바타, 빈 상태·오류 한 줄.
// 가젯 본문 묶음(bodies-*.tsx)만 쓴다 — 첫 화면 묶음 밖.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiError } from '../../../api/client';
import { dashboard } from '../../../copy/dashboard';
import { ErrorNextStep, Lozenge } from '../../../design';

const Bd = dashboard.board.body;

/** 불러오기·오류·빈 상태 — 데이터가 오기 전에 '없음'이라고 말하지 않는다 */
export function GadgetState({ state, error, retry, empty, emptyText, children }: { state: 'loading' | 'ready' | 'error'; error?: ApiError | null; retry?: () => void; empty?: boolean; emptyText?: string; children: ReactNode }) {
  if (state === 'loading')
    return (
      <div className="jd-skel" data-state="loading" role="progressbar" aria-busy="true" aria-label={dashboard.board.gadget.loading}>
        <span />
        <span />
        <span />
      </div>
    );
  if (state === 'error')
    return (
      <div className="jd-note jd-note--error" role="status">
        <p>{error?.message ?? dashboard.board.gadget.loadFailed}</p>
        <ErrorNextStep error={error} />
        {retry && (
          <button type="button" className="jd-btn jd-btn--subtle" onClick={retry}>
            {dashboard.board.gadget.refresh}
          </button>
        )}
      </div>
    );
  if (empty) return <p className="jd-empty-line">{emptyText ?? Bd.empty}</p>;
  return <>{children}</>;
}

export function KeyLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="jd-key">
      {children}
    </Link>
  );
}

export function Status({ value }: { value: string }) {
  return value ? <Lozenge>{value}</Lozenge> : <span className="jd-muted">{Bd.none}</span>;
}

/** 이니셜 아바타 — 행위자 id(usr-author)·이름에서 두 글자. 색은 이름에서 정해 같은 사람은 늘 같은 색 */
export function Avatar({ who }: { who: string }) {
  const name = who.replace(/^usr-/, '').replace(/^system:?/, 'sys');
  const initials = (name.match(/[A-Za-z가-힣0-9]/g) ?? ['?']).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className="jd-avatar" data-tone={h % 6} aria-hidden title={who}>
      {initials}
    </span>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** 줄여 보이는 열(요약) — 남는 폭을 가져간다 */
  grow?: boolean;
}

/** Jira 표 — 회색 머리 줄, 얇은 줄 구분, 행 위에 올리면 옅은 바탕 */
export function JiraTable<T>({ caption, rows, columns, rowKey }: { caption: string; rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string }) {
  return (
    <div className="jd-table-wrap">
      <table className="jd-table">
        <caption className="ds-sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-grow={c.grow ? '' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} data-grow={c.grow ? '' : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 표 아래 — "68건 중 10건 · 전체 보기" */
export function TableFoot({ shown, total, to }: { shown: number; total: number; to?: string }) {
  return (
    <p className="jd-tablefoot">
      <span>{Bd.shown(shown, total)}</span>
      {to && shown < total && <Link to={to}>{Bd.viewAll}</Link>}
    </p>
  );
}

/** 차트 범주 색(8) — 판 토큰 */
export const SERIES = ['var(--jd-c1)', 'var(--jd-c2)', 'var(--jd-c3)', 'var(--jd-c4)', 'var(--jd-c5)', 'var(--jd-c6)', 'var(--jd-c7)', 'var(--jd-c8)'];
