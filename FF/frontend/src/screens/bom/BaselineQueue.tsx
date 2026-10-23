// /baselines — BOM 기준선·확정 승인 (v2). 요청 큐 + 체크리스트 8항목 + 이전 Baseline diff + 결정(요청자≠승인자).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, DiffView, Drawer, ErrorNote, Field, IdChip, PageHeader, Panel, Segmented, Tabs, VerdictBadge } from '../../design';
import { Checklist } from '../features/FeatureDetail';
import { usePermission, when } from '../shared';
import type { BaselineRecord, BaselineRequest, ChecklistItem } from '../types';

const T = ko.bom;
const STATUS_VERDICT = { PENDING: 'CONDITIONAL', APPROVED: 'PASS', REJECTED: 'FAIL' } as const;

export default function BaselineQueue() {
  const reqs = useApi<{ items: BaselineRequest[] }>('baselineRequests');
  const [sp] = useSearchParams();
  const pending = (reqs.data?.items ?? []).filter((r) => r.status === 'PENDING').length;
  // 확정 요청이 없으면 데이터가 있는 '확정된 Baseline'을 먼저 보여 준다 — 데모 랜딩이 빈 화면이 되지 않게.
  // ?request= 로 승인 서랍을 열 때는 요청 탭이 먼저여야 서랍이 렌더된다.
  const requestsFirst = !!sp.get('request') || sp.get('tab') === 'requests' || !reqs.data || reqs.data.items.length > 0;
  const tabs = requestsFirst
    ? [{ key: 'requests', label: T.tabRequests }, { key: 'baselines', label: T.tabBaselines }]
    : [{ key: 'baselines', label: T.tabBaselines }, { key: 'requests', label: T.tabRequests }];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FEATURE BOM"
        title={T.title}
        lead={T.lead}
        message={!reqs.data ? { tone: 'neutral', value: '—', text: T.key.pending } : pending ? { tone: 'warn', value: pending, text: T.key.pending } : { tone: 'neutral', value: 0, text: T.key.none }}
      />
      <Tabs tabs={tabs}>
        {(tab) => (tab === 'requests' ? <div data-tour="baseline-approve"><Requests /></div> : <Baselines />)}
      </Tabs>
    </div>
  );
}

function Requests() {
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<'' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const all = useApi<{ items: BaselineRequest[] }>('baselineRequests');
  const rows = (all.data?.items ?? []).filter((r) => !status || r.status === status);
  const count = (s: string) => (all.data?.items ?? []).filter((r) => r.status === s).length;
  const total = all.data?.items.length ?? 0;
  const open = sp.get('request');
  const select = (id: string | null) => {
    const n = new URLSearchParams(sp);
    if (id) n.set('request', id);
    else n.delete('request');
    setSp(n, { replace: true });
  };
  const showBaselines = () => {
    const n = new URLSearchParams(sp);
    n.set('tab', 'baselines');
    setSp(n, { replace: true });
  };
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {/* 요청이 하나도 없으면 상태 필터는 "확정 0 반려 0 전체 0" — 핵심 메시지와 같은 말이라 그리지 않는다(UX3-09) */}
      {total > 0 && (
        <Segmented
          label={T.col.status}
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
          options={[
            { value: 'PENDING', label: T.status.PENDING },
            { value: 'APPROVED', label: T.status.APPROVED, count: count('APPROVED') },
            { value: 'REJECTED', label: T.status.REJECTED, count: count('REJECTED') },
            { value: '', label: ko.page.all, count: total },
          ]}
        />
      )}
      <AsyncView
        state={asyncState(all, rows.length === 0)}
        error={all.error?.message}
        onRetry={() => all.refetch()}
        empty={{ title: T.emptyRequests, action: <Button onClick={showBaselines}>{T.viewBaselines}</Button> }}
        // 대기 필터가 비면 핵심 메시지 "확정 승인 대기가 없습니다"와 같은 말이다 — 확정·반려를 고른 경우에만 빈 상자(UX3-09)
        emptyHidden={status === 'PENDING' || total === 0}
      >
        <DataTable
          caption={T.tabRequests}
          rows={rows}
          rowKey={(r) => r.requestId}
          onOpen={(r) => select(r.requestId)}
          columns={[
            { key: 'id', header: T.col.request, cell: (r) => <span className="ds-mono">{r.requestId}</span>, sort: (r) => r.requestId },
            { key: 'f', header: T.col.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}?tab=baseline`} copy={false} /> },
            { key: 'st', header: T.col.status, cell: (r) => <VerdictBadge value={STATUS_VERDICT[r.status]} /> },
            { key: 'by', header: T.requestedBy, cell: (r) => <span className="ds-mono">{r.requestedBy}</span> },
            { key: 'at', header: T.col.requestedAt, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.requestedAt)}</span>, sort: (r) => r.requestedAt },
            { key: 'bl', header: T.col.baseline, cell: (r) => (r.baselineId ? <IdChip id={r.baselineId} copy={false} /> : '—') },
            { key: 'why', header: ko.page.reason, cell: (r) => r.reason },
          ]}
        />
      </AsyncView>
      <RequestDrawer requestId={open} onClose={() => select(null)} />
    </div>
  );
}

function RequestDrawer({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const q = useApi<{ request: BaselineRequest; checklist: ChecklistItem[] | null }>('baselineRequest', { params: { rid: requestId ?? '' } }, { enabled: !!requestId });
  const perm = usePermission(['BOM_APPROVER']);
  const decide = useApiMutation('decideBaseline', ['baselineRequests', 'baselineRequest', 'baselines', 'featureDetail', 'listFeatures', 'audit']);
  const [reason, setReason] = useState('');
  const r = q.data?.request;
  const failing = (q.data?.checklist ?? []).filter((c) => c.state === 'FAIL').length;
  const diff = q.data?.checklist?.find((c) => c.id === 'DIFF')?.data ?? [];
  const run = (decision: 'APPROVE' | 'REJECT') => decide.mutate({ params: { rid: requestId! }, body: { decision, reason } }, { onSuccess: () => setReason('') });
  return (
    <Drawer open={!!requestId} title={requestId ?? ''} onClose={onClose}>
      <AsyncView state={asyncState(q)} error={q.error?.message}>
        {r && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}`} />
              <VerdictBadge value={STATUS_VERDICT[r.status]} />
              <span className="ds-field__hint">
                {T.requestedBy} <span className="ds-mono">{r.requestedBy}</span> · {when(r.requestedAt)}
              </span>
            </div>
            <p style={{ margin: 0 }}>{r.reason}</p>
            {q.data?.checklist && (
              <>
                <h3 className="ds-eyebrow" style={{ margin: 0 }}>{T.checklist}</h3>
                <Checklist items={q.data.checklist} />
                {diff.length > 0 && <DiffView rows={diff} />}
              </>
            )}
            {r.status === 'PENDING' ? (
              <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                {failing > 0 && <ErrorNote error={{ message: T.failing(failing) }} />}
                <Field label={ko.page.reason}>
                  <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
                </Field>
                <ErrorNote error={decide.error} />
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <Button variant="primary" disabled={!perm.ok || failing > 0 || decide.isPending || reason.trim().length < 2} title={perm.hint} onClick={() => run('APPROVE')}>
                    {T.approve}
                  </Button>
                  <Button disabled={!perm.ok || decide.isPending || reason.trim().length < 2} title={perm.hint} onClick={() => run('REJECT')}>
                    {T.reject}
                  </Button>
                </div>
                <span className="ds-field__hint">{perm.hint ?? T.sod}</span>
              </div>
            ) : (
              <p className="ds-field__hint" style={{ margin: 0 }}>
                {T.decidedBy} <span className="ds-mono">{r.decidedBy}</span> · {when(r.decidedAt)} — {r.decisionReason}
              </p>
            )}
          </div>
        )}
      </AsyncView>
    </Drawer>
  );
}

function Baselines() {
  const q = useApi<{ items: (BaselineRecord & { products: string[] })[] }>('baselines');
  const rows = q.data?.items ?? [];
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable
        caption={T.tabBaselines}
        rows={rows}
        rowKey={(r) => r.baselineId}
        maxHeight="calc(100vh - 300px)"
        initialSort={{ key: 'id', dir: 'desc' }}
        columns={[
          { key: 'id', header: T.col.baseline, cell: (r) => <IdChip id={r.baselineId} />, sort: (r) => r.baselineId },
          { key: 'f', header: T.col.feature, cell: (r) => <IdChip id={r.featureId} version={r.version} to={`/features/${r.featureId}/${r.version}?tab=baseline`} copy={false} />, sort: (r) => r.featureId },
          { key: 'name', header: ko.registry.col.name, cell: (r) => r.snapshot.name },
          { key: 'hash', header: T.col.hash, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }} title={r.contentHash ?? ''}>{r.contentHash?.slice(0, 19)}…</span> },
          { key: 'p', header: T.col.products, cell: (r) => (r.products.length ? r.products.map((p) => <span key={p} className="ds-tag ds-mono" style={{ marginRight: 4 }}>{p}</span>) : '—'), sort: (r) => r.products.length },
        ]}
      />
    </AsyncView>
  );
}
