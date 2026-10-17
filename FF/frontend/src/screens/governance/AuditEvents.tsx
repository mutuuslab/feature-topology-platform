// /audit — 감사 이력(D01-10) · /events — Platform 이벤트(D04-04, SSE 실시간) (v2)
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, ChainStatus, DataTable, EventStream, PageHeader, Panel, Segmented, Toolbar, type StreamItem } from '../../design';
import { AuditTable } from '../features/FeatureDetail';
import { when } from '../shared';
import type { AuditEntry } from '../types';

export function AuditScreen() {
  const [result, setResult] = useState<'' | 'ALLOWED' | 'DENIED' | 'FAILED'>('');
  const [target, setTarget] = useState('');
  const [applied, setApplied] = useState('');
  const q = useApi<{ items: AuditEntry[] }>('audit', { query: { result: result || undefined, target: applied || undefined, limit: 500 } });
  const rows = q.data?.items ?? [];
  const chain = useApi<{ ok: boolean; verified: number; head: string | null; broken: { id: number; kind: string } | null }>('auditChain');
  const c = chain.data;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-10 · AUDIT"
        title={ko.audit.title}
        lead={ko.audit.lead}
        message={!c ? { tone: 'neutral', value: '—', text: ko.audit.key.broken } : c.ok ? { tone: 'ok', text: ko.audit.key.ok(c.verified, c.head ? `${c.head.slice(0, 10)}…` : '—') } : { tone: 'danger', text: ko.audit.key.broken }}
        tour="audit-chain"
      />
      {c?.broken && (
        <p className="ds-stale" role="alert">
          {ko.audit.chainBroken(c.broken.id, c.broken.kind)}
        </p>
      )}
      <Toolbar label={ko.audit.title}>
        <input
          className="ds-input ds-input--mono"
          type="search"
          aria-label={ko.audit.col.target}
          placeholder="FEAT-00022@1.0.0"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setApplied(target.trim())}
          onBlur={() => setApplied(target.trim())}
        />
        <Segmented
          label={ko.audit.result}
          value={result}
          onChange={(v) => setResult(v as typeof result)}
          options={[
            { value: '', label: ko.page.all },
            { value: 'ALLOWED', label: 'ALLOWED' },
            { value: 'DENIED', label: 'DENIED' },
            { value: 'FAILED', label: 'FAILED' },
          ]}
        />
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <AuditTable rows={rows} />
      </AsyncView>
    </div>
  );
}

interface PlatformEvent {
  seq: number;
  id: string;
  type: string;
  at: string;
  aggregate: string;
  componentId: string | null;
  payload: unknown;
}

const summarize = (p: unknown) => {
  if (!p || typeof p !== 'object') return '';
  const o = p as Record<string, unknown>;
  if (o.from && o.to) return `${o.from} → ${o.to}`;
  if (o.status) return String(o.status);
  if (o.verdict) return String(o.verdict);
  if (o.baselineId) return String(o.baselineId);
  return '';
};

export function EventsScreen() {
  const qc = useQueryClient();
  const q = useApi<{ items: PlatformEvent[] }>('events', { query: { limit: 500 } });
  const [live, setLive] = useState<PlatformEvent[]>([]);
  useEffect(() => {
    if (STATIC_MODE || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events/stream');
    es.addEventListener('platform', (m) => {
      const e = JSON.parse((m as MessageEvent).data) as PlatformEvent;
      setLive((xs) => [...xs, e].slice(-200));
      void qc.invalidateQueries({ queryKey: ['events'] });
    });
    return () => es.close();
  }, [qc]);
  const rows = q.data?.items ?? [];
  const stream: StreamItem[] = live.map((e) => ({ seq: e.seq, at: e.at, type: e.type, aggregate: e.aggregate, summary: summarize(e.payload) }));
  return (
    <div className="ds-screen">
      <PageHeader codes="D04-04 · EVENT HISTORY" title={ko.events.title} lead={ko.events.lead} message={{ tone: 'accent', value: q.data ? q.data.items.length : '—', text: ko.events.key }} />
      <div className="ds-split">
        <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
          <DataTable
            caption={ko.events.title}
            rows={rows}
            rowKey={(r) => String(r.seq)}
            maxHeight="calc(100vh - 280px)"
            initialSort={{ key: 'seq', dir: 'desc' }}
            columns={[
              { key: 'seq', header: '#', cell: (r) => <span className="ds-mono">{r.seq}</span>, sort: (r) => r.seq, align: 'right' },
              { key: 'at', header: ko.audit.col.at, cell: (r) => <span className="ds-mono">{when(r.at)}</span> },
              { key: 'type', header: 'Type', cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)' }}>{r.type}</span>, sort: (r) => r.type },
              { key: 'agg', header: ko.audit.col.target, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.aggregate}</span> },
              { key: 'c', header: 'Component', cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.componentId ?? '—'}</span> },
              { key: 'p', header: ko.audit.col.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{summarize(r.payload)}</span> },
            ]}
          />
        </AsyncView>
        <Panel title={ko.events.live} eyebrow="SSE /api/events/stream" id="live">
          <EventStream items={stream} />
        </Panel>
      </div>
    </div>
  );
}
