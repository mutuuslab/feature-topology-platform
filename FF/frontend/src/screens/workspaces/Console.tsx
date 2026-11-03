// ③ 엔지니어링 콘솔(시스템엔지니어링·SW통합·릴리스·PLM·기준정보) — 조밀한 표 세 개(확정 요청·확정 Baseline·Feature Version)와
// 영향 분석으로 가는 길. 고정폭 ID, 촘촘한 행(토큰 --row-h).
import { Link } from 'react-router-dom';
import type { DepartmentSummary } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { departments as D } from '../../copy/departments';
import { AsyncView, DataTable, IdChip, LifecycleBadge, PageHeader, Panel } from '../../design';
import { when } from '../shared';
import type { BaselineRecord, FeatureList, FeatureSummary } from '../types';
import { MyWork, useDeptDoc } from './common';

interface Req {
  requestId: string;
  featureId: string;
  version: string;
  requestedBy: string;
  requestedAt: string;
}

export default function ConsoleHome({ dept }: { dept: DepartmentSummary }) {
  const C = D.console;
  const K = C.col;
  const reqs = useApi<{ items: Req[] }>('baselineRequests', { query: { status: 'REQUESTED' } });
  const bls = useApi<{ items: (BaselineRecord & { products: string[] })[] }>('baselines');
  const feats = useApi<FeatureList>('listFeatures', { query: { latestOnly: true } });
  const d = useDeptDoc(dept);
  const n = reqs.data?.items.length ?? 0;
  const blCount = bls.data?.items.length ?? 0;
  return (
    <div className="ds-screen ws ws--console" data-workspace-home="console">
      <PageHeader
        codes={C.eyebrow}
        title={C.title(dept.name)}
        lead={C.lead}
        // 확정 대기가 없으면 '0'보다 지금 확정된 Baseline 수가 쓸모 있다
        message={reqs.isPending || bls.isPending ? { tone: 'neutral', value: '—', text: C.key(0).text } : n ? { tone: 'warn', ...C.key(n) } : { tone: 'neutral', ...C.keyNone(blCount) }}
        actions={
          <Link className="ds-btn" to="/analysis/impact">
            {C.impact}
          </Link>
        }
      />
      <div className="ws-console">
        <Panel title={C.requests} actions={<Link to="/baselines">{D.home.open} →</Link>}>
          <AsyncView state={asyncState(reqs, !n)} onRetry={() => reqs.refetch()} empty={{ title: C.noRequests }} rows={3}>
            <DataTable
              caption={C.requests}
              rows={reqs.data?.items ?? []}
              rowKey={(r) => r.requestId}
              pageSize={8}
              columns={[
                { key: 'id', header: K.id, cell: (r) => <span className="ds-mono">{r.requestId}</span>, sort: (r) => r.requestId },
                { key: 'f', header: K.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/baselines?request=${r.requestId}`} copy={false} /> },
                { key: 'by', header: K.by, cell: (r) => r.requestedBy },
                { key: 'at', header: K.requested, cell: (r) => <span className="ds-date">{when(r.requestedAt)}</span>, sort: (r) => r.requestedAt },
              ]}
            />
          </AsyncView>
        </Panel>
        <Panel title={D.home.myWork}>
          <MyWork d={d} limit={6} dense />
        </Panel>
        <Panel title={C.baselines} actions={<Link to="/baselines?tab=confirmed">{D.home.open} →</Link>}>
          <AsyncView state={asyncState(bls, !(bls.data?.items.length ?? 0))} onRetry={() => bls.refetch()} rows={4}>
            <DataTable
              caption={C.baselines}
              rows={bls.data?.items ?? []}
              rowKey={(r) => r.baselineId}
              pageSize={10}
              initialSort={{ key: 'id', dir: 'desc' }}
              columns={[
                { key: 'id', header: K.id, cell: (r) => <span className="ds-mono">{r.baselineId}</span>, sort: (r) => r.baselineId },
                { key: 'f', header: K.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}`} copy={false} /> },
                { key: 'h', header: C.hash, cell: (r) => <span className="ds-mono">{r.contentHash ? r.contentHash.slice(0, 12) : '—'}</span> },
              ]}
            />
          </AsyncView>
        </Panel>
        <Panel title={C.versions} actions={<Link to="/features">{D.home.open} →</Link>}>
          <AsyncView state={asyncState(feats, !(feats.data?.items.length ?? 0))} onRetry={() => feats.refetch()} rows={4}>
            <DataTable<FeatureSummary>
              caption={C.versions}
              rows={feats.data?.items ?? []}
              rowKey={(r) => `${r.featureId}@${r.version}`}
              pageSize={10}
              columns={[
                { key: 'f', header: K.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}`} copy={false} />, sort: (r) => r.featureId },
                { key: 'n', header: K.name, cell: (r) => r.name, sort: (r) => r.name },
                { key: 'lc', header: K.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => r.lifecycle },
                { key: 'b', header: 'Baseline', cell: (r) => <span className="ds-mono">{r.baselineId ?? '—'}</span>, minor: true },
              ]}
            />
          </AsyncView>
        </Panel>
      </div>
    </div>
  );
}
