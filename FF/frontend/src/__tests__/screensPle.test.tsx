// ISO/IEC 26580 정합 화면(20-60) — 등록 마법사의 이름·설명 추천·자동 채움(출처·범위 후보·제어점·프로필)·제출 본문,
// 등록 진행 단계, Feature 카탈로그 트리, Bill-of-Features 위반 표시·점검 권한. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { autofillFromRef, billOfFeatures, catalogueTree, type PleFeature, type PleRef } from '@ff/contracts';
import { AppProvider } from '../store';
import ProposeScreen from '../screens/home/propose/ProposeScreen';
import { RegistrationMini, RegistrationSteps } from '../screens/ple/RegistrationSteps';
import { BillOfFeaturesScreen, CatalogueScreen } from '../screens/ple/PleScreens';
import { autofill as A, bof as B, profile as PR, regSteps as R } from '../copy/ple';
import { propose as P } from '../copy/propose';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  handler = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = handler(url, init) ?? api(url) ?? { body: { items: [] } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SEAT: PleRef = {
  refId: 'BC-SEAT-001',
  status: 'ACTIVE',
  nameKo: '전동 시트 전후·높이·틸트',
  nameEn: 'Power seat',
  domain: 'Body & Comfort',
  component: 'Seat control',
  swStack: 'Application',
  lifecycle: 'Commodity',
  vehicleType: '공통',
  region: '글로벌',
  asilRep: 'QM',
  tshirt: 'S',
  requires: ['BC-SEAT-009'],
  sourceDetail: 'UN R17',
  definition: { summary: '시트 위치를 모터로 조정한다', regulations: 'FMVSS 207', io: { read: '스위치', write: '모터' }, drivers: { dtcs: '5', calibrations: '12', variants: '3' } },
};
const MEM: PleRef = { ...SEAT, refId: 'BC-SEAT-009', nameKo: '시트 메모리', requires: [], definition: null };
const REFS = new Map([SEAT, MEM].map((r) => [r.refId, r]));
const F = (id: string, refId: string, o: Partial<PleFeature> = {}): PleFeature => ({ featureId: id, version: '1.0.0', name: id, country: 'US', vehicleModel: 'EV9', trim: 'GT', lifecycle: 'RELEASED', controlPoints: ['Flag'], swIds: ['SW-1'], featureRefs: [{ refId, role: 'PRIMARY' }], ...o });
const FEATURES = [F('FEAT-00001', 'BC-SEAT-009', { name: '시트 메모리' }), F('FEAT-00002', 'BC-SEAT-001', { country: 'EU', vehicleModel: 'MX5', trim: 'Premium' })];
const AUTOFILL = autofillFromRef(SEAT, { features: FEATURES, refsById: REFS });

const api: Handler = (url) => {
  if (url.startsWith('/api/ple/ref-suggestions')) return { body: { q: 'x', items: [{ ref: SEAT, refId: SEAT.refId, nameKo: SEAT.nameKo, nameEn: SEAT.nameEn, domain: SEAT.domain, component: SEAT.component, asilRep: 'QM', status: 'ACTIVE', score: 13, reasons: ["기능명 '전동 시트 전후·높이·틸트'"] }] } };
  if (url.startsWith('/api/ple/autofill')) return { body: AUTOFILL };
  if (url.startsWith('/api/refdb/refs')) return { body: { items: [], total: 0, offset: 0, limit: 20, facets: {}, release: 'v1.3' } };
  return undefined;
};

const mount = (path: string, el: JSX.Element, role = 'author') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path.split('?')[0]} element={el} />
            <Route path="/features/:id/:ver" element={<div>detail-page</div>} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const registerDraft = async () => {
  fireEvent.click(screen.getByRole('button', { name: '다음: 등록 전 확인' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '국가·차종·트림이 실제 적용 대상과 일치함을 확인했습니다' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '확인한 내용으로 초안 등록' }));
};

describe('등록 진행 단계', () => {
  it('다섯 단계 — 지난 단계는 끝남, 지금 단계는 aria-current=step', () => {
    render(<RegistrationSteps current={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((x) => x.getAttribute('data-state'))).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[1].textContent).toContain(R.stages[1]);
  });
  it('작은 막대는 지금 단계 이름을 글자로', () => {
    render(<RegistrationMini current={3} />);
    expect(screen.getByText(`4 · ${R.stages[3]}`)).toBeTruthy();
  });
});

describe('Feature 등록 마법사 — 자동 채움', () => {
  it('이름·설명으로 추천 → 대표로 고르기 → 자동 채움 표(출처)·제어점·범위·프로필이 채워지고 본문에 실린다', async () => {
    mount('/feature/propose', <ProposeScreen />);
    // 단계 띠 — 1단계
    expect(document.querySelector('[data-reg-step="0"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(new RegExp(A.intentLabel)), { target: { value: '전동 시트 높이 조절' } });
    fireEvent.click(await screen.findByRole('button', { name: A.intentPick('BC-SEAT-001') }));
    expect(document.querySelector('[data-ref-chosen="BC-SEAT-001"]')?.getAttribute('data-role')).toBe('PRIMARY');
    fireEvent.click(document.querySelector('[data-ui="refPickNext"]') as HTMLElement);

    const table = await screen.findByTestId('autofill');
    fireEvent.click(screen.getByText(P.form.autofill));
    expect(document.querySelector('[data-reg-step="1"]')).toBeTruthy();
    const asilRow = table.querySelector('[data-af-field="asil"]') as HTMLElement;
    expect(asilRow.textContent).toContain('대표 ASIL(L)');
    expect(within(asilRow).getByText(A.state.base)).toBeTruthy();
    // 제어점 계획 — 기준 행 정의(보정·신호·고장 코드)로 채운다
    await waitFor(() => expect((screen.getByLabelText('Parameter') as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText('DTC') as HTMLInputElement).checked).toBe(true);
    // 기본 범위(KR)는 후보 밖 → 첫 후보로
    await waitFor(() => expect((document.querySelector('input[name="country"]') as HTMLInputElement).value).toBe(AUTOFILL.scopeCandidates[0].country));
    // 다른 후보 칩을 누르면 범위가 바뀐다
    const other = AUTOFILL.scopeCandidates[1];
    fireEvent.click(screen.getByRole('button', { name: A.scopeApply(`${other.country} · ${other.vehicleModel} · ${other.trim}`) }));
    expect((document.querySelector('input[name="vehicleModel"]') as HTMLInputElement).value).toBe(other.vehicleModel);
    // 프로필 — 변이성을 바꾸면 '수정됨'
    fireEvent.change(screen.getByLabelText(PR.variability), { target: { value: 'OR' } });
    expect(within(table.querySelector('[data-af-field="variability"]') as HTMLElement).getByText(A.state.edited)).toBeTruthy();
    // 이름을 고치면 표에서도 '수정됨'
    fireEvent.change(screen.getByLabelText(new RegExp(`^${P.name}`)), { target: { value: '전동 시트 원격' } });
    expect(within(table.querySelector('[data-af-field="name"]') as HTMLElement).getByText(A.state.edited)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(P.owner), { target: { value: '바디상품기획팀' } });
    handler = (url, init) => (url === '/api/features' && init?.method === 'POST' ? { status: 201, body: { featureId: 'FEAT-00999', version: '0.1.0' } } : undefined);
    await registerDraft();
    await screen.findByText('detail-page');
    const body = calls.find((c) => c.method === 'POST' && c.url === '/api/features')!.body;
    expect(body.controlPoints.sort()).toEqual(['DTC', 'Flag', 'Parameter', 'Signal']);
    expect(body.vehicleModel).toBe(other.vehicleModel);
    expect(body.variability).toMatchObject({ catalogueRole: 'PRIMARY', featureType: 'ENUM', variability: 'OR', bindingTime: 'RUNTIME_FLAG' });
    expect(body.variability.variationPoints.map((v: any) => v.assetKind)).toEqual(['FLAG', 'PARAMETER', 'SIGNAL', 'DTC', 'SW_COMPONENT']);
  });

  it('제어점을 빼면 그 변이점도 빠지고, 하위 feature인데 상위가 없으면 등록이 막힌다', async () => {
    mount('/feature/propose', <ProposeScreen />);
    fireEvent.change(screen.getByLabelText(new RegExp(A.intentLabel)), { target: { value: '전동 시트' } });
    fireEvent.click(await screen.findByRole('button', { name: A.intentPick('BC-SEAT-001') }));
    fireEvent.click(document.querySelector('[data-ui="refPickNext"]') as HTMLElement);
    await screen.findByTestId('autofill');
    fireEvent.click(screen.getByText(P.form.autofill));
    await waitFor(() => expect((screen.getByLabelText('DTC') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByLabelText('DTC'));
    expect(within(screen.getByTestId('af-vps')).queryByText(PR.vpKind.DTC)).toBeNull();
    fireEvent.change(screen.getByLabelText(P.owner), { target: { value: '바디상품기획팀' } });
    fireEvent.change(screen.getByLabelText(PR.role), { target: { value: 'SUB' } });
    expect((document.querySelector('[data-ui="reviewFeature"]') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(PR.parentWhy).length).toBeGreaterThan(0);
    fireEvent.change(document.querySelector('input[name="parentRefId"]') as HTMLInputElement, { target: { value: 'BC-SEAT-009' } });
    expect((document.querySelector('[data-ui="reviewFeature"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Feature 카탈로그·Bill-of-Features', () => {
  it('카탈로그 트리 — 도메인·주요 feature·실현 Feature, 검색으로 거른다', async () => {
    const tree = catalogueTree({ features: [...FEATURES, F('FEAT-00003', 'BC-SEAT-009', { country: 'KR' })], refsById: REFS });
    handler = (url) => (url.startsWith('/api/ple/catalogue') ? { body: tree } : undefined);
    mount('/features/catalogue', <CatalogueScreen />);
    const t = await screen.findByTestId('catalogue-tree');
    expect(t.querySelector('[data-catalogue-ref="BC-SEAT-009"]')?.textContent).toContain('FEAT-00001');
    fireEvent.change(screen.getByLabelText('기능 찾기'), { target: { value: '전동' } });
    await waitFor(() => expect(t.querySelector('[data-catalogue-ref="BC-SEAT-009"]')).toBeNull());
    expect(t.querySelector('[data-catalogue-ref="BC-SEAT-001"]')).toBeTruthy();
  });

  it('위반이 있는 상품을 먼저 보이고 위반 코드를 표시, 점검은 상품 역할만', async () => {
    const baselines = { 'BL-00001': { baselineId: 'BL-00001', featureId: 'FEAT-00002', version: '1.0.0', name: 'seat', lifecycle: 'RELEASED' as const, country: 'EU', vehicleModel: 'MX5', trim: 'Premium' } };
    const bill = billOfFeatures({ product: { country: 'EU', vehicleModel: 'MX5', trim: 'Premium', type: 'SINGLE', baselineIds: ['BL-00001'], validFrom: null, validTo: null, catalogId: 'CAT-00007', version: '1.0.0' }, baselines, dependencies: [], features: new Map(FEATURES.map((f) => [`${f.featureId}@${f.version}`, f])), refsById: REFS });
    expect(bill.issues.map((i) => i.code)).toContain('REF_REQUIRES_MISSING');
    const portfolio = { items: [{ catalogId: 'CAT-00001', version: '1.0.0', name: 'ok', lifecycle: 'RELEASED', type: 'SINGLE', country: 'US', vehicleModel: 'EV9', trim: 'GT', result: 'PASS', features: 1, refs: ['BC-SEAT-009'], primaryRefs: ['BC-SEAT-009'], fails: 0, warns: 0, catalogueIssues: 0 }, { catalogId: 'CAT-00007', version: '1.0.0', name: 'seat pkg', lifecycle: 'PROPOSED', type: 'SINGLE', country: 'EU', vehicleModel: 'MX5', trim: 'Premium', result: 'FAIL', features: 1, refs: ['BC-SEAT-001'], primaryRefs: ['BC-SEAT-001'], fails: 1, warns: 0, catalogueIssues: 1 }], refIds: ['BC-SEAT-001', 'BC-SEAT-009'], refNames: { 'BC-SEAT-001': 'seat', 'BC-SEAT-009': 'mem' }, counts: { products: 2, fail: 1, features: 2 } };
    handler = (url) => (url.startsWith('/api/ple/bill-of-features/CAT-00007') ? { body: bill } : url.startsWith('/api/ple/bill-of-features') ? { body: portfolio } : undefined);
    mount('/products/bill-of-features', <BillOfFeaturesScreen />);
    const issues = await screen.findByTestId('bof-issues');
    expect(issues.querySelector('[data-code="REF_REQUIRES_MISSING"]')?.getAttribute('data-severity')).toBe('FAIL');
    expect(screen.getByTestId('bof-grid').querySelectorAll('td[data-on="true"]').length).toBe(2);
    // 작성자(Feature) 역할은 점검 단추가 막힌다
    expect((document.querySelector('[data-ui="checkBillOfFeatures"]') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(B.checkWhy).length).toBeGreaterThan(0);
  });
});
