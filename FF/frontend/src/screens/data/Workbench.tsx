import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { actorFor, rolesFor } from '../../api/actor';
import { ApiError, call, pathOf, STATIC_MODE } from '../../api/client';
import { workbench as T } from '../../copy/workbench';
import { AsyncView, ErrorNote, Icon, PageHeader } from '../../design';
import { useAppShell } from '../../store';
import { COST_MONEY } from '../cost/common';
import { conditionSummary, filterRows, normalizePage, sourceRoute, SOURCES, validView, type CellValue, type Column, type Filter, type Operator, type QueryHistory, type SavedView, type SourceKey, type ViewConfig } from './workbench-data';
import './workbench.css';

const PAGE_SIZE = 50;
const IDENTIFIERS = new Set(['flagKey', 'featureId', 'version', 'policyId', 'refId', 'vin', 'publicationId', 'estId', 'basis']);
interface LocalQueries { owner: string; saved: SavedView[]; history: QueryHistory[]; unavailable: boolean }
const emptyLocal = (owner: string): LocalQueries => ({ owner, saved: [], history: [], unavailable: false });
export const queryStorageKey = (actorId: string, role: string) => 'ff.workbench.queries.v1:' + encodeURIComponent(actorId) + ':' + role;
function readLocal(owner: string): LocalQueries {
  try {
    const value = JSON.parse(localStorage.getItem(owner) ?? '{}');
    return { owner, saved: Array.isArray(value.saved) ? value.saved.filter((entry: unknown) => validView(entry) && typeof (entry as SavedView).id === 'string' && typeof (entry as SavedView).name === 'string').slice(0, 20) : [], history: Array.isArray(value.history) ? value.history.filter((entry: unknown) => validView(entry) && typeof (entry as QueryHistory).id === 'string' && typeof (entry as QueryHistory).at === 'string' && ['SUCCESS', 'ERROR', 'FORBIDDEN'].includes((entry as QueryHistory).result)).slice(0, 30) : [], unavailable: false };
  } catch { return { ...emptyLocal(owner), unavailable: true }; }
}
const date = (value: string | number) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
function cell(value: CellValue | undefined, column?: Column) {
  if (value === null || value === undefined || value === '') return T.emptyCell;
  if (typeof value === 'number') return value.toLocaleString('ko-KR', { maximumFractionDigits: column?.kind === 'money' ? 0 : 6 });
  return column?.kind === 'date' && Number.isFinite(Date.parse(String(value))) ? date(String(value)) : String(value);
}

export default function Workbench() {
  const { role } = useAppShell();
  const actorId = actorFor(role).id;
  const owner = queryStorageKey(actorId, role);
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const [source, setSource] = useState<SourceKey>('flags');
  const [draft, setDraft] = useState<Filter[]>([]);
  const [applied, setApplied] = useState<Filter[]>([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<string[] | null>(null);
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [viewName, setViewName] = useState('');
  const [local, setLocal] = useState(() => readLocal(owner));
  const ownLocal = local.owner === owner ? local : emptyLocal(owner);
  useEffect(() => { setLocal(readLocal(owner)); setSelected(''); setPage(0); }, [owner]);
  const allowMoney = rolesFor(role).some((mine) => (COST_MONEY as readonly string[]).includes(mine));
  const query = useInfiniteQuery({
    queryKey: ['workbench', source, actorId, role, allowMoney],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const queryArgs = source === 'refs' ? { offset: pageParam || undefined, limit: STATIC_MODE ? 50 : 200 } : {};
      const body = await call(sourceRoute[source], { role, query: queryArgs, signal });
      return normalizePage(source, body, allowMoney);
    },
    getNextPageParam: (last) => STATIC_MODE ? undefined : last.nextOffset,
    retry: false,
    staleTime: 30_000,
  });
  // 실패한 이전 응답과 다른 계정의 응답은 표·상세에 보여 주지 않는다.
  const pages = query.isSuccess ? query.data.pages : [];
  const columns = pages[0]?.columns ?? [];
  const availableKeys = columns.map((column) => column.key);
  const currentKeys = visibleKeys === null ? availableKeys.slice(0, 7) : visibleKeys.filter((key) => availableKeys.includes(key));
  const visibleColumns = columns.filter((column) => currentKeys.includes(column.key));
  const rows = useMemo(() => [...new Map(pages.flatMap((part) => part.rows).map((row) => [row.id, row])).values()], [query.data, query.isSuccess]);
  const invalidFilters = applied.some((filter) => !availableKeys.includes(filter.field));
  const filtered = invalidFilters ? [] : filterRows(rows, applied, appliedSearch);
  const sorted = [...filtered].sort((a, b) => {
    const key = sort?.key ?? availableKeys[0]; const left = a.values[key]; const right = b.values[key];
    if (left === null || left === undefined) return right == null ? 0 : 1;
    if (right === null || right === undefined) return -1;
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'ko', { numeric: true });
    return sort?.desc ? -compared : compared;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const picked = rows.find((row) => row.id === selected);
  const total = pages.at(-1)?.total ?? 0;
  const partial = rows.length < total;
  const mixedReleases = new Set(pages.map((part) => part.release).filter(Boolean)).size > 1;
  const config: ViewConfig = { source, filters: draft, search, columns: currentKeys };
  const dirtyConditions = JSON.stringify(draft) !== JSON.stringify(applied) || search !== appliedSearch;
  const apiPath = pathOf(sourceRoute[source], {}, source === 'refs' ? { limit: STATIC_MODE ? 50 : 200 } : {});
  function updateLocal(recipe: (previous: LocalQueries) => LocalQueries) {
    if (activeOwner.current !== owner) return;
    setLocal((previous) => {
      const next = recipe(previous.owner === owner ? previous : emptyLocal(owner));
      try { localStorage.setItem(owner, JSON.stringify({ saved: next.saved, history: next.history })); } catch { next.unavailable = true; }
      return next;
    });
  }
  function chooseSource(next: SourceKey) {
    setSource(next); setDraft([]); setApplied([]); setSearch(''); setAppliedSearch(''); setVisibleKeys(null); setSelected(''); setPage(0); setSort(null);
  }
  function restore(view: ViewConfig) {
    if (!validView(view)) return;
    chooseSource(view.source); setDraft(view.filters); setApplied(view.filters); setSearch(view.search); setAppliedSearch(view.search); setVisibleKeys(view.columns);
  }
  async function run() {
    const captured: ViewConfig = { ...config, filters: draft.map((filter) => ({ ...filter, values: [...filter.values] })) };
    setApplied(captured.filters); setAppliedSearch(captured.search); setSelected(''); setPage(0);
    const result = await query.refetch();
    const data = result.isSuccess ? [...new Map((result.data?.pages.flatMap((part) => part.rows) ?? []).map((row) => [row.id, row])).values()] : [];
    const allowed = result.data?.pages[0]?.columns.map((column) => column.key) ?? [];
    const valid = captured.filters.every((filter) => allowed.includes(filter.field));
    const entry: QueryHistory = { ...captured, id: crypto.randomUUID(), at: new Date().toISOString(), result: result.isSuccess && valid ? 'SUCCESS' : result.error instanceof ApiError && result.error.status === 403 ? 'FORBIDDEN' : 'ERROR', count: result.isSuccess && valid ? filterRows(data, captured.filters, captured.search).length : null };
    updateLocal((previous) => ({ ...previous, history: [entry, ...previous.history].slice(0, 30) }));
  }
  function changeFilter(id: string, patch: Partial<Filter>) { setDraft((filters) => filters.map((filter) => filter.id === id ? { ...filter, ...patch } : filter)); }
  return <div className="ds-screen wb-screen">
    <PageHeader title={T.title} lead={T.lead} message={{ tone: 'neutral', value: query.isSuccess ? filtered.length : '—', text: T.matches }} actions={<button className="ds-btn" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{T.refresh}</button>} />
    <div className="wb-workspace">
      <aside className="wb-sources" aria-label={T.sources}>
        <h2><Icon name="master" size={16} />{T.sources}</h2><p className="wb-section-label">{T.sourceGroup}</p>
        <div className="wb-source-tree">{SOURCES.map((key) => <button key={key} className="wb-source" type="button" aria-pressed={source === key} onClick={() => chooseSource(key)}><Icon name={key === 'replies' ? 'ops' : key === 'cost' ? 'grid' : key === 'refs' ? 'master' : 'feature'} size={16} /><span>{T.sourceNames[key]}</span></button>)}</div>
        <section className="wb-saved" aria-label={T.saved}><h3>{T.saved}</h3><p>{T.savedLocal}</p>{ownLocal.saved.length ? ownLocal.saved.map((view) => <div key={view.id}><button type="button" className="wb-saved-link" onClick={() => restore(view)} title={conditionSummary(view)}>{view.name}</button><button type="button" className="wb-delete" aria-label={T.remove + ' ' + view.name} onClick={() => updateLocal((previous) => ({ ...previous, saved: previous.saved.filter((entry) => entry.id !== view.id) }))}><Icon name="close" size={12} /></button></div>) : <p>{T.noSaved}</p>}</section>
      </aside>
      <section className="wb-center" aria-label={T.table}>
        <form className="wb-query" onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <div className="wb-query-head"><h2>{T.filters}</h2><span>{T.liveRead}</span></div><p className="wb-help">{T.filterScope}</p>
          <label className="wb-search"><span>{T.search}</span><input className="ds-input" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={500} /></label>
          <div className="wb-filter-list">{draft.map((filter, index) => <div key={filter.id} className="wb-filter-row">
            <select className="ds-input" aria-label={T.fieldIndex(index + 1)} value={filter.field} onChange={(event) => changeFilter(filter.id, { field: event.target.value, value: '', values: [] })}>{!availableKeys.includes(filter.field) && <option value={filter.field}>{filter.field}</option>}{columns.map((column) => <option key={column.key} value={column.key}>{T.columns[column.key] ?? column.key}</option>)}</select>
            <select className="ds-input" aria-label={T.operatorIndex(index + 1)} value={filter.op} onChange={(event) => changeFilter(filter.id, { op: event.target.value as Operator, value: '', values: [] })}>{Object.entries(T.operators).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            {filter.op === 'in' ? <fieldset className="wb-values"><legend>{T.valueIndex(index + 1)}</legend>{[...new Set(rows.map((row) => row.values[filter.field]).filter((value) => value !== null && value !== undefined).map(String))].sort().map((value) => <label key={value}><input type="checkbox" checked={filter.values.includes(value)} onChange={(event) => changeFilter(filter.id, { values: event.target.checked ? [...filter.values, value] : filter.values.filter((entry) => entry !== value) })} />{value}</label>)}</fieldset> : filter.op !== 'empty' ? <input className="ds-input" aria-label={T.valueIndex(index + 1)} value={filter.value} onChange={(event) => changeFilter(filter.id, { value: event.target.value })} maxLength={500} /> : <span />}
            <button type="button" className="wb-delete" aria-label={T.removeFilterIndex(index + 1)} onClick={() => setDraft((filters) => filters.filter((entry) => entry.id !== filter.id))}><Icon name="close" size={14} /></button>
          </div>)}</div>
          <div className="wb-query-actions"><button className="ds-btn" type="button" disabled={!columns.length || draft.length >= 12} onClick={() => setDraft((filters) => [...filters, { id: crypto.randomUUID(), field: availableKeys[0], op: 'contains', value: '', values: [] }])}>{T.addFilter}</button><button className="ds-btn" type="button" onClick={() => { setDraft([]); setSearch(''); }}>{T.clearFilters}</button><button className="ds-btn ds-btn--primary" type="submit" disabled={query.isFetching}>{T.run}</button></div>
          <details className="wb-summary" open><summary>{T.summary}</summary><pre>{conditionSummary(config)}</pre></details>
          <div className="wb-save-form"><label><span>{T.viewName}</span><input className="ds-input" value={viewName} onChange={(event) => setViewName(event.target.value)} maxLength={80} /></label><button type="button" className="ds-btn" disabled={!viewName.trim()} onClick={() => { const view: SavedView = { ...config, id: crypto.randomUUID(), name: viewName.trim() }; updateLocal((previous) => ({ ...previous, saved: [view, ...previous.saved].slice(0, 20) })); setViewName(''); }}>{T.save}</button></div>
        </form>
        <div className="wb-provenance"><strong>{T.sourceNames[source]}</strong><span>{T.sourceNotes[source]}</span><code>{T.api} · GET {apiPath}</code><span>{T.readAt} · {query.dataUpdatedAt ? date(query.dataUpdatedAt) + ' KST' : T.emptyCell}</span>{query.isSuccess && <span>{partial ? T.partial(rows.length, total) : T.complete(rows.length)}</span>}{dirtyConditions && <p role="status">{T.pendingConditions}</p>}{mixedReleases && <p role="status">{T.mixedReleases}</p>}{pages[0]?.masked && <p role="status">{T.masked}</p>}{STATIC_MODE && partial && <p>{T.staticPartial}</p>}</div>
        {query.isError ? <div className="wb-query-error">{query.error instanceof ApiError && query.error.status === 403 && <p>{source === 'cost' ? T.costForbidden : T.forbidden}</p>}<ErrorNote error={query.error} /></div> : query.isPending ? <AsyncView state="loading" rows={8} /> : <>
          {invalidFilters && <p className="wb-query-error" role="alert">{T.invalidFilters}</p>}
          {!visibleColumns.length ? <p>{T.noColumns}</p> : <div className="wb-grid-scroll"><table className="wb-grid"><caption>{T.table}</caption><thead><tr><th scope="col">#</th>{visibleColumns.map((column) => <th key={column.key} scope="col" data-number={column.kind === 'number' || column.kind === 'money' || undefined} aria-sort={sort?.key === column.key ? sort.desc ? 'descending' : 'ascending' : 'none'}><button type="button" aria-label={T.sort(T.columns[column.key] ?? column.key)} onClick={() => setSort({ key: column.key, desc: sort?.key === column.key ? !sort.desc : false })}>{T.columns[column.key] ?? column.key}<Icon name="filter" size={12} /></button></th>)}</tr></thead><tbody>{shown.map((row, index) => <tr key={row.id} aria-selected={row.id === selected} onClick={() => setSelected(row.id)}><th scope="row"><button type="button" aria-label={T.selectRow(currentPage * PAGE_SIZE + index + 1)} aria-pressed={row.id === selected} onClick={() => setSelected(row.id)}>{currentPage * PAGE_SIZE + index + 1}</button></th>{visibleColumns.map((column) => <td key={column.key} data-identifier={IDENTIFIERS.has(column.key) || undefined} data-number={column.kind === 'number' || column.kind === 'money' || undefined}>{cell(row.values[column.key], column)}</td>)}</tr>)}</tbody></table>{!shown.length && <p className="wb-empty">{T.noRows}</p>}</div>}
          <div className="wb-pagination"><span>{T.shown} {shown.length} · {T.loaded} {rows.length}</span><button className="ds-btn" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{T.previous}</button><span>{T.page(currentPage + 1, pageCount)}</span><button className="ds-btn" type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{T.next}</button>{query.hasNextPage && <button className="ds-btn" type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{T.more}</button>}</div>
        </>}
        <section className="wb-history" aria-label={T.history}><div><h2>{T.history}</h2><button className="ds-btn" type="button" disabled={!ownLocal.history.length} onClick={() => updateLocal((previous) => ({ ...previous, history: [] }))}>{T.clearHistory}</button></div><p>{T.historyLocal}</p>{ownLocal.history.length ? <ol>{ownLocal.history.map((entry) => <li key={entry.id}><button type="button" onClick={() => restore(entry)}><strong>{T.sourceNames[entry.source]}</strong><span>{entry.result === 'SUCCESS' ? T.historySuccess : entry.result === 'FORBIDDEN' ? T.historyForbidden : T.historyFailed} · {entry.count ?? T.emptyCell} · {date(entry.at)} KST</span><pre>{conditionSummary(entry)}</pre></button></li>)}</ol> : <p>{T.noHistory}</p>}</section>
      </section>
      <aside className="wb-fields" aria-label={T.fields}><h2>{T.fields}</h2><div className="wb-column-list">{columns.map((column) => <label key={column.key}><input type="checkbox" checked={currentKeys.includes(column.key)} onChange={(event) => setVisibleKeys(event.target.checked ? [...currentKeys, column.key] : currentKeys.filter((key) => key !== column.key))} /><span>{T.columns[column.key] ?? column.key}</span><small>{column.kind === 'number' || column.kind === 'money' ? '123' : 'abc'}</small></label>)}</div><section className="wb-row-detail" aria-label={T.detail}><h3>{T.detail}</h3>{picked ? <><strong>{picked.id}</strong><dl>{columns.map((column) => <div key={column.key}><dt>{T.columns[column.key] ?? column.key}</dt><dd>{cell(picked.values[column.key], column)}</dd></div>)}</dl><div className="wb-row-links">{picked.links.map((link, index) => /^https:\/\//.test(link.href) ? <a key={link.href + index} href={link.href} target="_blank" rel="noopener noreferrer">{T.open[link.kind]}</a> : <Link key={link.href + index} to={link.href}>{T.open[link.kind]}</Link>)}</div></> : <p>{T.noSelection}</p>}</section></aside>
    </div>
    <p className="wb-storage-note">{ownLocal.unavailable ? T.localUnavailable : T.storageNote}</p>
  </div>;
}
