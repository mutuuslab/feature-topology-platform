// P9 화면 — PoC 6단계 러너·42 컴포넌트 아키텍처·OpenFeature 웹 SDK 패널(OF-2·3). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RULE_STATUS, STANDARDS_MAP } from '@ff/contracts';
import { AppProvider } from '../store';
import { PocScreen } from '../screens/home/Poc';
import { ArchitectureScreen } from '../screens/home/Architecture';
import { OpenFeaturePanel } from '../screens/policy/OpenFeaturePanel';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;
let handler: Handler;
const calls: { url: string; init?: RequestInit; body?: string }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // 웹 OFREP provider는 Request 객체로 부른다 — 본문·헤더도 거기서 읽는다
      const body = input instanceof Request ? await input.clone().text() : typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, init: init ?? (input instanceof Request ? { method: input.method } : undefined), body });
      const r = handler(url, init ?? (input instanceof Request ? { method: input.method, headers: input.headers } : undefined)) ?? {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: url } },
      };
      return new Response(r.status === 304 ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path: string, routePath: string, el: JSX.Element, role = 'operator') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={routePath} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const STEP = (no: number, status: string, extra: Record<string, unknown> = {}) => ({
  no,
  title: ['Feature 등록·상품 구성', '정책 준비·검증·승인', '사용 권한·서버 활성화 판단', '정책 배포·차량 수신', '차량 평가·체험 제안·기능 적용', '이상 확인·긴급 차단·차단 적용'][no - 1],
  status,
  startedAt: null,
  endedAt: null,
  actions: [],
  evidence: {},
  components: ['D01-01'],
  note: null,
  ...extra,
});
const RUN = (steps: unknown[], status = 'RUNNING') => ({
  runId: 'POC-00001',
  status,
  startedAt: '2026-10-12T01:00:00Z',
  startedBy: 'seo.ops',
  subject: { featureId: 'FEAT-00022', version: '1.0.0', flagKey: 'care_00022_param', vin: 'ego-01' },
  refs: {},
  steps,
});

describe('PoC 6단계 러너', () => {
  it('실행이 없으면 안내, 시작하면 6단계가 보이고 다음 단계는 advance를 부른다', async () => {
    let started = false;
    const run1 = RUN([
      STEP(1, 'DONE', {
        actions: [{ at: 'x', actor: 'poc.author', role: 'FEATURE_AUTHOR', route: 'featureDetail', summary: 'FEAT-00022 1.0.0 RELEASED', ok: true }],
        evidence: { lifecycle: 'RELEASED', gatesPass: '9/9' },
      }),
      ...[2, 3, 4, 5, 6].map((n) => STEP(n, 'PENDING')),
    ]);
    handler = (url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/poc/runs')) return ((started = true), { status: 201, body: run1 });
      if (init?.method === 'POST') return { body: run1 };
      if (url.startsWith('/api/poc/runs/POC-00001')) return { body: run1 };
      if (url.startsWith('/api/poc/runs')) return { body: { items: started ? [run1] : [] } };
    };
    mount('/poc', '/poc', <PocScreen />);
    expect(await screen.findByText('아직 실행이 없습니다 — 새 실행을 시작하세요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '새 실행 시작' }));
    const steps = await screen.findByRole('list', { name: 'PoC 6단계 진행' });
    expect(within(steps).getAllByRole('button')).toHaveLength(6);
    // 현재 단계(②)가 표시되고, ①을 고르면 행위·증적
    fireEvent.click(within(steps).getAllByRole('button')[0]);
    expect(await screen.findByText('FEAT-00022 1.0.0 RELEASED')).toBeTruthy();
    expect(screen.getByText('9/9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음 단계' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST' && c.url.endsWith('/api/poc/runs/POC-00001/advance'))).toBe(true));
  });

  it('작성자는 실행할 수 없다', async () => {
    handler = (url) => (url.startsWith('/api/poc/runs') ? { body: { items: [] } } : undefined);
    mount('/poc', '/poc', <PocScreen />, 'author');
    expect(((await screen.findByRole('button', { name: '새 실행 시작' })) as HTMLButtonElement).disabled).toBe(true);
  });
});

const COMP = (id: string, status: string, pocSteps: number[]) => ({
  id,
  ko: `컴포넌트 ${id}`,
  domain: id.slice(0, 3),
  tier: 'A',
  status,
  endpoints: [],
  screens: ['/policies'],
  tests: ['x.spec.ts'],
  ifs: id === 'D01-06' ? ['IF-04'] : [],
  pocSteps,
  registered: status === 'implemented',
  providers: [],
});

describe('42 컴포넌트 아키텍처', () => {
  it('도메인별 카드, PoC 단계 필터는 관여하지 않는 컴포넌트를 흐리게, 카드를 열면 화면·시험', async () => {
    handler = (url) => {
      if (url.startsWith('/api/components/activity'))
        return { body: { since: 'x', items: [{ id: 'D01-06', events: 5, lastAt: '2026-10-12T01:00:00Z', lastType: 'policy.deployed', audits: 2, refused: 0 }] } };
      if (url.startsWith('/api/components')) return { body: { items: [COMP('D01-06', 'implemented', [2, 3]), COMP('D03-03', 'implemented', [6]), COMP('D05-04', 'planned', [])] } };
    };
    mount('/arch/components?step=6', '/arch/components', <ArchitectureScreen />);
    const card = await screen.findByRole('button', { name: /D01-06 컴포넌트 D01-06 구현/ });
    expect(card.getAttribute('data-dim')).toBe('true');
    expect(screen.getByRole('button', { name: /D03-03/ }).getAttribute('data-dim')).toBe('false');
    expect(screen.getByRole('button', { name: /D05-04 .* 계획/ }).getAttribute('data-status')).toBe('planned');
    expect([...document.querySelectorAll('.ds-kpi__value')].map((k) => k.textContent)).toEqual([
      '2/3',
      '1',
      '1',
      '1',
      `${Object.keys(STANDARDS_MAP).filter((id) => RULE_STATUS[id]?.tested).length}/75`,
    ]);
    fireEvent.click(card);
    expect(await screen.findByRole('link', { name: '/policies' })).toBeTruthy();
    expect(screen.getByText('policy.deployed')).toBeTruthy();
  });

  it('보고서 v1.1 반영 — 작업 단계(WP3)를 고르면 그 단계가 고치는 기존 컴포넌트만 또렷하고, 상세에 집행할 규칙과 상태', async () => {
    handler = (url) => {
      if (url.startsWith('/api/components/activity')) return { body: { since: 'x', items: [] } };
      if (url.startsWith('/api/components')) return { body: { items: [COMP('D03-02', 'implemented', [4]), COMP('D01-06', 'implemented', [2, 3]), COMP('D05-04', 'planned', [])] } };
      return undefined;
    };
    mount('/arch/components?wp=WP3', '/arch/components', <ArchitectureScreen />);
    const gate = await screen.findByRole('button', { name: /D03-02 컴포넌트 D03-02/ });
    expect(gate.getAttribute('data-dim')).toBe('false');
    expect(screen.getByRole('button', { name: /D05-04/ }).getAttribute('data-dim')).toBe('true'); // 보고서 규칙 배치 없음
    const wp3 = Object.keys(STANDARDS_MAP).filter((id) => STANDARDS_MAP[id].wp === 'WP3' && STANDARDS_MAP[id].components.includes('D03-02'));
    expect(gate.textContent).toContain(`/${wp3.length}`);
    fireEvent.click(gate);
    const list = await screen.findByText('보고서 규칙 — 이 컴포넌트가 집행');
    const panel = list.closest('.ds-rules') as HTMLElement;
    expect(within(panel).getByText('FFG-PLT-017')).toBeTruthy();
    expect(within(panel).getByText('주문 순번은 원장 기준 +1')).toBeTruthy();
  });
});

describe('OpenFeature 웹 SDK 패널 (OF-2·3)', () => {
  it('OFREP bulk로 받은 값이 서버 판단과 같고, ETag 폴링으로 차단(OFF)을 감지한다', async () => {
    let value = true;
    let etag = '"v1"';
    handler = (url, init) => {
      if (!url.includes('/ofrep/v1/evaluate/flags')) return undefined;
      const sent = new Headers(init?.headers).get('If-None-Match');
      if (sent === etag) return { status: 304 };
      return {
        headers: { ETag: etag },
        body: {
          flags: [
            {
              key: 'care_00022_param',
              value,
              variant: value ? 'on' : 'off',
              reason: value ? 'TARGETING_MATCH' : 'DISABLED',
              metadata: { policyId: 'POL-00002', platformReason: value ? 'POLICY_MATCH' : 'KILL_SWITCH' },
            },
          ],
        },
      };
    };
    mount('/a', '/a', <OpenFeaturePanel vin="ego-01" flagKey="care_00022_param" serverValue={true} pollInterval={60} />);
    await waitFor(() => expect(screen.getByTestId('of-value').textContent).toBe('ON'));
    expect(screen.getByText(/TARGETING_MATCH/)).toBeTruthy();
    expect(screen.getByText(/policyId=POL-00002/)).toBeTruthy();
    const body = JSON.parse(calls.find((c) => c.url.includes('/ofrep/v1/evaluate/flags'))!.body!);
    expect(body.context.targetingKey).toBe('ego-01');
    // 서버에서 긴급 차단 — ETag가 바뀌고 SDK가 설정 변경을 감지
    value = false;
    etag = '"v2"';
    await waitFor(() => expect(screen.getByTestId('of-value').textContent).toBe('OFF'), { timeout: 3000 });
    expect(screen.getByText(/설정 변경 감지/)).toBeTruthy();
  });
});
