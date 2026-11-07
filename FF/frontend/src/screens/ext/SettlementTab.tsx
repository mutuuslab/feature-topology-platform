// 외부 연계 현황 '정산 전송' 탭(D05-04, FR-BIL-001-002) — 기간별 상품 사용량·전송 항목·주기, 전송 기록(실패 사유·시각), 수동 보내기.
// 끝난 달만, 같은 달은 한 번만 보낸다(서버가 같은 규칙으로 거부). 탭을 열 때만 읽는다.
import { useState } from 'react';
import { SETTLEMENT_SENDERS, type SettlementTransmissionView, type SettlementUsageView } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { settlement as S } from '../../copy/ext-gateway';
import { AsyncView, Button, DataTable, ErrorNote, Field, KeyValue, Panel, Select, Toolbar, VerdictBadge, whyDisabled } from '../../design';
import { personLabel, personName } from '../../data/people';
import { usePermission, when } from '../shared';

/** 최근 6개월(직전 달부터) — 화면 시계 기준 */
function recentPeriods(now = new Date()): string[] {
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
}

export default function SettlementTab() {
  const [period, setPeriod] = useState('');
  const usage = useApi<SettlementUsageView>('settlementUsage', { query: { period: period || undefined } });
  const hist = useApi<{ items: SettlementTransmissionView[] }>('settlementTransmissions');
  const perm = usePermission(SETTLEMENT_SENDERS);
  const send = useApiMutation<SettlementTransmissionView>('sendSettlement', ['settlementUsage', 'settlementTransmissions', 'integrationErrors', 'audit', 'events']);
  const [reason, setReason] = useState<string>(S.reasonDefault);
  const u = usage.data;
  const periods = recentPeriods();
  const shown = u?.period ?? period;
  const C = S.col;
  const H = S.histCol;
  return (
    <div className="ds-stack" data-testid="settlement">
      <p className="ds-field__hint">{S.lead}</p>
      <Toolbar label={S.tab}>
        <Select label={S.period} value={shown} onChange={(e) => setPeriod(e.target.value)}>
          {[...new Set([shown, ...periods].filter(Boolean))].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <span className="ds-badge">{!u ? '—' : u.sent ? S.sentKey(u.sent.transmissionId) : u.closed ? S.notSent : S.open}</span>
        <Field label={S.reason}>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          disabled={!perm.ok || !u || !u.closed || !!u.sent || reason.trim().length < 2 || send.isPending}
          reason={whyDisabled([!perm.ok, perm.hint], [u && u.sent, S.sentKey(u?.sent?.transmissionId ?? '')], [u && !u.closed, S.open])}
          onClick={() => send.mutate({ body: { period: u!.period, reason: reason.trim() } })}
        >
          {S.send}
        </Button>
      </Toolbar>
      <ErrorNote error={send.error} />
      <AsyncView state={asyncState(usage)} error={usage.error} onRetry={() => usage.refetch()}>
        {u && (
          <>
            <Panel title={S.usage}>
              <DataTable
                caption={S.usage}
                rows={u.lines}
                rowKey={(l) => l.catalogId}
                columns={[
                  { key: 'p', header: C.product, cell: (l) => <span title={l.catalogId}>{l.name}</span>, sort: (l) => l.name },
                  { key: 'v', header: C.subVehicles, cell: (l) => l.subscriptionVehicles, sort: (l) => l.subscriptionVehicles },
                  { key: 'd', header: C.subDays, cell: (l) => l.subscriptionDays, sort: (l) => l.subscriptionDays },
                  { key: 'b', header: C.purchases, cell: (l) => l.purchases, sort: (l) => l.purchases },
                  { key: 'c', header: C.conversions, cell: (l) => l.conversions, sort: (l) => l.conversions },
                  { key: 't', header: C.trials, cell: (l) => l.trialVehicles, sort: (l) => l.trialVehicles },
                ]}
              />
            </Panel>
            <Panel title={S.items}>
              <KeyValue rows={[{ k: S.cycle, v: u.cycle.description }, ...u.items.map((i) => ({ k: `${i.label} (${i.unit})`, v: i.rule, note: i.billable ? S.billable.yes : S.billable.no }))]} />
            </Panel>
          </>
        )}
      </AsyncView>
      <Panel title={S.history}>
        <AsyncView state={asyncState(hist, (hist.data?.items ?? []).length === 0)} error={hist.error} onRetry={() => hist.refetch()}>
          <DataTable
            caption={S.history}
            rows={hist.data?.items ?? []}
            rowKey={(t) => t.transmissionId}
            columns={[
              { key: 'at', header: H.at, cell: (t) => <span className="ds-mono ds-nowrap" title={t.transmissionId}>{when(t.at)}</span> },
              { key: 'p', header: H.period, cell: (t) => <span className="ds-mono">{t.period}</span> },
              { key: 's', header: H.status, cell: (t) => <VerdictBadge value={t.status === 'SENT' ? 'PASS' : 'FAIL'} label={S.states[t.status]} /> },
              { key: 'g', header: H.trigger, cell: (t) => <span className="ds-nowrap" title={personLabel(t.actorId)}>{`${S.triggers[t.trigger]} · ${personName(t.actorId)}`}</span> },
              { key: 'n', header: H.attempt, cell: (t) => S.attempt(t.attempt) },
              { key: 'r', header: H.receipt, cell: (t) => <span className="ds-mono">{t.receiptId ?? '—'}</span> },
              { key: 'e', header: H.reason, cell: (t) => <span style={{ fontSize: 'var(--fs-xs)' }}>{t.reason ?? '—'}</span> },
            ]}
          />
        </AsyncView>
      </Panel>
    </div>
  );
}
