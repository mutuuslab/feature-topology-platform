// /master/feature-db?tab=sources — Feature DB 출처와 정기 점검(30-95 §8.5, 업무 절차 FPW.14 정기 점검).
// 다음 점검일이 지난 출처는 '점검 기한 지남'으로 앞에 두고, Feature DB 관리자는 점검한 출처를 골라 확인일·다음 점검일을 기록한다
// (POST recordSourceReview — 기한 알림이 닫힌다). 알림의 링크(?tab=sources&source=S##)는 그 출처를 미리 골라 둔다.
// 보강(W5 P5-5): 다음 점검일이 없는 출처는 기한 알림에 걸리지 않으므로 경고하고 앞에 둔다, 점검 결과(변경 없음·개정 있음)를 고른다,
// 개정 있음이면 그 출처를 쓰는 행 목록(/master/feature-db?source=S##)으로 '영향 행 변경 요청 만들기'를 잇는다.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RefSource, SourceReviewResult } from '@ff/contracts';
import { canAct } from '../../api/actor';
import { fieldErrors } from '../../api/field-errors';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { refSources as T, refSourceReview as SR } from '../../copy/refdb';
import { AsyncView, Button, DataTable, ErrorNote, Field, Segmented, whyDisabled } from '../../design';
import { useAppShell } from '../../store';
import { usePermission } from '../shared';

const today = () => new Date().toISOString().slice(0, 10);
/** 기본 다음 점검일 — 확인일에서 1년 뒤(엑셀 15_DB운영 5절 연 1회) */
export const nextYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
/** 점검 기한이 지났다 — 다음 점검일이 오늘보다 앞(오늘이 기한이면 아직 아니다) */
export const reviewDue = (s: Pick<RefSource, 'nextReviewAt'>, on = today()) => !!s.nextReviewAt && s.nextReviewAt < on;
/** 다음 점검일 없음 — 기한 알림이 걸리지 않는다(종료 기준이 공허하게 통과하던 것, P5-5) */
export const reviewUnset = (s: Pick<RefSource, 'nextReviewAt'>) => !s.nextReviewAt;

type SourceRow = RefSource & { usedBy?: number };
type RecordResult = { items: RefSource[]; affected?: { sourceId: string; refIds: string[] }[] };

export function SourcesPanel() {
  const { role } = useAppShell();
  const [sp] = useSearchParams();
  const q = useApi<{ items: SourceRow[]; noNextReview?: number }>('refSources');
  const on = today();
  // 기한 지난 출처 먼저, 다음 점검일 없는 출처, 그다음 다음 점검일 순
  const rank = (s: SourceRow) => (reviewDue(s, on) ? 0 : reviewUnset(s) ? 1 : 2);
  const rows = useMemo(() => [...(q.data?.items ?? [])].sort((a, b) => rank(a) - rank(b) || (a.nextReviewAt ?? '9999').localeCompare(b.nextReviewAt ?? '9999') || a.sourceId.localeCompare(b.sourceId)), [q.data, on]);
  const due = rows.filter((s) => reviewDue(s, on)).length;
  const unset = q.data?.noNextReview ?? rows.filter(reviewUnset).length;
  const admin = canAct(role, ['REFDB_ADMIN']);
  const focus = sp.get('source');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="ds-stack" data-testid="ref-sources">
      <p className="ds-field__hint" data-due={due}>
        {q.data ? (due ? T.dueSome(due) : T.dueNone) : ''}
      </p>
      {q.data && unset > 0 && (
        <p className="ds-callout" data-tone="warn" role="status" data-no-next-review={unset}>
          {SR.noNext(unset)}
        </p>
      )}
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: T.empty }} error={q.error} onRetry={() => q.refetch()}>
        <DataTable<SourceRow>
          caption={T.caption}
          rows={rows}
          rowKey={(s) => s.sourceId}
          pageSize={0}
          maxHeight="52vh"
          columns={[
            ...(admin
              ? [
                  {
                    key: 'pick',
                    header: T.col.pick,
                    cell: (s: SourceRow) => (
                      <label className="ds-pick">
                        <input type="checkbox" checked={picked.has(s.sourceId)} onChange={() => toggle(s.sourceId)} aria-label={T.pickLabel(s.sourceId)} />
                      </label>
                    ),
                  },
                ]
              : []),
            { key: 'id', header: T.col.id, cell: (s) => <span className="ds-mono" data-source-row={s.sourceId} data-focus={focus === s.sourceId ? '' : undefined}>{s.sourceId}</span>, sort: (s) => s.sourceId },
            {
              key: 't',
              header: T.col.title,
              cell: (s) => (
                <span className="ds-stack">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    <span>{s.title}</span>
                  )}
                  <span className="ds-field__hint">{[s.publisher, s.version, s.usedBy ? SR.used(s.usedBy) : ''].filter(Boolean).join(' · ')}</span>
                </span>
              ),
            },
            { key: 'c', header: T.col.checked, cell: (s) => <span className="ds-date">{s.checkedAt ?? '—'}</span>, sort: (s) => s.checkedAt ?? '' },
            {
              key: 'n',
              header: T.col.next,
              cell: (s) => (
                <span className="ds-stack">
                  <span className="ds-date">{s.nextReviewAt ?? '—'}</span>
                  {reviewDue(s, on) && (
                    <span className="ds-tag ds-tag--warn" data-review-due={s.sourceId}>
                      {T.due}
                    </span>
                  )}
                  {reviewUnset(s) && (
                    <span className="ds-tag ds-tag--warn" data-review-unset={s.sourceId}>
                      {SR.noNextTag}
                    </span>
                  )}
                </span>
              ),
              sort: (s) => s.nextReviewAt ?? '',
            },
          ]}
        />
      </AsyncView>
      {admin && <RecordReview picked={[...picked]} onDone={() => setPicked(new Set())} />}
    </div>
  );
}

/** 점검 기록 — 고른 출처의 확인일(비우면 오늘)·다음 점검일·점검 메모. Feature DB 관리자만 보이고, 공개 데모는 이유와 함께 막힌다 */
function RecordReview({ picked, onDone }: { picked: string[]; onDone: () => void }) {
  const perm = usePermission(['REFDB_ADMIN']);
  const record = useApiMutation<RecordResult>('recordSourceReview', ['refSources', 'refQuality', 'notifications', 'audit']);
  const [checkedAt, setCheckedAt] = useState('');
  const [next, setNext] = useState(() => nextYear(today()));
  const [note, setNote] = useState('');
  const [result, setResult] = useState<SourceReviewResult>('NO_CHANGE');
  const [done, setDone] = useState<number | null>(null);
  const [affected, setAffected] = useState<{ sourceId: string; refIds: string[] }[]>([]);
  const base = checkedAt || today();
  const fe = fieldErrors(record.error);
  const why = whyDisabled([!perm.ok, perm.hint], [picked.length === 0, T.why.pick], [!next || next <= base, T.why.next], [note.trim().length < 2, T.why.note]);
  return (
    <section className="ds-callout" aria-labelledby="ref-review-h" data-testid="ref-source-review">
      <h3 id="ref-review-h" className="ds-callout__title">
        {T.record}
      </h3>
      <p className="ds-field__hint">{T.recordHint(picked.length)}</p>
      <div className="ds-form-grid">
        <Field label={T.checkedAt} hint={T.checkedAtHint} error={fe.checkedAt}>
          <input className="ds-input ds-input--mono" type="date" name="checkedAt" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />
        </Field>
        <Field label={T.nextReviewAt} error={fe.nextReviewAt}>
          <input className="ds-input ds-input--mono" type="date" name="nextReviewAt" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <Segmented<SourceReviewResult> label={SR.result} value={result} onChange={setResult} options={(['NO_CHANGE', 'REVISED'] as const).map((v) => ({ value: v, label: SR.results[v] }))} />
      <Field label={T.note} error={fe.note}>
        <textarea className="ds-input" name="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorNote error={record.error} />
      {done != null && <p role="status">{T.recorded(done)}</p>}
      {affected.filter((a) => a.refIds.length).map((a) => (
        <p key={a.sourceId} className="ds-callout" data-tone="warn" data-affected={a.sourceId}>
          {SR.affected(a.sourceId, a.refIds.length)} <Link to={`/master/feature-db?source=${encodeURIComponent(a.sourceId)}`}>{SR.makeChange} →</Link>
        </p>
      ))}
      <div>
        <Button
          variant="primary"
          data-ui="recordSourceReview"
          disabled={!!why || record.isPending}
          reason={why}
          onClick={() =>
            record.mutate(
              { body: { sourceIds: picked, ...(checkedAt ? { checkedAt } : {}), nextReviewAt: next, note: note.trim(), result } },
              { onSuccess: (r) => (setDone(r.items?.length ?? picked.length), setAffected(r.affected ?? []), setNote(''), setResult('NO_CHANGE'), onDone()) },
            )
          }
        >
          {T.submit}
        </Button>
      </div>
    </section>
  );
}
