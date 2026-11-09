import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { ROUTES } from '../routes';
import RouteBoundary from '../components/RouteBoundary';
import { AsyncView } from '../design';

const TwinProvider = lazy(() => import('./twinStore').then(module => ({ default: module.TwinProvider })));

/** Start the isolated mock Twin only when its first screen is opened; retain that same provider thereafter. */
export function DeferredTwinProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const needed = ROUTES.some(route => route.twin && matchPath(route.path, pathname));
  const [started, setStarted] = useState(needed);
  useEffect(() => { if (needed) setStarted(true); }, [needed]);
  if (!needed && !started) return <>{children}</>;
  return <RouteBoundary><Suspense fallback={<main aria-busy="true" data-twin-loading><AsyncView state="loading">{null}</AsyncView></main>}><TwinProvider>{children}</TwinProvider></Suspense></RouteBoundary>;
}
