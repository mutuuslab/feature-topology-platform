/**
 * 라우트 경계 회귀 테스트
 *
 * 화면 하나의 렌더 실패(예: cytoscape 간선 불일치)가 셸 전체를 비우면 제품 전체가 백지가 된다.
 * 이 경계가 실패를 화면 안으로 가두고 재시도 경로를 제공하는지 고정한다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AppProvider } from '../store';
import RouteBoundary from '../components/RouteBoundary';

afterEach(cleanup);

function Boom(): JSX.Element {
  throw new Error('간선 불일치');
}

const renderInApp = (ui: React.ReactNode) => render(<AppProvider>{ui}</AppProvider>);

describe('RouteBoundary', () => {
  it('자식 화면이 던져도 셸을 비우지 않고 실패 카드로 가둔다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderInApp(<RouteBoundary><Boom /></RouteBoundary>);
    expect(document.body.textContent).toContain('간선 불일치');
    spy.mockRestore();
  });

  it('재시도 버튼이 경계를 다시 열어 정상 화면을 복구한다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let boom = true;
    function Flaky() { if (boom) throw new Error('일시 실패'); return <p>정상 화면</p>; }
    renderInApp(<RouteBoundary><Flaky /></RouteBoundary>);
    boom = false;
    fireEvent.click(screen.getByRole('button'));
    expect(document.body.textContent).toContain('정상 화면');
    spy.mockRestore();
  });
});
