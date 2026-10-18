// 외부 항목 칩 — GitLab·JIRA·codeBeamer 항목 하나. 도구 이름(글자)·키(새 탭 링크)·외부 상태·동기 상태.
// 색만으로 구분하지 않는다: 도구는 글자 표지, 동기 문제는 글자와 아이콘으로 함께 보인다. IdChip과 같은 크기 규칙.
import type { ExtRef } from '@ff/contracts';
import { extSync } from '../copy/ext-sync';
import { Icon } from './icons';

const X = extSync;

export function ExtRefChip({ r, showStatus = true, title }: { r: Pick<ExtRef, 'system' | 'kind' | 'key' | 'url' | 'status' | 'syncState' | 'stale' | 'title'>; showStatus?: boolean; title?: boolean }) {
  const sys = X.system[r.system];
  const trouble = r.syncState !== 'SYNCED' && r.syncState !== 'PENDING';
  return (
    <span className="ds-ext" data-system={r.system} data-sync={r.syncState} data-key={r.key}>
      <span className="ds-ext__sys">{sys}</span>
      <a className="ds-ext__key" href={r.url} target="_blank" rel="noopener noreferrer" title={X.open(sys)}>
        {r.key}
      </a>
      {title && r.title && <span className="ds-ext__title">{r.title}</span>}
      {showStatus && r.status && <span className="ds-ext__status">{r.status}</span>}
      {r.syncState !== 'SYNCED' && (
        <span className="ds-ext__sync" data-trouble={trouble || undefined}>
          {trouble && <Icon name="alert" size={12} />}
          {X.state[r.syncState]}
        </span>
      )}
      {r.stale && (
        <span className="ds-ext__sync" data-trouble title={X.staleTitle}>
          <Icon name="alert" size={12} />
          {X.stale}
        </span>
      )}
    </span>
  );
}
