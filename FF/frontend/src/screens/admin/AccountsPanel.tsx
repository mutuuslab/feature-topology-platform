// 계정 상태 패널(D06-09, 시스템 관리자) — /admin/iam. 목록은 누구나 보고, 비활성·재활성 기록은 시스템 관리자만(사유 필수, 자기 계정 제외).
// 상태 판정은 서버(kernel/account-directory, contracts accountStateOf).
import { useState } from 'react';
import { ROLE_LABEL, SYSTEM_ADMIN_ROLES, type AccountView } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { accounts as A } from '../../copy/f0';
import { AsyncView, Button, DataTable, ErrorNote, Field, Panel, VerdictBadge } from '../../design';
import { personLabel } from '../ops/shared';
import { usePermission } from '../shared';

const STATE_VERDICT: Record<string, string> = { ACTIVE: 'PASS', INACTIVE: 'FAIL', ABSENT: 'UNJUDGED', UNKNOWN: 'CONDITIONAL' };
const INVALIDATE = ['accounts', 'complianceRule'];
const t16 = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

export function AccountsPanel() {
  const q = useApi<{ items: AccountView[] }>('accounts');
  const perm = usePermission(SYSTEM_ADMIN_ROLES);
  const me = actorFor(perm.role, SYSTEM_ADMIN_ROLES).id;
  const off = useApiMutation('deactivateAccount', INVALIDATE);
  const on = useApiMutation('reactivateAccount', INVALIDATE);
  const [reason, setReason] = useState('');
  const items = q.data?.items ?? [];
  const ready = reason.trim().length >= 4;
  const act = (a: AccountView) => {
    const why = perm.hint ?? (a.id === me ? A.self : !ready ? A.reasonHint : undefined);
    const m = a.state === 'INACTIVE' ? on : off;
    return (
      <Button variant="ghost" disabled={!!why || m.isPending} reason={why} onClick={() => m.mutate({ params: { id: a.id }, body: { reason: reason.trim() } }, { onSuccess: () => setReason('') })}>
        {a.state === 'INACTIVE' ? A.reactivate : A.deactivate}
      </Button>
    );
  };
  return (
    <Panel title={A.panel} id="accounts" eyebrow={A.key(items.filter((a) => a.state === 'INACTIVE').length)}>
      <p className="ds-field__hint">{A.lead}</p>
      <Field label={A.reason}>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!perm.ok} />
      </Field>
      <ErrorNote error={off.error ?? on.error} />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()} rows={4}>
        <DataTable
          caption={A.panel}
          rows={items}
          rowKey={(a) => a.id}
          columns={[
            { key: 'a', header: A.col.account, cell: (a) => personLabel(a.id) },
            { key: 'r', header: A.col.roles, cell: (a) => <span style={{ fontSize: 'var(--fs-xs)' }}>{(a.roles ?? []).map((r) => ROLE_LABEL[r]).join(' · ') || '—'}</span> },
            { key: 's', header: A.col.state, cell: (a) => <VerdictBadge value={STATE_VERDICT[a.state]} label={A.state[a.state]} /> },
            { key: 'c', header: A.col.changed, cell: (a) => (a.changedAt ? <span style={{ fontSize: 'var(--fs-xs)' }}>{A.changed(personLabel(a.changedBy ?? ''), t16(a.changedAt), a.reason ?? '')}</span> : '—') },
            { key: 'x', header: '', cell: act },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}
