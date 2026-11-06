// 표준 따라하기 — 정적 데모(STATIC_MODE, 쓰기를 받지 않는다): 직접 하기를 열지 않고, 남은 직접 하기 진행 상태도 단계에서 막지 않는다(하네스 리뷰).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { tutorialById } from '@ff/contracts';
import { AppProvider } from '../store';
import { LearnRun } from '../screens/learn/Learn';
import { GuideDock } from '../shell/GuideDock';
import { learnStore } from '../shell/learn';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), STATIC_MODE: true }));

beforeEach(() => {
  localStorage.clear();
  learnStore.reload();
});
afterEach(cleanup);

function mount(path: string) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/learn/:id" element={<LearnRun />} />
            <Route path="*" element={<div data-tour="safety-tab">target</div>} />
          </Routes>
          <GuideDock />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('정적 데모의 따라하기', () => {
  it('진행 방식은 보기만 — 직접 하기 버튼이 없다', () => {
    mount('/learn/CLASSIFY-GATE');
    expect(screen.getByRole('button', { name: '보기 모드로 시작' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '직접 하기' })).toBeNull();
  });

  it('남은 직접 하기 진행 상태로 들어와도 다음 단계가 막히지 않는다', async () => {
    const steps = tutorialById('CLASSIFY-GATE')!.steps;
    const at = steps.findIndex((s) => s.id === 'combo-fail');
    localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: 'CLASSIFY-GATE', step: at, mode: 'self', startedAt: '2026-11-06T00:00:00Z' }));
    learnStore.reload();
    mount(steps[at].route);
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect((within(dock).getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(dock).queryByText(/· 직접 하기/)).toBeNull();
  });
});
