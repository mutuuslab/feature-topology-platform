// /flag-code/lifecycle — Flag 수명 관리(20-97 §7.2). 제거 대상(Retirement 승인 뒤 남은 코드, 기한·경과), 오래된 Flag(근거 시각),
// 제거 PR 상태와 Retirement 단계 연결. 통제: 제거 PR 만들기(구현 담당)·시연 병합·Retirement 요청 바로가기.
import { Link } from 'react-router-dom';
import type { FlagCoverageRow, FlagPullRequest, FlagRepository } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, DataTable, PageHeader, Panel } from '../../design';
import { when } from '../shared';
import { DemoMergeButton, FlagCodeNav, PrRef, RemovalPrButton, ResumePrButton, SeverityBadge, UsageLink } from './common';
import { coverageOf, daysSince, listOf, primaryFinding, useCoverage, usePullRequests, useRepositories } from './data';

const L = T.lifecycle;
const C = T.col;

interface RetirementLite {
  retirementId: string;
  flagKey: string;
  status: string;
}

const flagLink = (r: { flagKey: string }) => <Link className="ds-mono" to={`/flag-code/flags/${encodeURIComponent(r.flagKey)}`}>{r.flagKey}</Link>;
const featureLink = (r: FlagCoverageRow) => (r.featureId && r.version ? <Link className="ds-mono ds-nowrap" to={`/features/${r.featureId}/${r.version}?tab=flags`}>{`${r.featureId} ${r.version}`}</Link> : '—');

export function FlagCodeLifecycleScreen() {
  const q = useCoverage();
  const repoQ = useRepositories();
  const prQ = usePullRequests();
  const retQ = useApi<{ items: RetirementLite[] }>('flagRetirements');
  const cov = coverageOf(q.data);
  const repos = listOf<FlagRepository>(repoQ.data);
  const removalPrs = listOf<FlagPullRequest>(prQ.data).filter((p) => p.kind === 'REMOVAL');
  const retirements = listOf<RetirementLite>(retQ.data);
  const rows = cov?.rows ?? [];
  const due = rows.filter((r) => r.status === 'REMOVAL_DUE' || r.findings.some((f) => f.status === 'REMOVAL_DUE'));
  const stale = rows.filter((r) => r.status === 'STALE' || r.findings.some((f) => f.status === 'STALE'));
  const overdue = due.filter((r) => r.severity === 'BLOCKER').length;
  const retirementOf = (flagKey: string) => retirements.find((x) => x.flagKey === flagKey && x.status !== 'REQUESTED')?.retirementId ?? null;
  const findingOf = (r: FlagCoverageRow, s: 'REMOVAL_DUE' | 'STALE') => r.findings.find((f) => f.status === s) ?? primaryFinding(r);
  return (
    <div className="ds-screen fc-screen">
      <PageHeader
        codes="D01-01 · FFG-LCY-011"
        title={L.title}
        lead={L.lead}
        message={
          !cov
            ? { text: L.keyDue, value: '—' }
            : overdue
              ? { tone: 'danger', value: overdue, text: L.keyOverdue }
              : due.length
                ? { tone: 'warn', value: due.length, text: L.keyDue }
                : stale.length
                  ? { tone: 'warn', value: stale.length, text: L.keyStale }
                  : { tone: 'ok', text: L.keyOk }
        }
        actions={<Link to="/flag-retirements">{L.toRetirements}</Link>}
      />
      <FlagCodeNav />
      <AsyncView state={q.isSuccess && !cov ? 'error' : asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {due.length > 0 && (
          <Panel title={L.removal} id="removal" eyebrow={L.removalEyebrow}>
            <DataTable
              caption={L.removal}
              rows={due}
              rowKey={(r) => r.flagKey}
              initialSort={{ key: 'due', dir: 'asc' }}
              columns={[
                { key: 'flag', header: C.flag, cell: flagLink },
                { key: 'feature', header: C.feature, cell: featureLink },
                { key: 'sev', header: C.severity, cell: (r) => <SeverityBadge severity={findingOf(r, 'REMOVAL_DUE')?.severity ?? r.severity} /> },
                { key: 'due', header: C.due, sort: (r) => findingOf(r, 'REMOVAL_DUE')?.dueAt ?? '', cell: (r) => <span className="fc-num">{when(findingOf(r, 'REMOVAL_DUE')?.dueAt)}</span> },
                {
                  key: 'elapsed',
                  header: C.elapsed,
                  cell: (r) => {
                    const d = daysSince(findingOf(r, 'REMOVAL_DUE')?.dueAt);
                    return d == null ? '—' : <span className="fc-num" data-alert={d > 0 ? '' : undefined}>{d > 0 ? T.common.overdue(d) : T.common.left(-d)}</span>;
                  },
                },
                {
                  key: 'usages',
                  header: C.usages,
                  cell: (r) =>
                    r.code.usages[0] ? (
                      <span>
                        <UsageLink url={r.code.usages[0].url} path={r.code.usages[0].path} line={r.code.usages[0].line} />
                        {r.code.usages.length > 1 && <span className="fc-more"> {T.common.andMore(r.code.usages.length - 1)}</span>}
                      </span>
                    ) : (
                      '—'
                    ),
                },
                {
                  key: 'pr',
                  header: C.pr,
                  cell: (r) => {
                    const pr = removalPrs.find((p) => p.flagKeys.includes(r.flagKey));
                    return pr ? <PrRef pr={pr} repository={repos.find((x) => x.repoId === pr.repoId)?.repository} /> : '—';
                  },
                },
                {
                  key: 'act',
                  header: '',
                  srHeader: C.action,
                  cell: (r) => {
                    const pr = removalPrs.find((p) => p.flagKeys.includes(r.flagKey));
                    return pr?.state === 'OPEN' ? <DemoMergeButton pr={pr} repo={repos.find((x) => x.repoId === pr.repoId)} /> : pr && ['FAILED', 'PLANNED'].includes(pr.state) ? <ResumePrButton prId={pr.prId} repos={repos} /> : <RemovalPrButton row={r} repos={repos} retirementId={retirementOf(r.flagKey)} />;
                  },
                },
              ]}
            />
          </Panel>
        )}
        {stale.length > 0 && (
          <Panel title={L.stale} id="stale" eyebrow={L.staleEyebrow}>
            <DataTable
              caption={L.stale}
              rows={stale}
              rowKey={(r) => r.flagKey}
              initialSort={{ key: 'since', dir: 'asc' }}
              columns={[
                { key: 'flag', header: C.flag, cell: flagLink },
                { key: 'feature', header: C.feature, cell: featureLink },
                { key: 'why', header: C.reason, cell: (r) => findingOf(r, 'STALE')?.message ?? '—' },
                { key: 'since', header: C.since, sort: (r) => findingOf(r, 'STALE')?.since ?? '', cell: (r) => <span className="fc-num">{when(findingOf(r, 'STALE')?.since)}</span> },
                { key: 'usages', header: C.usages, cell: (r) => <span className="fc-num">{r.code.usages.length}</span> },
                { key: 'act', header: '', srHeader: C.action, cell: () => <Link to="/flag-retirements">{T.next.requestRetirement} →</Link> },
              ]}
            />
          </Panel>
        )}
        {removalPrs.length > 0 && (
          <Panel title={L.prs} id="removal-prs">
            <DataTable
              caption={L.prs}
              rows={removalPrs}
              rowKey={(p) => p.prId}
              columns={[
                { key: 'flags', header: C.flags, cell: (p) => <span className="fc-chips">{p.flagKeys.map((k) => <Link key={k} className="ds-mono" to={`/flag-code/flags/${encodeURIComponent(k)}`}>{k}</Link>)}</span> },
                { key: 'pr', header: C.pr, cell: (p) => <PrRef pr={p} repository={repos.find((x) => x.repoId === p.repoId)?.repository} /> },
                { key: 'branch', header: C.branchName, cell: (p) => <span className="fc-file">{p.branch}</span> },
                { key: 'check', header: C.check, cell: (p) => (p.checkConclusion ? T.check[p.checkConclusion] : '—') },
                { key: 'ret', header: L.retirement, cell: (p) => (p.retirementId ? <Link to="/flag-retirements">{p.retirementId}</Link> : '—') },
                { key: 'at', header: C.at, cell: (p) => <span className="fc-num">{when(p.mergedAt ?? p.createdAt)}</span> },
              ]}
            />
          </Panel>
        )}
      </AsyncView>
    </div>
  );
}
