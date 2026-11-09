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


const deferred = <T,>() => { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; };
const completed = (activityId:string) => ({activityId,processId:'FPW.1',roleId:'R-FO',completedBy:'usr-author',completedRole:'FEATURE_AUTHOR',completedAt:'2026-11-10T00:00:00Z',note:null,evidence:[],signature:{signedBy:'usr-author'},signatureValid:true});
const state = (ids:string[]) => ({items:ids.map(completed),done:ids,updatedAt:null});

describe('업무 완료와 늦은 최초 조회의 경합',()=>{
 it('실완료 뒤 도착한 옛 조회는 완료를 지우지 않고 다른 서버 완료도 보존한다',async()=>{
  const read=deferred<ReturnType<typeof json>>();const done=completed('FPW.1-A01');
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).includes('/state')?read.promise:json({completion:done})));
  procedureStore.hydrate('author');await procedureStore.complete('author',done.activityId,{evidence:[],sign:true});
  read.resolve(json(state(['FPW.4-A01'])));await waitFor(()=>expect(procedureStore.snapshot().status).toBe('ready'));
  expect(procedureStore.doneOf()).toEqual({'FPW.1-A01':true,'FPW.4-A01':true});
  expect(procedureStore.snapshot().items).toEqual(expect.arrayContaining([done,completed('FPW.4-A01')]));
 });
 it('낙관적 표시 뒤 읽기가 먼저 도착해도 실완료 응답으로 완료를 다시 확정한다',async()=>{
  const read=deferred<ReturnType<typeof json>>(),write=deferred<ReturnType<typeof json>>();
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).includes('/state')?read.promise:write.promise));
  procedureStore.hydrate('author');const saving=procedureStore.complete('author','FPW.1-A01',{evidence:[],sign:true});
  read.resolve(json(state([])));await waitFor(()=>expect(procedureStore.snapshot().status).toBe('ready'));
  write.resolve(json({completion:completed('FPW.1-A01')}));await saving;
  expect(procedureStore.isDone('FPW.1-A01')).toBe(true);
 });
 it('실제 취소 뒤 도착한 옛 완료 조회는 취소를 되돌리지 않는다',async()=>{
  localStorage.setItem('ff.proc.done.v2',JSON.stringify({'FPW.1-A01':true}));__resetProcedureStore();
  const read=deferred<ReturnType<typeof json>>();
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).includes('/state')?read.promise:json(state(['FPW.4-A01']))));
  procedureStore.hydrate('author');await procedureStore.undo('author','FPW.1-A01');
  read.resolve(json(state(['FPW.1-A01','FPW.4-A01'])));await waitFor(()=>expect(procedureStore.snapshot().status).toBe('ready'));
  expect(procedureStore.doneOf()).toEqual({'FPW.4-A01':true});expect(procedureStore.snapshot().items.map(x=>x.activityId)).toEqual(['FPW.4-A01']);
 });
});


describe('업무 진행 조회 경계 보존',()=>{
 it('서버가 거부한 완료는 확인된 변경으로 남지 않는다',async()=>{
  const read=deferred<ReturnType<typeof json>>();
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).includes('/state')?read.promise:{...json({error:{code:'FORBIDDEN',message:'수행 권한이 없습니다'}}),ok:false,status:403}));
  procedureStore.hydrate('author');
  await expect(procedureStore.complete('author','FPW.1-A01',{evidence:[],sign:true})).rejects.toMatchObject({status:403});
  await act(async()=>{read.resolve(json(state(['FPW.4-A01'])));await read.promise;});
  expect(procedureStore.isDone('FPW.1-A01')).toBe(false);expect(procedureStore.doneOf()).toEqual({'FPW.4-A01':true});
  expect(procedureStore.snapshot().items.map(item=>item.activityId)).toEqual(['FPW.4-A01']);
 });
 it('reset 이전 조회의 응답과 finally는 새 역할의 진행 중 조회를 덮지 않는다',async()=>{
  const old=deferred<ReturnType<typeof json>>(),fresh=deferred<ReturnType<typeof json>>();let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?old.promise:fresh.promise));
  procedureStore.hydrate('author');__resetProcedureStore();procedureStore.hydrate('steward');
  await act(async()=>{old.resolve(json(state(['FPW.1-A01'])));await old.promise;});
  expect(procedureStore.snapshot().status).toBe('loading');expect(procedureStore.doneOf()).toEqual({});
  procedureStore.hydrate('quality');expect(calls).toBe(2);
  await act(async()=>{fresh.resolve(json(state(['FPW.4-A01'])));await fresh.promise;});
  expect(procedureStore.snapshot().status).toBe('ready');expect(procedureStore.doneOf()).toEqual({'FPW.4-A01':true});
 });
 it('기존 연결 실패의 로컬 표시를 유지하며 서버 서명 완료를 꾸미지 않는다',async()=>{
  const fetcher=vi.fn(async()=>{throw new TypeError('network unreachable');});vi.stubGlobal('fetch',fetcher);
  procedureStore.hydrate('author');await waitFor(()=>expect(procedureStore.snapshot().status).toBe('error'));
  expect(procedureStore.snapshot().error).toContain('이 브라우저에만');
  await procedureStore.complete('author','FPW.1-A01',{evidence:[],sign:true});
  expect(procedureStore.isDone('FPW.1-A01')).toBe(true);expect(procedureStore.snapshot().items).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
