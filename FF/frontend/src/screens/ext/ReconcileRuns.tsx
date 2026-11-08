// 외부 연계 — 주기 대사 실행 기록(80-50 §4.5). 증분(최근 변경)·전체(Epic 기대값) 대사의 훑은 수·반영·충돌·오류와 처리 내용.
import type { ReconcileRunRow } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { alm } from '../../copy/alm';
import { extSync } from '../../copy/ext-sync';
import { AsyncView, Button, DataTable, ErrorNote, Panel } from '../../design';
import { usePermission, when } from '../shared';

const R = alm.reconcile;
const INVALIDATE = ['extReconcileRuns', 'extSync', 'extConflicts', 'extInbox', 'extOutbox', 'extFeatureTrace', 'extFeatureEpics', 'mockExtItems'];

export function ReconcileRunsPanel() {
  const q = useApi<{ items: ReconcileRunRow[] }>('extReconcileRuns', {}, { refetchInterval: 30_000 });
  const run = useApiMutation<ReconcileRunRow>('runExtReconcile', INVALIDATE);
  const perm = usePermission(['IMPLEMENTER']);
  const rows = q.data?.items ?? [];
  return (
    <Panel
      title={R.title}
      id="sync-reconcile"
      actions={
        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
          {(['INCREMENTAL', 'FULL'] as const).map((kind) => (
            <Button key={kind} variant={kind === 'INCREMENTAL' ? 'primary' : 'default'} disabled={!perm.ok || run.isPending} title={perm.hint} onClick={() => run.mutate({ body: { system: 'JIRA', kind } })}>
              {run.isPending ? R.running : R.run(R.kind[kind])}
            </Button>
          ))}
        </span>
      }
    >
      <p className="ds-field__hint">{R.lead}</p>
      {/* 첫 대사 전(기동 직후)에는 표를 그리지 않는다 — 빈 상자 대신 설명만 */}
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()} rows={2} emptyHidden>
        <DataTable<ReconcileRunRow>
          caption={R.title}
          rows={rows.slice(0, 10)}
          rowKey={(r) => String(r.runId)}
          columns={[
            { key: 'at', header: R.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.startedAt)}</span> },
            { key: 'k', header: R.col.kind, cell: (r) => R.kind[r.kind] },
            { key: 's', header: R.col.system, cell: (r) => extSync.system[r.system] },
            { key: 'n', header: R.col.scanned, cell: (r) => r.scanned.toLocaleString('ko-KR'), align: 'right' },
            { key: 'a', header: R.col.applied, cell: (r) => r.applied, align: 'right' },
            { key: 'c', header: R.col.conflicts, cell: (r) => <span style={r.conflicts ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.conflicts}</span>, align: 'right' },
            { key: 'e', header: R.col.errors, cell: (r) => <span style={r.errors ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.errors}</span>, align: 'right' },
            {
              key: 'x',
              header: R.col.notes,
              cell: (r) => (r.notes.length ? <span className="ds-clip" title={r.notes.join('\n')} style={{ maxWidth: '48ch' }}>{r.notes[0]}{r.notes.length > 1 ? ` · ${R.more(r.notes.length - 1)}` : ''}</span> : '—'),
            },
          ]}
        />
      </AsyncView>
      <ErrorNote error={run.error} />
    </Panel>
  );
}
