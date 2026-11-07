// 관제 담당자 웨이브 W1 — 긴급 차단 서명 역할(P3-2)·복원 막힘 경고(P4-1)·사후 검토(P4-2)·배포 회신 대기(P4-4)·복원 요청 폼(P4-7)
// ·현장 SOTIF 차단 링크(P4-8)·키 교체(P4-6)·차량 판단 불가(P4-3). 모의 API — 실제 흐름은 e2e persona-ops.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { KillConsole } from '../screens/ops/KillConsole';
import { DeploymentList, deploymentMessage } from '../screens/ops/Deployments';
import { PostReviewForm } from '../screens/admin/Oversight';
import { AnomalyScreen } from '../screens/ops/Anomalies';
import { SecurityScreen } from '../screens/master/Ops';
import { VehicleRuntimeScreen } from '../screens/ops/FleetLive';

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path: string, routePath: string, el: JSX.Element, role = 'operator', department?: string) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role, ...(department ? { department } : {}) }));
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

const KILL = {
  killId: 'KILL-00001',
  featureId: 'FEAT-00022',
  featureVersion: '1.0.0',
  featureIds: ['FEAT-00022'],
  flagKeys: [],
  vins: ['ego-01', 'lead-01'],
  reason: 'r',
  status: 'REQUESTED',
  version: 2,
  fClass: 'F3',
  deactClass: 'DC2',
  reasonCategory: 'SAFETY',
  reasonCode: 'FIELD_FAULT',
  fsmRequired: true,
  approvals: [] as unknown[],
  expiresAt: '2026-10-12T03:00:00.000Z',
  requestedBy: 'usr-operator',
  requestedAt: '2026-10-12T01:00:00.000Z',
  releasedBy: null,
  releasedAt: null,
  releaseReason: null,
  delivery: null,
  restore: null,
};
const killApi =
  (k: Record<string, unknown>, extra: Handler = () => undefined): Handler =>
  (url, init) =>
    extra(url, init) ??
    (init?.method === 'POST'
      ? { status: 201, body: k }
      : url.startsWith('/api/kill-requests/KILL-00001/envelopes')
        ? { body: { envelopes: [] } }
        : url.startsWith('/api/kill-requests/KILL-00001/timeline')
          ? { body: { items: [] } }
          : url.startsWith('/api/kill-post-reviews')
            ? { body: { items: [] } }
            : url.startsWith('/api/kill-requests/KILL-')
              ? { body: k }
              : url.startsWith('/api/kill-requests')
                ? { body: { items: [] } }
                : undefined);

describe('긴급 차단 — 서명 역할(P3-2)·복원 막힘(P4-1)', () => {
  it('FSM·CSM을 함께 가진 시스템 연계 담당이 사이버보안 부서에서 승인하면 CSM으로 서명한다 — 역할 선택이 보이고 기본은 부서 역할', async () => {
    handler = killApi(KILL);
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator', 'DEP-CS');
    const dlg = await screen.findByRole('dialog');
    const sel = (await within(dlg).findByLabelText('서명 역할')) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['기능안전(Safety Manager)', '사이버보안']);
    expect(sel.value).toBe('CSM');
    fireEvent.click(within(dlg).getByRole('button', { name: '승인 — 개인 서명' }));
    await waitFor(() => expect(posted('/api/kill-requests/KILL-00001/approvals')).toBeTruthy());
    expect(new Headers(posted('/api/kill-requests/KILL-00001/approvals')!.init!.headers).get('X-Actor-Role')).toBe('SECURITY_OFFICER');
  });

  it('기능안전 부서에서 같은 사람이 승인하면 FSM — FSM이 이미 있으면 CSM만 남는다(FSM+FSM 기록 방지)', async () => {
    handler = killApi(KILL);
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator', 'DEP-FS');
    const sel = (await within(await screen.findByRole('dialog')).findByLabelText('서명 역할')) as HTMLSelectElement;
    expect(sel.value).toBe('FSM');
    cleanup();
    handler = killApi({ ...KILL, approvals: [{ approverId: 'usr-quality', role: 'FSM', signedAt: '2026-10-12T01:05:00.000Z', kid: 'k' }] });
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator', 'DEP-FS');
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText(/박유진\(품질 검토\)/);
    // 선택지가 하나(CSM)뿐이라 선택 상자가 없고, 승인은 SECURITY_OFFICER로
    expect(within(dlg).queryByLabelText('서명 역할')).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: '승인 — 개인 서명' }));
    await waitFor(() => expect(posted('/api/kill-requests/KILL-00001/approvals')).toBeTruthy());
    expect(new Headers(posted('/api/kill-requests/KILL-00001/approvals')!.init!.headers).get('X-Actor-Role')).toBe('SECURITY_OFFICER');
  });

  it('두 번째 승인 전 — 이 승인 뒤 복원할 Safety Manager가 남지 않으면 경고와 상위 대응 안내(데모 계정 safety2가 있으면 경고 없음)', async () => {
    // 첫 칸: 두 번째 Safety Manager(safety2)가 FSM으로 승인 → 남은 FSM 후보는 품질 검토·시스템 연계. 시스템 연계가 CSM으로 승인하면 품질 검토가 남는다
    handler = killApi({ ...KILL, approvals: [{ approverId: 'usr-safety2', role: 'FSM', signedAt: '2026-10-12T01:05:00.000Z', kid: 'k' }] });
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator', 'DEP-CS');
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByTestId('approver-candidates');
    expect(within(dlg).queryByTestId('restore-dead-end')).toBeNull();
    cleanup();
    // 첫 칸 품질 검토(FSM) + 시스템 연계(CSM·FSM) 두 번째 → 차단 승인자 둘을 빼도 safety2가 남는다 — 경고 없음
    handler = killApi({ ...KILL, approvals: [{ approverId: 'usr-quality', role: 'FSM', signedAt: '2026-10-12T01:05:00.000Z', kid: 'k' }] });
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'integrator', 'DEP-CS');
    const d2 = await screen.findByRole('dialog');
    await within(d2).findByTestId('approver-candidates');
    expect(within(d2).queryByTestId('restore-dead-end')).toBeNull();
  });

  it('차단 중 — 복원 전망: 승인할 수 있는 사람 목록, 막히면 상위 대응 안내', async () => {
    const ACTIVE = {
      ...KILL,
      status: 'ACTIVE',
      approvals: [
        { approverId: 'usr-quality', role: 'FSM', signedAt: 'x', kid: 'k' },
        { approverId: 'usr-integrator', role: 'CSM', signedAt: 'x', kid: 'k' },
      ],
      restoreOutlook: { candidates: [{ id: 'usr-safety2', roles: ['FSM'] }, { id: 'usr-opslead', roles: ['OPS_LEAD'] }], byRole: [{ role: 'FSM', ids: ['usr-safety2'] }], missing: [], complete: true },
    };
    handler = killApi(ACTIVE, (url) => (url.startsWith('/api/evidence') ? { body: { items: [] } } : undefined));
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'operator', 'DEP-OPS');
    const o = await within(await screen.findByRole('dialog')).findByTestId('restore-outlook');
    expect(o.textContent).toContain('오세린(기능안전 담당) — 기능안전(Safety Manager)');
    expect(o.textContent).toContain('강태윤(운영 리더)');
    cleanup();
    handler = killApi({ ...ACTIVE, restoreOutlook: { candidates: [], byRole: [{ role: 'FSM', ids: [] }], missing: ['FSM'], complete: false } }, (url) => (url.startsWith('/api/evidence') ? { body: { items: [] } } : undefined));
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'operator', 'DEP-OPS');
    const blocked = await within(await screen.findByRole('dialog')).findByTestId('restore-outlook');
    expect(blocked.textContent).toContain('복원 승인자 부족 — 기능안전(Safety Manager) 담당이 없습니다');
    expect(blocked.textContent).toContain('상위 대응');
  });
});

describe('복원 요청 폼 — 재검증 Evidence·Canary Cohort(P4-7)', () => {
  const ACTIVE = { ...KILL, status: 'ACTIVE', approvals: [{ approverId: 'usr-quality', role: 'FSM', signedAt: 'x', kid: 'k' }, { approverId: 'usr-integrator', role: 'CSM', signedAt: 'x', kid: 'k' }] };
  it('Evidence가 없으면 이유와 함께 막히고, 고르면 사유·Evidence·Cohort(기본 첫 차량)로 요청한다', async () => {
    handler = killApi(ACTIVE, (url) => (url.startsWith('/api/evidence') ? { body: { items: [] } } : undefined));
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'operator', 'DEP-OPS');
    const form = await within(await screen.findByRole('dialog')).findByTestId('restore-form');
    await within(form).findByText(/판정 Evidence가 없습니다/);
    fireEvent.change(within(form).getByLabelText('사유'), { target: { value: '원인 수정 완료' } });
    const btn = within(form).getByRole('button', { name: '복원 요청' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(form.textContent).toContain('재검증 Evidence를 고르세요');
    cleanup();
    calls.length = 0;
    const EV = { items: [{ evidenceRef: 'EV-G2', gate: 'G2', featureVersion: '1.0.0', inputResult: 'PASS' }, { evidenceRef: 'EV-G5', gate: 'G5', featureVersion: '1.0.0', inputResult: 'PASS' }] };
    handler = killApi(ACTIVE, (url) => (url.startsWith('/api/evidence') ? { body: EV } : undefined));
    mount('/ops/kill?id=KILL-00001', '/ops/kill', <KillConsole />, 'operator', 'DEP-OPS');
    const f2 = await within(await screen.findByRole('dialog')).findByTestId('restore-form');
    expect(((await within(f2).findByTestId('restore-evidence')) as HTMLSelectElement).value).toBe('EV-G5'); // 검증(G5) 근거가 먼저
    const cohort = within(f2).getByTestId('restore-cohort');
    expect((within(cohort).getByRole('checkbox', { name: 'ego-01' }) as HTMLInputElement).checked).toBe(true);
    expect((within(cohort).getByRole('checkbox', { name: 'lead-01' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(within(f2).getByLabelText('사유'), { target: { value: '원인 수정 완료' } });
    // 해제 확인 항목(FR-KSW-004-002) — 둘 다 체크하기 전에는 막힌다
    expect((within(f2).getByRole('button', { name: '복원 요청' }) as HTMLButtonElement).disabled).toBe(true);
    expect(f2.textContent).toContain('차단 사유 해소·원인 조치 완료를 둘 다 체크하세요');
    fireEvent.click(within(f2).getByRole('checkbox', { name: '차단 사유 해소' }));
    expect((within(f2).getByRole('button', { name: '복원 요청' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(f2).getByRole('checkbox', { name: '원인 조치 완료' }));
    fireEvent.click(within(f2).getByRole('button', { name: '복원 요청' }));
    await waitFor(() => expect(posted('/api/kill-requests/KILL-00001/restore')).toBeTruthy());
    expect(JSON.parse(String(posted('/api/kill-requests/KILL-00001/restore')!.init!.body))).toEqual({ reason: '원인 수정 완료', evidenceRef: 'EV-G5', cohort: ['ego-01'], resolved: true, causeFixed: true });
  });
});

describe('사후 검토 — 감사(AUDITOR) 허용·관여자 미리 막기(P4-2·P3-5)', () => {
  const ROW = { killId: 'KILL-00001', featureId: 'FEAT-00022', issuedAt: 'x', due: '2026-10-13T01:10:00.000Z', requestedBy: 'usr-operator', approvers: ['usr-quality', 'usr-integrator'], review: null, status: 'PENDING' as const };
  it('조회(감사) 계정은 기록할 수 있고, 승인자는 사람이 읽는 이유와 함께 막힌다', async () => {
    handler = () => ({ status: 201, body: {} });
    mount('/x', '/x', <PostReviewForm killId="KILL-00001" row={ROW} />, 'viewer');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '사유·범위·승인 적정 확인' } });
    const btn = screen.getByRole('button', { name: '사후 검토 기록' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(posted('/api/kill-requests/KILL-00001/post-review')).toBeTruthy());
    expect(new Headers(posted('/api/kill-requests/KILL-00001/post-review')!.init!.headers).get('X-Actor-Role')).toBe('AUDITOR');
    cleanup();
    mount('/x', '/x', <PostReviewForm killId="KILL-00001" row={ROW} />, 'quality');
    expect(screen.getByTestId('post-review-blocked').textContent).toBe('승인자는 자기가 승인한 명령을 사후 검토할 수 없습니다');
    expect((screen.getByRole('button', { name: '사후 검토 기록' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('배포 회신 대기(P4-4)·차량 판단 불가(P4-3)', () => {
  it('핵심 메시지 — 회신 대기(DISPATCHED)를 가장 오래 기다린 시간과 함께 센다, 끝난 것이 없으면 깨끗', () => {
    const now = Date.parse('2026-11-05T01:00:00.000Z');
    expect(deploymentMessage([{ status: 'DISPATCHED', createdAt: '2026-11-05T00:35:00.000Z', closedAt: null }, { status: 'DISPATCHED', createdAt: '2026-11-05T00:55:00.000Z', closedAt: null }, { status: 'CONFIRMED', createdAt: 'x', closedAt: 'y' }], now)).toEqual({
      tone: 'warn',
      value: 2,
      text: '회신 대기 게시본 2건 · 가장 오래 25분',
    });
    expect(deploymentMessage([{ status: 'TIMEOUT', createdAt: 'x', closedAt: 'y' }], now)).toMatchObject({ tone: 'warn', value: 1 });
    expect(deploymentMessage([{ status: 'CONFIRMED', createdAt: 'x', closedAt: 'y' }], now)).toMatchObject({ tone: 'ok' });
  });

  it('시뮬레이터 회신이 멈춘 데모 서버면 이유를 보이고, 상태는 한국어 · 미수신 n분', async () => {
    const PUB = { publicationId: 'PUB-00001', kind: 'POLICY', status: 'DISPATCHED', confirmed: 0, denominator: 1, closedAt: null, createdAt: new Date(Date.now() - 12 * 60_000).toISOString(), channel: 'OTA', nodes: [], payload: { flagKey: 'f', featureId: 'FEAT-00022', targets: ['ego-01'] } };
    handler = (url) =>
      url.startsWith('/api/publications')
        ? { body: { items: [PUB] } }
        : url.startsWith('/api/vehicle-channel')
          ? { body: { active: 'sim', adapters: [{ id: 'sim', active: true, status: { replies: 'PAUSED' } }] } }
          : url.startsWith('/api/pki/keys')
            ? { body: { items: [{ keyId: 'KEY-0001', purpose: 'policy', status: 'RETIRED', createdAt: 'x', notAfter: '2027-01-01', fingerprint: 'f' }] } }
            : undefined;
    mount('/deployments', '/deployments', <DeploymentList />, 'operator');
    expect(await screen.findByTestId('replies-paused')).toBeTruthy();
    expect(screen.getAllByText('회신 대기').length).toBeGreaterThan(0);
    expect(screen.getByText('미수신 12분')).toBeTruthy();
    // 은퇴 키는 '검증 전용'(판정 배지 '미판정'이 아니다), 교체는 보안 화면으로
    expect(await screen.findByText('검증 전용')).toBeTruthy();
    expect(screen.getByRole('link', { name: /키 교체는 보안·인증서 화면에서/ }).getAttribute('href')).toBe('/admin/security');
  });

  it('차량 상세 — 회신을 하나도 받지 못한 차량은 "같습니다"가 아니라 판단 불가', async () => {
    handler = (url) =>
      url.startsWith('/api/vehicles/KMH-NX4-0001/runtime')
        ? { body: { vehicle: { vin: 'KMH-NX4-0001', label: 'l', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', swVersion: '1', link: 'ONLINE', quality: 'TRUSTED', gleo: false }, runtime: { bootId: 'B', highest: {}, bundles: {}, kills: {}, featureState: {}, log: [] }, evaluations: [] } }
        : url.startsWith('/api/vehicles')
          ? { body: { items: [{ vin: 'KMH-NX4-0001', label: 'l' }] } }
          : url.startsWith('/api/publications')
            ? { body: { items: [] } }
            : { body: { features: [], recent: [], items: [] } };
    mount('/fleet/vehicles/KMH-NX4-0001?tab=records', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />); // '정책 게시본·수신 기록' 탭이 이 핵심 메시지를 고른다
    await waitFor(() => expect(document.querySelector('[data-key-message]')?.textContent).toContain('판단 불가 — KMH-NX4-0001'));
    expect(document.querySelector('[data-key-message]')?.textContent).not.toContain('같습니다');
  });
});

describe('현장 SOTIF 이상 → 긴급 차단(P4-8)', () => {
  it('치명(CRITICAL) 현장 SOTIF 이상 건에는 긴급 차단으로 링크, 확인하면 서랍을 다시 읽는다', async () => {
    const A = { anomalyId: 'ANM-00001', kind: 'FIELD_SOTIF', featureId: 'FEAT-00022', status: 'OPEN', severity: 'CRITICAL', advice: 'INVESTIGATE', reasons: ['현장 장애'], vins: ['KMH-NX4-0004'], signals: [], openedAt: 'x', updatedAt: 'x', acknowledgedBy: null, closedBy: null, closedAt: null, closeReason: null, killId: null };
    let acked = false;
    handler = (url, init) => {
      if (init?.method === 'POST') return (acked = true), { status: 201, body: { ...A, status: 'ACKNOWLEDGED' } };
      if (url.startsWith('/api/anomalies/ANM-00001')) return { body: acked ? { ...A, status: 'ACKNOWLEDGED', acknowledgedBy: 'usr-operator' } : A };
      if (url.startsWith('/api/anomalies')) return { body: { items: [A] } };
    };
    window.history.pushState({}, '', '/ops/anomalies?id=ANM-00001');
    mount('/ops/anomalies?id=ANM-00001', '/ops/anomalies', <AnomalyScreen />);
    const dlg = await screen.findByRole('dialog');
    const link = await within(dlg).findByTestId('anomaly-to-kill');
    expect(link.getAttribute('href')).toBe('/ops/kill?featureId=FEAT-00022&anomaly=ANM-00001');
    fireEvent.change(within(dlg).getByLabelText('사유'), { target: { value: '현장 확인' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '확인' }));
    await within(dlg).findByText('확인됨');
    window.history.pushState({}, '', '/');
  });
});

describe('키 교체 — 보안 화면에서 용도 선택(P4-6)', () => {
  it('보안 담당은 용도를 골라 교체한다, 은퇴 키는 검증 전용', async () => {
    handler = (url, init) =>
      init?.method === 'POST'
        ? { status: 201, body: { keyId: 'KEY-0009' } }
        : url.startsWith('/api/pki/keys')
          ? { body: { items: [{ keyId: 'KEY-0001', alg: 'Ed25519', purpose: 'kill', epoch: 1, status: 'RETIRED', createdAt: 'x', notAfter: 'y', fingerprint: 'f' }] } }
          : url.startsWith('/api/pki/hsm')
            ? { body: { epoch: 1, approverKeys: 3 } }
            : { body: { items: [], definitions: [] } };
    mount('/admin/security', '/admin/security', <SecurityScreen />, 'integrator');
    const box = await screen.findByTestId('key-rotate');
    expect(await screen.findByText('검증 전용')).toBeTruthy();
    expect(screen.getAllByText('긴급 차단').length).toBeGreaterThan(0);
    fireEvent.change(within(box).getByLabelText('키 용도'), { target: { value: 'restore' } });
    fireEvent.change(within(box).getByLabelText('사유'), { target: { value: '정기 교체' } });
    fireEvent.click(within(box).getByRole('button', { name: '서명 키 교체' }));
    await waitFor(() => expect(posted('/api/pki/rotate')).toBeTruthy());
    expect(JSON.parse(String(posted('/api/pki/rotate')!.init!.body))).toEqual({ reason: '정기 교체', purpose: 'restore' });
    expect(await within(box).findByText(/새 키 KEY-0009로 교체했습니다/)).toBeTruthy();
  });
});
