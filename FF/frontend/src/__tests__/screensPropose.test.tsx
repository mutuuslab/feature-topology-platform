// Feature 제안 2단계 등록(30-95 §6.1·§6.3·§6.4·§5.2)과 Feature 상세 '기준 행' 탭 — 모의 API.
//   ① 검색·패싯 → 대표/포함 고르기(폐기 불가·폐기 예정 안내·검토 필요 경고) → ② 미리 채움 '기준값'/'수정됨' → ASIL 사유 → featureRefs 본문
//   추가 요청(요청 중 행을 대표로) · 같은 범위 중복 409 확인 · 등록 뒤 서버 안내
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import ProposeScreen from '../screens/home/propose/ProposeScreen';
import { prefillOf, regulationsOf, tagsOf, type RefLite } from '../screens/home/propose/prefill';
import { FeatureRefsTab, releaseCmp } from '../screens/features/FeatureRefsTab';

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

const mount = (el: JSX.Element, role = 'author') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/feature/propose']}>
        <AppProvider>
          <Routes>
            <Route path="/feature/propose" element={el} />
            <Route path="/features/:id/:ver" element={<div>detail-page</div>} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const markOf = (label: RegExp) => (screen.getByLabelText(label).closest('.ds-field') as HTMLElement).querySelector('[data-ref-mark]')?.getAttribute('data-ref-mark');

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
    expect(screen.getByRole('heading', { level: 2, name: '기준 기능 고르기' })).toBeTruthy();
    const next = screen.getByRole('button', { name: '다음: 등록 정보 확인' });
    expect(next).toHaveProperty('disabled', true);
    expect(screen.getByText('대표 기준 행을 하나 고르세요', { selector: '.ds-btn-why__text' })).toBeTruthy();

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
    const retired = await screen.findByRole('button', { name: 'CH-BRK-001 대표로' });
    expect(retired).toHaveProperty('disabled', true);
    expect(within(retired.closest('tr')!).getByText('폐기된 행은 고를 수 없습니다')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'CH-BRK-001 포함 추가' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-002 대표로' }));
    const dep = screen.getByTestId('ref-deprecated');
    expect(within(dep).getByText(/대체 행 CH-BRK-009/)).toBeTruthy();
    expect(document.querySelector('[data-ref-chosen="CH-BRK-002"]')).toBeNull();
    fireEvent.click(within(dep).getByRole('button', { name: '그래도 선택' }));
    expect(document.querySelector('[data-ref-chosen="CH-BRK-002"]')?.getAttribute('data-role')).toBe('PRIMARY');

    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-007 포함 추가' }));
    const review = document.querySelector('[data-ref-chosen="CH-BRK-007"]') as HTMLElement;
    expect(review.getAttribute('data-role')).toBe('INCLUDED');
    expect(within(review).getByText('검토 필요 — 사유: 출처가 2차 자료 (CR-2026-004)')).toBeTruthy();
    // 포함 행을 대표로 바꾸면 앞 대표는 포함이 된다(대표는 늘 하나)
    fireEvent.click(within(review).getByRole('button', { name: '대표로 바꾸기' }));
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
    const dlg = await screen.findByRole('dialog');
    const send = within(dlg).getByRole('button', { name: '요청하고 대표로 쓰기' });
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
    fireEvent.click(within(dlg).getByRole('button', { name: '요청하고 대표로 쓰기' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/refdb/requests')!;
    expect(post.body).toEqual({ domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Auto EPB release', nameKo: '자동 주차 브레이크 해제', tshirt: 'M', asilRep: 'C', sourceIds: [], basisNote: '사내 EPB 사양서 3.2절' });
    const chosen = document.querySelector('[data-ref-chosen="CH-BRK-031"]') as HTMLElement;
    expect(chosen.getAttribute('data-role')).toBe('PRIMARY');
    expect(within(chosen).getByText('요청 중')).toBeTruthy();
    expect(screen.getByTestId('ref-request-notice').textContent).toContain('Feature 승인을 할 수 없습니다');
    // 2단계 미리 채움도 요청 행에서
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^이름/) as HTMLInputElement).value).toBe('자동 주차 브레이크 해제');
    expect((screen.getByLabelText(/^ASIL(?! 변경)/) as HTMLSelectElement).value).toBe('C');
  });
});

describe('Feature 제안 ② 등록 정보 확인', () => {
  const toStep2 = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'CH-BRK-009 대표로' }));
    fireEvent.click(screen.getByRole('button', { name: 'CH-BRK-006 포함 추가' }));
    expect(within(screen.getByTestId('ref-subfunctions')).getByRole('heading', { name: 'Brake control (ESC/ABS) 세부기능 후보' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect(screen.getByRole('heading', { level: 2, name: '등록 정보 확인' })).toBeTruthy();
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
    const submit = () => screen.getByRole('button', { name: '제안 등록' });
    expect(submit()).toHaveProperty('disabled', false);

    fireEvent.change(screen.getByLabelText(/^ASIL(?! 변경)/), { target: { value: 'D' } });
    expect(markOf(/^ASIL(?! 변경)/)).toBe('edited');
    expect(submit()).toHaveProperty('disabled', true);
    expect(screen.getByText('ASIL을 바꾼 사유를 2자 이상 입력하세요', { selector: '.ds-btn-why__text' })).toBeTruthy();
    expect(screen.getByText(/G2 Gate에서 이 사유를 확인합니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^ASIL 변경 사유/), { target: { value: '원격 해제 경로가 추가되어 상향' } });
    expect(submit()).toHaveProperty('disabled', false);

    fireEvent.click(submit());
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
    fireEvent.click(screen.getByRole('button', { name: '제안 등록' }));
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
    fireEvent.click(screen.getByRole('button', { name: '제안 등록' }));
    expect(await screen.findByRole('heading', { level: 2, name: '기준 기능 고르기' })).toBeTruthy();
    expect(screen.getByTestId('ref-request-notice').textContent).toContain('대표 기준 행이 없어 등록하지 못했습니다');
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
    fireEvent.click(screen.getByRole('button', { name: '제안 등록' }));
    const box = await screen.findByTestId('propose-warnings');
    expect(within(box).getByText('기준 행 CH-BRK-006은(는) 검토 필요 상태입니다.')).toBeTruthy();
    expect(within(box).getByText(/선행 기준 행 CH-BRK-004/)).toBeTruthy();
    expect(box.querySelector('[data-warning="REF_PREREQUISITE"]')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Feature 상세 열기' }));
    expect(await screen.findByText('detail-page')).toBeTruthy();
  });

  it('기준 행 바꾸기 → 대표를 바꾸면 고치지 않은 칸만 새 기준값으로 바뀐다', async () => {
    handler = () => undefined;
    mount(<ProposeScreen />);
    await toStep2();
    fireEvent.change(screen.getByLabelText(/^이름/), { target: { value: '내가 고친 이름' } });
    fireEvent.click(screen.getByRole('button', { name: '기준 행 바꾸기' }));
    fireEvent.click(within(document.querySelector('[data-ref-chosen="CH-BRK-006"]') as HTMLElement).getByRole('button', { name: '대표로 바꾸기' }));
    fireEvent.click(screen.getByRole('button', { name: '다음: 등록 정보 확인' }));
    expect((screen.getByLabelText(/^이름/) as HTMLInputElement).value).toBe('내가 고친 이름');
    expect((screen.getByLabelText(/^설명/) as HTMLTextAreaElement).value).toBe('Hill start assist');
    expect(markOf(/^설명/)).toBe('base');
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
    expect(within(rows[0]).getByText('대표')).toBeTruthy();
    expect(await within(rows[0]).findByText('v1.4에서 바뀜')).toBeTruthy();
    expect(await within(rows[0]).findByText('활성')).toBeTruthy();
    expect(await within(rows[1]).findByText('요청 중')).toBeTruthy();
    expect(await within(rows[1]).findByText('변경 없음')).toBeTruthy();
    expect(await screen.findByTestId('ref-blocks-approval')).toBeTruthy();
    expect(releaseCmp('v1.10', 'v1.9')).toBeGreaterThan(0);
  });

  it('연결이 없으면 빈 상태, 시드 대응표에 없으면 그 안내', () => {
    handler = () => undefined;
    mount(<FeatureRefsTab links={[]} missing="seed-links에 대응 없음" />);
    expect(screen.getByText(/시드 대응표에 기준 행이 없습니다/)).toBeTruthy();
  });
});
