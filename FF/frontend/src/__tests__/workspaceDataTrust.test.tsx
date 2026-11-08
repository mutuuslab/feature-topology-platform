import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { AppProvider } from '../store';
import { departmentById } from '../data/departments';
import ControlRoom from '../screens/workspaces/ControlRoom';
import Review from '../screens/workspaces/Review';
import { MyWork, RoleQueues, useRoleWork, type DeptDoc } from '../screens/workspaces/common';
import { SentConsults } from '../screens/workspaces/Consults';

let failed: string;
let workQueues: object;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function mount(body: JSX.Element, role = 'quality', department = 'ALL') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role, department }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider>{body}</AppProvider></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear(); failed = ''; workQueues = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (failed && String(url).startsWith(failed)) return json({ error: { code: 'INTERNAL', message: '원천 연결 실패' } }, 503);
    if (String(url).startsWith('/api/work-queues')) return json(workQueues);
    return json({ items: [], total: 0, open: 0, overdue: 0 });
  }));
});

function RoleWorkProbe() { return <RoleQueues work={useRoleWork()} />; }
describe('역할별 큐의 부서·조회 경계', () => {
  it('같은 승인자 역할도 현재 부서의 Gate 큐만 센다', async () => {
    const base = { version: '1.0.0', name: '검토', lifecycle: 'PROPOSED', ownerId: 'other', createdBy: 'other', since: '2026-11-08T00:00:00Z', status: null };
    workQueues = { gates: [{ ...base, featureId: 'FEAT-FS', gate: 'G2' }, { ...base, featureId: 'FEAT-QA', gate: 'G4' }] };
    mount(<RoleWorkProbe />, 'quality', 'DEP-FS');
    await waitFor(() => expect(document.querySelector('[data-role-queues] [data-queue="gate"] .ws-fdb__n')?.textContent).toBe('1'));
  });
  it('역할별 큐도 조회 실패를 0건으로 표시하지 않고 재시도한다', async () => {
    failed = '/api/baselines/requests';
    mount(<RoleWorkProbe />, 'quality', 'DEP-FS');
    expect(await screen.findByRole('button', { name: /다시/ })).toBeTruthy();
    expect(document.querySelector('[data-role-queues] .ws-fdb__n')).toBeNull();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('팀 홈에서 실패·빈 상태를 구분한다', () => {
  it('관제실 안전 차단 조회 실패를 0건으로 표시하지 않고 재시도 후 정상 0건을 표시한다', async () => {
    failed = '/api/kill-requests';
    mount(<ControlRoom dept={departmentById('DEP-OPS')!} />, 'operator', 'DEP-OPS');
    await waitFor(() => expect(screen.queryByRole('button', { name: /다시/ })).not.toBeNull());
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('—');
    failed = ''; fireEvent.click(screen.getByRole('button', { name: /다시/ }));
    await waitFor(() => expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('0'));
  });
  it('관제실 차량 조회 실패는 연결/끊김 0대가 아니라 알 수 없음으로 표시한다', async () => {
    failed = '/api/fleet/runtime';
    mount(<ControlRoom dept={departmentById('DEP-OPS')!} />, 'operator', 'DEP-OPS');
    const fleet = (await screen.findByRole('heading', { name: '차량 상태' })).closest('section')!;
    await within(fleet).findByRole('button', { name: /다시/ });
    const values = [...document.querySelectorAll('.ws-tiles__v')].slice(0, 2).map((e) => e.textContent);
    expect(values).toEqual(['—', '—']);
  });
  it('심사함 원천 실패를 검토 없음/정상 완료로 치환하지 않는다', async () => {
    failed = '/api/baselines/requests';
    mount(<Review dept={departmentById('DEP-FS')!} />, 'quality', 'DEP-FS');
    await waitFor(() => expect(within(document.querySelector('.ws-queue') as HTMLElement).queryByRole('button', { name: /다시/ })).not.toBeNull());
    expect(document.querySelector('[data-key-message]')?.getAttribute('data-tone')).not.toBe('ok');
    failed = ''; fireEvent.click(within(document.querySelector('.ws-queue') as HTMLElement).getByRole('button', { name: /다시/ }));
    await waitFor(() => expect(document.querySelector('[data-key-message]')?.getAttribute('data-tone')).toBe('ok'));
  });
  it('보낸 협의 조회 오류는 패널을 숨기지 않고 재시도할 수 있다', async () => {
    failed = '/api/consultations';
    mount(<SentConsults deptId="DEP-PUR" />, 'viewer', 'DEP-PUR');
    expect(await screen.findByRole('button', { name: /다시/ })).toBeTruthy();
  });
});

function purchaseDoc(): DeptDoc {
  const full = WORKFLOWS.departments.find((d) => d.id === 'DEP-PUR')!;
  const all = new Map(WORKFLOWS.processes.flatMap((process) => process.activities.map((activity) => [activity.id, { process, activity }] as const)));
  return { doc: WORKFLOWS, full, acts: full.activities.flatMap((a) => { const hit = all.get(a.id); return hit ? [{ ...hit, part: a.part, parts: a.parts, firstScope: a.firstScope }] : []; }) };
}
describe('내 업무의 실제 조직 역할', () => {
  it('부서와 겹치지 않는 개인 역할에는 부서 전체를 내 업무로 대신 보여주지 않는다', async () => {
    mount(<MyWork d={purchaseDoc()} />, 'author');
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).not.toBeNull());
    expect(document.querySelector('[data-my-work]')).toBeNull();
  });
  it('실제 담당 역할은 유지하고 다른 역할의 승인 업무를 끼워 넣지 않는다', async () => {
    mount(<MyWork d={purchaseDoc()} limit={100} />, 'viewer');
    const work = document.querySelector('[data-my-work]') as HTMLElement;
    expect(within(work).getByRole('link', { name: '산정 범위 설정' })).toBeTruthy();
    expect(within(work).queryByRole('link', { name: '산정 승인·반려' })).toBeNull();
  });
});
