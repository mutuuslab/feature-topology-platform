import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Button, Drawer } from '../design';
import { procedurePanel as P } from '../copy/procedure-panel';

type PanelProps = { onClose: () => void; onRetry?: () => void };
type PanelLoader = () => Promise<{ default: ComponentType<PanelProps> }>;
const loadPanel: PanelLoader = () => import('./ScreenProcedure');

function PanelState({ onClose, onRetry, loading = false }: PanelProps & { loading?: boolean }) {
  return <Drawer open title={P.title} onClose={onClose}>
    <p role={loading ? 'status' : 'alert'}>{loading ? P.loading : P.loadFail}</p>
    {!loading && <Button onClick={onRetry}>{P.retry}</Button>}
    <p><Link to="/procedures?view=reference" onClick={onClose}>{P.all}</Link></p>
  </Drawer>;
}

/** Module and document failures both have visible recovery; no form reload or role mutation. */
export function ScreenProcedureHost({ onClose, loader = loadPanel }: { onClose: () => void; loader?: PanelLoader }) {
  const makePanel = () => lazy<ComponentType<PanelProps>>(() => loader().catch(() => ({ default: PanelState })));
  const [Panel, setPanel] = useState(makePanel);
  const retry = () => setPanel(() => makePanel());
  return <Suspense fallback={<PanelState loading onClose={onClose} />}><Panel onClose={onClose} onRetry={retry} /></Suspense>;
}
