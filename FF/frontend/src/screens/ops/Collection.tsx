// /ops/collection — 수집 정책(TL-UI09, 80-70 2장·6장 9). 어떤 신호를 어느 차량군에서 어떤 트리거로 모을지와 근거(법령·동의)·예상 데이터량·시장.
// 수집 정책은 서명 게시본 경로로 내려가고 차량 회신으로 적용을 확인한다(서명 배포·차량 회신 화면 흐름 재사용).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CollectionPolicyRow } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { lake as L } from '../../copy/lake';
import { AsyncView, DataTable, Drawer, KeyValue, PageHeader, Panel, SummaryLine, VerdictBadge, type KeyMessageSpec } from '../../design';
import { when } from '../shared';
import { LakeOff } from './lake-ui';

const C = L.collection;
const STATUS_VERDICT: Record<string, string> = { DEPLOYED: 'PASS', APPROVED: 'CONDITIONAL', DRAFT: '미판정', HELD: 'FAIL' };

function message(items: CollectionPolicyRow[] | undefined): KeyMessageSpec {
  if (!items) return { tone: 'neutral', value: '—', text: C.key.live };
  const held = items.filter((c) => c.status === 'HELD').length;
  if (held) return { tone: 'warn', value: held, text: C.key.held };
  const live = items.filter((c) => c.status === 'DEPLOYED').length;
  if (live) return { tone: 'ok', value: live, text: C.key.live };
  return { tone: 'neutral', value: items.length, text: C.key.draft };
}

export function CollectionScreen() {
  const q = useApi<{ connected: boolean; items: CollectionPolicyRow[] }>('collectionPolicies');
  const [open, setOpen] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const sel = items.find((c) => c.collectionId === open) ?? null;
  const gb = items.filter((c) => c.status === 'DEPLOYED').reduce((s, c) => s + c.gbPerDay, 0);
  return (
    <div className="ds-screen">
      <PageHeader codes="D04-03 · COLLECTION POLICY" title={C.title} lead={C.lead} message={message(q.data?.items)} actions={<Link className="ds-btn" to="/deployments">{C.toDeploy}</Link>} />
      <LakeOff connected={q.data?.connected}>
        {q.data && (
          <SummaryLine
            label={C.title}
            items={[
              { k: C.summary.total, v: C.gb(Math.round(gb * 10) / 10) },
              { k: C.summary.vehicles, v: L.vehicles(items.filter((c) => c.status === 'DEPLOYED').reduce((s, c) => s + c.vehicles, 0)) },
              { k: C.summary.consent, v: items.filter((c) => c.basis === 'CONSENT').length },
            ]}
          />
        )}
        <Panel title={C.title} id="collection-list">
          <AsyncView state={asyncState(q, items.length === 0)} error={q.error} onRetry={() => q.refetch()}>
            <DataTable
              caption={C.title}
              rows={items}
              rowKey={(c) => c.collectionId}
              onOpen={(c) => setOpen(c.collectionId)}
              columns={[
                { key: 't', header: C.col.title, cell: (c) => <span><strong>{c.title}</strong> <span className="ds-mono">{c.collectionId}</span></span>, sort: (c) => c.collectionId },
                { key: 's', header: C.col.signals, cell: (c) => <span title={c.signals.join(', ')}>{c.signals.slice(0, 2).join(', ')}{c.signals.length > 2 ? ` +${c.signals.length - 2}` : ''}</span> },
                { key: 'g', header: C.col.target, cell: (c) => c.target },
                { key: 'tr', header: C.col.trigger, cell: (c) => c.trigger },
                { key: 'c', header: C.col.category, cell: (c) => <span className="ds-tag">{C.category[c.category]}</span> },
                { key: 'b', header: C.col.basis, cell: (c) => C.basis[c.basis] },
                { key: 'gb', header: C.col.gb, cell: (c) => <span className="ds-mono ds-nowrap">{C.gb(c.gbPerDay)}</span>, align: 'right', sort: (c) => c.gbPerDay },
                { key: 'm', header: C.col.markets, cell: (c) => <span className="ds-mono">{c.markets.join(' · ')}</span> },
                { key: 'st', header: C.col.status, cell: (c) => <VerdictBadge value={STATUS_VERDICT[c.status]} label={C.status[c.status]} />, sort: (c) => c.status },
                { key: 'r', header: C.col.replies, cell: (c) => <span className="ds-mono ds-nowrap">{C.replies(c.replies.accepted, c.replies.rejected, c.replies.pending)}</span> },
              ]}
            />
          </AsyncView>
          <p className="ds-field__hint">{C.deliveryNote}</p>
        </Panel>
      </LakeOff>
      <Drawer open={!!sel} title={sel?.title ?? ''} onClose={() => setOpen(null)}>
        {sel && (
          <KeyValue
            rows={[
              { k: C.detail.signals, v: sel.signals.join(', ') },
              { k: C.col.target, v: sel.target, note: `${C.detail.vehicles} ${L.vehicles(sel.vehicles)}` },
              { k: C.col.trigger, v: sel.trigger },
              { k: C.col.category, v: C.category[sel.category] },
              { k: C.detail.basisNote, v: C.basis[sel.basis], note: sel.basisNote },
              { k: C.col.gb, v: <span className="ds-mono">{C.gb(sel.gbPerDay)}</span> },
              { k: C.col.markets, v: <span className="ds-mono">{sel.markets.join(' · ')}</span> },
              { k: C.col.status, v: C.status[sel.status], note: sel.holdReason ?? undefined },
              { k: C.col.replies, v: <span className="ds-mono">{C.replies(sel.replies.accepted, sel.replies.rejected, sel.replies.pending)}</span> },
              { k: C.detail.approved, v: <span className="ds-mono">{sel.approvedBy ?? '—'}</span> },
              { k: C.detail.updated, v: <span className="ds-mono">{when(sel.updatedAt)}</span> },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
