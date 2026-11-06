// 차량 발신 요청 패널 — 차량별 적용 상태 화면(/fleet/vehicles/:vin)에 붙는다. 차량이 먼저 보낸 조회·보고와 거부 사유.
import type { VehicleRequestRecord } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, KeyValue, Panel, VerdictBadge } from '../../design';
import { when } from '../shared';

const T = ko.vehicleRequests;
const OUTCOME: Record<VehicleRequestRecord['outcome'], string> = { ACCEPTED: 'PASS', DUPLICATE: '미판정', REJECTED: 'FAIL' };

export function VehicleRequestPanel({ vin }: { vin: string }) {
  const q = useApi<{ items: VehicleRequestRecord[]; cursor: { bootId: string; sequence: number } | null; limit: { requests: number; windowMs: number } }>('vehicleRequests', { params: { vin } });
  usePlatformEvents(['vehicle.', 'entitlement.'], ['vehicleRequests']);
  const rows = q.data?.items ?? [];
  return (
    <Panel title={T.title} codes="IF-10 · IF-06" id="vehicle-requests">
      <p className="ds-lead" style={{ margin: 0 }}>
        {T.lead}
      </p>
      {q.data && (
        <KeyValue
          rows={[
            { k: T.cursor, v: <span className="ds-mono">{q.data.cursor ? `${q.data.cursor.bootId} · #${q.data.cursor.sequence}` : '—'}</span>, note: T.limit(q.data.limit.requests, q.data.limit.windowMs / 1000) },
          ]}
        />
      )}
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()} empty={{ title: T.none }}>
        <DataTable
          caption={T.title}
          rows={rows}
          rowKey={(r) => r.requestId}
          columns={[
            { key: 'id', header: T.col.id, cell: (r) => <span className="ds-mono">{r.requestId}</span>, sort: (r) => r.requestId },
            { key: 'at', header: T.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
            { key: 't', header: T.col.type, cell: (r) => <span className="ds-tag">{r.channel === 'QUERY' ? T.channel.QUERY : r.type}</span> },
            { key: 's', header: T.col.summary, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.summary}</span> },
            { key: 'q', header: T.col.seq, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.bootId ? `${r.bootId} · #${r.sequence}` : '—'}</span> },
            {
              key: 'o',
              header: T.col.outcome,
              cell: (r) => (
                <span title={T.outcome[r.outcome]}>
                  <VerdictBadge value={OUTCOME[r.outcome]} />
                </span>
              ),
            },
            { key: 'r', header: T.col.reason, cell: (r) => (r.reason ? <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }} title={r.reason}>{T.reason[r.reason] ?? r.reason}</span> : '—') },
            { key: 'f', header: T.col.flags, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.flags.map((f) => `${f.key}=${f.value ? 'ON' : 'OFF'}`).join(' · ') || '—'}</span> },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}
