// 정책 상세의 버전 이력 (D01-06) — 개정본 목록(변경 종류·변경자·바뀐 항목·그 개정본의 검증), 버전 내용과 지금 내용의 차이,
// 변경 이력(변경 전 → 변경 후), 이 버전으로 복원(새 개정본·DRAFT). 복원 가능 여부·차이 계산은 서버(contracts policy-version)와 같다.
import { useState } from 'react';
import { POLICY_REVISION_KIND_LABEL, type PolicyChange, type PolicyChangeEntry, type PolicyRevisionKind, type PolicySpec } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Panel, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const V = ko.policy.versions;
const INVALIDATE = ['policyRevisions', 'policyRevision', 'policyChanges', 'policyDetail', 'listPolicies', 'audit'];
const DECISION_VERDICT: Record<string, string> = { GO: 'PASS', HOLD: 'CONDITIONAL', BLOCKED: 'FAIL' };

interface RevisionRow {
  revision: number;
  contentHash: string;
  kind: PolicyRevisionKind;
  changedBy: string;
  changedAt: string;
  restoredFrom: number | null;
  reason: string | null;
  current: boolean;
  validations: { runId: string; decision: string; at: string }[];
}
interface Revisions {
  policyId: string;
  current: number;
  status: string;
  restorable: boolean;
  items: RevisionRow[];
}

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function ChangeTable({ rows, before, after, caption }: { rows: PolicyChange[]; before: string; after: string; caption: string }) {
  return (
    <table className="ds-table pv-diff" aria-label={caption}>
      <thead>
        <tr>
          <th scope="col">{V.col.changes}</th>
          <th scope="col">{before}</th>
          <th scope="col">{after}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.path}>
            <th scope="row" className="ds-mono">{c.path}</th>
            <td className="ds-mono pv-diff__before">{show(c.before)}</td>
            <td className="ds-mono pv-diff__after">{show(c.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RevisionDrawer({ policyId, revision, restorable, onClose }: { policyId: string; revision: number | null; restorable: boolean; onClose: () => void }) {
  const q = useApi<RevisionRow & { spec: PolicySpec; changesFromCurrent: PolicyChange[] }>('policyRevision', { params: { id: policyId, revision: String(revision ?? 0) } }, { enabled: revision !== null });
  const restore = useApiMutation<{ revision: number }>('restorePolicyRevision', INVALIDATE);
  const perm = usePermission(['FEATURE_AUTHOR', 'IMPLEMENTER']);
  const [reason, setReason] = useState('');
  const r = q.data;
  return (
    <Drawer open={revision !== null} title={revision !== null ? V.drawerTitle(revision) : ''} onClose={onClose}>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()} rows={4}>
        {r && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <p className="pv-meta">
              <span className="ds-tag">{POLICY_REVISION_KIND_LABEL[r.kind]}</span> <span className="ds-mono">{r.changedBy}</span> · {when(r.changedAt)}
              {r.restoredFrom !== null && <> · {V.from(r.restoredFrom)}</>}
              {r.current && <> · <strong>{V.current}</strong></>}
            </p>
            <h3 className="pv-h">{V.diffTitle}</h3>
            {r.changesFromCurrent.length ? <ChangeTable rows={r.changesFromCurrent} before={V.diffBefore} after={V.diffAfter(r.revision)} caption={V.diffTitle} /> : <p>{V.same}</p>}
            <pre className="ds-mono pv-spec" aria-label={V.drawerTitle(r.revision)}>{JSON.stringify(r.spec, null, 2)}</pre>
            {!r.current && r.changesFromCurrent.length > 0 && (
              restorable ? (
                <>
                  <Field label={ko.page.reason} hint={V.restoreHint}>
                    <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
                  </Field>
                  <ErrorNote error={restore.error} />
                  <div>
                    <Button
                      variant="primary"
                      disabled={!perm.ok || reason.trim().length < 2 || restore.isPending}
                      title={perm.hint}
                      onClick={() => restore.mutate({ params: { id: policyId, revision: String(r.revision) }, body: { reason } }, { onSuccess: () => (setReason(''), onClose()) })}
                    >
                      {V.restore}
                    </Button>
                  </div>
                </>
              ) : null
            )}
          </div>
        )}
      </AsyncView>
    </Drawer>
  );
}

export function PolicyVersions({ policyId }: { policyId: string }) {
  const q = useApi<Revisions>('policyRevisions', { params: { id: policyId } });
  const ch = useApi<{ items: PolicyChangeEntry[] }>('policyChanges', { params: { id: policyId } });
  const [open, setOpen] = useState<number | null>(null);
  const d = q.data;
  const items = d?.items ?? [];
  const log = ch.data?.items ?? [];
  const changes = new Map(log.map((e) => [e.revision, e]));
  return (
    <Panel title={V.title} id="versions" eyebrow={d ? `r${d.current} · ${items.length}` : undefined}>
      <p className="pv-lead">{V.lead}</p>
      {d && !d.restorable && <p className="pv-lead" role="note">{V.lockedNote(d.status)}</p>}
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()} rows={3}>
        {d && (
          <DataTable
            caption={V.title}
            rows={items}
            rowKey={(r) => String(r.revision)}
            onOpen={(r) => setOpen(r.revision)}
            columns={[
              { key: 'rev', header: V.col.rev, cell: (r) => <span className="ds-mono">r{r.revision}{r.current ? ` · ${V.current}` : ''}</span>, sort: (r) => r.revision },
              { key: 'kind', header: V.col.kind, cell: (r) => <span className="ds-tag">{POLICY_REVISION_KIND_LABEL[r.kind]}{r.restoredFrom !== null ? ` · ${V.from(r.restoredFrom)}` : ''}</span> },
              { key: 'by', header: V.col.by, cell: (r) => <span className="ds-mono">{r.changedBy}</span> },
              { key: 'at', header: V.col.at, cell: (r) => <span className="ds-mono">{when(r.changedAt)}</span> },
              {
                key: 'changes',
                header: V.col.changes,
                cell: (r) => {
                  const e = changes.get(r.revision);
                  if (r.kind === 'IMPORTED') return <span className="pv-lead">{V.imported}</span>;
                  if (!e || r.kind === 'CREATE') return V.created;
                  return <span className="ds-mono">{e.changes.map((c) => c.path).join(', ') || V.none}</span>;
                },
              },
              { key: 'val', header: V.col.validation, cell: (r) => (r.validations[0] ? <VerdictBadge value={DECISION_VERDICT[r.validations[0].decision] ?? '미판정'} /> : V.none) },
            ]}
          />
        )}
      </AsyncView>
      {log.some((e) => e.kind === 'UPDATE' || e.kind === 'RESTORE') && (
        <details className="pv-log">
          <summary>{V.changesTitle}</summary>
          {log
            .filter((e) => e.kind === 'UPDATE' || e.kind === 'RESTORE')
            .map((e) => (
              <section key={e.revision}>
                <h3 className="pv-h">
                  r{e.revision} · {POLICY_REVISION_KIND_LABEL[e.kind]}{e.restoredFrom !== null ? ` · ${V.from(e.restoredFrom)}` : ''} · <span className="ds-mono">{e.changedBy}</span> · {when(e.changedAt)}
                  {e.reason ? ` · ${e.reason}` : ''}
                </h3>
                <ChangeTable rows={e.changes} before={`r${e.revision - 1}`} after={`r${e.revision}`} caption={`r${e.revision}`} />
              </section>
            ))}
        </details>
      )}
      <RevisionDrawer policyId={policyId} revision={open} restorable={!!d?.restorable} onClose={() => setOpen(null)} />
    </Panel>
  );
}
