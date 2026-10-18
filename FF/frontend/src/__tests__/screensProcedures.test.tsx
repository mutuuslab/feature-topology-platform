// 업무 절차 화면 — 허브("내 업무"), 절차 상세(스윔레인·활동 선택·RACI), 화면 패널(이 화면의 업무 절차).
// 데이터는 docs/65-workflows 모델에서 생성된 모듈 그대로 쓴다(모의 없음).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ProceduresHub, ProcessDetail } from '../screens/procedures/Procedures';
import ScreenProcedure from '../shell/ScreenProcedure';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function mount(path: string, role = 'author', extra?: React.ReactNode) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Routes>
          <Route path="/procedures" element={<ProceduresHub />} />
          <Route path="/procedures/:id" element={<ProcessDetail />} />
          <Route path="/features/:id/:ver" element={extra ?? <div />} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('업무 절차 허브', () => {
  it('핵심 메시지는 내가 맡은 활동 수 하나이고, 내 업무 목록에 Release Sign-off가 있다(Feature Owner)', async () => {
    mount('/procedures', 'author');
    const key = await screen.findByText('내가 맡은 활동');
    expect(key.closest('[data-key-message]')).toBeTruthy();
    expect(document.querySelectorAll('[data-key-message]').length).toBe(1);
    expect(screen.getByRole('link', { name: 'Release Sign-off(출시 책임 확인)' })).toBeTruthy();
  });

  it('13개 절차가 모두 카드로 보인다', async () => {
    mount('/procedures', 'viewer');
    await screen.findByText('내가 맡은 활동', {}, { timeout: 5000 }).catch(() => undefined);
    const links = await screen.findAllByRole('link', { name: /Flag Retirement|출시|등록/ });
    expect(links.length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.ds-learn-card').length).toBe(13);
  });

  it('내 업무에서 완료를 표시하면 진행률이 오르고 다음 할 일이 바뀐다', async () => {
    mount('/procedures', 'author');
    await screen.findByText('내가 맡은 활동');
    const progress = document.querySelector('.pr-progress')?.textContent ?? '';
    const beforeNext = document.querySelector('.pr-next')?.textContent ?? '';
    expect(progress).toMatch(/건 중 .*건 완료/);
    const box = () => screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    await waitFor(() => expect(box().checked).toBe(true));
    await waitFor(() => expect(document.querySelector('.pr-progress')?.textContent ?? '').not.toBe(progress));
    await waitFor(() => expect(document.querySelector('.pr-next')?.textContent ?? '').not.toBe(beforeNext));
    expect(localStorage.getItem('ff.proc.done')).toContain(':');
  });
});

describe('절차 상세', () => {
  it('흐름도의 활동을 누르면 단계와 완료 기준이 보이고 주소(?a=)에 남는다', async () => {
    mount('/procedures/FPW.7', 'author');
    const node = await screen.findByRole('button', { name: /FPW\.7-A12/ });
    expect(node.getAttribute('data-mine')).toBe(''); // author = Feature Owner = 수행
    fireEvent.click(node);
    expect(await screen.findByText('완료 기준')).toBeTruthy();
    expect(screen.getByText(/서명이 현재 G8·G9 판정 기록에 묶여 유효하다/)).toBeTruthy();
  });

  it('?a= 로 열면 그 활동이 선택되어 있다', async () => {
    mount('/procedures/FPW.7?a=FPW.7-A12', 'author');
    expect(await screen.findByRole('heading', { name: /FPW\.7-A12/ })).toBeTruthy();
  });

  it('없는 절차는 안내와 목록 링크를 보인다', async () => {
    mount('/procedures/FPW.99');
    expect(await screen.findByText(/FPW\.99 절차가 없습니다/)).toBeTruthy();
  });

  it('RACI 표에 책임(A)이 활동마다 정확히 한 칸이다', async () => {
    mount('/procedures/FPW.8', 'operator');
    const table = await screen.findByRole('table', { name: '역할별 RACI' }, { timeout: 5000 }).catch(() => null);
    // details가 닫혀 있어도 DOM에는 있다
    const t = table ?? document.querySelector('table[aria-label="역할별 RACI"]')!;
    const rows = within(t as HTMLElement).getAllByRole('row').slice(1);
    for (const r of rows) expect(within(r).getAllByRole('cell').filter((c) => (c.textContent ?? '').split('·').includes('A')).length).toBe(1);
  });

  it('활동 상세가 입력·산출·플랫폼 action·다음 활동을 보여 주고 완료를 표시한다', async () => {
    mount('/procedures/FPW.8?a=FPW.8-A05', 'operator');
    expect(await screen.findByText('입력 산출물')).toBeTruthy();
    expect(screen.getByText('산출 산출물')).toBeTruthy();
    expect(screen.getByText('플랫폼 action')).toBeTruthy();
    expect(screen.getByText('다음 활동')).toBeTruthy();
    const box = () => document.querySelector('.pr-done input') as HTMLInputElement;
    expect(box()).toBeTruthy();
    fireEvent.click(box());
    await waitFor(() => expect(box().checked).toBe(true));
  });
});

describe('이 화면의 업무 절차 패널', () => {
  function panel(path: string, role: string) {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="*" element={<ScreenProcedure onClose={() => undefined} />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    );
  }

  it('Feature 상세 화면에서 Feature Owner에게 Release Sign-off가 수행(R)으로 먼저 보인다', async () => {
    panel('/features/FEAT-00022/1.0.0', 'author');
    const item = await screen.findByRole('region', { name: 'Release Sign-off(출시 책임 확인)' });
    expect(within(item).getByText('수행(R)')).toBeTruthy();
    const first = document.querySelector('.pr-panel-item')!;
    expect(first.getAttribute('aria-label')).toBeTruthy();
  });

  it('연결된 절차가 없는 화면은 없다고 알린다', async () => {
    panel('/no/such/screen', 'author');
    expect(await screen.findByText('이 화면에 연결된 업무 절차가 없습니다.')).toBeTruthy();
  });
});
