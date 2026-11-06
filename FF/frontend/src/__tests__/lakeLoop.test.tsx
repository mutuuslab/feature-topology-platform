// Data Lake 연계·Closed loop 화면(80-70, BACKLOG TL-UI01·02·03·04·09·10·16·17) — 모의 API.
// 판단 불가는 정상과 나눠 보이고, 신선도 초과는 '판단 보류', 조치 없이 조치 중·효과 없이 닫기는 버튼이 사유를 말한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CanaryObservation, Freshness, HealthFinding } from '@ff/contracts';
import { AppProvider } from '../store';
import { FreshnessChip } from '../design/freshness';
import { FeatureHealthScreen, FindingScreen } from '../screens/ops/FeatureHealth';
import { CollectionScreen } from '../screens/ops/Collection';
import { DataLakeScreen } from '../screens/ext/DataLake';
import { CanaryPanel } from '../screens/policy/CanaryPanel';
import { OpsMetricsTab } from '../screens/features/OpsMetricsTab';

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

const FRESH: Freshness = { dataset: 'gold.feature_health_1d', asOf: '2026-10-20T00:00:00Z', lagSeconds: 11400, slaSeconds: 86400, stale: false };
const STALE: Freshness = { dataset: 'gold.canary_5m_eu', asOf: '2026-10-20T02:37:00Z', lagSeconds: 1380, slaSeconds: 600, stale: true };
const ind = (name: string, axis: string, current: number | null, sampleVehicles: number | null = 5000) => ({ name, axis, current, previous: current, sampleVehicles, suppressed: false });
const axes = (p: string, o: string = 'OK') => ({ OPERATION: { state: 'OK', cause: null }, PROBLEM: { state: p, cause: p === 'OK' ? null : 'dtc_vehicle_rate' }, IMPROVEMENT: { state: o, cause: null }, RISK: { state: 'OK', cause: null } });
const finding = (over: Partial<HealthFinding> = {}): HealthFinding => ({
  findingId: 'FND-00001', featureId: 'FEAT-00004', version: '4.1.0', featureName: '고속도로 주행 보조 2', axis: 'PROBLEM', cause: 'dtc_vehicle_rate', severity: 'ACTION', status: 'ANALYZING',
  ownerRole: 'SAFETY_OFFICER', dueAt: '2099-01-01T00:00:00Z', overdue: false, detectedAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', repeats: 0,
  evidence: { freshness: FRESH, indicators: [ind('dtc_vehicle_rate', 'PROBLEM', 0.0093) as never] }, actions: [], effect: null,
  history: [{ at: '2026-10-18T00:00:00Z', from: null, to: 'DETECTED', by: 'SYSTEM', note: '4축 판정' }],
  ...over,
});
const HEALTH = {
  connected: true,
  asOf: '2026-10-20T03:00:00Z',
  rows: [
    { featureId: 'FEAT-00004', version: '4.1.0', name: '고속도로 주행 보조 2', market: 'KR', activeVehicles: 184000, axes: axes('ACTION'), worst: 'ACTION', openFindings: 1, overdue: 0, freshness: FRESH, indicators: [] },
    { featureId: 'FEAT-00028', version: '1.0.0', name: '전방 안전거리 확대', market: 'US', activeVehicles: 52000, axes: axes('OK', 'UNKNOWN'), worst: 'UNKNOWN', openFindings: 0, overdue: 0, freshness: FRESH, indicators: [] },
    { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', market: 'KR', activeVehicles: 57000, axes: axes('OK'), worst: 'OK', openFindings: 0, overdue: 0, freshness: FRESH, indicators: [] },
  ],
  findings: [finding({ overdue: true }), finding({ findingId: 'FND-00005', featureId: 'FEAT-00005', version: '5.4.2', featureName: '스마트 크루즈 컨트롤', axis: 'OPERATION', cause: 'status_rejected_rate', severity: 'WATCH', status: 'CLOSED', ownerRole: 'OPERATOR' })],
};

describe('데이터 신선도 칩 (TL-UI01)', () => {
  it('출처·지연을 글자로, 기준을 넘으면 경고와 판단 보류 사유', () => {
    const { container, rerender } = render(<FreshnessChip f={FRESH} />);
    expect(container.textContent).toContain('gold.feature_health_1d');
    expect(container.textContent).toContain('3시간 지연');
    expect(container.querySelector('[data-fresh="ok"]')).toBeTruthy();
    rerender(<FreshnessChip f={STALE} compact />);
    expect(container.textContent).toContain('23분 지연 · 판단 보류');
    expect(container.querySelector('.ds-fresh__src')).toBeNull(); // compact는 출처를 설명(title·화면 읽기)으로만
    expect(container.querySelector('[data-fresh="stale"]')?.getAttribute('title')).toContain('판단은 보류');
  });
});

describe('운영 점검 허브 (TL-UI16)', () => {
  it('조치 필요 수와 기한 지남, 판단 불가는 정상과 따로 — 축 필터·행에서 점검 결과로', async () => {
    handler = (url) => (url.startsWith('/api/feature-health') ? { body: HEALTH } : undefined);
    mount('/ops/feature-health', '/ops/feature-health', <FeatureHealthScreen />);
    const key = await screen.findByText('건 조치 필요 · 기한 지남 1건');
    expect(key.closest('[data-key-message]')?.getAttribute('data-tone')).toBe('danger');
    const list = screen.getByRole('table', { name: '점검 결과' });
    expect(within(list).getByRole('link', { name: 'FND-00001' }).getAttribute('href')).toBe('/ops/feature-health/FND-00001');
    const table = screen.getByRole('table', { name: '버전별 4축 판정' });
    expect(within(table).getAllByText('판단 불가').length).toBe(1);
    expect(within(table).getAllByText('조치 필요').length).toBe(1);
    // 상태 필터 — 판단 불가만
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '상태' })).getByRole('radio', { name: /판단 불가/ }));
    expect(within(table).queryByText('고속도로 주행 보조 2')).toBeNull();
    expect(within(table).getByText('전방 안전거리 확대')).toBeTruthy();
  });

  it('연결 안 됨(운영 설치) — 값 대신 안내', async () => {
    handler = (url) => (url.startsWith('/api/feature-health') ? { body: { connected: false, asOf: null, rows: [], findings: [] } } : undefined);
    mount('/ops/feature-health', '/ops/feature-health', <FeatureHealthScreen />);
    expect(await screen.findByText('Data Lake가 연결되지 않았습니다. 이 화면의 값으로 판단하지 않습니다.')).toBeTruthy();
  });
});

describe('점검 결과 상세 (TL-UI17)', () => {
  it('조치 없이 조치 중으로 못 간다 — 조치를 함께 연결하면 옮긴다', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { body: finding({ status: 'ACTING' }) } : url.startsWith('/api/feature-health/findings/') ? { body: finding() } : undefined);
    mount('/ops/feature-health/FND-00001', '/ops/feature-health/:findingId', <FindingScreen />, 'quality');
    const btn = await screen.findByRole('button', { name: '조치 중으로' });
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '결함 등록' } });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('조치를 먼저 연결해야 합니다')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('조치 종류'), { target: { value: 'JIRA' } });
    fireEvent.change(screen.getByLabelText('참조 번호'), { target: { value: 'FFP-9001' } });
    fireEvent.change(screen.getByLabelText('조치 내용'), { target: { value: 'DTC 결함' } });
    fireEvent.click(screen.getByRole('button', { name: '조치 중으로' }));
    await waitFor(() => expect(posted('/api/feature-health/findings/FND-00001/transition')).toBeTruthy());
    expect(JSON.parse(String(posted('/transition')!.init!.body))).toMatchObject({ to: 'ACTING', action: { kind: 'JIRA', ref: 'FFP-9001' } });
  });

  it('Grafana 경보로 감지한 점검 결과 — 감지 출처와 이력 주체를 업무 말로 보인다', async () => {
    const g = finding({ status: 'DETECTED', axis: 'IMPROVEMENT', cause: 'usage_rate', severity: 'WATCH', ownerRole: 'FEATURE_AUTHOR', source: 'GRAFANA', alerts: [{ fingerprint: 'fp-1', rule: '사용률 저조', startsAt: '2026-10-18T00:00:00Z', observationId: 'OBS-1' }], history: [{ at: '2026-10-18T00:00:00Z', from: null, to: 'DETECTED', by: 'GRAFANA', note: 'Grafana 경보 — 사용률 저조' }] });
    handler = (url) => (url.startsWith('/api/feature-health/findings/') ? { body: g } : undefined);
    mount('/ops/feature-health/FND-00001', '/ops/feature-health/:findingId', <FindingScreen />, 'quality');
    const history = await screen.findByRole('table', { name: '상태 이력' });
    expect(within(history).getByText('Grafana 경보')).toBeTruthy();
    expect(within(history).queryByText('GRAFANA')).toBeNull();
  });

  it('효과 미달이면 닫기는 사유와 함께 막히고 다시 열기만 된다(INV-20)', async () => {
    const f = finding({ status: 'VERIFYING', actions: [{ kind: 'JIRA', ref: 'FFP-1', title: '결함', at: '2026-10-19T00:00:00Z', by: 'usr-safety' }], effect: { indicator: 'dtc_vehicle_rate', target: 0.004, before: 0.0093, after: 0.0091, samples: 5000, ci: [0.0088, 0.0094], met: false } });
    handler = (url) => (url.startsWith('/api/feature-health/findings/') ? { body: f } : undefined);
    mount('/ops/feature-health/FND-00001', '/ops/feature-health/:findingId', <FindingScreen />, 'quality');
    expect(await screen.findByText('효과 미달 — 다시 열어 조치합니다')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '효과 확인' } });
    expect((screen.getByRole('button', { name: '닫기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('효과가 확인되어야 닫을 수 있습니다')).toBeTruthy();
    expect((screen.getByRole('button', { name: '다시 열기' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

const OBS: CanaryObservation = {
  policyId: 'POL-00002', featureId: 'FEAT-00022', version: '1.0.0', flagKey: 'care_00022_param', stageBasisPoints: 300, nextBasisPoints: 500,
  vehicles: { treatment: 9200, control: 28500 },
  series: Array.from({ length: 24 }, (_, i) => ({ at: `2026-10-19T${String(i).padStart(2, '0')}:00:00Z`, treatment: { apply_failure_rate: 0.005, dtc_per_1k: 2.5, safety_event_per_1k: 0.4 }, control: { apply_failure_rate: 0.005, dtc_per_1k: 1.4, safety_event_per_1k: 0.4 } })),
  stats: [{ metric: 'apply_failure_rate', treatment: 0.005, control: 0.005, relativeRisk: 1, ci: [0.9, 1.1] }, { metric: 'dtc_per_1k', treatment: 2.5, control: 1.4, relativeRisk: 1.8, ci: [1.62, 2.0] }, { metric: 'safety_event_per_1k', treatment: 0.4, control: 0.4, relativeRisk: 1, ci: [0.9, 1.1] }],
  criteria: { metrics: [{ metric: 'dtc_per_1k', maxRelativeRisk: 1.5 }], confidence: 0.95, observeHours: 24, maxLagMinutes: 10, registered: true, registeredBy: 'usr-safety', registeredAt: '2026-10-17T00:00:00Z' },
  verdict: 'ABORT', breached: ['dtc_per_1k'], freshness: { ...STALE, dataset: 'gold.canary_5m_kr', lagSeconds: 180, stale: false },
  risk: { modelId: 'LAKE-M3-DEPLOY-RISK', version: '2.1.0', score: 0.71, factors: [{ name: 'Canary 24시간 DTC 증가', weight: 0.41 }], usable: false },
};

describe('Canary 관측 패널 (TL-UI02·UI03)', () => {
  it('규칙 ① 판정 문장, 추이(중단 기준선), 사용 승인 전 모델 점수는 참고 불가', async () => {
    handler = (url) => (url === '/api/policies/POL-00002/canary' ? { body: { item: OBS } } : undefined);
    mount('/policies/POL-00002', '/policies/:id', <CanaryPanel policyId="POL-00002" deployed />, 'coordinator');
    expect(await screen.findByText('DTC 상대위험 1.8 — 확대 중단')).toBeTruthy();
    expect(screen.getAllByRole('img').length).toBe(3);
    expect(screen.getAllByText('참고 불가 — 사용 승인 전이거나 드리프트').length).toBe(1);
    expect(screen.getByText(/사전 등록 · usr-safety/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '중단 기준 등록' })).toBeTruthy();
  });
});

describe('수집 정책·Data Lake 연계 (TL-UI09·UI10)', () => {
  it('수집 정책 — 보류 건이 핵심, 근거·데이터량·회신', async () => {
    const row = { collectionId: 'COL-0001', title: 'ADAS 개입 전후 스냅샷', signals: ['AEB·ESC 개입', '운전자 개입', '속도 대역'], target: 'NX4 PE', trigger: '개입 시 전후 10초', category: 'SAFETY_OPS', basis: 'LAW', basisNote: '사후 감시', gbPerDay: 412.6, vehicles: 186400, markets: ['KR'], status: 'DEPLOYED', publicationId: null, replies: { accepted: 10, rejected: 1, pending: 2 }, approvedBy: 'usr-safety', updatedAt: '2026-10-10T00:00:00Z', holdReason: null };
    handler = (url) => (url === '/api/collection-policies' ? { body: { connected: true, items: [row, { ...row, collectionId: 'COL-0005', status: 'HELD', holdReason: '국외 이전 심사 전' }] } } : undefined);
    mount('/ops/collection', '/ops/collection', <CollectionScreen />);
    expect(await screen.findByText('건 보류 — 국외 이전 심사 전')).toBeTruthy();
    expect(screen.getAllByText('412.6 GB/일').length).toBe(3); // 두 행 + 서명 배포된 정책 합계
    expect(screen.getAllByText('수락 10 · 거부 1 · 대기 2').length).toBe(2);
  });

  it('Data Lake 연계 — 지연 계약 수, 모델 사용 승인은 이미 결정한 사람이면 사유', async () => {
    handler = (url) =>
      url === '/api/lake/status'
        ? { body: { connected: true, asOf: '2026-10-20T03:00:00Z', datasets: [FRESH, STALE], stale: 1, labelBacklog: 3, failures24h: 0 } }
        : url === '/api/lake/contracts'
          ? { body: { connected: true, items: [] } }
          : url === '/api/system/connections'
            ? { body: { mode: 'demo', presentation: 'seamless', items: [{ key: 'datalake', mode: 'mock', ifId: 'IF-15', liveAdapter: false }] } }
            : url === '/api/lake/models'
              ? { body: { connected: true, items: [{ modelId: 'LAKE-M3-DEPLOY-RISK', version: '2.1.0', purpose: 'DEPLOY_RISK', title: '배포 위험 예측 ③', technique: 'GBM', owner: '차량AI모델팀', lakeApprovedBy: '위원회', trainedAt: '2026-10-14T00:00:00Z', datasetHash: 'sha256:c3', metrics: { precision: 0.72, recall: 0.81, calibration: 0.05, fairnessGap: null }, drift: false, driftNote: null, use: 'PENDING', approvals: [{ by: 'usr-quality', role: 'SAFETY_OFFICER', at: '2026-10-19T00:00:00Z', decision: 'APPROVE', reason: '확인' }], usable: false }] } }
              : undefined;
    mount('/integration/datalake?tab=models', '/integration/datalake', <DataLakeScreen />, 'quality');
    expect(await screen.findByText('건 데이터 계약 지연')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-connection]')).toBeNull()); // 데모 seamless — 모의 표시 없음
    const btn = await screen.findByRole('button', { name: '사용 승인 결정' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('이미 이 판에 결정을 남겼습니다')).toBeTruthy();
  });
});

describe('Feature 운영 지표 탭 (TL-UI04·UI18)', () => {
  it('버전별 활성 차량(만 대)·실패율과 14일 4축 이력, 점검 결과', async () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(7 + i).padStart(2, '0')}`, version: '4.1.0', axes: { OPERATION: 'OK', PROBLEM: i > 11 ? 'ACTION' : 'OK', IMPROVEMENT: 'OK', RISK: 'OK' } }));
    handler = (url) => (url === '/api/features/FEAT-00004/ops-metrics' ? { body: { connected: true, asOf: null, featureId: 'FEAT-00004', versions: [{ version: '4.1.0', activeVehicles: 184000, usageRate: 0.62, failureRate: 0.012, dtcRate: 0.0093, vocAfterDeploy: 2, rollbacks: 0, freshness: FRESH }], history: days, findings: [finding({ repeats: 1 })] } } : undefined);
    mount('/features/FEAT-00004/4.1.0?tab=ops', '/features/:id/:ver', <OpsMetricsTab id="FEAT-00004" />);
    expect(await screen.findByText('18.4만 대')).toBeTruthy();
    expect(screen.getByText('1.20%')).toBeTruthy();
    const grid = screen.getByRole('table', { name: '4.1.0 4축 판정 이력' });
    expect(within(grid).getAllByRole('row')).toHaveLength(5);
    expect(within(grid).getAllByText(/문제 조치 필요/).length).toBe(2);
    expect(screen.getByText('반복 1회')).toBeTruthy();
  });
});
