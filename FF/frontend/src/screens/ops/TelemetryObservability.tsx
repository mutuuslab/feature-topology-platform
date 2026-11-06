import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { routeUrl, snapshotFile, type OtelSpan } from '@ff/contracts';
import { readSnapshotFile, STATIC_MODE } from '../../api/client';
import { useApi, asyncState } from '../../api/hooks';
import { AsyncView, DataTable, Drawer, Panel, SummaryLine, Tabs, Toolbar } from '../../design';
import { localTime } from '../../data/people';
import { useAppShell } from '../../store';
import { observability as T } from '../../copy/observability';
import { measuredMetrics, recordedTimeBins } from './observability-data';
import { ReadbackFlow, type VehicleReadback as Readback } from './ReadbackFlow';
import './observability.css';

type Event = { id: string; seq: number; at: string; type: string; aggregate: string; correlationId: string | null; componentId: string; payload: unknown };

const collected = <T,>(value: unknown, fields: string[], valid?: (row: Record<string, unknown>) => boolean): { items: T[] } => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) throw new Error(T.malformed);
  const items = (value as { items: unknown[] }).items;
  if (!items.every(row => !!row && typeof row === 'object' && !Array.isArray(row) && fields.every(key => typeof (row as Record<string, unknown>)[key] === 'string') && (!valid || valid(row as Record<string, unknown>)))) throw new Error(T.malformed);
  return { items: items as T[] };
};

export default function TelemetryObservability() {
  const { role } = useAppShell();
  const [search, setSearch] = useState('');
  const [window, setWindow] = useState<{ from: number; to: number; last: boolean } | null>(null);
  // 차량 회신에는 요청 ID가 없다 — 같은 게시본의 발행·전달 이벤트와 그 차량의 회신 이벤트를 연결한다
  const [detail, setSelected] = useState<{ actor: string; title: string; value: unknown; correlation: string | null; publication?: { vin: string; publicationId: string } } | null>(null);
  const selected = detail?.actor === role ? detail : null;
  useEffect(() => setSelected(null), [role]);
  // 정적 데모는 스냅샷을 찍는 동안 받은 지표(Prometheus 텍스트를 JSON으로 감싼 파일)를 같은 방법으로 읽는다
  const metrics = useQuery({ queryKey: ['healthMetrics', role], refetchInterval: STATIC_MODE ? false : 15_000, retry: false, queryFn: async ({ signal }) => { const text = STATIC_MODE ? String((await readSnapshotFile<{ text?: unknown }>(snapshotFile(routeUrl('healthMetrics')), signal)).text ?? '') : await (async () => { const res = await fetch('/api/health/metrics', { signal, headers: { Accept: 'text/plain' } }); if (!res.ok) throw new Error(T.metricsUnavailable); return res.text(); })(); if (!text.includes('# TYPE ff_http_')) throw new Error(T.metricsUnavailable); return measuredMetrics(text); } });
  const traces = useApi<{ items: OtelSpan[] }>('otelSpans', { query: { limit: 300 } }, { refetchInterval: 15_000, select: value => collected<OtelSpan>(value, ['traceId', 'spanId', 'name', 'startTime'], row => Number.isFinite(Date.parse(String(row.startTime))) && !!row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)) });
  const events = useApi<{ items: Event[] }>('events', { query: { limit: 500, recent: '1' } }, { refetchInterval: 15_000, select: value => collected<Event>(value, ['id', 'type', 'aggregate', 'at'], row => Number.isFinite(Date.parse(String(row.at)))) });
  const readbacks = useApi<{ items: Readback[] }>('readbacks', {}, { refetchInterval: STATIC_MODE ? false : 5_000, select: value => collected<Readback>(value, ['vin', 'publicationId', 'at', 'observed'], row => Number.isFinite(Date.parse(String(row.at)))) });
  const match = (value: unknown) => !search.trim() || JSON.stringify(value).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const inWindow = (at: string) => !window || (Date.parse(at) >= window.from && (window.last ? Date.parse(at) <= window.to : Date.parse(at) < window.to));
  const ms = (metrics.data ?? []).filter(match), ts = (traces.data?.items ?? []).filter(r => match(r) && inWindow(r.startTime)), es = (events.data?.items ?? []).filter(r => match(r) && inWindow(r.at)), rs = (readbacks.data?.items ?? []).filter(r => match(r) && inWindow(r.at));
  const bins = recordedTimeBins([...(events.data?.items ?? []).filter(match).map(e => e.at), ...(readbacks.data?.items ?? []).filter(match).map(r => r.at)]);
  const max = Math.max(1, ...bins.counts);
  const pub = selected?.publication;
  const linked = selected?.correlation ? (events.data?.items ?? []).filter(e => e.correlationId === selected.correlation) : pub ? (events.data?.items ?? []).filter(e => e.aggregate === pub.publicationId || (e.aggregate === pub.vin && (e.payload as { publicationId?: unknown } | null)?.publicationId === pub.publicationId)) : [];
  const refresh = () => { if (!STATIC_MODE) void metrics.refetch(); void traces.refetch(); void events.refetch(); void readbacks.refetch(); };
  return <div className="ob-workbench">
    <p className="ds-field__hint">{T.lead}</p>
    <Toolbar label={T.title}><input className="ds-input" type="search" aria-label={T.search} placeholder={T.search} value={search} onChange={e => { setSearch(e.target.value); setWindow(null); }} /><button className="ds-btn" type="button" onClick={refresh}>{T.refresh}</button>{window && <button type="button" className="ds-btn" onClick={() => setWindow(null)}>{T.clearWindow}</button>}</Toolbar>
    {window && <p className="ds-field__hint">{T.windowHint}</p>}
    <SummaryLine items={[{ k: T.requests, v: metrics.data ? ms.reduce((n, r) => n + r.requests, 0) : T.unknown }, { k: T.errors, v: metrics.data ? ms.reduce((n, r) => n + r.errors, 0) : T.unknown }, { k: T.traces, v: traces.data ? ts.length : T.unknown }, { k: T.readbacks, v: readbacks.data ? rs.length : T.unknown }]} />
    <Panel title={T.timeDistribution}><div className="ob-histogram" role="group" aria-label={T.timeDistribution}>
      {bins.counts.length ? bins.counts.map((n, i) => { const step = Math.max(1, bins.to! - bins.from!) / bins.counts.length, from = bins.from! + i * step, to = bins.from! + (i + 1) * step; return <button type="button" key={i} className="ob-histogram__column" disabled={!n} aria-label={T.bucket(n, localTime(new Date(from).toISOString()), localTime(new Date(to).toISOString()))} aria-pressed={window?.from === from} onClick={() => setWindow({ from, to, last: i === bins.counts.length - 1 })}><span className="ob-histogram__count">{n}</span><span className="ob-histogram__bar" style={{ height: `${n / max * 100}%` }} /></button>; }) : <p className="ds-field__hint">{T.noData}</p>}
    </div>{bins.from !== null && <p className="ds-field__hint">{localTime(new Date(bins.from).toISOString())} — {localTime(new Date(bins.to!).toISOString())}</p>}</Panel>
    <Tabs param="observe" tabs={Object.entries(T.tabs).map(([key, label]) => ({ key, label }))}>{tab => tab === 'metrics' ? <>
      <AsyncView state={metrics.isPending ? 'loading' : metrics.isError ? 'error' : ms.length ? 'ready' : 'empty'} error={metrics.error} onRetry={() => metrics.refetch()}><DataTable caption={T.metrics} rows={ms} rowKey={r => `${r.method} ${r.route}`} columns={[{ key: 'r', header: T.route, cell: r => `${r.method} ${r.route}` }, { key: 'n', header: T.requests, cell: r => r.requests }, { key: 'e', header: T.errors, cell: r => r.errors }, { key: 'm', header: T.latency, cell: r => r.meanMs === null ? T.unknown : `${r.meanMs.toFixed(1)} ms` }]} /></AsyncView>
    </> : tab === 'traces' ? <><p className="ds-field__hint">{T.pseudonym}</p><AsyncView state={asyncState(traces, ts.length === 0)} error={traces.error} onRetry={() => traces.refetch()}><DataTable caption={T.traces} rows={ts} rowKey={r => r.spanId} onOpen={r => setSelected({ actor: role, title: T.trace, value: r, correlation: r.traceId })} columns={[{ key: 'at', header: T.at, cell: r => localTime(r.startTime) }, { key: 'f', header: 'Flag', cell: r => String(r.attributes['feature_flag.key'] ?? T.unknown) }, { key: 'r', header: T.reason, cell: r => String(r.attributes['feature_flag.result.reason'] ?? T.unknown) }, { key: 'id', header: T.trace, cell: r => <span className="ob-id">{r.traceId}</span> }]} /></AsyncView></>
    : tab === 'logs' ? <AsyncView state={asyncState(events, es.length === 0)} error={events.error} onRetry={() => events.refetch()}><DataTable caption={T.logs} rows={[...es].reverse()} rowKey={r => r.id} onOpen={r => setSelected({ actor: role, title: T.event, value: r, correlation: r.correlationId })} columns={[{ key: 'at', header: T.at, cell: r => localTime(r.at) }, { key: 't', header: T.event, cell: r => r.type }, { key: 'a', header: T.target, cell: r => r.aggregate }, { key: 'id', header: T.trace, cell: r => r.correlationId ?? T.unknown }]} /></AsyncView>
    : <AsyncView state={asyncState(readbacks, rs.length === 0)} error={readbacks.error} onRetry={() => readbacks.refetch()}><ReadbackFlow key={`${role}:${search}:${window?.from ?? "all"}:${window?.to ?? "all"}`} rows={rs} updatedAt={readbacks.dataUpdatedAt} fetching={readbacks.isFetching} staticMode={STATIC_MODE} onOpen={r => setSelected({ actor: role, title: T.readbacks, value: r, correlation: null, publication: { vin: r.vin, publicationId: r.publicationId } })} /><DataTable caption={T.readbacks} rows={rs} rowKey={r => `${r.vin}:${r.publicationId}:${r.at}`} onOpen={r => setSelected({ actor: role, title: T.readbacks, value: r, correlation: null, publication: { vin: r.vin, publicationId: r.publicationId } })} columns={[{ key: 'at', header: T.at, cell: r => localTime(r.at) }, { key: 'v', header: T.vin, cell: r => <Link to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`}>{r.vin}</Link> }, { key: 'p', header: T.publication, cell: r => <Link to={`/deployments/${r.publicationId}`}>{r.publicationId}</Link> }, { key: 's', header: T.state, cell: r => r.rejectReason || r.observed }]} /></AsyncView>}</Tabs>
    {selected && <Drawer open title={selected.title} onClose={() => setSelected(null)}><h3>{T.detail}</h3><pre className="ob-record">{JSON.stringify(selected.value, null, 2)}</pre><h3>{T.correlation}</h3>{linked.length ? linked.map(e => <article key={e.id}><strong>{e.type}</strong><p>{localTime(e.at)} · {e.aggregate}</p></article>) : <p className="ds-field__hint">{T.noCorrelation}</p>}</Drawer>}
  </div>;
}
