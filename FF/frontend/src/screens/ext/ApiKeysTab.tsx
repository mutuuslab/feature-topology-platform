// 외부 연계 현황 'API 키' 탭(D05-01, FR-AGW-001-003~005) — 외부 시스템 키 목록(상태·마지막 사용), 발급(원문은 한 번만 보임), 삭제(이유).
// 키 원문은 발급 응답에만 있다 — 서랍을 닫으면 화면 상태에서도 지운다. 탭을 열 때만 읽는다.
import { useState } from 'react';
import { API_KEY_ADMIN_ROLES, API_KEY_ROLES, type ApiKeyView, type IssuedApiKey } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { apiKeys as K } from '../../copy/ext-gateway';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Toolbar, VerdictBadge } from '../../design';
import { personLabel, personName } from '../../data/people';
import { usePermission, when } from '../shared';

const STATE_BADGE: Record<string, string> = { ACTIVE: 'PASS', EXPIRED: 'CONDITIONAL', REVOKED: 'FAIL' };
const INVALIDATE = ['apiKeys', 'audit', 'events'];

export default function ApiKeysTab() {
  const q = useApi<{ items: ApiKeyView[] }>('apiKeys');
  const perm = usePermission(API_KEY_ADMIN_ROLES);
  const [issuing, setIssuing] = useState(false);
  const [secret, setSecret] = useState<IssuedApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const rows = q.data?.items ?? [];
  const C = K.col;
  return (
    <div className="ds-stack" data-testid="api-keys">
      <p className="ds-field__hint">{K.lead}</p>
      <Toolbar label={K.tab}>
        <span className="ds-badge">{K.key(rows.filter((r) => r.state === 'ACTIVE').length, rows.length)}</span>
        <Button variant="primary" disabled={!perm.ok} reason={perm.hint} onClick={() => setIssuing(true)}>
          {K.issue}
        </Button>
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={K.tab}
          rows={rows}
          rowKey={(r) => r.keyId}
          columns={[
            { key: 'k', header: C.key, cell: (r) => <span className="ds-mono ds-nowrap" title={r.keyId}>{r.prefix}</span> },
            { key: 'n', header: C.name, cell: (r) => r.name },
            { key: 's', header: C.system, cell: (r) => r.system },
            { key: 'r', header: C.role, cell: (r) => <span className="ds-nowrap">{K.roles[r.role] ?? r.role}</span> },
            { key: 't', header: C.state, cell: (r) => <VerdictBadge value={STATE_BADGE[r.state]} label={K.states[r.state]} />, sort: (r) => r.state },
            { key: 'e', header: C.expires, cell: (r) => <span className="ds-mono ds-nowrap">{r.expiresOn}</span>, sort: (r) => r.expiresOn },
            { key: 'u', header: C.used, cell: (r) => <span className="ds-nowrap">{r.lastUsedAt ? when(r.lastUsedAt) : K.neverUsed}</span> },
            { key: 'b', header: C.by, cell: (r) => <span className="ds-nowrap" title={personLabel(r.createdBy)}>{`${personName(r.createdBy)} · ${when(r.createdAt)}`}</span> },
            {
              key: 'a',
              header: C.action,
              cell: (r) =>
                r.state === 'REVOKED' ? (
                  <span className="ds-field__hint">{r.revokeReason ?? ''}</span>
                ) : (
                  <Button variant="danger" disabled={!perm.ok} title={perm.hint} onClick={() => setRevoking(r)}>
                    {K.revoke.action}
                  </Button>
                ),
            },
          ]}
        />
      </AsyncView>
      <IssueDrawer open={issuing} onClose={() => setIssuing(false)} onIssued={(k) => (setIssuing(false), setSecret(k))} />
      <Drawer open={!!secret} title={K.issued.title} onClose={() => setSecret(null)}>
        {secret && (
          <div className="ds-stack">
            <p className="ds-stale" role="status">{K.issued.warn}</p>
            <code className="ds-mono" style={{ wordBreak: 'break-all', fontSize: 'var(--fs-sm)' }}>{secret.secret}</code>
            <p className="ds-field__hint">{K.issued.header}</p>
            <Button variant="primary" onClick={() => setSecret(null)}>
              {K.issued.close}
            </Button>
          </div>
        )}
      </Drawer>
      <RevokeDrawer target={revoking} onClose={() => setRevoking(null)} />
    </div>
  );
}

function IssueDrawer({ open, onClose, onIssued }: { open: boolean; onClose: () => void; onIssued: (k: IssuedApiKey) => void }) {
  const F = K.form;
  const issue = useApiMutation<IssuedApiKey>('issueApiKey', INVALIDATE);
  const [name, setName] = useState('');
  const [system, setSystem] = useState('');
  const [role, setRole] = useState<(typeof API_KEY_ROLES)[number]>('SYSTEM');
  const [expiresOn, setExpires] = useState('');
  const [reason, setReason] = useState('');
  const dirty = !!(name || system || reason);
  const reset = () => (setName(''), setSystem(''), setRole('SYSTEM'), setExpires(''), setReason(''), issue.reset());
  const ready = name.trim().length >= 2 && system.trim().length >= 2 && reason.trim().length >= 2;
  return (
    <Drawer open={open} title={F.title} dirty={dirty} onClose={() => (reset(), onClose())}>
      <div className="ds-stack">
        <Field label={F.name}>
          <input className="ds-input" value={name} placeholder={F.namePlaceholder} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={F.system}>
          <input className="ds-input" value={system} placeholder={F.systemPlaceholder} onChange={(e) => setSystem(e.target.value)} />
        </Field>
        <Field label={F.role}>
          <select className="ds-select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            {API_KEY_ROLES.map((r) => (
              <option key={r} value={r}>
                {K.roles[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={F.expires}>
          <input className="ds-input ds-input--mono" type="date" value={expiresOn} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label={F.reason}>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={issue.error} />
        <Button
          variant="primary"
          disabled={!ready || issue.isPending}
          onClick={() => issue.mutate({ body: { name: name.trim(), system: system.trim(), role, ...(expiresOn ? { expiresOn } : {}), reason: reason.trim() } }, { onSuccess: (k) => (reset(), onIssued(k)) })}
        >
          {F.submit}
        </Button>
      </div>
    </Drawer>
  );
}

function RevokeDrawer({ target, onClose }: { target: ApiKeyView | null; onClose: () => void }) {
  const R = K.revoke;
  const revoke = useApiMutation('revokeApiKey', INVALIDATE);
  const [reason, setReason] = useState('');
  const close = () => (setReason(''), revoke.reset(), onClose());
  return (
    <Drawer open={!!target} title={R.title(target?.keyId ?? '')} dirty={!!reason} onClose={close}>
      <div className="ds-stack">
        <p>{R.body}</p>
        <Field label={R.reason}>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={revoke.error} />
        <Button variant="danger" disabled={reason.trim().length < 2 || revoke.isPending} onClick={() => revoke.mutate({ params: { id: target!.keyId }, body: { reason: reason.trim() } }, { onSuccess: close })}>
          {R.confirm}
        </Button>
      </div>
    </Drawer>
  );
}
