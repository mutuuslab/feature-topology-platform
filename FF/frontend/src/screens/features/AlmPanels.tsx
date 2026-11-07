// Feature 상세 '연계' 탭 — Epic 아래 이슈(80-50 §8): 기능 분해 Story, 현장 문제 Bug(운영 연결). 값은 /api/integrations/sync/features/:id/:ver 그대로.
import { Link } from 'react-router-dom';
import type { ExtLink } from '@ff/contracts';
import { alm } from '../../copy/alm';
import { DataTable, ExtRefChip, Panel } from '../../design';

const A = alm.children;
const rowKey = (r: ExtLink) => `${r.system}:${r.key}`;
const byKeyNumber = (a: ExtLink, b: ExtLink) => Number(a.key.replace(/\D+/g, '')) - Number(b.key.replace(/\D+/g, '')) || a.key.localeCompare(b.key);
const clip = (text: string, ch = 48) => (
  <span className="ds-clip" title={text} style={{ maxWidth: `${ch}ch` }}>
    {text}
  </span>
);
const LIMIT = 10;

/** 기능 분해 — FF 기능(FUNC)마다 Epic 아래 Story */
export function StoriesPanel({ stories, functions }: { stories: ExtLink[]; functions: { functionId: string; label: string }[] }) {
  if (!stories.length) return null;
  const label = new Map(functions.map((f) => [f.functionId, f.label]));
  return (
    <Panel title={A.stories} id="ext-stories">
      <DataTable
        caption={A.stories}
        rows={[...stories].sort(byKeyNumber)}
        rowKey={rowKey}
        columns={[
          { key: 'k', header: A.col.key, cell: (r) => <ExtRefChip r={r} showStatus={false} /> },
          { key: 'f', header: A.col.function, cell: (r) => <span className="ds-mono ds-nowrap">{String(r.extra.functionId ?? '—')}</span> },
          { key: 't', header: A.col.title, cell: (r) => clip(label.get(String(r.extra.functionId)) ?? r.title) },
          { key: 's', header: A.col.status, cell: (r) => r.status },
        ]}
      />
    </Panel>
  );
}

/** 현장 문제 — Epic 아래 Bug. FF가 만든 것은 운영 인시던트·긴급 차단과 이어지고, JIRA에서 만든 것은 인시던트 후보 */
export function FieldIssuesPanel({ defects }: { defects: ExtLink[] }) {
  if (!defects.length) return null;
  const rows = [...defects].sort(byKeyNumber).reverse().slice(0, LIMIT);
  return (
    <Panel title={A.fieldIssues} id="ext-defects" eyebrow={defects.length > LIMIT ? A.latest(LIMIT, defects.length) : undefined}>
      <DataTable
        caption={A.fieldIssues}
        rows={rows}
        rowKey={rowKey}
        columns={[
          { key: 'k', header: A.col.key, cell: (r) => <ExtRefChip r={r} showStatus={false} /> },
          { key: 't', header: A.col.title, cell: (r) => clip(r.title) },
          { key: 's', header: A.col.status, cell: (r) => r.status },
          {
            key: 'o',
            header: A.col.ops,
            cell: (r) =>
              r.extra.killId ? (
                <Link to="/ops/kill">{A.kill(String(r.extra.killId))}</Link>
              ) : r.extra.incidentId ? (
                <Link to="/ops/incidents">{A.incident(String(r.extra.incidentId))}</Link>
              ) : r.extra.ref ? (
                <span className="ds-mono">{String(r.extra.ref)}</span>
              ) : (
                <Link to="/ops/incidents">{A.candidate}</Link>
              ),
          },
        ]}
      />
    </Panel>
  );
}
