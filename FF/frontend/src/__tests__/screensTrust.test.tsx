// 커널 신뢰 기반(WP0) 화면 — 감사 해시 체인 무결성(FFG-PLT-015)과 보고서 승인 역할 대응(FFG-PLT-016).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { AuditScreen } from '../screens/governance/AuditEvents';
import { IamScreen } from '../screens/admin/Access';

type Handler = (url: string) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const r = handler(url) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => (cleanup(), vi.unstubAllGlobals()));

function mount(path: string, el: JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('감사 이력 — 해시 체인 (FFG-PLT-015)', () => {
  it('무결하면 검증한 행 수와 마지막 해시를 머리말에 보인다', async () => {
    handler = (u) => (u.startsWith('/api/audit/chain') ? { body: { ok: true, verified: 42, head: 'abcdef0123456789', broken: null } } : u.startsWith('/api/audit') ? { body: { items: [] } } : undefined);
    mount('/audit', <AuditScreen />);
    // 핵심 메시지 하나에 판정·검증 수·마지막 해시(3초 테스트)
    expect(await screen.findByText('해시 체인 정상 — 42건 검증, 위변조 없음')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('끊기면 끊긴 행과 이유를 경고한다', async () => {
    handler = (u) => (u.startsWith('/api/audit/chain') ? { body: { ok: false, verified: 7, head: 'x', broken: { id: 8, kind: 'hash' } } } : u.startsWith('/api/audit') ? { body: { items: [] } } : undefined);
    mount('/audit', <AuditScreen />);
    expect((await screen.findByRole('alert')).textContent).toBe('8번 행에서 체인이 끊겼습니다 — 내용이 바뀌었습니다');
    expect(screen.getByText('해시 체인이 끊겼습니다 — 위변조 의심')).toBeTruthy();
  });
});

describe('IAM — 보고서 승인 역할 대응 (FFG-PLT-016)', () => {
  it('FSM·CSM은 Kill 요청자(운영자)가 아닌 데모 사용자가 맡고, 복원용 부 FSM이 따로 있다 — OPS_LEAD는 겸직을 없애려 데모 계정에 두지 않는다', async () => {
    handler = (u) => (u.startsWith('/api/iam/roles') ? { body: { roles: [], humanRoles: [], permissions: [], sod: [] } } : u.startsWith('/api/iam/denials') ? { body: { items: [] } } : undefined);
    mount('/admin/iam', <IamScreen />);
    const table = await screen.findByRole('table', { name: /보고서 승인 역할 대응/ });
    const row = (r: string) => within(table).getAllByText(r)[0].closest('tr')!.textContent!;
    expect(row('FSM')).toContain('품질 검토');
    expect(row('FSM')).toContain('시스템 연계');
    expect(row('CSM')).toContain('시스템 연계');
    expect(row('OPS_LEAD')).not.toContain('협의와 개발 이관');
    for (const r of ['FSM', 'CSM', 'OPS_LEAD']) expect(row(r)).not.toContain('차량 운영');
  });
});
