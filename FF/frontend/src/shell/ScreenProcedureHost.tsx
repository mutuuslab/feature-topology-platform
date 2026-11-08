import { lazy, Suspense, useRef, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Button, Drawer } from '../design';
import { procedurePanel as P } from '../copy/procedure-panel';

type PanelProps = { onClose: () => void; onRetry?: () => void };
type PanelLoader = () => Promise<{ default: ComponentType<PanelProps> }>;
const loadPanel: PanelLoader = () => import('./ScreenProcedure');
let recoveredPanel: ComponentType<PanelProps> | undefined;

/** Chrome retains failed module requests. Retry only this application's hashed panel asset. */
export function procedurePanelRetryUrl(error: unknown, origin: string, attempt: number): string | null {
  if (!(error instanceof Error) || !Number.isInteger(attempt) || attempt < 1) return null;
  const match = error.message.match(/https?:\/\/[^\s"'<>]+/);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    if (url.origin !== origin || url.username || url.password || !/^\/(?:[^/]+\/)*assets\/ScreenProcedure-[\w-]+\.js$/.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    url.searchParams.set('wfRetry', String(attempt));
    return url.href;
  } catch { return null; }
}

function PanelState({ onClose, onRetry, loading = false }: PanelProps & { loading?: boolean }) {
  return <Drawer open title={P.title} onClose={onClose}>
    <p role={loading ? 'status' : 'alert'}>{loading ? P.loading : P.loadFail}</p>
    {!loading && <Button onClick={onRetry}>{P.retry}</Button>}
    <p><Link to="/procedures?view=reference" onClick={onClose}>{P.all}</Link></p>
  </Drawer>;
}

/** Module and document failures both have visible recovery; no form reload or role mutation. */
export function ScreenProcedureHost({ onClose, loader = loadPanel }: { onClose: () => void; loader?: PanelLoader }) {
  const lastFailure = useRef<unknown>(null);
  const attempts = useRef(0);
  const makePanel = () => lazy<ComponentType<PanelProps>>(() => {
    if (loader === loadPanel && recoveredPanel) return Promise.resolve({ default: recoveredPanel });
    const retryUrl = procedurePanelRetryUrl(lastFailure.current, window.location.origin, attempts.current);
    const pending = retryUrl ? import(/* @vite-ignore */ retryUrl) : loader();
    return pending.then((m) => { if (loader === loadPanel) recoveredPanel = m.default; return m; }).catch((error) => {
      lastFailure.current = error;
      return { default: PanelState };
    });
  });
  const [Panel, setPanel] = useState(makePanel);
  const retry = () => { attempts.current += 1; setPanel(() => makePanel()); };
  return <Suspense fallback={<PanelState loading onClose={onClose} />}><Panel onClose={onClose} onRetry={retry} /></Suspense>;
}
