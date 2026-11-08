// 검토 포털 협의 요청(W5, 담당자 개선 P5-1·P5-12) — 다른 부서가 구매·법무·개인정보보호에 의견을 구한 건.
//  · ConsultInbox: 포털 홈 요청함 — 한 줄 요약·요청 부서·기한(남은 날)·상태. 건을 누르면 '검토할 것 한 장'(흐름도 대신).
//  · ConsultScreen(/consults/:id): 대상·살펴볼 것·기한 한 장 + 동의·보완·반대 의견과 메모(받은 부서만, 요청자 본인 불가).
//  · SentConsults: 요청 부서 홈 — 보낸 협의와 받은 의견(의견을 남기면 여기에 바로 보인다).
// 화면 글자에 절차 코드·Gate·SLA 같은 전문용어를 쓰지 않는다(근거 활동은 이름만).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ROUTES as API_ROUTES, type ConsultOpinion, type Consultation } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { myActorId } from '../refdb/common';
import { consult as C } from '../../copy/consult';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, Field, KeyValue, PageHeader, Panel, Segmented, whyDisabled } from '../../design';
import { useAppShell } from '../../store';
import { personName, personOf } from '../../data/people';
import { usePermission, when } from '../shared';
import './consults.css';

export type ConsultView = Consultation & { toName: string; fromName: string; daysLeft: number; activityName: string | null };
export interface ConsultList {
  items: ConsultView[];
  total: number;
  open: number;
  overdue: number;
}

export const consultPath = (id: string) => `/consults/${encodeURIComponent(id)}`;
const ANSWER_ROLES = API_ROUTES.find((r) => r.name === 'answerConsultation')?.roles ?? [];

/** 기한 표시 — 남은 날, 지났으면 경고 */
export function DueTag({ c }: { c: Pick<ConsultView, 'daysLeft' | 'dueAt' | 'status'> }) {
  const late = c.status === 'OPEN' && c.daysLeft < 0;
  return (
    <span className="cs-due" data-late={late ? '' : undefined} title={c.dueAt}>
      <span className="ds-date">{c.dueAt}</span>
      {c.status === 'OPEN' && <span className={`ds-tag${late ? ' ds-tag--warn' : ''}`}>{C.due(c.daysLeft)}</span>}
    </span>
  );
}

/** 상태·마지막 의견 */
export function ConsultState({ c }: { c: Pick<ConsultView, 'status' | 'opinions'> }) {
  const last = c.opinions.at(-1);
  if (c.status === 'OPEN' || !last) return <span className="ds-tag">{C.status.OPEN}</span>;
  return (
    <span className="cs-opinion" data-opinion={last.opinion}>
      {C.opinion[last.opinion]}
    </span>
  );
}

/** 포털 요청함 — 의견 대기 먼저, 기한 이른 순(서버 순서) */
export function ConsultInbox({ items, caption }: { items: ConsultView[]; caption: string }) {
  const nav = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc' | null>(null);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 600));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const ordered = order ? [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt) * (order === 'asc' ? 1 : -1)) : items;
  return (
    <div className="cs-inbox" ref={root}>
    {compact ? <>
      <div className="cs-inbox__tools">
        <Button variant="ghost" aria-label={`${C.col.due} ${order === 'asc' ? ko.action.sortDesc : ko.action.sortAsc}`} onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>
          {C.col.due} <span aria-hidden>{order === 'asc' ? '▲' : order === 'desc' ? '▼' : '↕'}</span>
        </Button>
      </div>
      <ul className="cs-cards" aria-label={caption}>
        {ordered.map((c) => <li key={c.consultId} data-consult={c.consultId}>
          <Link to={consultPath(c.consultId)} className="cs-summary">{c.summary}</Link>
          <span className="ds-field__hint">{`${C.target[c.targetKind]} · ${c.targetName}`}</span>
          <dl className="cs-cards__meta">
            <div><dt>{C.col.from}</dt><dd>{c.fromName}</dd></div>
            <div><dt>{C.col.due}</dt><dd><DueTag c={c} /></dd></div>
            <div><dt>{C.col.status}</dt><dd><ConsultState c={c} /></dd></div>
          </dl>
        </li>)}
      </ul>
    </> : (
    <DataTable<ConsultView>
      caption={caption}
      rows={items}
      rowKey={(c) => c.consultId}
      pageSize={0}
      onOpen={(c) => nav(consultPath(c.consultId))}
      columns={[
        {
          key: 's',
          header: C.col.summary,
          cell: (c) => (
            <span className="ds-stack">
              <Link to={consultPath(c.consultId)} className="cs-summary" data-consult={c.consultId}>
                {c.summary}
              </Link>
              <span className="ds-field__hint">{`${C.target[c.targetKind]} · ${c.targetName}`}</span>
            </span>
          ),
        },
        { key: 'f', header: C.col.from, cell: (c) => c.fromName },
        { key: 'd', header: C.col.due, cell: (c) => <DueTag c={c} />, sort: (c) => c.dueAt },
        { key: 'st', header: C.col.status, cell: (c) => <ConsultState c={c} /> },
      ]}
    />
    )}
    </div>
  );
}

/** 요청 부서 홈 — 보낸 협의 요청과 받은 의견. 보낸 건이 없으면 그리지 않는다 */
export function SentConsults({ deptId, limit = 6 }: { deptId: string; limit?: number }) {
  const q = useApi<ConsultList>('listConsultations', { query: { from: deptId } });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  const S = C.sentPanel;
  return (
    <Panel title={S.title} id="ws-sent-consults" eyebrow={q.data ? String(q.data.open ? `${S.waiting} ${q.data.open}` : items.length) : undefined}>
      <p className="ds-field__hint">{S.lead}</p>
      <ul className="cs-sent" aria-label={S.caption}>
        {items.slice(0, limit).map((c) => {
          const last = c.opinions.at(-1);
          return (
            <li key={c.consultId} data-consult={c.consultId} data-status={c.status}>
              <Link to={consultPath(c.consultId)} className="cs-summary">
                {c.summary}
              </Link>
              <span className="cs-sent__meta">
                {c.toName} · <DueTag c={c} />
              </span>
              {last ? (
                <span className="cs-sent__answer">
                  <ConsultState c={c} /> {last.memo}
                </span>
              ) : (
                <span className="ds-field__hint">{C.status.OPEN}</span>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > limit && <p className="ds-field__hint">{S.more(items.length - limit)}</p>}
    </Panel>
  );
}

/** /consults/:id — 검토할 것 한 장 + 의견 남기기 */
export function ConsultScreen() {
  const { id = '' } = useParams();
  const q = useApi<{ consultation: ConsultView }>('consultationDetail', { params: { id } });
  const c = q.data?.consultation;
  const S = C.sheet;
  return (
    <div className="ds-screen cs-sheet" data-consult-sheet={id}>
      <PageHeader
        codes={S.title}
        title={c?.summary ?? S.title}
        message={c ? { tone: c.status === 'OPEN' && c.daysLeft < 0 ? 'warn' : 'neutral', value: c.status === 'OPEN' ? C.due(c.daysLeft) : undefined, text: `${c.fromName} → ${c.toName}`, status: { label: c.status === 'OPEN' ? C.status.OPEN : C.opinion[c.opinions.at(-1)!.opinion], tone: c.status === 'OPEN' ? 'warn' : 'ok' } } : { tone: 'neutral', text: S.title }}
        actions={
          <Link className="ds-btn" to="/">
            {S.back}
          </Link>
        }
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()} empty={{ title: S.notFound }}>
        {c && (
          <div className="ds-split ds-split--wide-side">
            <div className="ds-stack">
              <Panel title={S.look} id="cs-look">
                <ol className="cs-look">
                  {c.checks.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ol>
                <KeyValue
                  rows={[
                    { k: S.target, v: `${C.target[c.targetKind]} · ${c.targetName}` },
                    { k: S.from, v: c.fromName },
                    // 데모 시드의 포털 요청자처럼 데모 계정이 아니면 부서 이름으로
                    { k: S.by, v: personOf(c.requestedBy).known ? personName(c.requestedBy) : C.sheet.byDept(c.fromName) },
                    { k: S.asked, v: when(c.requestedAt) },
                    { k: S.due, v: <DueTag c={c} /> },
                    ...(c.activityName ? [{ k: S.work, v: c.activityName }] : []),
                  ]}
                />
                {c.link && (
                  <p>
                    <Link to={c.link} data-consult-target>
                      {S.open} →
                    </Link>
                  </p>
                )}
              </Panel>
              <Panel title={S.history} id="cs-history" eyebrow={String(c.opinions.length)}>
                {c.opinions.length ? (
                  <ul className="ds-check">
                    {[...c.opinions].reverse().map((o, i) => (
                      <li key={`${o.at}-${i}`} style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }} data-state={o.opinion === 'AGREE' ? 'PASS' : o.opinion === 'OPPOSE' ? 'FAIL' : 'INFO'} data-opinion={o.opinion}>
                        <span className="cs-opinion" data-opinion={o.opinion}>
                          {C.opinion[o.opinion]}
                        </span>
                        <span>
                          {o.memo}
                          <span className="ds-check__detail">{`${personName(o.by)} · ${when(o.at)}`}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ds-field__hint">{S.historyNone}</p>
                )}
              </Panel>
            </div>
            <OpinionForm c={c} />
          </div>
        )}
      </AsyncView>
    </div>
  );
}

function OpinionForm({ c }: { c: ConsultView }) {
  const { role, department } = useAppShell();
  const perm = usePermission(ANSWER_ROLES);
  const answer = useApiMutation<ConsultView>('answerConsultation', ['consultationDetail', 'listConsultations', 'audit']);
  const [opinion, setOpinion] = useState<ConsultOpinion>('AGREE');
  const [memo, setMemo] = useState('');
  const [sent, setSent] = useState(false);
  const F = C.form;
  const why = whyDisabled([!perm.ok, perm.hint], [department !== c.toDept, F.why.dept], [myActorId(role) === c.requestedBy, F.why.self], [memo.trim().length < 2, F.why.memo]);
  return (
    <Panel title={F.title} id="cs-form">
      {c.opinions.length > 0 && <p className="ds-field__hint">{F.again}</p>}
      <Segmented<ConsultOpinion> label={F.choice} value={opinion} onChange={setOpinion} options={(['AGREE', 'REVISE', 'OPPOSE'] as const).map((o) => ({ value: o, label: C.opinion[o] }))} />
      <Field label={F.memo} hint={F.memoHint}>
        <textarea className="ds-input" name="memo" rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <ErrorNote error={answer.error} />
      {sent && <p role="status">{F.sent}</p>}
      <Button
        variant="primary"
        data-ui="answerConsultation"
        disabled={!!why || answer.isPending}
        reason={why}
        // 공유 포털 조회 계정은 검토 역할로 기록한다. 구매 겸직을 추가해도 협의 의견이 산정 역할로 남지 않게 한다.
        onClick={() => answer.mutate({ params: { id: c.consultId }, actorRole: role === 'viewer' ? 'AUDITOR' : undefined, body: { department, opinion, memo: memo.trim() } }, { onSuccess: () => (setSent(true), setMemo('')) })}
      >
        {F.submit}
      </Button>
    </Panel>
  );
}
