// 분류 계층 L0~L5·Feature 분류 경로·브랜드·권역별 정책·룰 지역 코드 후보(TX, B7 (b)) — 모의 API
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import TaxonomyLevelsScreen from '../screens/master/TaxonomyLevels';
import TaxonomyTab from '../screens/features/TaxonomyTab';
import GlobalScopeScreen from '../screens/policy/GlobalScope';
import { RegionCandidates } from '../screens/master/RegionCandidates';

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

const node = (nodeId: string, level: string, parentId: string | null, name: string, source = 'PLATFORM') => ({ nodeId, level, parentId, name, description: null, source, status: 'ACTIVE', createdBy: 'seed', createdAt: '2026-11-07T00:00:00Z', updatedBy: null, updatedAt: null });
const BC = node('BC', 'L0', null, 'Body & Comfort', 'FEATURE_DB');
const CL = node('BC:Access', 'L1', 'BC', 'Access', 'FEATURE_DB');
const L2 = node('BC-BCM-001', 'L2', 'BC:Access', '원격 도어 잠금');
const L3 = node('BC-BCM-001.SW1', 'L3', 'BC-BCM-001', 'SW-BDC 1.0.0');
const levels = {
  items: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].map((level, i) => ({ level, label: level, nodes: 6 - i, classifiedNodes: 1, features: i < 3 ? 2 : 1 })),
  placements: 2,
};

describe('분류 계층 화면 @req FR-CAT-001-001 FR-CAT-004-005', () => {
  beforeEach(() => {
    handler = (url) => {
      if (url.includes('/api/taxonomy/levels/L2')) return { body: { level: 'L2', items: [{ node: L2, path: [BC, CL, L2], features: [{ featureId: 'FEAT-00001', version: '1.0.0', name: '원격 도어', lifecycle: 'RELEASED' }] }] } };
      if (url.includes('/api/taxonomy/levels/L3')) return { body: { level: 'L3', items: [{ node: L3, path: [BC, CL, L2, L3], features: [{ featureId: 'FEAT-00001', version: '1.0.0', name: '원격 도어', lifecycle: 'RELEASED' }] }] } };
      if (url.includes('/api/taxonomy/levels')) return { body: levels };
      if (url.includes('/api/taxonomy/nodes')) return { body: { total: 4, items: [], tree: [{ ...BC, childCount: 1, featureCount: 0, children: [{ ...CL, childCount: 1, featureCount: 0, children: [{ ...L2, childCount: 0, featureCount: 2, children: [] }] }] }] } };
      return undefined;
    };
  });

  it('수준별 분류 — 기본 L2, 수준을 바꾸면 그 수준 노드의 경로와 Feature', async () => {
    mount('author', '/master/taxonomy/levels', '/master/taxonomy/levels', <TaxonomyLevelsScreen />);
    expect(await screen.findByText('원격 도어 잠금')).toBeTruthy();
    expect(screen.getByText('Body & Comfort › Access')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /L3 소프트웨어 기능/ }));
    expect(await screen.findByText('SW-BDC 1.0.0')).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/api/taxonomy/levels/L3'))).toBe(true);
  });

  it('계층 트리 — 도메인부터 펼친다', async () => {
    mount('author', '/master/taxonomy/levels?tab=tree', '/master/taxonomy/levels', <TaxonomyLevelsScreen />);
    const tree = await screen.findByRole('tree');
    expect(within(tree).getByText('Body & Comfort')).toBeTruthy();
    expect(within(tree).queryByText('원격 도어 잠금')).toBeNull();
    fireEvent.click(within(tree).getByRole('button', { name: /펼치기 Body/ }));
    fireEvent.click(within(tree).getByRole('button', { name: /펼치기 Access/ }));
    expect(within(tree).getByText('원격 도어 잠금')).toBeTruthy();
  });

  it('노드 등록 — Feature DB 관리자만, 본문은 수준·상위 그대로 @req FR-CAT-004-001', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: node('BC-NEW', 'L2', 'BC:Access', '새 노드') };
      if (url.includes('/api/taxonomy/nodes')) return { body: { total: 0, items: [], tree: [] } };
      return { body: levels };
    };
    mount('steward', '/master/taxonomy/levels?tab=manage', '/master/taxonomy/levels', <TaxonomyLevelsScreen />);
    fireEvent.change(await screen.findByRole('textbox', { name: /^Node ID/ }), { target: { value: 'BC-NEW' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Node 명칭/ }), { target: { value: '새 노드' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^상위 Node ID/ }), { target: { value: 'BC:Access' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ nodeId: 'BC-NEW', level: 'L2', parentId: 'BC:Access' }));
    expect(await screen.findByText('BC-NEW을(를) 등록했습니다')).toBeTruthy();
  });
});

describe('Feature 분류 경로 탭 @req FR-CAT-004-009 FR-CAT-004-010', () => {
  it('L0부터 배치 노드·아래 구성, 같은 수준 노드로 옮긴다', async () => {
    handler = (url, init) => {
      if (init?.method === 'PUT') return { body: { featureId: 'FEAT-00001', nodeId: 'BC-BCM-002', placedBy: 'usr-author', placedAt: '2026-11-07T00:00:00Z' } };
      return {
        body: {
          featureId: 'FEAT-00001', version: '1.0.0', name: '원격 도어', taxonomyLevel: 'L2',
          placement: { featureId: 'FEAT-00001', nodeId: 'BC-BCM-001', placedBy: 'usr-author', placedAt: '2026-11-07T00:00:00Z' },
          path: [BC, CL, L2], below: [L3],
          candidates: [{ nodeId: 'BC-BCM-001', name: '원격 도어 잠금', path: 'Body › Access › 원격 도어 잠금' }, { nodeId: 'BC-BCM-002', name: '원격 창문', path: 'Body › Access › 원격 창문' }],
        },
      };
    };
    mount('author', '/features/FEAT-00001/1.0.0', '/features/:id/:ver', <TaxonomyTab id="FEAT-00001" />);
    const path = await screen.findByRole('list', { name: 'L0부터 배치 노드까지' });
    expect(within(path).getAllByRole('listitem')).toHaveLength(4);
    expect(within(path).getByText('SW-BDC 1.0.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다른 노드로 옮기기' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ nodeId: 'BC-BCM-002' }));
  });
});

describe('브랜드·권역별 정책 @req FR-GLB-001-001 FR-GLB-001-003 FR-GLB-001-004', () => {
  const scope = (policyId: string, brands: string[], regionCodes: string[]) => ({
    policyId, featureId: 'FEAT-00001', brands, regionCodes, complianceRuleIds: [], revision: 1, updatedBy: 'seed', updatedAt: '2026-11-07T00:00:00Z', reason: '시드',
    policy: { flagKey: `f_${policyId}`, status: 'DEPLOYED', featureVersion: '1.0.0', controlPoint: 'Flag' }, feature: { name: '원격 도어', ownerId: 'ADAS기획팀', country: 'KR' },
  });
  beforeEach(() => {
    handler = (url) => {
      if (url.includes('/api/brands/HYUNDAI/policies')) return { body: { brand: 'HYUNDAI', items: [scope('POL-00001', ['HYUNDAI'], ['1']), scope('POL-00002', ['HYUNDAI', 'KIA'], ['4'])] } };
      if (url.includes('/api/brands/KIA/policies')) return { body: { brand: 'KIA', items: [scope('POL-00002', ['HYUNDAI', 'KIA'], ['4'])] } };
      if (url.includes('/api/brands')) return { body: { items: [{ brand: 'HYUNDAI', label: '현대', policies: 2 }, { brand: 'KIA', label: '기아', policies: 1 }, { brand: 'GENESIS', label: '제네시스', policies: 0 }] } };
      if (url.includes('/api/global-scopes')) return { body: { total: 2, items: [] } };
      if (url.includes('/global-scope')) return { body: { policyId: 'POL-00002', ownerId: 'ADAS기획팀', scope: scope('POL-00002', ['HYUNDAI', 'KIA'], ['4']) } };
      return undefined;
    };
  });

  it('브랜드를 고르면 그 브랜드 정책, 지역 코드로 좁힌다', async () => {
    mount('author', '/policies/global-scope', '/policies/global-scope', <GlobalScopeScreen />);
    expect(await screen.findByText('POL-00001')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '적용 지역 코드' }), { target: { value: '4' } });
    expect(screen.queryByText('POL-00001')).toBeNull();
    expect(screen.getByText('POL-00002')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /기아/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/brands/KIA/policies'))).toBe(true));
  });

  it('Owner가 아니면 수정 버튼이 막히고 사유를 보인다', async () => {
    mount('author', '/policies/global-scope?tab=edit', '/policies/global-scope', <GlobalScopeScreen />);
    fireEvent.change(await screen.findByRole('textbox', { name: '정책 ID' }), { target: { value: 'POL-00002' } });
    fireEvent.click(screen.getByRole('button', { name: '불러오기' }));
    const btn = await screen.findByRole('button', { name: '수정' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Feature Owner\(ADAS기획팀\) 또는 시스템 관리자만/)).toBeTruthy();
  });
});

describe('룰 지역 코드 후보 @req FR-CRC-001-003', () => {
  it('코드마다 Variant 조건·상품 구성 후보를 읽는다', async () => {
    handler = (url) =>
      url.includes('codes=2')
        ? { body: { codes: ['2'], countries: [], variantConditions: [], compositions: [] } }
        : { body: { codes: ['1'], countries: ['KR'], variantConditions: [{ key: 'KR/NX4/P/', source: 'VARIANT_CONDITION', country: 'KR', vehicleModel: 'NX4', trim: 'P', upgVc: [], regionCodes: ['1'], featureIds: ['FEAT-00001'] }], compositions: [] } };
    mount('steward', '/x', '/x', <RegionCandidates codes={['1', '2']} />);
    expect(await screen.findByText('KR/NX4/P')).toBeTruthy();
    expect(await screen.findByText(/일반\(2\)은 국가를 정하지 않아/)).toBeTruthy();
    expect(calls.filter((c) => c.url.includes('/api/region-codes/variant-candidates')).length).toBe(2);
  });
});
