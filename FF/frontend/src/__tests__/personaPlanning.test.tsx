// 담당자 웨이브 W4(2026-11-05) — 등록·구현 연결·상품·정책 화면. 모의 API.
//   오류 코드를 문장에 붙이지 않는다 · 구현 연결은 기준정보에서 고른다 · 정의 승인 전 구현 미입력 경고 · 승인 뒤 막다른 길 → 새 Version
//   검증 GO 전 정책 승인·반려 막힘 · 상품 직무 분리 미리 보기·'구성 승인' 낱말·FAIL 등록 확인·빠진 Baseline 추가 · 체험 상품 고르기·범위·시뮬레이터 제외
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { ErrorNote } from '../design';
import { planning as W } from '../copy/planning';
import { FeatureVersionActions } from '../screens/features/VersionEdit';
import { ImplDeadEnd, ImplMissingNotice, RegisteredGuide } from '../screens/features/ImplLinks';
import { PolicyDetail } from '../screens/policy/Policies';
import { ProductCompose, ProductDetail } from '../screens/products/Products';
import { EntitlementsScreen } from '../screens/policy/Entitlements';

type Reply = { status?: number; body?: unknown } | undefined;
let handler: (url: string, init?: RequestInit) => Reply;
const calls: { url: string; method: string; body: any }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(role: string, path: string, routePath: string, el: JSX.Element) {
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

const SW = { items: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.1', name: '안전거리 앱', ecuPno: '99211-NX400', lifecycle: 'ACTIVE' }, { swId: 'SW-OLD', version: '0.9.0', name: '단종 SW', ecuPno: '99999-OLD', lifecycle: 'RETIRED' }] };
const F = { featureId: 'FEAT-00191', version: '0.1.0', lifecycle: 'PROPOSED', name: '안전거리 경고', description: 'd', ownerId: 'ADAS팀', asil: 'QM', tags: [], requirementIds: [], functions: [], swIds: [], swVersions: [], ecuPnos: [] };
const why = (btn: HTMLElement) => document.getElementById(btn.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

describe('오류 상자 — 코드는 문장에 붙지 않는다', () => {
  it('문장 뒤에 "…합니다.SEPARATION_OF_DUTY"가 되지 않고, 코드는 따로 한 줄(문의용)', () => {
    render(<ErrorNote error={{ message: '구성 승인자와 고객 출시 승인자는 달라야 합니다.', code: 'SEPARATION_OF_DUTY', status: 403, kind: 'forbidden' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toMatch(/합니다\.SEPARATION_OF_DUTY/);
    expect(alert.querySelector('strong')!.textContent).toBe('구성 승인자와 고객 출시 승인자는 달라야 합니다.');
    expect(alert.querySelector('.ds-error__code')!.textContent).toMatch(/^\s*오류 코드 SEPARATION_OF_DUTY$/);
  });
});

describe('구현 연결 — 초안 서랍(작성자·SW 통합 담당)', () => {
  it('SW·Version은 기준정보에서 고르고(단종 SW 없음) 제어기 P/N이 따라오며, 행이 덜 차면 이유와 함께 저장을 막는다', async () => {
    handler = (url, init) => (url.startsWith('/api/master/sw') ? { body: SW } : init?.method === 'PATCH' ? { body: {} } : undefined);
    mount('integrator', '/x', '/x', <FeatureVersionActions f={F} latest />);
    fireEvent.click(screen.getByRole('button', { name: '초안 수정' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(W.required.tag)).toBeTruthy(); // 요구사항 ID = 정의 승인 필수
    fireEvent.click(within(dlg).getByRole('button', { name: W.impl.add }));
    const save = within(dlg).getByRole('button', { name: '저장' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(why(save)).toBe(W.impl.rowWhy);
    fireEvent.change(within(dlg).getByLabelText(W.impl.fn), { target: { value: '안전거리 경고 표시' } });
    const sw = (await within(dlg).findByLabelText(W.impl.sw)) as HTMLSelectElement;
    await waitFor(() => expect(sw.options.length).toBe(2)); // 고르세요 + 활성 SW 1(단종 제외)
    fireEvent.change(sw, { target: { value: 'SW-CARE-SDIST-APP@1.2.1' } });
    expect(within(dlg).getByText('제어기 P/N 99211-NX400')).toBeTruthy();
    // 이유 글자가 사라지면 버튼을 새로 그린다 — 다시 찾는다
    const ready = within(dlg).getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ functions: [{ label: '안전거리 경고 표시' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] });
  });

  it('정의 승인 서랍 경고 — 구현 미입력이면 "승인 뒤에는 새 Version으로만", 초안으로 가는 길은 고칠 수 있는 사람에게만', () => {
    handler = () => undefined;
    const { unmount } = mount('approver', '/x', '/x', <ImplMissingNotice f={F} />);
    expect(screen.getByText(W.approval.implMissingTitle)).toBeTruthy();
    expect(screen.getByText(/기능\(Function\) · SW ID · SW Version · 제어기 P\/N이\(가\) 비어 있습니다/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: W.approval.toDraft })).toBeNull();
    unmount();
    mount('author', '/x', '/x', <ImplMissingNotice f={F} />);
    expect(screen.getByRole('link', { name: W.approval.toDraft }).getAttribute('href')).toBe('/x?edit=impl');
    cleanup();
    mount('author', '/x', '/x', <ImplMissingNotice f={{ ...F, functions: [{ functionId: 'FUNC-000001', label: 'a' }], swIds: ['S'], swVersions: ['1'], ecuPnos: ['E'] }} />);
    expect(screen.queryByText(W.approval.implMissingTitle)).toBeNull();
  });

  it('승인된 Version에 구현이 비면 막다른 길 안내 → 새 Version 서랍에서 구현을 넣어 changes로 보낸다', async () => {
    const DEV = { ...F, lifecycle: 'DEVELOPING' };
    handler = (url, init) => (url.startsWith('/api/master/sw') ? { body: SW } : init?.method === 'POST' ? { status: 201, body: { feature: { version: '0.2.0' }, changed: [], rejudge: [] } } : undefined);
    mount('author', '/features/FEAT-00191/0.1.0', '/features/:id/:ver', <><ImplDeadEnd f={DEV} lifecycle="DEVELOPING" latest /><FeatureVersionActions f={DEV} latest /></>);
    const box = screen.getByTestId('impl-dead-end');
    expect(within(box).getByText(W.deadEnd.title)).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: W.deadEnd.cta }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: W.impl.add }));
    fireEvent.change(within(dlg).getByLabelText(W.impl.fn), { target: { value: '안전거리 경고' } });
    const sw = (await within(dlg).findByLabelText(W.impl.sw)) as HTMLSelectElement;
    await waitFor(() => expect(sw.options.length).toBe(2));
    fireEvent.change(sw, { target: { value: 'SW-CARE-SDIST-APP@1.2.1' } });
    fireEvent.change(within(dlg).getByLabelText('변경 사유'), { target: { value: '구현 연결 입력' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '새 Version 만들기' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ baseVersion: '0.1.0', bump: 'minor', reason: '구현 연결 입력', changes: { functions: [{ label: '안전거리 경고' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] } });
  });

  it('등록 직후 다음 할 일 — 정의 승인 필수 칸·구현 연결·G1~G3·정의 승인, 채운 것은 완료', () => {
    render(<RegisteredGuide f={{ ...F, requirementIds: ['REQ-1'] }} gatesPassed={false} />);
    const items = within(screen.getByTestId('registered-guide')).getAllByRole('listitem');
    expect(items.map((i) => i.hasAttribute('data-done'))).toEqual([true, false, false, false]);
  });
});

const POL = { policyId: 'POL-00099', revision: 1, status: 'DRAFT', featureId: 'FEAT-00191', featureVersion: '0.1.0', controlPoint: 'Flag', flagKey: 'care_00191_flag', description: 'd', enabled: true, safeDefault: false, entitlementCatalogId: null, rollout: { mode: 'ALL', basisPoints: 10000, salt: 'S' }, stageBasisPoints: null, contentHash: 'sha256:aa', createdBy: 'usr-author', createdAt: '2026-10-01T00:00:00.000Z', approvedBy: null, approvedAt: null };
const RUN = { runId: 'VR-00009', policyId: 'POL-00099', policyRevision: 1, decision: 'GO', reasons: [], at: '2026-10-02T00:00:00.000Z', by: 'usr-author', results: [] };

describe('정책 승인·반려 — 검증 GO 전에는 막고 이유를 보인다', () => {
  const detail = (over: object) => ({ policy: POL, feature: { name: '안전거리 경고', asil: 'QM' }, hashMatchesValidation: false, lastRun: null, runs: [], approval: { eligible: false, reasons: ['아직 배포 안전성 검증을 하지 않았습니다 — 먼저 분야별 검증을 실행하세요'] }, ...over });
  it.each([
    ['검증 안 함', {}, W.policy.notValidated],
    ['검증 뒤 내용 바뀜', { lastRun: RUN, runs: [RUN] }, W.policy.stale],
    ['HOLD', { lastRun: { ...RUN, decision: 'HOLD' }, runs: [RUN], hashMatchesValidation: true }, W.policy.notGo],
  ])('%s', async (_n, over, reason) => {
    handler = (url) => (url === '/api/policies/POL-00099' ? { body: detail(over) } : undefined);
    mount('approver', '/policies/POL-00099', '/policies/:id', <PolicyDetail />);
    const btn = await screen.findByRole('button', { name: /정책 승인/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(why(btn)).toBe(reason);
  });
  it('지금 내용으로 GO면 누를 수 있다', async () => {
    handler = (url) => (url === '/api/policies/POL-00099' ? { body: detail({ lastRun: RUN, runs: [RUN], hashMatchesValidation: true, approval: { eligible: true, reasons: [] } }) } : undefined);
    mount('approver', '/policies/POL-00099', '/policies/:id', <PolicyDetail />);
    expect(((await screen.findByRole('button', { name: /정책 승인/ })) as HTMLButtonElement).disabled).toBe(false);
  });
});

const PRODUCT = { catalogId: 'CAT-00099', version: '1.0.0', name: 'W4 패키지', description: 'd', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', tags: [], saleType: '체험', type: 'PACKAGE', baselineIds: ['BL-00028', 'BL-00163'], validFrom: '2026-10-01', validTo: '2026-12-31', ownerId: '선행상품기획팀', lifecycle: 'VERIFIED' };
const productDetail = (over: object = {}) => ({
  product: PRODUCT,
  meta: { createdBy: 'usr-commerce', configApprovedBy: 'usr-approver', releaseApprovedBy: null },
  composition: { result: 'PASS', issues: [], features: [] },
  eligibility: { eligible: true, reasons: [] },
  transitions: [
    { to: 'RELEASED', ko: '고객 출시 승인', approval: 'RELEASE', blockers: [] },
    { to: 'DEVELOPING', ko: '검증 실패 — 되돌림', approval: null, blockers: [] },
  ],
  versions: [{ version: '1.0.0', lifecycle: 'VERIFIED' }],
  ...over,
});

describe('상품 — 구성 승인·고객 출시 승인', () => {
  it('구성 승인한 사람에게는 고객 출시 승인을 미리 막고 이유를 보인다, 단계 이름은 "구성 승인"', async () => {
    handler = (url) => (url.startsWith('/api/products/CAT-00099/versions/1.0.0') ? { body: productDetail() } : undefined);
    mount('approver', '/products/CAT-00099/1.0.0', '/products/:id/:ver', <ProductDetail />);
    const release = await screen.findByRole('button', { name: '고객 출시 승인 → RELEASED' });
    expect((release as HTMLButtonElement).disabled).toBe(true);
    expect(why(release)).toBe(W.product.sodRelease);
    expect((screen.getByRole('button', { name: '검증 실패 — 되돌림 → DEVELOPING' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('[data-lifecycle="APPROVED"] .ds-step__ko')!.textContent).toBe('구성 승인');
  });

  it('다른 상품 승인자(상품 Owner)는 누를 수 있고, 출시된 상품은 체험 제안으로 이어진다', async () => {
    handler = (url) => (url.startsWith('/api/products/CAT-00099/versions/1.0.0') ? { body: productDetail({ product: { ...PRODUCT, lifecycle: 'RELEASED' }, transitions: [], versions: [{ version: '1.0.0', lifecycle: 'RELEASED' }] }) } : undefined);
    mount('approver', '/products/CAT-00099/1.0.0', '/products/:id/:ver', <ProductDetail />);
    expect((await screen.findByRole('link', { name: W.product.toTrials })).getAttribute('href')).toBe('/entitlements?catalog=CAT-00099#trial-offer');
  });

  it('새 상품 구성 — FAIL이면 빠진 Baseline 추가 버튼과 등록 막힘(확인하면 등록 가능), PASS면 바로 등록', async () => {
    const C = (id: string, fid: string) => ({ baselineId: id, featureId: fid, version: '1.0.0', name: fid, lifecycle: 'RELEASED', latest: true, requires: [] });
    handler = (url, init) => {
      if (url.startsWith('/api/products/candidates')) return { body: { items: [C('BL-00028', 'FEAT-00022'), C('BL-00163', 'FEAT-00145')] } };
      if (url === '/api/products/validate') {
        const ids: string[] = JSON.parse(String(init!.body)).baselineIds;
        return ids.includes('BL-00163')
          ? { body: { result: 'PASS', issues: [], features: [] } }
          : { body: { result: 'FAIL', issues: [{ code: 'REQUIRES_MISSING', severity: 'FAIL', message: 'FEAT-00022가 필요로 하는 FEAT-00145의 Baseline이 상품에 없습니다 — 추가할 Baseline: BL-00163 (DEP-00013).', refs: ['DEP-00013'], suggest: ['BL-00163'] }], features: [] } };
      }
      return undefined;
    };
    mount('commerce', '/products/new', '/products/new', <ProductCompose />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'BL-00028' }));
    const add = await screen.findByRole('button', { name: W.product.add('BL-00163') });
    expect(screen.queryByText('REQUIRES_MISSING')).toBeNull(); // 규칙 코드는 글자로 보이지 않는다
    const submit = screen.getByRole('button', { name: '새 상품 구성' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(why(submit)).toBe(W.product.failWhy);
    fireEvent.click(screen.getByRole('checkbox', { name: W.product.failConfirm }));
    expect((screen.getByRole('button', { name: '새 상품 구성' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: W.product.failConfirm })).toBeNull());
    expect((screen.getByRole('checkbox', { name: 'BL-00163' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: '새 상품 구성' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('체험 제안 — 상품 고르기·범위·시뮬레이터 제외', () => {
  it('주소의 상품으로 묻고, 범위 안 고객 차량을 이름과 함께(시뮬레이터·표본 제외), 범위 밖은 펼쳐야 보인다', async () => {
    const P = (catalogId: string, name: string) => ({ catalogId, version: '1.0.0', name, lifecycle: 'RELEASED', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' });
    const V = (vin: string, label: string, trim = 'Premium', more = {}) => ({ vin, label, country: 'KR', vehicleModel: 'NX4 PE', trim, ...more });
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: { offered: [], skipped: [] } };
      if (url === '/api/products') return { body: { items: [P('CAT-00019', '체험 A'), P('CAT-00064', 'W4 패키지')] } };
      if (url.startsWith('/api/trials')) return { body: { today: '2026-10-12', total: 0, page: 1, pageSize: 50, byState: {}, items: [] } };
      if (url.startsWith('/api/vehicles')) return { body: { items: [V('ego-01', 'PoC 시연 차량', 'Premium', { gleo: true }), V('KMH-NX4-0002', '체험 미가입 차량'), V('KMH-NX4-0101', 'NX4 PE 일반 트림', 'Modern'), V('SMP-0001', '표본', 'Premium', { fleet: 'SAMPLE' })] } };
      return undefined;
    };
    mount('commerce', '/entitlements?catalog=CAT-00064', '/entitlements', <EntitlementsScreen />);
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/trials?catalogId=CAT-00064'))).toBe(true));
    expect((screen.getByLabelText(W.trial.product) as HTMLSelectElement).value).toBe('CAT-00064');
    const offer = await screen.findByRole('region', { name: '체험 제안' });
    const box = await within(offer).findByRole('checkbox', { name: 'KMH-NX4-0002 · 체험 미가입 차량' });
    expect(within(offer).queryByRole('checkbox', { name: /ego-01/ })).toBeNull();
    expect(within(offer).queryByRole('checkbox', { name: /SMP-0001/ })).toBeNull();
    expect(within(offer).queryByRole('checkbox', { name: /KMH-NX4-0101/ })).toBeNull();
    expect(within(offer).getByTestId('offer-scope').textContent).toBe(W.trial.scope('KR/NX4 PE/Premium', 1));
    fireEvent.click(within(offer).getByRole('checkbox', { name: W.trial.wide(1) }));
    expect(within(offer).getByRole('checkbox', { name: /KMH-NX4-0101 · NX4 PE 일반 트림/ })).toBeTruthy();
    fireEvent.click(box);
    fireEvent.click(within(offer).getByRole('button', { name: '제안 보내기' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ catalogId: 'CAT-00064', vins: ['KMH-NX4-0002'] }));
  });
});

// 따라하기 CLASSIFY-GATE 'Canary 단계 조정'은 시드 정책 POL-00002를 연다 — 전시 채우기가 같은 값의 새 판(POL-00022)을 배포해 앞 판은 RETIRED가 된다.
// ?follow=deployed로 열면 같은 flag의 배포 중 판으로 옮겨 [단계 조정]이 보인다(통합 3차 learn e2e 2건 실패 원인)
describe('정책 상세 ?follow=deployed — 대체된 판이면 같은 flag의 배포 중 판으로', () => {
  const live = { ...POL, policyId: 'POL-00122', revision: 1, status: 'DEPLOYED' };
  const body = (p: object) => ({ policy: p, feature: { name: '안전거리 경고', asil: 'QM' }, hashMatchesValidation: true, lastRun: RUN, runs: [RUN], approval: { eligible: false, reasons: [] } });
  beforeEach(() => {
    handler = (url) =>
      url === '/api/policies/POL-00099' ? { body: body({ ...POL, status: 'RETIRED' }) } : url === '/api/policies/POL-00122' ? { body: body(live) } : url.startsWith('/api/policies?') && url.includes('status=DEPLOYED') ? { body: { items: [live, { ...live, policyId: 'POL-00123', flagKey: 'other_00191_flag' }] } } : undefined;
  });
  it('따라오기를 청하면 배포 중 판으로 옮겨 단계 조정을 보인다', async () => {
    mount('coordinator', '/policies/POL-00099?follow=deployed', '/policies/:id', <PolicyDetail />);
    expect(await screen.findByRole('button', { name: /단계 조정/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /POL-00122/ })).toBeTruthy();
  });
  it('청하지 않으면 연 판 그대로(RETIRED, 단계 조정 없음)', async () => {
    mount('coordinator', '/policies/POL-00099', '/policies/:id', <PolicyDetail />);
    expect(await screen.findByRole('button', { name: /POL-00099/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /단계 조정/ })).toBeNull();
  });
});
