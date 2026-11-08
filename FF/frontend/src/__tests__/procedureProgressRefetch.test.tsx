// 회귀 — 업무 절차 요약(메뉴 배지·가젯)은 완료 집합이 바뀔 때만 다시 읽는다.
// 결함(2026-10-24, e2e:oidc 로그아웃): 메인 가젯이 완료 상태를 읽어 오면(불러오는 중 → 준비) 저장소 버전이 올라가
// 화면의 요약 조회가 모두 다시 나갔고, 그 사이 로그아웃하면 진행 중이던 요약 요청이 401을 받아 SSO 로그인으로 되돌아갔다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { __resetProcedureStore, procedureStore, useProcedureSummary } from '../data/procedureProgress';

const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });

let summaryCalls = 0;
let stateDone: string[] = [];
beforeEach(() => {
  localStorage.clear();
  __resetProcedureStore();
  summaryCalls = 0;
  stateDone = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/procedures/summary')) {
        summaryCalls++;
        return json({ todo: 0, review: 0, overdue: 0, done: 0, total: 0, processes: [] });
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
});
