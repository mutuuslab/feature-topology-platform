// /audit — 감사 이력(D01-10) · /events — Platform 이벤트(D04-04, SSE 실시간) (v2)
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, ChainStatus, DataTable, EventStream, PageHeader, Panel, RuleText, Segmented, Toolbar, VerdictBadge, type StreamItem } from '../../design';
import { ComponentName, Done, roleText, when } from '../shared';
import type { AuditEntry } from '../types';

const RESULTS = ['ALLOWED', 'DENIED', 'FAILED'] as const;

/** 결과 — 예외(거부·실패)만 배지, 허용은 작은 표시(UX3-02). 필터와 같은 낱말(ko.audit.results) */
function AuditResult({ result }: { result: AuditEntry['result'] }) {
  const label = ko.audit.results[result] ?? result;
  if (result === 'ALLOWED') return <Done ok title={label} />;
  return <VerdictBadge value={result === 'DENIED' ? 'CONDITIONAL' : 'FAIL'} label={label} />;
}

/** 감사 표 — 역할은 한글 라벨(원문 enum은 툴팁), 결과는 예외만 배지 */
function AuditLog({ rows }: { rows: AuditEntry[] }) {
  const C = ko.audit.col;
  return (
    <DataTable
      caption={ko.audit.title}
      rows={rows}
      rowKey={(r) => String(r.id)}
      columns={[
        { key: 'at', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span>, sort: (r) => r.at },
        { key: 'actor', header: C.actor, cell: (r) => <span className="ds-mono">{r.actorId}</span>, sort: (r) => r.actorId },
        { key: 'role', header: C.role, cell: (r) => <span title={r.actorRole}>{roleText(r.actorRole)}</span>, sort: (r) => roleText(r.actorRole) },
        { key: 'action', header: C.action, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.action}</span>, sort: (r) => r.action },
        { key: 'target', header: C.target, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.target}</span> },
        { key: 'result', header: C.result, cell: (r) => <AuditResult result={r.result} />, sort: (r) => r.result },
        // 서버 사유의 규칙 ID('FFG-CLS-006: …')는 설명 모드로(UX3-01)
        { key: 'reason', header: C.reason, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.reason ? <RuleText text={r.reason} explain /> : ''}</span> },
      ]}
    />
  );
}

export function AuditScreen() {
  const [result, setResult] = useState<'' | 'ALLOWED' | 'DENIED' | 'FAILED'>('');
  const [target, setTarget] = useState('');
  const [applied, setApplied] = useState('');
  const q = useApi<{ items: AuditEntry[] }>('audit', { query: { result: result || undefined, target: applied || undefined, limit: 500 } });
  const rows = q.data?.items ?? [];
  const chain = useApi<{ ok: boolean; verified: number; head: string | null; broken: { id: number; kind: string } | null }>('auditChain');
  const c = chain.data;
  // 체인이 정상이어도 표에 FAILED가 보이면 초록 한 줄만 두지 않는다(헤드라인·데이터 모순, 하네스 2판 결함 4)
  const failed = rows.filter((r) => r.result === 'FAILED').length;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-10 · AUDIT"
        title={ko.audit.title}
        lead={ko.audit.lead}
        message={!c ? { tone: 'neutral', value: '—', text: ko.audit.key.checking } : !c.ok ? { tone: 'danger', text: ko.audit.key.broken } : failed ? { tone: 'warn', value: failed, text: ko.audit.key.okFailed(failed) } : { tone: 'ok', text: ko.audit.key.ok(c.verified) }}
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
          options={[{ value: '', label: ko.page.all }, ...RESULTS.map((r) => ({ value: r, label: ko.audit.results[r] }))]}
        />
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()} filtered={!!(applied || result)}>
        <AuditLog rows={rows} />
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
  // 알려진 필드가 없어도 빈 칸으로 두지 않는다 — 앞의 두 값을 보인다
  const kv = Object.entries(o).filter(([, v]) => v != null && typeof v !== 'object').slice(0, 2);
  return kv.length ? kv.map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '—';
};

export function EventsScreen() {
  const qc = useQueryClient();
  const q = useApi<{ items: PlatformEvent[] }>('events', { query: { limit: 500 } });
  const [live, setLive] = useState<PlatformEvent[]>([]);
  const [sse, setSse] = useState<'static' | 'connecting' | 'open' | 'error'>(STATIC_MODE ? 'static' : 'connecting');
  useEffect(() => {
    if (STATIC_MODE || typeof EventSource === 'undefined') return setSse('static');
    const es = new EventSource('/api/events/stream');
    es.onopen = () => setSse('open');
    es.onerror = () => setSse('error');
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
      <PageHeader codes="D04-04 · EVENT HISTORY" title={ko.events.title} lead={ko.events.lead} message={{ tone: 'neutral', value: q.data ? q.data.items.length : '—', text: ko.events.key }}
        meta={<span className="ds-badge" data-sse={sse}>SSE · {ko.events.status[sse]}</span>} />
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
              { key: 'at', header: ko.audit.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.at)}</span> },
              { key: 'type', header: 'Type', cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)' }}>{r.type}</span>, sort: (r) => r.type },
              { key: 'agg', header: ko.audit.col.target, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{r.aggregate}</span> },
              { key: 'c', header: 'Component', cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{r.componentId ? <ComponentName id={r.componentId} /> : '—'}</span> },
              { key: 'p', header: ko.events.content, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)' }}>{summarize(r.payload)}</span> },
            ]}
          />
        </AsyncView>
        <Panel title={ko.events.live} eyebrow="SSE /api/events/stream" id="live">
          <EventStream items={stream} empty={ko.events.sse[sse]} />
        </Panel>
      </div>
    </div>
  );
}
