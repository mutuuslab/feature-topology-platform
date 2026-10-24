// 내 대시보드 — Jira식 가젯 판: 기본 배치·가젯 추가·빼기·배치 메뉴 이동(끌기 대안)·레이아웃·역할별 저장·끌어 놓기. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { HomeScreen } from '../screens/home/Inbox';
import { DEFAULT_BOARD } from '../screens/home/dashboard/gadgets';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role = 'operator') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>
          <HomeScreen />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const columns = () => [...document.querySelectorAll('.db-col')].map((c) => [...c.querySelectorAll(':scope > [data-gadget]')].map((g) => g.getAttribute('data-gadget')));
const saved = (role = 'operator') => JSON.parse(localStorage.getItem(`ff.dashboard.v1.${role}`) ?? 'null');
const openMenu = (title: string) => fireEvent.click(screen.getByRole('button', { name: `${title} 배치 메뉴` }));

describe('내 대시보드 — 가젯 판', () => {
  it('처음에는 기본 배치(왼쪽 넓은 2열)로 그리고, 핵심 메시지는 판 위에 하나', () => {
    mount();
    expect(columns()).toEqual(DEFAULT_BOARD.columns);
    expect(document.querySelector('.db-board')!.getAttribute('data-layout')).toBe('2L');
    expect(document.querySelectorAll('[data-key-message]')).toHaveLength(1);
  });

  it('가젯 추가 창 — 놓인 가젯은 추가됨, 고르면 첫 열 맨 위에 들어가고 저장된다', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '가젯 추가' }));
    const dir = screen.getByRole('dialog');
    expect(within(dir).getAllByText('추가됨').length).toBe(DEFAULT_BOARD.columns.flat().length);
    fireEvent.click(within(dir).getByRole('button', { name: '최근 활동 추가' }));
    expect(columns()[0][0]).toBe('activity');
    expect(saved().columns[0][0]).toBe('activity');
  });

  it('배치 메뉴 — 오른쪽 열로·위로 옮기고, 빼면 사라진다(끌기를 못 써도 같은 배치)', () => {
    mount();
    openMenu('내 차례 검토');
    fireEvent.click(screen.getByRole('menuitem', { name: '오른쪽 열로' }));
    expect(columns()[1]).toContain('myWork');
    openMenu('내 차례 검토');
    fireEvent.click(screen.getByRole('menuitem', { name: '위로' }));
    expect(columns()[1][0]).toBe('myWork');
    openMenu('내 차례 검토');
    expect(screen.getByRole('menuitem', { name: '위로' })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: '대시보드에서 빼기' }));
    expect(columns().flat()).not.toContain('myWork');
    expect(saved().columns.flat()).not.toContain('myWork');
  });

  it('접기 — 본문을 숨기고 다시 펼친다', () => {
    mount();
    const g = () => document.querySelector('[data-gadget="links"]')!;
    expect(g().querySelector('.ds-panel__body')).not.toBeNull();
    openMenu('바로 가기');
    fireEvent.click(screen.getByRole('menuitem', { name: '접기' }));
    expect(g().querySelector('.ds-panel__body')).toBeNull();
    openMenu('바로 가기');
    fireEvent.click(screen.getByRole('menuitem', { name: '펼치기' }));
    expect(g().querySelector('.ds-panel__body')).not.toBeNull();
  });

  it('레이아웃 — 3열로 바꾸고 1열로 줄여도 가젯을 잃지 않는다', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: '3열' }));
    expect(columns()).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: '1열' }));
    expect(columns()).toHaveLength(1);
    expect(columns()[0].sort()).toEqual(DEFAULT_BOARD.columns.flat().sort());
  });

  it('역할별 저장 — 다시 열면 그 역할의 배치, 기본 배치로 되돌리면 저장을 지운다', () => {
    mount('operator');
    openMenu('바로 가기');
    fireEvent.click(screen.getByRole('menuitem', { name: '대시보드에서 빼기' }));
    cleanup();
    mount('operator');
    expect(columns().flat()).not.toContain('links');
    cleanup();
    mount('author');
    expect(columns().flat()).toContain('links');
    cleanup();
    mount('operator');
    fireEvent.click(screen.getByRole('button', { name: '기본 배치로' }));
    expect(columns()).toEqual(DEFAULT_BOARD.columns);
    expect(saved('operator')).toBeNull();
  });

  it('끌어 놓기 — 머리 손잡이를 끌어 다른 열에 놓는다(정확한 자리는 실제 브라우저 e2e dashboard.spec)', () => {
    mount();
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', get types() { return [...data.keys()]; }, setDragImage: () => undefined, effectAllowed: '', dropEffect: '' };
    const grip = document.querySelector('[data-gadget="lifecycle"] .db-grip')!;
    const col0 = document.querySelectorAll('.db-col')[0];
    // jsdom 끌기 사건에는 포인터 좌표가 없다 — 놓는 자리는 열 끝
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.dragOver(col0, { dataTransfer });
    expect(document.querySelector('.db-drop')).not.toBeNull();
    fireEvent.drop(col0, { dataTransfer });
    expect(columns()[0].at(-1)).toBe('lifecycle');
    expect(columns()[1]).not.toContain('lifecycle');
    expect(document.querySelector('.db-drop')).toBeNull();
    expect(screen.getByText(/Lifecycle 분포 — 1열 4번째로 옮겼습니다/)).toBeTruthy();
  });
});
