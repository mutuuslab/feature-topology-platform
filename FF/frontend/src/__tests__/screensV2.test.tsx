// v2 거버넌스 화면 — 모의 API로 상태(로딩·빈·오류·권한)와 핵심 상호작용을 검증한다.
// 실제 백엔드와의 끝단 흐름은 e2e(governance.spec.ts)가 맡는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import FeatureList from '../screens/features/FeatureList';
import FeatureDetail from '../screens/features/FeatureDetail';
import BaselineQueue from '../screens/bom/BaselineQueue';
import Precheck from '../screens/governance/Precheck';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body), { status, headers: { 'Content-Type': 'application/json' } });
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

const F22 = { featureId: 'FEAT-00022', version: '1.0.0', isLatest: true, name: '전방 안전거리 3단계', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', lifecycle: 'RELEASED', baselineId: 'BL-00028', ownerId: 'ADAS상품기획팀', asil: 'B', tags: [], controlPoints: ['Signal'], gates: { G1: 'PASS', G2: 'PASS', G3: 'PASS', G4: 'PASS', G5: 'PASS', G6: 'PASS', G7: 'PASS', G8: 'PASS', G9: 'PASS' } };
const F13 = { ...F22, featureId: 'FEAT-00013', version: '0.3.0', name: '예측 공조', lifecycle: 'PROPOSED', baselineId: null, gates: {} };
const LIST = { total: 2, items: [F22, F13], facets: { lifecycle: { RELEASED: 1, PROPOSED: 1 }, country: { KR: 2 }, vehicleModel: { 'NX4 PE': 2 } } };

describe('Feature Registry 목록', () => {
  it('API 데이터로 지표·표를 그리고, 행을 열면 상세로 간다', async () => {
    handler = () => ({ body: LIST });
    mount('/features', '/features', <FeatureList />);
    expect(await screen.findByText('전방 안전거리 3단계')).toBeTruthy();
    expect(document.querySelector('[data-state="ready"]')).toBeTruthy();
    // 핵심 메시지 = Feature 수, 요약 줄 = Baseline 확정 수(출시·제안 수는 Lifecycle 탭이 보인다)
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('2');
    expect([...document.querySelectorAll('.ds-summary b')].map((k) => k.textContent)).toEqual(['1']);
    expect(calls.some((c) => c.url.startsWith('/api/features?') && c.url.includes('latestOnly=true'))).toBe(true);
  });

  it('API 오류면 오류 상태와 다시 시도 버튼', async () => {
    handler = () => ({ status: 500, body: { error: { code: 'INTERNAL', message: '서버 내부 오류' } } });
    mount('/features', '/features', <FeatureList />);
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).toBeTruthy());
    expect(screen.getAllByText('서버 내부 오류').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '다시 시도' }).length).toBeGreaterThan(0);
  });

  it('결과가 없으면 빈 상태', async () => {
    handler = () => ({ body: { total: 0, items: [], facets: { lifecycle: {}, country: {}, vehicleModel: {} } } });
    mount('/features', '/features', <FeatureList />);
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeTruthy());
  });
});

const DETAIL = {
  feature: { ...F13, requirementIds: ['REQ-1'], description: '예측', upgVc: [], functions: [], swIds: [], swVersions: [], ecuPnos: [], dependencyIds: [], catalogIds: [], gateRecordIds: [], _missing: { baselineId: '미발급', swIds: '미입력' } },
  meta: { createdBy: null, createdAt: null },
  gates: {},
  dependencies: { outgoing: [], incoming: [] },
  functions: [],
  trace: [],
  baseline: null,
  products: [],
  pendingBaselineRequest: null,
  transitions: [{ to: 'APPROVED', ko: '정의 승인', auto: false, roles: ['Feature 승인자'], blockers: [{ code: 'GATE_UNJUDGED', message: 'G1 Feature Gate 미판정', ref: 'G1' }, { code: 'GATE_UNJUDGED', message: 'G2 Requirement Gate 미판정', ref: 'G2' }] }],
  versions: [{ version: '0.3.0', lifecycle: 'PROPOSED', baselineId: null }],
};

describe('Feature Version 상세', () => {
  it('스테퍼가 현재 상태와 다음 전이의 막힌 사유를 보여 준다', async () => {
    handler = () => ({ body: DETAIL });
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    const current = document.querySelector('.ds-step[data-state="current"]')!;
    expect(current.getAttribute('data-lifecycle')).toBe('PROPOSED');
    const next = document.querySelector('.ds-step[data-lifecycle="APPROVED"]')!;
    expect(within(next as HTMLElement).getByText('G1 Feature Gate 미판정')).toBeTruthy();
  });

  it('자리표시(미발급·미입력)를 속성 옆에 표시한다', async () => {
    handler = () => ({ body: DETAIL });
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />);
    expect(await screen.findByText('미발급')).toBeTruthy();
    expect(screen.getByText('미입력')).toBeTruthy();
  });

  it('작성자 역할로는 정의 승인 전이를 실행할 수 없다 (버튼 비활성·이유 표시)', async () => {
    handler = () => ({ body: DETAIL });
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />, 'author');
    fireEvent.click(await screen.findByRole('button', { name: 'APPROVED로 전이' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '실행' })).toHaveProperty('disabled', true);
    expect(within(dialog).getAllByText(/Feature 승인자 역할이 할 수 있습니다/).length).toBeGreaterThan(0);
  });

  it('FFG-LCY-001·003 Gate 탭: Decision Record 서명 상태·재-HARA 요청 — 판정 이력마다 서명됨·이관 기록 봉인·서명 없음(전이 근거 아님)', async () => {
    const rec = (id: string, decision: string) => ({ gateRecordId: id, featureId: 'FEAT-00013', featureVersion: '0.3.0', country: 'KR', gate: 'G1', gateName: 'Feature Gate', inputResult: 'PASS', rationale: '확인', evidenceRef: 'EV-1', judgeRole: 'Gate 판정자', judgedAt: '2026-10-12T10:00:00+09:00', status: 'PASS', gateStageLifecycle: 'PROPOSED', currentLifecycle: 'PROPOSED', transitionNote: '', _missing: {}, decision });
    const GATES = {
      gates: [
        {
          gate: 'G1', name: 'Feature Gate', judgeRole: 'Gate 판정자', stage: 'PROPOSED', status: 'PASS', evidence: null,
          latest: rec('SIM-G1-000003', 'MISSING'),
          decision: { state: 'MISSING', reason: 'SIM-G1-000003: 서명된 Decision Record가 없습니다', kid: null, approver: null },
          history: [rec('SIM-G1-000001', 'IMPORTED'), rec('SIM-G1-000002', 'SIGNED'), rec('SIM-G1-000003', 'MISSING')],
        },
      ],
      rehara: [
        { requestId: 'RH-00001', condition: 'CONTROL', detail: 'takeoverMs 4000 → 2500', status: 'OPEN', createdAt: 'x', resolvedBy: null },
        { requestId: 'RH-00002', condition: 'TOPOLOGY', detail: 'DEP-00030 FEAT-00013 REQUIRES FEAT-00024', status: 'RESOLVED', createdAt: 'x', resolvedBy: 'SIM-G2-000009' },
      ],
    };
    handler = (url) => (url.includes('/gates') ? { body: GATES } : { body: DETAIL });
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />);
    fireEvent.click(await screen.findByRole('tab', { name: /Gate 판정/ }));
    const note = await screen.findByTestId('gate-decision');
    expect(note.textContent).toContain('서명 없음 — 전이 근거 아님');
    expect(note.textContent).toContain('서명된 Decision Record가 없습니다');
    expect(screen.getByTestId('decision-SIM-G1-000001').textContent).toBe('이관 기록 봉인');
    expect(screen.getByTestId('decision-SIM-G1-000002').textContent).toBe('서명됨');
    // FFG-LCY-003 — 열린 재-HARA 요청은 G3 이후 PASS를 막는다는 안내와 함께
    const rh = screen.getByTestId('rehara');
    expect(rh.textContent).toContain('재-HARA 요청 1건이 열려 있습니다');
    expect([...rh.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['FAIL', 'PASS']);
    expect(rh.textContent).toContain('닫힘 — SIM-G2-000009');
  });
});

describe('BOM 확정 승인 큐', () => {
  const REQ = { requestId: 'BR-00001', featureId: 'FEAT-00022', version: '1.1.0', status: 'PENDING', requestedBy: 'usr-author', requestedAt: '2026-10-12T01:00:00Z', reason: '변경 기준선', decidedBy: null, decidedAt: null, decisionReason: null, baselineId: null };
  it('체크리스트에 FAIL이 있으면 승인 버튼이 잠긴다', async () => {
    handler = (url) =>
      url.includes('/requests/BR-00001')
        ? { body: { request: REQ, checklist: [{ id: 'STATE', label: 'Lifecycle이 APPROVED 이상', state: 'PASS', detail: 'DEVELOPING' }, { id: 'ATTRS', label: '단계별 필수 속성', state: 'FAIL', detail: '누락: swIds' }] } }
        : { body: { items: [REQ] } };
    mount('/baselines?request=BR-00001', '/baselines', <BaselineQueue />, 'steward');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('누락: swIds')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '확인 완료' } });
    expect(within(dialog).getByRole('button', { name: '확정 승인' })).toHaveProperty('disabled', true);
    expect(within(dialog).getByRole('button', { name: '반려' })).toHaveProperty('disabled', false);
  });

  it('반려하면 결정 API를 BOM 승인자 역할·멱등 키와 함께 호출한다', async () => {
    handler = (url, init) =>
      init?.method === 'POST'
        ? { body: { request: { ...REQ, status: 'REJECTED' } } }
        : url.includes('/requests/BR-00001')
          ? { body: { request: REQ, checklist: [] } }
          : { body: { items: [REQ] } };
    mount('/baselines?request=BR-00001', '/baselines', <BaselineQueue />, 'steward');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByRole('textbox'), { target: { value: 'SW 형상 재확인 필요' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '반려' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('/api/baselines/requests/BR-00001/decision');
    const h = post.init!.headers as Record<string, string>;
    expect(h['X-Actor-Role']).toBe('BOM_APPROVER');
    expect(h['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(post.init!.body as string)).toEqual({ decision: 'REJECT', reason: 'SW 형상 재확인 필요' });
  });
});

describe('데이터 사전점검', () => {
  it('규칙 판정과 데이터셋 예시 판정을 나란히 보여 준다', async () => {
    handler = () => ({
      body: {
        ruleVersion: 'DATA-PRECHECK-1.0',
        summary: { PASS: 1, CONDITIONAL: 1, FAIL: 0, dataQualityFindings: 2 },
        rules: [
          { ruleId: 'DATA-PRECHECK-1.0-01', title: '원천·대상 Feature/Version 참조', result: 'PASS', expected: 'PASS', summary: '29건', findings: [] },
          { ruleId: 'DATA-PRECHECK-1.0-04', title: 'REQUIRES Lifecycle', result: 'CONDITIONAL', expected: 'CONDITIONAL', summary: '25건 중 20건 PASS', findings: [{ key: 'DEP-00010', result: 'CONDITIONAL', message: '원천 PROPOSED' }] },
        ],
        dataQuality: [{ ruleId: 'DQ-01', title: 'SW_Master 설명의 Feature 참조', result: 'CONDITIONAL', summary: 'SW 47건', findings: [] }],
      },
    });
    mount('/precheck', '/precheck', <Precheck />);
    expect(await screen.findByText('REQUIRES Lifecycle')).toBeTruthy();
    fireEvent.click(screen.getByText('REQUIRES Lifecycle'));
    expect(await screen.findByText('원천 PROPOSED')).toBeTruthy();
  });
});
