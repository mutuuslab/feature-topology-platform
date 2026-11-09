import { afterEach, describe, expect, it, vi } from 'vitest';
import { localAppHref, localNavigationTarget, siblingDocument } from '../file-routing';
import { gateLogin } from '../auth-gate';
import { loginWithServer, logout } from '../auth-demo';
import { externalUrl, openExternalWindow } from '../external/links';
const file = 'file:///C:/demo%20folder/index.html#/features?tab=all';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });
const fileWindow = () => vi.stubGlobal('window', { location: new URL(file) });
describe('standalone file routing and network boundary', () => {
  it('keeps sibling documents in an encoded folder without carrying the app hash', () => {
    expect(siblingDocument('external.html', file).href).toBe('file:///C:/demo%20folder/external.html');
    expect(localAppHref('/features/FEAT-00022/1.0.0?tab=ext', file)).toBe('file:///C:/demo%20folder/index.html#/features/FEAT-00022/1.0.0?tab=ext');
  });
  it('preserves HTTP routes and explicit external URLs', () => {
    expect(localAppHref('/policies/POL-00001', 'https://example.test/external.html')).toBe('/policies/POL-00001');
    expect(localAppHref('https://github.com/example/repo', file)).toBe('https://github.com/example/repo');
    expect(localAppHref('//example.test/a', file)).toBe('//example.test/a');
  });
  it('protects hash route and query changes but allows same-screen fragments', () => {
    expect(localNavigationTarget('#/other?view=flow', file)).toBe('/other?view=flow');
    expect(localNavigationTarget('#/features?tab=next', file)).toBe('/features?tab=next');
    expect(localNavigationTarget('#/features?tab=all#details', file)).toBeNull();
    expect(localNavigationTarget('external.html?system=jira', file)).toBeNull();
    expect(localNavigationTarget('https://example.test/#/other', file)).toBeNull();
    expect(localNavigationTarget('#//example.test/a', file)).toBeNull();
  });
  it('opens JIRA and codeBeamer as sibling HTML with selection and persona', () => {
    fileWindow();
    expect(externalUrl('jira', 'FFE-13', 'author')).toBe('file:///C:/demo%20folder/external.html?system=jira&key=FFE-13&role=author');
    expect(externalUrl('codebeamer', 'CB-10001', 'viewer')).toContain('external.html?system=codebeamer&key=CB-10001&role=viewer');
  });
  it('rewrites an internal popup target while retaining noopener and user-click behavior', () => {
    const open = vi.fn(); vi.stubGlobal('window', { location: new URL(file), open });
    const anchor = document.createElement('a'); anchor.setAttribute('href', '/policies/POL-00001#unleash-h');
    const preventDefault = vi.fn();
    openExternalWindow({ button: 0, currentTarget: anchor, preventDefault } as any);
    expect(anchor.href).toBe('file:///C:/demo%20folder/index.html#/policies/POL-00001#unleash-h');
    expect(open).toHaveBeenCalledWith(anchor.href, '_blank', expect.stringContaining('noopener,noreferrer'));
    expect(preventDefault).toHaveBeenCalledOnce();
  });
  it('never fetches a gate when file login succeeds or fails', async () => {
    fileWindow(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubEnv('VITE_DATA_MODE', 'static');
    expect(await gateLogin('FF', 'wrong')).toBe(false);
    expect(localStorage.getItem('ff.auth')).toBeNull();
    expect(await gateLogin('ff', 'ff')).toBe(true);
    expect(localStorage.getItem('ff.auth')).toBe('1');
    localStorage.setItem('ff.auth.gate', '1'); logout();
    expect(localStorage.getItem('ff.auth')).toBeNull();
    expect(await loginWithServer('ff', 'ff')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
