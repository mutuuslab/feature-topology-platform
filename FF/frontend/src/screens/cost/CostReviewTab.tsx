// 검토 탭 — 엑셀 07_검토체크리스트(38항목, 구매 핵심 12). 작성·승인 역할이 승인 전까지 상태·메모를 고친다.
// 완료율 = 확인 ÷ (전체 − 해당 없음) — 엑셀 D5와 같은 식(서버 계산).
import { useState } from 'react';
import { COST_CHECK_STATUSES, type CostCheckStatus } from '@ff/contracts';
import { useApiMutation } from '../../api/hooks';
import { COST_CHECK_LABEL, costReview as T } from '../../copy/cost';
import { DataTable, ErrorNote, Segmented, SummaryLine } from '../../design';
import { usePermission } from '../shared';
import { COST_CHECKERS, pct, type CostCheckItem, type CostDetailResponse } from './common';

export function CostReviewTab({ d }: { d: CostDetailResponse }) {
  const [view, setView] = useState<'all' | 'purchase'>('all');
  const perm = usePermission(COST_CHECKERS);
  const editable = perm.ok && d.project.status !== 'APPROVED';
  const put = useApiMutation('costCheckPut', ['costProject']);
  const c = d.checks;
  const rows = view === 'purchase' ? c.items.filter((i) => i.purchaseKey) : c.items;
  const update = (i: CostCheckItem, status: CostCheckStatus, memo = i.memo) => put.mutate({ params: { estId: d.project.estId, no: String(i.no) }, body: { status, memo } });
  return (
    <div className="ds-stack">
      <SummaryLine
        label={T.caption}
        items={[
          { k: T.rate, v: pct(c.rate) },
          { k: T.openLabel, v: c.open },
          { k: T.uncheckedLabel, v: c.unchecked },
        ]}
      />
      <Segmented<'all' | 'purchase'>
        label={T.filter}
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: T.all, count: c.items.length },
          { value: 'purchase', label: T.purchase, count: c.items.filter((i) => i.purchaseKey).length },
        ]}
      />
      {!editable && d.project.status === 'APPROVED' && <p className="ds-field__hint">{T.locked}</p>}
      <DataTable
        rows={rows}
        rowKey={(i) => String(i.no)}
        caption={T.caption}
        pageSize={50}
        columns={[
          { key: 'no', header: T.cols.no, cell: (i) => i.no, align: 'right', sort: (i) => i.no },
          { key: 'category', header: T.cols.category, cell: (i) => i.category, sort: (i) => i.category, minor: true },
          { key: 'item', header: T.cols.item, cell: (i) => i.item },
          { key: 'method', header: T.cols.method, cell: (i) => i.method, minor: true },
          {
            key: 'status',
            header: T.cols.status,
            cell: (i) => (
              <select className="ds-select" aria-label={`${T.cols.status} ${i.no}`} value={i.status} disabled={!editable || put.isPending} onChange={(e) => update(i, e.target.value as CostCheckStatus)}>
                {COST_CHECK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {COST_CHECK_LABEL[s]}
                  </option>
                ))}
              </select>
            ),
            sort: (i) => i.status,
          },
          { key: 'memo', header: T.cols.memo, cell: (i) => <MemoCell item={i} disabled={!editable || put.isPending} onSave={(memo) => update(i, i.status, memo)} /> },
        ]}
      />
      <ErrorNote error={put.error} />
    </div>
  );
}

function MemoCell({ item, disabled, onSave }: { item: CostCheckItem; disabled: boolean; onSave: (memo: string) => void }) {
  const [memo, setMemo] = useState(item.memo);
  return (
    <input
      className="ds-input"
      aria-label={`${T.memo} ${item.no}`}
      value={memo}
      disabled={disabled}
      maxLength={500}
      onChange={(e) => setMemo(e.target.value)}
      onBlur={() => memo !== item.memo && onSave(memo)}
    />
  );
}
