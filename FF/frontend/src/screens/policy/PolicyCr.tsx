// 정책 상세 — 근거 변경요청(JIRA CR). CR 흐름의 주인은 JIRA: 여기서는 연결하고, 플랫폼 정책 상태가 CR에 반영되었는지 본다.
import { useState } from 'react';
import type { ExtLink } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { extSync } from '../../copy/ext-sync';
import { AsyncView, Button, ErrorNote, ExtRefChip, Field, Panel } from '../../design';
import { usePermission } from '../shared';

const X = extSync.policy;

export function PolicyCrPanel({ policyId }: { policyId: string }) {
  const q = useApi<{ items: ExtLink[] }>('policyExtLinks', { params: { id: policyId } });
  const perm = usePermission(['FEATURE_AUTHOR', 'RELEASE_MANAGER']);
  const link = useApiMutation('linkPolicyChangeRequest', ['policyExtLinks', 'extChangeRequests', 'extFeatureTrace']);
  const [crKey, setCrKey] = useState('');
  const crs = (q.data?.items ?? []).filter((l) => l.kind === 'CHANGE_REQUEST');
  return (
    <Panel title={X.title} id="policy-cr">
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {crs.length ? (
          <span className="ds-ext-list" data-testid="policy-cr">
            {crs.map((c) => (
              <ExtRefChip key={c.key} r={c} />
            ))}
          </span>
        ) : (
          <p className="ds-field__hint" style={{ color: 'var(--danger)' }}>
            {X.none}
          </p>
        )}
      </AsyncView>
      {perm.ok && (
      <form
        style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          link.mutate({ params: { id: policyId }, body: { crKey: crKey.trim() } }, { onSuccess: () => setCrKey('') });
        }}
      >
        <Field label={X.crKey}>
          <input className="ds-input ds-input--mono" value={crKey} onChange={(e) => setCrKey(e.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9]+-[0-9]+" required disabled={!perm.ok} />
        </Field>
        <Button type="submit" disabled={!perm.ok || link.isPending || !crKey.trim()} title={perm.hint}>
          {link.isPending ? X.linking : X.link}
        </Button>
      </form>
      )}
      <ErrorNote error={link.error} />
    </Panel>
  );
}
