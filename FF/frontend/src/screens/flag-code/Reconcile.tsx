// /flag-code/reconcile — 어긋남 대사판(20-97 §7.2). 상태별 열에 카드를 심각도 순으로, 카드마다 다음 할 일 버튼.
// 동적 키는 Flag를 정할 수 없어 파일 단위 카드로 둔다. 결정 대기 해제는 아래에서 직무 분리 안내와 함께 결정한다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FLAG_PACKAGES, type FlagCoverageRow, type FlagCoverageSeverity, type FlagCoverageStatus, type FlagFileFinding, type FlagGateWaiver, type FlagPullRequest, type FlagRepository } from '@ff/contracts';
import { asyncState } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, PageHeader, Panel, Segmented, Select } from '../../design';
import { when } from '../shared';
import { CreatePrButton, DemoMergeButton, FlagCodeNav, RescanButton, SeverityBadge, WaiverDecision, WaiverLine, WaiverRequestButton } from './common';
import { BOARD_STATUSES, coverageOf, listOf, primaryFinding, repoName, reposForRow, SEVERITY_RANK, shortPath, useCoverage, usePullRequests, useRepositories, useWaivers } from './data';

const R = T.reconcile;
const N = T.next;
type SevFilter = 'ALL' | FlagCoverageSeverity;

/** 카드의 다음 할 일 — 상태마다 하나(권한·이유는 버튼이 보인다) */
function NextAction({ row, repos, prs }: { row: FlagCoverageRow; repos: FlagRepository[]; prs: FlagPullRequest[] }) {
  const pr = prs.find((p) => p.state === 'OPEN' && p.flagKeys.includes(row.flagKey));
  switch (row.status) {
    case 'NO_CODE':
      return (
        <span className="fc-actions">
          <CreatePrButton row={row} repos={repos} />
          {row.releaseBlocking && <WaiverRequestButton row={row} />}
        </span>
      );
    case 'CALL_DELETED':
      return (
        <span className="fc-actions">
          <RescanButton repos={reposForRow(row, repos)} />
          {row.releaseBlocking && <WaiverRequestButton row={row} />}
        </span>
      );
    case 'UNREGISTERED_KEY':
      return <RescanButton repos={reposForRow(row, repos)} />;
    case 'UNLEASH_MISMATCH':
      return row.policy ? <Link to={`/policies/${row.policy.policyId}#unleash-h`}>{N.syncUnleash} →</Link> : <RescanButton repos={reposForRow(row, repos)} />;
    case 'REMOVAL_DUE':
      return <Link to="/flag-code/lifecycle">{N.removalPr} →</Link>;
    case 'STALE':
      return <Link to="/flag-retirements">{N.requestRetirement} →</Link>;
    case 'PR_OPEN':
      return row.pullRequest?.state === 'PLANNED' ? <CreatePrButton row={row} repos={repos} /> : pr ? <DemoMergeButton pr={pr} repo={repos.find((x) => x.repoId === pr.repoId)} /> : null;
    default:
      return null;
  }
}

function FlagCard({ row, repos, prs }: { row: FlagCoverageRow; repos: FlagRepository[]; prs: FlagPullRequest[] }) {
  const f = primaryFinding(row);
  return (
    <li className="fc-card" data-flag={row.flagKey}>
      <div className="fc-card__top">
        <Link to={`/flag-code/flags/${encodeURIComponent(row.flagKey)}`}>{row.flagKey}</Link>
        <SeverityBadge severity={row.severity} />
      </div>
      {f && <p>{f.message}</p>}
      <div className="fc-card__meta">
        {row.featureId && row.version && <Link className="ds-mono" to={`/features/${row.featureId}/${row.version}?tab=flags`}>{`${row.featureId} ${row.version}`}</Link>}
        {row.package && <span>{T.pkg[row.package] ?? row.package}</span>}
        {f?.since && <span>{`${T.col.since} ${when(f.since)}`}</span>}
        {f?.dueAt && <span>{`${T.col.due} ${when(f.dueAt)}`}</span>}
        {row.waiver && <span>{row.waiver.state === 'APPROVED' ? T.common.waived : T.common.waiverPending}</span>}
      </div>
      <details className="fc-card__action"><summary>{T.col.action}</summary><span className="fc-actions">
        <NextAction row={row} repos={repos} prs={prs} />
      </span></details>
    </li>
  );
}

function FileCard({ f, repos }: { f: FlagFileFinding; repos: FlagRepository[] }) {
  const repo = repos.find((r) => r.repoId === f.repoId);
  const url = repo ? `${repo.repository}/blob/${f.commit}/${f.call.path}#L${f.call.line}` : null;
  return (
    <li className="fc-card" data-file={`${f.call.path}:${f.call.line}`}>
      <div className="fc-card__top">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" title={`${f.call.path}:${f.call.line} — ${T.common.sourceLink}`}>
            {`${shortPath(f.call.path)}:${f.call.line}`} ↗
          </a>
        ) : (
          <span className="fc-file" title={f.call.path}>{`${shortPath(f.call.path)}:${f.call.line}`}</span>
        )}
        <SeverityBadge severity="WARNING" />
      </div>
      <p className="fc-file">{f.call.symbol}</p>
      <div className="fc-card__meta">
        <span>{R.dynamicFile}</span>
        <span>{repoName(repos, f.repoId)}</span>
        <span>{`${T.col.since} ${when(f.since)}`}</span>
      </div>
      {repo && (
        <span className="fc-actions">
          <RescanButton repos={[repo]} repoId={repo.repoId} />
        </span>
      )}
    </li>
  );
}

export function FlagCodeReconcileScreen() {
  const q = useCoverage();
  const repoQ = useRepositories();
  const prQ = usePullRequests();
  const wvQ = useWaivers();
  const cov = coverageOf(q.data);
  const repos = listOf<FlagRepository>(repoQ.data);
  const prs = listOf<FlagPullRequest>(prQ.data);
  const pendingWaivers = listOf<FlagGateWaiver>(wvQ.data).filter((w) => w.state === 'REQUESTED');
  const [sev, setSev] = useState<SevFilter>('ALL');
  const [pkg, setPkg] = useState('');
  const rows = cov?.rows ?? [];
  const files = cov?.fileFindings ?? [];
  const visible = useMemo(() => rows.filter((r) => r.status !== 'OK' && (sev === 'ALL' || r.severity === sev) && (!pkg || r.package === pkg)), [rows, sev, pkg]);
  const columns = BOARD_STATUSES.map((status) => {
    const cards = visible.filter((r) => r.status === status).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (primaryFinding(a)?.since ?? '').localeCompare(primaryFinding(b)?.since ?? ''));
    const dyn = status === 'DYNAMIC_KEY' && (sev === 'ALL' || sev === 'WARNING') && !pkg ? files : [];
    const top: FlagCoverageSeverity = cards[0]?.severity ?? (dyn.length ? 'WARNING' : 'OK');
    return { status, cards, dyn, top, count: cards.length + dyn.length };
  });
  const blocking = rows.filter((r) => r.releaseBlocking).length;
  const attention = rows.filter((r) => r.status !== 'OK').length + files.length;
  const sevCount = (s: FlagCoverageSeverity) => rows.filter((r) => r.status !== 'OK' && r.severity === s).length;
  return (
    <div className="ds-screen fc-screen">
      <PageHeader
        codes="D01-06 · D01-01"
        title={R.title}
        lead={R.lead}
        message={
          !cov
            ? { text: R.keyWarn, value: '—' }
            : blocking
              ? { tone: 'danger', value: blocking, text: R.keyBlocked }
              : attention
                ? { tone: 'warn', value: attention, text: R.keyWarn }
                : { tone: 'ok', text: R.keyOk }
        }
        actions={<RescanButton repos={repos} />}
      />
      <FlagCodeNav />
      <AsyncView state={q.isSuccess && !cov ? 'error' : asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <div className="fc-filters" role="group" aria-label={R.filters}>
          <Segmented<SevFilter>
            label={R.severityFilter}
            value={sev}
            onChange={setSev}
            options={[
              { value: 'ALL', label: R.all, count: attention },
              { value: 'BLOCKER', label: T.severity.BLOCKER, count: sevCount('BLOCKER') },
              { value: 'WARNING', label: T.severity.WARNING, count: sevCount('WARNING') + files.length },
              { value: 'INFO', label: T.severity.INFO, count: sevCount('INFO') },
            ]}
          />
          <Select label={T.col.pkg} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="">{T.common.allPackages}</option>
            {FLAG_PACKAGES.filter((p) => rows.some((r) => r.package === p && r.status !== 'OK')).map((p) => (
              <option key={p} value={p}>{T.pkg[p] ?? p}</option>
            ))}
          </Select>
        </div>
        <Panel title={R.board} id="board">
        <div className="fc-board">
          {columns.map((c) => (
            <section key={c.status} className="fc-col" data-sev={c.count ? c.top : undefined} data-column={c.status as FlagCoverageStatus} aria-labelledby={`col-${c.status}`}>
              <header>
                <h3 id={`col-${c.status}`}>{T.coverageStatus[c.status]}</h3>
                <b>{c.count}</b>
              </header>
              {c.count > 0 && (
                <ol>
                  {c.cards.map((r) => (
                    <FlagCard key={r.flagKey} row={r} repos={repos} prs={prs} />
                  ))}
                  {c.dyn.map((f) => (
                    <FileCard key={`${f.repoId}:${f.call.path}:${f.call.line}`} f={f} repos={repos} />
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
        </Panel>
      </AsyncView>
      {pendingWaivers.length > 0 && (
        <Panel title={R.waiverQueue} id="waiver-queue" eyebrow={R.waiverQueueEyebrow(pendingWaivers.length)}>
          <ul className="fc-findings">
            {pendingWaivers.map((w) => (
              <li key={w.waiverId} data-sev="INFO">
                <WaiverLine w={w} />
                <span>
                  <Link className="ds-mono" to={`/flag-code/flags/${encodeURIComponent(w.flagKey)}`}>{w.flagKey}</Link> · {w.reason}
                  <span className="fc-sub">{`${T.actions.statusAt(T.coverageStatus[w.coverageStatus])} · ${T.col.expires} ${when(w.expiresAt)}`}</span>
                </span>
                <small>
                  <WaiverDecision w={w} />
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
