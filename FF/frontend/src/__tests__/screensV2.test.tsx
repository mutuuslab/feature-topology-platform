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
    // 핵심 메시지 = 승인을 기다리는 제안 수(UX3-08), 요약 줄 = Feature ID·Version 수(Baseline 확정 줄은 뺐다)
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('1');
    expect([...document.querySelectorAll('.ds-summary b')].map((k) => k.textContent)).toEqual(['2', '2']);
    expect(calls.some((c) => c.url.startsWith('/api/features?') && c.url.includes('latestOnly=false'))).toBe(true);
  });

  // UI 하네스 2판 5단계(2026-10-23): 홈 'VERIFIED 3'을 눌러 오면 칩은 6(모든 Version), 표는 3행(최신만)이었다 —
  // 칩·국가 수·표가 같은 대상(최신 Version 여부·국가·검색·F 분류)을 같은 규칙으로 센다.
  it('Lifecycle 칩·국가 수·표 행 수가 같은 범위를 센다(최신 Version만이면 옛 Version은 빠진다)', async () => {
    const OLD = { ...F22, version: '0.9.0', isLatest: false };
    const US = { ...F13, featureId: 'FEAT-00090', name: '미국 전용', country: 'US', lifecycle: 'RELEASED' };
    handler = () => ({ body: { total: 4, items: [F22, OLD, F13, US], facets: { lifecycle: { RELEASED: 3, PROPOSED: 1 }, country: { KR: 3, US: 1 }, vehicleModel: {} } } });
    mount('/features?lifecycle=RELEASED', '/features', <FeatureList />);
    await screen.findByText('전방 안전거리 3단계');
    const chip = (label: string) => [...document.querySelectorAll('.ds-seg__opt')].find((b) => b.firstChild?.textContent === label)?.querySelector('.ds-seg__count')?.textContent;
    // 탭 이름은 한글(UX3-08) — 출시 = RELEASED, 제안 = PROPOSED
    const RELEASED = '출시';
    expect(chip(RELEASED)).toBe('2');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(chip('제안')).toBe('1');
    expect(chip('전체')).toBe('3');
    const country = screen.getByRole('combobox', { name: '국가' }) as HTMLSelectElement;
    expect([...country.options].map((o) => o.textContent)).toEqual(['전체', 'KR (1)', 'US (1)']);
    fireEvent.change(country, { target: { value: 'KR' } });
    await waitFor(() => expect(chip(RELEASED)).toBe('1'));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(chip(RELEASED)).toBe('2'));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  // 사용자 결정(2026-10-23): Lifecycle은 플랫폼·JIRA 양쪽에서 관리 — 목록에서 JIRA Epic 상태를 Lifecycle 옆에 보이고, 어긋나면 표시
  it('JIRA Epic 열 — 키·상태를 Lifecycle 옆에, Lifecycle 기준 상태와 다르면 어긋남 표시', async () => {
    const EPICS = { items: [
      { feature: 'FEAT-00022@1.0.0', key: 'FFE-22', url: 'https://jira.ff.example/browse/FFE-22', status: 'In Progress', syncState: 'SYNCED', expected: 'Released' },
      { feature: 'FEAT-00013@0.3.0', key: 'FFE-13', url: 'https://jira.ff.example/browse/FFE-13', status: 'Proposed', syncState: 'SYNCED', expected: 'Proposed' },
    ] };
    handler = (url) => ({ body: url.startsWith('/api/integrations/sync/epics') ? EPICS : LIST });
    mount('/features', '/features', <FeatureList />);
    await screen.findByText('전방 안전거리 3단계');
    const row = (id: string) => document.querySelector(`tbody tr[data-key^="${id}"]`) as HTMLElement;
    await waitFor(() => expect(within(row('FEAT-00022')).getByRole('link', { name: 'FFE-22' })).toBeTruthy());
    expect(within(row('FEAT-00022')).getByText("Lifecycle 기준 'Released'과 다름")).toBeTruthy();
    expect(within(row('FEAT-00013')).getByText('Proposed')).toBeTruthy();
    expect(within(row('FEAT-00013')).queryByText(/Lifecycle 기준/)).toBeNull();
  });

  // UX3-08(3초 테스트 S4): 핵심 메시지 "68 Feature · Version 80개"는 개수뿐이라 행동으로 이어지지 않았고, "Baseline 확정 67" 줄이 남아 있었다.
  // Lifecycle 탭은 대문자 코드(PROPOSED…)였다 — 한글 이름, 코드는 툴팁.
  it('핵심 메시지 = 승인을 기다리는 제안 수(최신 Version) + 제안만 보기, 탭은 한글 이름', async () => {
    const OLD13 = { ...F13, version: '0.2.0', isLatest: false };
    handler = () => ({ body: { total: 3, items: [F22, F13, OLD13], facets: { lifecycle: {}, country: {}, vehicleModel: {} } } });
    mount('/features', '/features', <FeatureList />);
    await screen.findByText('전방 안전거리 3단계');
    const key = document.querySelector('[data-key-message]') as HTMLElement;
    expect(key.querySelector('.ds-key__value')?.textContent).toBe('1');
    expect(key.getAttribute('data-tone')).toBe('warn');
    expect(key.querySelector('.ds-key__text')?.textContent).toBe('승인을 기다리는 제안');
    expect(document.body.textContent).not.toMatch(/Baseline 확정/);
    const opts = [...document.querySelectorAll('.ds-seg__opt')].map((b) => b.firstChild?.textContent);
    expect(opts).toEqual(['전체', '제안', '정의 승인', '개발', '검증 완료', '출시', '신규 중단', '종료']);
    expect(document.querySelector('.ds-seg__opt [title="PROPOSED"]')?.textContent).toBe('제안');
    fireEvent.click(within(key).getByRole('link', { name: '제안만 보기 →' }));
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1));
    expect(screen.getByText('예측 공조')).toBeTruthy();
    expect(within(document.querySelector('[data-key-message]') as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('검색어로 목록을 즉시 거르고, 없는 값은 빈 상태', async () => {
    handler = () => ({ body: LIST });
    mount('/features', '/features', <FeatureList />);
    const box = await screen.findByRole('searchbox', { name: 'ID·이름·Owner·Tag 검색' });
    fireEvent.change(box, { target: { value: '예측' } });
    await waitFor(() => expect(screen.queryByText('전방 안전거리 3단계')).toBeNull());
    expect(screen.getByText('예측 공조')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'ZZZZ' } });
    await waitFor(() => expect(document.querySelector('[data-state="empty"]')).toBeTruthy());
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

  // UX3-08(3초 테스트 S4): 상세에서 RELEASED가 4번(핵심 메시지·스테퍼·Lifecycle 속성·Version 선택) 보였고 머리 칩이 9개였다.
  // Lifecycle은 핵심 메시지 상태 pill + 스테퍼로, 머리 칩은 ID·적용 범위·안전 분류·Epic만.
  it('Lifecycle은 핵심 메시지 pill과 스테퍼에만 — 속성 표·닫힌 Version 선택에 되풀이하지 않고, 머리 칩은 줄인다', async () => {
    const REL = { ...DETAIL, feature: { ...DETAIL.feature, ...F22, baselineId: 'BL-00028' }, versions: [{ version: '0.9.0', lifecycle: 'DEPRECATED', baselineId: null }, { version: '1.0.0', lifecycle: 'RELEASED', baselineId: 'BL-00028' }], transitions: [] };
    handler = () => ({ body: REL });
    mount('/features/FEAT-00022/1.0.0', '/features/:id/:ver', <FeatureDetail />);
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('[data-key-message] .ds-key__status')?.textContent).toBe('출시');
    expect(document.querySelector('.ds-step[data-state="current"]')?.getAttribute('data-lifecycle')).toBe('RELEASED');
    expect([...document.querySelectorAll('.ds-kv dt')].map((e) => e.textContent)).not.toContain('Lifecycle');
    const sel = screen.getByRole('combobox', { name: 'Version' }) as HTMLSelectElement;
    expect(sel.selectedOptions[0].textContent).toBe('1.0.0');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['0.9.0 · 신규 중단', '1.0.0']);
    const meta = document.querySelector('.ds-page__meta') as HTMLElement;
    expect(meta.textContent).not.toMatch(/ASIL|ADAS상품기획팀|BL-00028/);
  });

  it('자리표시(미발급·미입력)를 속성 옆에 표시한다', async () => {
    handler = () => ({ body: DETAIL });
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />);
    expect(await screen.findByText('미발급')).toBeTruthy();
    expect(screen.getByText('미입력')).toBeTruthy();
  });

  it('없는 Version은 404 화면 — 재시도 버튼을 두지 않는다', async () => {
    handler = () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: '없는 데이터입니다' } } });
    mount('/features/FEAT-99999/9.9.9', '/features/:id/:ver', <FeatureDetail />);
    await waitFor(() => expect(document.querySelector('[data-not-found]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
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

  it('확정 요청이 없으면 데이터가 있는 Baseline 탭으로 시작한다', async () => {
    const BL = { baselineId: 'BL-00028', featureId: 'FEAT-00022', version: '1.0.0', contentHash: 'sha256:' + 'a'.repeat(64), snapshot: { name: '전방 안전거리 3단계' }, products: ['CAT-00001'] };
    handler = (url) => (url.startsWith('/api/baselines/requests') ? { body: { items: [] } } : { body: { items: [BL] } });
    mount('/baselines', '/baselines', <BaselineQueue />, 'steward');
    await waitFor(() => expect(screen.getByRole('tab', { name: '확정된 Baseline' }).getAttribute('aria-selected')).toBe('true'));
    expect(await screen.findByText('전방 안전거리 3단계')).toBeTruthy();
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
