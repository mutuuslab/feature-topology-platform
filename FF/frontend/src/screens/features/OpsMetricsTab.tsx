// Feature 상세 '운영 지표' 탭(TL-UI04·UI18) — 버전별 활성 차량(만 대)·사용률·적용 실패율·DTC·배포 후 VOC·롤백 수,
// 4축 판정 이력(14일)과 이 Feature의 점검 결과(반복 표시). Data Lake 집계는 신선도 칩과 함께.
import { FreshnessChip } from '../../design/freshness';
import { Link } from 'react-router-dom';
import { HEALTH_AXES, findingOpen, type FeatureOpsMetrics } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { lake as L } from '../../copy/lake';
import { AsyncView, DataTable, Panel } from '../../design';
import { FindingTable } from '../ops/FeatureHealth';
import { HealthDot, LakeOff } from '../ops/lake-ui';
import '../ops/lake.css';

const O = L.ops;

export function OpsMetricsTab({ id }: { id: string }) {
  const q = useApi<FeatureOpsMetrics>('featureOpsMetrics', { params: { id } });
  const d = q.data;
  const versions = d?.versions ?? [];
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {d && (
        <LakeOff connected={d.connected}>
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <Panel title={O.versions} id="ops-versions" actions={<Link to="/ops/feature-health">{O.toHub} →</Link>}>
              {versions.length ? (
                <DataTable
                  caption={O.versions}
                  rows={versions}
                  rowKey={(v) => v.version}
                  columns={[
                    { key: 'v', header: O.col.version, cell: (v) => <span className="ds-mono">{v.version}</span> },
                    { key: 'n', header: O.col.vehicles, cell: (v) => <span className="ds-mono ds-nowrap">{L.vehicles(v.activeVehicles)}</span>, align: 'right' },
                    { key: 'u', header: O.col.usage, cell: (v) => <span className="ds-mono">{L.pct(v.usageRate)}</span>, align: 'right' },
                    { key: 'f', header: O.col.failure, cell: (v) => <span className="ds-mono">{L.pct(v.failureRate, 2)}</span>, align: 'right' },
                    { key: 'd', header: O.col.dtc, cell: (v) => <span className="ds-mono">{L.pct(v.dtcRate, 2)}</span>, align: 'right' },
                    { key: 'voc', header: O.col.voc, cell: (v) => <span className="ds-mono">{v.vocAfterDeploy}</span>, align: 'right' },
                    { key: 'r', header: O.col.rollbacks, cell: (v) => <span className="ds-mono">{v.rollbacks}</span>, align: 'right' },
                    { key: 'fr', header: O.col.fresh, cell: (v) => <FreshnessChip f={v.freshness} compact /> },
                  ]}
                />
              ) : (
                <p className="ds-field__hint">{O.none}</p>
              )}
            </Panel>
            {versions.map((v) => {
              const days = d.history.filter((h) => h.version === v.version);
              return (
                <Panel key={v.version} title={`${O.history} · ${v.version}`} id={`ops-history-${v.version.replace(/\W/g, '-')}`}>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ds-table lk-grid">
                      <caption className="ds-sr">{O.historyCaption(v.version)}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{L.health.findingCol.axis}</th>
                          {days.map((h) => (
                            <th key={h.date} scope="col" className="ds-mono">
                              {h.date.slice(5)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {HEALTH_AXES.map((a) => (
                          <tr key={a}>
                            <th scope="row">{L.axis[a]}</th>
                            {days.map((h) => (
                              <td key={h.date}>
                                <HealthDot state={h.axes[a]} label={`${h.date} ${L.axis[a]} ${L.state[h.axes[a]]}`} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              );
            })}
            {d.findings.length > 0 && (
              <Panel title={O.findings} id="ops-findings" eyebrow={O.evidenceLine(d.findings.filter((f) => findingOpen(f.status)).length, d.findings.filter((f) => f.repeats > 0).length)}>
                <FindingTable rows={d.findings} caption={O.findings} />
              </Panel>
            )}
          </div>
        </LakeOff>
      )}
    </AsyncView>
  );
}
