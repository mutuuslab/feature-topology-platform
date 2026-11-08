// /flag-code/flags/:flagKey — Flag 코드 상세(20-97 §7.2). 5원천 칸, 사용처(저장소·파일·줄·호출식·커밋), 이전 스캔 근거,
// PR·해제 이력, 최근 24시간 평가. 통제: 재스캔·해제 요청·PR 다시 만들기·시연 병합·해제 결정.
import { Link, useParams } from 'react-router-dom';
import { type FlagGateWaiver, type FlagPullRequest, type FlagRepository } from '@ff/contracts';
import { asyncState } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, DataTable, IdChip, PageHeader, Panel } from '../../design';
import { flagMapPath } from '../features/FeatureFlags';
import { when } from '../shared';
import { CommitLink, CreatePrButton, DemoMergeButton, FlagCodeNav, Lanes, PrRef, RescanButton, SeverityBadge, UsageLink, WaiverDecision, WaiverLine, WaiverRequestButton } from './common';
import { detailOf, listOf, repoName, reposForRow, seriesOf, useCoverageDetail, usePullRequests, useRepositories, useSeries, useWaivers } from './data';
import { EvalTrend } from './trend';

const D = T.detail;
const C = T.col;

const uniq = <X,>(xs: X[], key: (x: X) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];

export function FlagCodeDetailScreen() {
  const { flagKey = '' } = useParams();
  const q = useCoverageDetail(flagKey);
  const repoQ = useRepositories();
  const prQ = usePullRequests();
  const wvQ = useWaivers();
  const seriesQ = useSeries(flagKey);
  const d = detailOf(q.data);
  const repos = listOf<FlagRepository>(repoQ.data);
  const r = d?.row;
  const prs = uniq([...(d?.pullRequests ?? []), ...listOf<FlagPullRequest>(prQ.data).filter((p) => p.flagKeys.includes(flagKey))], (p) => p.prId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const waivers = uniq([...(d?.waivers ?? []), ...listOf<FlagGateWaiver>(wvQ.data).filter((w) => w.flagKey === flagKey)], (w) => w.waiverId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const series = seriesOf(seriesQ.data);
  const repoOf = (id: string) => repos.find((x) => x.repoId === id);
  const openPr = prs.find((p) => p.state === 'OPEN');
  const repository = r?.code.usages[0]?.repository;
  const finding = r?.findings.find((f) => f.status === r.status) ?? null;
  return (
    <div className="ds-screen fc-screen">
      <AsyncView state={q.isSuccess && !d ? 'error' : asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {r && (
          <>
            <PageHeader
              codes="D01-06"
              title={D.title}
              message={{
                tone: r.severity === 'BLOCKER' ? 'danger' : r.severity === 'WARNING' ? 'warn' : r.severity === 'OK' ? 'ok' : 'neutral',
                text: finding?.message ?? D.noFinding,
                status: { label: T.coverageStatus[r.status], tone: r.severity === 'BLOCKER' ? 'danger' : r.severity === 'WARNING' ? 'warn' : r.severity === 'OK' ? 'ok' : 'neutral' },
              }}
              meta={
                <>
                  <IdChip id={r.flagKey} />
                  {r.featureId && r.version ? <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}?tab=flags`} copy={false} /> : <span className="ds-tag">{D.unregisteredFeature}</span>}
                  {r.policy && <IdChip id={r.policy.policyId} version={`r${r.policy.revision}`} to={`/policies/${r.policy.policyId}`} copy={false} />}
                  {r.package && <span className="ds-tag">{D.pkgLine(T.pkg[r.package] ?? r.package, r.controlPoint)}</span>}
                  {r.planSource && <span className="ds-tag">{D.planSource[r.planSource]}</span>}
                </>
              }
              lead={r.featureName ?? D.lead}
              actions={
                <div className="fc-actions">
                  <RescanButton repos={reposForRow(r, repos)} />
                  {r.releaseBlocking && <WaiverRequestButton row={r} />}
                   {(r.status === 'NO_CODE' || (r.pullRequest && ['FAILED', 'PLANNED', 'CLOSED'].includes(r.pullRequest.state))) && <CreatePrButton row={r} repos={repos} />}
                  {openPr && <DemoMergeButton pr={openPr} repo={repoOf(openPr.repoId)} />}
                </div>
              }
            />
            <FlagCodeNav />
            <Panel title={D.lanes} id="lanes">
              <Lanes
                row={r}
                detail={{
                  REGISTRY: r.policy ? <Link to={`/policies/${r.policy.policyId}`}>{D.toPolicy}</Link> : r.featureId ? <span className="fc-sub">{D.planSource[r.planSource ?? 'PLANNED']}</span> : null,
                  CODE: <span className="fc-sub">{`${T.policy.usages(r.code.usages.length)} · ${when(r.code.lastScanAt)}`}</span>,
                  UNLEASH: r.policy ? (
                    <span>
                      <span className="fc-sub">{D.unleashRev(r.unleash.revision)}</span>
                      <Link to={`/policies/${r.policy.policyId}#unleash-h`}>{D.toUnleash}</Link>
                    </span>
                  ) : null,
                  DEPLOY: r.deploy ? <Link to={`/deployments/${r.deploy.publicationId}`}>{D.deployLine(r.deploy.publicationId, r.deploy.policyRevision)}</Link> : null,
                  REPORT: r.report ? (
                    <span>
                      <span className="fc-sub">{D.report(r.report.confirmed, r.report.denominator)}</span>
                      <Link to={flagMapPath(r.flagKey)}>{D.toMap}</Link>
                    </span>
                  ) : null,
                }}
              />
            </Panel>
            {(r.findings.length > 0 || r.code.lastSeen) && (
            <Panel title={D.findings} id="findings">
              {r.findings.length > 0 && (
                <ul className="fc-findings">
                  {r.findings.map((f, i) => (
                    <li key={`${f.status}-${i}`} data-sev={f.severity}>
                      <SeverityBadge severity={f.severity} />
                      <span>
                        <strong>{T.coverageStatus[f.status]}</strong> · {f.message}
                      </span>
                      <small>
                        {`${C.since} ${when(f.since)}`}
                        {f.dueAt ? ` · ${C.due} ${when(f.dueAt)}` : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              {r.code.lastSeen && (
                <p className="fc-note" data-testid="last-seen">
                  {`${D.lastSeen} · `}
                  {D.lastSeenText(r.code.lastSeen.commit.slice(0, 8))} · {when(r.code.lastSeen.at)} ·{' '}
                  <CommitLink repository={repoOf(r.code.lastSeen.repoId)?.repository} commit={r.code.lastSeen.commit} />
                </p>
              )}
            </Panel>
            )}
            {r.code.usages.length > 0 && (
              <Panel title={D.usages} id="usages" eyebrow={D.usagesEyebrow(r.code.usages.length, new Set(r.code.usages.map((u) => u.repoId)).size)}>
                <DataTable
                  caption={D.usages}
                  rows={r.code.usages}
                  rowKey={(u) => `${u.repoId}:${u.path}:${u.line}`}
                  columns={[
                    { key: 'repo', header: C.repo, cell: (u) => repoName(repos, u.repoId) },
                    { key: 'file', header: C.file, cell: (u) => <UsageLink url={u.url} path={u.path} line={u.line} full /> },
                    { key: 'sym', header: C.symbol, cell: (u) => <span className="fc-file">{u.symbol}</span> },
                    { key: 'safe', header: C.safe, cell: (u) => T.safe[u.safeDefault] ?? u.safeDefault },
                    { key: 'commit', header: C.commit, cell: (u) => <CommitLink repository={u.repository} commit={u.commit} /> },
                    { key: 'scan', header: C.lastScan, cell: (u) => <span className="fc-num">{u.scanId ?? '—'}</span>, minor: true },
                  ]}
                />
              </Panel>
            )}
            {d.history.length > 0 && (
              <Panel title={D.history} id="history" eyebrow={D.historyEyebrow}>
                <DataTable
                  caption={D.history}
                  rows={d.history}
                  rowKey={(h) => `${h.repoId}:${h.commit}`}
                  pageSize={20}
                  columns={[
                    { key: 'at', header: C.at, cell: (h) => <span className="fc-num">{when(h.at)}</span> },
                    { key: 'repo', header: C.repo, cell: (h) => repoName(repos, h.repoId) },
                    { key: 'commit', header: C.commit, cell: (h) => <CommitLink repository={repoOf(h.repoId)?.repository} commit={h.commit} /> },
                    { key: 'n', header: D.historyUsages, align: 'right', cell: (h) => <span className="fc-num" data-alert={h.usages === 0 ? '' : undefined}>{h.usages}</span> },
                    { key: 'scan', header: C.lastScan, cell: (h) => <span className="fc-num">{h.scanId ?? '—'}</span>, minor: true },
                  ]}
                />
              </Panel>
            )}
            <div className={prs.length && waivers.length ? 'ds-split' : undefined}>
              {prs.length > 0 && (
              <Panel title={D.prs} id="prs">
                <DataTable
                  caption={D.prs}
                  rows={prs}
                  rowKey={(p) => p.prId}
                  columns={[
                    { key: 'kind', header: C.kind, cell: (p) => T.prKind[p.kind] ?? p.kind },
                    { key: 'pr', header: C.pr, cell: (p) => <PrRef pr={p} repository={repoOf(p.repoId)?.repository ?? repository} /> },
                    { key: 'branch', header: C.branchName, cell: (p) => <span className="fc-file">{p.branch}</span>, minor: true },
                    { key: 'check', header: C.check, cell: (p) => (p.checkConclusion ? T.check[p.checkConclusion] : '—') },
                    { key: 'at', header: C.at, cell: (p) => <span className="fc-num">{when(p.mergedAt ?? p.createdAt)}</span> },
                  ]}
                />
              </Panel>
              )}
              {waivers.length > 0 && (
              <Panel title={D.waivers} id="waivers">
                {(
                  <ul className="fc-findings">
                    {waivers.map((w) => (
                      <li key={w.waiverId} data-sev={w.state === 'REQUESTED' ? 'INFO' : 'OK'}>
                        <WaiverLine w={w} />
                        <span>
                          {w.reason}
                          <span className="fc-sub">{`${T.actions.statusAt(T.coverageStatus[w.coverageStatus])} · ${C.expires} ${when(w.expiresAt)}`}</span>
                        </span>
                        <small>
                          <WaiverDecision w={w} />
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              )}
            </div>
            {series && series.buckets.length > 1 && (
              <Panel title={D.evaluation} id="evaluation" eyebrow={D.evaluationEyebrow} actions={<Link to={`/ops/flag-evaluations?flagKey=${encodeURIComponent(r.flagKey)}`}>{D.toEvaluations}</Link>}>
                <EvalTrend series={series} compact />
              </Panel>
            )}
          </>
        )}
      </AsyncView>
    </div>
  );
}
