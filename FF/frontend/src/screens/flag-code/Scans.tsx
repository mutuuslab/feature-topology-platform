// /integration/code-scans — 스캔 기록(20-97 §7.2). 계기·ref·커밋·결과·서명 출처·사용처/Flag/동적 수·PR 검사 결론.
// 행을 열면 서명 검증·PR 검사 결과·풀지 못한 동적 키 위치. 재스캔은 구현 담당·출시 담당.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FlagPrCheckFinding, FlagRepository, FlagScanRun } from '@ff/contracts';
import { call, STATIC_MODE } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, KeyValue, PageHeader, Panel, Select, type Column } from '../../design';
import { personLabel } from '../../data/people';
import { when } from '../shared';
import { CommitLink, RescanButton } from './common';
import { listOf, repoName, scanDetailOf, useRepositories, useScans } from './data';

const S = T.scans;
const C = T.col;

function ResultBadge({ s }: { s: FlagScanRun }) {
  const sev = s.status === 'SUCCEEDED' ? 'OK' : s.status === 'FAILED' || s.status === 'REJECTED' ? 'BLOCKER' : 'INFO';
  return (
    <span className="fc-status" data-sev={sev}>
      {T.scanStatus[s.status] ?? s.status}
    </span>
  );
}

function Attestation({ s }: { s: FlagScanRun }) {
  const a = s.attestation;
  if (!a) return <span className="fc-num">—</span>;
  return (
    <span className="ds-tag">
      {T.attestation[a.kind] ?? a.kind}
    </span>
  );
}

/** 스캔 표 열 — 저장소 상세의 배달·스캔 기록도 같은 열을 쓴다 */
export function scanColumns(repos: FlagRepository[], hideRepo = false): Column<FlagScanRun>[] {
  const repoOf = (id: string) => repos.find((r) => r.repoId === id);
  return [
    { key: 'at', header: C.at, sort: (s) => s.finishedAt ?? s.queuedAt, cell: (s) => <span className="fc-num">{when(s.finishedAt ?? s.queuedAt)}</span> },
    ...(hideRepo ? [] : [{ key: 'repo', header: C.repo, cell: (s: FlagScanRun) => repoName(repos, s.repoId) } as Column<FlagScanRun>]),
    { key: 'trigger', header: C.trigger, cell: (s) => (s.prNumber ? `${T.trigger[s.trigger] ?? s.trigger} #${s.prNumber}` : (T.trigger[s.trigger] ?? s.trigger)) },
    { key: 'ref', header: C.ref, cell: (s) => <span className="fc-file">{s.ref}</span>, minor: true },
    { key: 'commit', header: C.commit, cell: (s) => <CommitLink repository={repoOf(s.repoId)?.repository} commit={s.commit} /> },
    { key: 'result', header: C.result, sort: (s) => s.status, cell: (s) => <ResultBadge s={s} /> },
    { key: 'att', header: C.attestation, cell: (s) => <Attestation s={s} /> },
    { key: 'found', header: C.found, cell: (s) => <span className="fc-num">{s.summary ? S.counts(s.summary.usages, s.summary.flagKeys, s.summary.unresolved) : '—'}</span> },
    {
      key: 'check',
      header: C.check,
      cell: (s) =>
        s.prCheck ? (
          <span className="fc-status" data-sev={s.prCheck.conclusion === 'success' ? 'OK' : 'BLOCKER'}>
            {T.check[s.prCheck.conclusion]}
          </span>
        ) : (
          '—'
        ),
    },
  ];
}

function ScanDrawer({ scan, repos, onClose }: { scan: FlagScanRun | null; repos: FlagRepository[]; onClose: () => void }) {
  const q = useApi<unknown>('flagScanDetail', { params: { id: scan?.scanId ?? '' } }, { enabled: !!scan });
  const d = scanDetailOf(q.data);
  const s = d.run ?? scan;
  const repo = repos.find((r) => r.repoId === s?.repoId);
  const a = s?.attestation;
  return (
    <Drawer open={!!scan} title={scan ? S.drawer(scan.scanId) : ''} onClose={onClose}>
      {s && (
        <div className="fc-form" data-testid="scan-detail">
          <KeyValue
            rows={[
              { k: C.repo, v: repo?.displayName ?? s.repoId, note: s.ref },
              { k: C.trigger, v: T.trigger[s.trigger] ?? s.trigger, note: s.prNumber ? S.prNumber(s.prNumber) : undefined },
              { k: C.commit, v: <CommitLink repository={repo?.repository} commit={s.commit} /> },
              ...(s.baseCommit ? [{ k: S.base, v: <CommitLink repository={repo?.repository} commit={s.baseCommit} /> }] : []),
              { k: C.result, v: <ResultBadge s={s} />, note: when(s.finishedAt ?? s.queuedAt) },
              {
                k: S.signature,
                v: <Attestation s={s} />,
                note:
                  d.verified === false
                    ? S.signatureFail
                    : !a
                      ? undefined
                      : a.kind === 'FF_SCANNER'
                        ? `${S.signatureOk} · ${S.keyId(a.keyId)}`
                        : a.kind === 'GITHUB_OIDC'
                          ? `${S.signatureOk} · ${S.oidc(a.workflowRef)}`
                          : S.signatureNone,
              },
              ...(d.provenance ? [{ k: C.attestation, v: S.resultProvenance[d.provenance] ?? d.provenance }] : []),
              { k: C.found, v: <span className="fc-num">{s.summary ? S.counts(s.summary.usages, s.summary.flagKeys, s.summary.unresolved) : '—'}</span> },
              { k: S.by, v: personLabel(s.requestedBy), note: s.deliveryId ? `${S.delivery} ${s.deliveryId}` : undefined },
              ...(s.error ? [{ k: S.error, v: s.error.message, note: s.error.code }] : []),
            ]}
          />
          {d.local && <section><p className="fc-note">{T.local.notice}</p><h3>{T.local.source}</h3>{d.sourceFiles.map(f => <details key={f.path}><summary className="fc-file">{f.path}</summary><p className="fc-file">{f.sha256}</p><Button onClick={() => { const url = URL.createObjectURL(new Blob([f.content], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = f.path.split('/').at(-1) ?? 'source.ts'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{T.local.download}</Button><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.content}</pre></details>)}</section>}
          {s.prCheck && s.prCheck.findings.length > 0 && (
            <section aria-labelledby="scan-check-h">
              <h3 id="scan-check-h" className="ds-eyebrow ds-eyebrow--ko">{`${S.prCheck} · ${T.check[s.prCheck.conclusion]}`}</h3>
              <DataTable<FlagPrCheckFinding>
                caption={S.prCheck}
                rows={s.prCheck.findings}
                rowKey={(f) => `${f.code}:${f.flagKey ?? ''}:${f.path}:${f.line ?? ''}`}
                pageSize={0}
                columns={[
                  { key: 'level', header: C.level, cell: (f) => <span className="fc-status" data-sev={f.level === 'FAILURE' ? 'BLOCKER' : f.level === 'WARNING' ? 'WARNING' : 'INFO'}>{T.checkLevel[f.level]}</span> },
                  { key: 'code', header: C.kind, cell: (f) => T.checkCode[f.code] ?? f.code },
                  { key: 'flag', header: C.flag, cell: (f) => <span className="fc-file">{f.flagKey ?? '—'}</span> },
                  { key: 'path', header: C.file, cell: (f) => <span className="fc-file">{f.line ? `${f.path}:${f.line}` : f.path}</span> },
                  { key: 'msg', header: C.message, cell: (f) => f.message },
                ]}
              />
            </section>
          )}
          {d.unresolved.length > 0 && (
            <section aria-labelledby="scan-dyn-h">
              <h3 id="scan-dyn-h" className="ds-eyebrow ds-eyebrow--ko">{S.unresolved}</h3>
              <p className="fc-note">{S.unresolvedHint}</p>
              <ul className="fc-findings">
                {d.unresolved.map((u) => (
                  <li key={`${u.path}:${u.line}`} data-sev="WARNING">
                    <span className="fc-status" data-sev="WARNING">{u.method}</span>
                    <span>
                      {repo && s.commit ? (
                        <a className="fc-file" href={`${repo.repository}/blob/${s.commit}/${u.path}#L${u.line}`} target="_blank" rel="noopener noreferrer" title={T.common.sourceLink}>
                          {`${u.path}:${u.line}`} ↗
                        </a>
                      ) : (
                        <span className="fc-file">{`${u.path}:${u.line}`}</span>
                      )}
                      <span className="fc-sub fc-file">{u.symbol}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ErrorNote error={q.error} />
        </div>
      )}
    </Drawer>
  );
}

export function CodeScansScreen() {
  const q = useScans();
  const repoQ = useRepositories();
  const repos = listOf<FlagRepository>(repoQ.data);
  const first = listOf<FlagScanRun>(q.data);
  const [extra, setExtra] = useState<FlagScanRun[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [moreError, setMoreError] = useState<Error | null>(null);
  const next = cursor === undefined ? ((q.data as { nextCursor?: string | null } | undefined)?.nextCursor ?? null) : cursor;
  const [sp, setSp] = useSearchParams();
  const repo = sp.get('repo') ?? '';
  const trigger = sp.get('trigger') ?? '';
  const result = sp.get('result') ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const all = useMemo(() => [...first, ...extra], [first, extra]);
  const rows = all.filter((s) => (!repo || s.repoId === repo) && (!trigger || s.trigger === trigger) && (!result || s.status === result));
  const bad = all.filter((s) => s.status === 'FAILED' || s.status === 'REJECTED').length;
  const [open, setOpen] = useState<FlagScanRun | null>(null);
  return (
    <div className="ds-screen fc-screen">
      <PageHeader
        codes="D04-01"
        title={S.title}
        lead={S.lead}
        message={!q.data ? { text: S.keyOk, value: '—' } : bad ? { tone: 'danger', value: bad, text: S.keyRejected } : { tone: 'ok', text: S.keyOk }}
        actions={<RescanButton repos={repos} variant="primary" />}
      />
      <Panel title={S.table} id="scans">
        {STATIC_MODE && <p className="fc-note">{T.local.notice}</p>}
        <div className="fc-filters" role="group" aria-label={S.filters}>
          <Select label={C.repo} value={repo} onChange={(e) => set('repo', e.target.value)}>
            <option value="">{T.common.allRepos}</option>
            {repos.map((r) => (
              <option key={r.repoId} value={r.repoId}>{r.displayName}</option>
            ))}
          </Select>
          <Select label={C.trigger} value={trigger} onChange={(e) => set('trigger', e.target.value)}>
            <option value="">{S.allTriggers}</option>
            {[...new Set(all.map((s) => s.trigger))].map((t) => (
              <option key={t} value={t}>{T.trigger[t] ?? t}</option>
            ))}
          </Select>
          <Select label={C.result} value={result} onChange={(e) => set('result', e.target.value)}>
            <option value="">{S.allResults}</option>
            {[...new Set(all.map((s) => s.status))].map((t) => (
              <option key={t} value={t}>{T.scanStatus[t] ?? t}</option>
            ))}
          </Select>
          <span className="fc-count">{T.coverage.shown(rows.length, all.length)}</span>
        </div>
        <AsyncView state={asyncState(q, !all.length)} error={q.error} onRetry={() => q.refetch()}>
          <AsyncView state={rows.length ? 'ready' : 'empty'} filtered>
            <DataTable caption={S.table} rows={rows} rowKey={(s) => s.scanId} pageSize={50} onOpen={(s) => setOpen(s)} columns={scanColumns(repos)} />
          </AsyncView>
          {next && !STATIC_MODE && (
            <Button
              onClick={() =>
                call<{ items?: FlagScanRun[]; nextCursor?: string | null }>('flagScans', { query: { cursor: next } }).then(
                  (r) => (setExtra((x) => [...x, ...listOf<FlagScanRun>(r)]), setCursor(r?.nextCursor ?? null)),
                  (e: Error) => setMoreError(e),
                )
              }
            >
              {S.more}
            </Button>
          )}
          <ErrorNote error={moreError} />
        </AsyncView>
      </Panel>
      <ScanDrawer scan={open} repos={repos} onClose={() => setOpen(null)} />
    </div>
  );
}
