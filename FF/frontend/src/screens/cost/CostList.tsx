// /procurement/sw-cost — 산정 과제 목록(20-94 §9). 핵심 메시지 = 승인된 과제의 총개발비 합계(산정 역할) 또는 총 공수 합계(그 밖의 역할).
// 새 과제는 작성 역할만 — 만들면 상세(설정 탭)로 간다.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COST_PROJECT_STATUSES } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { COST_STATUS_LABEL, swCost as T } from '../../copy/cost';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, PageHeader, SummaryLine, whyDisabled } from '../../design';
import { usePermission, when } from '../shared';
import { BackLink, COST_WRITERS, CostChip, CostStatusBadge, costPath, mm, money, moneyKey, type CostListItem, type CostListResponse } from './common';

export function SwCostScreen() {
  const q = useApi<CostListResponse>('costProjects');
  const perm = usePermission(COST_WRITERS);
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const full = q.data?.view === 'FULL';
  const approved = items.filter((p) => p.status === 'APPROVED' && p.totals);
  const sumCost = approved.reduce((s, p) => s + (p.totals?.totalCost ?? 0), 0);
  const sumMm = approved.reduce((s, p) => s + (p.totals?.totalMm ?? 0), 0);
  const key = moneyKey(sumCost);
  const message = !q.data
    ? { tone: 'neutral' as const, text: T.title }
    : !items.length
      ? { tone: 'neutral' as const, text: T.empty }
      : !approved.length
      ? { tone: 'neutral' as const, text: T.keyNone }
      : full
        ? { tone: 'neutral' as const, value: key.value, text: T.keyFull }
        : { tone: 'neutral' as const, value: mm(sumMm), text: T.keyMm };
  const columns = [
    { key: 'id', header: T.cols.id, cell: (p: CostListItem) => <CostChip id={p.estId} />, sort: (p: CostListItem) => p.estId },
    { key: 'name', header: T.cols.name, cell: (p: CostListItem) => p.name, sort: (p: CostListItem) => p.name },
    { key: 'status', header: T.cols.status, cell: (p: CostListItem) => <CostStatusBadge status={p.status} />, sort: (p: CostListItem) => p.status },
    { key: 'features', header: T.cols.features, cell: (p: CostListItem) => p.featureCount, align: 'right' as const, sort: (p: CostListItem) => p.featureCount },
    { key: 'mm', header: T.cols.mm, cell: (p: CostListItem) => mm(p.totals?.totalMm), align: 'right' as const, sort: (p: CostListItem) => p.totals?.totalMm ?? -1 },
    ...(full ? [{ key: 'cost', header: T.cols.cost, cell: (p: CostListItem) => money(p.totals?.totalCost), align: 'right' as const, sort: (p: CostListItem) => p.totals?.totalCost ?? -1 }] : []),
    { key: 'basis', header: T.cols.basis, cell: (p: CostListItem) => (p.basisStale ? `${p.basisVersion} · ${T.stale}` : p.basisVersion), minor: true },
    { key: 'updated', header: T.cols.updated, cell: (p: CostListItem) => when(p.updatedAt), sort: (p: CostListItem) => p.updatedAt, minor: true },
  ];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D07-01 · SW COST"
        title={T.title}
        lead={T.lead}
        message={message}
        actions={
          <>
            <BackLink to="/procurement/sw-cost/basis">{T.basisLink}</BackLink>
            <Button variant="primary" disabled={!perm.ok} reason={whyDisabled([!perm.ok, perm.hint])} onClick={() => setOpen(true)}>
              {T.newProject}
            </Button>
          </>
        }
      />
      <AsyncView state={asyncState(q, items.length === 0)} error={q.error} onRetry={() => q.refetch()} emptyHidden>
        <SummaryLine label={T.summary} items={COST_PROJECT_STATUSES.map((s) => ({ k: COST_STATUS_LABEL[s], v: items.filter((p) => p.status === s).length }))} />
        <DataTable rows={items} columns={columns} rowKey={(p) => p.estId} caption={T.tableCaption} initialSort={{ key: 'id', dir: 'desc' }} />
      </AsyncView>
      <CreateDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const nav = useNavigate();
  const create = useApiMutation<{ estId: string }>('costProjectCreate', ['costProjects']);
  const why = whyDisabled([!name.trim(), T.create.name]);
  return (
    <Drawer open={open} title={T.create.title} onClose={onClose} dirty={!!name || !!target}>
      <form
        className="ds-stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ body: { name: name.trim(), target: target.trim() } }, { onSuccess: (r) => nav(costPath(r.estId)) });
        }}
      >
        <Field label={T.create.name}>
          <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={T.create.target} hint={T.create.targetHint}>
          <input className="ds-input" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} />
        </Field>
        <ErrorNote error={create.error} />
        <Button type="submit" variant="primary" disabled={!!why || create.isPending} reason={why}>
          {T.create.submit}
        </Button>
      </form>
    </Drawer>
  );
}
