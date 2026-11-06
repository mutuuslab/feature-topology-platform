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
  // ADS-BE19 — 고정점 대조는 의심 구간·마지막 일치 고정점을 돌려준다. 끝·고정점 불일치를 "앞 행이 사라짐"으로, 읽을 수 없는 줄을 "-1번 행"으로 보이던 결함
  const chainOf = (body: unknown) => (u: string) => (u.startsWith('/api/audit/chain') ? { body } : u.startsWith('/api/audit') ? { body: { items: [] } } : undefined);
  it('고정점과 어긋나면 의심 구간과 마지막으로 맞은 고정점을 보인다', async () => {
    handler = chainOf({ ok: false, verified: 45, head: 'x', broken: { id: 45, kind: 'anchor', range: { from: 41, to: 45 } }, anchors: { configured: true, checked: 44, lastAt: '2026-11-05T01:00:00.000Z', lastMatched: { id: 40, at: '2026-11-05T00:59:00.000Z', kid: 'audit-hmac-1' } } });
    mount('/audit', <AuditScreen />);
    expect((await screen.findByRole('alert')).textContent).toBe('서명한 고정점과 맞지 않습니다 — 의심 구간 41~45번 행 · 마지막으로 맞은 고정점 40번 행');
  });
  it('끝 행이 사라지면 끝 행과 의심 구간, 고정점 파일에 읽을 수 없는 줄이 있으면 행 번호 없이 알린다', async () => {
    handler = chainOf({ ok: false, verified: 44, head: 'x', broken: { id: 45, kind: 'head', range: { from: 45, to: 45 } }, anchors: { configured: true, checked: 44, lastAt: null, lastMatched: { id: 44, at: '2026-11-05T00:59:00.000Z', kid: null } } });
    const first = mount('/audit', <AuditScreen />);
    expect((await screen.findByRole('alert')).textContent).toBe('마지막으로 기록한 45번 행이 사라졌거나 바뀌었습니다 — 의심 구간 45~45번 행 · 마지막으로 맞은 고정점 44번 행');
    first.unmount();
    handler = chainOf({ ok: false, verified: 44, head: 'x', broken: { id: -1, kind: 'anchor' }, anchors: { configured: true, checked: 43, lastAt: null, lastMatched: null } });
    mount('/audit', <AuditScreen />);
    const alert = (await screen.findByRole('alert')).textContent!;
    expect(alert).toBe('고정점 파일에 읽을 수 없거나 서명이 틀린 줄이 있습니다 — 쓰는 중 끊긴 줄인지 고친 흔적인지 파일을 확인하세요');
    expect(alert).not.toMatch(/-1/);
  });
  it('고정점을 쓰지 못하는 중이면 체인이 정상이어도 고정점 칸에 경고를 보인다', async () => {
    handler = chainOf({ ok: true, verified: 42, head: 'x', broken: null, anchors: { configured: true, checked: 40, lastAt: '2026-11-05T01:00:00.000Z', lastMatched: { id: 40, at: '2026-11-05T01:00:00.000Z', kid: null }, failing: { at: '2026-11-05T02:00:00.000Z', message: 'EACCES' } } });
    mount('/audit', <AuditScreen />);
    const card = await screen.findByRole('region', { name: '해시 체인 검증' });
    const anchor = card.querySelector('[data-anchor]')!;
    expect(anchor.getAttribute('data-anchor')).toBe('failing');
    expect(anchor.textContent).toBe('고정점을 쓰지 못하는 중 — 2026-11-05 11:00부터 · 그 뒤 기록은 DB 밖에 고정되지 않았습니다');
    expect(anchor.textContent).not.toContain('EACCES');
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
