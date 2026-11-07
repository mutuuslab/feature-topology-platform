// Feature 상세 — 외부 연계(GitLab·JIRA·codeBeamer). 요구 → Feature 버전 → MR·파이프라인 → 정책·변경요청을 한 화면에서 따라간다.
// 값은 모두 /api/integrations/sync/features/:id/:ver 그대로다. 주인이 외부인 사실은 외부 도구에서 고치고(새 탭), 여기서는 보여 주고 연결만 한다.
import { Link } from 'react-router-dom';
import type { ExtLink } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { extSync } from '../../copy/ext-sync';
import { AsyncView, DataTable, ExtRefChip, Icon, Panel } from '../../design';
import { ExternalToolLaunchers } from '../../external/launchers';
import { useExternalChanges } from '../../external/useExternalChanges';
import { FieldIssuesPanel, StoriesPanel } from './AlmPanels';

const X = extSync.feature;

export interface FeatureTrace {
  featureId: string;
  version: string;
  lifecycle: string;
  /** Epic = Feature(80-50 §4.1) — Epic 상태가 따르는 버전(작업 중 버전) */
  epicVersion?: string;
  epicStatusExpected: string;
  requirements: ExtLink[];
  missingRequirements: string[];
  epic: ExtLink | null;
  changeRequests: ExtLink[];
  defects: ExtLink[];
  /** 80-50 A3 — 기능 분해 Story·산출물 Task */
  stories?: ExtLink[];
  tasks?: ExtLink[];
  mergeRequests: ExtLink[];
  pipelines: ExtLink[];
  policies: { policyId: string; flagKey: string; status: string; changeRequests: string[] }[];
  conflicts: { conflictId: number; key: string }[];
  stale: string[];
}

export const useFeatureTrace = (id: string, ver: string) => useApi<FeatureTrace>('extFeatureTrace', { params: { id, ver } }, { staleTime: 15_000 });

/** 머리 메타의 JIRA Epic 칩 */
export function EpicChip({ id, ver }: { id: string; ver: string }) {
  const q = useFeatureTrace(id, ver);
  return q.data?.epic ? <ExtRefChip r={q.data.epic} /> : null;
}

/** 개요의 요구 ID — codeBeamer 항목이면 칩, 못 찾으면 ID 그대로 */
export function RequirementChips({ id, ver, ids }: { id: string; ver: string; ids: string[] }) {
  const q = useFeatureTrace(id, ver);
  const byReq = new Map((q.data?.requirements ?? []).map((r) => [String(r.extra.reqId ?? ''), r]));
  return (
    <span className="ds-ext-list" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      {ids.map((reqId) => {
        const r = byReq.get(reqId);
        return r ? (
          <span key={reqId} style={{ display: 'grid', gap: 2, justifyItems: 'start' }}>
            <span className="ds-mono ds-nowrap">{reqId}</span>
            <ExtRefChip r={r} showStatus />
          </span>
        ) : (
          <span key={reqId} className="ds-mono">
            {reqId}
          </span>
        );
      })}
    </span>
  );
}

const rowKey = (r: ExtLink) => `${r.system}:${r.key}`;
const clip = (text: string, ch = 48) => (
  <span className="ds-clip" title={text} style={{ maxWidth: `${ch}ch` }}>
    {text}
  </span>
);

export function ExtLinksTab({ id, ver, functions }: { id: string; ver: string; functions?: { functionId: string; label: string }[] }) {
  useExternalChanges();
  const q = useFeatureTrace(id, ver);
  const t = q.data;
  const issues: string[] = t
    ? [
        ...(t.missingRequirements.length ? [X.missing(t.missingRequirements.join(', '))] : []),
        ...(t.stale.length ? [X.stale(t.stale.length)] : []),
        ...(t.epic && t.epic.status !== t.epicStatusExpected ? [X.epicMismatch(t.epicStatusExpected, t.epic.status)] : []),
        ...(t.conflicts.length ? [X.conflicts(t.conflicts.length)] : []),
      ]
    : [];
  // 문제가 없을 때 — 연결이 하나도 없으면 '맞음'(초록)이 아니라 안내, 일부만 있으면 빠진 쪽을 적는다
  const missing = t ? [!t.requirements.length && X.requirements, !t.epic && !t.changeRequests.length && X.changeRequests, !t.mergeRequests.length && X.code].filter((x) => !!x) as string[] : [];
  const linkedNone = !!t && missing.length === 3;
  const columns = [
    { key: 'k', header: X.col.key, cell: (r: ExtLink) => <ExtRefChip r={r} showStatus={false} /> },
    { key: 't', header: X.col.title, cell: (r: ExtLink) => clip(r.title) },
    { key: 's', header: X.col.status, cell: (r: ExtLink) => r.status },
  ];
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {t && (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }} data-testid="ext-links">
          <ExternalToolLaunchers requirement={t.requirements[0]} jira={t.epic ?? t.changeRequests[0]} featureId={id} version={ver} />
          <ul className="ds-check" aria-label={X.chain}>
            {issues.length ? (
              issues.map((m) => (
                <li key={m} data-state="FAIL">
                  <Icon name="alert" size={16} />
                  <span>{m}</span>
                </li>
              ))
            ) : (
              <li data-state={missing.length ? 'INFO' : 'PASS'}>
                <Icon name={missing.length ? 'link' : 'check'} size={16} />
                <span>{linkedNone ? X.key.unlinked : missing.length ? X.key.partial(missing.join(' · ')) : X.key.clean}</span>
              </li>
            )}
          </ul>
          <Panel title={X.requirements} id="ext-req">
            {t.requirements.length ? <DataTable caption={X.requirements} rows={t.requirements} rowKey={rowKey} columns={[{ key: 'id', header: X.col.reqId, cell: (r) => <span className="ds-mono ds-nowrap">{String(r.extra.reqId ?? '')}</span> }, { ...columns[0], header: X.col.cbItem }, ...columns.slice(1)]} /> : <p className="ds-field__hint">{X.none}</p>}
          </Panel>
          <Panel title={X.changeRequests} id="ext-cr" eyebrow={t.epic ? undefined : X.none}>
              {t.epic && (
                <p>
                  {X.epic} <ExtRefChip r={t.epic} />
                </p>
              )}
              {t.changeRequests.length ? <DataTable caption={X.changeRequests} rows={t.changeRequests} rowKey={rowKey} columns={columns} /> : <p className="ds-field__hint">{X.none}</p>}
          </Panel>
          <StoriesPanel stories={t.stories ?? []} functions={functions ?? []} />
          <FieldIssuesPanel defects={t.defects} />
          <Panel title={X.code} id="ext-code">
              {t.mergeRequests.length ? (
                <DataTable
                  caption={X.code}
                  rows={t.mergeRequests}
                  rowKey={rowKey}
                  columns={[
                    ...columns,
                    { key: 'b', header: X.col.branch, cell: (r) => <span className="ds-mono">{clip(String(r.extra.sourceBranch ?? '—'), 40)}</span> },
                    { key: 'p', header: X.pipeline, cell: (r) => String((r.extra.pipeline as { status?: string } | undefined)?.status ?? '—') },
                  ]}
                />
              ) : (
                <p className="ds-field__hint">{X.none}</p>
              )}
          </Panel>
          <Panel title={X.policies} id="ext-pol">
            {t.policies.length ? (
              <DataTable
                caption={X.policies}
                rows={t.policies}
                rowKey={(p) => p.policyId}
                columns={[
                  { key: 'p', header: X.col.policy, cell: (p) => <Link to={`/policies/${p.policyId}`}>{p.policyId}</Link> },
                  { key: 'f', header: X.col.flag, cell: (p) => <span className="ds-mono">{p.flagKey}</span> },
                  { key: 's', header: X.col.status, cell: (p) => p.status },
                  { key: 'c', header: X.col.cr, cell: (p) => (p.changeRequests.length ? <span className="ds-mono">{p.changeRequests.join(', ')}</span> : <span style={{ color: 'var(--danger)' }}>{X.noCr}</span>) },
                ]}
              />
            ) : (
              <p className="ds-field__hint">{X.none}</p>
            )}
          </Panel>
        </div>
      )}
    </AsyncView>
  );
}
