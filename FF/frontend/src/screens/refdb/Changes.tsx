// /master/feature-db/changes(/:id) — Feature DB 변경 요청(30-95 §8.2·§8.3·§10). 작성(누구나) → 자동 점검 → 도메인 검토(DOMAIN_REVIEWER)
// → 승인·반려(REFDB_ADMIN) → 버전 발행(REFDB_ADMIN). 요청자는 자기 요청을 검토·승인할 수 없다(SOD-13·14, contracts refChangeDutyBlocker).
// 못 누르는 버튼은 이유를 함께 보인다(Button reason · whyDisabled).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { refChangeDutyBlocker, type RefChange, type RefChangeStatus, type RefFieldDiff, type RefQuality, type RefReviewOpinion, type RefRelease } from '@ff/contracts';
import { canAct } from '../../api/actor';
import { STATIC_MODE, type ApiError } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { CHANGE_STATUS_LABEL, featureDb as FD, KIND_LABEL, OPINION_LABEL, refChangeAudit as AU, refChangeDetail as D, refChanges as T, refDetail as RD, refPublish as PB, refReleaseCols as RC } from '../../copy/refdb';
import { auditActionKo } from '../../copy/audit';
import { ko } from '../../copy/ko';
import { personName } from '../../data/people';
import { AsyncView, Button, DataTable, DiffView, ErrorNote, Field, IdChip, KeyValue, PageHeader, Panel, Segmented, Select, SummaryLine, Tabs, whyDisabled } from '../../design';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';
import { ChangeStatusBadge, changePath, downloadExport, myActorId, RefChip, TextLink, type RefChangeDetailResponse, type RefChangeView, type RefPublishResponse, type RefReleasesResponse } from './common';
import { Checks, UsageTable } from './RefDetail';

/** 처리 중 — 작성·검토 중(검토 의견·승인 결정을 받을 수 있다) */
const OPEN: readonly RefChangeStatus[] = ['DRAFT', 'REVIEW'];
const TAB_FILTER: Record<string, (c: RefChange) => boolean> = {
  ALL: () => true,
  OPEN: (c) => OPEN.includes(c.status),
  APPROVED: (c) => c.status === 'APPROVED',
  PUBLISHED: (c) => c.status === 'PUBLISHED',
  REJECTED: (c) => c.status === 'REJECTED',
};
export { ChangeStatusBadge };

export function RefChangesScreen() {
  const nav = useNavigate();
  const q = useApi<{ items: RefChangeView[]; total?: number }>('listRefChanges');
  const items = q.data?.items ?? [];
  const open = items.filter(TAB_FILTER.OPEN).length;
  const approved = items.filter(TAB_FILTER.APPROVED).length;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE DB · CR"
        title={T.title}
        lead={T.lead}
        message={{ tone: open ? 'warn' : 'neutral', value: q.data ? open : '—', text: T.key, status: q.data ? { label: approved ? FD.awaiting : FD.noneAwaiting, tone: approved ? 'warn' : 'neutral' } : undefined }}
        actions={<TextLink to="/master/feature-db">{T.back}</TextLink>}
      />
      <Panel>
        <Tabs tabs={(Object.keys(TAB_FILTER) as (keyof typeof T.tabs)[]).map((k) => ({ key: k, label: T.tabs[k], count: q.data ? items.filter(TAB_FILTER[k]).length : undefined }))}>
          {(tab) => {
            const rows = items.filter(TAB_FILTER[tab] ?? TAB_FILTER.ALL);
            return (
              <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: T.empty }} error={q.error} onRetry={() => q.refetch()}>
                <DataTable<RefChange>
                  caption={T.caption}
                  rows={rows}
                  rowKey={(c) => c.changeId}
                  onOpen={(c) => nav(changePath(c.changeId))}
                  columns={[
                    { key: 'id', header: T.col.id, cell: (c) => <IdChip id={c.changeId} to={changePath(c.changeId)} copy={false} />, sort: (c) => c.changeId },
                    { key: 'k', header: T.col.kind, cell: (c) => KIND_LABEL[c.kind] ?? c.kind, sort: (c) => c.kind },
                    { key: 'r', header: T.col.ref, cell: (c) => <RefChip id={c.refId} />, sort: (c) => c.refId },
                    { key: 's', header: T.col.status, cell: (c) => <ChangeStatusBadge status={c.status} />, sort: (c) => c.status },
                    { key: 'v', header: T.col.reviews, cell: (c) => c.reviews.length, align: 'right' },
                    { key: 'b', header: T.col.by, cell: (c) => <span className="ds-mono">{c.requestedBy}</span>, minor: true },
                    { key: 'a', header: T.col.at, cell: (c) => <span className="ds-mono ds-nowrap">{when(c.requestedAt)}</span>, sort: (c) => c.requestedAt },
                  ]}
                />
              </AsyncView>
            );
          }}
        </Tabs>
      </Panel>
      <div className="ds-split">
        <Releases />
        <Publish pending={q.data ? approved : null} />
      </div>
    </div>
  );
}

function Releases() {
  const { role } = useAppShell();
  const q = useApi<RefReleasesResponse>('refReleases');
  const items = q.data?.items ?? [];
  const [pick, setPick] = useState('');
  const latest = items.at(-1)?.release ?? '';
  const release = pick || latest;
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const why = whyDisabled([STATIC_MODE, T.exportStatic], [!release, T.exportNone]);
  return (
    <Panel
      title={T.releases}
      id="ref-releases"
      eyebrow={q.data ? String(items.length) : undefined}
      actions={
        <span className="ds-toolbar">
          <Select label={T.exportRelease} value={release} onChange={(e) => setPick(e.target.value)} disabled={!items.length}>
            {items.map((r) => (
              <option key={r.release} value={r.release}>
                {r.release}
              </option>
            ))}
          </Select>
          <Button
            disabled={!!why || busy}
            reason={why}
            onClick={() => {
              setBusy(true);
              setError(null);
              downloadExport(role, release || null)
                .catch((e: ApiError) => setError(e))
                .finally(() => setBusy(false));
            }}
          >
            {T.export}
          </Button>
        </span>
      }
    >
      <ErrorNote error={error} />
      <AsyncView state={asyncState(q, items.length === 0)} empty={{ title: T.exportNone }} error={q.error} onRetry={() => q.refetch()}>
        <DataTable<RefRelease>
          caption={T.releasesCaption}
          rows={[...items].reverse()}
          rowKey={(r) => r.release}
          columns={[
            { key: 'r', header: T.rcol.release, cell: (r) => <span className="ds-mono">{r.release}</span> },
            { key: 'a', header: T.rcol.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.publishedAt)}</span> },
            // 발행자·메모는 1366에서도 보인다(보조 열 아님, P5-4)
            { key: 'b', header: T.rcol.by, cell: (r) => <span className="ds-nowrap" title={r.publishedBy}>{personName(r.publishedBy)}</span> },
            { key: 'c', header: T.rcol.changes, cell: (r) => r.changeIds.length, align: 'right' },
            { key: 'n', header: RC.note, cell: (r) => <span className="ds-field__hint" data-release-note>{r.note || '—'}</span> },
            { key: 'h', header: T.rcol.hash, cell: (r) => <span className="ds-mono" title={r.hash} data-hash={r.hash}>{`${r.hash.slice(0, 8)}…`}</span> },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

/** 발행 미리 보기 응답(refReleasePreview) */
interface ReleasePreview {
  release: string;
  latest: string | null;
  total: number;
  approved: { changeId: string; kind: string; refId: string; nameKo: string | null; status: string; requestedBy: string; decidedBy: string | null; decidedAt: string | null }[];
  retiring: { changeId: string; refId: string; nameKo: string | null; reason: string }[];
  notify: { featureId: string; version: string; name: string | null; ownerId: string | null; refId: string }[];
  quality: Record<'before' | 'after', { published: number; pending: number; noSource: number; attrMissing: number; awaitingPublish: number }>;
  memo: string;
}

const STATUS_KO: Record<string, string> = { ACTIVE: '활성', REVIEW: '검토 필요', DEPRECATED: '폐기 예정', RETIRED: '폐기', PENDING: '요청 중' };

/** 버전 발행 — 묶일 요청(승인 + 반려 → 폐기)·알림 받을 담당·품질 변화를 먼저 보이고, 메모(필수, 미리 채움)와 함께 발행한다(P5-4) */
function Publish({ pending }: { pending: number | null }) {
  const { role } = useAppShell();
  const perm = usePermission(['REFDB_ADMIN']);
  const admin = canAct(role, ['REFDB_ADMIN']);
  const preview = useApi<ReleasePreview>('refReleasePreview', {}, { enabled: admin });
  const publish = useApiMutation<RefPublishResponse | RefRelease>('publishRefRelease', ['refReleases', 'listRefChanges', 'refQuality', 'listRefs', 'refDetail', 'refReleasePreview']);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // 응답 모양이 미리 보기일 때만(이전 서버·모의 응답이면 예전처럼 승인 수만)
  const p = preview.data && Array.isArray(preview.data.approved) ? preview.data : undefined;
  // 미리 보기가 오면 메모를 미리 채운다(사람이 고치기 시작했으면 덮지 않는다)
  useEffect(() => {
    if (p?.memo && !touched) setNote(p.memo);
  }, [p?.memo, touched]);
  // 관리자만 이 칸을 본다(정적 데모도 관리자면 보이되 읽기 전용 이유가 붙는다)
  if (!admin) return null;
  const n = p ? p.total : (pending ?? 0);
  const why = whyDisabled([!perm.ok, perm.hint], [n === 0, PB.none], [note.trim().length < 2, PB.memoWhy]);
  const QK = PB.qk;
  const qKeys = ['published', 'pending', 'attrMissing', 'noSource', 'awaitingPublish'] as const;
  return (
    <Panel title={PB.title} id="ref-publish" eyebrow={p ? PB.next(p.release) : undefined}>
      <p className="ds-field__hint">{T.publishHint}</p>
      {p && p.total > 0 && (
        <div className="ds-stack" data-testid="ref-publish-preview">
          <section aria-label={PB.approved}>
            <h3 className="ds-eyebrow">{`${PB.approved} ${p.approved.length}`}</h3>
            <ul className="ds-linklist">
              {p.approved.map((a) => (
                <li key={a.changeId} data-publish-change={a.changeId}>
                  <Link to={changePath(a.changeId)}>{a.changeId}</Link> {`${KIND_LABEL[a.kind as keyof typeof KIND_LABEL] ?? a.kind} · ${a.refId} ${a.nameKo ?? ''} ${PB.becomes(STATUS_KO[a.status] ?? a.status)}`}
                </li>
              ))}
            </ul>
          </section>
          {p.retiring.length > 0 && (
            <section aria-label={PB.retiring}>
              <h3 className="ds-eyebrow">{`${PB.retiring} ${p.retiring.length}`}</h3>
              <ul className="ds-linklist">
                {p.retiring.map((x) => (
                  <li key={x.changeId} data-publish-retire={x.refId}>
                    <Link to={changePath(x.changeId)}>{x.changeId}</Link> {`${x.refId} ${x.nameKo ?? ''} ${PB.becomes(STATUS_KO.RETIRED)} · ${x.reason}`}
                  </li>
                ))}
              </ul>
              <p className="ds-field__hint">{PB.notify}</p>
              {p.notify.length ? (
                <ul className="ds-linklist">
                  {p.notify.map((f) => (
                    <li key={`${f.featureId}@${f.version}`} data-publish-notify={f.featureId}>
                      {`${f.featureId} ${f.version} ${f.name ?? ''} · ${personName(f.ownerId)}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ds-field__hint">{PB.notifyNone}</p>
              )}
            </section>
          )}
          <SummaryLine label={PB.quality} items={qKeys.map((k) => ({ k: QK[k], v: PB.arrow(p.quality.before[k], p.quality.after[k]) }))} />
        </div>
      )}
      <Field label={PB.memo} hint={PB.memoHint}>
        <input
          className="ds-input"
          name="releaseNote"
          value={note}
          onChange={(e) => {
            setTouched(true);
            setNote(e.target.value);
          }}
        />
      </Field>
      <ErrorNote error={publish.error ?? preview.error} />
      {done && <p role="status">{T.published(done)}</p>}
      <Button
        variant="primary"
        data-ui="publishRefRelease"
        disabled={!!why || publish.isPending}
        reason={why}
        onClick={() =>
          publish.mutate(
            { body: { changeIds: [], note: note.trim() } },
            { onSuccess: (res) => (setDone(typeof res.release === 'string' ? res.release : (res.release?.release ?? '')), setNote(''), setTouched(false)) },
          )
        }
      >
        {p ? PB.button(p.release, n) : T.publishBtn(n)}
      </Button>
    </Panel>
  );
}

// ── 변경 요청 상세 ──────────────────────────────────────────────

const fieldLabel = (k: string) => (RD.f as Record<string, string>)[k] ?? (k === 'aliases' ? RD.aliases : k === 'definition' ? RD.definition : k);

const blank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** 필드 차이 줄 — 추가 요청(전 값 없음)은 채운 칸만, 기준 행 ID는 머리에 따로 보이므로 뺀다 */
export function diffRows(c: Pick<RefChange, 'before' | 'after'>) {
  const before = (c.before ?? {}) as Record<string, unknown>;
  const after = c.after as Record<string, unknown>;
  return Object.keys(after)
    .filter((k) => k !== 'refId' && !(blank(after[k]) && blank(before[k])))
    .map((k) => ({ field: fieldLabel(k), before: before[k] ?? null, after: after[k] ?? null }));
}

export function RefChangeDetailScreen() {
  const { id = '' } = useParams();
  const q = useApi<RefChangeDetailResponse>('refChangeDetail', { params: { id } });
  const c = q.data?.change;
  // 영향 — 서버 impact.features(이름·담당 포함), 없으면 연결 색인(usedBy)
  const usedBy = q.data?.impact?.features ?? q.data?.usedBy ?? [];
  const recalc = q.data?.impact ? q.data.impact.recalcRequired : c && c.kind !== 'ADD' && ('asilRep' in c.after || 'tshirt' in c.after);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE DB · CR"
        title={c ? D.title(KIND_LABEL[c.kind] ?? c.kind, c.refId) : id}
        meta={<IdChip id={id} />}
        message={c ? { tone: 'neutral', value: c.reviews.length, text: D.key, status: { label: CHANGE_STATUS_LABEL[c.status] ?? c.status, tone: c.status === 'REJECTED' ? 'danger' : c.status === 'PUBLISHED' ? 'ok' : 'warn' } } : { tone: 'neutral', text: T.title }}
        actions={<TextLink to="/master/feature-db/changes">{D.back}</TextLink>}
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {c && (
          <div className="ds-split ds-split--wide-side">
            <div className="ds-stack">
              <Panel title={D.diff} id="cr-diff">
                <KeyValue
                  rows={[
                    { k: RD.f.refId, v: <RefChip id={c.refId} /> },
                    { k: D.reason, v: c.reason || '—' },
                    { k: D.meta.by, v: <span title={c.requestedBy}>{personName(c.requestedBy)}</span> },
                    { k: D.meta.at, v: when(c.requestedAt) },
                    ...(c.release ? [{ k: D.meta.release, v: <span className="ds-mono">{c.release}</span> }] : []),
                    ...(c.decision ? [{ k: D.meta.decision, v: D.decisionText(D.decision[c.decision.decision] ?? c.decision.decision, personName(c.decision.decidedBy), c.decision.reason) }, { k: AU.decidedAt, v: when(c.decision.at) }] : []),
                  ]}
                />
                <DiffView rows={diffRows(c)} />
              </Panel>
              <Panel title={D.checks} id="cr-checks">
                <Checks checks={q.data?.checks?.length ? q.data.checks : (c.checks ?? [])} />
              </Panel>
              <Panel title={D.impact} id="cr-impact" eyebrow={String(usedBy.length)}>
                {recalc && <p className="ds-field__hint" data-recalc>{D.recalc}</p>}
                {usedBy.length ? <UsageTable rows={usedBy} caption={D.impact} /> : <p className="ds-field__hint">{D.impactNone}</p>}
              </Panel>
              <AuditTrail changeId={c.changeId} />
            </div>
            <div className="ds-stack">
              <Reviews c={c} />
              <ReviewForm c={c} />
              <DecideForm c={c} />
            </div>
          </div>
        )}
      </AsyncView>
    </div>
  );
}

function Reviews({ c }: { c: RefChange }) {
  return (
    <Panel title={D.reviews} id="cr-reviews" eyebrow={String(c.reviews.length)}>
      <p className="ds-field__hint">{D.roleNote}</p>
      {c.reviews.length ? (
        <ul className="ds-check">
          {c.reviews.map((r, i) => (
            <li key={`${r.reviewerId}-${i}`} data-state={r.opinion === 'AGREE' ? 'PASS' : r.opinion === 'OPPOSE' ? 'FAIL' : 'INFO'} data-opinion={r.opinion}>
              <span className="ds-mono">{OPINION_LABEL[r.opinion]}</span>
              <span>
                {r.comment}
                <span className="ds-check__detail">{`${r.reviewerId} · ${when(r.at)}`}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-field__hint">{D.reviewsNone}</p>
      )}
    </Panel>
  );
}

function ReviewForm({ c }: { c: RefChange }) {
  const { role } = useAppShell();
  const perm = usePermission(['DOMAIN_REVIEWER']);
  const review = useApiMutation('reviewRefChange', ['refChangeDetail', 'listRefChanges']);
  const [opinion, setOpinion] = useState<RefReviewOpinion>('AGREE');
  const [comment, setComment] = useState('');
  // 도메인 검토자 역할만 이 칸을 본다
  if (!canAct(role, ['DOMAIN_REVIEWER'])) return null;
  const me = myActorId(role);
  const why = whyDisabled(
    [!perm.ok, perm.hint],
    [!OPEN.includes(c.status), D.why.closed],
    [refChangeDutyBlocker(c, me, 'REVIEW'), refChangeDutyBlocker(c, me, 'REVIEW')],
    [c.reviews.some((r) => r.reviewerId === me), D.why.reviewed],
    [comment.trim().length < 2, D.why.comment],
  );
  return (
    <Panel title={D.review} id="cr-review">
      <Segmented<RefReviewOpinion> label={D.opinion} value={opinion} onChange={setOpinion} options={(['AGREE', 'REVISE', 'OPPOSE'] as const).map((o) => ({ value: o, label: OPINION_LABEL[o] }))} />
      <Field label={D.comment}>
        <textarea className="ds-input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <ErrorNote error={review.error} />
      <Button variant="primary" disabled={!!why || review.isPending} reason={why} onClick={() => review.mutate({ params: { id: c.changeId }, body: { opinion, comment: comment.trim() } }, { onSuccess: () => setComment('') })}>
        {D.submitReview}
      </Button>
    </Panel>
  );
}

function DecideForm({ c }: { c: RefChange }) {
  const { role } = useAppShell();
  const perm = usePermission(['REFDB_ADMIN']);
  const decide = useApiMutation('decideRefChange', ['refChangeDetail', 'listRefChanges', 'refQuality']);
  const [reason, setReason] = useState('');
  // Feature DB 관리자만 이 칸을 본다
  if (!canAct(role, ['REFDB_ADMIN'])) return null;
  const me = myActorId(role);
  const duty = refChangeDutyBlocker(c, me, 'DECIDE');
  const blocking = (c.checks ?? []).some((x) => !x.ok && x.blocking);
  // 마지막 도메인 검토 의견이 보완·반대면 승인하지 못한다(사용자 결정 2026-11-04) — 보완 뒤 다시 검토를 받는다. 반려는 된다
  const last = c.reviews.at(-1);
  const notAgreed = !!last && last.opinion !== 'AGREE';
  const common: [unknown, string | undefined][] = [
    [!perm.ok, perm.hint],
    [!OPEN.includes(c.status), D.why.closed],
    [duty, duty ?? undefined],
  ];
  const whyApprove = whyDisabled(...common, [blocking, D.why.blocking], [c.reviews.length === 0, D.why.noReview], [notAgreed, D.why.lastOpinion(OPINION_LABEL[last?.opinion ?? 'AGREE'])], [reason.trim().length < 2, D.why.reason]);
  const whyReject = whyDisabled(...common, [reason.trim().length < 2, D.why.reason]);
  const send = (decision: 'APPROVE' | 'REJECT') => decide.mutate({ params: { id: c.changeId }, body: { decision, reason: reason.trim() } }, { onSuccess: () => setReason('') });
  return (
    <Panel title={D.decide} id="cr-decide">
      <Field label={D.decideReason}>
        <textarea className="ds-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorNote error={decide.error} />
      <div className="ds-toolbar">
        <Button variant="primary" disabled={!!whyApprove || decide.isPending} reason={whyApprove} onClick={() => send('APPROVE')}>
          {D.approve}
        </Button>
        <Button variant="danger" disabled={!!whyReject || decide.isPending} reason={whyReject} onClick={() => send('REJECT')}>
          {D.reject}
        </Button>
      </div>
    </Panel>
  );
}

/** 변경 요청 감사 이력 응답(refChangeAudit) */
interface ChangeAudit {
  items: { id: number; at: string; actorId: string; actorRole: string; action: string; stage: string | null; target: string; result: 'ALLOWED' | 'DENIED' | 'FAILED'; reason: string | null }[];
  decision: { decision: string; decidedBy: string; at: string } | null;
  release: { release: string; publishedBy: string; publishedAt: string; note: string | null } | null;
}

/** 감사 이력 — 요청·검토·결정·발행을 한 줄씩(감사 화면을 세 번 검색하지 않게, P5-6). 결정 시각·발행자 요약 */
function AuditTrail({ changeId }: { changeId: string }) {
  const q = useApi<ChangeAudit>('refChangeAudit', { params: { id: changeId } });
  const d = q.data && Array.isArray(q.data.items) ? q.data : undefined;
  return (
    <Panel title={AU.title} id="cr-audit" eyebrow={d ? String(d.items.length) : undefined} actions={<Link to={`/audit?prefix=${encodeURIComponent(changeId)}`}>{AU.toAudit} →</Link>}>
      <AsyncView state={asyncState(q, !d || !d.items.length)} error={q.error} onRetry={() => q.refetch()} empty={{ title: AU.none, body: '' }} rows={3}>
        {d && (
          <>
            {d.release && (
              <KeyValue
                rows={[
                  { k: AU.publisher, v: <span title={d.release.publishedBy}>{`${personName(d.release.publishedBy)} · ${d.release.release}`}</span> },
                  { k: AU.publishedAt, v: when(d.release.publishedAt) },
                  ...(d.release.note ? [{ k: AU.releaseNote, v: d.release.note }] : []),
                ]}
              />
            )}
            <ol className="ds-check" data-testid="cr-audit-trail">
              {d.items.map((e) => (
                <li key={e.id} style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }} data-stage={e.stage ?? ''} data-state={e.result === 'ALLOWED' ? 'PASS' : 'FAIL'} data-action={e.action}>
                  <span className="ds-mono ds-nowrap">{when(e.at)}</span>
                  <span>
                    <strong>{e.stage ? AU.stage[e.stage] : (ko.audit.results[e.result] ?? e.result)}</strong> <span title={e.action}>{auditActionKo(e.action) ?? e.action}</span>
                    {e.result !== 'ALLOWED' && <> · {ko.audit.results[e.result]}</>}
                    <span className="ds-check__detail">{[personName(e.actorId), e.reason].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </AsyncView>
    </Panel>
  );
}
