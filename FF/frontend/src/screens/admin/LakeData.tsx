import { uiLocaleTag } from '../../locale/runtime';
// 데이터·규제 기록 — Data Lake 탭(TL-UI12, 80-70 6장 11). 받는 데이터의 근거(동의·법령)·보존·가명 처리, 보내는 라벨 목록, CN 국외 이전 보류.
import type { DataContractRow, LabelFeedResponse } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { lake as L } from '../../copy/lake';
import { AsyncView, DataTable, Panel, VerdictBadge } from '../../design';
import { LakeOff } from '../ops/lake-ui';

const G = L.governance;

export function LakeData() {
  const c = useApi<{ connected: boolean; items: DataContractRow[] }>('lakeContracts');
  const l = useApi<LabelFeedResponse>('lakeLabels');
  const rows = c.data?.items ?? [];
  const cn = rows.filter((r) => r.transferHold);
  return (
    <LakeOff connected={c.data?.connected}>
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Panel title={G.received} id="lake-received">
          <AsyncView state={asyncState(c, rows.length === 0)} error={c.error} onRetry={() => c.refetch()}>
            <DataTable
              caption={G.received}
              rows={rows}
              rowKey={(r) => r.dataset}
              columns={[
                { key: 'd', header: L.datalake.col.dataset, cell: (r) => <span><strong>{r.title}</strong> <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.dataset}</span></span> },
                { key: 'c', header: L.datalake.col.category, cell: (r) => <span className="ds-tag">{L.collection.category[r.category]}</span> },
                { key: 'b', header: L.datalake.col.basis, cell: (r) => <span title={r.basisNote}>{L.collection.basis[r.basis]}</span> },
                { key: 'n', header: '', srHeader: L.collection.detail.basisNote, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.basisNote}</span> },
                { key: 'r', header: L.datalake.col.retention, cell: (r) => r.retention },
                { key: 'p', header: L.datalake.col.pseudo, cell: (r) => r.pseudonymization },
                { key: 'm', header: L.datalake.col.markets, cell: (r) => <span className="ds-mono">{r.markets.join(' · ')}</span> },
              ]}
            />
          </AsyncView>
        </Panel>
        <div className="ds-split">
          <Panel title={G.sent} id="lake-sent" eyebrow={l.data ? `${G.excluded}: ${l.data.excluded.join(' · ')}` : undefined}>
            <AsyncView state={asyncState(l, !l.data?.items.length)} error={l.error} onRetry={() => l.refetch()}>
              <DataTable
                caption={G.sent}
                rows={l.data?.items ?? []}
                rowKey={(r) => r.kind}
                columns={[
                  { key: 'k', header: L.datalake.labels.col.kind, cell: (r) => <span className="ds-mono">{r.kind}</span> },
                  { key: 't', header: L.datalake.labels.col.title, cell: (r) => r.title },
                  { key: 's', header: L.datalake.labels.col.sent, cell: (r) => <span className="ds-mono">{r.sent.toLocaleString(uiLocaleTag())}</span>, align: 'right' },
                ]}
              />
            </AsyncView>
          </Panel>
          <Panel title={G.cnHold} id="lake-cn" eyebrow={G.cnNote}>
            <DataTable
              caption={G.cnHold}
              rows={cn}
              rowKey={(r) => r.dataset}
              columns={[
                { key: 'd', header: L.datalake.col.dataset, cell: (r) => r.title },
                { key: 'h', header: L.datalake.transferHold, cell: () => <VerdictBadge value="CONDITIONAL" label={L.datalake.transferHold} /> },
                { key: 'n', header: L.datalake.col.basis, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.basisNote}</span> },
              ]}
            />
          </Panel>
        </div>
      </div>
    </LakeOff>
  );
}
