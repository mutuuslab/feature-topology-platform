// 부서 보기(데모, 2026-11-04) — 부서 메뉴가 실제 화면으로 이어지고, 부서를 고르면 셸·홈이 화면 유형별로 바뀌며,
// 전체 보기는 지금의 MENU 2.0(8그룹) 그대로다. 부서는 업무 절차 모델(docs/65-workflows)의 OEM 조직 가정안이다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WORKSPACES } from '@ff/contracts';
import { ALL_DEPARTMENTS, DEPARTMENTS, departmentById } from '../data/departments';
import { departmentMenu, departmentMenuGroups, menuRouteOf } from '../shell/departmentMenu';
import { GROUPS, ROUTES } from '../routes';
import { Shell } from '../shell/Shell';
import { HomeScreen } from '../screens/home/Inbox';
import { AppProvider, initial, reducer } from '../store';
import { MotionProvider } from '../state/motion';
import { departments as D } from '../copy/departments';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-workspace');
  document.documentElement.removeAttribute('data-zone');
});

const mount = (state: object, path = '/', body: JSX.Element = <h1>본문</h1>) => {
  localStorage.setItem('fp.state.v2', JSON.stringify(state));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <MotionProvider>
          <AppProvider>
            <Shell>
              <Routes>
                <Route path="*" element={body} />
              </Routes>
            </Shell>
          </AppProvider>
        </MotionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('부서 메뉴', () => {
  it('업무 성격 분류는 14부서의 원래 항목과 주 업무·참조 경계를 빠짐없이 보존한다', () => {
    for (const d of DEPARTMENTS.departments) {
      const menu = departmentMenu(d);
      for (const items of [menu.primary, menu.reference]) {
        const groups = departmentMenuGroups(items);
        expect(groups.every((g) => g.items.length > 0)).toBe(true);
        expect(groups.flatMap((g) => g.items.map((i) => i.to)).sort()).toEqual(items.map((i) => i.to).sort());
        expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
      }
    }
    const purchase = departmentMenuGroups(departmentMenu(departmentById('DEP-PUR')!).primary);
    expect(purchase.find((g) => g.key === 'cost')?.items.map((i) => i.to)).toContain('/procurement/sw-cost');
    expect(purchase.find((g) => g.key === 'supplier')?.items.map((i) => i.to)).toContain('/supplier/portal');
  });

  it('구매 업무 분류와 공통·역할 대시보드 링크가 보이고 현재 대시보드만 활성화된다', async () => {
    mount({ role: 'viewer', department: 'DEP-PUR' }, '/?dashboard=department');
    const nav = await screen.findByRole('navigation', { name: '구매팀 메뉴' });
    expect(within(nav).getByRole('heading', { name: '개발비 산정' })).toBeTruthy();
    expect(within(nav).getByRole('heading', { name: '협력사 납품·검수' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: '부서 공통 대시보드' })).toHaveAttribute('href', '/?dashboard=department');
    expect(within(nav).getByRole('link', { name: '부서 공통 대시보드' }).className).toBe('active');
    expect(within(nav).getByRole('link', { name: '역할 기본 대시보드' }).className).not.toBe('active');
    expect(within(nav).getByRole('link', { name: '내 작업공간' }).className).not.toBe('active');
  });
  it('14개 부서 모두 메뉴가 있고, 모든 항목은 메뉴가 있는 실제 화면이다', () => {
    const menuPaths = new Set(ROUTES.filter((r) => r.menu).map((r) => r.menu));
    expect(DEPARTMENTS.departments).toHaveLength(14);
    for (const d of DEPARTMENTS.departments) {
      const m = departmentMenu(d);
      expect(m.primary.length + m.reference.length, d.id).toBeGreaterThan(0);
      for (const it of [...m.primary, ...m.reference]) expect(menuPaths.has(it.to), `${d.id} ${it.to}`).toBe(true);
      // 주 업무와 참조가 겹치지 않고, 홈·업무 절차는 작업공간 내비가 따로 그린다
      const p = new Set(m.primary.map((x) => x.to));
      expect(m.reference.some((x) => p.has(x.to))).toBe(false);
      expect([...m.primary, ...m.reference].some((x) => x.to === '/' || x.to === '/procedures')).toBe(false);
    }
  });

  it('활동 화면 패턴은 메뉴가 있는 가장 가까운 상위 화면으로 올라간다', () => {
    expect(menuRouteOf('/features/:id/:ver')?.menu).toBe('/features');
    expect(menuRouteOf('/fleet/live')?.menu).toBe('/fleet/live');
  });

  it('부서마다 메뉴가 다르다 — 운영관제는 차량 운영, 상품기획은 Feature 제안', () => {
    const tos = (id: string) => [...departmentMenu(departmentById(id)!).primary].map((x) => x.to);
    expect(tos('DEP-OPS')).toContain('/fleet/live');
    expect(tos('DEP-OPS')).not.toContain('/feature/propose');
    expect(tos('DEP-PDP')).toContain('/feature/propose');
  });

  it('부서는 5개 화면 유형을 모두 쓴다', () => {
    expect(new Set(DEPARTMENTS.departments.map((d) => d.workspace))).toEqual(new Set(WORKSPACES));
  });
});

describe('부서 상태', () => {
  it('부서를 고르면 그 부서의 기본 데모 계정으로, 부서 안 계정이면 그대로 둔다', () => {
    const s1 = reducer(initial, { t: 'DEPT', department: 'DEP-OPS' });
    expect(s1).toMatchObject({ department: 'DEP-OPS', role: 'operator' });
    const s2 = reducer({ ...initial, role: 'commerce' }, { t: 'DEPT', department: 'DEP-PDP' });
    expect(s2.role).toBe('commerce');
    const s3 = reducer(initial, { t: 'DEPT', department: 'DEP-PDP', role: 'approver' });
    expect(s3.role).toBe('approver');
  });

  it('부서 보기에서 그 부서 밖 역할로 바뀌면(따라하기 단계 등) 전체 보기로 — 부서 안 역할은 부서를 지킨다', () => {
    const ops = reducer(initial, { t: 'DEPT', department: 'DEP-OPS' });
    expect(reducer(ops, { t: 'ROLE', role: 'author' })).toMatchObject({ role: 'author', department: ALL_DEPARTMENTS });
    const pdp = reducer(initial, { t: 'DEPT', department: 'DEP-PDP' });
    expect(reducer(pdp, { t: 'ROLE', role: 'commerce' })).toMatchObject({ role: 'commerce', department: 'DEP-PDP' });
  });

  it('모르는 부서·전체 보기는 ALL, 역할은 그대로', () => {
    expect(reducer({ ...initial, role: 'quality', department: 'DEP-FS' }, { t: 'DEPT', department: 'DEP-NOPE' })).toMatchObject({ department: ALL_DEPARTMENTS, role: 'quality' });
    expect(reducer({ ...initial, department: 'DEP-FS' }, { t: 'DEPT', department: ALL_DEPARTMENTS }).department).toBe(ALL_DEPARTMENTS);
  });

  it('저장된 부서가 모델에 없으면 전체 보기로 읽는다(옛 브라우저 상태)', () => {
    mount({ role: 'author', department: 'DEP-GONE' });
    expect(document.querySelector('.sh-rail')).not.toBeNull();
    expect(document.documentElement.hasAttribute('data-workspace')).toBe(false);
  });
});

describe('셸 — 부서 보기와 전체 보기', () => {
  it('전체 보기(기본)는 8그룹 레일 그대로다', () => {
    mount({ role: 'author' });
    expect(document.querySelectorAll('.sh-rail__btn:not(.sh-rail__toggle)')).toHaveLength(GROUPS.length);
    expect(document.querySelector('[data-dept-nav]')).toBeNull();
  });

  it('부서를 고르면 레일 대신 부서 메뉴, html에 화면 유형 — 관제실은 어두운 관제 톤', async () => {
    mount({ role: 'operator', department: 'DEP-OPS' });
    expect(document.querySelector('.sh-rail')).toBeNull();
    const nav = await screen.findByRole('navigation', { name: 'OTA·서비스운영팀 메뉴' });
    expect(within(nav).getByRole('link', { name: 'Fleet 실시간 적용 현황' })).toBeTruthy();
    expect(document.documentElement.getAttribute('data-workspace')).toBe('control');
    expect(document.documentElement.getAttribute('data-zone')).toBe('ops');
  });

  it('부서마다 화면 유형이 다르다 — 기획 스튜디오는 관제 톤이 아니다', () => {
    mount({ role: 'author', department: 'DEP-PDP' });
    expect(document.documentElement.getAttribute('data-workspace')).toBe('studio');
    expect(document.documentElement.hasAttribute('data-zone')).toBe(false);
    expect(document.querySelector('.sh')?.getAttribute('data-workspace')).toBe('studio');
  });

  it('상단 바에서 부서를 바꾸고, 전체 메뉴 보기로 8그룹에 돌아온다', async () => {
    mount({ role: 'author' });
    fireEvent.change(screen.getByRole('combobox', { name: '담당 부서' }), { target: { value: 'DEP-FS' } });
    expect(document.documentElement.getAttribute('data-workspace')).toBe('review');
    expect(await screen.findByRole('navigation', { name: '기능안전팀 메뉴' })).toBeTruthy();
    // 부서 안 역할 — 기능안전팀은 데모 계정이 둘(품질 검토 FSM, 부 FSM)
    expect(screen.getByRole('combobox', { name: '부서 안 역할' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '전체 메뉴 보기' }));
    expect(document.querySelector('.sh-rail')).not.toBeNull();
    expect(document.documentElement.hasAttribute('data-workspace')).toBe(false);
  });
});

describe('작업공간 홈', () => {
  for (const [dept, ws] of [
    ['DEP-PDP', 'studio'],
    ['DEP-QA', 'review'],
    ['DEP-PLM', 'console'],
    ['DEP-OPS', 'control'],
    ['DEP-LEG', 'portal'],
  ] as const) {
    it(`${dept} → ${ws} 홈`, async () => {
      mount({ role: departmentById(dept)!.personas[0], department: dept }, '/', <HomeScreen />);
      expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
      expect(document.querySelector(`[data-workspace-home="${ws}"]`)).not.toBeNull();
    });
  }

  it('전체 보기 홈은 지금의 대시보드다', async () => {
    mount({ role: 'author' }, '/', <HomeScreen />);
    await screen.findAllByRole('heading');
    expect(document.querySelector('[data-workspace-home]')).toBeNull();
  });
});

describe('Feature DB를 맡는 부서(하네스 리뷰 F9·D1, 2026-11-04)', () => {
  it('PLM·기준정보(승인·발행)와 시스템엔지니어링(도메인 검토) 메뉴에 Feature DB가 있다', () => {
    for (const id of ['DEP-PLM', 'DEP-SE']) {
      const m = departmentMenu(departmentById(id)!);
      expect([...m.primary, ...m.reference].map((x) => x.to), id).toContain('/master/feature-db');
    }
  });

  it('PLM 콘솔 홈에 변경 요청 대기열(검토 대기·발행 대기) — 핵심 메시지는 하나 그대로, Feature DB를 맡지 않는 콘솔(SW통합)에는 없다', async () => {
    const changes = [
      { changeId: 'CR-2026-001', kind: 'MODIFY', refId: 'CH-BRK-009', status: 'REVIEW', reviews: [], requestedBy: 'usr-author', requestedAt: '2026-11-04T01:00:00.000Z' },
      { changeId: 'CR-2026-002', kind: 'ADD', refId: 'BC-ACC-031', status: 'APPROVED', reviews: [], requestedBy: 'usr-author', requestedAt: '2026-11-04T02:00:00.000Z' },
      { changeId: 'CR-2026-003', kind: 'MODIFY', refId: 'CH-BRK-006', status: 'PUBLISHED', reviews: [], requestedBy: 'usr-author', requestedAt: '2026-11-03T02:00:00.000Z' },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/refdb/changes') ? { items: changes } : { items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    mount({ role: 'steward', department: 'DEP-PLM' }, '/', <HomeScreen />);
    const panel = await screen.findByRole('region', { name: D.console.fdb.title });
    await waitFor(() => expect(panel.querySelector('[data-tab="OPEN"] .ws-fdb__n')!.textContent).toBe('1'));
    expect(panel.querySelector('[data-tab="APPROVED"] .ws-fdb__n')!.textContent).toBe('1');
    expect(within(panel).getByRole('link', { name: /검토 대기/ }).getAttribute('href')).toBe('/master/feature-db/changes?tab=OPEN');
    // 처리 중만 — 발행된 요청은 대기열에 없다
    expect(within(panel).queryByText('CR-2026-003')).toBeNull();
    expect(within(panel).getByText('CR-2026-002')).toBeTruthy();
    expect(document.querySelectorAll('[data-key-message]').length).toBe(1);
    cleanup();
    mount({ role: 'coordinator', department: 'DEP-INT' }, '/', <HomeScreen />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: D.console.fdb.title })).toBeNull();
  });
});
