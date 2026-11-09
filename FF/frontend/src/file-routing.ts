/** Browser-only standalone delivery. HTTP deployments keep their existing routes. */
export const isLocalFile = () => typeof window !== 'undefined' && window.location.protocol === 'file:';

export function siblingDocument(name: 'index.html' | 'external.html', here = window.location.href): URL {
  return new URL(name, here);
}

/** Root-relative application routes must stay beside index.html on file://. */
export function localAppHref(path: string, here = window.location.href): string {
  if (!here.startsWith('file:') || !/^\/(?!\/)/.test(path)) return path;
  const url = siblingDocument('index.html', here);
  url.hash = path;
  return url.href;
}

/** HashRouter navigation, excluding a same-screen fragment and other documents. */
export function localNavigationTarget(href: string, here: string): string | null {
  const current = new URL(here), target = new URL(href, current);
  if (current.protocol !== 'file:' || target.protocol !== 'file:' || target.pathname !== current.pathname || target.search !== current.search) return null;
  const route = target.hash.slice(1) || '/', before = current.hash.slice(1) || '/';
  if (!/^\/(?!\/)/.test(route) || route.split('#')[0] === before.split('#')[0]) return null;
  return route;
}
