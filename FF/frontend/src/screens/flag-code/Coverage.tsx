// /flag-code — Flag 코드 연결 현황(20-97 §7.2). 등록된 Flag마다 저장소·파일·줄·커밋·PR·마지막 스캔과 대사 상태를 한 표로.
// 필터는 화면에서 건다(정적 설치는 전체 대사 스냅샷 하나).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FLAG_COVERAGE_STATUSES, FLAG_PACKAGES, type FlagCoverageRow, type FlagCoverageStatus, type FlagRepository } from '@ff/contracts';
import { asyncState } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, DataTable, PageHeader, Panel, Select, SummaryLine } from '../../design';
import { when } from '../shared';
import { CommitLink, CreatePrButton, FlagCodeNav, PrRef, StatusBadge, UsageLink, WaiverMark } from './common';
import { coverageOf, listOf, repoName, SEVERITY_RANK, useCoverage, useRepositories } from './data';

const C = T.col;

/** 패키지별 정상·조치·차단 누적 막대 */
function PackageBars({ rows }: { rows: FlagCoverageRow[] }) {
  const by = FLAG_PACKAGES.map((p) => {
    const mine = rows.filter((r) => r.package === p);
    const block = mine.filter((r) => r.releaseBlocking || r.severity === 'BLOCKER').length;
    const warn = mine.filter((r) => !r.releaseBlocking && r.severity !== 'BLOCKER' && r.status !== 'OK').length;
    return { p, total: mine.length, ok: mine.length - block - warn, warn, block };
  }).filter((x) => x.total > 0);
    // 모든 패키지를 같은 건수 축에서 비교한다.
    const max = Math.max(1, ...by.map((x) => x.total));
    const pct = (k: number) => `${(k / max) * 100}%`;
  return (
    <>
        <p className="fc-note">{T.coverage.packageScale(max)}</p>
        <ul className="fc-legend" aria-hidden="true">
        <li><i style={{ '--c': 'var(--ok)' } as React.CSSProperties} />{T.severity.OK}</li>
        <li><i style={{ '--c': 'var(--warn)' } as React.CSSProperties} />{T.severity.WARNING}</li>
        <li><i style={{ '--c': 'var(--danger)' } as React.CSSProperties} />{T.severity.BLOCKER}</li>
      </ul>
      <ul className="fc-pkgs">
        {by.map((x) => {
          const name = T.pkg[x.p] ?? x.p;
          return (
            <li key={x.p} className="fc-pkg" aria-label={T.coverage.pkgBar(name, x.ok, x.warn, x.block)}>
              <span className="fc-pkg__name">{name}</span>
              <span className="fc-pkg__bar" aria-hidden="true">
                  <span data-k="ok" style={{ width: pct(x.ok) }} />
                  <span data-k="warn" style={{ width: pct(x.warn) }} />
                  <span data-k="block" style={{ width: pct(x.block) }} />
              </span>
              <span className="fc-pkg__num">{`${x.ok}/${x.total}`}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FileCell({ r }: { r: FlagCoverageRow }) {
  const u = r.code.usages[0];
  if (!u) return <span className="fc-num">—</span>;
  return (
    <span>
      <UsageLink url={u.url} path={u.path} line={u.line} />
      {r.code.usages.length > 1 && <span className="fc-more"> {T.common.andMore(r.code.usages.length - 1)}</span>}
    </span>
  );
}

export function FlagCodeCoverageScreen() {
  const q = useCoverage();
  const repoQ = useRepositories();
  const cov = coverageOf(q.data);
  const repos = listOf<FlagRepository>(repoQ.data);
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const pkg = sp.get('package') ?? '';
  const repo = sp.get('repo') ?? '';
  const [text, setText] = useState(sp.get('q') ?? '');
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const all = cov?.rows ?? [];
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return all
      .filter((r) => (status === 'ATTENTION' ? r.status !== 'OK' : !status || r.status === status))
      .filter((r) => !pkg || r.package === pkg)
      .filter((r) => !repo || r.code.usages.some((u) => u.repoId === repo))
      .filter((r) => !needle || [r.flagKey, r.featureId ?? '', r.featureName ?? ''].some((s) => s.toLowerCase().includes(needle)))
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.flagKey.localeCompare(b.flagKey));
  }, [all, status, pkg, repo, text]);
  const s = cov?.summary;
  const lastScan = s?.repositories.map((r) => r.lastScanAt).filter(Boolean).sort().at(-1) ?? null;
  const counts = Object.fromEntries(FLAG_COVERAGE_STATUSES.map((k) => [k, all.filter((r) => r.status === k).length])) as Record<FlagCoverageStatus, number>;
  return (
    <div className="ds-screen fc-screen">
      <PageHeader
        codes="D01-06"
        title={T.coverage.title}
        lead={T.coverage.lead}
        message={
          !s
            ? { text: T.coverage.keyRatio, value: '—' }
            : s.releaseBlocking > 0
              ? { tone: 'danger', value: s.releaseBlocking, text: T.coverage.keyBlocked, action: <Link to="/flag-code/reconcile">{T.coverage.toReconcile}</Link> }
              : { tone: 'ok', value: `${s.connected}/${s.codeRequired}`, text: s.connected === s.codeRequired ? T.coverage.keyOk : T.coverage.keyRatio }
        }
        actions={<Link to="/integration/code-repositories">{T.coverage.toRepos}</Link>}
      />
      <FlagCodeNav />
      {s && (
        <SummaryLine
          label={T.coverage.summary}
          items={[
            { k: T.coverage.sumFlags, v: s.flags },
            { k: T.coverage.sumRequired, v: s.codeRequired },
            { k: T.coverage.sumConnected, v: s.connected },
            { k: T.coverage.sumBlocking, v: s.releaseBlocking },
            { k: T.coverage.sumPrOpen, v: s.byStatus.PR_OPEN ?? 0 },
            { k: T.coverage.sumScan, v: when(lastScan) },
          ]}
        />
      )}
      <AsyncView state={q.isSuccess && !cov ? 'error' : asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <Panel title={T.coverage.packages} id="flag-code-packages" eyebrow={T.coverage.packagesEyebrow}>
            <PackageBars rows={all} />
          </Panel>
          <Panel title={T.coverage.table} id="flag-code-table" eyebrow={T.coverage.shown(rows.length, all.length)}>
            <div className="fc-filters" role="group" aria-label={T.coverage.filters}>
              <Select label={C.status} value={status} onChange={(e) => set('status', e.target.value)}>
                <option value="">{T.common.allStatuses}</option>
                <option value="ATTENTION">{T.coverage.filterAttention}</option>
                {FLAG_COVERAGE_STATUSES.filter((k) => counts[k] > 0).map((k) => (
                  <option key={k} value={k}>{`${T.coverageStatus[k]} (${counts[k]})`}</option>
                ))}
              </Select>
              <Select label={C.pkg} value={pkg} onChange={(e) => set('package', e.target.value)}>
                <option value="">{T.common.allPackages}</option>
                {FLAG_PACKAGES.filter((p) => all.some((r) => r.package === p)).map((p) => (
                  <option key={p} value={p}>{T.pkg[p] ?? p}</option>
                ))}
              </Select>
              <Select label={C.repo} value={repo} onChange={(e) => set('repo', e.target.value)}>
                <option value="">{T.common.allRepos}</option>
                {repos.map((r) => (
                  <option key={r.repoId} value={r.repoId}>{r.displayName}</option>
                ))}
              </Select>
              <label className="ds-field ds-field--inline">
                <span className="ds-field__label">{T.common.search}</span>
                <input className="ds-input" type="search" value={text} placeholder={T.common.searchPlaceholder} onChange={(e) => (setText(e.target.value), set('q', e.target.value))} />
              </label>
            </div>
            <AsyncView state={rows.length ? 'ready' : 'empty'} filtered>
              <DataTable
                caption={T.coverage.table}
                rows={rows}
                rowKey={(r) => r.flagKey}
                pageSize={50}
                columns={[
                  { key: 'flag', header: C.flag, sort: (r) => r.flagKey, cell: (r) => <Link className="ds-mono" to={`/flag-code/flags/${encodeURIComponent(r.flagKey)}`}>{r.flagKey}</Link> },
                  {
                    key: 'feature',
                    header: C.feature,
                    sort: (r) => r.featureId ?? '',
                    cell: (r) =>
                      r.featureId && r.version ? (
                        <span>
                          <Link className="ds-mono ds-nowrap" to={`/features/${r.featureId}/${r.version}?tab=flags`}>{`${r.featureId} ${r.version}`}</Link>
                          {r.featureName && <span className="fc-sub">{r.featureName}</span>}
                        </span>
                      ) : (
                        <span className="fc-sub">{T.detail.unregisteredFeature}</span>
                      ),
                  },
                  { key: 'pkg', header: C.pkg, sort: (r) => r.package ?? '', cell: (r) => (r.package ? (T.pkg[r.package] ?? r.package) : '—'), minor: true },
                  {
                    key: 'status',
                    header: C.status,
                    sort: (r) => SEVERITY_RANK[r.severity],
                    cell: (r) => (
                      <span className="ds-stack">
                        <StatusBadge status={r.status} severity={r.severity} />
                        <WaiverMark row={r} />
                      </span>
                    ),
                  },
                  { key: 'repo', header: C.repo, cell: (r) => [...new Set(r.code.usages.map((u) => repoName(repos, u.repoId)))].join(', ') || '—', minor: true },
                  { key: 'file', header: C.file, cell: (r) => <FileCell r={r} /> },
                  { key: 'commit', header: C.commit, cell: (r) => <CommitLink repository={r.code.usages[0]?.repository} commit={r.code.usages[0]?.commit ?? r.code.lastSeen?.commit} /> },
                  { key: 'pr', header: C.pr, cell: (r) => (r.pullRequest ? <PrRef pr={r.pullRequest} /> : <span className="fc-num">—</span>) },
                  { key: 'scan', header: C.lastScan, sort: (r) => r.code.lastScanAt ?? '', cell: (r) => <span className="fc-num">{when(r.code.lastScanAt)}</span> },
                  {
                    key: 'act',
                    header: '',
                    srHeader: C.action,
                    cell: (r) => ((r.status === 'NO_CODE' && r.pullRequest?.state !== 'OPEN') || (r.pullRequest && ['FAILED', 'PLANNED'].includes(r.pullRequest.state)) ? <CreatePrButton row={r} repos={repos} /> : null),
                  },
                ]}
              />
            </AsyncView>
          </Panel>
      </AsyncView>
    </div>
  );
}
