// P8b 화면 — 이상 징후 대응·품질 피드백·Unleash 연계 패널·IAM·Variant·지원 조건, 이상 건 → 긴급 차단 연결. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { AnomalyScreen, FeedbackScreen } from '../screens/ops/Anomalies';
import { KillConsole } from '../screens/ops/KillConsole';
import { UnleashPanel } from '../screens/policy/Unleash';
import { IamScreen, VariantScreen } from '../screens/admin/Access';

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

const ANM = {
  anomalyId: 'ANM-00001', kind: 'FEATURE_FAULT', featureId: 'FEAT-00022', status: 'OPEN', severity: 'CRITICAL', advice: 'KILL',
  reasons: ['ASIL B 기능 — 2대 이상에서 보고'], vins: ['ego-01', 'lead-01'],
  signals: [{ vin: 'ego-01', code: 'GAP_EST_DRIFT', severity: 'WARNING', at: '2026-10-12T01:00:00Z', ref: null }],
  openedAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T01:00:00Z', acknowledgedBy: null, closedBy: null, closedAt: null, closeReason: null, killId: null,
};

describe('이상 징후 대응', () => {
  it('긴급 차단 권고 이상 건 — 상세에서 차단 콘솔로 Feature·이상 건을 넘기고, 운영자는 확인할 수 있다', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { body: { ...ANM, status: 'ACKNOWLEDGED' } } : url.startsWith('/api/anomalies/ANM-') ? { body: ANM } : url.startsWith('/api/anomalies') ? { body: { items: [ANM, { ...ANM, anomalyId: 'ANM-00002', status: 'DISMISSED' }] } } : undefined);
    mount('/ops/anomalies', '/ops/anomalies', <AnomalyScreen />);
    expect(await screen.findByText('긴급 차단 권고')).toBeTruthy();
    expect(screen.queryByText('ANM-00002')).toBeNull(); // 기본은 열린 건만
    fireEvent.click(screen.getByText('ANM-00001'));
    const link = await screen.findByRole('link', { name: '긴급 차단으로' });
    expect(link.getAttribute('href')).toBe('/ops/kill?featureId=FEAT-00022&anomaly=ANM-00001');
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '현장 확인' } });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(posted('/api/anomalies/ANM-00001/acknowledge')).toBeTruthy());
  });

  it('작성자는 조치할 수 없다', async () => {
    handler = (url) => (url.startsWith('/api/anomalies/ANM-') ? { body: ANM } : url.startsWith('/api/anomalies') ? { body: { items: [ANM] } } : undefined);
    mount('/ops/anomalies', '/ops/anomalies', <AnomalyScreen />, 'author');
    fireEvent.click(await screen.findByText('ANM-00001'));
    fireEvent.change(await screen.findByLabelText('사유'), { target: { value: '현장 확인' } });
    expect((screen.getByRole('button', { name: '조치 완료' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('차단 콘솔은 이상 건에서 넘어온 Feature로 채워지고, 요청 본문에 anomalyId를 싣는다(발행되면 이상 건이 조치됨)', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: { killId: 'KILL-00001' } };
      if (url.startsWith('/api/kill-requests/preview')) return { body: { feature: { featureId: 'FEAT-00022', version: '1.0.0', name: 'x', lifecycle: 'RELEASED', asil: 'B' }, featureIds: ['FEAT-00022'], dependents: [], flagKeys: ['care_00022_param'], vehicles: [{ vin: 'ego-01', label: 'a', link: 'ONLINE', gleo: true }], activeKill: null, registry: { f_class: 'F3', deact_class: 'DC2', gsr_mandatory: false }, window: { hours: 24, deactivate: 0, cap: 5000 }, checks: [] } };
      if (url.startsWith('/api/kill-requests/KILL')) return { body: { killId: 'KILL-00001', featureIds: [], flagKeys: [], vins: [], safeMode: 'SAFE_DEFAULT', reason: 'r', status: 'ACTIVE', delivery: null, restore: null } };
      if (url.startsWith('/api/kill-requests')) return { body: { items: [] } };
    };
    mount('/ops/kill?featureId=FEAT-00022&anomaly=ANM-00001', '/ops/kill', <KillConsole />);
    expect(await screen.findByRole('link', { name: 'ANM-00001' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '이상 건 조치' } });
    fireEvent.change(await screen.findByLabelText(/봉쇄 결정 근거/), { target: { value: '이상 건 봉쇄' } });
    fireEvent.click(await screen.findByRole('button', { name: '차단 요청' }));
    const dlg = await screen.findByRole('alertdialog');
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: 'FEAT-00022' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '차단 요청' }));
    await waitFor(() => expect(posted('/api/kill-requests')).toBeTruthy());
    expect(JSON.parse(String(posted('/api/kill-requests')!.init!.body)).anomalyId).toBe('ANM-00001');
  });
});

describe('품질 피드백', () => {
  it('다음 Version이 할 일(G5·G7·가상검증 회귀)을 보여 주고, 설계 담당이 수용한다', async () => {
    const FB = { feedbackId: 'FB-00001', featureId: 'FEAT-00022', featureVersion: '1.0.0', anomalyId: 'ANM-00001', kind: 'FEATURE_FAULT', summary: '현장 고장 — 차량 2대', actions: [{ kind: 'REJUDGE_GATE', ref: 'G5', label: 'G5 재판정' }, { kind: 'VIRTUAL_REGRESSION', ref: 'SCN-FEAT00022-FAULT-ONBOARD', label: '가상검증 회귀' }], status: 'OPEN', createdAt: '2026-10-12T01:00:00Z', acceptedBy: null, resolvedAt: null, note: null };
    handler = (_u, init) => (init?.method === 'POST' ? { body: { ...FB, status: 'ACCEPTED' } } : { body: { items: [FB] } });
    mount('/quality/feedback', '/quality/feedback', <FeedbackScreen />, 'author');
    expect(await screen.findByText('G5 · SCN-FEAT00022-FAULT-ONBOARD')).toBeTruthy();
    fireEvent.click(screen.getByText('FB-00001'));
    expect(await screen.findByRole('link', { name: 'CARLA 가상검증 →' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '1.1.0에서 보정' } });
    fireEvent.click(screen.getByRole('button', { name: '수용' }));
    await waitFor(() => expect(posted('/api/quality-feedback/FB-00001/accept')).toBeTruthy());
  });
});

const VIEW = (over: Record<string, unknown> = {}) => ({
  status: { mode: 'mock', url: null, state: 'OK', version: '8.2.0 (mock)', why: null },
  plan: { flagName: 'care_00022_param', enabled: true, strategies: [{ title: 'POL-00002 전체', parameters: { rollout: '100' }, constraints: [{ contextName: 'country', operator: 'IN', values: ['KR'], inverted: false }] }], dependencies: [], tags: [{ type: 'fp-policy', value: 'POL-00002@r1' }], blockers: [], notes: ['REQUIRES FEAT-00145: 참고'], ready: true },
  drift: ['Unleash에 flag가 없습니다'],
  serverError: null,
  lastSync: null,
  ...over,
});

describe('Unleash 연계 패널 (IF-04)', () => {
  it('동기화 → 단계 결과, 차량별 대조 → 일치·불일치 요약', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { body: { outcome: 'SYNCED', steps: [{ name: 'ensureFlag', state: 'OK', code: 201, why: null, detail: 'CREATED' }] } };
      if (url.endsWith('/unleash/evaluation')) return { body: { summary: { vehicles: 2, agree: 1, mismatch: 1, noContext: 0, error: 0 }, rows: [{ vin: 'ego-01', label: 'a', unleash: true, platform: false, platformReason: 'KILL_SWITCH', verdict: 'MISMATCH', why: '긴급 차단은 FP에서만' }, { vin: 'b', label: 'b', unleash: false, platform: false, platformReason: 'NOT_APPLICABLE', verdict: 'AGREE', why: null }] } };
      return { body: VIEW() };
    };
    mount('/p', '/p', <UnleashPanel policyId="POL-00002" deployed />, 'coordinator'); // 출시 담당
    expect(await screen.findByText('country IN KR')).toBeTruthy();
    expect(screen.getByText('Unleash에 flag가 없습니다')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unleash 동기화' }));
    expect(await screen.findByText('CREATED')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '차량별 대조' }));
    expect(await screen.findByText('일치 1 · 불일치 1 · 문맥 없음 0 · 오류 0')).toBeTruthy();
    expect(screen.getByText('긴급 차단은 FP에서만')).toBeTruthy();
  });

  it('막힌 계획은 이유를 보여 주고 동기화 버튼을 막는다', async () => {
    handler = () => ({ body: VIEW({ plan: { ...VIEW().plan, ready: false, blockers: ['배포(DEPLOYED)된 정책만 내보낼 수 있습니다 — 현재 DRAFT'] } }) });
    mount('/p', '/p', <UnleashPanel policyId="POL-00009" deployed={false} />, 'approver');
    expect(await screen.findByText(/배포\(DEPLOYED\)된 정책만/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Unleash 동기화' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('IAM · Variant', () => {
  it('권한표는 사람 역할만 열로 — 차량 기기 신원은 없다', async () => {
    handler = (url) =>
      url.startsWith('/api/iam/roles')
        ? { body: { roles: [{ role: 'OPERATOR', label: '운영자', human: true, allowed: ['issueKill'] }, { role: 'VEHICLE', label: '차량', human: false, allowed: [] }], humanRoles: ['OPERATOR'], permissions: [{ name: 'issueKill', method: 'POST', path: '/api/kill-requests', summary: '긴급 차단', component: 'D03-03', roles: ['OPERATOR'] }], sod: [{ id: 'SOD-05', subject: '정책 승인', rule: '자기 승인 금지', component: 'D03-02' }] } }
        : { body: { items: [], byRole: {} } };
    mount('/admin/iam', '/admin/iam', <IamScreen />);
    const table = await screen.findByRole('table', { name: '역할 × 변경 권한' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['작업', '컴포넌트', '운영자']);
    expect(screen.getByText('SOD-05')).toBeTruthy();
  });

  it('Variant 매트릭스: 판정별 지표와 지원 미달 근거', async () => {
    handler = () => ({
      body: {
        feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리', lifecycle: 'RELEASED' },
        conditions: { scope: 'KR/NX4 PE/Premium', upgVc: ['F111A114001'], requiredSw: '1.2.1', ecu: '99211-NX400', swId: 'SW-CARE-SDIST-APP' },
        summary: { applicable: 3, notSupported: 2, notApplicable: 6, unknown: 1 },
        rows: [{ vin: 'KMH-NX4-0004', label: 'x', quality: 'TRUSTED', scope: true, upgVc: true, actual: '1.1.9', required: '1.2.1', verdict: 'NOT_SUPPORTED', reason: 'SW 1.1.9 < 요구 1.2.1' }],
      },
    });
    mount('/variant-conditions', '/variant-conditions', <VariantScreen />);
    expect(await screen.findByText('SW-CARE-SDIST-APP ≥ 1.2.1')).toBeTruthy();
    // 핵심 메시지 = 지원 안 됨(SW 미달) 차량 수, 요약 줄 = 적용·범위 밖·판정 불명
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('2');
    expect([...document.querySelectorAll('.ds-summary b')].map((k) => k.textContent)).toEqual(['3', '6', '1']);
    expect(screen.getByText('SW 1.1.9 < 요구 1.2.1')).toBeTruthy();
  });
});
