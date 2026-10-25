// 표준 따라하기(활동판) — 화면 패널의 "따라하기"가 셸 가이드를 열고, 현재 화면의 data-tour 앵커를 강조한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { __resetProcedureStore } from '../data/procedureProgress';
import { ProcedureGuideHost } from '../shell/ProcedureGuideHost';
import { procedureGuideStore } from '../shell/procedureGuide';

beforeEach(() => {
  localStorage.clear();
  __resetProcedureStore();
  procedureGuideStore.close();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('표준 따라하기(활동)', () => {
  it('대상 활동을 열면 현재 화면의 앵커를 강조하고 단계·입력/버튼을 보여 준다', async () => {
    render(
      <MemoryRouter initialEntries={['/master/define']}>
        <AppProvider>
          <div data-tour="feature-form">Feature 등록 폼</div>
          <Routes>
            <Route path="*" element={<ProcedureGuideHost />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    );
    act(() => procedureGuideStore.open('FPW.1-A01', 'FPW.1'));
    expect(await screen.findByRole('heading', { level: 2, name: /Feature 등록·초안 작성/ }, { timeout: 10_000 })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-tour="feature-form"]')?.getAttribute('data-tour-active')).toBe('true'), { timeout: 3000 });
    expect(screen.getByText('화면의 입력·버튼')).toBeTruthy();
    expect(screen.getByText('name')).toBeTruthy();
  });
});
