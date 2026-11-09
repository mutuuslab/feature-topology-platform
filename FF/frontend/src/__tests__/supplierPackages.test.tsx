import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { ROUTES } from '../routes';
import { __resetLocaleForTest, changeUiLanguage } from '../locale/runtime';

const fileMode = vi.hoisted(() => ({ enabled: false }));
vi.mock('../file-routing', async (original) => ({ ...await original<typeof import('../file-routing')>(), isLocalFile: () => fileMode.enabled }));

const pkg = { packageId: 'SPK-00001', featureId: 'FEAT-00010', featureVersion: '2.0.0', supplier: 'Tier1-B', version: '2.0.0', status: 'SUBMITTED', createdBy: 'usr-impl', submittedBy: 'usr-impl' };
let verdict = 'NOT_MET';
let retained = false;
let writes: { url: string; body: any }[];
beforeEach(() => {
  fileMode.enabled = false;
  pkg.status = 'SUBMITTED';
  localStorage.clear();
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'quality' }));
  writes = [];
  verdict = 'NOT_MET';
  retained = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') writes.push({ url, body: JSON.parse(String(init.body)) });
    const body = url.includes('/supplier-artifacts/SPA-00001/content') ? { text: 'DEMO synthetic reference body', verified: true } : url.includes('/supplier-packages/SPK-00001')
      ? { package: pkg, artifacts: [{ recordId: 'SPA-00001', type: 'HUMAN_DOC', title: '개발 안내', version: '2.0.0', integrity: 'DECLARED', contentUrl: retained ? '/api/supplier-artifacts/SPA-00001/content' : null }], latest: {}, criteria: { revision: 1 }, reviews: [], check: { verdict, criteriaRevision: 1, missing: [], criteria: [], packaging: [{ key: 'PKG_INTEGRITY', label: '본문 체크섬 대조', result: 'NOT_EVALUABLE', detail: '체크섬만 신고 10건' }] } }
      : url.includes('/supplier-packages') ? { items: [pkg] }
      : url.includes('/supplier-gate') ? { applicable: true, suppliers: ['Tier1-B'], accepted: [], blockers: ['검증 본문이 필요합니다'] }
      : url.includes('/supplier-mappings') ? { items: [] }
      : url.includes('/api/features') ? { items: [{ featureId: 'FEAT-00010', version: '2.0.0', name: '운전자 상태 판단', swIds: [] }] }
      : { items: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); __resetLocaleForTest(); vi.unstubAllGlobals(); });
const Portal = ROUTES.find((r) => r.path === '/supplier/portal')!.element;
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/supplier/portal?featureId=FEAT-00010&featureVersion=2.0.0']}><AppProvider><Suspense fallback={<p>불러오는 중</p>}><Portal /></Suspense></AppProvider></MemoryRouter></QueryClientProvider>);

it('changes supplier UI captions live while preserving the review draft and acceptance guard', async () => {
  mount();
  await screen.findByRole('heading', { name: '협력사 이관', level: 1 });
  fireEvent.change(await screen.findByLabelText('검수 의견'), { target: { value: '검수 중인 원문' } });
  await act(async () => { await changeUiLanguage('en'); });
  expect(screen.getByRole('heading', { name: 'Supplier handover', level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText('Review comment')).toHaveValue('검수 중인 원문');
  expect(screen.getByRole('checkbox', { name: 'Confirm Development documentation' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accept review' })).toBeDisabled();
  expect(screen.getByText('Content not retained')).toBeInTheDocument();
  expect(writes).toEqual([]);
});

it('신고된 체크섬은 본문 검증과 구분하고 자동 기준 미충족이면 합격을 막는다', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: '협력사 이관', level: 1 })).toBeInTheDocument();
  expect(await screen.findByText('체크섬만 신고 10건')).toBeInTheDocument();
  expect(screen.getByText('본문 미보관')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '검수 합격' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: '본문 보기' })).not.toBeInTheDocument();
});
it('기준을 충족해도 항목별 확인과 검수 의견 없이 승인하지 않는다', async () => {
  verdict = 'MET';
  mount();
  expect(await screen.findByRole('heading', { name: '협력사 이관', level: 1 })).toBeInTheDocument();
  const accept = await screen.findByRole('button', { name: '검수 합격' });
  expect(accept).toBeDisabled();
  fireEvent.change(screen.getByLabelText('검수 의견'), { target: { value: '10항목을 확인했습니다' } });
  for (const box of screen.getAllByRole('checkbox', { name: /확인$/ })) fireEvent.click(box);
  await waitFor(() => expect(accept).toBeEnabled());
  fireEvent.click(accept);
  await waitFor(() => expect(writes.some((w) => w.url.endsWith('/reviews') && w.body.decision === 'ACCEPT' && w.body.items.length === 10)).toBe(true));
});

it('file simulation enables an independent reviewer only after all checks and preserves the draft across locale changes', async () => {
  fileMode.enabled = true; verdict = 'MET'; mount();
  expect(await screen.findByRole('button', { name: '검수 합격' })).toBeDisabled();
  expect(screen.getByRole('note')).toHaveTextContent('이 브라우저에 저장');
  fireEvent.change(screen.getByLabelText('검수 의견'), { target: { value: '오프라인 독립 검수 의견' } });
  for (const box of screen.getAllByRole('checkbox', { name: /확인$/ })) fireEvent.click(box);
  expect(screen.getByRole('button', { name: '검수 합격' })).toBeEnabled();
  await act(async () => { await changeUiLanguage('en'); });
  expect(screen.getByRole('note')).toHaveTextContent('saved in this browser');
  expect(screen.getByLabelText('Review comment')).toHaveValue('오프라인 독립 검수 의견');
  expect(screen.getByRole('button', { name: 'Accept review' })).toBeEnabled();
  expect(writes).toEqual([]);
});

it.each(['integrator', 'author'])('file simulation uses actual supplier authoring permissions for %s', async (role) => {
  fileMode.enabled = true; localStorage.setItem('fp.state.v2', JSON.stringify({ role })); pkg.status = 'DRAFT'; mount();
  expect((await screen.findAllByText('매핑 등록')).length).toBeGreaterThan(0);
  if (role === 'integrator') { expect((await screen.findAllByText('패키지 작성')).length).toBeGreaterThan(0); expect((await screen.findAllByText('산출물 등록')).length).toBeGreaterThan(0); }
  else { expect(screen.queryByText('패키지 작성')).not.toBeInTheDocument(); expect(screen.queryByText('산출물 등록')).not.toBeInTheDocument(); }
  expect(screen.getByRole('button', { name: '다시 읽기' })).toBeEnabled(); expect(writes).toEqual([]);
});

it('HTTP supplier service retains creation, mapping and artifact forms for an implementer', async () => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'integrator' }));
  pkg.status = 'DRAFT';
  mount();
  expect((await screen.findAllByText('패키지 작성')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('매핑 등록')).length).toBeGreaterThan(0);
  expect((await screen.findAllByText('산출물 등록')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});

it('file archive still reads a captured supplier artifact body without posting changes', async () => {
  fileMode.enabled = true;
  retained = true;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '본문 보기' }));
  expect(await screen.findByText('DEMO synthetic reference body')).toBeInTheDocument();
  expect(writes).toEqual([]);
});
