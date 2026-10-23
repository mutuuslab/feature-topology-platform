// P10 화면 — 실험·효과, 장애·VOC, 현장 지원 포털, 외부 연계 현황, 데이터 동기화, Legacy 연계. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ExperimentsScreen } from '../screens/ext/Experiments';
import { FieldPortalScreen, IncidentsScreen } from '../screens/ext/Incidents';
import { DataSyncScreen, IntegrationsScreen, LegacyScreen } from '../screens/ext/Integrations';
import { OpenFeatureScopeScreen } from '../screens/ext/OpenFeatureScope';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
const calls: { url: string; init?: RequestInit }[] = [];
const posted = (path: string) => calls.find((c) => c.init?.method === 'POST' && c.url === path);

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

const EXP = { experimentId: 'EXP-00001', policyId: 'POL-00002', flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', fClass: 'F2', type: 'SHADOW', metric: 'DECISION_AGREEMENT', hypothesis: '판단이 같다', treatmentBp: 5000, minSamples: 500, status: 'RUNNING', decision: null, reason: null };

describe('실험·효과', () => {
  it('Shadow 등록 본문, 행을 열면 효과·Fleet 대조, 출시 담당자는 결정 버튼', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: EXP };
      if (url.startsWith('/api/policies')) return { body: { items: [{ policyId: 'POL-00002', flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'DEPLOYED' }] } };
      if (url.startsWith('/api/experiments/EXP-00001')) return { body: { ...EXP, results: { days: 3, control: 0.985, treatment: 0.99, diff: 0.005, ci95: [0.001, 0.009], enough: true, significant: true, verdict: 'CONSISTENT', agreement: 0.99, fleet: { deployedPolicyId: 'POL-00002', vehicles: 12, agreement: 1, diverged: [] } } } };
      if (url.startsWith('/api/experiments')) return { body: { items: [EXP] } };
    };
    mount('/experiments', '/experiments', <ExperimentsScreen />, 'release');
    await screen.findByText('EXP-00001');
    // 회귀(UX3-12): 등록 폼이 결과 위에 펼쳐져 있지 않다 — 머리의 행동 버튼으로 여는 Drawer에만 있고, 등록하면 닫힌다
    expect(screen.queryByLabelText('가설')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '실험 등록' }));
    const dlg = await screen.findByRole('dialog', { name: '실험 등록' });
    fireEvent.change(within(dlg).getByLabelText('가설'), { target: { value: '새 기준으로도 판단이 같다' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '등록' }));
    await waitFor(() => expect(posted('/api/experiments')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '실험 등록' })).toBeNull());
    expect(JSON.parse(String(posted('/api/experiments')!.init!.body))).toEqual({ policyId: 'POL-00002', type: 'SHADOW', metric: 'DECISION_AGREEMENT', treatmentBp: 1000, minSamples: 1000, hypothesis: '새 기준으로도 판단이 같다' });
    fireEvent.click(screen.getByText('EXP-00001'));
    expect(await screen.findByText('판단 일치')).toBeTruthy();
    expect(screen.getByText(/차량 12대 · 일치 100.00% · 배포 정책 POL-00002/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '채택' })).toBeTruthy();
  });
});

describe('장애·VOC · 현장 지원', () => {
  const INC = { incidentId: 'INC-00001', source: 'VOC', externalRef: 'VOC-1', vin: 'KMH-NX4-0002', featureId: 'FEAT-00022', category: 'UNEXPECTED_ACTIVATION', severity: 'CRITICAL', summary: '갑자기 급제동', status: 'LINKED', sotif: { trigger: true, reason: 'r' }, anomalyId: 'ANM-00001', anomaly: { severity: 'CRITICAL', advice: 'KILL', status: 'OPEN' } };
  it('VOC 가져오기 → 결과 안내, SOTIF는 이상 건 링크', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { body: { created: [INC], skipped: 2 } } : url.startsWith('/api/incidents') ? { body: { items: [INC] } } : undefined);
    mount('/ops/incidents', '/ops/incidents', <IncidentsScreen />);
    const row = (await screen.findByText('INC-00001')).closest('tr')!;
    expect(within(row).getByText('이상 징후로')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'ANM-00001 · KILL' }).getAttribute('href')).toBe('/ops/anomalies?id=ANM-00001');
    fireEvent.click(screen.getByRole('button', { name: 'VOC 가져오기' }));
    expect(await screen.findByText('1건 가져옴 · 이미 있는 2건 건너뜀')).toBeTruthy();
  });

  it('현장 지원 — VIN 조회 결과와 현장 접수 본문', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: { ...INC, incidentId: 'INC-00009', source: 'DEALER' } };
      if (url.startsWith('/api/field/vehicles/KMH-NX4-0002'))
        return { body: { vehicle: { vin: 'KMH-NX4-0002', label: 'x', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', swVersion: '1.2.1' }, flags: [{ flagKey: 'care_00022_param', featureId: 'FEAT-00022', value: false, reason: 'NO_ENTITLEMENT', policyId: 'POL-00002' }], entitlements: [], kills: [], anomalies: [{ anomalyId: 'ANM-00001', kind: 'FIELD_SOTIF', featureId: 'FEAT-00022', severity: 'CRITICAL', advice: 'KILL', mine: true }], incidents: [] } };
    };
    mount('/field?vin=KMH-NX4-0002', '/field', <FieldPortalScreen />);
    expect(await screen.findByText('NO_ENTITLEMENT')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ANM-00001' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('접수처'), { target: { value: '서울 강남' } });
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '미작동 재현' } });
    fireEvent.click(screen.getByRole('button', { name: '접수' }));
    expect(await screen.findByText('INC-00009로 접수됨')).toBeTruthy();
    expect(JSON.parse(String(posted('/api/field/cases')!.init!.body))).toMatchObject({ vin: 'KMH-NX4-0002', dealer: '서울 강남', summary: '미작동 재현' });
  });
});

describe('외부 연계 · 동기화 · Legacy', () => {
  it('연결 현황 — 방식 표시(양방향 연계 탭 다음)', async () => {
    handler = (url) => (url.startsWith('/api/integrations/systems') ? { body: { items: [{ ifId: 'IF-01', name: '요구관리 연계 (ALM)', mode: 'mock', adapter: 'adapters/if-mocks', components: ['D01-01'], calls: 3, lastAt: null }, { ifId: 'IF-10', name: 'OpenFeature SDK', mode: 'internal', adapter: 'OFREP', components: ['D05-01'], calls: 0, lastAt: null }] } } : undefined);
    mount('/integration/connectors?tab=systems', '/integration/connectors', <IntegrationsScreen />);
    const row = (await screen.findByText('IF-01')).closest('tr')!;
    expect(within(row).getByText('모의')).toBeTruthy();
    expect(screen.getByText('내장')).toBeTruthy();
  });

  it('동기화 — CN 국외 이전은 보류 표시, 실행은 대상 ID로 POST', async () => {
    const T = (id: string, market: string, direction: string, allowed: boolean) => ({ targetId: id, ifId: 'IF-12', name: id, system: 'Plant', market, direction, localProcessing: market === 'CN', gate: { allowed, reason: allowed ? null : 'FFG-TEL-005' }, last: null });
    handler = (url, init) => (init?.method === 'POST' ? { status: 201, body: { runId: 'SYNC-RUN-00001', targetId: 'SYNC-IF12-TMA', status: 'SUCCEEDED', at: 'x', by: 'u', records: { platform: 1, external: 2 }, diffs: [], reason: null } } : url.startsWith('/api/sync/targets') ? { body: { items: [T('SYNC-IF12-TMA', 'EU', 'INBOUND', true), T('SYNC-IF12-HMGC-OUT', 'CN', 'OUTBOUND', false)] } } : url.startsWith('/api/sync/runs') ? { body: { items: [] } } : undefined);
    mount('/integration/sync', '/integration/sync', <DataSyncScreen />);
    const cn = (await screen.findByText('SYNC-IF12-HMGC-OUT', { selector: '.ds-mono' })).closest('tr')!;
    expect(within(cn).getByText(/보류/)).toBeTruthy();
    expect(within(cn).getByText(/현지 처리/)).toBeTruthy();
    const eu = screen.getByText('SYNC-IF12-TMA', { selector: '.ds-mono' }).closest('tr')!;
    fireEvent.click(within(eu).getByRole('button', { name: '대사 실행' }));
    await waitFor(() => expect(JSON.parse(String(posted('/api/sync/runs')!.init!.body))).toEqual({ targetId: 'SYNC-IF12-TMA' }));
  });

  it('Legacy — 주문 가져오기 미해석 코드 안내, Legacy-SDV 거부 사유', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST' && url.endsWith('/import')) return { body: { plant: 'TMA', orders: [], unresolved: ['OPT-XHUD'] } };
      if (init?.method === 'POST') return { body: { supported: false, reason: 'F2(안전 관련) — 원격 긴급 차단이 없는 레거시 차량에는 내보내지 않습니다', fClass: 'F2', commands: [] } };
      if (url.startsWith('/api/legacy/mappings')) return { body: { items: [{ legacyCode: 'OPT-FSD3', system: 'PLANT-ERP', description: 'FSD', featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', note: null }] } };
      if (url.startsWith('/api/legacy/orders')) return { body: { items: [] } };
      if (url.startsWith('/api/legacy-sdv/vehicles')) return { body: { items: [{ vin: 'KMH-LF-0001', vehicleModel: 'LF', modelYear: '2019', market: 'KR', codingUnit: 'BCM' }] } };
    };
    mount('/integration/legacy', '/integration/legacy', <LegacyScreen />);
    expect(await screen.findByText('OPT-FSD3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'TMA 주문 가져오기' }));
    expect(await screen.findByText('미해석 코드: OPT-XHUD')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Feature'), { target: { value: 'FEAT-00022' } });
    await screen.findByRole('option', { name: /KMH-LF-0001/ });
    fireEvent.click(screen.getByRole('button', { name: '계획 만들기' }));
    expect(await screen.findByText(/전달 불가 — F2/)).toBeTruthy();
  });
});

describe('OpenFeature 범위', () => {
  it('두 경로·범위 표·flag별 경계(F2 이상은 Safety Guard만)·SDK 고정·차량 내장 provider 일치', async () => {
    handler = (url) => {
      if (url.startsWith('/api/openfeature/scope'))
        return {
          body: {
            items: [
              { id: 'OF-6', title: '차량 내장 provider', what: 'IVI 앱용', side: 'vehicle', status: 'done', rules: ['FFG-OFT-001'], endpoints: ['GET /api/vehicles/:vin/openfeature'], tests: [] },
              { id: 'OUT-1', title: '차량 제어 SW·Safety Guard', what: '쓰지 않음', side: 'vehicle', status: 'excluded', rules: ['FFG-OFT-001'], endpoints: [], tests: [] },
            ],
            pins: { spec: '0.8.0', sdks: { '@openfeature/web-sdk': '1.10.0' }, experimental: [] },
            catalog: [
              { flagKey: 'ivi_00024_guide', featureId: 'FEAT-00024', featureVersion: '1.0.0', fClass: 'F1', safeDefault: false, revisions: [1], openFeature: true },
              { flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', fClass: 'F3', safeDefault: false, revisions: [1], openFeature: false },
            ],
            snapshotVersion: 'snap-abc',
            audit: { spans: 12, lastAt: null },
          },
        };
      if (url.startsWith('/api/vehicles/ego-01/openfeature'))
        return { body: { vin: 'ego-01', pseudonym: 'abcdef0123456789', stale: false, items: [{ flagKey: 'care_00022_param', fClass: 'F3', openFeature: false, sdk: { value: false, reason: 'DISABLED' }, guard: { value: true, reason: 'POLICY_MATCH' }, agrees: true }] } };
      if (url.startsWith('/api/vehicles')) return { body: { items: [{ vin: 'ego-01', label: 'x' }] } };
    };
    mount('/integration/openfeature', '/integration/openfeature', <OpenFeatureScopeScreen />);
    expect(await screen.findByRole('region', { name: 'OpenFeature 경로 — F0·F1' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Safety Guard 경로 — F2 이상' })).toBeTruthy();
    const cat = screen.getByRole('table', { name: 'flag 목록과 경계' });
    expect(within(within(cat).getByText('care_00022_param').closest('tr')!).getByText('Safety Guard만')).toBeTruthy();
    expect(within(within(cat).getByText('ivi_00024_guide').closest('tr')!).getByText('OpenFeature로 평가')).toBeTruthy();
    expect(screen.getByText('@openfeature/web-sdk 1.10.0')).toBeTruthy();
    expect(within(within(screen.getByRole('table', { name: '반영 범위' })).getByText('OUT-1').closest('tr')!).getByText('범위 밖')).toBeTruthy();
    const veh = await screen.findByRole('table', { name: '차량 내장 provider (OF-6)' });
    expect(within(veh).getByText('OFF · DISABLED')).toBeTruthy();
    expect(screen.getByText('targetingKey(차량 가명) abcdef0123456789')).toBeTruthy();
  });
});
