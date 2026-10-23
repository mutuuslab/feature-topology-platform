// P8a 배포·차단 전달 + CARLA 가상검증 화면 — 모의 API로 상태·권한·핵심 상호작용을 검증한다.
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
    // 핵심 메시지 = 서버 판단과 다른 차량 측 값 수, 요약 줄 = 연결·전개 중·차단 중
    expect(document.querySelector('[data-key-message]')?.querySelector('.ds-key__value')?.textContent).toBe('1');
    expect([...document.querySelectorAll('.ds-summary b')].map((k) => k.textContent)).toEqual(['2/3', '1', '1']);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('1');
  });

  // 회귀(2026-10-18 S4 재검토): 불일치가 0이어도 미수신·STALE 차량이 있는데 초록 "모두 같습니다"를 보였다 — 거짓 안심
  it('불일치 0이어도 미수신·신뢰 낮은 차량이 있으면 핵심 메시지는 warn(일치 여부 미확인)', async () => {
    const clean = { ...FLEET, items: FLEET.items.map((r) => ({ ...r, flags: r.flags.map((f) => ({ ...f, drift: false })) })) };
    handler = (url) => {
      if (url.startsWith('/api/fleet/runtime')) return { body: clean };
      if (url.startsWith('/api/publications')) return { body: { items: [] } };
      if (url.startsWith('/api/kill-requests')) return { body: { items: [] } };
      if (url.startsWith('/api/gleo/status')) return { body: { mode: 'internal', connected: false, lastError: null, messages: [] } };
    };
    mount('/fleet/live', '/fleet/live', <FleetLive />);
    await screen.findByRole('table', { name: /차량 × flag/ });
    const key = document.querySelector('[data-key-message]')!;
    expect(key.getAttribute('data-tone')).toBe('warn');
    expect(key.querySelector('.ds-key__value')?.textContent).toBe('1'); // 단절·STALE·미수신 차량 1대
    expect(key.textContent).not.toMatch(/모두 같습니다/);
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

  it('상태 보고 v2 — 받아들인 상태(DC2 인계 경고)·report_seq(시동·순번)와 위반 보고를 구분(FFG-TEL-003), 보고가 없으면 UNKNOWN 안내', async () => {
    const RT = { vehicle: { vin: 'ego-01', label: '시연', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', swVersion: '1.2.1', link: 'ONLINE', quality: 'TRUSTED', gleo: false }, runtime: { bootId: 'BOOT-ego-01-1', highest: {}, bundles: {}, kills: {}, featureState: {}, log: [] }, evaluations: [] };
    const STATUS = {
      features: [{ featureId: 'FEAT-00022', state: 'DEACT_WARNING', reportSeq: 65537, updatedAt: '2026-10-12T01:00:00Z', report: { hmi: 'WARN_TAKEOVER', request_result: 'ACCEPTED', time_sync: 'SYNCED', persistence: 'DURABLE', feature_weight_permille: 1000 } }],
      recent: [{ featureId: 'FEAT-00022', state: 'ACTIVE', reportSeq: 65538, accepted: false, violation: { step: 'AUTH', code: 'AUTH_FAILED', message: '위조' }, via: 'IF-06', at: '2026-10-12T01:00:01Z' }],
    };
    let status: unknown = STATUS;
    handler = (url) => (url.startsWith('/api/vehicles/ego-01/runtime') ? { body: RT } : url.startsWith('/api/vehicles/ego-01/status') ? { body: status } : url.startsWith('/api/vehicles/ego-01/requests') ? { body: { cursor: null, limit: { requests: 30, windowMs: 10000 }, items: [] } } : url.startsWith('/api/vehicles') ? { body: { items: [{ vin: 'ego-01', label: '시연' }] } } : undefined);
    mount('/fleet/vehicles/ego-01', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    const panel = (await screen.findByRole('heading', { name: /상태 보고 v2/ })).closest('section')!;
    await within(panel).findByText('DEACT_WARNING');
    expect(within(panel).getByText('인계 경고')).toBeTruthy();
    expect(within(panel).getByText('1 · 1')).toBeTruthy();
    expect(within(panel).getByText('AUTH · AUTH_FAILED')).toBeTruthy();
    cleanup();
    status = { features: [], recent: [] };
    mount('/fleet/vehicles/ego-01', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    expect(await screen.findByText('받아들인 상태 보고가 없습니다 — 확인 전에는 비활성으로 보지 않습니다(UNKNOWN)')).toBeTruthy();
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
    // 회귀: FSM이 필요한 칸은 하나 — 두 칸 모두 FSM으로 보이던 문제
    expect([...dlg.querySelectorAll('.ds-approvals__slot .ds-approvals__role')].map((x) => x.textContent)).toEqual(['FSM', 'CSM·운영 리더 등']);
    cleanup();
    handler = (url, init) =>
      url.startsWith('/api/kill-requests/KILL-') && init?.method !== 'POST'
        ? { body: { ...REQUESTED, approvals: [{ approverId: 'usr-coordinator', role: 'OPS_LEAD', signedAt: '2026-10-12T01:05:00.000Z', kid: 'APR-usr-coordinator' }] } }
        : api(url, init);
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'steward'); // 법규 담당(REGULATORY) — 남은 칸은 FSM만
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

  it('발행된 차단 — 차량별 종료·복원 시각(불확실 시각 표시)과 24시간 사후 독립 검토(CSM이 기록)', async () => {
    const ACTIVE = { ...REQUESTED, status: 'ACTIVE', command: { commandId: '0c1d2e3f-0000-4000-8000-000000000001', commandSeq: 3, kid: 'KILL-K1' }, approvals: [{ approverId: 'usr-safety', role: 'FSM', signedAt: 'x' }, { approverId: 'usr-coordinator', role: 'OPS_LEAD', signedAt: 'x' }] };
    const pt = (at: string, trust = 'TRUSTED') => ({ at, trust, timeSync: trust === 'TRUSTED' ? 'SYNCED' : 'DEGRADED' });
    handler = (url, init) => {
      if (url.startsWith('/api/kill-requests/KILL-00001/timeline')) return { body: { killId: 'KILL-00001', featureId: 'FEAT-00022', items: [{ vin: 'ego-01', deactivate: { commandId: 'c', accepted: pt('2026-10-12T01:10:00.000Z'), completed: pt('2026-10-12T01:10:08.000Z', 'UNCERTAIN') }, restore: null, cause: 'REMOTE_KILL', uncertain: ['비활성화 완료'] }] } };
      if (url.startsWith('/api/kill-requests/KILL-00001/envelopes')) return { body: { envelopes: [] } };
      if (url.startsWith('/api/kill-post-reviews')) return { body: { items: [{ killId: 'KILL-00001', featureId: 'FEAT-00022', issuedAt: '2026-10-12T01:10:00.000Z', due: '2026-10-13T01:10:00.000Z', requestedBy: 'usr-operator', approvers: ['usr-safety', 'usr-coordinator'], review: null, status: 'PENDING' }] } };
      if (url.startsWith('/api/kill-requests/KILL-') && init?.method !== 'POST') return { body: ACTIVE };
      return api(url, init);
    };
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator');
    const dlg = await screen.findByRole('dialog');
    const tl = await within(dlg).findByTestId('kill-timeline');
    expect(within(tl).getByText('원격 Kill')).toBeTruthy();
    expect(within(tl).getAllByTitle(/시각 불확실/)).toHaveLength(1);
    const pr = await within(dlg).findByTestId('post-review');
    fireEvent.change(within(pr).getByRole('textbox'), { target: { value: '현장 결함 확인, 차단 범위 적정' } });
    fireEvent.click(within(pr).getByRole('button', { name: '사후 검토 기록' }));
    await waitFor(() => expect(posted('/api/kill-requests/KILL-00001/post-review')).toBeTruthy());
    expect(new Headers(posted('/api/kill-requests/KILL-00001/post-review')!.init!.headers).get('X-Actor-Role')).toBe('SECURITY_OFFICER');
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

describe('CARLA 가상검증', () => {
  const RUN = (over: Record<string, unknown>) => ({ runId: 'VV-00001', policyId: 'POL-00003', policyRevision: 1, contentHash: 'h', featureId: 'FEAT-00022', featureVersion: '1.0.0', vin: 'ego-01', scenarioId: 'SCN-FEAT00022-NOMINAL', source: 'carla', simulator: 's', testId: 'TEST-1', overall: 'PASS', gateResult: 'PASS', criteria: [{ id: 'danger_time', label: '위험 누적', unit: 's', op: '<=', limit: 0, status: 'fail', value: 3, at: 20, deciding: false }], evaluation: null, evidence: { files: [{ name: 'verdict.json', sha256: 'abcdef0123456789', bytes: 10 }] }, error: null, at: '2026-10-12T01:00:00.000Z', by: 'u', tms: null, ...over });
  const COMBO = {
    featureId: 'FEAT-00022',
    group: ['FEAT-00022', 'FEAT-00145'],
    safetyFlags: ['FEAT-00022', 'FEAT-00145'],
    strength: 2,
    requestedStrength: 3,
    basis: '안전 관련 Flag 2개가 상호작용 — 3-way(인자 수 이하라 전수)',
    array: { factors: ['FEAT-00022', 'FEAT-00145'], strength: 2, rows: [[false, false], [false, true], [true, true]], tuples: 3, covered: 3, infeasible: 1 },
    negatives: [{ on: ['FEAT-00022'], off: ['FEAT-00145'], expect: 'REQUIRES_MISSING', dependencyId: 'DEP-00013', rejected: true, got: ['REQUIRES_MISSING'] }],
  };
  const UP = { available: true, mode: 'auto', simulator: 'CARLA', host: '127.0.0.1', port: 2100, server: { version: '0.9.16', map: 'Town04', synchronous: false, vehicles: 0, foreignVehicles: 0 }, runner: 'C:/FF/sim/carla/ffcarla_cli.py', python: 'py', reason: null, queue: { running: 0, waiting: 0 } };
  const api = (run: Record<string, unknown>, list: Record<string, unknown>[] = [run], status: Record<string, unknown> = UP): Handler => (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/tms')) return { status: 201, body: { ...run, tms: { tmsId: 'TMS-00001', submittedAt: 'x' } } };
    if (init?.method === 'POST') return { status: 201, body: { items: [run] } };
    if (url.startsWith('/api/sim/status')) return { body: status };
    if (url.startsWith('/api/virtual-validations/scenarios')) return { body: { items: [{ scenarioId: 'SCN-FEAT00022-NOMINAL', name: '정상', role: 'NOMINAL', validator: 'D06-03', purpose: '정상 추종', params: { fault: null } }] } };
    if (url.startsWith('/api/virtual-validations/combinations')) return { body: COMBO };
    if (url.startsWith('/api/virtual-validations/VV-')) return { body: run };
    if (url.startsWith('/api/virtual-validations')) return { body: { items: list } };
    if (url.startsWith('/api/policies')) return { body: { items: [{ policyId: 'POL-00003', flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'DRAFT', revision: 1 }] } };
  };

  it('실행은 선택 정책으로 POST, 결과를 열면 기준·Evidence·TMS 제출(품질 담당)', async () => {
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

  it('CARLA 검증 서버 상태(서버·버전·맵·대기열)와 차량 내 감지 Evidence 보고서 링크', async () => {
    const onb = RUN({ runId: 'VV-00002', role: 'FAULT_ONBOARD', scenarioId: 'SCN-FEAT00022-FAULT-ONBOARD', evidence: { files: [{ name: 'report.html', sha256: 'abcdef0123456789', bytes: 10 }] } });
    handler = api(onb, [onb], { ...UP, queue: { running: 1, waiting: 2 } });
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    expect(await screen.findByText('127.0.0.1:2100')).toBeTruthy();
    expect(await screen.findByText('CARLA 0.9.16 · Town04 · FF 차량 0대')).toBeTruthy();
    expect(screen.getByText('1 · 2')).toBeTruthy();
    const link = await screen.findByTestId('sim-report');
    await waitFor(() => expect(link.getAttribute('href')).toBe('/api/virtual-validations/VV-00002/files/report.html'));
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('검증 서버가 없으면 띄우는 방법을 알리고, 차량 내 감지 실행 전에는 보고서 링크 대신 안내', async () => {
    handler = api(RUN({}), [RUN({})], { ...UP, available: false, server: null, reason: null });
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    expect(await screen.findByText(/npm run carla:up/)).toBeTruthy();
    expect((await screen.findByTestId('sim-report')).tagName).toBe('SPAN');
  });

  it('재현 정보에 CARLA 재생 명령(복사)을 보인다', async () => {
    const replay = 'python sim/carla/ffcarla_cli.py --replay "C:/ev/TEST-1/carla_recording.log"';
    handler = api(RUN({ repro: { toolVersion: 'ff-carla 1.0 · CARLA 0.9.16 · Town04', scenarioHash: 'a'.repeat(64), scriptHash: 'b'.repeat(64), seed: 0, map: 'Town04', replay } }));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    fireEvent.click(await screen.findByText('VV-00001'));
    expect(await screen.findByText(replay)).toBeTruthy();
    expect(screen.getByText('ff-carla 1.0 · CARLA 0.9.16 · Town04')).toBeTruthy();
    expect(screen.getByRole('button', { name: `복사 ${replay}` })).toBeTruthy();
  });

  it('이전 실행기 기록은 PASS여도 G5 근거 체크에서 실행기 항목이 FAIL, TMS 제출 없음', async () => {
    handler = api(RUN({ source: 'vecu', repro: { toolVersion: 'ffval 2.0', scenarioHash: 'a'.repeat(64), scriptHash: 'b'.repeat(64), seed: 0 } }));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    fireEvent.click(await screen.findByText('VV-00001'));
    const checks = await screen.findByTestId('g5-checks');
    expect(checks.querySelector('li')!.getAttribute('data-state')).toBe('FAIL');
    expect(screen.getByText('이전 실행기 기록 — CARLA로 다시 실행해야 Evidence')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'TMS 제출 (IF-09)' })).toBeNull();
  });

  it('FFG-TST-009: 차량 내 감지와 원격 DC2 기준선을 한 시간축에 비교하고, 기준선·재현 정보 없는 실행은 G5 근거 체크에서 FAIL — 기준선은 TMS 제출 없음', async () => {
    const crit = (id: string, status: string, value: number | null, at: number | null) => ({ id, label: id, unit: 's', op: '<=', limit: 1, status, value, at, deciding: status !== 'na' });
    const SAFETY = { deactClass: 'DC2', takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, faultTolerantTimeMs: 5000 };
    const REPRO = { toolVersion: 'ff-carla 1.0', scenarioHash: 'a'.repeat(64), scriptHash: 'b'.repeat(64), seed: 0 };
    const onb = RUN({ runId: 'VV-00002', scenarioId: 'SCN-FEAT00022-FAULT-ONBOARD', role: 'FAULT_ONBOARD', safety: SAFETY, repro: REPRO, gateReasons: [], criteria: [crit('detect_latency', 'pass', 2.1, 19.1), crit('ftti_margin', 'pass', 1.4, 20.6), crit('kill_latency', 'na', null, null)] });
    const rem = RUN({ runId: 'VV-00003', scenarioId: 'SCN-FEAT00022-FAULT-REMOTE-DC2', role: 'BASELINE_REMOTE', overall: 'FAIL', gateResult: 'FAIL', safety: SAFETY, repro: null, gateReasons: ['danger_time 31s (기준 <= 0)', '재현 정보(도구 Version·시나리오 해시·판정 스크립트 해시·시드)가 없습니다'], criteria: [crit('kill_latency', 'pass', 0.32, 48.3), crit('deact_time', 'pass', 7, 55.3), crit('ftti_margin', 'fail', -33.3, 55.3), crit('danger_time', 'fail', 31, 30)] });
    handler = api(rem, [onb, rem]);
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    const tl = await screen.findByTestId('compare-timeline');
    expect(within(tl).getByTestId('compare-onboard').textContent).toContain('FTTI 여유 +1.40 s');
    expect(within(tl).getByTestId('compare-remote').textContent).toContain('FTTI 여유 -33.30 s');
    expect(tl.textContent).toContain('FTTI 끝 22.00');
    fireEvent.click(await screen.findByText('VV-00003'));
    const checks = await screen.findByTestId('g5-checks');
    expect([...checks.querySelectorAll('li')].map((li) => li.getAttribute('data-state'))).toEqual(['PASS', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    expect(screen.getByText('danger_time 31s (기준 <= 0)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'TMS 제출 (IF-09)' })).toBeNull();
  });

  it('FFG-TST-003 조합 시험 계획: covering array 행과 금지 조합 부정 시험(거부 확인)을 보인다', async () => {
    handler = api(RUN({}));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    const plan = await screen.findByTestId('combo-plan');
    expect(plan.textContent).toContain('시험 3행 — Flag 2개라 허용 조합 모두(전수) · 금지 조합은 부정 시험 1건');
    expect(within(plan).getAllByRole('row')).toHaveLength(4); // 머리글 + 3행
    const neg = within(plan).getByTestId('combo-negatives');
    expect(neg.textContent).toContain('FEAT-00022 ON · FEAT-00145 OFF → REQUIRES_MISSING · 거부 확인 (DEP-00013)');
    expect(neg.querySelector('li')!.getAttribute('data-state')).toBe('PASS');
  });

  it('실행기 미연결 결과에는 TMS 제출이 없다', async () => {
    handler = api(RUN({ source: 'unavailable', simulator: null, testId: null, overall: 'UNAVAILABLE', gateResult: 'UNAVAILABLE', criteria: [], evidence: null, error: 'SIM_MODE=off' }));
    mount('/validations/virtual', '/validations/virtual', <VirtualValidationScreen />, 'quality');
    fireEvent.click(await screen.findByText('VV-00001'));
    expect(await screen.findByText('SIM_MODE=off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'TMS 제출 (IF-09)' })).toBeNull();
  });
});
