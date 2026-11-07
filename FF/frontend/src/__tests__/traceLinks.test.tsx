// Feature 관계·추적 연결 화면(P3) — Topology 관계 유형 필터·표시, Feature 상세 '추적 연결' 탭(커버리지·종류별 목록·등록·해제·Evidence),
// 추적 커버리지 화면(요구 미연결·필수 Evidence 미등록), 변경 영향의 정책·차량·OTA. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import TraceLinksTab from '../screens/features/TraceLinksTab';
import TraceCoverageScreen from '../screens/master/TraceCoverage';
import ImpactScreen from '../screens/governance/Impact';
import { applyFilters, buildModel, NO_FILTERS, type DepRow, type FeatureRow } from '../screens/master/topology/model';
import { traceCopy } from '../copy/trace-links';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, route: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={route} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const link = (o: Record<string, unknown>) => ({
  featureId: 'FEAT-00022', elementName: null, elementVersion: null, required: null, existence: 'VERIFIED', sourceRef: null, status: 'ACTIVE',
  linkedBy: 'usr-author', linkedAt: '2026-11-01T00:00:00Z', unlinkedBy: null, unlinkedAt: null, unlinkReason: null, ...o,
});
const groups = (counts: Partial<Record<string, number>>) =>
  Object.fromEntries(['REQUIREMENT', 'ARCHITECTURE', 'INTERFACE', 'TEST_CASE', 'OTA'].map((k) => [k, { count: counts[k] ?? 0, byType: {}, bySource: {} }]));
const summary = {
  feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', lifecycle: 'RELEASED', ownerId: 'ADAS상품기획팀' },
  links: [
    link({ linkId: 'TRL-00001', kind: 'REQUIREMENT', elementId: 'REQ-CARE-2301', elementType: 'SYSTEM', sourceSystem: 'CODEBEAMER', existence: 'NOT_CHECKED' }),
    link({ linkId: 'TRL-00002', kind: 'REQUIREMENT', elementId: 'REQ-OLD-1', elementType: 'SYSTEM', sourceSystem: 'CODEBEAMER', status: 'UNLINKED', unlinkedBy: 'usr-author', unlinkedAt: '2026-11-02T00:00:00Z', unlinkReason: '요구 폐기' }),
    link({ linkId: 'TRL-00003', kind: 'TEST_CASE', elementId: 'TC-00022-01', elementType: 'FUNCTIONAL', sourceSystem: 'TMS', required: true, test: { hasEvidence: true, evidenceCount: 1, latestResult: 'PASS', latestAt: '2026-11-03T00:00:00Z', latestEvidenceId: 'EV-1' } }),
    link({ linkId: 'TRL-00004', kind: 'TEST_CASE', elementId: 'TC-00022-02', elementType: 'REGRESSION', sourceSystem: 'TMS', required: true, test: { hasEvidence: false, evidenceCount: 0, latestResult: null, latestAt: null, latestEvidenceId: null } }),
  ],
  groups: groups({ REQUIREMENT: 1, TEST_CASE: 2 }),
  requirements: [
    { reqId: 'REQ-CARE-2301', type: 'SYSTEM', linked: true },
    { reqId: 'REQ-CARE-2301-SW1', type: 'SW', linked: false },
  ],
  evidence: [],
  coverage: {
    requirement: { total: 2, linked: 1, covered: 1, ratio: 0.5, unlinked: ['REQ-CARE-2301-SW1'] },
    test: { required: 2, withEvidence: 1, ratio: 0.5, missing: ['TC-00022-02'], failing: [] },
    hasRequirementLink: true,
    missingRequiredEvidence: true,
  },
};

describe('Topology — 관계 유형 필터(FR-DEP-004-002)', () => {
  const feat = (id: string): FeatureRow => ({ featureId: id, version: '1.0.0', name: id, lifecycle: 'RELEASED', tags: [], domain: 'AD' });
  const edge = (id: string, s: string, t: string, type: DepRow['type']): DepRow => ({ dependencyId: id, type, sourceFeatureId: s, sourceVersion: '1.0.0', targetFeatureId: t, targetVersion: '1.0.0', verdict: 'PASS', rationale: null });
  it('고른 관계 유형만 남기고, 새 유형(상위·구성)도 그래프 간선이 된다', () => {
    const m = buildModel([feat('FEAT-00001'), feat('FEAT-00002'), feat('FEAT-00003')], [edge('DEP-00001', 'FEAT-00001', 'FEAT-00002', 'REQUIRES'), edge('DEP-00002', 'FEAT-00001', 'FEAT-00003', 'PARENT_OF'), edge('DEP-00003', 'FEAT-00002', 'FEAT-00003', 'COMPOSED_OF')]);
    expect(applyFilters(m, NO_FILTERS).edges).toHaveLength(3);
    const only = applyFilters(m, { ...NO_FILTERS, types: new Set(['PARENT_OF', 'COMPOSED_OF']) });
    expect(only.edges.map((e) => e.type).sort()).toEqual(['COMPOSED_OF', 'PARENT_OF']);
  });
});

describe("Feature 상세 '추적 연결' 탭", () => {
  beforeEach(() => {
    handler = (url, init) => {
      if (url.includes('/api/features/FEAT-00022/trace-links')) return { body: summary };
      if (url.includes('/api/trace-links') && init?.method === 'POST' && url.endsWith('/unlink')) return { status: 201, body: { ...summary.links[0], status: 'UNLINKED' } };
      if (url.includes('/api/trace-links') && init?.method === 'POST' && url.endsWith('/evidence')) return { status: 201, body: { recordId: 'TEV-00009' } };
      if (url.endsWith('/api/trace-links') && init?.method === 'POST') return { status: 201, body: link({ linkId: 'TRL-00009', kind: 'REQUIREMENT', elementId: 'REQ-CARE-2301-SW1', elementType: 'SW', sourceSystem: 'ALM' }) };
      return undefined;
    };
  });

  it('커버리지 요약·미등록 필수 Test Case를 보이고, 요구 목록에서 미연결 요구를 연결한다', async () => {
    mount('author', '/features/FEAT-00022', '/features/:id', <TraceLinksTab id="FEAT-00022" />);
    expect((await screen.findAllByText(/1\/2 \(50%\)/)).length).toBe(2);
    expect(screen.getByText(traceCopy.key.missing('TC-00022-02'))).toBeTruthy();
    // 해제한 요구는 기본으로 숨기고, 이력 포함을 켜면 사유와 함께 보인다
    expect(screen.queryByText('REQ-OLD-1')).toBeNull();
    fireEvent.click(screen.getByLabelText(traceCopy.filter.history));
    expect(await screen.findByText('REQ-OLD-1')).toBeTruthy();
    expect(screen.getByText(/요구 폐기/)).toBeTruthy();
    // ALM 요구 목록의 미연결 요구 → 등록 칸을 채우고 연결
    const list = screen.getByRole('table', { name: traceCopy.reqList.title });
    fireEvent.click(within(list).getByRole('button', { name: traceCopy.reqList.link }));
    fireEvent.click(screen.getByRole('button', { name: traceCopy.form.submit }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/trace-links'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/trace-links'))!;
    expect(post.body).toMatchObject({ featureId: 'FEAT-00022', kind: 'REQUIREMENT', elementId: 'REQ-CARE-2301-SW1', elementType: 'SW', required: null });
  });

  it('검증 종류는 필수·Evidence 여부·최종 결과 열을 보이고, Gate 판정자는 Evidence를 등록한다', async () => {
    mount('quality', '/features/FEAT-00022', '/features/:id', <TraceLinksTab id="FEAT-00022" />);
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(traceCopy.kind.TEST_CASE.replace(/[()]/g, '\\$&')) }));
    const table = await screen.findByRole('table', { name: traceCopy.kind.TEST_CASE });
    expect(within(table).getByText('TC-00022-02')).toBeTruthy();
    expect(within(table).getByText(traceCopy.noEvidence)).toBeTruthy();
    const row = within(table).getByText('TC-00022-02').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: traceCopy.evidence.action }));
    fireEvent.change(within(row).getByLabelText(traceCopy.evidence.evidenceId), { target: { value: 'EV-REG-22-1' } });
    fireEvent.change(within(row).getByLabelText(traceCopy.evidence.environment), { target: { value: 'HIL 벤치 2' } });
    fireEvent.click(within(row).getByRole('button', { name: traceCopy.evidence.submit }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/trace-links/TRL-00004/evidence'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/evidence'))!.body).toMatchObject({ evidenceId: 'EV-REG-22-1', result: 'PASS', environment: 'HIL 벤치 2' });
  });
});

describe('추적 커버리지 화면', () => {
  const item = (featureId: string, hasReq: boolean, missing: string[]) => ({
    featureId, version: '1.0.0', name: featureId, lifecycle: 'RELEASED', ownerId: 'x', asil: 'B',
    requirement: { total: 2, linked: hasReq ? 2 : 0, covered: hasReq ? 2 : 0, ratio: hasReq ? 1 : 0, unlinked: [] },
    test: { required: 2, withEvidence: 2 - missing.length, ratio: (2 - missing.length) / 2, missing, failing: [] },
    hasRequirementLink: hasReq, missingRequiredEvidence: missing.length > 0,
  });
  beforeEach(() => {
    handler = (url) => {
      if (!url.includes('/api/trace-coverage')) return undefined;
      const items = [item('FEAT-00003', false, []), item('FEAT-00031', true, ['TC-00031-02'])];
      const f = new URL(url, 'http://x').searchParams.get('filter');
      return { body: { summary: { features: 2, noRequirement: 1, missingEvidence: 1, requirementRatio: 0.5, testRatio: 0.75 }, filter: f, items: f === 'noRequirement' ? [items[0]] : f === 'missingEvidence' ? [items[1]] : items } };
    };
  });
  it('핵심 메시지에 미연결·미등록 수, 필터를 바꾸면 그 Feature만', async () => {
    mount('viewer', '/trace/coverage', '/trace/coverage', <TraceCoverageScreen />);
    expect(await screen.findByText(traceCopy.coverage.key(1, 1))).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(traceCopy.coverage.seg.missingEvidence) }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('filter=missingEvidence'))).toBe(true));
    expect(await screen.findByText('TC-00031-02')).toBeTruthy();
  });
});

describe('변경 영향 — 정책·차량·OTA(FR-DEP-003-001)', () => {
  it('영향 결과의 정책·범위 차량·OTA 패키지를 보인다', async () => {
    handler = (url) => {
      if (url.includes('/api/impact/')) {
        return {
          body: {
            feature: { featureId: 'FEAT-00145', version: '5.4.2', name: '스마트 크루즈', lifecycle: 'RELEASED', baselineId: 'BL-1', ownerId: 'x' },
            forward: [], dependents: [{ dependencyId: 'DEP-00013', featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리', lifecycle: 'RELEASED', depth: 1, path: [] }], excludes: [], baselines: [], products: [], rejudge: [], owners: ['x'],
            policies: [{ policyId: 'POL-00001', featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_signal', status: 'DEPLOYED', enabled: true, direct: false, live: true }],
            vehicles: { total: 7, byScope: [{ scope: 'KR/NX4 PE/Premium', vehicles: 7 }], sample: ['VIN-1'] },
            ota: [{ linkId: 'TRL-1', featureId: 'FEAT-00022', packageId: 'sw-care-sdist-app-1.2.1.pkg', name: 'x', version: '1.2.1', direct: false }],
            summary: { dependents: 1, products: 0, releasedProducts: 0, rejudgeGates: 0, policies: 1, livePolicies: 1, vehicles: 7, otaPackages: 1 },
          },
        };
      }
      if (url.includes('/api/features')) return { body: { items: [{ featureId: 'FEAT-00145', version: '5.4.2', name: '스마트 크루즈', lifecycle: 'RELEASED', isLatest: true }], total: 1 } };
      return undefined;
    };
    mount('viewer', '/analysis/impact?feature=FEAT-00145&version=5.4.2', '/analysis/impact', <ImpactScreen />);
    expect(await screen.findByText('POL-00001')).toBeTruthy();
    expect(screen.getByText('sw-care-sdist-app-1.2.1.pkg')).toBeTruthy();
    expect(screen.getByText(traceCopy.impact.vehicleTotal(7))).toBeTruthy();
  });
});
