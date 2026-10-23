// 기준정보·추적 v2 화면 (P10-C4) — UPG-VC, SW·ECU, SW 구조, 제어점, Taxonomy, 요구·안전 추적, 품질 기준·Evidence, 변경요청. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ControlPointsScreen, StructureScreen, SwScreen, TaxonomyScreen, UpgScreen } from '../screens/master/MasterData';
import { ChangesScreen, DesignTraceScreen, EvidenceScreen } from '../screens/master/Trace';
import { TopologyScreen } from '../screens/master/Topology';

type Handler = (url: string) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
const calls: string[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const r = handler(url) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, routePath: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
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
};

describe('기준정보', () => {
  it('UPG-VC — 지원 Feature 링크와 Fleet 차량, 지원 Feature가 없으면 표시', async () => {
    handler = () => ({ body: { items: [{ upgVc: 'F111A114001', features: [{ featureId: 'FEAT-00022', version: '1.0.0', name: 'x' }], vehicles: ['ego-01'], models: ['KR/NX4 PE/Premium'] }, { upgVc: 'Z999', features: [], vehicles: ['v1'], models: [] }] } });
    mount('/master/upg', '/master/upg', <UpgScreen />);
    const row = (await screen.findByText('F111A114001')).closest('tr')!;
    expect(within(row).getByRole('link').getAttribute('href')).toBe('/features/FEAT-00022/1.0.0');
    expect(within(screen.getByText('Z999').closest('tr')!).getByText('지원 Feature 없음')).toBeTruthy();
  });

  it('SW·Artifact — 검색어로 다시 묻고, ECU 탭', async () => {
    handler = (url) =>
      url.startsWith('/api/master/sw')
        ? { body: { items: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.1', name: 'app', swType: 'App', ecuPno: '99211-NX400', ecuName: 'ADAS', supplier: 'Mutuus', safetyClass: 'B', securityClass: 'S2', lifecycle: 'RELEASED', artifactId: 'a', features: ['FEAT-00022@1.0.0'] }] } }
        : { body: { items: [{ ecuPno: '99211-NX400', name: 'ADAS', domain: 'ADAS', vehiclePlatform: 'NX4', hwRevision: 'A', osRuntime: 'AUTOSAR', network: 'CAN', supplier: 'x', asil: 'B', sw: ['SW-CARE-SDIST-APP@1.2.1'], features: 3 }] } };
    mount('/master/artifacts', '/master/artifacts', <SwScreen />);
    expect(await screen.findByText('SW-CARE-SDIST-APP')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '검색' }), { target: { value: 'care' } });
    await waitFor(() => expect(calls.some((c) => c === '/api/master/sw?q=care')).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'ECU' }));
    expect(await screen.findByText('SW-CARE-SDIST-APP@1.2.1')).toBeTruthy();
  });

  it('SW 구조 트리 — ECU → SW → Function → Feature', async () => {
    handler = () => ({ body: { items: [{ ecuPno: 'E1', name: 'ADAS', domain: 'ADAS', sw: [{ swId: 'S1', version: '1.0.0', name: 'app', functions: [{ functionId: 'FUNC-000056', name: 'gap', featureId: 'FEAT-00022', featureVersion: '1.0.0' }] }] }] } });
    mount('/master/structure', '/master/structure', <StructureScreen />);
    const tree = await screen.findByRole('list', { name: 'SW 구조' });
    expect(within(tree).getByText('FUNC-000056')).toBeTruthy();
  });

  it('제어점 — 정책 없는 제어점만 거르기', async () => {
    handler = () => ({ body: { items: [{ featureId: 'FEAT-00022', version: '1.0.0', name: 'a', lifecycle: 'RELEASED', controlPoints: ['Signal', 'Parameter'], policies: [{ policyId: 'POL-00001', flagKey: 'care_00022_signal', controlPoint: 'Signal', status: 'DEPLOYED' }], unbound: ['Parameter'], multiBound: [] }, { featureId: 'FEAT-00001', version: '2.2.0', name: 'b', lifecycle: 'RELEASED', controlPoints: [], policies: [], unbound: [], multiBound: [] }] } });
    mount('/master/control-points', '/master/control-points', <ControlPointsScreen />);
    await screen.findByText('a');
    expect(screen.getByText('b')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '정책 없는 제어점·중복 묶음만' }));
    expect(screen.queryByText('b')).toBeNull();
    expect(screen.getByRole('link', { name: 'Signal: care_00022_signal · DEPLOYED' }).getAttribute('href')).toBe('/policies/POL-00001');
  });

  it('Taxonomy — 태그·범위', async () => {
    handler = () => ({ body: { tags: [{ tag: 'adas', features: [{ featureId: 'FEAT-00022', version: '1.0.0', name: 'a' }] }], scopes: [{ scope: 'KR/NX4 PE', count: 12 }] } });
    mount('/master/taxonomy', '/master/taxonomy', <TaxonomyScreen />);
    expect(await screen.findByText('adas')).toBeTruthy();
    expect(screen.getByText('KR/NX4 PE')).toBeTruthy();
  });
});

describe('추적·Evidence·변경', () => {
  it('요구·안전 추적 — 선택한 Feature Version으로 묻고 요구·구현·Gate·안전 분류', async () => {
    handler = (url) =>
      url.startsWith('/api/features')
        ? { body: { items: [{ featureId: 'FEAT-00022', version: '1.0.0', name: '전방' }] } }
        : { body: { feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방', lifecycle: 'RELEASED', asil: 'B', scope: 'KR/NX4 PE/Premium' }, requirements: [{ reqId: 'REQ-CARE-2301' }], functions: [{ functionId: 'FUNC-000056', name: 'gap', swId: 'S1', swVersion: '1.2.1', ecuPno: 'E1', ecuName: 'ADAS' }], gates: [{ gate: 'G5', gateName: '검증', status: 'PASS', evidenceRef: 'EV-1', evidence: '시험 통과' }], safety: { fClass: 'F3', status: 'CONFIRMED', asilRef: 'B', haraRef: 'HARA-1', safetyGoalIds: ['SG-1'], safeState: 'BASE_ONLY' }, dependencies: [{ dependencyId: 'DEP-1', type: 'REQUIRES', target: 'FEAT-00145@1.0.0' }], baseline: 'BL-00028', policies: [] } };
    mount('/trace/design', '/trace/design', <DesignTraceScreen />);
    expect(await screen.findByText('REQ-CARE-2301')).toBeTruthy();
    expect(calls).toContain('/api/trace/FEAT-00022/1.0.0');
    expect(screen.getByText('S1@1.2.1')).toBeTruthy();
    expect(screen.getByText('시험 통과')).toBeTruthy();
    expect(screen.getByText('REQUIRES → FEAT-00145@1.0.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'BL-00028' }).getAttribute('href')).toBe('/baselines/BL-00028');
  });

  it('품질 기준·Evidence — Gate·판정으로 다시 묻는다', async () => {
    handler = () => ({ body: { items: [{ evidenceRef: 'EV-1', gate: 'G5', featureId: 'FEAT-00022', featureVersion: '1.0.0', featureName: '전방', owner: 'QA', inputResult: 'PASS', resultReason: '통과', gateStatus: 'PASS' }] } });
    mount('/verify/evidence', '/verify/evidence', <EvidenceScreen />);
    expect(await screen.findByText('EV-1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Gate'), { target: { value: 'G5' } });
    await waitFor(() => expect(calls.some((c) => c === '/api/evidence?gate=G5')).toBe(true));
  });

  it('변경요청 — Version 변경 사유 목록', async () => {
    // JIRA 변경요청 탭이 기본 — Version 변경 근거는 두 번째 탭(?tab=rationale)
    handler = (url) => (url.startsWith('/api/changes') ? { body: { items: [{ featureId: 'FEAT-00001', name: '주차', fromVersion: '2.1.0', toVersion: '2.2.0', toBaselineId: 'BL-00002', rationale: '센서 신뢰도 개선', fromDescription: 'a', toDescription: 'b', coreSw: '1.0 → 1.1', lifecycle: 'RELEASED' }] } } : { body: { items: [] } });
    mount('/change/cr?tab=rationale', '/change/cr', <ChangesScreen />);
    expect(await screen.findByText('센서 신뢰도 개선')).toBeTruthy();
    expect(screen.getByText('1.0 → 1.1')).toBeTruthy();
  });
});

describe('Topology·의존관계 검증', () => {
  it('KPI·관계 표·그래프(고른 Feature 가운데), 대상 Feature를 누르면 그래프 초점이 바뀐다', async () => {
    const DEPS = [
      { dependencyId: 'DEP-00001', type: 'REQUIRES', sourceFeatureId: 'FEAT-00022', sourceVersion: '1.0.0', targetFeatureId: 'FEAT-00145', targetVersion: null, verdict: 'PASS', rationale: '전제' },
      { dependencyId: 'DEP-00002', type: 'EXCLUDES', sourceFeatureId: 'FEAT-00022', sourceVersion: '1.0.0', targetFeatureId: 'FEAT-00025', targetVersion: null, verdict: '미판정', rationale: null },
    ];
    handler = (url) => {
      if (url.startsWith('/api/dependencies')) return { body: { items: DEPS } };
      if (url.startsWith('/api/topology/graph'))
        return {
          body: {
            nodes: [
              { id: 'FEAT-00022@1.0.0', featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리', lifecycle: 'RELEASED' },
              { id: 'FEAT-00145', featureId: 'FEAT-00145', version: null, name: '전제 기능', lifecycle: null },
            ],
            edges: [{ id: 'DEP-00001', source: 'FEAT-00022@1.0.0', target: 'FEAT-00145', type: 'REQUIRES', verdict: 'PASS' }],
          },
        };
      if (url.startsWith('/api/features')) return { body: { items: [{ featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리' }] } };
    };
    mount('/arch/topology', '/arch/topology', <TopologyScreen />);
    expect(await screen.findByText('DEP-00001')).toBeTruthy();
    // 핵심 메시지 = 미판정·FAIL 관계 수, 요약 줄 = 관계·REQUIRES·EXCLUDES(3초 테스트)
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('1');
    expect([...document.querySelectorAll('.ds-summary b')].map((k) => k.textContent)).toEqual(['2', '1', '1']);
    const g = await screen.findByRole('group', { name: '관계 그래프 — FEAT-00022' });
    expect(within(g).getByRole('link', { name: 'FEAT-00022@1.0.0 전방 안전거리' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'FEAT-00145' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/topology/graph?featureId=FEAT-00145'))).toBe(true));
  });

  // UX3-04(3초 테스트 S4): 핵심 메시지는 "N 미판정·FAIL 관계"인데 그래프 기본 선택은 초록 관계(FEAT-00022)였고, 실패로 가는 링크가 없었다.
  it('그래프 기본 초점 = 첫 FAIL(없으면 미판정) 관계, 핵심 메시지 행동으로 미판정·FAIL 목록을 연다', async () => {
    const DEPS = [
      { dependencyId: 'DEP-00001', type: 'REQUIRES', sourceFeatureId: 'FEAT-00022', sourceVersion: '1.0.0', targetFeatureId: 'FEAT-00145', targetVersion: null, verdict: 'PASS', rationale: '전제' },
      { dependencyId: 'DEP-00002', type: 'REQUIRES', sourceFeatureId: 'FEAT-00013', sourceVersion: '0.3.0', targetFeatureId: 'FEAT-00174', targetVersion: null, verdict: '미판정', rationale: null },
      { dependencyId: 'DEP-00003', type: 'EXCLUDES', sourceFeatureId: 'FEAT-00030', sourceVersion: '1.0.0', targetFeatureId: 'FEAT-00031', targetVersion: null, verdict: 'FAIL', rationale: '충돌' },
    ];
    handler = (url) => {
      if (url.startsWith('/api/dependencies')) return { body: { items: DEPS } };
      if (url.startsWith('/api/topology/graph'))
        return {
          body: {
            nodes: [
              { id: 'FEAT-00030@1.0.0', featureId: 'FEAT-00030', version: '1.0.0', name: '가', lifecycle: 'RELEASED' },
              { id: 'FEAT-00031', featureId: 'FEAT-00031', version: null, name: '나', lifecycle: null },
            ],
            edges: [{ id: 'DEP-00003', source: 'FEAT-00030@1.0.0', target: 'FEAT-00031', type: 'EXCLUDES', verdict: 'FAIL' }],
          },
        };
      if (url.startsWith('/api/features')) return { body: { items: [] } };
    };
    mount('/arch/topology', '/arch/topology', <TopologyScreen />);
    expect(await screen.findByText('DEP-00001')).toBeTruthy();
    const key = document.querySelector('[data-key-message]') as HTMLElement;
    expect(key.querySelector('.ds-key__value')?.textContent).toBe('2');
    expect(key.getAttribute('data-tone')).toBe('danger');
    // 관계를 받기 전에 FEAT-00022 그래프를 먼저 부르지 않는다 — 첫 FAIL 관계의 원천이 초점
    await screen.findByRole('group', { name: '관계 그래프 — FEAT-00030' });
    expect(calls.filter((c) => c.startsWith('/api/topology/graph')).every((c) => c.includes('featureId=FEAT-00030'))).toBe(true);
    expect(document.querySelector('.ds-topo-edge[data-selected]')?.getAttribute('data-verdict')).toBe('FAIL');
    fireEvent.click(within(key).getByRole('link', { name: '관계 목록에서 보기 →' }));
    await waitFor(() => expect(screen.queryByText('DEP-00001')).toBeNull());
    expect(screen.getByText('DEP-00002')).toBeTruthy();
    expect(screen.getByText('DEP-00003')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: '판정' }) as HTMLSelectElement).value).toBe('open');
  });
});
