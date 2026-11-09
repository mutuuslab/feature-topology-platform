// Flag 코드 연결 화면 공용 부품 — 하위 이동, 상태 표식, 5원천 칸, 소스·커밋 링크, 통제 동작(PR·재스캔·제거 PR·시연 병합·해제 요청/결정).
// 권한은 화면이 역할로 판단해 이유를 보이고, 서버가 다시 거부한다(직무 분리 포함).
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FLAG_LANES, FLAG_PR_RESUME_AFTER_MS, FLAG_WAIVER_MAX_DAYS, flagPrResumable, type FlagCoverageRow, type FlagCoverageSeverity, type FlagGateWaiver, type FlagPullRequest, type FlagRepository } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { actorFor } from '../../api/actor';
import { useApiMutation } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { Button, Drawer, ErrorNote, Field, Select } from '../../design';
import { personLabel } from '../../data/people';
import { useAppShell, useToast } from '../../store';
import { usePermission, when } from '../shared';
import { commitUrl, FLAG_CODE_INVALIDATE, listOf, shortPath, usePullRequests } from './data';
import './flag-code.css';

const A = T.actions;

/** 현황·대사판·수명 관리 하위 이동 — 같은 상단 줄 */
export function FlagCodeNav() {
  const items = [
    { to: '/flag-code', label: T.nav.coverage, end: true },
    { to: '/flag-code/reconcile', label: T.nav.reconcile, end: false },
    { to: '/flag-code/lifecycle', label: T.nav.lifecycle, end: false },
  ];
  return (
    <><nav className="fc-nav" aria-label={T.nav.label}>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end}>
          {i.label}
        </NavLink>
      ))}
    </nav>{STATIC_MODE && <p className="fc-note">{T.local.notice}</p>}</>
  );
}

export { StatusBadge } from './badge';
export function SeverityBadge({ severity }: { severity: FlagCoverageSeverity }) {
  return (
    <span className="fc-status" data-sev={severity}>
      {T.severity[severity]}
    </span>
  );
}

/** 해제 표식 — 승인된 해제는 출시 관문을 통과시킨다 */
export function WaiverMark({ row }: { row: FlagCoverageRow }) {
  if (!row.waiver) return null;
  return <span className="fc-waiver">{row.waiver.state === 'APPROVED' ? `${T.common.waived} · ${when(row.waiver.expiresAt).slice(0, 10)}` : T.common.waiverPending}</span>;
}

/** 5원천 칸 — 상세는 근거 문장까지, mini는 표·요약용 */
export function Lanes({ row, mini = false, detail }: { row: FlagCoverageRow; mini?: boolean; detail?: Partial<Record<(typeof FLAG_LANES)[number], ReactNode>> }) {
  return (
    <ol className={mini ? 'fc-lanes fc-lanes--mini' : 'fc-lanes'} aria-label={T.detail.lanes}>
      {FLAG_LANES.map((l) => {
        const s = row.lanes[l] ?? 'NOT_APPLICABLE';
        return (
          <li key={l} data-lane={s} data-lane-name={l}>
            <span className="fc-lanes__name">{T.lane[l]}</span>
            <span className={mini ? undefined : 'fc-lanes__state'}>{T.laneState[s]}</span>
            {!mini && <small>{T.laneHint[l]}</small>}
            {!mini && detail?.[l]}
          </li>
        );
      })}
    </ol>
  );
}

/** 소스 줄 링크(새 창) */
export function UsageLink({ url, path, line, full = false }: { url: string; path: string; line: number; full?: boolean }) {
  if (url.startsWith('https://offline-demo.invalid/')) return <span className="fc-file" title={T.local.source}>{`${full ? path : shortPath(path)}:${line}`}</span>;
  return (
    <a className="fc-file" href={url} target="_blank" rel="noopener noreferrer" title={`${path}:${line} — ${T.common.sourceLink}`}>
      {`${full ? path : shortPath(path)}:${line}`} ↗
    </a>
  );
}
export function CommitLink({ repository, commit }: { repository?: string; commit: string | null | undefined }) {
  const url = STATIC_MODE && commit?.length === 64 ? null : commitUrl(repository, commit);
  if (!commit) return <span className="fc-num">—</span>;
  return url ? (
    <a className="fc-num" href={url} target="_blank" rel="noopener noreferrer" title={T.common.commitLink}>
      {commit.slice(0, 8)} ↗
    </a>
  ) : (
    <span className="fc-num" title={commit}>{commit.slice(0, 8)}</span>
  );
}
/** PR — 실제 URL이 없으면(과거 PR) 병합 커밋 링크로 대신한다 */
export function PrRef({ pr, repository }: { pr: Pick<FlagPullRequest, 'number' | 'url' | 'state'> & { mergeCommit?: string | null }; repository?: string }) {
  const label = `${pr.number ? `#${pr.number}` : '—'} ${T.prState[pr.state] ?? pr.state}`;
  if (pr.url)
    return (
      <a className="fc-num" href={pr.url} target="_blank" rel="noopener noreferrer" title={T.common.prLink}>
        {label} ↗
      </a>
    );
  const merged = pr.mergeCommit ? commitUrl(repository, pr.mergeCommit) : null;
  return merged ? (
    <a className="fc-num" href={merged} target="_blank" rel="noopener noreferrer" title={T.common.commitLink}>
      {label} ↗
    </a>
  ) : (
    <span className="fc-num">{label}</span>
  );
}

/** 지금 계정의 행위자 ID — 직무 분리 안내(요청자 = 결정자) */
export function useActorId() {
  const { role } = useAppShell();
  return actorFor(role).id;
}

// ── 통제 동작 ───────────────────────────────────────────

function Done({ text }: { text: string | null }) {
  return text ? (
    <span className="fc-done" role="status">
      {text}
    </span>
  ) : null;
}

/** 재스캔 — 구현 담당·출시 담당. 사유 필수 */
export function RescanButton({ repos, repoId, variant = 'default' }: { repos: FlagRepository[]; repoId?: string; variant?: 'default' | 'primary' | 'ghost' }) {
  const perm = usePermission(['IMPLEMENTER', 'RELEASE_MANAGER']);
  const m = useApiMutation('rescanFlagRepository', FLAG_CODE_INVALIDATE);
  const [open, setOpen] = useState(false);
  const [picked, setTarget] = useState('');
  // 저장소 목록이 늦게 와도 첫 저장소를 기본으로(선택 전)
  const target = picked || repoId || (STATIC_MODE ? repos.find(r => r.mode === 'DEMO_MIRROR') : repos[0])?.repoId || '';
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const why = STATIC_MODE && repos.find(r => r.repoId === target)?.mode !== 'DEMO_MIRROR' ? T.local.remote : reason.trim().length < 2 ? A.reasonHint : !target ? A.needRepo : undefined;
  return (
    <>
      <Button variant={variant} disabled={!perm.ok} reason={perm.hint} onClick={() => (setOpen(true), setDone(null), m.reset())}>
        {T.next.rescan}
      </Button>
      <Done text={done} />
      <Drawer open={open} title={A.rescanTitle} onClose={() => setOpen(false)} dirty={!!reason}>
        <div className="fc-form">
          {!repoId && (
            <Select label={A.rescanRepo} value={target} onChange={(e) => setTarget(e.target.value)}>
              {repos.map((r) => (
                <option key={r.repoId} value={r.repoId}>
                  {r.displayName}
                </option>
              ))}
            </Select>
          )}
          <Field label={A.rescanBranch}>
            <input className="ds-input ds-input--mono" type="text" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Field label={A.reason} hint={A.reasonHint}>
            <textarea className="ds-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={m.error} />
          <Button
            variant="primary"
            disabled={!perm.ok || !!why || m.isPending}
            reason={perm.ok ? why : perm.hint}
            onClick={() => m.mutate({ params: { id: target }, body: { reason: reason.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) } }, { onSuccess: () => (setOpen(false), setReason(''), setRef(''), setDone(A.rescanDone)) })}
          >
            {T.next.rescan}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

/** PR 다시 만들기 — 구현 담당. 행의 패키지를 연결한 저장소로 */
export function CreatePrButton({ row, repos }: { row: FlagCoverageRow; repos: FlagRepository[] }) {
  const perm = usePermission(['IMPLEMENTER']);
  // 생성 실패(App 미연결·권한 부족)도 201로 오고 state FAILED·failure에 이유가 있다
  const m = useApiMutation<{ state?: string; failure?: string | null }>('createFlagPr', FLAG_CODE_INVALIDATE);
  const candidates = repos.filter((r) => (!STATIC_MODE || r.mode === 'DEMO_MIRROR') && (!row.package || r.packages.some((p) => p.name === row.package)));
  const [open, setOpen] = useState(false);
  const [picked, setTarget] = useState('');
  const target = picked || candidates[0]?.repoId || '';
  const [done, setDone] = useState<string | null>(null);
  if (row.pullRequest && ['FAILED', 'PLANNED'].includes(row.pullRequest.state)) return <ResumePrButton prId={row.pullRequest.prId} repos={repos} />;
  if (!row.featureId || !row.version) return null;
  const why = !candidates.length ? A.noRepoForPkg : undefined;
  return (
    <>
      <Button disabled={!perm.ok || !!why} reason={perm.ok ? why : perm.hint ?? A.implementerOnly} onClick={() => (setOpen(true), setDone(null), m.reset())}>
        {T.next.createPr}
      </Button>
      <Done text={done} />
      <Drawer open={open} title={A.createPrTitle} onClose={() => setOpen(false)}>
        <div className="fc-form">
          <p className="fc-note">{A.createPrBody(row.flagKey)}</p>
          <Select label={A.rescanRepo} value={target} onChange={(e) => setTarget(e.target.value)}>
            {candidates.map((r) => (
              <option key={r.repoId} value={r.repoId}>
                {r.displayName}
              </option>
            ))}
          </Select>
          <ErrorNote error={m.error} />
          <Button
            variant="primary"
            disabled={!perm.ok || !target || m.isPending}
            reason={perm.ok ? (!target ? A.needRepo : undefined) : perm.hint}
            onClick={() => m.mutate({ body: { featureId: row.featureId, version: row.version, repoId: target, flagKeys: [row.flagKey] } }, { onSuccess: (pr) => (setOpen(false), setDone(pr?.state === 'FAILED' ? A.createPrFailed(pr.failure ?? '') : A.createPrDone)) })}
          >
            {T.next.createPr}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

/** Resume the recorded request, never a new one-key request inferred from a coverage row. */
export function ResumePrButton({ prId, repos }: { prId: string; repos: FlagRepository[] }) {
  const perm = usePermission(['IMPLEMENTER']);
  const toast = useToast();
  const qc = useQueryClient();
  const q = usePullRequests();
  const pr = listOf<FlagPullRequest>(q.data).find((p) => p.prId === prId);
  const removal = pr?.kind === 'REMOVAL';
  const m = useApiMutation<FlagPullRequest>(removal ? 'createFlagRemovalPr' : 'createFlagPr', [...FLAG_CODE_INVALIDATE, 'flagRetirements']);
  const [now, setNow] = useState(Date.now);
  const [done, setDone] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    if (pr?.state !== 'PLANNED') return;
    const remaining = Date.parse(pr.createdAt) + FLAG_PR_RESUME_AFTER_MS - Date.now() + 1;
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [pr?.createdAt, pr?.state]);
  const repo = repos.find((r) => r.repoId === pr?.repoId);
  const why = q.isPending ? A.resumeLoading : !pr || !repo || repo.status !== 'ACTIVE' || repo.mode === 'ACTIONS_OIDC' || (removal && (!pr.retirementId || pr.flagKeys.length !== 1)) ? A.resumeNoRepo : !flagPrResumable(pr, now) ? A.resumeWaiting : undefined;
  const readBack = async (error: { status: number }) => {
    if (error.status === 401 || error.status === 403 || !pr) return;
    setRecovering(true);
    try {
      const result = await q.refetch();
      const current = listOf<FlagPullRequest>(result.data).find((p) => p.prId === prId);
      const same = current?.repoId === pr.repoId && current.featureId === pr.featureId && current.version === pr.version && current.kind === pr.kind && current.branch === pr.branch && JSON.stringify(current.flagKeys) === JSON.stringify(pr.flagKeys);
      if (result.isSuccess && same && current?.state === 'OPEN' && current.number && current.url) {
        setRecovered(true); setDone(A.resumeRecovered); toast(A.resumeRecovered);
        await Promise.all(FLAG_CODE_INVALIDATE.filter((name) => name !== 'flagPullRequests').map((name) => qc.invalidateQueries({ queryKey: [name] })));
      }
      else setDone(A.resumeUnconfirmed);
    } finally { setRecovering(false); }
  };
  if (pr && !['FAILED', 'PLANNED'].includes(pr.state)) return <span className="fc-actions"><PrRef pr={pr} repository={repo?.repository} /><Done text={done} /></span>;
  return <span className="fc-form" data-pr-resume={prId}>
    <span className="fc-note">{A.resumeNote}</span>
    {pr?.failure && <span className="fc-note" role="status">{pr.failure}</span>}
    <Button disabled={!perm.ok || !!why || m.isPending || recovering} reason={perm.ok ? why : perm.hint} onClick={() => {
      if (!pr) return;
      setDone(null); setRecovered(false); m.reset();
      m.mutate({ body: removal ? { flagKey: pr.flagKeys[0], repoId: pr.repoId, retirementId: pr.retirementId } : { featureId: pr.featureId, version: pr.version, repoId: pr.repoId, flagKeys: pr.flagKeys } }, {
        onSuccess: (result) => {
          const text = result?.state === 'OPEN' ? A.resumeDone : result?.state === 'FAILED' ? A.createPrFailed(result.failure ?? '') : A.resumeUnconfirmed;
          setDone(text);
          if (result?.state === 'OPEN') toast(text);
        },
        onError: (error) => { void readBack(error); },
      });
    }}>{A.resumePr}</Button>
    {!recovered && <ErrorNote error={m.error} />}
    <ErrorNote error={q.error} />
    {(q.isError || (!q.isPending && !pr)) && <Button onClick={() => void q.refetch()}>{A.resumeReload}</Button>}
    <Done text={done} />
  </span>;
}

/** 제거 PR — Retirement가 승인된 Flag만, 구현 담당 */
export function RemovalPrButton({ row, repos, retirementId }: { row: FlagCoverageRow; repos: FlagRepository[]; retirementId: string | null }) {
  const perm = usePermission(['IMPLEMENTER']);
  const m = useApiMutation('createFlagRemovalPr', [...FLAG_CODE_INVALIDATE, 'flagRetirements']);
  const available = repos.filter(r => !STATIC_MODE || r.mode === 'DEMO_MIRROR');
  const used = available.filter((r) => row.code.usages.some((u) => u.repoId === r.repoId));
  const [picked, setTarget] = useState('');
  const target = picked || used[0]?.repoId || available[0]?.repoId || '';
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const why = !retirementId ? A.removalNeedsRetirement : undefined;
  return (
    <>
      <Button disabled={!perm.ok || !!why} reason={perm.ok ? why : perm.hint} onClick={() => (setOpen(true), setDone(null), m.reset())}>
        {T.next.removalPr}
      </Button>
      <Done text={done} />
      <Drawer open={open} title={A.removalTitle} onClose={() => setOpen(false)}>
        <div className="fc-form">
          <p className="fc-note">{A.removalBody(row.flagKey)}</p>
          <Select label={A.rescanRepo} value={target} onChange={(e) => setTarget(e.target.value)}>
            {(used.length ? used : available).map((r) => (
              <option key={r.repoId} value={r.repoId}>
                {r.displayName}
              </option>
            ))}
          </Select>
          <ErrorNote error={m.error} />
          <Button
            variant="primary"
            disabled={!perm.ok || !target || !retirementId || m.isPending}
            reason={perm.ok ? (!target ? A.needRepo : undefined) : perm.hint}
            onClick={() => m.mutate({ body: { flagKey: row.flagKey, repoId: target, retirementId } }, { onSuccess: () => (setOpen(false), setDone(A.removalDone)) })}
          >
            {T.next.removalPr}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

/** 시연 병합 — 시연 저장소의 열린 PR만(실제 연결 저장소·운영은 서버가 409) */
export function DemoMergeButton({ pr, repo }: { pr: Pick<FlagPullRequest, 'prId' | 'state'>; repo: FlagRepository | undefined }) {
  const perm = usePermission(['IMPLEMENTER']);
  const m = useApiMutation('demoMergeFlagPr', FLAG_CODE_INVALIDATE);
  const [done, setDone] = useState<string | null>(null);
  const why = pr.state !== 'OPEN' || repo?.mode !== 'DEMO_MIRROR' ? A.mergeOnlyDemo : undefined;
  return (
    <span className="fc-actions">
      <Button
        icon="check"
        disabled={!perm.ok || !!why || m.isPending}
        reason={perm.ok ? why : perm.hint}
        title={A.mergeBody}
        onClick={() => m.mutate({ params: { id: pr.prId }, body: {} }, { onSuccess: () => setDone(A.mergeDone) })}
      >
        {T.next.demoMerge}
      </Button>
      <Done text={done} />
      <ErrorNote error={m.error} />
    </span>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** 출시 차단 해제 요청 — 구현 담당·출시 담당. 사유 10자 이상, 만료 30일 안 */
export function WaiverRequestButton({ row }: { row: FlagCoverageRow }) {
  const perm = usePermission(['IMPLEMENTER', 'RELEASE_MANAGER']);
  const m = useApiMutation('requestFlagGateWaiver', FLAG_CODE_INVALIDATE);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(() => isoDay(new Date(Date.now() + 14 * 86_400_000)));
  const [done, setDone] = useState<string | null>(null);
  if (!row.featureId || !row.version) return null;
  const expiresAt = new Date(`${until}T23:59:00+09:00`);
  const tooLong = !until || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > Date.now() + FLAG_WAIVER_MAX_DAYS * 86_400_000 || expiresAt.getTime() <= Date.now();
  const why = reason.trim().length < 10 ? A.waiverShort : tooLong ? A.waiverTooLong : undefined;
  const pending = row.waiver?.state === 'REQUESTED';
  return (
    <>
      <Button disabled={!perm.ok || pending} reason={!perm.ok ? perm.hint : pending ? T.common.waiverPending : undefined} onClick={() => (setOpen(true), setDone(null), m.reset())}>
        {T.next.requestWaiver}
      </Button>
      <Done text={done} />
      <Drawer open={open} title={A.waiverTitle} onClose={() => setOpen(false)} dirty={!!reason}>
        <div className="fc-form">
          <p className="fc-note">{A.waiverBody}</p>
          <p className="fc-note">{A.statusAt(T.coverageStatus[row.status])}</p>
          <Field label={A.waiverReason}>
            <textarea className="ds-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label={A.waiverExpires}>
            <input className="ds-input ds-input--mono" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <ErrorNote error={m.error} />
          <Button
            variant="primary"
            disabled={!perm.ok || !!why || m.isPending}
            reason={perm.ok ? why : perm.hint}
            onClick={() =>
              m.mutate(
                { body: { flagKey: row.flagKey, featureId: row.featureId, version: row.version, reason: reason.trim(), expiresAt: expiresAt.toISOString() } },
                { onSuccess: () => (setOpen(false), setReason(''), setDone(A.waiverDone)) },
              )
            }
          >
            {A.submit}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

/** 해제 결정 — Feature 승인자(F2 이상은 Safety Manager도). 요청자는 결정할 수 없다 */
export function WaiverDecision({ w }: { w: FlagGateWaiver }) {
  const perm = usePermission(['FEATURE_APPROVER', 'SAFETY_OFFICER']);
  const me = useActorId();
  const m = useApiMutation('decideFlagGateWaiver', FLAG_CODE_INVALIDATE);
  const [comment, setComment] = useState('');
  const self = me === w.requestedBy;
  const why = self ? A.selfDecision : comment.trim().length < 2 ? A.reasonHint : undefined;
  const decide = (decision: 'APPROVE' | 'REJECT') => m.mutate({ params: { id: w.waiverId }, body: { decision, comment: comment.trim() } });
  if (w.state !== 'REQUESTED') return null;
  return (
    <div className="fc-form" data-testid={`waiver-decide-${w.waiverId}`}>
      <Field label={A.decideComment} hint={`${A.personalSign} ${A.safetyToo}`}>
        <input className="ds-input" type="text" value={comment} onChange={(e) => setComment(e.target.value)} disabled={!perm.ok || self} />
      </Field>
      <ErrorNote error={m.error} />
      <div className="fc-actions">
        <Button variant="primary" disabled={!perm.ok || !!why || m.isPending} reason={perm.ok ? why : perm.hint} onClick={() => decide('APPROVE')}>
          {A.approve}
        </Button>
        <Button disabled={!perm.ok || !!why || m.isPending} onClick={() => decide('REJECT')}>
          {A.reject}
        </Button>
      </div>
    </div>
  );
}

/** 해제 한 건 요약 줄 */
export function WaiverLine({ w }: { w: FlagGateWaiver }) {
  return (
    <span>
      <span className="fc-status" data-sev={w.state === 'APPROVED' ? 'OK' : w.state === 'REQUESTED' ? 'INFO' : 'NONE'}>
        {T.waiverState[w.state] ?? w.state}
      </span>{' '}
      <span className="fc-sub">{A.requestedBy(personLabel(w.requestedBy), when(w.requestedAt))}</span>
    </span>
  );
}
