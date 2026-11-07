// 외부 연계 현황 'API 명세·버전' 탭(D05-01, FR-AGW-001-006·007) — 실행 중인 서버의 OpenAPI 명세 요약·받기, 버전별 지원 일정과 정책.
import type { ApiVersionsView } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { apiSpec as S } from '../../copy/ext-gateway';
import { AsyncView, DataTable, KeyValue, Panel, VerdictBadge } from '../../design';

const STATE_BADGE: Record<string, string> = { CURRENT: 'PASS', SUPPORTED: 'PASS', DEPRECATED: 'CONDITIONAL', RETIRED: 'FAIL' };

export default function ApiSpecTab() {
  const q = useApi<ApiVersionsView>('apiVersions');
  const d = q.data;
  const C = S.col;
  return (
    <div className="ds-stack" data-testid="api-spec">
      <p className="ds-field__hint">{S.lead}</p>
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <>
            <Panel
              title={S.spec}
              actions={
                STATIC_MODE ? undefined : (
                  <a className="ds-btn" href={d.spec.url} download="openapi.json">
                    {S.download}
                  </a>
                )
              }
            >
              <KeyValue
                rows={[
                  { k: S.specRows.format, v: <span className="ds-mono">{`OpenAPI ${d.spec.openapi}`}</span> },
                  { k: S.specRows.version, v: <span className="ds-mono">{d.spec.version}</span> },
                  { k: S.specRows.ops, v: S.ops(d.spec.paths, d.spec.operations) },
                  { k: S.specRows.hash, v: <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }}>{d.spec.sha256}</span> },
                ]}
              />
            </Panel>
            <Panel title={S.versions}>
              <p className="ds-field__hint">{S.header(d.header)}</p>
              <DataTable
                caption={S.versions}
                rows={d.versions}
                rowKey={(v) => v.version}
                pageSize={0}
                columns={[
                  { key: 'v', header: C.version, cell: (v) => <span className="ds-mono ds-nowrap">{v.version}</span> },
                  { key: 's', header: C.state, cell: (v) => <VerdictBadge value={STATE_BADGE[v.state]} label={S.states[v.state]} /> },
                  { key: 'r', header: C.released, cell: (v) => <span className="ds-mono ds-nowrap">{v.releasedAt}</span> },
                  { key: 'd', header: C.deprecated, cell: (v) => <span className="ds-mono ds-nowrap">{v.deprecatedAt ?? '—'}</span> },
                  { key: 'e', header: C.sunset, cell: (v) => <span className="ds-mono ds-nowrap">{v.sunsetAt ?? '—'}</span> },
                  { key: 'c', header: C.changes, cell: (v) => <span style={{ fontSize: 'var(--fs-xs)' }}>{v.changes.join(' · ')}</span> },
                ]}
              />
            </Panel>
            <Panel title={S.policy}>
              <KeyValue
                rows={[
                  { k: S.policyRows.compat, v: S.compat[d.policy.compatibility] ?? d.policy.compatibility },
                  { k: S.policyRows.notice, v: S.days(d.policy.minNoticeDays) },
                  { k: S.policyRows.deprecated, v: d.policy.deprecatedResponse },
                  { k: S.policyRows.retired, v: d.policy.retiredResponse },
                ]}
              />
            </Panel>
          </>
        )}
      </AsyncView>
    </div>
  );
}
