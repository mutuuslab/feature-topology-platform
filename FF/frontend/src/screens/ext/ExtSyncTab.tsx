// 외부 연계 — 양방향 탭(GitLab·JIRA·codeBeamer). 시스템별 연결·주인 규칙·충돌(사람이 고름)·받은 변경·보내기 실패,
// 그리고 모의 연결일 때 "외부에서 바꿔 보기"(실제 webhook과 같은 경로로 들어온다).
import { useState } from 'react';
import { EXT_SYSTEMS, type ExtSystem, type ExtSystemSummary, type OwnershipRule } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { extSync } from '../../copy/ext-sync';
import { AsyncView, Button, DataTable, ErrorNote, Field, Panel, Select } from '../../design';
import { usePermission, when } from '../shared';

const X = extSync.sync;
const INVALIDATE = ['extSync', 'extConflicts', 'extInbox', 'extOutbox', 'extChangeRequests', 'extFeatureTrace', 'featureDetail', 'policyDetail', 'mockExtItems'];

interface Conflict {
  conflictId: number;
  system: ExtSystem;
  key: string;
  field: string;
  platformValue: string;
  externalValue: string;
  createdAt: string;
}
interface InboxRow {
  system: ExtSystem;
  deliveryId: string;
  receivedAt: string;
  key: string;
  outcome: string;
  summary: string;
  externalUser: string;
}
interface Job {
  jobId: number;
  system: ExtSystem;
  createdAt: string;
  attempts: number;
  error: string | null;
  job: { op: string };
}

export function ExtSyncTab() {
  const s = useApi<{ items: ExtSystemSummary[]; ownership: OwnershipRule[] }>('extSync', {}, { refetchInterval: 10_000 });
  const conflicts = useApi<{ items: Conflict[] }>('extConflicts', { query: { status: 'OPEN' } });
  const inbox = useApi<{ items: InboxRow[] }>('extInbox');
  const failed = useApi<{ items: Job[] }>('extOutbox', { query: { status: 'FAILED' } });
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <Panel title={X.summary} id="sync-systems">
        <AsyncView state={asyncState(s)} error={s.error?.message} onRetry={() => s.refetch()}>
          <DataTable
            caption={X.summary}
            rows={s.data?.items ?? []}
            rowKey={(r) => r.system}
            columns={[
              { key: 's', header: X.col.system, cell: (r) => <strong>{extSync.system[r.system]}</strong> },
              { key: 'i', header: X.col.ifId, cell: (r) => <span className="ds-mono">{r.ifId}</span> },
              { key: 'm', header: X.col.mode, cell: (r) => extSync.mode[r.mode] ?? r.mode },
              { key: 'l', header: X.col.links, cell: (r) => r.links.toLocaleString('ko-KR'), align: 'right' },
              { key: 'p', header: X.col.pending, cell: (r) => r.pending, align: 'right' },
              { key: 'f', header: X.col.failed, cell: (r) => <span style={r.failed ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.failed}</span>, align: 'right' },
              { key: 'c', header: X.col.conflicts, cell: (r) => <span style={r.conflicts ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.conflicts}</span>, align: 'right' },
              { key: 'r', header: X.col.rejected, cell: (r) => r.rejected, align: 'right' },
              { key: 'in', header: X.col.lastIn, cell: (r) => <span className="ds-mono">{r.lastInboundAt ? when(r.lastInboundAt) : '—'}</span> },
              { key: 'out', header: X.col.lastOut, cell: (r) => <span className="ds-mono">{r.lastOutboundAt ? when(r.lastOutboundAt) : '—'}</span> },
            ]}
          />
        </AsyncView>
      </Panel>

      <Panel title={X.conflicts} id="sync-conflicts">
        <AsyncView state={asyncState(conflicts)} error={conflicts.error?.message} onRetry={() => conflicts.refetch()}>
          {(conflicts.data?.items ?? []).length ? <ConflictTable rows={conflicts.data!.items} /> : <p className="ds-field__hint">{X.noConflicts}</p>}
        </AsyncView>
      </Panel>

      <Panel title={X.inbox} id="sync-inbox">
          <AsyncView state={asyncState(inbox)} error={inbox.error?.message} onRetry={() => inbox.refetch()}>
            <DataTable
              caption={X.inbox}
              rows={(inbox.data?.items ?? []).filter((r) => r.key !== '-').slice(0, 30)}
              rowKey={(r) => `${r.system}:${r.deliveryId}`}
              maxHeight="40vh"
              columns={[
                { key: 'at', header: X.inboxCol.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.receivedAt)}</span> },
                { key: 'k', header: X.inboxCol.key, cell: (r) => <span className="ds-mono">{r.key}</span> },
                { key: 'o', header: X.inboxCol.outcome, cell: (r) => <span style={r.outcome === 'REJECTED' || r.outcome === 'UNMAPPED' ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{X.outcome[r.outcome] ?? r.outcome}</span> },
                { key: 's', header: X.inboxCol.summary, cell: (r) => r.summary },
                { key: 'u', header: X.inboxCol.user, cell: (r) => <span className="ds-mono">{r.externalUser || '—'}</span> },
              ]}
            />
          </AsyncView>
      </Panel>
      {(failed.data?.items ?? []).length > 0 && (
        <Panel title={X.outbox} id="sync-failed">
          <AsyncView state={asyncState(failed)} error={failed.error?.message} onRetry={() => failed.refetch()}>
            {(failed.data?.items ?? []).length ? (
              <DataTable
                caption={X.outbox}
                rows={failed.data!.items}
                rowKey={(r) => String(r.jobId)}
                maxHeight="40vh"
                columns={[
                  { key: 'at', header: X.outboxCol.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.createdAt)}</span> },
                  { key: 's', header: X.outboxCol.system, cell: (r) => extSync.system[r.system] },
                  { key: 'o', header: X.outboxCol.op, cell: (r) => <span className="ds-mono">{r.job.op}</span> },
                  { key: 'n', header: X.outboxCol.attempts, cell: (r) => r.attempts, align: 'right' },
                  { key: 'e', header: X.outboxCol.error, cell: (r) => r.error ?? '—' },
                ]}
              />
            ) : (
              <p className="ds-field__hint">{X.noFailures}</p>
            )}
          </AsyncView>
        </Panel>
      )}

      <Panel title={X.ownership} id="sync-ownership">
        <DataTable
          caption={X.ownership}
          rows={(s.data?.ownership ?? []) as OwnershipRule[]}
          rowKey={(r) => r.fact}
          columns={[
            { key: 'f', header: X.ownCol.fact, cell: (r) => <strong>{r.fact}</strong> },
            { key: 'o', header: X.ownCol.owner, cell: (r) => extSync.owner[r.owner] ?? r.owner },
            { key: 'r', header: X.ownCol.reverse, cell: (r) => r.reverse },
          ]}
        />
      </Panel>

      {s.data?.items.some((x) => x.mode === 'mock') && <Simulate />}
    </div>
  );
}

function ConflictTable({ rows }: { rows: Conflict[] }) {
  const perm = usePermission(['IMPLEMENTER', 'RELEASE_MANAGER', 'FEATURE_APPROVER']);
  const resolve = useApiMutation('resolveExtConflict', INVALIDATE);
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <Field label={X.resolveReason}>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!perm.ok} />
      </Field>
      <DataTable
        caption={X.conflicts}
        rows={rows}
        rowKey={(r) => String(r.conflictId)}
        columns={[
          { key: 'at', header: X.conflictCol.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.createdAt)}</span> },
          { key: 's', header: X.conflictCol.system, cell: (r) => extSync.system[r.system] },
          { key: 'k', header: X.conflictCol.key, cell: (r) => <span className="ds-mono">{r.key}</span> },
          { key: 'f', header: X.conflictCol.field, cell: (r) => r.field },
          { key: 'p', header: X.conflictCol.platform, cell: (r) => <strong>{r.platformValue}</strong> },
          { key: 'e', header: X.conflictCol.external, cell: (r) => <strong>{r.externalValue}</strong> },
          {
            key: 'a',
            header: X.conflictCol.act,
            cell: (r) => (
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                {(['PLATFORM', 'EXTERNAL'] as const).map((choose) => (
                  <Button key={choose} variant={choose === 'PLATFORM' ? 'primary' : 'default'} disabled={!perm.ok || reason.trim().length < 2 || resolve.isPending} title={perm.hint} onClick={() => resolve.mutate({ params: { id: String(r.conflictId) }, body: { choose, reason: reason.trim() } })}>
                    {choose === 'PLATFORM' ? X.choosePlatform : X.chooseExternal}
                  </Button>
                ))}
              </span>
            ),
          },
        ]}
      />
      <ErrorNote error={resolve.error} />
    </div>
  );
}

function Simulate() {
  const [open, setOpen] = useState(false);
  return (
    <details className="ds-panel" id="sync-simulate" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <strong>{X.simulate}</strong>
      </summary>
      {open && <SimulateForm />}
    </details>
  );
}

function SimulateForm() {
  const [system, setSystem] = useState<ExtSystem>('JIRA');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [user, setUser] = useState('park.release');
  const items = useApi<{ items: { key: string; kind: string; title: string; status: string }[] }>('mockExtItems', { params: { system: system.toLowerCase() } });
  const act = useApiMutation<{ result: { outcome: string; summary: string } | null }>('mockExtAct', INVALIDATE);
  const list = (items.data?.items ?? []).filter((x) => x.kind !== 'PIPELINE').slice(-200);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
      <p className="ds-field__hint">{X.simulateHint}</p>
      <form
        style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ params: { system: system.toLowerCase() }, body: { key, action: system === 'CODEBEAMER' && !status ? 'EDIT' : 'TRANSITION', ...(status ? { status } : { title: X.revised(list.find((x) => x.key === key)?.title ?? key) }), externalUser: user } });
        }}
      >
        <Select label={X.simSystem} value={system} onChange={(e) => (setSystem(e.target.value as ExtSystem), setKey(''))}>
          {EXT_SYSTEMS.filter((s) => s !== 'GITLAB').map((s) => (
            <option key={s} value={s}>
              {extSync.system[s]}
            </option>
          ))}
        </Select>
        <Select label={X.simKey} value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">—</option>
          {list.map((x) => (
            <option key={x.key} value={x.key}>
              {x.key} · {x.status} · {x.title.slice(0, 40)}
            </option>
          ))}
        </Select>
        <Field label={X.simStatus}>
          <input className="ds-input" value={status} onChange={(e) => setStatus(e.target.value)} />
        </Field>
        <Field label={X.simUser}>
          <input className="ds-input ds-input--mono" value={user} onChange={(e) => setUser(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={!key || !user || act.isPending}>
          {X.simSend}
        </Button>
      </form>
      {act.data?.result && <p className="ds-field__hint" data-testid="simulate-result">{X.simResult(X.outcome[act.data.result.outcome] ?? act.data.result.outcome, act.data.result.summary)}</p>}
      <ErrorNote error={act.error} />
    </div>
  );
}
