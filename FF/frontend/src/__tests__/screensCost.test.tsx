// SW 개발비 산정 화면(20-94 §9) — 목록(핵심 메시지·금액 열은 산정 역할만), 상세 5탭(전이 버튼 이유·SOD-16),
// 검토 체크리스트 상태 바꾸기, 기능 목록, 계수 표 화면(표 내용은 산정 역할만). 조회에도 역할 머리글을 붙인다(personal). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { SwCostScreen } from '../screens/cost/CostList';
import { CostDetailScreen } from '../screens/cost/CostDetail';
import { CostBasisScreen } from '../screens/cost/CostBasis';
import { costBasis as B, costDetail as D, costLines as LN, swCost as L } from '../copy/cost';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: unknown; role: string | undefined }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, role: headers['X-Actor-Role'] });
      const r = handler(url, init) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, pattern: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={pattern} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const keyValue = () => document.querySelector('[data-key-message] .ds-key__value')?.textContent;

const LIST_FULL = {
  view: 'FULL',
  items: [
    { estId: 'EST-0002', name: 'BCM 파생', target: 'BCM', status: 'APPROVED', currency: 'KRW', basisVersion: 'v1.3', basisStale: false, featureCount: 3, totals: { totalMm: 23.4185, totalCost: 237_537_118.3 }, createdBy: 'usr-viewer', updatedAt: '2026-11-04T10:00:00Z' },
    { estId: 'EST-0001', name: 'BCM 신규', target: 'BCM', status: 'DRAFT', currency: 'KRW', basisVersion: 'v1.3', basisStale: false, featureCount: 10, totals: { totalMm: 124.75, totalCost: 1_227_670_384.5 }, createdBy: 'usr-viewer', updatedAt: '2026-11-04T09:00:00Z' },
  ],
};

const checks = Array.from({ length: 38 }, (_, i) => ({ no: i + 1, category: '범위', item: `항목 ${i + 1}`, method: '확인', source: '', purchaseKey: i < 12, status: '미확인', memo: '', updatedBy: null, updatedAt: null }));
const detail = (over: { view?: 'FULL' | 'MM_ONLY'; status?: string; createdBy?: string } = {}) => {
  const full = (over.view ?? 'FULL') === 'FULL';
  const line = { refId: 'BC-BCM-002', e: 2.71, laborKrw: 20_254_567.8, path: 'T-shirt', bundleIncluded: 0, check: '', prereqCheck: '' };
  return {
    view: over.view ?? 'FULL',
    ...(full ? { fx: 1 } : {}),
    project: { estId: 'EST-0001', name: 'BCM 신규', target: 'BCM / 신규 차종', currency: 'KRW', settings: { aace: 'Class 4', confidence: 'P80', preset: '직접 설정', drivers: { TIME: 'H' }, rateBasis: 'KOSA SW기술자 평균임금', method: '사용자 정의', ohOverride: 0.15, feeOverride: 0.1, common: { pm: true, scm: true, pi: true, qa: 0, fs: 0, cs: 0, hil: 0 }, directExpenses: [] }, basisVersion: 'v1.3', refRelease: 'v1.3', rev: 0, lastReason: null, status: over.status ?? 'DRAFT', createdBy: over.createdBy ?? 'usr-viewer', createdAt: '2026-11-04T09:00:00Z', updatedAt: '2026-11-04T09:00:00Z', latestBasisVersion: 'v1.3', latestRefRelease: 'v1.3' },
    lines: [{ lineNo: 1, featureId: 'FEAT-00187', version: '0.1.0', refId: 'BC-BCM-002', role: 'PRIMARY', featureAsil: 'QM', inputs: { qty: 1, changeType: '신규 개발' }, refStatus: 'ACTIVE', refKnown: true, ref: { nameKo: '실내등 제어', component: 'Body controller', tshirt: 'S', asilRep: 'QM' } }],
    features: [{ featureId: 'FEAT-00187', version: '0.1.0', name: 'BCM 바디 제어 기본 기능', asil: 'QM', lifecycle: 'PROPOSED' }],
    mbd: [],
    checks: { items: checks, rate: 0, open: 0, unchecked: 38 },
    result: {
      view: over.view ?? 'FULL',
      lines: [full ? line : { ...line, laborKrw: undefined }],
      counts: { selected: 44, bundleIncluded: 2, commonMissing: 4, notOwned: 0, checks: 0, actuals: 0, mreAvg: 0, direct: 0, mbd: 0, tshirt: 44 },
      sizeEvidenceShare: { A: 0.1, B: 0.2, C: 0.3, D: 0.4 },
      common: { rows: [], mm: 8.08 },
      totals: full ? { eFeat: 116.68, totalMm: 124.75, laborKrw: 1e9, overheadKrw: 1.5e8, feeKrw: 1.15e8, directKrw: 0, baseCost: 1.192e9, reserveKrw: 3.5e7, totalCost: 1_227_670_384.5, vatKrw: 1.2e8, totalWithVat: 1.35e9 } : { eFeat: 116.68, totalMm: 124.75 },
      ...(full
        ? {
            factors: { oh: 0.15, fee: 0.1 },
            confidenceTable: [{ level: 'P80', z: 0.84, amount: 1_227_670_384.5, vsBase: 0.03 }],
            aaceRange: [{ ratio: -0.3, amount: 8.6e8 }, { ratio: -0.15, amount: 1.04e9 }, { ratio: 0.2, amount: 1.47e9 }, { ratio: 0.5, amount: 1.84e9 }],
            benchmark: { eur: 1_330_000, krw: 2.05e9, compareKrw: 1.26e9, gap: -0.398, rateRatio: 0.5 },
          }
        : {}),
    },
    error: null,
    approvals: [],
    options: { aace: ['Class 4'], confidence: ['P50', 'P80', 'P90'], presets: ['직접 설정'], methods: ['사용자 정의'], rateBases: ['KOSA SW기술자 평균임금'], drivers: [{ key: 'TIME', label: '실행 시간 제약', ratings: ['N', 'H', 'VH', 'XH'] }], changeTypes: ['신규 개발'], asil: ['QM', 'A'], currencies: ['KRW', 'EUR'], directExpenseItems: [{ item: '개발 도구 라이선스', unit: 'Seat·월' }] },
  };
};

describe('SW 개발비 산정 목록', () => {
  it('구매 계정 — 승인된 과제 총개발비가 핵심 숫자(백만원), 금액 열이 있고, 조회에 산정 역할 머리글', async () => {
    handler = (url) => (url.startsWith('/api/cost/projects') ? { body: LIST_FULL } : undefined);
    mount('viewer', '/procurement/sw-cost', '/procurement/sw-cost', <SwCostScreen />);
    await screen.findByText('BCM 파생');
    expect(keyValue()).toBe('237.5');
    expect(screen.getByRole('columnheader', { name: L.cols.cost })).toBeTruthy();
    expect(calls.find((c) => c.url.startsWith('/api/cost/projects'))!.role).toBe('COST_ESTIMATOR');
    expect((screen.getByRole('button', { name: L.newProject }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('금액을 못 보는 역할 — 공수 합계가 핵심 숫자, 금액 열 없음, 새 과제는 막힌다', async () => {
    handler = (url) => (url.startsWith('/api/cost/projects') ? { body: { view: 'MM_ONLY', items: LIST_FULL.items.map(({ totals, ...p }) => ({ ...p, totals: { totalMm: totals.totalMm } })) } } : undefined);
    mount('author', '/procurement/sw-cost', '/procurement/sw-cost', <SwCostScreen />);
    await screen.findByText('BCM 파생');
    expect(keyValue()).toBe('23.42');
    expect(screen.queryByRole('columnheader', { name: L.cols.cost })).toBeNull();
    expect((screen.getByRole('button', { name: L.newProject }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SW 개발비 산정 상세', () => {
  it('Feature 후보 목록의 연결 수로 담기를 허용한다 — 목록에 전체 featureRefs가 없어도 된다', async () => {
    handler = (url, init) => url.startsWith('/api/features?')
      ? { body: { items: [{ featureId: 'FEAT-00999', version: '0.1.0', name: '연결된 BCM 기능', featureRefCount: 2 }] } }
      : url.endsWith('/features') && init?.method === 'POST'
        ? { body: detail() }
        : url === '/api/cost/projects/EST-0001' ? { body: detail() } : undefined;
    mount('viewer', '/procurement/sw-cost/EST-0001', '/procurement/sw-cost/:estId', <CostDetailScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(D.tabs.lines) }));
    fireEvent.click(screen.getByRole('button', { name: LN.add }));
    fireEvent.change(await screen.findByLabelText(new RegExp(`^${LN.search}`)), { target: { value: 'BCM' } });
    const add = await screen.findByRole('button', { name: LN.pick, exact: true });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ featureId: 'FEAT-00999', version: '0.1.0' }));
  });

  it('총개발비 백만원이 핵심 숫자 — 작성자는 승인 요청을 보내고, 사유가 본문에 담긴다', async () => {
    handler = (url, init) => (url === '/api/cost/projects/EST-0001' ? { body: detail() } : url.endsWith('/transitions') && init?.method === 'POST' ? { status: 201, body: { status: 'SUBMITTED' } } : undefined);
    mount('viewer', '/procurement/sw-cost/EST-0001', '/procurement/sw-cost/:estId', <CostDetailScreen />);
    await screen.findByRole('tab', { name: D.tabs.result });
    expect(keyValue()).toBe('1,227.7');
    fireEvent.click(screen.getByRole('button', { name: D.transition.SUBMIT }));
    fireEvent.change(await screen.findByLabelText(new RegExp(`^${D.transition.reason}`)), { target: { value: '구매 검토 요청' } });
    fireEvent.click(screen.getByRole('button', { name: D.transition.confirm }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ action: 'SUBMIT', reason: '구매 검토 요청' }));
  });

  it('자기가 만든 과제는 승인 버튼이 막히고 이유(SOD-16)를 보인다', async () => {
    handler = (url) => (url === '/api/cost/projects/EST-0001' ? { body: detail({ status: 'SUBMITTED', createdBy: 'usr-approver' }) } : undefined);
    mount('approver', '/procurement/sw-cost/EST-0001', '/procurement/sw-cost/:estId', <CostDetailScreen />);
    const approve = (await screen.findByRole('button', { name: D.transition.APPROVE })) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getAllByText(D.transition.sod).length).toBeGreaterThan(0);
  });

  it('공수만 보는 역할 — 핵심 숫자는 총 공수, 안내 문구, 기능 목록에 인건비 열 없음', async () => {
    handler = (url) => (url === '/api/cost/projects/EST-0001' ? { body: detail({ view: 'MM_ONLY' }) } : undefined);
    mount('author', '/procurement/sw-cost/EST-0001?tab=lines', '/procurement/sw-cost/:estId', <CostDetailScreen />);
    await screen.findByText(D.mmOnly);
    expect(keyValue()).toBe('124.75');
    expect(screen.getByRole('columnheader', { name: LN.cols.e })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: LN.cols.labor })).toBeNull();
  });

  it('검토 탭 — 상태를 바꾸면 그 항목을 저장한다', async () => {
    handler = (url, init) => (url === '/api/cost/projects/EST-0001' ? { body: detail() } : init?.method === 'PUT' ? { body: { items: checks, rate: 1 / 38, open: 0, unchecked: 37 } } : undefined);
    mount('viewer', '/procurement/sw-cost/EST-0001?tab=review', '/procurement/sw-cost/:estId', <CostDetailScreen />);
    fireEvent.change(await screen.findByLabelText('상태 1'), { target: { value: '확인' } });
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/cost/projects/EST-0001/checks/1', body: { status: '확인', memo: '' } }));
  });
});

describe('계수·단가 표', () => {
  const list = { items: [{ version: 'v1.3', status: 'PUBLISHED', note: '엑셀 산정 도구 v1.3에서 옮김', createdBy: 'seed', createdAt: '2026-11-04T00:00:00Z', publishedBy: 'seed', publishedAt: '2026-11-04T00:00:00Z' }], latest: 'v1.3' };
  const basis = { version: 'v1.3', status: 'PUBLISHED', note: '', basis: { version: 'v1.3', vat: 0.1, benchmark: { fx: 1545.16, anchorEur: 10000 }, commonPct: { pm: 0.032, scm: 0.015, pi: 0.02 }, checklist: checks, rates: { daysPerMonth: 20.5, kosa: { 'IT PM': { daily: 492_036, monthly: 10_086_804 } }, roles: [{ role: 'PM', kosaJob: 'IT PM', engineeringGrade: '기술사', inhouseMonthly: null }] } } };

  it('산정 역할은 표 내용(단가)을 보고, 원가 기준 관리자가 아니면 초안 버튼이 막힌다', async () => {
    handler = (url) => (url === '/api/cost/basis' ? { body: list } : url === '/api/cost/basis/v1.3' ? { body: basis } : undefined);
    mount('viewer', '/procurement/sw-cost/basis', '/procurement/sw-cost/basis', <CostBasisScreen />);
    expect(await screen.findByText('10,086,804원')).toBeTruthy();
    expect(keyValue()).toBe('1');
    expect((screen.getByRole('button', { name: B.draft }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.find((c) => c.url === '/api/cost/basis/v1.3')!.role).toBe('COST_ESTIMATOR');
  });

  it('금액을 못 보는 역할은 표 내용을 부르지 않고 안내만', async () => {
    handler = (url) => (url === '/api/cost/basis' ? { body: list } : undefined);
    mount('author', '/procurement/sw-cost/basis', '/procurement/sw-cost/basis', <CostBasisScreen />);
    expect(await screen.findByText(B.moneyOnly)).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/cost/basis/v1.3')).toBe(false);
  });
});
