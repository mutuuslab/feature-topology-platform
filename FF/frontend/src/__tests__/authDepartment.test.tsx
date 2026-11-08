import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let department: string | undefined;
const USER = { id: 'real-purchaser', name: '회사 구매', email: 'real@example.test', roles: ['COST_ESTIMATOR'] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_AUTH', 'oidc'); vi.stubEnv('VITE_DATA_MODE', ''); vi.resetModules();
  department = 'DEP-PUR';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url) === '/api/auth/me') return json({ authenticated: true, user: { ...USER, ...(department ? { department } : {}) } });
    if (String(url).startsWith('/api/cost/projects')) return json({ items: [], view: 'MM_ONLY' });
    return json({ items: [], total: 0, open: 0, overdue: 0 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });

async function prepare() {
  const auth = await import('../auth-oidc'); await auth.refreshSso();
  const store = await import('../store');
  return { ...store, actor: await import('../api/actor') };
}
describe('SSO 신원으로 선택한 팀 홈', () => {
  it('서버 부서가 브라우저에 남은 데모 부서보다 우선하며 로그인 역할을 추가하지 않는다', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer', department: 'DEP-LEG' }));
    const { AppProvider, useAppShell, actor } = await prepare();
    function Probe() { return <output>{useAppShell().department}</output>; }
    render(<AppProvider><Probe /></AppProvider>);
    expect(screen.getByRole('status').textContent).toBe('DEP-PUR');
    expect(actor.rolesFor('approver')).toEqual(['COST_ESTIMATOR']);
    expect(actor.canAct('approver', ['COST_APPROVER'])).toBe(false);
  });
  for (const value of [undefined, 'DEP-NOT-IN-MODEL']) it(`${value ?? '미설정'} 부서는 저장된 데모 선택을 무시하고 공통 컨텍스트로 돌아간다`, async () => {
    department = value;
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer', department: 'DEP-LEG' }));
    const { AppProvider, useAppShell } = await prepare();
    function Probe() { return <output>{useAppShell().department}</output>; }
    render(<AppProvider><Probe /></AppProvider>);
    expect(screen.getByRole('status').textContent).toBe('ALL');
  });
  it('내 업무도 데모 겸직 역할이 아니라 SSO가 실제 부여한 산정 역할만 사용한다', async () => {
    await prepare();
    const { myOrgRoles } = await import('../screens/workspaces/common');
    const { WORKFLOWS } = await import('../../../contracts/src/generated/workflows');
    const full = WORKFLOWS.departments.find((d) => d.id === 'DEP-PUR')!;
    expect(myOrgRoles({ doc: WORKFLOWS, full }, 'viewer')).toEqual(['R-CE']);
  });
  it('검증된 구매 부서 로그인은 실제 구매 홈을 열되 부서/데모 역할 전환기를 추가하지 않는다', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer', department: 'DEP-LEG' }));
    const { AppProvider } = await prepare(); const { HomeScreen } = await import('../screens/home/Inbox');
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider><HomeScreen /></AppProvider></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(document.querySelector('[data-procurement-section="cost"]')).not.toBeNull());
    expect(screen.queryByRole('combobox', { name: '담당 부서' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '부서 안 역할' })).toBeNull();
    expect(document.querySelector('[data-workspace-home]')).toBeNull();
    expect(document.querySelector('[data-team-home="portal"]')).not.toBeNull();
  });
  for (const [value, workspace] of [['DEP-PUR', 'portal'], ['DEP-OPS', 'control'], [undefined, undefined]] as const) it(`${value ?? '미설정'} SSO 팀 토큰은 적용하되 전역 메뉴 레이아웃을 유지한다`, async () => {
    department = value;
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer', department: 'DEP-LEG' }));
    const { AppProvider } = await prepare();
    const { Shell } = await import('../shell/Shell');
    const { MotionProvider } = await import('../state/motion');
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><MotionProvider><AppProvider><Shell><h1>본문</h1></Shell></AppProvider></MotionProvider></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('heading', { name: '본문' });
    expect(document.documentElement.getAttribute('data-workspace')).toBe(workspace ?? null);
    expect(document.documentElement.getAttribute('data-zone')).toBe(workspace === 'control' ? 'ops' : null);
    expect(document.querySelector('.sh-rail')).not.toBeNull();
    expect(document.querySelector('.sh')?.hasAttribute('data-workspace')).toBe(false);
    expect(document.querySelector('[data-dept-nav]')).toBeNull();
    expect(screen.queryByRole('combobox', { name: '담당 부서' })).toBeNull();
  });
});
