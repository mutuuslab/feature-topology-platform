// Feature 요약 서랍 (설계안 2.1 우측 컨텍스트 서랍) — 어느 화면이든 IdChip의 '요약 보기'가 셸 서랍을 연다.
// Feature ID가 아닌 칩(Baseline·상품)에는 버튼이 없고, Version이 없으면 최신 Version을 골라 연다. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider } from '../store';
import { IdChip } from '../design';
import { FeaturePeek } from '../shell/FeaturePeek';

let calls: string[];

const detail = {
  feature: { featureId: 'FEAT-00022', version: '1.1.0', name: '배터리 사전 컨디셔닝', lifecycle: 'RELEASED', asil: 'B', ownerId: 'usr-author', baselineId: 'BL-00028', country: 'KR', vehicleModel: 'NE', trim: 'ALL' },
  gates: { G1: { status: 'PASS' }, G9: { status: 'FAIL' } },
  dependencies: { outgoing: [{}], incoming: [] },
  products: [{ catalogId: 'CAT-00013' }, { catalogId: 'CAT-00019' }],
};

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const body = url === '/api/features/FEAT-00022' ? { featureId: 'FEAT-00022', latestVersion: '1.1.0', versions: [] } : url.startsWith('/api/features/FEAT-00022/versions/') ? detail : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const mount = (chips: JSX.Element) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/somewhere']}>
        <AppProvider>
          <Routes>
            <Route path="*" element={chips} />
          </Routes>
          <FeaturePeek />
          <Where />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Feature 요약 서랍', () => {
  it('Feature ID 칩에만 요약 버튼이 붙는다', () => {
    mount(
      <>
        <IdChip id="FEAT-00022" version="1.1.0" />
        <IdChip id="BL-00028" />
        <IdChip id="CAT-00013" />
      </>,
    );
    expect(screen.getAllByRole('button', { name: /^요약 보기/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '요약 보기 FEAT-00022@1.1.0' })).toBeTruthy();
  });

  it('버튼을 누르면 서랍에 요약(Lifecycle·Gate·상품)이 열리고 상세로 이동하면 닫힌다', async () => {
    mount(<IdChip id="FEAT-00022" version="1.1.0" />);
    fireEvent.click(screen.getByRole('button', { name: /^요약 보기/ }));
    const peek = await screen.findByTestId('feature-peek');
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('배터리 사전 컨디셔닝')).toBeTruthy();
    expect(peek.textContent).toContain('CAT-00013, CAT-00019');
    expect(peek.textContent).toContain('KR · NE · ALL');
    expect(peek.textContent).toContain('의존 1 · 피의존 0');
    expect(calls).toEqual(['/api/features/FEAT-00022/versions/1.1.0']); // Version을 알면 목록을 다시 묻지 않는다
    fireEvent.click(within(dlg).getByRole('link', { name: '상세 열기' }));
    expect(screen.getByTestId('where').textContent).toBe('/features/FEAT-00022/1.1.0');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Version 없이 열면 최신 Version을 골라 보여 준다', async () => {
    mount(<IdChip id="FEAT-00022" />);
    fireEvent.click(screen.getByRole('button', { name: /^요약 보기/ }));
    await screen.findByTestId('feature-peek');
    expect(calls).toEqual(['/api/features/FEAT-00022', '/api/features/FEAT-00022/versions/1.1.0']);
  });
});
