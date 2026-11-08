import { Link } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { actorFor, canAct } from '../../api/actor';
import { procurementHome as T } from '../../copy/procurement-home';
import { AsyncView, Button, KeyValue, Panel, SummaryLine } from '../../design';
import { useAppShell } from '../../store';
import { costHomeSummary, supplierHomeGroups } from './procurement-model';
import type { CostListItem } from '../cost/common';

const LIMIT = 5;
const costPath = (id: string) => `/procurement/sw-cost/${encodeURIComponent(id)}`;

function CostRows({ rows, empty }: { rows: CostListItem[]; empty: string }) {
  return rows.length ? <>
    <ul className="ws-work ws-work--dense">
      {rows.slice(0, LIMIT).map((p) => <li key={p.estId}><Link className="ws-work__name" to={costPath(p.estId)}>{p.estId} · {p.name}</Link></li>)}
    </ul>
    {rows.length > LIMIT && <p className="ds-field__hint">{T.more(rows.length - LIMIT)}</p>}
  </> : <p className="ds-field__hint">{empty}</p>;
}

function BadData({ retry }: { retry: () => unknown }) {
  return <div><p role="alert">{T.badData}</p><Button onClick={() => void retry()}>{T.retry}</Button></div>;
}

export default function ProcurementWork() {
  const costs = useApi<unknown>('costProjects');
  const suppliers = useApi<unknown>('supplierDeliveries');
  const { role } = useAppShell();
  const cost = costHomeSummary(costs.data);
  const groups = supplierHomeGroups(suppliers.data);
  const reviewer = canAct(role, ['COST_APPROVER']);
  const me = actorFor(role, ['COST_APPROVER']).id;
  const submitted = cost?.submitted.filter((p) => !reviewer || p.createdBy !== me) ?? [];
  return <div className="ws-split">
    <section data-procurement-section="cost">
      <Panel title={T.cost} id="ws-procurement-cost">
        <p className="ds-field__hint">{T.scope}</p>
        <AsyncView state={asyncState(costs)} error={costs.error} onRetry={() => costs.refetch()} rows={5}>
          {!cost ? <BadData retry={() => costs.refetch()} /> : <div className="ds-stack">
            <SummaryLine label={T.cost} items={[{ k: T.projects, v: cost.items.length }, { k: T.draft, v: cost.drafts.length }, { k: T.submitted, v: cost.submitted.length }, { k: T.approved, v: cost.approved }]} />
            <KeyValue rows={[
              ...(cost.view === 'FULL' ? [{ k: T.approvedCost, v: <span data-approved-cost-krw>{T.money(cost.approvedKrw)}</span> }] : []),
              { k: T.approvedMm, v: <span data-approved-mm>{T.mm(cost.approvedMm)}</span> },
            ]} />
            <p className="ds-field__hint">{cost.view === 'FULL' ? T.krwBasis : T.mmOnly}</p>
            {!!cost.incomplete && <p role="status" data-cost-incomplete>{T.incomplete(cost.incomplete)}</p>}
            <div data-cost-reviewable={reviewer ? '' : undefined}>
              <h3>{reviewer ? T.reviewable : T.submissions}</h3>
              <p className="ds-field__hint">{reviewer ? T.reviewHint : T.submissionsHint}</p>
              <CostRows rows={submitted} empty={T.noSubmitted} />
            </div>
            <div><h3>{T.drafts}</h3><CostRows rows={cost.drafts} empty={T.noDraft} /></div>
          </div>}
        </AsyncView>
        <p className="ws-actions"><Link to="/procurement/sw-cost">{T.allCost}</Link><Link to="/procurement/sw-cost/basis">{T.basis}</Link></p>
      </Panel>
    </section>
    <section data-procurement-section="supplier">
      <Panel title={T.supplier} id="ws-procurement-suppliers">
        <p className="ds-field__hint">{T.supplierHint}</p>
        <AsyncView state={asyncState(suppliers)} error={suppliers.error} onRetry={() => suppliers.refetch()} rows={5}>
          {!groups ? <BadData retry={() => suppliers.refetch()} /> : !groups.length ? <p className="ds-field__hint">{T.supplierEmpty}</p> : <ul className="ws-work">
            {groups.slice(0, LIMIT).map((g) => <li key={g.supplier}><Link className="ws-work__name" to={`/supplier/portal?supplier=${encodeURIComponent(g.supplier)}`}>{g.supplier || T.unknownSupplier} · {T.count(g.count)}</Link></li>)}
          </ul>}
        </AsyncView>
        {!!groups && groups.length > LIMIT && <p className="ds-field__hint">{T.more(groups.length - LIMIT)}</p>}
        <p className="ws-more"><Link to="/supplier/portal">{T.allSupplier}</Link></p>
      </Panel>
    </section>
  </div>;
}
