// 컴플라이언스 룰 소유자 이관(B13) — 룰 상세 안. 소유자 계정이 없거나 비활성일 때만 보이고, 시스템 관리자가 룰 담당 역할의 사용 중 계정으로 옮긴다.
// 이관 이력이 있으면 함께 보인다. 판정은 서버(contracts ownerTransferBlocker)가 한다 — 화면은 같은 규칙으로 버튼을 막고 사유를 보인다.
import { useState } from 'react';
import { COMPLIANCE_RULE_ROLES, DEMO_PERSONAS, SYSTEM_ADMIN_ROLES, type AccountState, type AccountView, type OwnerTransfer } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { accounts as AC, ownerTransfer as T } from '../../copy/f0';
import { AsyncView, Button, DataTable, ErrorNote, Field, KeyValue, Panel, Select, VerdictBadge } from '../../design';
import { personLabel } from '../ops/shared';
import { usePermission } from '../shared';

const INVALIDATE = ['complianceRules', 'complianceRule', 'accounts'];
const t16 = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const RULE_ROLES = COMPLIANCE_RULE_ROLES as readonly string[];

export function OwnerTransferPanel({ ruleId, ownerId, ownerState, transfers }: { ruleId: string; ownerId: string; ownerState?: AccountState; transfers?: OwnerTransfer[] }) {
  const open = ownerState === 'INACTIVE' || ownerState === 'ABSENT';
  const history = transfers ?? [];
  const perm = usePermission(SYSTEM_ADMIN_ROLES);
  const acc = useApi<{ items: AccountView[] }>('accounts', {}, { enabled: open });
  const m = useApiMutation('transferComplianceRuleOwner', INVALIDATE);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  if (!open && !history.length) return null;
  // 새 소유자 후보 — 사용 중이고 룰 담당 역할(법규·기능안전·사이버보안)을 가진 계정
  const candidates = (acc.data?.items ?? []).filter((a) => a.state === 'ACTIVE' && a.id !== ownerId && (a.roles ?? DEMO_PERSONAS[a.id.replace(/^usr-/, '')] ?? []).some((r) => RULE_ROLES.includes(r)));
  const why = perm.hint ?? (!to ? T.to : reason.trim().length < 4 ? AC.reasonHint : undefined);
  return (
    <Panel title={T.panel} id="owner-transfer">
      <KeyValue rows={[{ k: T.ownerState, v: <VerdictBadge value={open ? 'FAIL' : 'PASS'} label={`${personLabel(ownerId)} · ${AC.state[ownerState ?? 'UNKNOWN']}`} /> }]} />
      {open && (
        <>
          <p className="ds-field__hint">{T.lead}</p>
          <AsyncView state={asyncState(acc)} error={acc.error} onRetry={() => acc.refetch()} rows={1}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
              <Select label={T.to} value={to} onChange={(e) => setTo(e.target.value)} disabled={!perm.ok}>
                <option value="">—</option>
                {candidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {personLabel(a.id)}
                  </option>
                ))}
              </Select>
              <Field label={T.reason}>
                <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!perm.ok} />
              </Field>
              <Button variant="primary" disabled={!!why || m.isPending} reason={why} onClick={() => m.mutate({ params: { id: ruleId }, body: { toOwnerId: to, reason: reason.trim() } }, { onSuccess: () => (setTo(''), setReason('')) })}>
                {T.submit}
              </Button>
            </div>
          </AsyncView>
          <ErrorNote error={m.error} />
        </>
      )}
      {history.length > 0 && (
        <DataTable
          caption={T.history}
          rows={history}
          rowKey={(x) => `${x.at}-${x.toOwnerId}`}
          pageSize={0}
          columns={[
            { key: 'at', header: T.col.at, cell: (x) => <span className="ds-mono ds-nowrap">{t16(x.at)}</span> },
            { key: 'f', header: T.col.from, cell: (x) => `${x.fromOwnerId ? personLabel(x.fromOwnerId) : '—'} ${T.fromState(AC.state[x.fromState])}` },
            { key: 't', header: T.col.to, cell: (x) => personLabel(x.toOwnerId) },
            { key: 'b', header: T.col.by, cell: (x) => personLabel(x.by) },
            { key: 'r', header: T.col.reason, cell: (x) => x.reason },
          ]}
        />
      )}
    </Panel>
  );
}
