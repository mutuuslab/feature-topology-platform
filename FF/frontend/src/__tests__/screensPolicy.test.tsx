// P7 정책 파이프라인 화면 — 모의 API로 상태·권한·핵심 상호작용을 검증한다.
// 실제 백엔드와의 끝단 흐름(작성 → 검증 → 승인 → 배포 → 판단)은 e2e(policy.spec.ts)가 맡는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { PolicyDetail, PolicyList, ValidationHistory } from '../screens/policy/Policies';
import { ActivationScreen } from '../screens/policy/Runtime';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path: string, routePath: string, el: JSX.Element, role = 'author') {
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

const POL = {
  policyId: 'POL-00003', revision: 2, status: 'VALIDATED', featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: 'care_00022_trial',
  description: '체험 정책', enabled: true, safeDefault: false, entitlementCatalogId: 'CAT-00019', rollout: { mode: 'COHORT', basisPoints: 5000, salt: 'S' }, stageBasisPoints: 1000,
  contentHash: 'sha256:aa', createdBy: 'usr-author', createdAt: '2026-10-01T00:00:00.000Z', approvedBy: null, approvedAt: null,
};
const VALIDATORS = ['D06-01', 'D03-01', 'D06-03', 'D06-06', 'D06-02', 'D06-05', 'D04-02', 'D06-07'];
const RUN = {
  runId: 'VR-00001', policyId: 'POL-00003', policyRevision: 2, decision: 'HOLD', reasons: ['D06-03 HOLD'], at: '2026-10-02T00:00:00.000Z', by: 'usr-author',
  results: VALIDATORS.map((c, i) => ({ componentId: c, ko: `검증 ${c}`, result: i === 2 ? 'CONDITIONAL' : 'PASS', summary: `${c} 요약`, findings: [{ result: 'PASS', message: `${c} 근거` }] })),
};
const DETAIL = (over: Record<string, unknown> = {}) => ({ policy: POL, feature: { name: '전방 안전거리 3단계', asil: 'B' }, hashMatchesValidation: true, lastRun: RUN, runs: [RUN], approval: { eligible: false, reasons: ['HOLD'] }, ...over });

describe('정책 목록', () => {
  it('승인 범위와 단계 범위를 함께 보여 주고, 작성 권한이 없으면 새 정책 버튼을 막는다', async () => {
    handler = () => ({ body: { items: [POL] } });
    mount('/policies', '/policies', <PolicyList />, 'viewer');
    expect(await screen.findByText('care_00022_trial')).toBeTruthy();
    // 단계 10% / 승인 50% — 단계는 승인 범위를 넘을 수 없다
    expect(screen.getByText('10% / 50%')).toBeTruthy();
    expect((screen.getByRole('button', { name: /새 정책/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('빈 목록은 빈 상태로 표시한다', async () => {
    handler = () => ({ body: { items: [] } });
    mount('/policies', '/policies', <PolicyList />);
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeTruthy());
  });
});

describe('정책 상세', () => {
  it('검증기 8종 카드와 배포 안전성 판정을 그린다', async () => {
    handler = () => ({ body: DETAIL() });
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />);
    const grid = await screen.findByRole('list', { name: '분야별 검증 8종 (병렬)' });
    const cards = within(grid).getAllByRole('listitem');
    expect(cards.map((c) => c.getAttribute('data-result'))).toEqual(['PASS', 'PASS', 'CONDITIONAL', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    expect(screen.getByText(/HOLD — 보완 필요/)).toBeTruthy();
    expect(screen.getByText(/검증한 내용과 현재 내용이 같습니다/)).toBeTruthy();
  });

  it('검증 후 내용이 바뀌면 재검증을 요구한다', async () => {
    handler = () => ({ body: DETAIL({ hashMatchesValidation: false }) });
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />);
    expect(await screen.findByText(/검증 이후 내용이 바뀌었습니다/)).toBeTruthy();
  });

  it('검증 실행은 POST /validate로 가고, 승인 버튼은 승인자만 누를 수 있다', async () => {
    handler = (_url, init) => (init?.method === 'POST' ? { status: 201, body: RUN } : { body: DETAIL() });
    mount('/policies/POL-00003', '/policies/:id', <PolicyDetail />, 'author');
    const run = await screen.findByRole('button', { name: /분야별 검증 실행/ });
    expect((screen.getByRole('button', { name: /정책 승인/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(run);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/policies/POL-00003/validate' && c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.url.endsWith('/validate'))!;
    expect(new Headers(post.init?.headers).get('X-Actor-Role')).toBe('FEATURE_AUTHOR');
  });

  it('없는 정책은 오류 상태로 표시한다', async () => {
    handler = () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: '정책 없음' } } });
    mount('/policies/POL-09999', '/policies/:id', <PolicyDetail />);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy());
  });
});

describe('검증 이력', () => {
  it('실행마다 판정을 보여 주고, 행을 열면 8종 결과가 나온다', async () => {
    handler = () => ({ body: { items: [RUN] } });
    mount('/validations', '/validations', <ValidationHistory />);
    expect(await screen.findByText('VR-00001')).toBeTruthy();
    fireEvent.click(screen.getByText('VR-00001'));
    const grid = await screen.findByRole('list', { name: '분야별 검증 8종 (병렬)' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(8);
  });
});

// 사용 권한·체험권 화면은 screensTrials.test.tsx

const VEHICLES = { items: [{ vin: 'ego-01', label: 'PoC 시연 차량', quality: 'TRUSTED' }, { vin: 'KMH-NX4-0003', label: '문맥 지연', quality: 'STALE' }] };
const TRACE = [
  { step: 'DEPLOYED', result: 'TRUE', detail: 'DEPLOYED' },
  { step: 'KILL', result: 'FALSE', detail: '차단 없음' },
  { step: 'APPLICABILITY', result: 'TRUE', detail: 'KR/NX4 PE/Premium' },
  { step: 'ENTITLEMENT', result: 'TRUE', detail: 'CAT-00019' },
  { step: 'TARGETING', result: 'TRUE', detail: '규칙 없음' },
  { step: 'COHORT', result: 'TRUE', detail: '100%' },
  { step: 'DECIDE', result: 'ALLOW', detail: 'POLICY_MATCH' },
];
const decision = (vin: string) =>
  vin === 'ego-01'
    ? { vehicle: VEHICLES.items[0], entitlement: { active: true }, result: { flagKey: 'care_00022_param', value: true, variant: 'on', decision: 'ALLOW', reason: 'POLICY_MATCH', policyId: 'POL-00002', revision: 1, trace: TRACE } }
    : { vehicle: VEHICLES.items[1], entitlement: { active: false }, result: { flagKey: 'care_00022_param', value: false, variant: 'safe_default', decision: 'HOLD', reason: 'CONTEXT_UNKNOWN', policyId: 'POL-00002', revision: 1, trace: TRACE.slice(0, 3) } };

describe('활성화 판단', () => {
  it('선택 차량의 결과·7단계 근거·Fleet 전체 판단·OFREP 응답을 그린다', async () => {
    handler = (url) => {
      if (url.startsWith('/api/vehicles')) return { body: VEHICLES };
      if (url.startsWith('/api/policies')) return { body: { items: [{ flagKey: 'care_00022_param', status: 'DEPLOYED' }] } };
      if (url.startsWith('/api/activation/decide')) return { body: decision(new URL(url, 'http://x').searchParams.get('vin')!) };
      if (url.startsWith('/ofrep/')) return { body: { key: 'care_00022_param', value: true, reason: 'TARGETING_MATCH' } };
      return { status: 404, body: {} };
    };
    mount('/activation/decide?vin=ego-01&flagKey=care_00022_param', '/activation/decide', <ActivationScreen />);
    expect(await screen.findByText('ON')).toBeTruthy();
    const steps = document.querySelectorAll('.ds-trace li');
    expect([...steps].map((s) => s.getAttribute('data-step'))).toEqual(['DEPLOYED', 'KILL', 'APPLICABILITY', 'ENTITLEMENT', 'TARGETING', 'COHORT', 'DECIDE']);
    // Fleet 전체 — 문맥이 지연된 차량은 HOLD(Safe Default)
    expect(await screen.findByText('CONTEXT_UNKNOWN')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/TARGETING_MATCH/)).toBeTruthy());
    const ofrep = calls.find((c) => c.url.startsWith('/ofrep/v1/evaluate/flags/care_00022_param'))!;
    expect(JSON.parse(String(ofrep.init?.body))).toEqual({ context: { targetingKey: 'ego-01' } });
  });
});
