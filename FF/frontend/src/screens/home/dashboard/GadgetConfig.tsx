// 가젯 구성 양식 — Jira처럼 가젯 안에서 연다(추가하면 바로, 메뉴의 '구성'으로 다시). 저장하면 보기 상태가 된다.
// 종류마다: 필터 결과(원천·상태·나만·열·행·정렬), 원형(원천·기준), 2차원(원천·행·열 기준), 생성 대 해결(원천·기간), 목록 행 수.
// 모든 가젯: 제목·자동 새로 고침(끔·1·5·15분). 필요할 때만 읽는 묶음.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { dashboard } from '../../../copy/dashboard';
import { typeDef, typeTitle } from './catalog';
import { REFRESH_OPTIONS, type Gadget, type GadgetConfig, type Refresh } from './layout';
import { sourceOf, statusLabel, type FieldKey, type SourceId } from './sources';

const B = dashboard.board;
const C = B.config;
const F = B.fields;

const LIST_SOURCES: SourceId[] = ['features', 'policies', 'myReviews', 'kills', 'anomalies', 'audit'];
const STAT_SOURCES: SourceId[] = ['features', 'policies', 'myReviews', 'kills', 'anomalies', 'audit'];
const TREND_SOURCES = ['anomalies', 'reviews'] as const;
const ROWS = [5, 10, 20];

function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="jd-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p className="jd-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** 원천을 바꾸면 그 원천에 없는 열·기준·상태를 맞춘다 */
function fitToSource(type: string, c: GadgetConfig): GadgetConfig {
  if (type === 'createdResolved') return c;
  const src = sourceOf(c.source);
  const next: GadgetConfig = { ...c, source: src.id };
  if (!src.statuses.includes(String(next.status ?? '')) && next.status !== 'open') next.status = '';
  if (!src.mineFilter) next.mine = false;
  if (type === 'filter') {
    const cols = (Array.isArray(next.columns) ? (next.columns as string[]) : []).filter((k) => src.columns.includes(k as FieldKey));
    next.columns = cols.length ? cols : src.columns.slice(0, 2);
    if (next.sort !== 'key' && !src.columns.includes(next.sort as FieldKey)) next.sort = 'key';
  }
  if (type === 'pie' && !src.groups.includes(next.groupBy as FieldKey)) next.groupBy = src.groups[0];
  if (type === 'twoD') {
    if (!src.groups.includes(next.y as FieldKey)) next.y = src.groups[0];
    if (!src.groups.includes(next.x as FieldKey) || next.x === next.y) next.x = src.groups.find((g) => g !== next.y) ?? src.groups[0];
  }
  return next;
}

export default function GadgetConfigForm({ gadget, isNew, onSave, onCancel }: { gadget: Gadget; isNew: boolean; onSave: (c: GadgetConfig, r: Refresh) => void; onCancel: () => void }) {
  const id = useId();
  const type = gadget.type;
  const [c, setC] = useState<GadgetConfig>(() => fitToSource(type, { ...(typeDef(type)?.defaults ?? {}), ...gadget.config }));
  const [refresh, setRefresh] = useState<Refresh>(gadget.refresh);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement & HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const set = (k: string, v: GadgetConfig[string]) => {
    setError(null);
    setC((x) => (k === 'source' ? fitToSource(type, { ...x, source: v }) : { ...x, [k]: v }));
  };
  const src = sourceOf(c.source);
  const f = (k: string) => `${id}-${k}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (type === 'filter' && !(Array.isArray(c.columns) && c.columns.length)) return setError(C.needColumn);
    if (type === 'twoD' && c.x === c.y) return setError(C.sameAxis);
    onSave(c, refresh);
  };

  const select = (k: string, label: string, options: { value: string; label: string }[], value: string, isFirst = false) => (
    <Field label={label} id={f(k)}>
      <select id={f(k)} className="jd-select" value={value} ref={isFirst ? first : undefined} onChange={(e) => set(k, k === 'rows' || k === 'days' ? Number(e.target.value) : e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const sourceSelect = (list: readonly string[]) =>
    select(
      'source',
      C.source,
      list.map((s) => ({ value: s, label: (B.sources as Record<string, string>)[s] })),
      String(c.source ?? list[0]),
      true,
    );
  const groupOptions = src.groups.map((g) => ({ value: g, label: F[g] }));

  return (
    <form className="jd-config" onSubmit={submit} aria-label={C.heading(typeTitle(type))} noValidate>
      {type === 'filter' && (
        <>
          {sourceSelect(LIST_SOURCES)}
          {src.statuses.length > 0 && select('status', C.status, [{ value: '', label: C.anyStatus }, ...src.statuses.map((s) => ({ value: s, label: statusLabel(s) }))], String(c.status ?? ''))}
          {src.mineFilter && (
            <div className="jd-field jd-field--check">
              <input type="checkbox" id={f('mine')} checked={!!c.mine} onChange={(e) => set('mine', e.target.checked)} aria-describedby={`${f('mine')}-hint`} />
              <label htmlFor={f('mine')}>{C.mine}</label>
              <p className="jd-field__hint" id={`${f('mine')}-hint`}>
                {C.mineHint}
              </p>
            </div>
          )}
          <fieldset className="jd-field jd-fieldset">
            <legend>{C.columns}</legend>
            <div className="jd-checks">
              {src.columns.map((k) => {
                const on = Array.isArray(c.columns) && (c.columns as string[]).includes(k);
                return (
                  <label key={k} className="jd-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const cur = Array.isArray(c.columns) ? (c.columns as string[]) : [];
                        // 고른 순서가 아니라 원천의 열 순서로 둔다(표가 늘 같은 모양)
                        set('columns', src.columns.filter((x) => (x === k ? !on : cur.includes(x))));
                      }}
                    />
                    {F[k]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {select('rows', C.rows, ROWS.map((n) => ({ value: String(n), label: String(n) })), String(c.rows ?? 10))}
          {select('sort', C.sort, [{ value: 'key', label: F.key }, ...src.columns.map((k) => ({ value: k, label: F[k] }))], String(c.sort ?? 'key'))}
          {select('order', C.orderLabel, (['asc', 'desc'] as const).map((o) => ({ value: o, label: C.order[o] })), String(c.order ?? 'asc'))}
        </>
      )}
      {type === 'pie' && (
        <>
          {sourceSelect(STAT_SOURCES)}
          {select('groupBy', C.groupBy, groupOptions, String(c.groupBy))}
        </>
      )}
      {type === 'twoD' && (
        <>
          {sourceSelect(STAT_SOURCES)}
          {select('y', C.y, groupOptions, String(c.y))}
          {select('x', C.x, groupOptions, String(c.x))}
        </>
      )}
      {type === 'createdResolved' && (
        <>
          {sourceSelect(TREND_SOURCES)}
          {select('days', C.days, [7, 30, 90].map((n) => ({ value: String(n), label: C.daysOpt(n) })), String(c.days ?? 30))}
        </>
      )}
      {(type === 'assigned' || type === 'activity') && select('rows', C.rows, ROWS.map((n) => ({ value: String(n), label: String(n) })), String(c.rows ?? 10), true)}
      <Field label={C.title} hint={C.titleHint} id={f('title')}>
        <input
          id={f('title')}
          className="jd-input"
          value={String(c.title ?? '')}
          maxLength={80}
          ref={['filter', 'pie', 'twoD', 'createdResolved', 'assigned', 'activity'].includes(type) ? undefined : first}
          aria-describedby={`${f('title')}-hint`}
          onChange={(e) => set('title', e.target.value)}
        />
      </Field>
      <Field label={C.refresh} id={f('refresh')}>
        <select id={f('refresh')} className="jd-select" value={refresh} onChange={(e) => setRefresh(Number(e.target.value) as Refresh)}>
          {REFRESH_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {C.refreshOpt(n)}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p className="jd-field__error" role="alert">
          {error}
        </p>
      )}
      <div className="jd-config__actions">
        <button type="submit" className="jd-btn jd-btn--primary">
          {C.save}
        </button>
        <button type="button" className="jd-btn jd-btn--subtle" onClick={onCancel}>
          {isNew ? C.cancelNew : C.cancel}
        </button>
      </div>
    </form>
  );
}

