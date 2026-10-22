// 외부 연계 — 양방향 탭(GitLab·JIRA·codeBeamer). 시스템별 연결·주인 규칙·충돌(사람이 고름)·받은 변경·보내기 실패,
// 그리고 모의 연결일 때 "외부에서 바꿔 보기"(실제 webhook과 같은 경로로 들어온다).
import { useState } from 'react';
import { Asil, EPIC_SCOPE_FIELDS, EPIC_SCOPE_LABEL, EXT_SYSTEMS, type EpicScopeField, type ExtSystem, type ExtSystemSummary, type OwnershipRule } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { extSync } from '../../copy/ext-sync';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, Field, Panel, Select, whyDisabled } from '../../design';
import { usePermission, when } from '../shared';

const X = extSync.sync;
const INVALIDATE = ['extSync', 'extConflicts', 'extInbox', 'extOutbox', 'extChangeRequests', 'extFeatureTrace', 'extFeatureEpics', 'featureDetail', 'policyDetail', 'mockExtItems', 'listFeatures'];

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
          <AsyncView
            state={asyncState(inbox, !(inbox.data?.items ?? []).some((r) => r.key !== '-'))}
            error={inbox.error?.message}
            onRetry={() => inbox.refetch()}
            empty={{ title: X.inboxEmpty, body: X.inboxEmptyBody }}
          >
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
      {open && (
        <>
          <SimulateForm />
          <EpicCreateForm />
        </>
      )}
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
        <Button type="submit" variant="primary" disabled={!key || !user || act.isPending} reason={whyDisabled([!key, ko.why.key], [!user, ko.why.user])}>
          {X.simSend}
        </Button>
      </form>
      {act.data?.result && <p className="ds-field__hint" data-testid="simulate-result">{X.simResult(X.outcome[act.data.result.outcome] ?? act.data.result.outcome, act.data.result.summary)}</p>}
      <ErrorNote error={act.error} />
    </div>
  );
}

/** JIRA에서 Epic을 만든 것처럼 — 범위 값이 다 있으면 PROPOSED Feature가 자동 등록된다(모의 연결일 때만) */
function EpicCreateForm() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [user, setUser] = useState('kim.author');
  const [scope, setScope] = useState<Record<EpicScopeField, string>>({ country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', asil: 'QM', ownerId: '' });
  const create = useApiMutation<{ item: { key: string }; result: { outcome: string; summary: string } | null }>('mockExtCreate', INVALIDATE);
  return (
    <section aria-labelledby="sync-epic-new" style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
      <h3 id="sync-epic-new" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{X.epicNew}</h3>
      <p className="ds-field__hint">{X.epicNewHint}</p>
      <form
        style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          // 빈 값은 보내지 않는다 — 빠진 범위는 플랫폼이 Epic 댓글로 알려 준다
          const filled = Object.fromEntries(Object.entries(scope).filter(([, v]) => v.trim()));
          create.mutate({ params: { system: 'jira' }, body: { kind: 'EPIC', title: title.trim(), body: body.trim(), externalUser: user, scope: filled } });
        }}
      >
        <Field label={X.epicTitle}>
          <input className="ds-input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
        </Field>
        <Field label={X.epicBody}>
          <input className="ds-input" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {EPIC_SCOPE_FIELDS.map((k) =>
          k === 'asil' ? (
            <Select key={k} label={EPIC_SCOPE_LABEL[k]} value={scope.asil} onChange={(e) => setScope({ ...scope, asil: e.target.value })}>
              <option value="">—</option>
              {Asil.options.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          ) : (
            <Field key={k} label={EPIC_SCOPE_LABEL[k]}>
              <input className="ds-input" value={scope[k]} onChange={(e) => setScope({ ...scope, [k]: e.target.value })} />
            </Field>
          ),
        )}
        <Field label={X.simUser}>
          <input className="ds-input ds-input--mono" value={user} onChange={(e) => setUser(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={title.trim().length < 2 || !user || create.isPending} reason={whyDisabled([title.trim().length < 2, ko.why.title], [!user, ko.why.user])}>
          {X.epicCreate}
        </Button>
      </form>
      {create.data?.result && (
        <p className="ds-field__hint" data-testid="epic-create-result">
          {create.data.item.key} — {X.simResult(X.outcome[create.data.result.outcome] ?? create.data.result.outcome, create.data.result.summary)}
        </p>
      )}
      <ErrorNote error={create.error} />
    </section>
  );
}
