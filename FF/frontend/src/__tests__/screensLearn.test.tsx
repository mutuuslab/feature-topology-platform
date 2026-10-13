// 표준 따라하기 — 허브·시나리오 화면, 가이드 패널(단계 이동·역할 전환·규칙 원문), 표준 설명 모드.
// 하네스: 단계가 가리키는 화면 경로는 라우트 표에, 스포트라이트 앵커(data-tour)는 화면 코드에 실제로 있어야 한다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { stepPath, TUTORIALS } from '@ff/contracts';
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
            <Route path="*" element={<div data-tour="feature-header">target</div>} />
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

describe('하네스 — 시나리오 단계가 실제 화면을 가리킨다', () => {
  const pattern = (p: string) => new RegExp('^' + p.replace(/:\w+/g, '[^/]+') + '$');
  it('단계 경로는 모두 라우트 표의 화면이다', () => {
    const bad = TUTORIALS.flatMap((t) => t.steps.filter((s) => !ROUTES.some((r) => pattern(r.path).test(stepPath(s)))).map((s) => `${t.id}/${s.id} ${s.route}`));
    expect(bad).toEqual([]);
  });
  it('스포트라이트 앵커는 모두 화면 코드에 data-tour(또는 tour=)로 있다', () => {
    const src: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n)) src.push(readFileSync(p, 'utf8'));
      }
    };
    walk(join(__dirname, '..', 'screens'));
    const all = src.join('\n');
    // data-tour="x" · tour="x" · tours={{ G5: 'x' }}
    const missing = TUTORIALS.flatMap((t) => t.steps.filter((s) => !new RegExp(`(data-tour|tours?)=[^\\n]*["']${s.anchor}["']`).test(all)).map((s) => `${t.id}/${s.id} → ${s.anchor}`));
    expect(missing).toEqual([]);
  });
});

describe('허브·시나리오 화면', () => {
  it('시나리오 카드를 모두 보이고 읽기 경로로 거른다', () => {
    mount('/learn');
    expect(screen.getAllByRole('listitem').length).toBe(TUTORIALS.length);
    fireEvent.click(screen.getByRole('radio', { name: /검증·운영/ }));
    expect(screen.getAllByRole('listitem').length).toBe(TUTORIALS.filter((t) => t.readingPath === 'VERIFY_OPERATE').length);
  });
  it('자동 실행·직접 하기는 아직 연결 전이라 막혀 있고 이유가 보인다', () => {
    mount('/learn/CS-01');
    expect((screen.getByRole('button', { name: '자동 실행' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/아직 연결 전/).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/다음 개발 단계|\(F\d\)|\bU\d에서|\bF\d에서/); // 내부 단계 번호(U3·F1)는 화면에 없다 — 분류 표기 F3는 허용
    expect(screen.getByText(/위험 구간 26초/)).toBeTruthy();
  });
});

describe('가이드 패널 (보기 모드)', () => {
  it('시작하면 1단계 → 다음을 누르면 그 단계 화면으로 이동하고 대상을 찾는다', async () => {
    mount('/learn/CS-01');
    fireEvent.click(screen.getByRole('button', { name: '보기 모드로 시작' }));
    const dock = await screen.findByRole('complementary', { name: '따라하기 가이드' });
    expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe('무엇을 확인하나');
    fireEvent.click(within(dock).getByRole('button', { name: '다음' }));
    await waitFor(() => expect(where()).toContain('/features/FEAT-00022/1.0.0'));
    expect(within(dock).getByRole('heading', { level: 2 }).textContent).toBe('Feature 분류 확인');
    await waitFor(() => expect(document.querySelector('[data-tour="feature-header"]')!.getAttribute('data-tour-active')).toBe('true'));
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
