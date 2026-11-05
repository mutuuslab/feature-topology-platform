import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkflowDoc } from '@ff/contracts';
import { Drawer } from '../../design';
import { useProgress } from '../../data/procedureProgress';
import { localTime, personLabel } from '../../data/people';
import { useAppShell } from '../../store';
import { workProduct as T } from '../../copy/work-product';

/** Model definition and persisted evidence are separate. Only explicit safe URLs become links. */
export function evidenceHref(value: string): string | undefined {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}

export function WorkProductButton({ doc, productKey, className = 'pf-linkbtn' }: { doc: WorkflowDoc; productKey: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const name = doc.processes.flatMap(p => p.workProducts).find(w => w.key === productKey)?.name ?? T.definition;
  return <><button type="button" className={className} aria-label={T.open(name)} onClick={() => setOpen(true)}>{name}</button>{open && <WorkProductDrawer doc={doc} productKey={productKey} onClose={() => setOpen(false)} />}</>;
}

export function WorkProductDrawer({ doc, productKey, onClose }: { doc: WorkflowDoc; productKey: string; onClose: () => void }) {
  const { role } = useAppShell();
  const progress = useProgress(role);
  const refs = doc.processes.flatMap(process => process.activities.map(activity => ({ process, activity })));
  const producers = refs.filter(({ activity }) => activity.outputs.includes(productKey));
  const consumers = refs.filter(({ activity }) => activity.inputs.includes(productKey));
  const owner = producers[0]?.process ?? doc.processes.find(p => p.workProducts.some(w => w.key === productKey));
  const product = owner?.workProducts.find(w => w.key === productKey) ?? doc.processes.flatMap(p => p.workProducts).find(w => w.key === productKey);
  const records = progress.items.filter(row => producers.some(({ activity }) => activity.id === row.activityId));
  const roleName = (id: string) => doc.roles.find(r => r.id === id)?.name ?? id;
  const activities = (items: typeof refs) => <ul className="pr-steps">{items.map(({ process, activity }) => <li key={activity.id}><Link to={`/procedures/${process.id}?a=${activity.id}`} onClick={onClose}>{activity.name}</Link><p className="ds-field__hint">{T.responsibility(activity.raci.R.map(roleName).join(', '), roleName(activity.raci.A))}</p></li>)}</ul>;
  return <Drawer open title={product?.name ?? T.definition} onClose={onClose}>
    <section aria-label={T.definition}><p className="ds-field__hint">{T.definitionHint}</p><h3>{T.content}</h3><ul className="pr-steps">{(product?.content ?? []).map((line, i) => <li key={i}>{line}</li>)}</ul></section>
    <section><h3>{T.producedBy}</h3>{producers.length ? activities(producers) : <p>{T.external}</p>}</section>
    <section><h3>{T.usedBy}</h3>{consumers.length ? activities(consumers) : <p>{T.none}</p>}</section>
    <section aria-label={T.records}><h3>{T.records}</h3>{(progress.status === 'loading' || progress.status === 'idle') ? <p role="status">{T.loading}</p> : progress.error ? <p role="alert">{T.error}</p> : !records.length ? <p className="ds-field__hint">{T.noRecords}</p> : records.map(row => <article key={row.activityId} className="pr-panel-item"><p>{personLabel(row.completedBy)} · {localTime(row.completedAt)}</p><p>{row.signatureValid === true ? T.signed : row.signatureValid === false ? T.invalid : T.unsigned}</p>{row.note && <p>{row.note}</p>}{row.evidence.length ? <ul>{row.evidence.map((e, i) => <li key={i}>{evidenceHref(e.ref) ? <a href={evidenceHref(e.ref)} target="_blank" rel="noopener noreferrer">{e.name}</a> : <span>{e.name} · {e.ref}</span>}</li>)}</ul> : <p>{T.noEvidence}</p>}</article>)}</section>
  </Drawer>;
}
