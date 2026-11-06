// ADS 상태 화면 — 6축(차량 화면 기본 탭)·판정·고객에게 보이는 상태·배포 상세 수렴 7구간·Fleet 축별 분포·주문 추적.
// ux.json 확정안의 핵심 메시지와 '미확인·판단 불가를 정상으로 세지 않음', 막힌 행동 사유를 단언한다(모의 API).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ConvergenceView, CustomerStateView, FleetAxisView, OrdersView, VehicleFeatureStateView, VehicleVerdictsView } from '@ff/contracts';
import { stepPath, TUTORIALS } from '@ff/contracts';
import { AppProvider } from '../store';
import { FleetLive, VehicleRuntimeScreen } from '../screens/ops/FleetLive';
import { DeploymentDetail } from '../screens/ops/Deployments';
import { EntitlementsScreen } from '../screens/policy/Entitlements';

type Handler = (url: string) => { status?: number; body: unknown } | undefined;
let handler: Handler;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const r = handler(url) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
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
const key = () => document.querySelector('[data-key-message]')!;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const MIN15 = 15 * 60_000;

const VEHICLES = { items: [{ vin: 'KMH-GN7-0001', label: 'GN7' }] };
const FRESH = (min: number) => ({ state: 'FRESH' as const, observedAt: ago(min), receivedAt: ago(min), offlineSince: null, staleAfterMs: MIN15, assumed: true, reconnect: null });
const STATE: VehicleFeatureStateView = {
  vin: 'KMH-GN7-0001',
  now: new Date().toISOString(),
  unconfirmed: 1,
  features: [
    {
      featureId: 'FEAT-00004',
      version: '4.1.0',
      name: '고속도로 주행 보조 2',
      featureClass: 'ADS',
      simulated: true,
      freshness: { ...FRESH(180), state: 'DELAYED' },
      entitlement: { value: 'PURCHASED', grantId: null, catalogId: 'CAT-00002', orderId: 'ORDER-0006' },
      install: { value: 'COMPATIBLE', otaStage: 'VERIFIED', configMatch: true, configRef: 'CFG-FEAT-00004-01' },
      delivery: { stage: null, bin: null, publicationId: null, at: null, reasonCode: null },
      eligibility: { current: null, past: 'ALLOW', reasonCode: null, at: ago(180) },
      runtime: { current: null, past: 'ACTIVE', ddtOwner: 'ADS' },
    },
    {
      featureId: 'FEAT-00084',
      version: '5.5.0',
      name: '스마트 크루즈 컨트롤',
      featureClass: 'ADAS',
      simulated: true,
      freshness: FRESH(2),
      entitlement: { value: 'TRIAL', grantId: 'ENT-00009', catalogId: 'CAT-00018', orderId: null },
      install: { value: 'PARTIAL_FAILURE', otaStage: 'VERIFIED', configMatch: false, configRef: null },
      delivery: { stage: 'RECEIVED', bin: 'RECEIVED_ONLY', publicationId: 'PUB-00002', at: ago(3), reasonCode: null },
      eligibility: { current: 'UNKNOWN', past: null, reasonCode: 'INPUT_INVALID_OR_STALE', at: ago(2) },
      runtime: { current: 'AVAILABLE', past: null, ddtOwner: 'USER' },
    },
  ],
};
const VERDICTS: VehicleVerdictsView = {
  vin: 'KMH-GN7-0001',
  now: new Date().toISOString(),
  items: [
    { featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', action: 'ACTIVATE', verdict: 'DENY', reasonCodes: ['ODD_OUT'], observedAt: ago(2), receivedAt: ago(2), stale: false, staleAfterMs: MIN15 * 2, simulated: true, sessionId: 'S1' },
    { featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', action: 'INSTALL', verdict: 'ALLOW', reasonCodes: [], observedAt: ago(2), receivedAt: ago(2), stale: false, staleAfterMs: MIN15 * 2, simulated: true, sessionId: 'S1' },
    { featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', action: 'REACTIVATE', verdict: 'UNKNOWN', reasonCodes: ['INPUT_INVALID_OR_STALE'], observedAt: ago(2), receivedAt: ago(2), stale: false, staleAfterMs: MIN15 * 2, simulated: true, sessionId: 'S1' },
    { featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', action: 'MRC', verdict: 'ALLOW', reasonCodes: [], observedAt: ago(180), receivedAt: ago(180), stale: true, staleAfterMs: MIN15 * 2, simulated: true, sessionId: 'S0' },
  ],
  combos: [{ featureId: 'FEAT-00022', text: '복구 검증 완료 · 종료 차단 해제 · 현재 활성화 불가' }],
};
const ANS = (text: string) => ({ text, sub: null, basis: ['ENTITLEMENT' as const] });
const CUSTOMER: CustomerStateView = {
  vin: 'KMH-GN7-0001',
  now: new Date().toISOString(),
  features: [
    { featureId: 'FEAT-00022', name: '전방 안전거리 3단계', lastConfirmedAt: ago(180), freshness: 'OFFLINE', unconfirmedLine: '오프라인 — 마지막 확인 11-06 07:42, 현재 상태 미확인', answers: { canUse: ANS('지금 사용할 수 있습니다'), when: ANS('지금'), price: ANS('Beginner Care Pass · 구독'), support: ANS('원격 확인 후 가까운 정비 거점으로 안내합니다') }, notifyBasis: null, changes: [], entitlement: null, marketChange: null, ownershipTransfer: null, restricted: false, killId: null },
    { featureId: 'FEAT-00029', name: '급가속 억제', lastConfirmedAt: ago(2), freshness: 'FRESH', unconfirmedLine: null, answers: { canUse: { text: '안전 점검으로 지금은 사용이 제한됩니다', sub: '사용 제한 사유: 안전 점검 · 대체 이용: 운전자 직접 운전', basis: ['DELIVERY', 'RUNTIME'] }, when: ANS('차량 확인 뒤 알려 드립니다'), price: ANS('연결된 상품 정보 없음'), support: { text: '원격 확인 후 가까운 정비 거점으로 안내합니다', sub: '지원 경로 안내만', basis: ['FRESHNESS'] } }, notifyBasis: null, changes: [{ axis: 'RUNTIME', before: 'Available', after: '비활성(Inactive)', reason: '원격 종료' }], entitlement: null, marketChange: null, ownershipTransfer: null, restricted: true, killId: 'KILL-00001' },
  ],
};

function vehicleHandler(over: Partial<Record<'state' | 'verdicts' | 'customer', unknown>> = {}): Handler {
  return (url) => {
    const p = new URL(url, 'http://t').pathname;
    if (p === '/api/vehicles') return { body: VEHICLES };
    if (p.endsWith('/feature-state')) return { body: over.state ?? STATE };
    if (p.endsWith('/verdicts')) return { body: over.verdicts ?? VERDICTS };
    if (p.endsWith('/customer-state')) return { body: over.customer ?? CUSTOMER };
    if (p.endsWith('/runtime')) return { body: { vehicle: { vin: 'KMH-GN7-0001', label: 'g', country: 'KR', vehicleModel: 'GN7', trim: 'C', swVersion: '1', link: 'ONLINE', quality: 'TRUSTED', gleo: false }, runtime: { bootId: 'B', highest: {}, bundles: {}, kills: {}, featureState: {}, log: [] }, evaluations: [] } };
    if (p === '/api/publications') return { body: { items: [] } };
  };
}

describe('차량별 적용 상태 — 6축(기본 탭)', () => {
  it('기준 시간을 넘긴 차량의 활성 적격·실제 실행은 미확인, 과거 값은 회색 보조 — 허용으로 보이지 않는다', async () => {
    handler = vehicleHandler();
    mount('/fleet/vehicles/KMH-GN7-0001', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    const table = await screen.findByRole('table', { name: /고속도로 주행 보조 2 — 6축 상태/ });
    expect(screen.getByRole('tab', { name: '상태(6축)' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(key().textContent).toMatch(/현재 상태 미확인 기능 1개 — 마지막 차량 보고 3시간 전/));
    // 축 이름이 행 머리
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['상품 권리', '구성과 설치', '정책 의도·전달', '활성 적격', '실제 실행', '관측 신선도']);
    const elig = table.querySelector('[data-axis="ELIGIBILITY"]')!;
    expect(elig.querySelector('[data-unknown="UNCONFIRMED"]')).toBeTruthy();
    expect(elig.querySelector('.ads-axes__value')!.textContent).not.toContain('허용');
    expect(elig.querySelector('.ads-axes__past')!.textContent).toBe('그때 보고: 허용');
    expect(elig.textContent).toContain('차량 보고');
    expect(table.querySelector('[data-axis="RUNTIME"] .ads-axes__past')!.textContent).toBe('그때 보고: Active');
    // 결제 상태는 권리 칸에 쓰지 않고 주문 추적 링크
    expect(within(table.querySelector<HTMLElement>('[data-axis="ENTITLEMENT"]')!).getByRole('link', { name: '주문 추적' }).getAttribute('href')).toBe('/entitlements?tab=orders');
    expect(table.querySelector('[data-axis="FRESHNESS"] [data-freshness="DELAYED"]')).toBeTruthy();
  });

  it('차량 판정 UNKNOWN만 판단 불가, 승인 조합 불일치는 부분 실패, 수신만 됨 단계 표시', async () => {
    handler = vehicleHandler();
    mount('/fleet/vehicles/KMH-GN7-0001', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    const table = await screen.findByRole('table', { name: /스마트 크루즈 컨트롤 — 6축 상태/ });
    expect(table.querySelector('[data-axis="ELIGIBILITY"] [data-unknown="UNDECIDABLE"]')!.textContent).toContain('입력 신호 이상·오래됨');
    expect(table.querySelector('[data-axis="INSTALL"]')!.textContent).toContain('부분 실패');
    expect(table.querySelector('[data-axis="INSTALL"]')!.textContent).not.toContain('호환');
    expect(table.querySelector('[data-axis="DELIVERY"]')!.textContent).toContain('수신');
  });
});

describe('차량 화면 탭 분할 — 따라하기 단계가 대상 탭을 연다', () => {
  // 상태 보고 v2는 기본 탭(6축)이 아니라 '정책 게시본·수신 기록' 탭에 있다 — 단계 경로가 ?tab=로 그 탭을 열어야 대상을 찾는다
  const steps = TUTORIALS.flatMap((t) => t.steps.filter((s) => /^\/fleet\/vehicles\/[^/]+$/.test(stepPath(s))).map((s) => ({ id: `${t.id}/${s.id}`, route: s.route, anchor: s.anchor })));
  it('차량 화면을 가리키는 단계가 있다', () => expect(steps.length).toBeGreaterThan(0));
  it.each(steps)('$id — $route 에서 $anchor 대상이 보인다', async ({ route, anchor }) => {
    const base = vehicleHandler();
    handler = (url) => (new URL(url, 'http://t').pathname.endsWith('/status') ? { body: { features: [], recent: [] } } : base(url));
    mount(route, '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    await waitFor(() => expect(document.querySelector(`[data-tour="${anchor}"]`)).toBeTruthy());
  });
  it('기본 탭에는 상태 보고 v2가 없다 — 탭 없이 열면 대상을 찾지 못한다', async () => {
    handler = vehicleHandler();
    mount('/fleet/vehicles/KMH-GN7-0001', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    await screen.findByRole('table', { name: /고속도로 주행 보조 2 — 6축 상태/ });
    expect(document.querySelector('[data-tour="vehicle-status-v2"]')).toBeNull();
  });
});

describe('차량별 적용 상태 — 판정 탭', () => {
  it('판정 보고가 없는 Feature는 빈 상자가 아니라 판정 미확인 행으로 — 핵심 메시지도 미확인', async () => {
    handler = vehicleHandler({ verdicts: { vin: 'KMH-NX4-0002', now: new Date().toISOString(), items: [], combos: [], unreported: [{ featureId: 'FEAT-00022', featureName: '전방 안전거리 3단계', staleAfterMs: 1_800_000 }] } });
    mount('/fleet/vehicles/KMH-NX4-0002?tab=verdicts', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    const table = await screen.findByRole('table', { name: /전방 안전거리 3단계 — 행위별 판정/ });
    expect(table.querySelector('[data-verdict="UNREPORTED"] [data-unknown="UNCONFIRMED"]')).toBeTruthy();
    await waitFor(() => expect(key().textContent).toBe('판정 미확인 기능 1개 — 차량 판정 보고 이력 없음'));
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
  });

  it('차량이 보고한 판정 — 플랫폼 허가가 아님, 행위별 허용·거부·판단 불가와 한국어 사유·보조 코드, 기준 시간 넘긴 행은 미확인', async () => {
    handler = vehicleHandler();
    mount('/fleet/vehicles/KMH-GN7-0001?tab=verdicts', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    const table = await screen.findByRole('table', { name: /행위별 판정/ });
    await waitFor(() => expect(key().textContent).toBe('활성화 거부 — 현재 운행 조건 밖, 차량 보고 2분 전'));
    expect(screen.getByText('차량이 보고한 판정 — 플랫폼 허가가 아닙니다')).toBeTruthy();
    expect(screen.getByText('예시 판정 — 차량 연결 전')).toBeTruthy();
    expect(within(table).getAllByText('가상 데이터')).toHaveLength(4);
    const row = (a: string) => table.querySelector(`[data-action="${a}"]`)!;
    expect(row('ACTIVATE').textContent).toContain('현재 운행 조건 밖');
    expect(row('ACTIVATE').querySelector('code')!.textContent).toBe('ODD_OUT');
    expect(row('REACTIVATE').querySelector('[data-unknown="UNDECIDABLE"]')).toBeTruthy();
    expect(row('MRC').getAttribute('data-verdict')).toBe('UNCONFIRMED');
    expect(row('MRC').querySelector('[data-unknown="UNCONFIRMED"]')).toBeTruthy();
    expect(row('MRC').querySelector('.ads-verdict')).toBeNull(); // 과거 허용을 현재 판정으로 그리지 않는다
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['활성화', '설치', '재활성화', 'MRC']);
    expect(screen.getByText('복구 검증 완료 · 종료 차단 해제 · 현재 활성화 불가')).toBeTruthy();
  });
});

describe('차량별 적용 상태 — 고객에게 보이는 상태', () => {
  it('오프라인이면 4질문 대신 한 줄, 원격 종료 대상은 제한 문구, 운영자용 필드는 미리보기 테두리 밖 · 뒤 단계는 해당 정보 없음', async () => {
    handler = vehicleHandler();
    mount('/fleet/vehicles/KMH-GN7-0001?tab=customer', '/fleet/vehicles/:vin', <VehicleRuntimeScreen />);
    await screen.findAllByText('미리보기');
    await waitFor(() => expect(key().textContent).toBe('고객 화면: 오프라인 — 마지막 확인 11-06 07:42, 현재 상태 미확인'));
    const previews = document.querySelectorAll('[data-customer-preview]');
    expect(previews).toHaveLength(2);
    expect(previews[0].querySelector('[data-unconfirmed-line]')!.textContent).toBe('오프라인 — 마지막 확인 11-06 07:42, 현재 상태 미확인');
    expect(previews[0].querySelectorAll('[data-q]')).toHaveLength(0); // 이전 답을 현재처럼 보이지 않는다
    expect(previews[0].textContent).not.toContain('지금 사용할 수 있습니다');
    const q = (k: string) => previews[1].querySelector(`[data-q="${k}"]`)!;
    expect(q('canUse').textContent).toContain('안전 점검으로 지금은 사용이 제한됩니다');
    expect(q('canUse').textContent).toContain('대체 이용');
    expect(q('when').textContent).toContain('차량 확인 뒤 알려 드립니다');
    expect(q('support').textContent).toContain('지원 경로 안내만');
    const op = document.querySelectorAll('[data-operator-only]');
    expect(op).toHaveLength(2);
    expect(op[0].closest('[data-customer-preview]')).toBeNull();
    expect(op[0].textContent).toContain('운영자만 보임');
    expect(op[0].textContent).toContain('해당 정보 없음 · 갱신·해지 연동 전');
    expect(op[0].textContent).toContain('해당 정보 없음 · 국가 이동 연동 전');
    expect(within(op[1] as HTMLElement).getByRole('link', { name: 'KILL-00001' })).toBeTruthy();
  });
});

const CONV: ConvergenceView = {
  publicationId: 'PUB-00006',
  kind: 'KILL',
  featureId: 'FEAT-00029',
  featureName: '급가속 억제',
  flagKey: null,
  status: 'DISPATCHED',
  total: 8,
  staleAfterMs: 30 * 60_000,
  assumed: true,
  bins: { APPLIED: 1, ACCEPTED: 1, DEFERRED: 1, RECEIVED_ONLY: 1, NOT_RECEIVED: 1, REJECTED: 1, UNCONFIRMED: 2 },
  notApplied: 7,
  cumulative: { received: 7, accepted: 2 },
  vehicles: [
    { vin: 'V1', bin: 'APPLIED', lastStage: 'APPLIED', at: ago(45), reasonCode: null },
    { vin: 'V2', bin: 'ACCEPTED', lastStage: 'ACCEPTED', at: ago(5), reasonCode: null },
    { vin: 'V3', bin: 'DEFERRED', lastStage: 'DEFERRED', at: ago(5), reasonCode: 'DDT_ACTIVE' },
    { vin: 'V4', bin: 'RECEIVED_ONLY', lastStage: 'RECEIVED', at: ago(5), reasonCode: null },
    { vin: 'V5', bin: 'NOT_RECEIVED', lastStage: null, at: null, reasonCode: null },
    { vin: 'V6', bin: 'REJECTED', lastStage: 'REJECTED', at: ago(5), reasonCode: 'SIGNATURE_INVALID' },
    { vin: 'V7', bin: 'UNCONFIRMED', lastStage: 'RECEIVED', at: ago(50), reasonCode: null },
    { vin: 'V8', bin: 'UNCONFIRMED', lastStage: 'DEFERRED', at: ago(45), reasonCode: 'DDT_ACTIVE' },
  ],
};
const PUB_DETAIL = {
  publication: { publicationId: 'PUB-00006', kind: 'KILL', status: 'DISPATCHED', confirmed: 1, denominator: 8, closedAt: null, channel: 'EMERGENCY', campaignId: null, createdBy: 'u', createdAt: ago(60), deadlineAt: ago(-60), ackOnly: [], nodes: [], payload: { publicationId: 'PUB-00006', sequence: 1, featureId: 'FEAT-00029', featureVersion: '1.0.0', flagKey: null, targets: [], desired: 'x', policy: null, kill: { killId: 'KILL-00001', safeMode: 'SAFE_DEFAULT' } }, signature: { keyId: 'KEY-0001', alg: 'Ed25519', payloadHash: 'h', signature: 's' } },
  verification: { valid: true, reason: 'SIGNATURE_VALID' },
  readbacks: [],
  calls: [],
};

describe('배포 상세 — 수렴 7구간', () => {
  it('핵심 값은 적용 확인 안 된 차량 N대 — 대상 M대 중, 배타 7구간 합 = 대상, 누적은 보조 줄, 구간 거르기는 분절 필터(탭 아님)', async () => {
    handler = (url) => (url.startsWith('/api/publications/PUB-00006/convergence') ? { body: CONV } : url.startsWith('/api/publications/PUB-00006') ? { body: PUB_DETAIL } : undefined);
    mount('/deployments/PUB-00006', '/deployments/:id', <DeploymentDetail />);
    const fig = await screen.findByRole('figure', { name: /차량별 적용 단계/ });
    expect(key().textContent).toBe('7적용 확인 안 된 차량 7대 — 대상 8대 중');
    // 긴급 차단 게시본이면 H1 '긴급 차단 게시본 · 기능 이름', 게시본 상태는 meta 배지 글자(핵심 값 아님)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('긴급 차단 게시본 · 급가속 억제');
    expect(key().textContent).not.toContain('DISPATCHED');
    const segs = [...fig.querySelectorAll('[data-segment]')];
    expect(segs.map((s) => s.getAttribute('data-segment'))).toEqual(['APPLIED', 'ACCEPTED', 'DEFERRED', 'RECEIVED_ONLY', 'NOT_RECEIVED', 'REJECTED', 'UNCONFIRMED']);
    expect(segs.reduce((a, s) => a + Number(s.getAttribute('data-count')), 0)).toBe(8);
    expect(fig.textContent).toContain('누적: 수신 7 · 수락 2');
    expect(fig.querySelector('[data-segment="DEFERRED"]')!.textContent).toContain('자동 주행 수행 중');
    // 분절 필터 — 탭이 아니라 radiogroup, 미수신과 로컬 거부는 다른 차량
    const filter = screen.getByRole('radiogroup', { name: '구간 거르기' });
    expect(screen.queryByRole('tab', { name: /미수신/ })).toBeNull();
    fireEvent.click(within(filter).getByRole('radio', { name: /미수신/ }));
    const vt = screen.getByRole('table', { name: '구간별 차량' });
    expect(within(vt).getAllByRole('link').map((a) => a.textContent)).toEqual(['V5']);
    fireEvent.click(within(filter).getByRole('radio', { name: /로컬 거부/ }));
    expect(within(vt).getAllByRole('link').map((a) => a.textContent)).toEqual(['V6']);
    // 기준 시간 넘긴 전달 보류는 미확인 — 마지막 보고 회색 보조 글자
    fireEvent.click(within(filter).getByRole('radio', { name: /^미확인/ }));
    expect(within(vt).getAllByRole('link').map((a) => a.textContent)).toEqual(['V7', 'V8']);
    expect(vt.textContent).toMatch(/마지막 보고: 전달 보류 · 자동 주행 수행 중 · 45분 전/);
  });
});

const FLEET_AX: FleetAxisView = {
  now: new Date().toISOString(),
  features: [
    { featureId: 'FEAT-00004', version: '4.1.0', name: '고속도로 주행 보조 2', featureClass: 'ADS', total: 14, unconfirmedRuntime: 14 },
    { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', featureClass: 'ADAS', total: 6, unconfirmedRuntime: 3 },
  ],
  defaultFeatureId: 'FEAT-00004',
  selected: {
    featureId: 'FEAT-00004',
    version: '4.1.0',
    name: '고속도로 자율주행',
    featureClass: 'ADS',
    total: 14,
    staleAfterMs: MIN15,
    assumed: true,
    axes: { ENTITLEMENT: { PURCHASED: 14 }, INSTALL: { COMPATIBLE: 14 }, DELIVERY: { NONE: 14 }, ELIGIBILITY: { UNCONFIRMED: 12, UNKNOWN: 2 }, RUNTIME: { UNCONFIRMED: 14 }, FRESHNESS: { DELAYED: 14 } },
    unconfirmedRuntime: 14,
    reasons: [
      { key: 'UNCONFIRMED', code: null, verdict: 'NONE', count: 12 },
      { key: 'UNKNOWN:ODD_UNKNOWN', code: 'ODD_UNKNOWN', verdict: 'UNKNOWN', count: 2 },
    ],
  },
};

describe('Fleet 실시간 — Feature별 6축 분포', () => {
  it('기본 탭은 6축 분포(Feature 선택), 핵심 메시지는 실제 상태 미확인 차량, 판단 불가는 허용과 따로, 행렬은 정책 값 대조 탭', async () => {
    const urls: string[] = [];
    handler = (url) => {
      urls.push(url);
      if (url.startsWith('/api/fleet/axis-distribution')) return { body: FLEET_AX };
      if (url.startsWith('/api/fleet/runtime')) return { body: { gleo: 'internal', items: [] } };
      if (url.startsWith('/api/publications')) return { body: { items: [] } };
      if (url.startsWith('/api/kill-requests')) return { body: { items: [] } };
    };
    mount('/fleet/live', '/fleet/live', <FleetLive />);
    await screen.findByRole('figure', { name: /실제 실행 — 차량 14대/ });
    expect(key().textContent).toBe('14실제 상태 미확인 차량 14대 — 고속도로 자율주행, 기준 15분 넘음');
    expect(screen.getByRole('tab', { name: '정책 값 대조' })).toBeTruthy();
    expect(screen.getAllByRole('figure').length).toBe(7); // 6축 + 활성화 판정 사유
    const elig = screen.getByRole('figure', { name: /활성 적격 — 차량 14대/ });
    expect(elig.querySelector('[data-segment="ALLOW"]')).toBeNull();
    expect(elig.querySelector('[data-segment="UNKNOWN"]')!.textContent).toContain('판단 불가');
    const reasons = screen.getByRole('figure', { name: /활성화 판정 사유/ });
    expect(reasons.querySelector('[data-segment="UNKNOWN:ODD_UNKNOWN"]')!.textContent).toContain('운행 조건 판단 불가');
    // Feature를 고르면 featureId 질의로 다시 읽는다
    fireEvent.change(screen.getByLabelText('Feature 선택'), { target: { value: 'FEAT-00022' } });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/fleet/axis-distribution?featureId=FEAT-00022'))).toBe(true));
  });
});

const ST = (state: 'CONFIRMED' | 'FAILED' | 'UNCONFIRMED', at: string | null, key: 'ORDER' | 'ENTITLEMENT' | 'POLICY' | 'READY' | 'USAGE') => ({ key, at, state, optional: key === 'USAGE' });
const ROW = (orderId: string, bin: OrdersView['items'][number]['bin'], over: Partial<OrdersView['items'][number]> = {}): OrdersView['items'][number] => ({
  orderId,
  vin: 'ego-01',
  catalogId: 'CAT-00019',
  catalogName: 'Beginner Care Pass 1회 체험',
  featureId: 'FEAT-00022',
  entitlementId: null,
  status: bin === 'CANCELLED' ? 'CANCELLED' : bin === 'REFUNDED' ? 'REFUNDED' : 'PAID',
  paidAt: ago(1800),
  bin,
  overdue: false,
  overdueMs: 0,
  deadlineAt: ago(360),
  justPaid: false,
  preOrderReport: false,
  conditions: { entitlement: 'CONFIRMED', config: 'CONFIRMED', policyApplied: 'CONFIRMED', vehicleReady: bin === 'READY' ? 'CONFIRMED' : 'UNCONFIRMED' },
  stages: [ST('CONFIRMED', ago(1800), 'ORDER'), ST('CONFIRMED', ago(1799), 'ENTITLEMENT'), ST('CONFIRMED', ago(1790), 'POLICY'), ST(bin === 'READY' ? 'CONFIRMED' : 'UNCONFIRMED', bin === 'READY' ? ago(1780) : null, 'READY'), ST('UNCONFIRMED', null, 'USAGE')],
  refund: null,
  simulated: true,
  ...over,
});
const ORDERS: OrdersView = {
  now: new Date().toISOString(),
  deadlineMs: 24 * 3600_000,
  assumed: true,
  total: 7,
  counts: { READY: 2, UNCONFIRMED: 2, OFFLINE: 1, PARTIAL: 0, CANCELLED: 1, REFUNDED: 1 },
  overdueUnready: 2,
  overdueBreakdown: { UNCONFIRMED: 1, OFFLINE: 1, PARTIAL: 0 },
  simulated: true,
  items: [
    ROW('ORDER-0001', 'READY'),
    ROW('ORDER-0002', 'READY'),
    ROW('ORDER-0003', 'UNCONFIRMED', { paidAt: ago(10), justPaid: true }),
    ROW('ORDER-0005', 'UNCONFIRMED', { overdue: true, overdueMs: 2 * 3600_000, preOrderReport: true }),
    ROW('ORDER-0004', 'OFFLINE', { overdue: true, overdueMs: 16 * 3600_000 }),
    ROW('ORDER-0011', 'CANCELLED'),
    ROW('ORDER-0012', 'REFUNDED', { refund: { requestedAt: ago(3000), completedAt: ago(120) } }),
  ],
};

describe('사용 권한 — 주문 추적 탭', () => {
  it('핵심 값은 기한 넘긴 사용 준비 미확인 주문 N건, 배타 6구간 합 = 주문 수, 확인율(%) 대신 건수·분모, 결제 직후는 주문 성공 · 활성 미확인', async () => {
    handler = (url) => {
      const p = new URL(url, 'http://t').pathname;
      if (p === '/api/orders') return { body: ORDERS };
      if (p === '/api/orders/ORDER-0005/timeline') return { body: { order: ORDERS.items[3], events: [{ key: 'ready', kind: 'READY_REPORT', vehicleAt: ago(1900), serverAt: null, detail: 'OK', preOrder: true, warn: true }, { key: 'paid', kind: 'PAID', vehicleAt: null, serverAt: ago(1800), detail: 'ORDER-0005', preOrder: false, warn: false }] } };
      if (p === '/api/products') return { body: { items: [] } };
      if (p === '/api/entitlements') return { body: { items: [] } };
    };
    mount('/entitlements?tab=orders', '/entitlements', <EntitlementsScreen />);
    const fig = await screen.findByRole('figure', { name: /주문 구간/ });
    expect(key().textContent).toBe('2기한 넘긴 사용 준비 미확인 주문 2건 — 결제 후 24시간(가정값) 기준');
    const segs = [...fig.querySelectorAll('[data-segment]')];
    expect(segs.map((s) => s.getAttribute('data-segment'))).toEqual(['READY', 'UNCONFIRMED', 'OFFLINE', 'PARTIAL', 'CANCELLED', 'REFUNDED']);
    expect(segs.reduce((a, s) => a + Number(s.getAttribute('data-count')), 0)).toBe(7);
    const summary = document.querySelector('.ds-summary')!;
    expect(summary.textContent).toContain('2건 / 주문 7건');
    expect(summary.textContent).not.toMatch(/%/);
    expect(screen.getByText('확인율은 지표 계약 뒤 표시')).toBeTruthy();
    expect(screen.getByText('개념 시연 — 가상 데이터')).toBeTruthy();
    expect(screen.getByText('주문 성공 · 활성 미확인')).toBeTruthy();
    expect(screen.getByText('주문 전 보고 — 준비로 세지 않음')).toBeTruthy();
    expect(screen.getByText('기한 초과 16시간')).toBeTruthy();
    expect(document.body.textContent).not.toContain('사용 준비 완료');
    // 환불 경과는 환불 행에만, 막힌 행동은 글자 사유
    expect(screen.getByText('요청 → 완료 48시간')).toBeTruthy();
    expect(screen.getByText(/결제 연동이 모의 단계라 실제 환불은 실행하지 않습니다/)).toBeTruthy();
    // 실사용 확인(선택)은 점선 칸
    expect(document.querySelectorAll('.adss-strip li[data-optional]')).toHaveLength(7);
    // 행을 열면 단계 기록(차량 시각·서버 시각 분리, 주문 전 보고 경고)
    fireEvent.click(screen.getByText('ORDER-0005'));
    const tl = await screen.findByRole('table', { name: 'ORDER-0005 단계 기록' });
    expect(within(tl).getAllByText('주문 전 보고 — 준비로 세지 않음').length).toBe(1);
    cleanup();
    // 다른 탭에서는 이 핵심 메시지를 쓰지 않는다(P-10)
    mount('/entitlements?tab=grants', '/entitlements', <EntitlementsScreen />);
    await waitFor(() => expect(key().textContent).not.toContain('기한 넘긴'));
  });
});
