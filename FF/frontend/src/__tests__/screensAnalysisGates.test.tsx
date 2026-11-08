// 분석 근거·Gate 판정 폼·Evidence 원장(담당자 웨이브 W3) — P3-1 대표 ASIL 변경 사유 블록·검토 확인, P3-3 담당 역할별 기록·G7 두 사람 서명,
// P3-4 Evidence 딥링크, P3-9 절차 Gate 대응, P3-10 단계 밖 Gate 미리 막기·오류에 코드 없음·Gate별 입력(앞 Gate 저장이 다음 입력을 지우지 않음).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GATE_META, GATES, type AnalysisView } from '@ff/contracts';
import { AppProvider } from '../store';
import { GatesTab } from '../screens/features/GatesTab';
import { AnalysisPanel } from '../screens/features/AnalysisPanel';
import { EvidenceScreen } from '../screens/master/Trace';

type Call = { url: string; method: string; body: any; role: string | null };
let calls: Call[];
let analysisView: AnalysisView;
let analysisStatus: number;
let analysisPending: Promise<Response> | null;
let gateHistory: Record<string, any[]>;
let judgeReply: () => Promise<Response>;
/** 80-50 A5 — codeBeamer 산출물 응답(없으면 빈 객체 — 산출물 확인을 그리지 않는다) */
let wpView: Record<string, unknown> | null;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const HARA = { recordId: 'ANL-00001', kind: 'HARA', featureId: 'FEAT-00099', version: '0.1.0', docId: 'HARA-1', content: { asil: 'C', safetyGoals: [{ id: 'SG-01', text: '감속 누락 방지', asil: 'C' }] }, reason: 'HARA', signedBy: 'usr-safety2', signedRole: 'SAFETY_OFFICER', signedAt: '2026-11-05T01:00:00Z', provenance: 'PERSONAL', supersedes: null, kid: 'APR-usr-safety2', sig: 'x', valid: true } as const;

function gatesView() {
  return {
    lifecycle: 'PROPOSED',
    gates: GATES.map((g) => ({ gate: g, name: GATE_META[g].name, judgeRole: GATE_META[g].judgeRole, stage: GATE_META[g].stage, status: '미판정', latest: null, evidence: null, decision: null, history: gateHistory[g] ?? [], procedureGates: [] })),
    rehara: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  analysisStatus = 200;
  analysisPending = null;
  gateHistory = {};
  analysisView = { featureId: 'FEAT-00099', version: '0.1.0', lifecycle: 'PROPOSED', asil: 'C', security: { relevant: false, why: '형식승인 무관(R0)·ADS 아님' }, asilDeviation: null, current: {}, history: [], g7: [] };
  judgeReply = async () => json({ record: {}, feature: {} }, 201);
  wpView = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, role: headers['X-Actor-Role'] ?? null });
      if (url.startsWith('/api/alm/rejudge/') && method === 'POST') return json({});
      if (url.startsWith('/api/alm/features/') && method === 'GET') return json(wpView ?? {});
      if (url.includes('/analysis') && method === 'GET') return analysisPending ?? (analysisStatus === 200 ? json(analysisView) : json({ error: { code: 'INTERNAL', message: '분석 조회 실패' } }, analysisStatus));
      if (url.includes('/analysis/')) return json({ recordId: 'ANL-00009' }, 201);
      if (url.endsWith('/gates') && method === 'GET') return json(gatesView());
      if (url.endsWith('/gates')) return judgeReply();
      if (url.startsWith('/api/evidence'))
        return json({
          items: [
            { evidenceRef: 'SAMPLE-EV-1', gate: 'G1', gateRecordId: 'SIM-G1-000001', featureId: 'FEAT-00099', featureVersion: '0.1.0', featureName: '시험', owner: 'QA', inputResult: 'PASS', resultReason: '이관', gateStatus: 'PASS', judgedAt: '2026-03-02T09:00:00+09:00' },
            { evidenceRef: 'TMS-RUN-1', gate: 'G2', gateRecordId: 'SIM-G2-000600', featureId: 'FEAT-00099', featureVersion: '0.1.0', featureName: '시험', owner: 'QA', inputResult: 'PASS', resultReason: '플랫폼 판정', gateStatus: 'PASS', judgedAt: '2026-11-05T10:00:00+09:00' },
          ],
        });
      return json({});
    }),
  );
});
afterEach(() => (cleanup(), vi.unstubAllGlobals()));

function mount(role: string, el: React.ReactNode, at = '/features/FEAT-00099/0.1.0', path = '/features/:id/:ver') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const judgeForm = () => document.getElementById('judge-h')!.closest('section') as HTMLElement;
const pick = async (g: string) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${g} [A-Z]`) }));
const fill = (rationale: string, ref = 'EV-1') => {
  const f = within(judgeForm());
  fireEvent.change(f.getByLabelText(/^Evidence Ref/), { target: { value: ref } });
  fireEvent.change(f.getByLabelText(/^사유/), { target: { value: rationale } });
};
const submitBtn = (g: string) => within(judgeForm()).getByRole('button', { name: `${g} · Gate 판정 등록` }) as HTMLButtonElement;

describe('Gate 판정 폼 — 단계 가드(P3-10)', () => {
  it('단계 밖 Gate(PROPOSED에서 G4)는 제출 전에 막히고 사유가 보인다 — 코드 없이', async () => {
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G4');
    fill('제어 확인');
    expect(submitBtn('G4').disabled).toBe(true);
    const why = screen.getByTestId('gate-stage-blocked').textContent!;
    expect(why).toContain('G4은(는) DEVELOPING 단계 Gate입니다 — 지금은 PROPOSED 단계라 판정할 수 없습니다.');
    expect(why).not.toMatch(/GUARD_FAILED/);
    await pick('G1');
    fill('정의 확인');
    expect(submitBtn('G1').disabled).toBe(false);
  });

  it('서버 422 오류는 사유만 — 내부 코드(GUARD_FAILED)를 붙이지 않는다', async () => {
    judgeReply = async () => json({ error: { code: 'GUARD_FAILED', message: '앞 단계가 PASS가 아닙니다.' } }, 422);
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G1');
    fill('정의 확인');
    fireEvent.click(submitBtn('G1'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('앞 단계가 PASS가 아닙니다.');
    expect(alert.textContent).not.toContain('GUARD_FAILED');
  });

  it('G1 저장 응답이 늦게 와도 그사이 G2에 쓰던 입력을 지우지 않는다(Gate별 입력)', async () => {
    let release!: () => void;
    judgeReply = () => new Promise<Response>((r) => (release = () => r(json({ record: {}, feature: {} }, 201))));
    analysisView = { ...analysisView, current: { HARA } };
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G1');
    fill('정의 확인');
    fireEvent.click(submitBtn('G1'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    await pick('G2');
    fill('요구 검토 중', 'EV-G2');
    await act(async () => release());
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/gates') && c.method === 'GET').length).toBeGreaterThan(1));
    expect((within(judgeForm()).getByLabelText(/^사유/) as HTMLTextAreaElement).value).toBe('요구 검토 중');
    expect((within(judgeForm()).getByLabelText(/^Evidence Ref/) as HTMLInputElement).value).toBe('EV-G2');
    // G1으로 돌아가면 저장한 G1 입력은 비어 있다
    await pick('G1');
    expect((within(judgeForm()).getByLabelText(/^사유/) as HTMLTextAreaElement).value).toBe('');
  });
});

describe('G2 — 분석 근거·대표 ASIL 변경 사유(P3-1·3)', () => {
  it('분석 근거를 읽는 동안 PASS는 막히고, 유효한 근거가 도착하면 허용한다', async () => {
    let ready!: (response: Response) => void;
    analysisView = { ...analysisView, current: { HARA } };
    analysisPending = new Promise((resolve) => { ready = resolve; });
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    fill('근거 확인');
    expect(screen.getByTestId('analysis-unavailable').textContent).toContain('분석 근거를 불러오는 중');
    expect(submitBtn('G2').disabled).toBe(true);
    await act(async () => { ready(json(analysisView)); });
    await waitFor(() => expect(submitBtn('G2').disabled).toBe(false));
    expect(screen.queryByTestId('analysis-unavailable')).toBeNull();
  });

  it('분석 근거 조회가 실패하면 PASS를 막고 다시 읽은 뒤에도 누락 근거를 확인한다', async () => {
    analysisStatus = 503;
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    fill('근거 확인');
    const retry = await within(judgeForm()).findByRole('button', { name: '분석 근거 다시 불러오기' });
    expect(submitBtn('G2').disabled).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    analysisStatus = 200;
    fireEvent.click(retry);
    expect((await screen.findByTestId('gate-needs')).textContent).toContain('HARA');
    expect(submitBtn('G2').disabled).toBe(true);
  });

  it('HARA가 없으면 판정 전에 필요한 것을 보이고 PASS 제출을 막는다', async () => {
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    fill('요구 검토');
    expect((await screen.findByTestId('gate-needs')).textContent).toContain('HARA(위험 분석) 기록이 없습니다');
    expect(submitBtn('G2').disabled).toBe(true);
  });

  it('"대표 ASIL B → C · 사유" 블록과 ASIL 사유 검토함 — 고르면 막힘이 풀리고 판정 본문에 담긴다', async () => {
    analysisView = { ...analysisView, current: { HARA }, asilDeviation: { from: 'B', to: 'C', reason: 'HARA 결과 ASIL C 유지', refId: 'AD-LON-002' } };
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    const block = await screen.findByTestId('asil-deviation');
    expect(block.textContent).toContain('대표 ASIL B → C · HARA 결과 ASIL C 유지');
    expect(block.textContent).toContain('HARA 평가 ASIL C');
    fill('요구 검토');
    expect(screen.getByTestId('gate-needs').textContent).toContain('ASIL 사유 검토함');
    expect(submitBtn('G2').disabled).toBe(true);
    fireEvent.click(within(block).getByRole('checkbox', { name: /ASIL 사유 검토함/ }));
    expect(screen.queryByTestId('gate-needs')).toBeNull();
    fireEvent.click(submitBtn('G2'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ gate: 'G2', asilReasonReviewed: true, evidenceRef: 'EV-1' }));
  });

  it('절차 Gate 대응(P3-9) — 플랫폼 G2 Gate 탭에 "절차 G2 HARA 영향 = 플랫폼 G2 + G7"', async () => {
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    expect((await screen.findByTestId('procedure-gate')).textContent).toContain('절차 G2 HARA 영향 = 플랫폼 G2 Requirement Gate + G7 Safety/Security Gate');
  });

  it('G7 — SM·CSM 서명이 없으면 판정 전에 보인다', async () => {
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G7');
    fill('안전·보안 확인');
    // PROPOSED에서는 단계 가드가 먼저지만 근거 조건도 함께 보인다
    const needs = (await screen.findByTestId('gate-needs')).textContent!;
    expect(needs).toContain('Safety Manager');
    expect(needs).toContain('CSM');
  });
});

describe('Gate 이력 Evidence 칸(P3-4)', () => {
  it('Evidence Ref는 Evidence 원장 딥링크', async () => {
    gateHistory = { G1: [{ gateRecordId: 'SIM-G1-000900', gate: 'G1', status: 'PASS', judgedAt: '2026-11-05T10:00:00+09:00', evidenceRef: 'TMS-RUN-1', rationale: '확인', decision: 'SIGNED' }] };
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    const link = (await screen.findByTestId('evidence-link-SIM-G1-000900')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/verify/evidence?ref=TMS-RUN-1&feature=FEAT-00099');
  });

  it('원장은 ?ref=·?feature= 딥링크를 받아 그 조건으로 조회하고, 최근 판정을 먼저 보인다', async () => {
    mount('quality', <EvidenceScreen />, '/verify/evidence?ref=TMS-RUN-1&feature=FEAT-00099', '/verify/evidence');
    await screen.findByText('TMS-RUN-1');
    const q = calls.find((c) => c.url.startsWith('/api/evidence'))!.url;
    expect(q).toContain('featureId=FEAT-00099');
    expect(q).toContain('ref=TMS-RUN-1');
    expect((screen.getByLabelText(/^Evidence Ref/) as HTMLInputElement).value).toBe('TMS-RUN-1');
    const cells = screen.getAllByText(/^(TMS-RUN-1|SAMPLE-EV-1)$/).map((e) => e.textContent);
    expect(cells).toEqual(['TMS-RUN-1', 'SAMPLE-EV-1']);
  });
});

describe('분석 근거 패널(P3-3)', () => {
  it('계약 밖 조회 응답을 빈 패널로 숨기지 않고 오류와 다시 시도를 보인다', async () => {
    analysisView = {} as AnalysisView;
    mount('safety2', <AnalysisPanel id="FEAT-00099" ver="0.1.0" />);
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('분석 근거를 읽을 수 없어');
    expect(within(error).getByRole('button', { name: '다시 시도' })).toBeTruthy();
    expect(screen.queryByTestId('analysis-panel')).toBeNull();
  });

  it('무효 G7 서명은 재분석으로 지난 서명과 구별해 표시한다', async () => {
    analysisView = { ...analysisView, g7: [{ signoffId: 'G7S-00001', featureId: 'FEAT-00099', version: '0.1.0', role: 'SAFETY_OFFICER', signedBy: 'usr-safety2', signedAt: '2026-11-05T01:00:00Z', reason: '확인', bound: { HARA: 'ANL-00001', TARA: null }, kid: 'k', sig: 'bad', valid: false, stale: false }] };
    mount('safety2', <AnalysisPanel id="FEAT-00099" ver="0.1.0" />);
    const signoffs = await screen.findByTestId('g7-signoffs');
    expect(signoffs.textContent).toContain('서명이 맞지 않습니다 — 근거로 쓰지 않습니다');
    expect(signoffs.textContent).not.toContain('분석이 다시 쓰여 효력이 없습니다');
  });

  it('Safety Manager는 HARA를 서명해 남기고, TARA는 CSM 몫이라 이유와 함께 막힌다 — 서명자는 이름으로', async () => {
    analysisView = { ...analysisView, current: { HARA }, history: [HARA] };
    mount('safety2', <AnalysisPanel id="FEAT-00099" ver="0.1.0" />);
    const panel = await screen.findByTestId('analysis-panel');
    expect(panel.textContent).toContain('오세린(기능안전 담당) 서명');
    expect(panel.textContent).not.toContain('usr-safety2');
    const tara = within(panel.querySelector('li[data-kind="TARA"]') as HTMLElement).getByRole('button') as HTMLButtonElement;
    expect(tara.disabled).toBe(true);
    fireEvent.click(within(panel.querySelector('li[data-kind="HARA"]') as HTMLElement).getByRole('button'));
    const form = await screen.findByTestId('analysis-form-HARA');
    fireEvent.change(within(form).getByLabelText('분석 문서 번호'), { target: { value: 'HARA-2' } });
    fireEvent.change(within(form).getByLabelText('목표 ID'), { target: { value: 'SG-02' } });
    fireEvent.change(within(form).getByLabelText('안전 목표'), { target: { value: '오경보 방지' } });
    fireEvent.change(within(form).getByLabelText('서명 사유'), { target: { value: 'HARA 개정' } });
    fireEvent.click(within(form).getByRole('button', { name: '서명해 남기기' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/features/FEAT-00099/versions/0.1.0/analysis/hara', role: 'SAFETY_OFFICER' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ reason: 'HARA 개정', docId: 'HARA-2', asil: 'B', safetyGoals: [{ id: 'SG-02', text: '오경보 방지', asil: 'B' }] });
  });

  it('G7 사이버보안 서명은 CSM 역할로 보낸다(여러 역할 계정도)', async () => {
    analysisView = { ...analysisView, current: { HARA }, g7: [{ signoffId: 'G7S-00001', featureId: 'FEAT-00099', version: '0.1.0', role: 'SAFETY_OFFICER', signedBy: 'usr-safety2', signedAt: '2026-11-05T01:00:00Z', reason: 'x', bound: { HARA: 'ANL-00001', TARA: null }, kid: 'k', sig: 's', valid: true, stale: false }] };
    mount('integrator', <AnalysisPanel id="FEAT-00099" ver="0.1.0" />);
    const g7 = await screen.findByTestId('g7-signoffs');
    expect(g7.textContent).toContain('오세린(기능안전 담당) 서명');
    fireEvent.change(within(g7).getByLabelText('서명 사유'), { target: { value: 'TARA 대응 확인' } });
    expect((within(g7).getByRole('button', { name: 'G7 기능안전 서명' }) as HTMLButtonElement).disabled).toBe(true); // 이미 유효한 SM 서명
    fireEvent.click(within(g7).getByRole('button', { name: 'G7 사이버보안 서명' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/features/FEAT-00099/versions/0.1.0/analysis/g7-security', role: 'SECURITY_OFFICER', body: { reason: 'TARA 대응 확인' } }));
  });
});

describe('Gate 판정 폼 — codeBeamer 필수 산출물 (80-50 A5)', () => {
  const view = (gateMode: string, rejudge: unknown[] = []) => ({
    gateMode,
    result: { featureId: 'FEAT-00099', version: '0.1.0', kinds: [], passedKinds: 4, requiredKinds: 7, rate: 57, problems: [], suspects: 0, basis: '' },
    items: [],
    stages: [{ judgeGate: 'G2', to: 'APPROVED', blockers: [{ rule: 'WP-1', kind: 'CS_REQ', item: null, why: '사이버보안 요구 승인 항목 0건' }] }, { judgeGate: 'G5', to: 'VERIFIED', blockers: [] }, { judgeGate: 'G8', to: 'RELEASED', blockers: [] }],
    rejudge,
  });
  it('enforce면 G2 PASS를 막고 빠진 산출물을 문장으로 — FAIL 판정은 막지 않는다', async () => {
    analysisView = { ...analysisView, current: { HARA } };
    wpView = view('enforce');
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    fill('요구 확인');
    const wp = await screen.findByTestId('gate-wp');
    expect(wp.textContent).toContain('사이버보안 요구: 사이버보안 요구 승인 항목 0건');
    expect(wp.textContent).not.toMatch(/WP-\d|CS_REQ/);
    expect(submitBtn('G2').disabled).toBe(true);
    fireEvent.change(within(judgeForm()).getByLabelText(/^입력 검사 결과/), { target: { value: 'FAIL' } });
    expect(submitBtn('G2').disabled).toBe(false);
  });
  it('warn이면 알리기만 하고 판정할 수 있다 · 열린 재판정 요청은 사유를 적어 닫는다', async () => {
    analysisView = { ...analysisView, current: { HARA } };
    wpView = view('warn', [{ rejudgeId: 7, featureId: 'FEAT-00099', version: '0.1.0', gate: 'G2', itemKey: 'CB-10001', itemTitle: '감지 요구', fromVersion: 1, toVersion: 2, status: 'OPEN', createdAt: '2026-11-07T01:00:00Z', released: false, resolvedBy: null }]);
    mount('quality', <GatesTab id="FEAT-00099" ver="0.1.0" />);
    await pick('G2');
    fill('요구 확인');
    const wp = await screen.findByTestId('gate-wp');
    expect(wp.textContent).toContain('판정은 막지 않지만');
    expect(submitBtn('G2').disabled).toBe(false);
    expect(wp.textContent).toContain('CB-10001 감지 요구 v1 → v2');
    const close = within(wp).getByRole('button', { name: '영향 없음으로 닫기' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.change(within(wp).getByLabelText('닫는 사유'), { target: { value: '표현 수정 — 영향 없음' } });
    fireEvent.click(close);
    await waitFor(() => expect(calls.find((c) => c.url === '/api/alm/rejudge/7/close')).toMatchObject({ method: 'POST', body: { reason: '표현 수정 — 영향 없음' } }));
  });
});
