// 표준 따라하기 — 허브·시나리오 화면, 가이드 패널(단계 이동·역할 전환·규칙 원문), 표준 설명 모드.
// 하네스: 단계가 가리키는 화면 경로는 라우트 표에, 스포트라이트 앵커(data-tour)는 화면 코드에 실제로 있어야 한다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { stepPath, tutorialById, TUTORIALS } from '@ff/contracts';
import { AppProvider, useAppShell } from '../store';
import { ROUTES } from '../routes';
import { Explain } from '../design';
import { LearnHub, LearnRun } from '../screens/learn/Learn';
import { GuideDock, RuleDrawer } from '../shell/GuideDock';
import { learnStore } from '../shell/learn';

beforeEach(() => {
  localStorage.clear();
  learnStore.reload();
});
afterEach(cleanup);

function Where() {
  const { pathname, search } = useLocation();
  const { role } = useAppShell();
  return (
    <output data-testid="where">
      {pathname}
      {search}|{role}
    </output>
  );
}

function mount(path: string, role = 'author') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/learn" element={<LearnHub />} />
            <Route path="/learn/:id" element={<LearnRun />} />
            <Route path="*" element={<Target />} />
          </Routes>
          <GuideDock />
          <RuleDrawer />
          <Where />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

/** 단계 화면 대역 — 강조 대상과, 누르면 조합 위반 결과가 나타나는 버튼(직접 하기 판정 시험) */
function Target() {
  const [fail, setFail] = useState(false);
  return (
    <div data-tour="safety-tab">
      target
      <button type="button" onClick={() => setFail(true)}>
        make-result
      </button>
      {fail && (
        <ul>
          <li className="ds-rules__item" data-rule="FFG-CLS-009" data-status="fail">
            DC2는 효과 감소 시간(ramp_ms)이 0보다 커야 합니다
          </li>
        </ul>
      )}
    </div>
  );
}

/** 화면 코드 전체(screens·design) — 앵커·판정 속성이 실제로 있는지 본다 */
function sourceOf(...dirs: string[]) {
  const src: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n)) src.push(readFileSync(p, 'utf8'));
    }
  };
  for (const d of dirs) walk(join(__dirname, '..', d));
  return src.join('\n');
}

describe('하네스 — 시나리오 단계가 실제 화면을 가리킨다', () => {
  const pattern = (p: string) => new RegExp('^' + p.replace(/:\w+/g, '[^/]+') + '$');
  it('단계 경로는 모두 라우트 표의 화면이다', () => {
    const bad = TUTORIALS.flatMap((t) => t.steps.filter((s) => !ROUTES.some((r) => pattern(r.path).test(stepPath(s)))).map((s) => `${t.id}/${s.id} ${s.route}`));
    expect(bad).toEqual([]);
  });
  it('스포트라이트 앵커는 모두 화면 코드에 data-tour(또는 tour=)로 있다', () => {
    const all = sourceOf('screens');
    // data-tour="x" · tour="x" · tours={{ G5: 'x' }}
    const missing = TUTORIALS.flatMap((t) => t.steps.filter((s) => !new RegExp(`(data-tour|tours?)=[^\\n]*["']${s.anchor}["']`).test(all)).map((s) => `${t.id}/${s.id} → ${s.anchor}`));
    expect(missing).toEqual([]);
  });
  it('완료 판정 선택자는 올바른 CSS이고, 쓰는 data- 속성·data-testid 값은 화면 코드에 있다', () => {
    const all = sourceOf('screens', 'design', 'shell');
    const bad: string[] = [];
    for (const t of TUTORIALS)
      for (const s of t.steps) {
        if (!s.check) continue;
        expect(() => document.querySelector(s.check!.selector), `${t.id}/${s.id}`).not.toThrow();
        for (const [, attr, val] of s.check.selector.matchAll(/\[(data-[\w-]+)(?:[~^]?="([^"]*)")?\]/g)) {
          if (!all.includes(attr)) bad.push(`${t.id}/${s.id} 속성 ${attr}`);
          // 고정 값으로 쓰는 앵커·시험 ID는 그 값이 코드에 있어야 한다(상태 값·저장 값은 데이터라 제외)
          if (val && ['data-tour', 'data-testid'].includes(attr) && !all.includes(`"${val}"`) && !all.includes(`'${val}'`)) bad.push(`${t.id}/${s.id} ${attr}=${val}`);
        }
      }
    expect(bad).toEqual([]);
  });
});

describe('허브·시나리오 화면', () => {
  it('시나리오 카드를 모두 보이고 읽기 경로로 거른다', () => {
    mount('/learn');
    expect(screen.getAllByRole('listitem').length).toBe(TUTORIALS.length);
    fireEvent.click(screen.getByRole('radio', { name: /검증·운영/ }));
    expect(screen.getAllByRole('listitem').length).toBe(TUTORIALS.filter((t) => t.readingPath === 'VERIFY_OPERATE').length);
  });
  it('진행 방식은 보기·직접 하기 — 둘 다 쓸 수 있고 준비 중·연결 전 표시가 없다', () => {
    mount('/learn/CS-01');
    expect((screen.getByRole('button', { name: '보기 모드로 시작' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '직접 하기' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: '자동 실행' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/아직 연결 전|준비 중/);
    expect(document.body.textContent).not.toMatch(/다음 개발 단계|\(F\d\)|\bU\d에서|\bF\d에서/); // 내부 단계 번호(U3·F1)는 화면에 없다 — 분류 표기 F3는 허용
    expect(screen.getByText(/위험 구간 26초/)).toBeTruthy();
  });
  it('12개 시나리오 화면 모두 단계 목록과 적용 전·후 표가 있고 준비 중 표시가 없다', () => {
    for (const t of TUTORIALS) {
      mount(`/learn/${t.id}`);
      expect(document.querySelectorAll('.ds-learn-steps > li').length, t.id).toBe(t.steps.length);
      expect(document.querySelector('[data-tour="learn-compare"]'), t.id).toBeTruthy();
      expect(document.body.textContent, t.id).not.toMatch(/준비 중|연결 전/);
      cleanup();
    }
  });
  it('허브에 준비 중 묶음이 없고 카드마다 시작 버튼', () => {
    mount('/learn');
    expect(document.querySelector('.ds-learn-planned')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^시작 · \d+단계/ }).length).toBe(TUTORIALS.length);
    expect(document.body.textContent).not.toMatch(/준비 중/);
  });
});

describe('가이드 패널 (보기 모드)', () => {
  it('시작하면 1단계 → 다음을 누르면 그 단계 화면으로 이동하고 대상을 찾는다', async () => {
    mount('/learn/CS-01');
    fireEvent.click(screen.getByRole('button', { name: '보기 모드로 시작' }));
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe('무엇을 확인하나');
    fireEvent.click(within(dock).getByRole('button', { name: '다음' }));
    await waitFor(() => expect(where()).toContain('/features/FEAT-00022/1.0.0?tab=safety'));
    expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe('Feature 분류 확인');
    await waitFor(() => expect(document.querySelector('[data-tour="safety-tab"]')!.getAttribute('data-tour-active')).toBe('true'));
  });

  it('단계 역할이 지금 역할과 다르면 배너 → 전환하면 화면 이동 없이 역할만 바뀐다', async () => {
    localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: 'CS-01', step: 6, mode: 'view', startedAt: '2026-10-13T00:00:00Z' }));
    learnStore.reload();
    mount('/features/FEAT-00022/1.0.0?tab=gates', 'author');
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect(within(dock).getByText(/역할로 진행합니다/)).toBeTruthy();
    fireEvent.click(within(dock).getByRole('button', { name: '역할 전환' }));
    await waitFor(() => expect(where()).toBe('/features/FEAT-00022/1.0.0?tab=gates|quality'));
    expect(within(dock).queryByText(/역할로 진행합니다/)).toBeNull();
  });

  it('규칙 칩을 누르면 보고서 원문(규칙·근거·검증)을 연다', async () => {
    localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: 'CS-01', step: 0, mode: 'view', startedAt: '2026-10-13T00:00:00Z' }));
    learnStore.reload();
    mount('/learn/CS-01');
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    fireEvent.click(within(dock).getByRole('button', { name: 'FFG-DEAC-001 원문 요약 보기' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer.textContent).toContain('원격 Kill은 요청이며 안전기제가 아님');
    expect(drawer.textContent).toContain('ISO 26262-4:2018 cl.6');
  });

  it('끝내면 진행 상태를 지우고 시나리오 화면으로 돌아간다', async () => {
    localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: 'CS-01', step: 6, mode: 'view', startedAt: '2026-10-13T00:00:00Z' }));
    learnStore.reload();
    mount('/features/FEAT-00022/1.0.0?tab=gates', 'quality');
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    fireEvent.click(within(dock).getByRole('button', { name: '끝내기' }));
    await waitFor(() => expect(where()).toContain('/learn/CS-01'));
    expect(localStorage.getItem('ff.learn.v1')).toBeNull();
  });
});

describe('직접 하기 — 화면 결과로 단계 완료 판정', () => {
  // CLASSIFY-GATE 4단계(조합 검사를 일부러 어긴다) — 판정: [data-rule="FFG-CLS-009"][data-status="fail"]
  const steps = tutorialById('CLASSIFY-GATE')!.steps;
  const at = steps.findIndex((s) => s.id === 'combo-fail');
  const seed = (mode: 'view' | 'self') => {
    localStorage.setItem('ff.learn.v1', JSON.stringify({ scenarioId: 'CLASSIFY-GATE', step: at, mode, startedAt: '2026-11-06T00:00:00Z' }));
    learnStore.reload();
  };

  it('직접 하기로 시작하면 1단계부터, 머리에 방식이 보인다', async () => {
    mount('/learn/CLASSIFY-GATE');
    fireEvent.click(screen.getByRole('button', { name: '직접 하기' }));
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect(within(dock).getByText(/직접 하기/)).toBeTruthy();
    expect(learnStore.get()).toMatchObject({ scenarioId: 'CLASSIFY-GATE', step: 0, mode: 'self' });
  });

  it('결과가 화면에 나오기 전에는 다음이 막히고, 나오면 완료 표시와 함께 열린다 — 이전으로 돌아와도 완료가 남는다', async () => {
    seed('self');
    mount(steps[at].route);
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe(steps[at].title);
    const next = () => within(dock).getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    expect(within(dock).getByText('이 단계의 결과가 화면에 나와야 다음으로 갑니다')).toBeTruthy();
    expect(dock.querySelector('[data-check="wait"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'make-result' }));
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(dock.querySelector('[data-check="done"]')!.textContent).toContain(steps[at].check!.doneKo);
    expect(learnStore.get()!.done).toContain('combo-fail');
    // 다음 단계(판정 전)로 갔다가 돌아오면 — 앞 단계의 판정이 새 단계로 옮겨 붙지 않고, 돌아온 단계는 완료가 남는다
    fireEvent.click(next());
    await waitFor(() => expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe(steps[at + 1].title));
    expect(learnStore.get()!.done).not.toContain(steps[at + 1].id);
    fireEvent.click(within(dock).getByRole('button', { name: '이전' }));
    await waitFor(() => expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe(steps[at].title));
    expect(dock.querySelector('[data-check="done"]')).toBeTruthy();
  });

  it('보기 모드는 판정 전이라도 다음으로 갈 수 있다', async () => {
    seed('view');
    mount(steps[at].route);
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect((within(dock).getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(false);
    expect(dock.querySelector('[data-check="wait"]')).toBeTruthy();
  });
});

describe('표준 설명 모드', () => {
  it('켜면 html[data-explain=on] — 근거 칩은 이때만 보인다(CSS), 칩에는 규칙 제목', () => {
    render(<Explain rules={['FFG-PLT-003']} />);
    expect(screen.getByRole('button', { name: 'FFG-PLT-003 원문 요약 보기' }).getAttribute('title')).toBe('등급은 Registry 데이터, 운영자가 선택하지 않음');
    learnStore.setExplain(true);
    expect(document.documentElement.getAttribute('data-explain')).toBe('on');
    learnStore.setExplain(false);
    expect(document.documentElement.getAttribute('data-explain')).toBe('off');
  });
});
