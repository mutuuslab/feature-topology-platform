// Feature 상세 — 외부 연계(GitLab·JIRA·codeBeamer). 요구 → Feature 버전 → MR·파이프라인 → 정책·변경요청을 한 화면에서 따라간다.
// 값은 모두 /api/integrations/sync/features/:id/:ver 그대로다. 주인이 외부인 사실은 외부 도구에서 고치고(새 탭), 여기서는 보여 주고 연결만 한다.
import { Link } from 'react-router-dom';
import type { ExtLink } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { extSync } from '../../copy/ext-sync';
import { AsyncView, DataTable, ExtRefChip, Icon, Panel } from '../../design';

const X = extSync.feature;

export interface FeatureTrace {
  featureId: string;
  version: string;
  lifecycle: string;
  epicStatusExpected: string;
  requirements: ExtLink[];
  missingRequirements: string[];
  epic: ExtLink | null;
  changeRequests: ExtLink[];
  defects: ExtLink[];
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
/** 키 숫자 순서(FFD-2 < FFD-10) */
const byKeyNumber = (a: ExtLink, b: ExtLink) => Number(a.key.replace(/\D+/g, '')) - Number(b.key.replace(/\D+/g, '')) || a.key.localeCompare(b.key);
const clip = (text: string, ch = 48) => (
  <span className="ds-clip" title={text} style={{ maxWidth: `${ch}ch` }}>
    {text}
  </span>
);
const DEFECT_LIMIT = 10;

export function ExtLinksTab({ id, ver }: { id: string; ver: string }) {
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
  const columns = [
    { key: 'k', header: X.col.key, cell: (r: ExtLink) => <ExtRefChip r={r} showStatus={false} /> },
    { key: 't', header: X.col.title, cell: (r: ExtLink) => clip(r.title) },
    { key: 's', header: X.col.status, cell: (r: ExtLink) => r.status },
  ];
  return (
    <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
      {t && (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }} data-testid="ext-links">
          <ul className="ds-check" aria-label={X.chain}>
            {issues.length ? (
              issues.map((m) => (
                <li key={m} data-state="FAIL">
                  <Icon name="alert" size={16} />
                  <span>{m}</span>
                </li>
              ))
            ) : (
              <li data-state="PASS">
                <Icon name="check" size={16} />
                <span>{X.key.clean}</span>
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
          {!!t.defects.length && (
            <Panel title={X.defects} id="ext-defects" eyebrow={t.defects.length > DEFECT_LIMIT ? X.latest(DEFECT_LIMIT, t.defects.length) : undefined}>
              <DataTable caption={X.defects} rows={[...t.defects].sort(byKeyNumber).reverse().slice(0, DEFECT_LIMIT)} rowKey={rowKey} columns={columns} />
            </Panel>
          )}
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
