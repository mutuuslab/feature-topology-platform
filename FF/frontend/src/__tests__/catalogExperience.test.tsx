import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { ProductList, type Composition, type Product } from '../screens/products/Products';
import { CatalogApproval, CatalogAssembly, CatalogCard, CatalogIdentity } from '../screens/products/CatalogExperience';
import { catalogExperience as C } from '../copy/catalog-experience';

const PRODUCT: Product = { catalogId: 'CAT-00001', version: '3.0.0', name: 'Parking Assist Package', description: '주차 보조 상품', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', tags: ['parking'], saleType: '구매', type: 'PACKAGE', baselineIds: ['BL-00028', 'BL-00163'], validFrom: '2026-10-01', validTo: '2027-01-01', ownerId: '주차상품기획팀', lifecycle: 'VERIFIED', featureCount: 2 };
const COMPOSITION: Composition = { result: 'PASS', issues: [], features: [{ baselineId: 'BL-00028', featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리', lifecycle: 'RELEASED' }, { baselineId: 'BL-00163', featureId: 'FEAT-00145', version: '2.0.0', name: '브레이크 제어', lifecycle: 'VERIFIED' }] };
const FLAGS = [
  { flagKey: 'care_00022_signal', featureId: 'FEAT-00022', version: '1.0.0', featureName: '전방 안전거리', policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 3, controlPoint: 'Signal' }, sources: [], publication: { publicationId: 'PUB-00001', status: 'PARTIAL', confirmed: 2, denominator: 3 } },
  { flagKey: 'wrong_version', featureId: 'FEAT-00022', version: '9.9.0', featureName: '다른 버전', policy: null, sources: [], publication: null },
  { flagKey: 'brake_mode', featureId: 'FEAT-00145', version: '2.0.0', featureName: '브레이크 제어', policy: { policyId: 'POL-00002', status: 'DRAFT', revision: 1, controlPoint: 'Flag' }, sources: [], publication: null },
];
let reply: (url: string) => { status?: number; body: unknown };
const calls: { url: string; method: string }[] = [];
beforeEach(() => {
  localStorage.clear(); calls.length = 0;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  reply = (url) => url.startsWith('/api/feature-flags') ? { body: FLAGS } : url.startsWith('/api/policies') ? { body: { items: [{ policyId: 'POL-00001', entitlementCatalogId: 'CAT-00001' }, { policyId: 'POL-00002', entitlementCatalogId: null }] } } : { status: 404, body: {} };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => { const url = String(input); calls.push({ url, method: init?.method ?? 'GET' }); const r = reply(url); return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } }); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(ui: JSX.Element, role = 'viewer') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role, department: 'ALL' }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AppProvider>{ui}</AppProvider></MemoryRouter></QueryClientProvider>);
}

describe('Catalog product experience', () => {
  it('uses the same country/search filters and exact visible count in gallery and data table', async () => {
    const energy = { ...PRODUCT, catalogId: 'CAT-00002', name: 'EV Energy Package', country: 'US', tags: ['energy'], featureCount: undefined };
    reply = () => ({ body: { items: [PRODUCT, energy] } });
    mount(<ProductList />);
    expect(await screen.findByRole('article', { name: 'CAT-00001 Parking Assist Package' })).toBeTruthy();
    expect(document.querySelector('.catalog-cover[data-theme="parking"]')).toBeTruthy();
    expect(document.querySelector('.catalog-cover[data-theme="energy"]')).toBeTruthy();
    expect(screen.getByText(C.featureUnknown)).toBeTruthy();
    expect((screen.getByRole('button', { name: '새 상품 구성' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(C.country), { target: { value: 'KR' } });
    expect(screen.queryByRole('article', { name: 'CAT-00002 EV Energy Package' })).toBeNull();
    expect(screen.getByText(C.count(1, 2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.table, exact: true }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByText('EV Energy Package')).toBeNull();
    fireEvent.change(screen.getByLabelText(C.search), { target: { value: 'CAT-00001' } });
    fireEvent.click(screen.getByRole('button', { name: C.browse, exact: true }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('shows real included Feature count separately from configured Baselines and keeps price unknown', () => {
    mount(<CatalogIdentity product={PRODUCT} composition={{ ...COMPOSITION, features: COMPOSITION.features.slice(0, 1) }} />);
    const identity = screen.getByRole('region', { name: C.identity });
    expect(within(identity).getByText('1 Feature')).toBeTruthy();
    expect(within(identity).getByText('2 Baseline')).toBeTruthy();
    expect(within(identity).getByText('KR')).toBeTruthy();
    const price = within(identity).getByText(C.price).closest('div')!;
    expect(price.textContent).toBe(`${C.price}${C.unknown}`);
    expect(within(identity).getByText(C.boundary)).toBeTruthy();
    expect(identity.textContent).not.toMatch(/무료|₩|0원/);
  });

  it('links only exact included Feature Versions to actual policy revision and entitlement conditions', async () => {
    mount(<CatalogAssembly product={PRODUCT} composition={COMPOSITION} />);
    const flags = await screen.findByRole('region', { name: C.flags });
    await within(flags).findByText('care_00022_signal');
    await waitFor(() => expect(flags.textContent).toContain('CAT-00001 사용 권한 필요'));
    expect(within(flags).getByRole('link', { name: 'POL-00001 · r3 · DEPLOYED' }).getAttribute('href')).toBe('/policies/POL-00001');
    expect(within(flags).getByRole('link', { name: 'care_00022_signal' }).getAttribute('href')).toBe('/features/FEAT-00022/1.0.0?tab=flags#flag-care_00022_signal');
    expect(flags.textContent).toContain('게시본 확인 2/3');
    expect(screen.queryByText('wrong_version')).toBeNull();
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('switching the included Feature stops the explanation and shows its own conditions', async () => {
    mount(<CatalogAssembly product={PRODUCT} composition={COMPOSITION} />);
    await screen.findByText('care_00022_signal');
    fireEvent.click(screen.getByRole('button', { name: C.play }));
    expect(document.querySelector('.catalog-flow')?.getAttribute('data-running')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /브레이크 제어.*FEAT-00145/ }));
    expect(document.querySelector('.catalog-flow')?.getAttribute('data-running')).toBe('false');
    const flags = screen.getByRole('region', { name: C.flags });
    expect(await within(flags).findByText('brake_mode')).toBeTruthy();
    expect(flags.textContent).toContain(C.noEntitlement);
    expect(within(flags).queryByText('care_00022_signal')).toBeNull();
  });

  it.each([{ status: 503, body: { error: { message: 'unavailable' } } }, { body: [{ wrong: true }] }])('does not report zero flags when retrieval fails or the payload is malformed', async (bad) => {
    reply = () => bad;
    mount(<CatalogAssembly product={PRODUCT} composition={COMPOSITION} />);
    expect(await screen.findByText(C.flagsError)).toBeTruthy();
    expect(screen.queryByText(C.noFlags)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: C.retry }));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/feature-flags')).length).toBe(2));
  });

  it('does not infer a granted entitlement if the policy condition was not returned', async () => {
    reply = (url) => url.startsWith('/api/feature-flags') ? { body: FLAGS } : { body: { items: [] } };
    mount(<CatalogAssembly product={PRODUCT} composition={COMPOSITION} />);
    const flags = await screen.findByRole('region', { name: C.flags });
    await within(flags).findByText('care_00022_signal');
    await waitFor(() => expect(flags.querySelector('[aria-busy="true"]')).toBeNull());
    expect(flags.textContent).toContain(`${C.entitlement}: ${C.unknown}`);
    expect(flags.textContent).not.toContain(C.noEntitlement);
  });

  it.each([42, 'not-a-catalog'])('keeps malformed entitlement conditions unconfirmed: %s', async (value) => {
    reply = (url) => url.startsWith('/api/feature-flags') ? { body: FLAGS } : { body: { items: [{ policyId: 'POL-00001', entitlementCatalogId: value }] } };
    mount(<CatalogAssembly product={PRODUCT} composition={COMPOSITION} />);
    const flags = await screen.findByRole('region', { name: C.flags });
    await within(flags).findByText('care_00022_signal');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/policies'))).toBe(true));
    await waitFor(() => expect(flags.querySelector('[aria-busy="true"]')).toBeNull());
    expect(flags.textContent).toContain(`${C.entitlement}: ${C.unknown}`);
    expect(flags.textContent).not.toContain(C.needsEntitlement(String(value)));
  });

  it('supports pause/replay and pauses for hidden documents and reduced motion', async () => {
    const events = new EventTarget();
    const media = { matches: false, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
    const hidden = vi.spyOn(document, 'hidden', 'get');
    vi.stubGlobal('matchMedia', () => media);
    mount(<CatalogAssembly product={PRODUCT} composition={COMPOSITION} />);
    const flow = document.querySelector('.catalog-flow')!;
    fireEvent.click(screen.getByRole('button', { name: C.play })); expect(flow.getAttribute('data-running')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: C.pause })); expect(flow.getAttribute('data-running')).toBe('false');
    const dot = flow.querySelector('.catalog-flow__dot');
    fireEvent.click(screen.getByRole('button', { name: C.replay })); expect(flow.querySelector('.catalog-flow__dot')).not.toBe(dot);
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
    expect(flow.getAttribute('data-running')).toBe('false');
    act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
    expect(flow.getAttribute('data-running')).toBe('true');
    act(() => { media.matches = true; events.dispatchEvent(new Event('change')); });
    expect(flow.getAttribute('data-running')).toBe('false'); expect(flow.querySelector('.catalog-flow__dot')).toBeNull();
    expect((screen.getByRole('button', { name: C.pause }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports missing composition and absent approvals without fabricating Features or people', () => {
    mount(<><CatalogAssembly product={PRODUCT} composition={{ result: 'FAIL', issues: [], features: [] }} /><CatalogApproval product={PRODUCT} meta={{ createdBy: null, configApprovedBy: null, releaseApprovedBy: null }} transitions={[{ to: 'RELEASED', ko: '고객 출시 승인', approval: 'RELEASE' }]} eligibility={{ eligible: false, reasons: ['구성 검증'] }} /></>);
    expect(screen.getByText(C.noFeatures)).toBeTruthy();
    expect(screen.getAllByText(C.noApproval)).toHaveLength(2);
    expect(screen.getByText(/고객 출시 승인 · 고객 출시 승인 담당/)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('a card never turns a missing feature count or price into a zero', () => {
    mount(<CatalogCard product={{ ...PRODUCT, featureCount: undefined }} />);
    expect(screen.getByText(C.featureUnknown)).toBeTruthy();
    expect(screen.getByText(C.priceUnknown)).toBeTruthy();
    expect(screen.getByText('2 Baseline')).toBeTruthy();
  });
});
