import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { AppProvider } from '../store';
import { Shell } from '../shell/Shell';
import ScreenProcedure from '../shell/ScreenProcedure';
import { ScreenProcedureHost } from '../shell/ScreenProcedureHost';

const state = vi.hoisted(() => ({ doc: null as any, retry: vi.fn() }));
vi.mock('../data/workflows', async () => ({ ...(await vi.importActual<any>('../data/workflows')), useWorkflowResource: () => state }));
beforeEach(() => { localStorage.clear(); state.doc = WORKFLOWS; state.retry.mockReset(); });
afterEach(cleanup);
function wrap(child: React.ReactNode, path = '/feature/propose') {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AppProvider>{child}</AppProvider></MemoryRouter></QueryClientProvider>;
}

describe('현재 화면 업무절차 패널의 실제 연결과 비어 있지 않은 복구', () => {
  it('실제 상단 아이콘을 누르면 현재 등록 화면의 목적·활동과 전체 절차 링크가 열린다', async () => {
    render(wrap(<Shell><h1>Feature 등록</h1></Shell>));
    fireEvent.click(screen.getByRole('button', { name: '이 화면의 업무 절차' }));
    // The module fallback is a temporary drawer. Wait for real data before choosing its container.
    const activity = await screen.findByRole('region', { name: 'Feature 등록·초안 작성' });
    const dialog = activity.closest('[role="dialog"]') as HTMLElement;
    expect(within(activity).getByText(WORKFLOWS.processes[0].purpose)).toBeTruthy();
    expect(within(dialog).getByText('Feature 등록 화면과 연결된 업무입니다.')).toBeTruthy();
    expect(within(dialog).queryByRole('region', { name: '정책 롤백 독립 승인' })).toBeNull();
    expect(within(dialog).getByRole('link', { name: '전체 업무 절차 보기' }).getAttribute('href')).toBe('/procedures?view=reference');
  });

  it('화면 경로에 활동이 없으면 미연결 안내와 전체 절차로 이동할 방법을 보여준다', async () => {
    render(wrap(<ScreenProcedure onClose={() => undefined} />, '/procedures'));
    expect(await screen.findByRole('status')).toHaveTextContent('이 화면에 연결된 업무 절차가 없습니다.');
    expect(screen.getByRole('link', { name: '전체 업무 절차 보기' })).toBeTruthy();
  });

  it('문서를 기다리는 중에도 열린 패널 안에서 상태와 대체 탐색 링크를 보여준다', () => {
    state.doc = null;
    render(wrap(<ScreenProcedure onClose={() => undefined} />));
    expect(screen.getByRole('status')).toHaveTextContent('업무 절차를 불러오는 중입니다.');
    expect(screen.getByRole('link', { name: '전체 업무 절차 보기' })).toBeTruthy();
  });

  it('문서 로딩 실패는 재시도 함수를 호출하고 다른 화면으로 탐색할 수 있다', () => {
    state.doc = 'fail';
    const close = vi.fn();
    render(wrap(<ScreenProcedure onClose={close} />));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(state.retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('link', { name: '전체 업무 절차 보기' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('패널 모듈이 도착하기 전에도 빈 fallback 대신 로딩 서랍을 표시한다', async () => {
    let resolve!: (value: { default: typeof ScreenProcedure }) => void;
    const pending = new Promise<{ default: typeof ScreenProcedure }>((r) => { resolve = r; });
    render(wrap(<ScreenProcedureHost onClose={() => undefined} loader={() => pending} />));
    expect(screen.getByRole('dialog', { name: '이 화면의 업무 절차' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    resolve({ default: ScreenProcedure });
    expect(await screen.findByRole('region', { name: 'Feature 등록·초안 작성' })).toBeTruthy();
  });

  it('패널 모듈 요청이 실패해도 재시도 뒤 실제 현재 화면의 활동을 표시한다', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ default: ScreenProcedure });
    render(wrap(<ScreenProcedureHost onClose={() => undefined} loader={loader} />));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(await screen.findByRole('region', { name: 'Feature 등록·초안 작성' })).toBeTruthy();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });
});
