// Feature 제안 2단계 등록(30-95 §6.1·§6.3·§6.4·§5.2)과 Feature 상세 '기준 행' 탭 — 모의 API.
//   ① 검색·패싯 → 대표/포함 고르기(폐기 불가·폐기 예정 안내·검토 필요 경고) → ② 미리 채움 '기준값'/'수정됨' → ASIL 사유 → featureRefs 본문
//   추가 요청(요청 중 행을 대표로) · 같은 범위 중복 409 확인 · 등록 뒤 서버 안내
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider } from '../store';
import ProposeScreen from '../screens/home/propose/ProposeScreen';
import { autofillFromRef, SIZE_CLASSES } from '@ff/contracts';
import { hasUnsaved } from '../design/unsaved';
import { prefillOf, regulationsOf, tagsOf, type RefLite } from '../screens/home/propose/prefill';
import { FeatureRefsTab, releaseCmp } from '../screens/features/FeatureRefsTab';
import { featureRefsTab as T, propose as PC } from '../copy/propose';
import { PRD_TEMPLATE, proposePrd as PD } from '../copy/propose-prd';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = handler(url, init) ?? api(url, init) ?? { body: { items: [] } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ref = (o: Partial<RefLite> & { refId: string }): RefLite => ({
  status: 'ACTIVE',
  replacedBy: null,
  domain: 'Chassis & Vehicle Dynamics',
  cluster: 'Brake',
  component: 'Brake control (ESC/ABS)',
  swStack: 'Application',
  lifecycle: 'Commodity',
  vehicleType: '공통',
  region: '글로벌',
  nameEn: 'Auto hold',
  nameKo: '오토 홀드',
  aliases: ['AVH'],
  asilRep: 'B',
  tshirt: 'S',
  sourceDetail: 'VSS Chassis.Brake.IsAutoHoldEngaged',
  adminMemo: '',
  definition: { summary: '차량이 정차한 상태에서 브레이크 압력을 유지한다.', regulations: 'ISO 26262 · UN R13-H' },
  ...o,
});

const AVH = ref({ refId: 'CH-BRK-009' });
const HSA = ref({ refId: 'CH-BRK-006', nameKo: '경사로 밀림 방지', nameEn: 'Hill start assist', definition: null, sourceDetail: '' });
const OLD = ref({ refId: 'CH-BRK-002', nameKo: '구형 제동 보조', status: 'DEPRECATED', replacedBy: 'CH-BRK-009' });
const GONE = ref({ refId: 'CH-BRK-001', nameKo: '폐기된 기능', status: 'RETIRED' });
const CHECK = ref({ refId: 'CH-BRK-007', nameKo: '제동 등 점등', status: 'REVIEW', adminMemo: '출처가 2차 자료 (CR-2026-004)' });

const TAXONOMY = [
  { nodeId: 'CH', level: 'DOMAIN', parentId: null, nameEn: 'Chassis & Vehicle Dynamics', nameKo: '' },
  { nodeId: 'BC', level: 'DOMAIN', parentId: null, nameEn: 'Body & Comfort', nameKo: '' },
  { nodeId: 'CH/Brake control (ESC/ABS)', level: 'COMPONENT', parentId: 'CH', nameEn: 'Brake control (ESC/ABS)', nameKo: '' },
  { nodeId: 'BC/Seat control', level: 'COMPONENT', parentId: 'BC', nameEn: 'Seat control', nameKo: '' },
];

const qOf = (url: string) => new URL(url, 'http://x').searchParams;

/** 기본 Feature DB 응답 — 검색어가 있으면 이름·ID로 거른다 */
const api: Handler = (url) => {
  if (url.startsWith('/api/ple/autofill/')) {
    const id = decodeURIComponent(url.split('?')[0].split('/').at(-1)!);
    const refs = [AVH, HSA, OLD, GONE, CHECK];
    const selected = refs.find((r) => r.refId === id) ?? AVH;
    return { body: autofillFromRef({ ...selected }, {
      features: [{ featureId: 'FEAT-00022', version: '1.0.0', name: AVH.nameKo, country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', lifecycle: 'RELEASED', ownerId: 'Brake Engineering', featureRefs: [{ refId: AVH.refId, role: 'PRIMARY' }] }, { featureId: 'FEAT-00023', version: '1.0.0', name: HSA.nameKo, country: 'US', vehicleModel: 'IONIQ 5', trim: 'SE', lifecycle: 'RELEASED', ownerId: 'Brake Engineering', featureRefs: [{ refId: HSA.refId, role: 'PRIMARY' }] }],
      refsById: new Map(refs.map((r) => [r.refId, r])),
    }) };
  }
  if (url.startsWith('/api/refdb/taxonomy')) return { body: { items: TAXONOMY } };
  if (url.startsWith('/api/refdb/subfunctions')) return { body: { items: qOf(url).get('component') === 'Brake control (ESC/ABS)' ? [{ component: 'Brake control (ESC/ABS)', name: '정차 유지 판정', note: '' }, { component: 'Brake control (ESC/ABS)', name: '해제 조건 판단', note: '' }] : [] } };
  if (url.startsWith('/api/refdb/refs')) {
    const q = qOf(url).get('q') ?? '';
    const all = [AVH, HSA, OLD, GONE, CHECK];
    const items = all.filter((r) => !q || r.nameKo.includes(q) || r.refId.includes(q) || (r.aliases ?? []).includes(q));
    // 실제 listRefs 응답 모양 — {items,total,offset,limit,facets,release}
    return { body: { items: items.map((r) => ({ ...r, subfunctionCount: 2 })), total: items.length, offset: 0, limit: 20, facets: { domain: [], component: [], status: [] }, release: 'v1.3' } };
  }
  return undefined;
};

/** 실제 refDetail 응답 모양 — {ref, taxonomy, sources, glossary, subfunctions, policy, usedBy} */
const detailOf = (r: RefLite) => ({ ref: r, taxonomy: { domain: null, cluster: null, component: null }, sources: [], glossary: [], subfunctions: [], usedBy: [], policy: { status: r.status, replacedBy: null } });
const RegisteredDestination = () => { const location = useLocation(); return <div data-testid="registered-destination" data-search={location.search}>detail-page</div>; };

const mount = (el: JSX.Element, role = 'author', openPicker = true) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/feature/propose']}>
        <AppProvider>
          <Routes>
            <Route path="/feature/propose" element={el} />
            <Route path="/features/:id/:ver" element={<RegisteredDestination />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Existing picker scenarios start by opening the actual document's reference drawer.
  if (openPicker && el.type === ProposeScreen) fireEvent.click(screen.getByRole('button', { name: PD.chooseRefs, exact: true }));
  return rendered;
};

// The overlay keyboard manager activates the last dialog; confirmation drawers can be nested in the picker.
const activeDialog = () => screen.getAllByRole('dialog').at(-1)!;
const markOf = (label: RegExp) => (screen.getByLabelText(label).closest('.ds-field') as HTMLElement).querySelector('[data-ref-mark]')?.getAttribute('data-ref-mark');

const registerDraft = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: '다음: 등록 전 확인' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '다음: 등록 전 확인' }));
  const dialog = activeDialog();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '국가·차종·트림이 실제 적용 대상과 일치함을 확인했습니다' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '확인한 내용으로 초안 등록' }));
};

describe('등록 입력 자동화', () => {
  it('기준 적용 전에는 작성·등록을 열지 않고 기준 추가·변경 요청을 안내하며 미저장 경고를 만들지 않는다', () => {
    handler = () => undefined;
    mount(<ProposeScreen />, 'author', false);
    expect(screen.getByRole('button', { name: '기준 Feature 선택', exact: true })).toBeTruthy();
    for (const label of [/^이름/, /^설명/, /^담당/, /^국가/, /^차종/, /^트림/]) expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.queryByRole('button', { name: PD.reviewTop })).toBeNull();
    expect(screen.getByRole('button', { name: '새 기준 행 추가 요청' })).toBeEnabled();
    expect(screen.getByRole('link', { name: /Feature DB에서 기준/ })).toHaveAttribute('href', '/master/feature-db');
    expect(hasUnsaved()).toBe(false);
    fireEvent.click(screen.getByText('작성 가이드·자동 채움 항목', { exact: true }));
    expect(screen.getByText(/검증할 수 있는 결과/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('기준 Feature에서 실제 담당·적용 후보를 채우고 후보 선택 한 번으로 국가·차종·트림을 함께 바꾼다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(AVH.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    const chooser = await screen.findByRole('combobox', { name: '기존 적용 대상에서 선택' });
    await waitFor(() => expect(screen.getByLabelText(/^국가/)).toHaveValue('KR'));
    expect(screen.getByLabelText(/^담당/)).toHaveValue('Brake Engineering');
    fireEvent.change(chooser, { target: { value: 'US|IONIQ 5|SE' } });
    expect(screen.getByLabelText(/^국가/)).toHaveValue('US');
    expect(screen.getByLabelText(/^차종/)).toHaveValue('IONIQ 5');
    expect(screen.getByLabelText(/^트림/)).toHaveValue('SE');
    expect(screen.getByLabelText(/^요구사항 ID/)).toHaveValue('');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('자동 채움 응답이 늦게 와도 직접 고친 담당·적용 대상은 바꾸지 않는다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(AVH.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: '내가 정한 담당' } });
    for (const [label, value] of [[/^국가/, 'JP'], [/^차종/, '직접 지정 차종'], [/^트림/, '직접 지정 트림']] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await screen.findByRole('combobox', { name: '기존 적용 대상에서 선택' });
    expect(screen.getByLabelText(/^담당/)).toHaveValue('내가 정한 담당');
    expect(screen.getByLabelText(/^국가/)).toHaveValue('JP');
    expect(screen.getByLabelText(/^차종/)).toHaveValue('직접 지정 차종');
    expect(screen.getByLabelText(/^트림/)).toHaveValue('직접 지정 트림');
  });
});

describe('PRD 문서형 초안', () => {
  it('추가 요청을 취소하고 선택 창을 닫아도 처음 연 버튼으로 초점이 돌아온다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />, 'author', false);
    const trigger = screen.getByRole('button', { name: PD.chooseRefs });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: PC.requestNew }));
    expect(screen.queryByRole('dialog', { name: PC.steps.pick })).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog', { name: PC.request.title })).getByRole('button', { name: '닫기', exact: true }));
    fireEvent.click(within(screen.getByRole('dialog', { name: PC.steps.pick })).getByRole('button', { name: '닫기', exact: true }));
    expect(trigger).toHaveFocus();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('기준 선택을 적용하지 않고 닫으면 작성 내용·연결·기본값을 바꾸지 않는다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(AVH.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    await waitFor(() => expect(screen.getByLabelText(/^담당/)).toHaveValue('Brake Engineering'));
    fireEvent.change(screen.getByLabelText(/^이름/), { target: { value: '취소 뒤 유지할 이름' } });
    fireEvent.change(screen.getByLabelText(/^설명/), { target: { value: '직접 작성한 배경과 동작' } });
    const trigger = screen.getByRole('button', { name: PD.chooseRefs });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(HSA.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.selection.confirm }));
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '닫기', exact: true }));
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText(/^이름/)).toHaveValue('취소 뒤 유지할 이름');
    expect(screen.getByLabelText(/^설명/)).toHaveValue('직접 작성한 배경과 동작');
    expect(screen.getByLabelText(/^담당/)).toHaveValue('Brake Engineering');
    expect(screen.getByTestId('ref-linked')).toHaveTextContent(AVH.refId);
    fireEvent.click(screen.getByRole('button', { name: PD.chooseRefs }));
    expect(screen.getByRole('button', { name: PC.next })).toBeEnabled();
    expect(screen.getByRole('button', { name: PC.removeLabel(AVH.refId) })).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('기준 적용 후 작성한2000자 본문·제목·ASIL을 기준 변경 적용 후에도 유지하고 두 연결 역할을 등록한다', async () => {
    handler = (url, init) => url === '/api/features' && init?.method === 'POST' ? { status: 201, body: { featureId: 'FEAT-09999', version: '0.1.0' } } : undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(HSA.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    const prefix = '[배경과 문제]\n직접 작성한 요구\n[기대 동작]\n';
    const body = prefix + '가'.repeat(1999 - prefix.length) + '끝';
    expect(body).toHaveLength(2000);
    fireEvent.change(screen.getByLabelText(/^이름/), { target: { value: '내가 작성한 기능 문서' } });
    fireEvent.change(screen.getByLabelText(/^설명/), { target: { value: body } });
    fireEvent.change(screen.getByLabelText(/^ASIL(?! 변경)/), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: PD.chooseRefs }));
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(AVH.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.selection.confirm }));
    fireEvent.click(screen.getByRole('button', { name: PC.includeLabel(HSA.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    expect(screen.getByLabelText(/^이름/)).toHaveValue('내가 작성한 기능 문서');
    expect(screen.getByLabelText(/^설명/)).toHaveValue(body);
    expect(screen.getByLabelText(/^ASIL(?! 변경)/)).toHaveValue('D');
    fireEvent.change(screen.getByLabelText(/^ASIL 변경 사유/), { target: { value: '직접 작성한 안전 분석에 따른 분류' } });
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'ADAS기획팀' } });
    await registerDraft();
    await screen.findByText('detail-page');
    expect(screen.getByTestId('registered-destination')).toHaveAttribute('data-search', '?tab=ext');
    const sent = calls.find((c) => c.url === '/api/features' && c.method === 'POST')!.body;
    expect(sent.description).toBe(body);
    expect(sent.featureRefs).toEqual([{ refId: AVH.refId, role: 'PRIMARY' }, { refId: HSA.refId, role: 'INCLUDED' }]);
    expect(sent.asilDeviation).toMatchObject({ from: 'B', to: 'D' });
  });

  it('PRD 목차는 기존 본문 뒤에 추가되고 미리 보기는 HTML을 실행하지 않는다', async () => {
    handler = () => undefined;
    const { container } = mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(AVH.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    fireEvent.change(screen.getByLabelText(/^설명/), { target: { value: '직접 작성한 배경' } });
    fireEvent.click(screen.getByRole('button', { name: PD.template }));
    expect(screen.getByLabelText(/^설명/)).toHaveValue(`직접 작성한 배경\n\n${PRD_TEMPLATE}`);
    fireEvent.change(screen.getByLabelText(/^설명/), { target: { value: '<img src=x onerror=alert(1)>\n[완료 조건]\n원문 그대로' } });
    fireEvent.click(screen.getByRole('button', { name: PD.preview, exact: true }));
    expect(screen.getByRole('region', { name: PD.previewTitle })).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img,script')).toBeNull();
  });

  it('기존2000자 제한을 유지하며 목차 추가로 본문을 자르거나 한도를 넘기지 않는다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel(AVH.refId) }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    const body = '가'.repeat(2000);
    const input = screen.getByLabelText(/^설명/);
    fireEvent.change(input, { target: { value: body } });
    expect(input).toHaveAttribute('maxlength', '2000');
    expect(screen.getByRole('button', { name: PD.template })).toBeDisabled();
    expect(input).toHaveValue(body);
  });
});

describe('미리 채움 규칙(§6.3)', () => {
  it('이름←nameKo, 설명←정의 요약(없으면 영문명), ASIL←대표 ASIL, 태그←분류, 규제는 요구사항과 따로', () => {
    expect(prefillOf(AVH)).toEqual({ name: '오토 홀드', description: '차량이 정차한 상태에서 브레이크 압력을 유지한다.', asil: 'B', tags: 'Chassis & Vehicle Dynamics, Brake control (ESC/ABS), Application, Commodity, 공통, 글로벌' });
    expect(prefillOf(HSA).description).toBe('Hill start assist');
    expect(tagsOf(AVH)).toContain('Brake control (ESC/ABS)');
    expect(regulationsOf(AVH)).toEqual(['ISO 26262', 'UN R13-H', 'VSS Chassis.Brake.IsAutoHoldEngaged']);
    expect(regulationsOf(HSA)).toEqual([]);
  });
});

describe('Feature 제안 ① 기준 기능 고르기', () => {
  it('검색·도메인 → 컴포넌트 패싯이 질의로 가고, 대표를 고르기 전에는 다음 단계가 막힌다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    expect(screen.getByRole('heading', { level: 2, name: PC.steps.pick })).toBeTruthy();
    const next = screen.getByRole('button', { name: '다음: 등록 정보 확인' });
    expect(next).toHaveProperty('disabled', true);
    expect(within(screen.getByRole('dialog', { name: PC.steps.pick })).getByText('기본값을 가져올 작성 기준을 하나 선택하세요', { selector: '.ds-btn-why__text' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^기능 검색/), { target: { value: 'AVH' } });
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/refdb/refs') && qOf(c.url).get('q') === 'AVH')).toBe(true));
    // 도메인을 고르면 그 도메인의 컴포넌트만 나온다
    const comp = screen.getByLabelText(/^컴포넌트/) as HTMLSelectElement;
    expect(comp.disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText(/^도메인/), { target: { value: 'Chassis & Vehicle Dynamics' } });
    expect([...comp.options].map((o) => o.value)).toEqual(['', 'Brake control (ESC/ABS)']);
    fireEvent.change(comp, { target: { value: 'Brake control (ESC/ABS)' } });
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/refdb/refs') && qOf(c.url).get('component') === 'Brake control (ESC/ABS)' && qOf(c.url).get('domain') === 'Chassis & Vehicle Dynamics')).toBe(true));
    // 컴포넌트를 고르면 세부기능 후보(읽기 전용)를 보인다
    expect(await within(screen.getByTestId('ref-subfunctions')).findByText('정차 유지 판정')).toBeTruthy();
  });

  it('폐기 행은 고를 수 없고, 폐기 예정은 대체 행을 안내한 뒤 고르며, 검토 필요는 관리 메모 사유를 보인다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    const retired = await screen.findByRole('button', { name: 'CH-BRK-001 기본 정보 가져오기' });
    expect(retired).toHaveProperty('disabled', true);
    expect(within(retired.closest('tr')!).getByText('폐기된 행은 고를 수 없습니다')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'CH-BRK-001 참고로 연결' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-002 기본 정보 가져오기' }));
    const dep = screen.getByTestId('ref-deprecated');
    expect(within(dep).getByText(/대체 행 CH-BRK-009/)).toBeTruthy();
    expect(document.querySelector('[data-ref-chosen="CH-BRK-002"]')).toBeNull();
    fireEvent.click(within(dep).getByRole('button', { name: '그래도 선택' }));
    expect(document.querySelector('[data-ref-chosen="CH-BRK-002"]')?.getAttribute('data-role')).toBe('PRIMARY');

    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-007 참고로 연결' }));
    const review = document.querySelector('[data-ref-chosen="CH-BRK-007"]') as HTMLElement;
    expect(review.getAttribute('data-role')).toBe('INCLUDED');
    expect(within(review).getByText('검토 필요 — 사유: 출처가 2차 자료 (CR-2026-004)')).toBeTruthy();
    // 포함 행을 대표로 바꾸면 앞 대표는 포함이 된다(대표는 늘 하나)
    fireEvent.click(within(review).getByRole('button', { name: '이 기능 정보로 변경' }));
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '변경 적용' }));
    expect(document.querySelector('[data-ref-chosen="CH-BRK-007"]')?.getAttribute('data-role')).toBe('PRIMARY');
    expect(document.querySelector('[data-ref-chosen="CH-BRK-002"]')?.getAttribute('data-role')).toBe('INCLUDED');
    expect(document.querySelectorAll('[data-role="PRIMARY"]').length).toBe(1);
  });

  it('Feature DB에 없음 → 요청: 받은 요청 중 행이 대표가 되고 승인 막힘 안내가 뜬다', async () => {
    const PENDING = ref({ refId: 'CH-BRK-031', status: 'PENDING', nameKo: '자동 주차 브레이크 해제', nameEn: 'Auto EPB release', asilRep: 'C', definition: null, sourceDetail: '' });
    // 실제 requestRefAdd 응답 — {ref(요청 중 행), change(ADD 변경 요청)}
    const CHANGE = { changeId: 'CR-2026-031', kind: 'ADD', refId: 'CH-BRK-031', before: null, after: { refId: 'CH-BRK-031' }, reason: '등록 화면 추가 요청', requestedBy: 'usr-author', requestedAt: '2026-11-04T01:00:00.000Z', status: 'REVIEW', reviews: [], decision: null, release: null, fromRegistration: true };
    handler = (url, init) => (url === '/api/refdb/requests' && init?.method === 'POST' ? { status: 201, body: { ref: PENDING, change: CHANGE } } : undefined);
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Feature DB에 없음 → 요청' }));
    const dlg = await waitFor(activeDialog);
    const send = within(dlg).getByRole('button', { name: '기준 기능 추가 요청 후 작성에 사용' });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(await within(dlg).findByLabelText(/^도메인/), { target: { value: 'Chassis & Vehicle Dynamics' } });
    fireEvent.change(within(dlg).getByLabelText(/^컴포넌트/), { target: { value: 'Brake control (ESC/ABS)' } });
    fireEvent.change(within(dlg).getByLabelText(/^기능명 \(한글\)/), { target: { value: '자동 주차 브레이크 해제' } });
    fireEvent.change(within(dlg).getByLabelText(/^기능명 \(영문\)/), { target: { value: 'Auto EPB release' } });
    fireEvent.change(within(dlg).getByLabelText(/^T-shirt/), { target: { value: 'M' } });
    fireEvent.change(within(dlg).getByLabelText(/^대표 ASIL/), { target: { value: 'C' } });
    // 출처 ID나 근거 메모가 없으면 막힌다
    expect(within(dlg).getByText('출처 ID 또는 근거 메모를 입력하세요')).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText(/^근거 메모/), { target: { value: '사내 EPB 사양서 3.2절' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '기준 기능 추가 요청 후 작성에 사용' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: PC.request.title })).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/refdb/requests')!;
    expect(post.body).toEqual({ domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Auto EPB release', nameKo: '자동 주차 브레이크 해제', tshirt: 'M', asilRep: 'C', sourceIds: [], basisNote: '사내 EPB 사양서 3.2절', swStack: '', lifecycle: '', techStack: '' }); // 분류 속성(W5 P5-8) — 비우면 승인 뒤 검토 필요
    const chosen = document.querySelector('[data-ref-chosen="CH-BRK-031"]') as HTMLElement;
    expect(chosen.getAttribute('data-role')).toBe('PRIMARY');
    expect(within(chosen).getByText('요청 중')).toBeTruthy();
    expect(screen.getByTestId('ref-request-notice').textContent).toContain('Feature 정의 승인을 받을 수 없습니다');
    // 2단계 미리 채움도 요청 행에서
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^이름/) as HTMLInputElement).value).toBe('자동 주차 브레이크 해제');
    expect((screen.getByLabelText(/^ASIL(?! 변경)/) as HTMLSelectElement).value).toBe('C');
  });
});

describe('Feature 제안 ② 등록 정보 확인', () => {
  const toStep2 = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-006 참고로 연결' }));
    expect(within(screen.getByTestId('ref-subfunctions')).getByRole('heading', { name: 'Brake control (ESC/ABS) 세부기능 후보' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect(screen.queryByRole('dialog', { name: PC.steps.pick })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: PD.document })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/^국가/)).toHaveValue('KR'));
  };

  it('대표 행으로 미리 채우고 기준값/수정됨을 표시, ASIL을 바꾸면 사유가 필수, 본문에 featureRefs·asilDeviation·refRegulations', async () => {
    handler = (url, init) => (url === '/api/features' && init?.method === 'POST' ? { status: 201, body: { featureId: 'FEAT-00500', version: '0.1.0' } } : undefined);
    mount(<ProposeScreen />);
    await toStep2();
    const name = screen.getByLabelText(/^이름/) as HTMLInputElement;
    expect(name.value).toBe('오토 홀드');
    expect((screen.getByLabelText(/^설명/) as HTMLTextAreaElement).value).toBe('차량이 정차한 상태에서 브레이크 압력을 유지한다.');
    expect(markOf(/^이름/)).toBe('base');
    expect(markOf(/^태그/)).toBe('base');
    expect(markOf(/^ASIL(?! 변경)/)).toBe('base');
    // 규제·표준은 요구사항 칸이 아닌 따로
    expect((screen.getByLabelText(/^요구사항 ID/) as HTMLInputElement).value).toBe('');
    expect(within(screen.getByTestId('ref-regulations')).getByText('UN R13-H')).toBeTruthy();

    fireEvent.change(name, { target: { value: '오토 홀드 (원격 해제)' } });
    expect(markOf(/^이름/)).toBe('edited');
    expect(within(screen.getByLabelText(/^이름/).closest('.ds-field') as HTMLElement).getByText('수정됨')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Chassis Control Team' } });
    // 비활성 이유가 붙으면 버튼을 감싸 다시 그린다 — 매번 다시 찾는다
    const submit = () => screen.getByRole('button', { name: '다음: 등록 전 확인' });
    expect(submit()).toHaveProperty('disabled', false);

    fireEvent.change(screen.getByLabelText(/^ASIL(?! 변경)/), { target: { value: 'D' } });
    expect(markOf(/^ASIL(?! 변경)/)).toBe('edited');
    expect(submit()).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: PC.review.open })).toHaveAccessibleDescription(PC.asilReasonWhy);
    expect(screen.getByRole('button', { name: PD.reviewTop })).toHaveAccessibleDescription(PC.asilReasonWhy);
    expect(screen.getByText(/G2 Gate에서 이 사유를 확인합니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^ASIL 변경 사유/), { target: { value: '원격 해제 경로가 추가되어 상향' } });
    expect(submit()).toHaveProperty('disabled', false);

    await registerDraft();
    expect(await screen.findByText('detail-page')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/features')!;
    expect(post.body).toMatchObject({
      name: '오토 홀드 (원격 해제)',
      asil: 'D',
      requirementIds: [],
      ownerId: 'Chassis Control Team',
      country: 'KR',
      featureRefs: [
        { refId: 'CH-BRK-009', role: 'PRIMARY' },
        { refId: 'CH-BRK-006', role: 'INCLUDED' },
      ],
      asilDeviation: { from: 'B', to: 'D', reason: '원격 해제 경로가 추가되어 상향' },
      refRegulations: ['ISO 26262', 'UN R13-H', 'VSS Chassis.Brake.IsAutoHoldEngaged'],
    });
    expect(post.body.tags).toContain('Chassis & Vehicle Dynamics');
    expect(post.body.confirmDuplicate).toBeUndefined();
  });

  it('같은 범위 같은 대표 행(409 REFDB_DUPLICATE_IN_SCOPE) — 사유를 적고 확인하면 confirmDuplicate로 다시 보낸다', async () => {
    let n = 0;
    handler = (url, init) => {
      if (url !== '/api/features' || init?.method !== 'POST') return undefined;
      n++;
      return n === 1
        ? { status: 409, body: { error: { code: 'REFDB_DUPLICATE_IN_SCOPE', message: 'KR · NX4 PE · Premium에 대표 기준 행 CH-BRK-009를 쓰는 FEAT-00022가 이미 있습니다.' } } }
        : { status: 201, body: { featureId: 'FEAT-00501', version: '0.1.0' } };
    };
    mount(<ProposeScreen />);
    await toStep2();
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Chassis Control Team' } });
    await registerDraft();
    const dup = await screen.findByTestId('propose-duplicate');
    expect(within(dup).getByText(/FEAT-00022가 이미 있습니다/)).toBeTruthy();
    const confirm = () => within(screen.getByTestId('propose-duplicate')).getByRole('button', { name: '확인하고 등록' });
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.change(within(dup).getByLabelText(/^같은 기준 행으로 다시 등록하는 사유/), { target: { value: '하드웨어 변형(전동 EPB)' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').length).toBe(2));
    expect(await screen.findByText('detail-page')).toBeTruthy();
    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/api/features');
    expect(posts.length).toBe(2);
    expect(posts[0].body.confirmDuplicate).toBeUndefined();
    expect(posts[1].body).toMatchObject({ confirmDuplicate: true, duplicateReason: '하드웨어 변형(전동 EPB)' });
  });

  it('400 REFDB_LINK_REQUIRED — 대표 기준 행이 없다는 거절이면 1단계로 돌아가 안내한다', async () => {
    handler = (url, init) =>
      url === '/api/features' && init?.method === 'POST'
        ? { status: 400, body: { error: { code: 'REFDB_LINK_REQUIRED', message: '기준 기능(Feature DB)을 연결하세요 — 대표(PRIMARY) 기준 행이 하나 있어야 등록할 수 있습니다.', details: { field: 'featureRefs' } } } }
        : undefined;
    mount(<ProposeScreen />);
    await toStep2();
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Chassis Control Team' } });
    await registerDraft();
    expect(await screen.findByRole('heading', { level: 2, name: PC.steps.pick })).toBeTruthy();
    expect(screen.getByTestId('ref-request-notice').textContent).toContain('작성 기준이 없어 등록하지 못했습니다');
  });

  it('등록 응답에 서버 안내(warnings)가 있으면 먼저 보이고, 상세로는 사용자가 연다', async () => {
    // 실제 createFeature warnings — [{code, refId, message, status?}]
    const warnings = [
      { code: 'REF_STATUS', refId: 'CH-BRK-006', status: 'REVIEW', message: '기준 행 CH-BRK-006은(는) 검토 필요 상태입니다.' },
      { code: 'REF_PREREQUISITE', refId: 'CH-BRK-009', message: '기준 행 CH-BRK-009의 선행 기준 행 CH-BRK-004을(를) 같은 국가·차종·트림의 어떤 Feature도 쓰지 않습니다.' },
    ];
    handler = (url, init) => (url === '/api/features' && init?.method === 'POST' ? { status: 201, body: { featureId: 'FEAT-00502', version: '0.1.0', lifecycle: 'PROPOSED', warnings } } : undefined);
    mount(<ProposeScreen />);
    await toStep2();
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Chassis Control Team' } });
    await registerDraft();
    const box = await screen.findByTestId('propose-warnings');
    expect(within(box).getByText('기준 행 CH-BRK-006은(는) 검토 필요 상태입니다.')).toBeTruthy();
    expect(within(box).getByText(/선행 기준 행 CH-BRK-004/)).toBeTruthy();
    expect(box.querySelector('[data-warning="REF_PREREQUISITE"]')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: PC.openDetail }));
    expect(await screen.findByText('detail-page')).toBeTruthy();
    expect(screen.getByTestId('registered-destination')).toHaveAttribute('data-search', '?tab=ext');
  });

  it('기준 행 바꾸기 → 대표를 바꾸면 고치지 않은 칸만 새 기준값으로 바뀐다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    await toStep2();
    fireEvent.change(screen.getByLabelText(/^이름/), { target: { value: '내가 고친 이름' } });
    fireEvent.click(screen.getByRole('button', { name: '기준 행 바꾸기' }));
    fireEvent.click(within(document.querySelector('[data-ref-chosen="CH-BRK-006"]') as HTMLElement).getByRole('button', { name: '이 기능 정보로 변경' }));
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '변경 적용' }));
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^이름/) as HTMLInputElement).value).toBe('내가 고친 이름');
    expect((screen.getByLabelText(/^설명/) as HTMLTextAreaElement).value).toBe('Hill start assist');
    expect(markOf(/^설명/)).toBe('base');
  });
});

describe('작성 기준 변경의 실제 영향', () => {
  it('최종 확인을 닫으면 저장하지 않고 입력을 유지하며, 확인한 범위·기준 연결만 POST한다', async () => {
    handler = (url, init) => url === '/api/features' && init?.method === 'POST' ? { status: 201, body: { featureId: 'FEAT-00503', version: '0.1.0' } } : undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel('CH-BRK-009') }));
    fireEvent.click(screen.getByRole('button', { name: PC.includeLabel('CH-BRK-006') }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Brake Engineering' } });
    fireEvent.change(screen.getByLabelText(/^국가/), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText(/^차종/), { target: { value: 'IONIQ 5' } });
    fireEvent.change(screen.getByLabelText(/^트림/), { target: { value: 'SE' } });
    fireEvent.click(screen.getByRole('button', { name: PC.review.open }));
    const review = activeDialog();
    expect(review.querySelector('[data-review-scope]')?.textContent).toBe('US / IONIQ 5 / SE');
    expect(within(review).getByRole('button', { name: PC.review.submit })).toHaveProperty('disabled', true);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(within(review).getByRole('button', { name: PC.review.back }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText(/^차종/) as HTMLInputElement).value).toBe('IONIQ 5');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await registerDraft();
    await screen.findByText('detail-page');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      country: 'US', vehicleModel: 'IONIQ 5', trim: 'SE', ownerId: 'Brake Engineering', asil: 'B',
      featureRefs: [{ refId: 'CH-BRK-009', role: 'PRIMARY' }, { refId: 'CH-BRK-006', role: 'INCLUDED' }],
    });
  });

  it('비어 있는 적용 범위는 최종 확인으로 진행하거나 서버로 보낼 수 없다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: PC.primaryLabel('CH-BRK-009') }));
    fireEvent.click(screen.getByRole('button', { name: PC.next }));
    await waitFor(() => expect(screen.getByLabelText(/^국가/)).toHaveValue('KR'));
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Brake Engineering' } });
    for (const label of [/^국가/, /^차종/, /^트림/]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      const previous = input.value;
      fireEvent.change(input, { target: { value: ' ' } });
      const next = screen.getByRole('button', { name: PC.review.open });
      expect(next).toHaveProperty('disabled', true);
      fireEvent.click(next);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
      fireEvent.change(input, { target: { value: previous } });
    }
    expect(screen.getByRole('button', { name: PC.review.open })).toHaveProperty('disabled', false);
  });

  it('검색 결과로 기준을 교체하기 전 취소하면 연결·기본값이 유지되고, 확인하면 기존 기준만 제외된다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-006 참고로 연결' }));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-007 기본 정보 가져오기' }));
    const review = activeDialog();
    expect(document.querySelector('[data-ref-chosen="CH-BRK-009"]')?.getAttribute('data-role')).toBe('PRIMARY');
    expect(document.querySelector('[data-ref-chosen="CH-BRK-007"]')).toBeNull();
    fireEvent.click(within(review).getByRole('button', { name: '현재 선택 유지' }));
    expect(screen.queryByRole('dialog', { name: PC.selection.changeTitle })).toBeNull();
    expect(screen.getByRole('dialog', { name: PC.steps.pick })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^이름/) as HTMLInputElement).value).toBe('오토 홀드');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '기준 행 바꾸기' }));
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-007 기본 정보 가져오기' }));
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '변경 적용' }));
    expect(document.querySelector('[data-ref-chosen="CH-BRK-009"]')).toBeNull();
    expect(document.querySelector('[data-ref-chosen="CH-BRK-006"]')?.getAttribute('data-role')).toBe('INCLUDED');
    expect(document.querySelector('[data-ref-chosen="CH-BRK-007"]')?.getAttribute('data-role')).toBe('PRIMARY');
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^이름/) as HTMLInputElement).value).toBe('제동 등 점등');
  });

  it('관련 연결을 작성 기준으로 올릴 때 취소는 역할을 유지하고 확인은 이전 기준을 관련 연결로 보존한다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-006 참고로 연결' }));
    const promote = () => within(document.querySelector('[data-ref-chosen="CH-BRK-006"]') as HTMLElement).getByRole('button', { name: '이 기능 정보로 변경' });
    fireEvent.click(promote());
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '현재 선택 유지' }));
    expect(document.querySelector('[data-ref-chosen="CH-BRK-009"]')?.getAttribute('data-role')).toBe('PRIMARY');
    expect(document.querySelector('[data-ref-chosen="CH-BRK-006"]')?.getAttribute('data-role')).toBe('INCLUDED');
    fireEvent.click(promote());
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '변경 적용' }));
    expect(document.querySelector('[data-ref-chosen="CH-BRK-009"]')?.getAttribute('data-role')).toBe('INCLUDED');
    expect(document.querySelector('[data-ref-chosen="CH-BRK-006"]')?.getAttribute('data-role')).toBe('PRIMARY');
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^설명/) as HTMLTextAreaElement).value).toBe('Hill start assist');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe("Feature 상세 '기준 행' 탭", () => {
  it('대표·포함 행의 상태와 연결 버전, 연결 뒤 발행된 변경이면 "v1.4에서 바뀜", 요청 중이면 승인 막힘', async () => {
    handler = (url) => {
      if (url === '/api/refdb/refs/CH-BRK-009') return { body: detailOf({ ...AVH }) };
      if (url === '/api/refdb/refs/CH-BRK-031') return { body: detailOf({ ...AVH, refId: 'CH-BRK-031', nameKo: '자동 주차 브레이크 해제', status: 'PENDING' }) };
      if (url.startsWith('/api/refdb/changes')) {
        const items = qOf(url).get('refId') === 'CH-BRK-009' ? [{ changeId: 'CR-2026-010', release: 'v1.4', status: 'PUBLISHED' }, { changeId: 'CR-2026-002', release: 'v1.3', status: 'PUBLISHED' }] : [];
        return { body: { items, total: items.length } };
      }
      return undefined;
    };
    mount(
      <FeatureRefsTab
        links={[
          { refId: 'CH-BRK-031', role: 'INCLUDED', refVersion: 'v1.3' },
          { refId: 'CH-BRK-009', role: 'PRIMARY', refVersion: 'v1.3' },
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('CH-BRK-009')).toBeTruthy();
    expect(within(rows[0]).getByText('작성 기준')).toBeTruthy();
    expect(await within(rows[0]).findByText('v1.4에서 바뀜')).toBeTruthy();
    expect(await within(rows[0]).findByText('활성')).toBeTruthy();
    expect(await within(rows[1]).findByText('요청 중')).toBeTruthy();
    expect(await within(rows[1]).findByText('변경 없음')).toBeTruthy();
    expect(await screen.findByTestId('ref-blocks-approval')).toBeTruthy();
    expect(releaseCmp('v1.10', 'v1.9')).toBeGreaterThan(0);
  });

  it('연결이 없으면 — 초안은 정의 승인 막힘 안내, 확정된 Version은 새 Version에서 연결하라고(내부 용어·"초안을 고치세요" 없음)', () => {
    handler = () => undefined;
    mount(<FeatureRefsTab links={[]} lifecycle="PROPOSED" />);
    expect(screen.getByTestId('ref-blocks-approval').textContent).toBe(T.noneDraft);
    cleanup();
    mount(<FeatureRefsTab links={[]} lifecycle="RELEASED" />);
    expect(screen.getByText(T.noneFixed)).toBeTruthy();
    expect(screen.queryByTestId('ref-blocks-approval')).toBeNull();
    expect(document.body.textContent).not.toMatch(/시드|초안을 고치세요/);
  });

  it('기준 행 ID는 상세로 가는 링크, 출시된 Version에 폐기 예정 행이 있으면 대체 행과 함께 경고(막지 않음)', async () => {
    handler = (url) => {
      if (url === '/api/refdb/refs/CH-BRK-002') return { body: detailOf({ ...OLD }) };
      if (url.startsWith('/api/refdb/changes')) return { body: { items: [], total: 0 } };
      return undefined;
    };
    mount(<FeatureRefsTab links={[{ refId: 'CH-BRK-002', role: 'PRIMARY', refVersion: 'v1.3' }]} lifecycle="RELEASED" />);
    expect(screen.getByRole('link', { name: 'CH-BRK-002' }).getAttribute('href')).toBe('/master/feature-db/CH-BRK-002');
    const warn = await screen.findByTestId('ref-retired-warning');
    expect(warn.textContent).toContain('CH-BRK-002 → CH-BRK-009');
    expect(screen.queryByTestId('ref-blocks-approval')).toBeNull();
  });

  it('기준 행 조회가 실패하면 막힘 여부를 모른다고 말한다(조용히 숨기지 않는다)', async () => {
    handler = (url) => {
      if (url.startsWith('/api/refdb/refs/')) return { status: 500, body: { error: { code: 'INTERNAL', message: '서버 오류' } } };
      if (url.startsWith('/api/refdb/changes')) return { body: { items: [], total: 0 } };
      return undefined;
    };
    mount(<FeatureRefsTab links={[{ refId: 'CH-BRK-009', role: 'PRIMARY', refVersion: 'v1.3' }]} lifecycle="PROPOSED" />);
    expect((await screen.findByTestId('ref-status-unknown')).textContent).toBe(T.unknownBlock);
    expect(await screen.findAllByText(T.unknown)).toHaveLength(2);
  });
});

describe('하네스 리뷰 후속(2026-11-04) — 권한·초점·알림·배지·연결 바꾸기', () => {
  it('추가 요청은 Feature 작성자·DB 관리자만 — 조회 역할은 이유와 함께 막히고, 핵심 메시지는 "작성자만"', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />, 'viewer');
    const btn = await screen.findByRole('button', { name: PC.requestNew });
    expect(btn).toHaveProperty('disabled', true);
    expect(within(btn.closest('.ds-btn-why') as HTMLElement).getByText(/역할이 할 수 있습니다/)).toBeTruthy();
    expect(document.querySelector('[data-key-message] .ds-key__text')!.textContent).toBe(PC.key.cannot);
    cleanup();
    mount(<ProposeScreen />, 'steward');
    expect(await screen.findByRole('button', { name: PC.requestNew })).toHaveProperty('disabled', false);
  });

  it('대표로·빼기·이 기능 정보로 변경 뒤 초점이 사라진 버튼 대신 다음 자리로 가고, 바뀐 내용을 알린다(2.4.3·4.1.3)', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-picked-tag')).toBe('CH-BRK-009'));
    expect(screen.getByTestId('ref-pick-live').textContent).toBe(PC.announce.chosen('CH-BRK-009', '작성 기준'));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-006 참고로 연결' }));
    fireEvent.click(within(document.querySelector('[data-ref-chosen="CH-BRK-006"]') as HTMLElement).getByRole('button', { name: '이 기능 정보로 변경' }));
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '변경 적용' }));
    await waitFor(() => expect((document.activeElement as HTMLElement).closest('[data-ref-chosen]')?.getAttribute('data-ref-chosen')).toBe('CH-BRK-006'));
    expect(screen.getByTestId('ref-pick-live').textContent).toBe(PC.announce.madePrimary('CH-BRK-006'));
    // 빼면 다음(없으면 앞) 고른 행의 버튼으로, 다 빼면 '고른 기준 행' 제목으로
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-006 빼기' }));
    await waitFor(() => expect((document.activeElement as HTMLElement).closest('[data-ref-chosen]')?.getAttribute('data-ref-chosen')).toBe('CH-BRK-009'));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-009 빼기' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('ref-chosen-h'));
    expect(screen.getByTestId('ref-pick-live').textContent).toBe(PC.announce.removed('CH-BRK-009'));
  });

  it('폐기 예정 안내·같은 범위 중복(409) 상자가 뜨면 그 제목으로 초점이 간다', async () => {
    handler = (url, init) => (url === '/api/features' && init?.method === 'POST' ? { status: 409, body: { error: { code: 'REFDB_DUPLICATE_IN_SCOPE', message: 'KR · NX4 PE · Premium에 대표 기준 행 CH-BRK-009를 쓰는 FEAT-00022가 이미 있습니다.' } } } : undefined);
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-002 기본 정보 가져오기' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('ref-deprecated-h'));
    fireEvent.click(within(screen.getByTestId('ref-deprecated')).getByRole('button', { name: PC.cancel }));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    fireEvent.change(screen.getByLabelText(/^담당/), { target: { value: 'Chassis Control Team' } });
    await registerDraft();
    await screen.findByTestId('propose-duplicate');
    await waitFor(() => expect(document.activeElement?.id).toBe('propose-dup-h'));
    expect(within(screen.getByTestId('propose-duplicate')).getByRole('alert').textContent).toContain('FEAT-00022');
  });

  it('상태 배지는 한 벌(Lozenge) — 등록 화면과 Feature DB 화면이 같은 색 무리, 추가 요청 T-shirt는 contracts SIZE_CLASSES', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' });
    expect(document.querySelector('[data-ref-status="DEPRECATED"] .ds-lozenge')!.getAttribute('data-appearance')).toBe('moved');
    expect(document.querySelector('[data-ref-status="RETIRED"] .ds-lozenge')!.getAttribute('data-appearance')).toBe('removed');
    fireEvent.click(screen.getByRole('button', { name: PC.requestNew }));
    const dlg = await waitFor(activeDialog);
    const opts = [...(within(dlg).getByLabelText(/^T-shirt/) as HTMLSelectElement).options].map((o) => o.value).filter(Boolean);
    expect(opts).toEqual([...SIZE_CLASSES]);
  });

  it('ASIL을 바꾸면 사유 칸이 경고 안내 칸(warn)으로, 수정됨 표시는 강조 표식', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect(document.querySelector('.ds-prefill[data-prefilled="CH-BRK-009"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^ASIL(?! 변경)/), { target: { value: 'D' } });
    const box = screen.getByTestId('asil-deviation');
    expect(box.getAttribute('data-tone')).toBe('warn');
    expect(within(box).getByLabelText(/^ASIL 변경 사유/)).toBeTruthy();
    expect(document.querySelector('.ds-ref-mark[data-ref-mark="edited"]')).toBeTruthy();
  });

  it("초안의 '기준 행' 탭 — 연결 바꾸기: 대표를 바꾸면 PATCH featureRefs, 대표 ASIL이 다르면 사유, 같은 범위 중복 409는 사유와 함께 다시", async () => {
    let n = 0;
    handler = (url, init) => {
      // 지금 대표(경사로 밀림 방지)는 대표 ASIL QM — Feature ASIL과 같다
      if (url === '/api/refdb/refs/CH-BRK-006') return { body: detailOf({ ...HSA, asilRep: 'QM' }) };
      if (url.startsWith('/api/refdb/changes')) return { body: { items: [], total: 0 } };
      if (url === '/api/features/FEAT-00600/versions/0.1.0' && init?.method === 'PATCH') {
        n++;
        return n === 1 ? { status: 409, body: { error: { code: 'REFDB_DUPLICATE_IN_SCOPE', message: '같은 범위에 대표 기준 행 CH-BRK-009를 쓰는 FEAT-00022가 이미 있습니다.' } } } : { status: 200, body: {} };
      }
      return undefined;
    };
    const f = { featureId: 'FEAT-00600', version: '0.1.0', asil: 'QM', asilDeviation: null };
    mount(<FeatureRefsTab links={[{ refId: 'CH-BRK-006', role: 'PRIMARY', refVersion: 'v1.3' }]} lifecycle="PROPOSED" feature={f} />);
    fireEvent.click(await screen.findByRole('button', { name: T.edit.open }));
    const ed = await screen.findByTestId('ref-link-editor');
    await waitFor(() => expect(ed.querySelector('[data-ref-chosen="CH-BRK-006"]')).toBeTruthy());
    const save = () => within(screen.getByTestId('ref-link-editor')).getByRole('button', { name: T.edit.save }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    expect(within(ed).getByText(T.edit.noChange)).toBeTruthy();
    // 대표를 오토 홀드(대표 ASIL B)로 — Feature ASIL QM과 달라 사유가 필요하다
    fireEvent.click(await within(ed).findByRole('button', { name: 'CH-BRK-009 기본 정보 가져오기' }));
    fireEvent.click(within(activeDialog()).getByRole('button', { name: '변경 적용' }));
    expect(save().disabled).toBe(true);
    fireEvent.change(within(screen.getByTestId('ref-edit-asil')).getByLabelText(/^ASIL 변경 사유/), { target: { value: '정차 유지 기능 없는 변형' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    const dup = await screen.findByTestId('ref-edit-duplicate');
    fireEvent.change(within(dup).getByLabelText(/^같은 기준 행으로 다시 등록하는 사유/), { target: { value: '하드웨어 변형' } });
    fireEvent.click(within(dup).getByRole('button', { name: PC.duplicate.confirm }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').length).toBe(2));
    const [first, second] = calls.filter((c) => c.method === 'PATCH');
    // 새 대표를 고르면 앞 대표는 빠진다(등록 화면과 같은 규칙 — 포함으로 두려면 '포함 추가')
    expect(first.body).toEqual({ featureRefs: [{ refId: 'CH-BRK-009', role: 'PRIMARY' }], asilDeviation: { from: 'B', to: 'QM', reason: '정차 유지 기능 없는 변형' } });
    expect(second.body).toMatchObject({ confirmDuplicate: true, duplicateReason: '하드웨어 변형' });
    await waitFor(() => expect(screen.queryByTestId('ref-link-editor')).toBeNull());
  });

  it("확정된 Version의 '기준 행' 탭에는 연결 바꾸기가 없다", () => {
    handler = () => undefined;
    mount(<FeatureRefsTab links={[]} lifecycle="RELEASED" feature={{ featureId: 'FEAT-00022', version: '1.0.0', asil: 'B' }} />);
    expect(screen.queryByRole('button', { name: T.edit.openNone })).toBeNull();
  });
});
