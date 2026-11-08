import { useEffect, useState } from 'react';
import { propose as P } from '../../../copy/propose';
import { STATIC_MODE } from '../../../api/client';
import { Button, Drawer } from '../../../design';
import type { PickedRef } from './prefill';

export function RegistrationReview({ draft, picked, cps, onClose, onRegister }: {
  draft: { name: string; description: string; country: string; vehicleModel: string; trim: string; ownerId: string; asil: string; requirementIds: string };
  picked: readonly PickedRef[];
  cps: readonly string[];
  onClose: () => void;
  onRegister: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  // An automatic scope update must be acknowledged again before it can be saved.
  useEffect(() => setConfirmed(false), [draft.country, draft.vehicleModel, draft.trim]);
  return (
    <Drawer open title={P.review.title} onClose={onClose}>
      <div className="ds-stack" data-testid="registration-review">
        <p>{P.review.lead}</p>
        {STATIC_MODE && <p className="ds-callout" data-tone="neutral">{P.review.staticHint}</p>}
        <dl className="propose-review">
          <div><dt>{P.review.name}</dt><dd><strong>{draft.name}</strong><p className="propose-document__body">{draft.description}</p></dd></div>
          <div><dt>{P.review.scope}</dt><dd data-review-scope>{draft.country} / {draft.vehicleModel} / {draft.trim}</dd></div>
          <div><dt>{P.review.owner}</dt><dd>{draft.ownerId}</dd></div>
          <div><dt>{P.review.asil}</dt><dd>ASIL {draft.asil}</dd></div>
          <div><dt>{P.review.refs}</dt><dd><ul>{picked.map((p) => <li key={p.ref.refId}><b>{P.role[p.role]}</b>: {p.ref.nameKo} <span className="ds-mono">{p.ref.refId}</span></li>)}</ul></dd></div>
          <div><dt>{P.review.requirements}</dt><dd>{draft.requirementIds.trim() || P.review.noneRequirements}</dd></div>
          <div><dt>{P.review.controls}</dt><dd>{cps.join(', ') || P.review.noneControls}</dd></div>
        </dl>
        <label className="propose-acknowledge"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{P.review.acknowledge}</label>
        <div className="propose-actions">
          <Button onClick={onClose}>{P.review.back}</Button>
          <Button variant="primary" data-ui="createFeature" disabled={!confirmed} reason={!confirmed ? P.review.acknowledgeWhy : undefined} onClick={onRegister}>{P.review.submit}</Button>
        </div>
      </div>
    </Drawer>
  );
}
