// P9 화면 — PoC 6단계 러너·42 컴포넌트 아키텍처·OpenFeature 웹 SDK 패널(OF-2·3). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RULE_STATUS, STANDARDS_MAP } from '@ff/contracts';
import { AppProvider } from '../store';
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
  it('도메인별 카드, 카드를 열면 화면·시험', async () => {
    handler = (url) => {
      if (url.startsWith('/api/components/activity'))
        return { body: { since: 'x', items: [{ id: 'D01-06', events: 5, lastAt: '2026-10-12T01:00:00Z', lastType: 'policy.deployed', audits: 2, refused: 0 }] } };
      if (url.startsWith('/api/components')) return { body: { items: [COMP('D01-06', 'implemented', [2, 3]), COMP('D03-03', 'implemented', [6]), COMP('D05-04', 'planned', [])] } };
    };
    mount('/arch/components', '/arch/components', <ArchitectureScreen />);
    const card = await screen.findByRole('button', { name: /^컴포넌트 D01-06 구현 · D01-06$/ });
    expect(card.getAttribute('data-dim')).toBe('false');
    expect(screen.getByRole('button', { name: /D03-03/ }).getAttribute('data-dim')).toBe('false');
    expect(screen.getByRole('button', { name: /D05-04 계획/ }).getAttribute('data-status')).toBe('planned');
    // 핵심 메시지 하나(구현 n/전체) + 회색 요약 한 줄(3초 테스트)
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('2/3');
    expect([...document.querySelectorAll('.ds-summary b')].map((k) => k.textContent)).toEqual(['1', '1', '1', `${Object.keys(STANDARDS_MAP).filter((id) => RULE_STATUS[id]?.tested).length}/75`]);
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
    const gate = await screen.findByRole('button', { name: /^컴포넌트 D03-02 / });
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

  it('FFG-PLT-013 도구 신뢰성: 상세에 오류 출력별 TI·TD → TCL과 신뢰도 확보 방법, 서명 서비스는 TCL3·후속 검출 없음, 8.1 밖은 분류 안 됨', async () => {
    handler = (url) => {
      if (url.startsWith('/api/components/activity')) return { body: { since: 'x', items: [] } };
      if (url.startsWith('/api/components')) return { body: { items: [COMP('D03-02', 'implemented', [4]), COMP('D06-10', 'implemented', [5]), COMP('D05-04', 'planned', [])] } };
      return undefined;
    };
    mount('/arch/components', '/arch/components', <ArchitectureScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^컴포넌트 D06-10 / }));
    let tq = await screen.findByTestId('tool-qualification');
    expect(tq.textContent).toContain('TCL3');
    expect(tq.textContent).toContain('TI2·TD3 → TCL3 · 검출 수단: 후속 검출 수단 없음');
    expect(tq.textContent).toContain('1c 도구 검증(validation)');
    fireEvent.click(screen.getByRole('button', { name: /^컴포넌트 D05-04 / }));
    tq = await screen.findByTestId('tool-qualification');
    await waitFor(() => expect(screen.getByTestId('tool-qualification').textContent).toContain('분류 안 됨'));
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

describe('OpenFeature 경계 (FFG-OFT-001)', () => {
  it('F2 이상 flag는 DISABLED·decided_by=vehicle_safety_guard — 서버 판단과 달라도 불일치(FAIL)가 아니라 경계 안내', async () => {
    handler = (url) => (url.includes('/ofrep/v1/evaluate/flags') ? { headers: { ETag: '"g1"' }, body: { flags: [{ key: 'care_00022_param', value: false, variant: 'safe_default', reason: 'DISABLED', metadata: { decided_by: 'vehicle_safety_guard', f_class: 'F3' } }] } } : undefined);
    mount('/a', '/a', <OpenFeaturePanel vin="ego-01" flagKey="care_00022_param" serverValue={true} pollInterval={60} />);
    expect(await screen.findByTestId('of-guarded')).toBeTruthy();
    expect(screen.queryByText('FAIL')).toBeNull();
    expect(screen.getByRole('link', { name: 'OpenFeature 범위 보기' })).toBeTruthy();
  });
});

it('웹 SDK bulk에 F2 이상 키가 없으면(FFG-OFT-005) FLAG_NOT_FOUND — 서버에는 배포돼 있으므로 경계 안내', async () => {
  handler = (url) => (url.includes('/ofrep/v1/evaluate/flags') ? { headers: { ETag: '"g2"' }, body: { flags: [{ key: 'ivi_00024_guide', value: true, variant: 'on', reason: 'TARGETING_MATCH', metadata: {} }] } } : undefined);
  mount('/a', '/a', <OpenFeaturePanel vin="ego-01" flagKey="care_00022_param" serverValue={true} pollInterval={60} />);
  expect(await screen.findByTestId('of-guarded')).toBeTruthy();
  expect(screen.queryByText('FAIL')).toBeNull();
});
