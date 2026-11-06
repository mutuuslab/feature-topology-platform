// 회귀 — 업무 절차 요약(메뉴 배지·가젯)은 완료 집합이 바뀔 때만 다시 읽는다.
// 결함(2026-10-24, e2e:oidc 로그아웃): 메인 가젯이 완료 상태를 읽어 오면(불러오는 중 → 준비) 저장소 버전이 올라가
// 화면의 요약 조회가 모두 다시 나갔고, 그 사이 로그아웃하면 진행 중이던 요약 요청이 401을 받아 SSO 로그인으로 되돌아갔다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render as rtlRender, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { __resetProcedureStore, procedureStore, useProcedureInbox, useProcedureSummary } from '../data/procedureProgress';

// 요약·검토함은 react-query 캐시를 같이 쓴다 — 앱처럼 공급자 하나 아래에 그린다
const render = (el: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);

const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });

let summaryCalls = 0;
let inboxCalls = 0;
let stateDone: string[] = [];
beforeEach(() => {
  localStorage.clear();
  __resetProcedureStore();
  summaryCalls = 0;
  inboxCalls = 0;
  stateDone = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/procedures/summary')) {
        summaryCalls++;
        return json({ todo: 0, review: 0, overdue: 0, done: 0, total: 0, processes: [] });
      }
      if (u.includes('/api/procedures/inbox')) {
        inboxCalls++;
        return json({ items: [], updatedAt: null });
      }
      if (u.includes('/api/procedures/state')) return json({ items: [], done: stateDone, updatedAt: null });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Badge() {
  useProcedureSummary('author');
  return null;
}

describe('업무 절차 요약 다시 읽기', () => {
  it('완료 상태를 불러와도(불러오는 중 → 준비, 완료 집합 그대로) 요약을 다시 읽지 않는다', async () => {
    render(<Badge />);
    await waitFor(() => expect(summaryCalls).toBe(1));
    await act(async () => {
      procedureStore.hydrate('author');
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(summaryCalls).toBe(1);
  });

  it('서버 완료 집합이 달라지면 다시 읽는다', async () => {
    render(<Badge />);
    await waitFor(() => expect(summaryCalls).toBe(1));
    stateDone = ['FPW.1-A01'];
    await act(async () => {
      procedureStore.hydrate('author');
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(summaryCalls).toBe(2));
  });

  // 회귀(2026-11-06 홈 속도): 쓰는 곳마다 따로 읽어 홈 한 번에 요약 8회·검토함 3회 요청이 나갔다
  it('여러 곳에서 써도 요약·검토함은 한 번씩만 읽는다', async () => {
    function Inbox() {
      useProcedureInbox('author');
      return null;
    }
    render(
      <>
        <Badge />
        <Badge />
        <Badge />
        <Inbox />
        <Inbox />
      </>,
    );
    await waitFor(() => expect(summaryCalls).toBe(1));
    await waitFor(() => expect(inboxCalls).toBe(1));
    await new Promise((r) => setTimeout(r, 50)); // hygiene-ok: 더 부르지 않음(부재)을 보려면 잠깐 기다려야 한다 — 기다릴 조건이 없다
    expect([summaryCalls, inboxCalls]).toEqual([1, 1]);
  });
});
