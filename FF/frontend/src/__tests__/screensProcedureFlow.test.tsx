// 업무 절차 흐름도 화면 — 절차 흐름도(상태 얹기·Gate 마름모·시작/종료·텍스트 보기), 내 업무 흐름(역할별), 전체 지도, 메인 가젯 작은 판.
// 데이터는 docs/65-workflows 모델에서 생성된 모듈 그대로(모의 없음), 서버 상태만 fetch를 바꿔 넣는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { AppProvider } from '../store';
import { __resetProcedureStore } from '../data/procedureProgress';
import { ProcedureRolesScreen, ProceduresHub, ProcessDetail } from '../screens/procedures/Procedures';
import { roleLabel } from '../data/refdata';
import { ProcedureMapBody } from '../screens/home/ProcedureMap';
import { myWorkSteps } from '../screens/procedures/flow/myFlow';

const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });

function stubState(done: { id: string; at: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/procedures/state'))
        return json({
          items: done.map((d) => ({ activityId: d.id, processId: d.id.split('-')[0], roleId: 'R-FO', completedBy: 'usr-author', completedRole: 'FEATURE_AUTHOR', completedAt: d.at, note: null, evidence: [], signature: null, signatureValid: null })),
          done: done.map((d) => d.id),
          updatedAt: done.at(-1)?.at ?? null,
        });
      if (u.includes('/api/procedures/inbox')) return json({ items: [], summary: { todo: 0, review: 0, overdue: 0, done: 0, total: 0, processes: [] }, roleIds: ['R-FO'] });
      if (u.includes('/api/procedures/summary')) return json({ todo: 0, review: 0, overdue: 0, done: 0, total: 0, processes: [] });
      return json({ items: [], unread: 0, byCategory: {} });
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetProcedureStore();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount(path: string, role = 'author') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Routes>
          <Route path="/procedures" element={<ProceduresHub />} />
          <Route path="/procedures/roles" element={<ProcedureRolesScreen />} />
          <Route path="/procedures/:id" element={<ProcessDetail />} />
          <Route path="/" element={<ProcedureMapBody summary={null} />} />
        </Routes>
        <Where />
      </AppProvider>
    </MemoryRouter>,
  );
}

const node = (id: string) => document.querySelector(`[data-flow] [data-activity="${id}"].pf-node--activity`) as SVGGElement | null;

describe('절차 흐름도 (/procedures/:id)', () => {
  it('스윔레인·활동 상자·Gate 마름모·시작/종료가 그려진다', async () => {
    mount('/procedures/FPW.1');
    const svg = await screen.findByRole('group', { name: 'FPW.1 흐름도' });
    const p = WORKFLOWS.processes.find((x) => x.id === 'FPW.1')!;
    expect(svg.querySelectorAll('.pf-node--activity').length).toBe(p.activities.length);
    expect(within(svg).getByRole('button', { name: /G1 판정\(FPW\.1-A05\)/ })).toBeTruthy();
    expect(within(svg).getByRole('img', { name: /시작 — 진입 조건/ })).toBeTruthy();
    expect(within(svg).getByRole('img', { name: /종료 — 완료 조건/ })).toBeTruthy();
    // 레인 = 수행 역할 4개
    expect(svg.querySelectorAll('.pf-lane__label').length).toBeGreaterThanOrEqual(4);
    // 산출물 이름표
    expect(svg.querySelector('.pf-edge__label')).toBeTruthy();
  });

  it('서버 상태를 상자에 얹는다 — 완료·내 차례·기한 초과·앞 활동 대기(글자로도)', async () => {
    stubState([{ id: 'FPW.1-A01', at: '2026-01-01T00:00:00.000Z' }]);
    mount('/procedures/FPW.1');
    await waitFor(() => expect(node('FPW.1-A01')?.getAttribute('data-state')).toBe('done'));
    expect(node('FPW.1-A01')!.getAttribute('aria-label')).toMatch(/완료/);
    // A02: 앞 활동 완료 + Feature Owner가 책임(A) + SLA 24시간 지남
    expect(node('FPW.1-A02')!.getAttribute('data-state')).toBe('overdue');
    expect(node('FPW.1-A02')!.getAttribute('aria-label')).toMatch(/내 차례 · 기한 초과/);
    // A04: 앞 활동(A03) 미완료
    expect(node('FPW.1-A04')!.getAttribute('data-state')).toBe('waiting');
    expect(node('FPW.1-A04')!.textContent).toContain('앞 활동 대기');
  });

  it('백엔드가 없어도 첫 활동은 내 차례로 보인다(Feature Owner)', async () => {
    mount('/procedures/FPW.1');
    await screen.findByRole('group', { name: 'FPW.1 흐름도' });
    await waitFor(() => expect(node('FPW.1-A01')?.getAttribute('data-state')).toBe('mine'));
    expect(node('FPW.1-A01')!.textContent).toContain('내 차례');
  });

  it('상자를 누르거나 Enter로 활동 상세가 열리고 주소에 남는다', async () => {
    mount('/procedures/FPW.1');
    await screen.findByRole('group', { name: 'FPW.1 흐름도' });
    fireEvent.click(node('FPW.1-A03')!);
    expect(await screen.findByRole('heading', { name: /FPW\.1-A03/ })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toContain('a=FPW.1-A03');
    fireEvent.keyDown(node('FPW.1-A04')!, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: /FPW\.1-A04/ })).toBeTruthy();
    expect(node('FPW.1-A04')!.getAttribute('tabindex')).toBe('0');
  });

  it('텍스트 보기는 같은 활동을 표로 보여 주고, 표에서도 활동을 연다', async () => {
    mount('/procedures/FPW.8', 'operator');
    await screen.findByRole('group', { name: 'FPW.8 흐름도' });
    fireEvent.click(screen.getByRole('radio', { name: '텍스트' }));
    const table = await screen.findByRole('table', { name: /FPW\.8 활동 순서/ });
    const p = WORKFLOWS.processes.find((x) => x.id === 'FPW.8')!;
    expect(within(table).getAllByRole('row').length).toBe(p.activities.length + 1);
    expect(screen.queryByRole('group', { name: 'FPW.8 흐름도' })).toBeNull();
    fireEvent.click(within(table).getAllByRole('button')[0]);
    expect(await screen.findByRole('heading', { name: new RegExp(p.activities[0].id) })).toBeTruthy();
  });
});

describe('내 업무 흐름 (/procedures 허브 기본 탭)', () => {
  it('내 활동을 사슬로 잇고 받는 곳·넘기는 곳을 그린다', async () => {
    mount('/procedures', 'author');
    const svg = await screen.findByRole('group', { name: '내 업무 흐름' });
    const steps = myWorkSteps(WORKFLOWS, WORKFLOWS.personas.author);
    expect(svg.querySelectorAll('[data-step]').length).toBe(steps.length);
    expect(svg.querySelectorAll('.pf-chain').length).toBe(steps.length - 1);
    expect(svg.querySelector('.pf-peer')).toBeTruthy();
    // 지금 내 차례는 강조된다
    expect(svg.querySelector('.pf-node[data-now]')).toBeTruthy();
  });

  it('역할마다 다른 흐름 — 운영 조직은 긴급 차단 활동, Feature Owner는 등록 활동', async () => {
    mount('/procedures', 'operator');
    await screen.findByRole('group', { name: '내 업무 흐름' });
    const ops = myWorkSteps(WORKFLOWS, WORKFLOWS.personas.operator).map((s) => s.activity.id);
    const shown = [...document.querySelectorAll('[data-step]')].map((g) => g.getAttribute('data-step'));
    expect(shown).toEqual(ops);
    expect(shown).not.toContain('FPW.1-A01');
  });

  it('보이는 활동을 "지금 내 차례"로 줄이고, 텍스트 보기로 같은 내용을 표로 본다', async () => {
    mount('/procedures', 'author');
    await screen.findByRole('group', { name: '내 업무 흐름' });
    fireEvent.click(screen.getByRole('radio', { name: /지금 내 차례/ }));
    const now = document.querySelectorAll('[data-step]').length;
    expect(now).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: '텍스트' }));
    const table = await screen.findByRole('table', { name: /내 업무 흐름/ });
    expect(within(table).getAllByRole('row').length).toBe(now + 1);
  });

  it('흐름의 내 활동을 누르면 그 절차의 활동 상세로 간다', async () => {
    mount('/procedures', 'author');
    await screen.findByRole('group', { name: '내 업무 흐름' });
    fireEvent.click(screen.getByRole('button', { name: /FPW\.1-A01/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/procedures/FPW.1?a=FPW.1-A01'));
  });
});

describe('전체 지도 (/procedures?view=map)', () => {
  it('13개 절차를 그리고 내 역할 참여를 표시하며, 누르면 그 절차 흐름도로 간다', async () => {
    mount('/procedures?view=map', 'author');
    const svg = await screen.findByRole('group', { name: '전체 지도' });
    expect(svg.querySelectorAll('.pf-proc').length).toBe(13);
    const mine = svg.querySelectorAll('.pf-proc[data-mine]').length;
    expect(mine).toBe(WORKFLOWS.processes.filter((p) => myWorkSteps(WORKFLOWS, WORKFLOWS.personas.author).some((s) => s.process.id === p.id)).length);
    expect(within(svg).getByRole('link', { name: /FPW\.1 .*내 활동/ })).toBeTruthy();
    fireEvent.click(within(svg).getByRole('link', { name: /^FPW\.8 / }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/procedures/FPW.8'));
  });
});

describe('메인 화면 업무 절차 가젯 — 내 업무 흐름 작은 판', () => {
  it('지연 로딩되어 지금 내 차례인 활동부터 3건과 전체 보기 링크를 보인다(가젯 지도도 그대로)', async () => {
    mount('/', 'author');
    const svg = await screen.findByRole('group', { name: '내 업무 흐름' }, { timeout: 5000 });
    const steps = svg.querySelectorAll('[data-step]');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(svg.querySelector('.pf-node[data-now]')).toBeTruthy();
    expect(screen.getByRole('link', { name: '내 업무 흐름 전체 보기' }).getAttribute('href')).toBe('/procedures?view=flow');
    expect(document.querySelectorAll('.pm-node').length).toBe(12);
  });
});

describe('담당자별 업무 흐름 (?view=roles · /procedures/roles)', () => {
  const role = () => JSON.parse(localStorage.getItem('fp.state.v2') ?? '{}').role;

  it('모든 담당자를 요약과 함께 보이고 내 역할에 "나"를 붙인다', async () => {
    mount('/procedures?view=roles', 'author');
    const list = await screen.findAllByRole('button', { pressed: false });
    const personas = Object.keys(WORKFLOWS.personas);
    const cards = document.querySelectorAll('.pf-role');
    expect(cards.length).toBe(personas.length);
    expect(list.length).toBeGreaterThanOrEqual(personas.length);
    const mine = document.querySelector('.pf-role[data-me]')!;
    expect(mine.getAttribute('data-persona')).toBe('author');
    expect(mine.textContent).toContain('나');
    expect(document.querySelector('.pf-role[data-persona="quality"]')!.textContent).toMatch(/활동 \d+ · 절차 \d+/);
  });

  it('담당자를 고르면 역할을 바꾸지 않고 그 담당자의 흐름이 열리고 주소(?role=)에 남는다', async () => {
    mount('/procedures?view=roles', 'author');
    await screen.findByRole('table', { name: /담당자 × 절차/ });
    const card = document.querySelector('.pf-role[data-persona="operator"]') as HTMLButtonElement;
    fireEvent.click(card);
    const svg = await screen.findByRole('group', { name: `${roleLabel('operator')} 업무 흐름` });
    const ops = myWorkSteps(WORKFLOWS, WORKFLOWS.personas.operator).filter((s) => s.activity.id).map((s) => s.activity.id);
    const shown = [...svg.querySelectorAll('[data-step]')].map((g) => g.getAttribute('data-step'));
    expect(shown.every((id) => ops.includes(id!))).toBe(true);
    expect(shown.length).toBeGreaterThan(0);
    expect(screen.getByTestId('where').textContent).toContain('role=operator');
    expect(screen.getByTestId('where').textContent).toContain('view=roles');
    expect(role()).toBe('author');
    expect(card.getAttribute('aria-pressed')).toBe('true');
    // 다른 담당자의 흐름은 '내 차례'가 아니라 '이 담당 차례'로 읽힌다
    expect(svg.textContent).not.toContain('내 차례');
    expect(screen.getByRole('radio', { name: /지금 이 담당 차례/ })).toBeTruthy();
  });

  it('주소로 바로 열면(새로 고침·공유) 고른 담당자의 흐름이 그대로 보인다 — 메뉴 화면 /procedures/roles', async () => {
    mount('/procedures/roles?role=quality', 'author');
    expect(await screen.findByRole('heading', { level: 1, name: '담당자별 업무 흐름' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: `${roleLabel('quality')} 업무 흐름` })).toBeTruthy();
    expect(document.querySelector('.pf-role[data-persona="quality"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('담당자 × 절차 표 — 칸은 활동 수이고, 누르면 그 절차 흐름도에서 담당자 레인을 강조한다', async () => {
    mount('/procedures?view=roles', 'author');
    const table = await screen.findByRole('table', { name: /담당자 × 절차/ });
    const p8 = WORKFLOWS.processes.find((x) => x.id === 'FPW.8')!;
    const ids = WORKFLOWS.personas.operator;
    const n = p8.activities.filter((a) => a.raci.R.some((r) => ids.includes(r)) || ids.includes(a.raci.A)).length;
    const cell = table.querySelector('[data-cell="operator:FPW.8"]') as HTMLAnchorElement;
    expect(cell.textContent?.startsWith(String(n))).toBe(true);
    expect(cell.getAttribute('href')).toBe('/procedures/FPW.8?role=operator');
    fireEvent.click(cell);
    const svg = await screen.findByRole('group', { name: 'FPW.8 흐름도' });
    const focused = [...svg.querySelectorAll('[data-lane][data-focus]')].map((g) => g.getAttribute('data-lane'));
    expect(focused.length).toBeGreaterThan(0);
    for (const l of focused) expect(ids).toContain(l);
    expect(screen.getByText(/강조한 담당: .*\(운영 조직 레인\) — 이 절차에서 활동 \d+개/)).toBeTruthy();
    // 핵심 메시지도 강조한 담당자 기준 — 내 역할(Feature Owner)의 "맡은 활동 없음"이 아니다
    expect(document.querySelector('[data-key-message]')!.textContent).toContain(`${roleLabel('operator')} · 이 절차에서 이 담당자가 맡은 활동`);
    // 상자를 눌러도 강조(?role=)는 남는다
    fireEvent.click(svg.querySelector('[data-activity].pf-node--activity')!);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/role=operator.*a=|a=.*role=operator/));
  });
});
