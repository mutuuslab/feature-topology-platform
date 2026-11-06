// 운영 데이터·이벤트 — Data Lake 출처 지표 탭(TL-UI14). 다른 탭(제어 채널: FF가 차량에서 직접 받는 상태 보고·회신)과 나눠,
// Lake에서 읽는 데이터셋의 신선도를 보인다. 기준을 넘긴 지표로 내리는 판단은 보류된다.
import { FreshnessChip, spanText } from '../../design/freshness';
import type { LakeStatusResponse } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { lake as L } from '../../copy/lake';
import { AsyncView, DataTable, Panel } from '../../design';
import { LakeOff } from './lake-ui';

export function LakeSources() {
  const q = useApi<LakeStatusResponse>('lakeStatus');
  const T = L.telemetry;
  const rows = q.data?.datasets ?? [];
  return (
    <Panel title={T.tab} id="lake-sources" eyebrow={T.control}>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <LakeOff connected={q.data?.connected}>
          <DataTable
            caption={T.tab}
            rows={rows}
            rowKey={(r) => r.dataset}
            initialSort={{ key: 'f', dir: 'desc' }}
            columns={[
              { key: 'd', header: T.col.dataset, cell: (r) => <span className="ds-mono">{r.dataset}</span>, sort: (r) => r.dataset },
              { key: 'f', header: T.col.fresh, cell: (r) => <FreshnessChip f={r} compact />, sort: (r) => (r.stale ? 1 : 0) },
              { key: 's', header: T.col.sla, cell: (r) => <span className="ds-mono">{spanText(r.slaSeconds)}</span>, align: 'right', sort: (r) => r.slaSeconds },
            ]}
          />
        </LakeOff>
      </AsyncView>
    </Panel>
  );
}
