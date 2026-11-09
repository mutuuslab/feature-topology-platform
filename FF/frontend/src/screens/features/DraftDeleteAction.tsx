import { useState } from 'react';
import { actorFor } from '../../api/actor';
import { useApiMutation } from '../../api/hooks';
import { lcGate } from '../../copy/lifecycle-gate';
import { Button, Drawer, ErrorNote, Field } from '../../design';
import { usePermission } from '../shared';

/** Review the exact record; native/local transactions decide approval history, references and tombstones. */
export function DraftDeleteAction({ entity, id, version, lifecycle, createdBy, onDeleted }: { entity: 'feature' | 'relation'; id: string; version?: string; lifecycle: string; createdBy?: string | null; onDeleted?: () => void }) {
  const C = lcGate.draft, feature = entity === 'feature';
  const permission = usePermission(feature ? ['FEATURE_AUTHOR'] : ['FEATURE_AUTHOR', 'VARIANT_OWNER']);
  const me = actorFor(permission.role).id;
  const mutation = useApiMutation(feature ? 'deleteFeatureDraft' : 'deleteRelationDraft', ['featureDetail', 'listFeatures', 'dependencies', 'topologyGraph', 'audit', 'featureHistory', 'deletedDrafts']);
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  if (lifecycle !== 'PROPOSED') return null;
  const ownerBlocked = feature && !!createdBy && createdBy !== me;
  const why = !permission.ok ? permission.hint : ownerBlocked ? C.owner : undefined;
  const valid = reason.trim().length >= 4 && confirmed && !why;
  return <>
    <Button disabled={!!why} reason={why} data-ui={feature ? 'deleteFeatureDraft' : 'deleteRelationDraft'} onClick={() => { setOpen(true); setConfirmed(false); mutation.reset(); }}>{feature ? C.feature : C.relation}</Button>
    <Drawer open={open} title={feature ? C.feature : C.relation} onClose={() => setOpen(false)} dirty={!!reason}>
      <form style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid="draft-delete-review" onSubmit={event => { event.preventDefault(); if (!valid) return; mutation.mutate({ params: feature ? { id, ver: version! } : { id }, body: { reason: reason.trim() } }, { onSuccess: () => { setOpen(false); setReason(''); onDeleted?.(); } }); }}>
        <p className="ds-mono">{version ? `${id}@${version}` : id}</p>
        <p>{C.hint}</p>
        <Field label={C.reason}><textarea className="ds-input" rows={3} value={reason} onChange={event => setReason(event.target.value)} /></Field>
        <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start' }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{C.confirm}</span></label>
        <ErrorNote error={mutation.error} />
        <Button type="submit" variant="primary" disabled={!valid || mutation.isPending} reason={why ?? (reason.trim().length < 4 ? C.reasonHint : !confirmed ? C.confirm : undefined)}>{C.submit}</Button>
      </form>
    </Drawer>
  </>;
}
