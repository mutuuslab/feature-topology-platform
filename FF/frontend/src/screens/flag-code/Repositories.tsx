// /integration/code-repositories(·/:repoId) — 코드 저장소 연결(20-97 §7.2). 연결 방식·기본 브랜치·패키지·스캔 주기·webhook·실패.
// 연결·변경은 출시 담당(RELEASE_MANAGER)만 — 구현 담당이 자기 PR 검사를 약화하지 못하게(직무 분리). 변경은 사유 필수·감사.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FLAG_PACKAGES, type FlagRepoMode, type FlagRepository, type FlagScanRun } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApiMutation } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Select } from '../../design';
import { usePermission, when } from '../shared';
import { CommitLink, RescanButton } from './common';
import { FLAG_CODE_INVALIDATE, listOf, useRepositories, useScans } from './data';
import { scanColumns } from './Scans';

const P = T.repos;
const S = T.repo;
const C = T.col;
const MANAGER = ['RELEASE_MANAGER'] as const;

function WebhookBadge({ state }: { state: string }) {
  const sev = state === 'ACTIVE' ? 'OK' : state === 'FAILING' ? 'BLOCKER' : 'NONE';
  return (
    <span className="fc-status" data-sev={sev}>
      {T.webhook[state] ?? state}
    </span>
  );
}

/** 출시 담당이 아니면 저장소 설정 버튼의 이유 — 역할 안내 + 직무 분리 까닭 */
function useManager() {
  const perm = usePermission(MANAGER);
  return { ok: perm.ok, why: perm.ok ? undefined : STATIC_MODE ? perm.hint : P.settingsOwner };
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const m = useApiMutation<FlagRepository>('createFlagRepository', FLAG_CODE_INVALIDATE);
  const mgr = useManager();
  const [f, setF] = useState({ repository: '', displayName: '', mode: (STATIC_MODE ? 'DEMO_MIRROR' : 'GITHUB_APP') as FlagRepoMode, defaultBranch: 'main', interval: '0', installationId: '' });
  const [pkgs, setPkgs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const packages = Object.entries(pkgs).map(([name, path]) => ({ name, path: path || `packages/${name}` }));
  const why = !f.repository.startsWith('https://') ? P.form.repository : !f.displayName.trim() ? P.form.displayName : !packages.length ? P.form.packages : f.mode === 'GITHUB_APP' && !f.installationId ? P.form.installation : undefined;
  return (
    <div className="fc-form">
      <Field label={P.form.repository}>
        <input className="ds-input ds-input--mono" type="text" value={f.repository} onChange={set('repository')} />
      </Field>
      <Field label={P.form.displayName}>
        <input className="ds-input" type="text" value={f.displayName} onChange={set('displayName')} />
      </Field>
      <div className="ds-split">
        <Select label={P.form.mode} value={f.mode} onChange={set('mode')}>
          {(['GITHUB_APP', 'ACTIONS_OIDC', 'DEMO_MIRROR'] as FlagRepoMode[]).map((m) => (
            <option key={m} value={m} disabled={STATIC_MODE && m !== 'DEMO_MIRROR'}>{T.mode[m]}</option>
          ))}
        </Select>
        <Field label={P.form.branch}>
          <input className="ds-input ds-input--mono" type="text" value={f.defaultBranch} onChange={set('defaultBranch')} />
        </Field>
      </div>
      <div className="ds-split">
        <Field label={P.form.interval}>
          <input className="ds-input ds-input--mono" type="number" min={0} max={1440} value={f.interval} onChange={set('interval')} />
        </Field>
        {f.mode === 'GITHUB_APP' && (
          <Field label={P.form.installation}>
            <input className="ds-input ds-input--mono" type="number" min={1} value={f.installationId} onChange={set('installationId')} />
          </Field>
        )}
      </div>
      <fieldset className="fc-pkgpick">
        <legend className="ds-field__label">{P.form.packages}</legend>
        {FLAG_PACKAGES.map((p) => (
          <label key={p}>
            <input type="checkbox" checked={p in pkgs} onChange={(e) => setPkgs((x) => { const n = { ...x }; if (e.target.checked) n[p] = `packages/${p}`; else delete n[p]; return n; })} />
            <span>{T.pkg[p] ?? p}</span>
            <input className="ds-input ds-input--mono" type="text" aria-label={P.form.packagePath(T.pkg[p] ?? p)} value={pkgs[p] ?? ''} disabled={!(p in pkgs)} onChange={(e) => setPkgs((x) => ({ ...x, [p]: e.target.value }))} />
          </label>
        ))}
      </fieldset>
      <p className="fc-note">{STATIC_MODE ? T.local.notice : P.form.secretNote}</p>
      <ErrorNote error={m.error} />
      <Button
        variant="primary"
        disabled={!mgr.ok || !!why || m.isPending}
        reason={mgr.ok ? why : mgr.why}
        onClick={() =>
          m.mutate(
            {
              body: {
                repository: f.repository.trim(),
                displayName: f.displayName.trim(),
                mode: f.mode,
                defaultBranch: f.defaultBranch.trim() || 'main',
                packages,
                scanIntervalMinutes: Number(f.interval) || 0,
                installationId: f.mode === 'GITHUB_APP' ? Number(f.installationId) : null,
              },
            },
            { onSuccess: onDone },
          )
        }
      >
        {P.form.submit}
      </Button>
    </div>
  );
}

export function CodeRepositoriesScreen() {
  const q = useRepositories();
  const repos = listOf<FlagRepository>(q.data);
  const nav = useNavigate();
  const mgr = useManager();
  const [open, setOpen] = useState(false);
  const failing = repos.filter((r) => r.webhook.state === 'FAILING' || r.lastScan?.status === 'FAILED' || r.lastScan?.status === 'REJECTED');
  return (
    <div className="ds-screen fc-screen">
      <PageHeader
        codes="D04-01"
        title={P.title}
        lead={P.lead}
        message={!q.data ? { text: P.keyOk, value: '—' } : failing.length ? { tone: 'warn', value: failing.length, text: P.keyFailing } : { tone: 'ok', value: repos.length, text: P.keyOk }}
        actions={
          <div className="fc-actions">
            <Link to="/integration/code-scans">{P.toScans}</Link>
            <RescanButton repos={repos} />
            <Button variant="primary" disabled={!mgr.ok} reason={mgr.why} onClick={() => setOpen(true)}>
              {P.connect}
            </Button>
          </div>
        }
      />
      <Drawer open={open} title={P.connect} onClose={() => setOpen(false)}>
        <ConnectForm onDone={() => setOpen(false)} />
      </Drawer>
      <Panel title={P.table} id="repos">
        <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
          <DataTable
            caption={P.table}
            rows={repos}
            rowKey={(r) => r.repoId}
            onOpen={(r) => nav(`/integration/code-repositories/${r.repoId}`)}
            columns={[
              {
                key: 'name',
                header: C.repo,
                sort: (r) => r.displayName,
                cell: (r) => (
                  <span>
                    <Link to={`/integration/code-repositories/${r.repoId}`}>{r.displayName}</Link>
                    <span className="fc-sub fc-file ds-nowrap">{r.repository.replace(/^https:\/\//, '')}</span>
                  </span>
                ),
              },
              { key: 'provider', header: C.provider, cell: (r) => r.provider, minor: true },
              { key: 'mode', header: C.mode, cell: (r) => T.mode[r.mode] },
              { key: 'branch', header: C.branch, cell: (r) => <span className="fc-file">{r.defaultBranch}</span> },
              { key: 'pkg', header: C.pkg, cell: (r) => <span className="fc-chips">{r.packages.map((p) => <span key={p.name} className="ds-tag">{T.pkg[p.name] ?? p.name}</span>)}</span> },
              { key: 'interval', header: C.interval, cell: (r) => T.common.minutes(r.scanIntervalMinutes) },
              { key: 'webhook', header: C.webhook, cell: (r) => <WebhookBadge state={r.webhook.state} /> },
              { key: 'delivery', header: C.delivery, cell: (r) => <span className="fc-num">{when(r.webhook.lastDeliveryAt)}</span>, minor: true },
              { key: 'fail', header: C.failures, align: 'right', cell: (r) => <span className="fc-num" data-alert={r.webhook.failureCount ? '' : undefined}>{r.webhook.failureCount}</span> },
              {
                key: 'scan',
                header: C.lastScan,
                cell: (r) =>
                  r.lastScan ? (
                    <span>
                      <span className="fc-num">{`${T.scanStatus[r.lastScan.status]} · ${when(r.lastScan.at)}`}</span>
                      <CommitLink repository={r.repository} commit={r.lastScan.commit} />
                    </span>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </AsyncView>
      </Panel>
    </div>
  );
}

function EditForm({ repo, onDone }: { repo: FlagRepository; onDone: () => void }) {
  const m = useApiMutation<FlagRepository>('updateFlagRepository', FLAG_CODE_INVALIDATE);
  const mgr = useManager();
  const [f, setF] = useState({ displayName: repo.displayName, defaultBranch: repo.defaultBranch, interval: String(repo.scanIntervalMinutes), status: repo.status as string, reason: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const changes = {
    ...(f.displayName.trim() !== repo.displayName ? { displayName: f.displayName.trim() } : {}),
    ...(f.defaultBranch.trim() !== repo.defaultBranch ? { defaultBranch: f.defaultBranch.trim() } : {}),
    ...(Number(f.interval) !== repo.scanIntervalMinutes ? { scanIntervalMinutes: Number(f.interval) } : {}),
    ...(f.status !== repo.status ? { status: f.status } : {}),
  };
  const why = !Object.keys(changes).length ? S.form.nothing : f.reason.trim().length < 2 ? S.form.reasonRequired : undefined;
  return (
    <div className="fc-form">
      <Field label={S.form.displayName}>
        <input className="ds-input" type="text" value={f.displayName} onChange={set('displayName')} />
      </Field>
      <div className="ds-split">
        <Field label={S.form.branch}>
          <input className="ds-input ds-input--mono" type="text" value={f.defaultBranch} onChange={set('defaultBranch')} />
        </Field>
        <Field label={S.form.interval}>
          <input className="ds-input ds-input--mono" type="number" min={0} max={1440} value={f.interval} onChange={set('interval')} />
        </Field>
      </div>
      <Select label={S.form.status} value={f.status} onChange={set('status')}>
        <option value="ACTIVE">{S.status.ACTIVE}</option>
        <option value="PAUSED">{S.status.PAUSED}</option>
      </Select>
      <Field label={S.form.reason}>
        <textarea className="ds-input" rows={2} value={f.reason} onChange={set('reason')} />
      </Field>
      <ErrorNote error={m.error} />
      <Button variant="primary" disabled={!mgr.ok || !!why || m.isPending} reason={mgr.ok ? why : mgr.why} onClick={() => m.mutate({ params: { id: repo.repoId }, body: { ...changes, reason: f.reason.trim() } }, { onSuccess: onDone })}>
        {S.form.submit}
      </Button>
    </div>
  );
}

export function CodeRepositoryDetailScreen() {
  const { repoId = '' } = useParams();
  const q = useRepositories();
  const scanQ = useScans();
  const repos = listOf<FlagRepository>(q.data);
  const repo = repos.find((r) => r.repoId === repoId) ?? null;
  const scans = listOf<FlagScanRun>(scanQ.data).filter((s) => s.repoId === repoId);
  const failed = scans.filter((s) => s.status === 'FAILED' || s.status === 'REJECTED' || s.error);
  const mgr = useManager();
  const [edit, setEdit] = useState(false);
  // 열 때마다 새 양식 — 저장 직후 다시 읽은 값으로 양식을 갈아 끼우면 닫기 콜백이 사라진다(react-query mutate 콜백은 언마운트 뒤 안 불린다)
  const [opened, setOpened] = useState(0);
  return (
    <div className="ds-screen fc-screen">
      <AsyncView state={q.isSuccess && !repo ? 'error' : asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {repo && (
          <>
            <PageHeader
              codes="D04-01"
              title={repo.displayName}
              lead={S.lead}
              message={
                repo.webhook.state === 'FAILING'
                  ? { tone: 'warn', text: S.keyFailing, status: { label: T.webhook.FAILING, tone: 'warn' } }
                  : repo.status === 'PAUSED'
                    ? { tone: 'warn', text: S.keyPaused, status: { label: S.status.PAUSED, tone: 'warn' } }
                    : { tone: 'ok', text: S.keyOk, status: { label: T.webhook[repo.webhook.state] ?? repo.webhook.state, tone: repo.webhook.state === 'ACTIVE' ? 'ok' : 'neutral' } }
              }
              meta={
                <>
                  <IdChip id={repo.repoId} />
                  <span className="ds-tag">{T.mode[repo.mode]}</span>
                  <a className="fc-file" href={repo.repository} target="_blank" rel="noopener noreferrer" title={T.common.repoLink}>
                    {repo.repository.replace(/^https:\/\//, '')} ↗
                  </a>
                </>
              }
              actions={
                <div className="fc-actions">
                  <RescanButton repos={[repo]} repoId={repo.repoId} />
                  <Button disabled={!mgr.ok} reason={mgr.why} onClick={() => (setOpened((n) => n + 1), setEdit(true))}>
                    {S.edit}
                  </Button>
                </div>
              }
            />
            <Drawer open={edit} title={S.edit} onClose={() => setEdit(false)}>
              <EditForm key={`${repo.repoId}-${opened}`} repo={repo} onDone={() => setEdit(false)} />
            </Drawer>
            <div className="ds-split">
              <Panel title={S.settings} id="settings">
                <KeyValue
                  rows={[
                    { k: C.provider, v: repo.provider, note: T.provenance[repo.mode] },
                    { k: C.branch, v: <span className="fc-file">{repo.defaultBranch}</span> },
                    { k: C.interval, v: T.common.minutes(repo.scanIntervalMinutes) },
                    { k: S.form.status, v: S.status[repo.status] ?? repo.status },
                    { k: S.scanPaths, v: repo.scanPaths.length ? <span className="fc-file">{repo.scanPaths.join(', ')}</span> : S.allPaths },
                    { k: S.installation, v: <span className="fc-num">{repo.installationId ?? '—'}</span> },
                    { k: S.created, v: when(repo.createdAt), note: repo.createdBy },
                  ]}
                />
              </Panel>
              <Panel title={S.webhook} id="webhook">
                <KeyValue
                  rows={[
                    { k: C.webhook, v: <WebhookBadge state={repo.webhook.state} /> },
                    { k: C.delivery, v: <span className="fc-num">{when(repo.webhook.lastDeliveryAt)}</span>, note: repo.webhook.lastDeliveryId ?? undefined },
                    { k: C.failures, v: <span className="fc-num" data-alert={repo.webhook.failureCount ? '' : undefined}>{repo.webhook.failureCount}</span> },
                    { k: S.lastError, v: repo.webhook.lastError ?? '—' },
                    { k: C.lastScan, v: repo.lastScan ? `${T.scanStatus[repo.lastScan.status]} · ${when(repo.lastScan.at)}` : '—' },
                  ]}
                />
              </Panel>
            </div>
            <Panel title={S.packages} id="packages">
              <DataTable
                caption={S.packages}
                rows={repo.packages}
                rowKey={(p) => p.name}
                columns={[
                  { key: 'name', header: C.pkg, cell: (p) => T.pkg[p.name] ?? p.name },
                  {
                    key: 'path',
                    header: C.path,
                    cell: (p) => (
                      <a className="fc-file" href={`${repo.repository}/tree/${repo.defaultBranch}/${p.path}`} target="_blank" rel="noopener noreferrer" title={T.common.repoLink}>
                        {p.path} ↗
                      </a>
                    ),
                  },
                ]}
              />
            </Panel>
            {failed.length > 0 && (
              <Panel title={S.failures} id="failures">
                <ul className="fc-findings">
                  {failed.map((s) => (
                    <li key={s.scanId} data-sev="BLOCKER">
                      <span className="fc-status" data-sev="BLOCKER">{T.scanStatus[s.status]}</span>
                      <span>
                        <span className="fc-num">{`${s.scanId} · ${T.trigger[s.trigger] ?? s.trigger} · ${when(s.finishedAt ?? s.queuedAt)}`}</span>
                        <span className="fc-sub">{s.error?.message ?? '—'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {scans.length > 0 && (
              <Panel title={S.deliveries} id="deliveries">
                <DataTable caption={S.deliveries} rows={scans} rowKey={(s) => s.scanId} pageSize={30} columns={scanColumns([repo], true)} />
              </Panel>
            )}
          </>
        )}
      </AsyncView>
    </div>
  );
}
