// P8a 배포·차단 전달 + vECU 가상검증 화면 — 모의 API로 상태·권한·핵심 상호작용을 검증한다.
// 실제 백엔드와의 끝단 흐름(차단 발령 → 회신 집계, 가상검증 → 정책 GO)은 e2e(ops.spec.ts)가 맡는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { FleetLive, VehicleRuntimeScreen } from '../screens/ops/FleetLive';
import { KillConsole } from '../screens/ops/KillConsole';
import { DeploymentDetail } from '../screens/ops/Deployments';
import { VirtualValidationScreen } from '../screens/policy/Virtual';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
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
const posted = (suffix: string) => calls.find((c) => c.init?.method === 'POST' && c.url.endsWith(suffix));

const flag = (flagKey: string, value: boolean, reason = 'POLICY_MATCH', drift = false) => ({ flagKey, publicationId: 'PUB-00001', sequence: 1, local: { value, reason }, server: { value: drift ? !value : value, reason: drift ? 'KILL_SWITCH' : reason }, drift });
const FLEET = {
  gleo: 'internal',
  items: [
    { vin: 'ego-01', label: '시연', scope: 'KR/NX4 PE/Premium', link: 'ONLINE', quality: 'TRUSTED', gleo: true, featureState: { 'FEAT-00022': 'SAFE_STOP' }, kills: ['FEAT-00022'], flags: [flag('care_00022_param', false, 'KILL_SWITCH')], last: null },
    { vin: 'KMH-NX4-0001', label: '구독', scope: 'KR/NX4 PE/Premium', link: 'ONLINE', quality: 'TRUSTED', gleo: false, featureState: {}, kills: [], flags: [flag('care_00022_param', true, 'POLICY_MATCH', true)], last: null },
    { vin: 'KMH-NX4-0003', label: '단절', scope: 'KR/NX4 PE/Premium', link: 'OFFLINE', quality: 'STALE', gleo: false, featureState: {}, kills: [], flags: [], last: null },
  ],
};
const PUB = { publicationId: 'PUB-00002', kind: 'KILL', status: 'DISPATCHED', confirmed: 1, denominator: 2, closedAt: null, createdAt: '2026-10-12T01:00:00.000Z', nodes: [], payload: { flagKey: null, featureId: 'FEAT-00022', targets: ['ego-01', 'lead-01'] } };

describe('Fleet 실시간 적용 현황', () => {
  it('차량 × flag 매트릭스: 차단(safe)·불일치(drift)·미수신을 구분하고 지표를 낸다', async () => {
    handler = (url) => {
      if (url.startsWith('/api/fleet/runtime')) return { body: FLEET };
      if (url.startsWith('/api/publications')) return { body: { items: [PUB] } };
      if (url.startsWith('/api/kill-requests')) return { body: { items: [{ killId: 'KILL-00001' }] } };
      if (url.startsWith('/api/gleo/status')) return { body: { mode: 'internal', connected: false, lastError: null, messages: [] } };
    };
    mount('/fleet/live', '/fleet/live', <FleetLive />);
    const table = await screen.findByRole('table', { name: /차량 × flag/ });
    const cells = table.querySelectorAll('.ds-fcell');
    expect([...cells].map((c) => [c.getAttribute('data-v'), c.getAttribute('data-drift')])).toEqual([['safe', 'false'], ['on', 'true'], [null, null]]);
    expect(within(table).getByText('미수신')).toBeTruthy();
    expect([...document.querySelectorAll('.ds-kpi__value')].map((k) => k.textContent)).toEqual(['2/3', '1', '1', '1']);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('1');
  });
});

describe('차량별 적용 상태', () => {
  it('차량 측 판단과 서버 판단을 나란히, 거부된 수신 기록을 보여 준다', async () => {
    handler = (url) => {
      if (url.startsWith('/api/vehicles/ego-01/runtime'))
        return {
          body: {
            vehicle: { vin: 'ego-01', label: '시연', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', swVersion: '1.2.1', link: 'ONLINE', quality: 'TRUSTED', gleo: true },
            runtime: { bootId: 'BOOT-ego-01-1', highest: {}, bundles: { care_00022_param: { publicationId: 'PUB-00001', sequence: 1, payloadHash: 'h', policy: { policyId: 'POL-00003', revision: 1 } } }, kills: {}, featureState: {}, log: [{ at: '2026-10-12T01:00:00.000Z', publicationId: 'PUB-00001', kind: 'POLICY', result: 'REJECTED', detail: 'REPLAY' }] },
            evaluations: [{ flagKey: 'care_00022_param', local: { value: true, decision: 'ALLOW', reason: 'POLICY_MATCH' }, server: { value: false, decision: 'SAFE_DEFAULT', reason: 'KILL_SWITCH' }, drift: true }],
          },
        };
      if (url.startsWith('/api/vehicles')) return { body: { items: [{ vin: 'ego-01', label: '시연' }] } };
    };
    mount('/fleet/vehicles/ego-01', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    expect(await screen.findByText('BOOT-ego-01-1')).toBeTruthy();
    expect(screen.getByText('ON · POLICY_MATCH')).toBeTruthy();
    expect(screen.getByText('OFF · KILL_SWITCH')).toBeTruthy();
    expect(screen.getByText('REPLAY')).toBeTruthy();
  });
});

describe('긴급 차단·복구 (요청 → 2인 승인, FFG-PLT-005·003)', () => {
  const PREVIEW = {
    feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', lifecycle: 'RELEASED', asil: 'B' },
    featureIds: ['FEAT-00022'],
    dependents: [],
    flagKeys: ['care_00022_param', 'care_00022_signal'],
    vehicles: [
      { vin: 'ego-01', label: '시연', link: 'ONLINE', gleo: true },
      { vin: 'KMH-NX4-0003', label: '단절', link: 'OFFLINE', gleo: false },
    ],
    activeKill: null,
    registry: { f_class: 'F3', deact_class: 'DC2', gsr_mandatory: false, profile: { takeover_ms: 4000, ramp_ms: 3000, max_pending_ms: 0, max_cycle_wait_ms: 28800000 } },
    window: { hours: 24, deactivate: 3, cap: 5000 },
    checks: [
      { rule: 'FFG-PLT-002', ok: true, message: 'Registry에서 RELEASED인 Feature Version' },
      { rule: 'FFG-PLT-009', ok: true, message: '시장·법규 사전조건 충족' },
    ],
  };
  const REQUESTED = {
    killId: 'KILL-00001',
    featureId: 'FEAT-00022',
    featureVersion: '1.0.0',
    featureIds: ['FEAT-00022'],
    flagKeys: [],
    vins: ['ego-01'],
    reason: 'r',
    status: 'REQUESTED',
    version: 2,
    fClass: 'F3',
    deactClass: 'DC2',
    reasonCategory: 'SAFETY',
    reasonCode: 'FIELD_FAULT',
    fsmRequired: true,
    approvals: [],
    expiresAt: '2026-10-12T03:00:00.000Z',
    requestedBy: 'usr-operator',
    requestedAt: '2026-10-12T01:00:00.000Z',
    releasedBy: null,
    releasedAt: null,
    releaseReason: null,
    delivery: null,
    restore: null,
  };
  const api: Handler = (url, init) => {
    if (init?.method === 'POST') return { status: 201, body: REQUESTED };
    if (url.startsWith('/api/kill-requests/preview')) return { body: PREVIEW };
    if (url.startsWith('/api/kill-requests/KILL-')) return { body: REQUESTED };
    if (url.startsWith('/api/kill-requests')) return { body: { items: [] } };
  };

  it('영향 범위·Registry 등급·게이트 사전 점검 → 봉쇄 근거 없으면 요청 불가 → 확인 입력이 맞아야 요청, 본문에 사유 분류 — 비활성화 방식은 고르지 않는다', async () => {
    handler = api;
    mount('/ops/kill', '/ops/kill', <KillConsole />);
    expect(await screen.findByText('care_00022_param, care_00022_signal')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /KMH-NX4-0003/ })); // 통신 단절 차량 제외
    expect(screen.queryByRole('radio', { name: /Safe Stop/ })).toBeNull(); // 운영자 선택 UI 없음
    expect(screen.getAllByText(/FFG-PLT-003/).length).toBeGreaterThan(0);
    // 회귀: 차량을 해제해도 목록이 줄지 않아 다시 고를 수 있다(미리보기는 항상 영향 범위 전체, 사전 점검만 고른 차량으로)
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/kill-requests/preview')).at(-1)?.url).toContain('vins=ego-01'));
    expect(screen.getByRole('checkbox', { name: /KMH-NX4-0003/ })).toBeTruthy();
    // 승인 칸은 실시간 판정에서 대기 — F3 안전은 FSM 필수
    expect(document.querySelector('.ds-rules__item[data-status="pending"]')!.textContent).toContain('서로 다른 2인 승인 대기 — 한 칸은 Safety Manager(FSM)');
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('4'); // 누적 3 + 이번 1
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '전방 거리 오추정' } });
    const btn = screen.getByRole('button', { name: '차단 요청' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true); // F3 안전 — 리콜 ID나 봉쇄 근거 필요
    fireEvent.change(screen.getByLabelText(/봉쇄 결정 근거/), { target: { value: '원인 분석 전 봉쇄' } });
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    const dlg = await screen.findByRole('alertdialog');
    const go = within(dlg).getByRole('button', { name: '차단 요청' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: 'FEAT-00022' } });
    fireEvent.click(go);
    await waitFor(() => expect(posted('/api/kill-requests')).toBeTruthy());
    const p = posted('/api/kill-requests')!;
    expect(JSON.parse(String(p.init!.body))).toEqual({
      featureId: 'FEAT-00022',
      featureVersion: '1.0.0',
      vins: ['ego-01'],
      reasonCategory: 'SAFETY',
      reasonCode: 'FIELD_FAULT',
      reason: '전방 거리 오추정',
      confirm: 'FEAT-00022',
      containmentJustification: '원인 분석 전 봉쇄',
    });
    expect(new Headers(p.init!.headers).get('X-Actor-Role')).toBe('OPERATOR');
  });

  it('운영자·안전 담당이 아니면 요청 버튼이 막힌다', async () => {
    handler = api;
    mount('/ops/kill', '/ops/kill', <KillConsole />, 'author');
    await screen.findByText('care_00022_param, care_00022_signal');
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '시험' } });
    fireEvent.change(screen.getByLabelText(/봉쇄 결정 근거/), { target: { value: '봉쇄' } });
    expect((screen.getByRole('button', { name: '차단 요청' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // 회귀: 상세를 window.location이 아니라 라우터 ?id=로 연다(검토함에서 넘어오는 경로)
  it('승인 칸 — 요청자는 승인 불가, FSM(품질 검토)은 승인 가능, FSM 칸이 남으면 다른 역할은 막힌다', async () => {
    handler = api;
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'operator');
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText('요청자는 같은 명령을 승인할 수 없습니다(직무 분리)');
    expect((within(dlg).getByRole('button', { name: '승인 — 개인 서명' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    handler = (url, init) =>
      url.startsWith('/api/kill-requests/KILL-') && init?.method !== 'POST'
        ? { body: { ...REQUESTED, approvals: [{ approverId: 'usr-coordinator', role: 'OPS_LEAD', signedAt: '2026-10-12T01:05:00.000Z', kid: 'APR-usr-coordinator' }] } }
        : api(url, init);
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator'); // CSM — 남은 칸은 FSM만
    await within(await screen.findByRole('dialog')).findByText('남은 칸은 Safety Manager(FSM)만');
    cleanup();
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'quality'); // FSM
    const d3 = await screen.findByRole('dialog');
    const approve = (await within(d3).findByRole('button', { name: '승인 — 개인 서명' })) as HTMLButtonElement;
    await waitFor(() => expect(approve.disabled).toBe(false));
    fireEvent.click(approve);
    await waitFor(() => expect(posted('/api/kill-requests/KILL-00001/approvals')).toBeTruthy());
    expect(new Headers(posted('/api/kill-requests/KILL-00001/approvals')!.init!.headers).get('X-Actor-Role')).toBe('SAFETY_OFFICER');
  });
});

describe('게시본 상세', () => {
  it('서명 검증·차량별 회신 사유·거부 회신을 보여 준다', async () => {
    handler = (url) =>
      url.startsWith('/api/publications/PUB-00001')
        ? {
            body: {
              publication: { ...PUB, publicationId: 'PUB-00001', kind: 'POLICY', status: 'PARTIAL', channel: 'OTA', campaignId: 'CMP-00001', createdBy: 'u', deadlineAt: '2026-10-12T01:00:08.000Z', closedAt: '2026-10-12T01:00:08.000Z', ackOnly: [], nodes: [{ nodeId: 'ego-01', state: 'CONFIRMED', reason: 'READBACK_MATCH' }, { nodeId: 'KMH-NX4-0003', state: 'UNKNOWN', reason: 'NO_REPORT' }], payload: { publicationId: 'PUB-00001', sequence: 1, featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_param', targets: [], desired: 'sha256:x', policy: { policyId: 'POL-00003', revision: 1 }, kill: null }, signature: { keyId: 'KEY-0001', alg: 'Ed25519', payloadHash: 'sha256:abc', signature: 'zz' } },
              verification: { valid: true, reason: 'SIGNATURE_VALID' },
              readbacks: [{ vin: 'KMH-NX4-0001', observed: 'REJECTED', rejectReason: 'PAYLOAD_TAMPERED', via: 'IF-06', at: '2026-10-12T01:00:01.000Z' }],
              calls: [],
            },
          }
        : undefined;
    mount('/deployments/PUB-00001', '/deployments/:id', <DeploymentDetail />);
    expect(await screen.findByText('SIGNATURE_VALID')).toBeTruthy();
    expect(screen.getByText('KEY-0001 · Ed25519')).toBeTruthy();
    expect(screen.getByText('NO_REPORT')).toBeTruthy();
    expect(screen.getByText('REJECTED · PAYLOAD_TAMPERED')).toBeTruthy();
  });
});

describe('vECU 가상검증', () => {
  const RUN = (over: Record<string, unknown>) => ({ runId: 'VV-00001', policyId: 'POL-00003', policyRevision: 1, contentHash: 'h', featureId: 'FEAT-00022', featureVersion: '1.0.0', vin: 'ego-01', scenarioId: 'SCN-FEAT00022-NOMINAL', source: 'vecu', simulator: 's', testId: 'TEST-1', overall: 'PASS', gateResult: 'PASS', criteria: [{ id: 'danger_time', label: '위험 누적', unit: 's', op: '<=', limit: 0, status: 'fail', value: 3, at: 20, deciding: false }], evaluation: null, evidence: { files: [{ name: 'verdict.json', sha256: 'abcdef0123456789', bytes: 10 }] }, error: null, at: '2026-10-12T01:00:00.000Z', by: 'u', tms: null, ...over });
  const api = (run: Record<string, unknown>): Handler => (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/tms')) return { status: 201, body: { ...run, tms: { tmsId: 'TMS-00001', submittedAt: 'x' } } };
    if (init?.method === 'POST') return { status: 201, body: { items: [run] } };
    if (url.startsWith('/api/vecu/status')) return { body: { available: true, mode: 'auto', dir: 'C:/vECU', reason: null, simulatorUrl: 'x' } };
    if (url.startsWith('/api/virtual-validations/scenarios')) return { body: { items: [{ scenarioId: 'SCN-FEAT00022-NOMINAL', name: '정상', role: 'NOMINAL', validator: 'D06-03', deciding: 'ALL' }] } };
    if (url.startsWith('/api/virtual-validations/VV-')) return { body: run };
    if (url.startsWith('/api/virtual-validations')) return { body: { items: [run] } };
    if (url.startsWith('/api/policies')) return { body: { items: [{ policyId: 'POL-00003', flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'DRAFT', revision: 1 }] } };
  };

  it('실행은 선택 정책으로 POST, 결과를 열면 기준·증적·TMS 제출(품질 담당)', async () => {
    handler = api(RUN({}));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    const runBtn = (await screen.findByRole('button', { name: '가상검증 실행' })) as HTMLButtonElement;
    await waitFor(() => expect(runBtn.disabled).toBe(false)); // 정책 목록이 와야 실행 대상이 정해진다
    fireEvent.click(runBtn);
    await waitFor(() => expect(posted('/api/virtual-validations')).toBeTruthy());
    expect(JSON.parse(String(posted('/api/virtual-validations')!.init!.body))).toEqual({ policyId: 'POL-00003' });
    fireEvent.click(await screen.findByText('VV-00001'));
    const tms = await screen.findByRole('button', { name: 'TMS 제출 (IF-09)' });
    expect(screen.getByRole('link', { name: 'verdict.json' }).getAttribute('href')).toBe('/api/virtual-validations/VV-00001/files/verdict.json');
    fireEvent.click(tms);
    await waitFor(() => expect(posted('/api/virtual-validations/VV-00001/tms')).toBeTruthy());
  });

  it('함께 배포된 vECU 시뮬레이터를 새 탭으로 연다 (/vecu/, ?ffv=Feature)', async () => {
    handler = api(RUN({}));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    const link = await screen.findByTestId('vecu-link');
    expect(link.getAttribute('href')).toBe('/vecu/index.html?ffv=FEAT-00022');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('vECU 미연결 결과에는 TMS 제출이 없다', async () => {
    handler = api(RUN({ source: 'unavailable', simulator: null, testId: null, overall: 'UNAVAILABLE', gateResult: 'UNAVAILABLE', criteria: [], evidence: null, error: 'VECU_MODE=off' }));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    fireEvent.click(await screen.findByText('VV-00001'));
    expect(await screen.findByText('VECU_MODE=off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'TMS 제출 (IF-09)' })).toBeNull();
  });
});
