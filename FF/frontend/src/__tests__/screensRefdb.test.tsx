// Feature DB 화면(30-95 §4·§5.2·§8) — 목록(품질 지표·패싯·검색), 상세(연결 Feature·상태 정책·금액 칸), 변경 요청(차이·검토·승인 버튼 이유). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { REF_STATUS_POLICY, type RefChange } from '@ff/contracts';
import { AppProvider } from '../store';
import { FeatureDbScreen } from '../screens/refdb/RefList';
import { RefDetailScreen } from '../screens/refdb/RefDetail';
import { RefChangeDetailScreen, RefChangesScreen } from '../screens/refdb/Changes';
import { featureDb as L, refChangeDetail as D, refChanges as C, refDetail as RD, refSources as S } from '../copy/refdb';
import { workbook as WB } from '../copy/workbook';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = handler(url, init) ?? { body: { items: [] } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
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

const ROW = {
  refId: 'CH-BRK-009',
  status: 'ACTIVE',
  replacedBy: null,
  registeredIn: 'v0.5',
  evidenceCheckedAt: '2026-09-20',
  domain: 'Chassis & Vehicle Dynamics',
  cluster: 'Brake',
  component: 'Brake control (ESC/ABS)',
  swStack: 'Application',
  lifecycle: 'Commodity',
  techStack: 'Automotive',
  vehicleType: '공통',
  region: '글로벌',
  nameEn: 'Auto hold',
  nameKo: '오토 홀드',
  aliases: ['AVH', 'auto hold'],
  autoQuality: 'High',
  techQuality: 'High',
  asilRep: 'B',
  method: 'Parametric (T-shirt)',
  tshirt: 'S',
  bundleId: null,
  bundleRep: null,
  sizeEvidenceGrade: 'D',
  makeBuyVolume: 'Buy',
  makeBuyPremium: 'Buy',
  relevance: 'High',
  sourceIds: ['S10'],
  sourceDetail: 'VSS Chassis.Brake.AutoHold',
  remark: '',
  basisType: '표준 기반 도출',
  duplicateOf: null,
  requires: ['CH-BRK-001'],
  excludes: [],
  procurement: '협력사 개발',
  swPackage: '',
  licenseItem: '',
  billing: '',
  definition: { summary: '정차하면 브레이크 압력을 유지한다.', scopeIn: ['압력 유지', '출발 해제'] },
  adminMemo: '',
};
const ROW2 = { ...ROW, refId: 'CH-BRK-006', nameKo: '경사로 밀림 방지', nameEn: 'Hill start assist', status: 'REVIEW', adminMemo: '2차 자료 근거' };

const QUALITY = {
  total: 1052,
  byStatus: { ACTIVE: 995, REVIEW: 53, DEPRECATED: 4, RETIRED: 0, PENDING: 0 },
  statusMissing: 0,
  noSource: 0,
  evidenceStale: 12,
  sizeGradeDShare: 0.836,
  awaitingPublish: 2,
  openChanges: 1,
  latestRelease: 'v1.3',
  needsLink: { total: 0, items: [] },
};
const TAXONOMY = [
  { nodeId: 'CH', level: 'DOMAIN', parentId: null, nameEn: 'Chassis & Vehicle Dynamics', nameKo: '', abbr: 'CH', status: 'ACTIVE' },
  { nodeId: 'BC', level: 'DOMAIN', parentId: null, nameEn: 'Body & Comfort', nameKo: '', abbr: 'BC', status: 'ACTIVE' },
  { nodeId: 'CH/Brake control (ESC/ABS)', level: 'COMPONENT', parentId: 'CH', nameEn: 'Brake control (ESC/ABS)', nameKo: '', abbr: 'BRK', status: 'ACTIVE' },
  { nodeId: 'BC/Seat control', level: 'COMPONENT', parentId: 'BC', nameEn: 'Seat control', nameKo: '', abbr: 'SEAT', status: 'ACTIVE' },
];

const CHANGE: RefChange = {
  changeId: 'CR-2026-001',
  kind: 'MODIFY',
  refId: 'CH-BRK-009',
  before: { asilRep: 'B', tshirt: 'S' },
  after: { asilRep: 'C', tshirt: 'M' },
  reason: '사내 실적 반영',
  requestedBy: 'usr-author',
  requestedAt: '2026-11-04T01:00:00.000Z',
  status: 'REVIEW',
  reviews: [],
  decision: null,
  release: null,
  checks: [
    { id: 'REQUIRED_INFO', ok: true, blocking: true, message: '필수 정보가 모두 있습니다' },
    { id: 'SIZE_EVIDENCE', ok: false, blocking: false, message: '규모 근거 비교 행이 없습니다' },
  ],
};
// 실제 응답 모양(backend refdb-read.service·refdb-change.service) — 상세 usedBy는 이름·상태·적용 범위를 함께, 변경 요청 상세 usedBy는 연결 색인 그대로
const USED_DETAIL = [{ featureId: 'FEAT-00022', version: '1.0.0', role: 'PRIMARY', refVersion: 'v1.3', lifecycle: 'RELEASED', name: '전방 안전거리 3단계', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }];
const USED_LINKS = [{ featureId: 'FEAT-00022', version: '1.0.0', refId: 'CH-BRK-009', role: 'PRIMARY', refVersion: 'v1.3' }];
const SOURCE = { sourceId: 'S10', title: 'COVESA VSS', publisher: 'COVESA', version: '4.2', url: 'https://covesa.github.io/vehicle_signal_specification/', checkedAt: null, nextReviewAt: null };
const DETAIL = {
  ref: ROW,
  taxonomy: { domain: TAXONOMY[0], cluster: null, component: TAXONOMY[2] },
  sources: [{ sourceId: 'S10', source: SOURCE }],
  glossary: [{ term: '오토홀드', meaning: '정차 유지', refIds: ['CH-BRK-009'], status: '확정' }],
  subfunctions: [{ component: ROW.component, name: '압력 유지 판단', note: '' }],
  usedBy: USED_DETAIL,
  policy: { status: 'ACTIVE', ...REF_STATUS_POLICY.ACTIVE, replacedBy: null },
};
const CHANGE_DETAIL = {
  change: { ...CHANGE, awaitingPublish: false, domain: 'Chassis & Vehicle Dynamics' },
  diff: [],
  checks: CHANGE.checks,
  impact: { features: [{ featureId: 'FEAT-00022', version: '1.0.0', role: 'PRIMARY', refVersion: 'v1.3', name: '전방 안전거리 3단계', ownerId: 'ADAS기획팀', lifecycle: 'RELEASED' }], recalcRequired: true, recalcFields: ['asilRep', 'tshirt'], costProjects: [] },
  usedBy: USED_LINKS,
};
const RELEASE = { release: 'v1.3', publishedBy: 'usr-steward', publishedAt: '2026-11-04T00:00:00.000Z', changeIds: [], hash: 'a'.repeat(64) };

const api: Handler = (url) => {
  if (url.startsWith('/api/refdb/quality')) return { body: QUALITY };
  if (url.startsWith('/api/refdb/taxonomy')) return { body: { items: TAXONOMY } };
  if (url.startsWith('/api/refdb/sources')) return { body: { items: [SOURCE] } };
  if (url.startsWith('/api/refdb/refs/CH-BRK-009')) return { body: DETAIL };
  if (url.startsWith('/api/refdb/refs')) {
    const q = new URL(url, 'http://x').searchParams.get('q');
    const items = (q ? [ROW].filter((r) => r.aliases.includes(q) || r.nameKo.includes(q)) : [ROW, ROW2]).map((r) => ({ ...r, subfunctionCount: 1 }));
    // 실제 패싯 모양(read-search.ts) — 상태 축은 상태 필터를 빼고 지금 조건으로 센 수
    const status = { ACTIVE: 0, REVIEW: 0, DEPRECATED: 0, RETIRED: 0, PENDING: 0 } as Record<string, number>;
    for (const r of items) status[r.status]++;
    return { body: { items, total: q ? 1 : 1052, offset: 0, limit: 50, facets: { domain: {}, component: {}, status }, release: 'v1.3' } };
  }
  if (url.startsWith('/api/refdb/changes/CR-2026-001')) return { body: CHANGE_DETAIL };
  if (url.startsWith('/api/refdb/changes')) {
    const items = [CHANGE, { ...CHANGE, changeId: 'CR-2026-002', status: 'APPROVED' as const }].map((c) => ({ ...c, awaitingPublish: c.status === 'APPROVED', domain: ROW.domain }));
    return { body: { items, total: items.length } };
  }
  if (url.startsWith('/api/refdb/releases')) return { body: { items: [RELEASE] } };
};

describe('Feature DB 목록', () => {
  it('기준 행 수와 발행 대기 pill, 품질 지표 한 줄, 행과 도메인 → 컴포넌트 패싯을 보인다', async () => {
    handler = api;
    mount('viewer', '/master/feature-db', '/master/feature-db', <FeatureDbScreen />);
    expect(await screen.findByText('오토 홀드')).toBeTruthy();
    expect(screen.getByText('CH-BRK-006')).toBeTruthy();
    const key = document.querySelector('[data-key-message]')!;
    expect(key.querySelector('.ds-key__value')!.textContent).toBe('1,052');
    // pill은 낱말 — 수(2)는 요약 줄이 말한다(⑪, pill이 '발행 대기 2'로 요약 줄을 되풀이하던 결함)
    expect(key.querySelector('.ds-key__status')!.textContent).toBe(L.awaiting);
    expect(key.querySelector('.ds-key__status')!.textContent).not.toMatch(/d/);
    const summary = screen.getByRole('group', { name: L.quality });
    expect(summary.textContent).toContain(`${L.q.stale} 12`);
    expect(summary.textContent).toContain('83.6%');
    expect(document.querySelector('.ds-kpis')).toBeNull();
    // 왼쪽 분류 트리 — 컴포넌트는 도메인을 고르기 전에는 숨어 있고, 고르면 그 도메인의 컴포넌트만 펼친다
    const tree = screen.getByRole('navigation', { name: WB.tree });
    expect(within(tree).queryByRole('button', { name: /^Brake control/ })).toBeNull();
    fireEvent.click(within(tree).getByRole('button', { name: /^Chassis & Vehicle Dynamics/ }));
    await waitFor(() => expect(within(tree).getByRole('button', { name: /^Brake control \(ESC\/ABS\)/ })).toBeTruthy());
    expect(within(tree).queryByRole('button', { name: /^Seat control/ })).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/refdb/refs?') && c.url.includes('domain=Chassis'))).toBe(true));
    // 상태 탭 수는 지금 조건의 패싯(행 2개) — 전체 품질 지표(1052·995)가 아니다
    const tab = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) }).querySelector('.ds-seg__count')?.textContent;
    expect(tab(L.allStatus)).toBe('2');
    expect(tab(REF_STATUS_POLICY.ACTIVE.ko)).toBe('1');
    expect(tab(REF_STATUS_POLICY.REVIEW.ko)).toBe('1');
    // 상태 배지 툴팁은 정책 안내
    expect(document.querySelector('[data-ref-status="REVIEW"]')!.getAttribute('title')).toBe(REF_STATUS_POLICY.REVIEW.hint);
  });

  it('검색어를 넣으면 q 질의로 다시 조회한다', async () => {
    handler = api;
    mount('viewer', '/master/feature-db', '/master/feature-db', <FeatureDbScreen />);
    await screen.findByText('경사로 밀림 방지');
    fireEvent.change(screen.getByRole('searchbox', { name: L.search }), { target: { value: 'AVH' } });
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=AVH'))).toBe(true));
    await waitFor(() => expect(screen.queryByText('경사로 밀림 방지')).toBeNull());
    expect(screen.getByText('오토 홀드')).toBeTruthy();
    // 검색하면 상태 탭 수도 검색 결과 기준(활성 1·검토 필요 0)
    await waitFor(() => expect(screen.getByRole('radio', { name: new RegExp(`^${REF_STATUS_POLICY.REVIEW.ko}`) }).querySelector('.ds-seg__count')?.textContent).toBe('0'));
  });
});

describe('Feature DB 상세', () => {
  it('이 행을 쓰는 Feature 링크·상태 정책·정의·출처를 보이고, 금액 칸은 응답에 없으면 그리지 않는다', async () => {
    handler = api;
    mount('author', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: '오토 홀드' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /FEAT-00022/ });
    expect(link.getAttribute('href')).toBe('/features/FEAT-00022/1.0.0');
    // 이 행을 쓰는 Feature — 이름·적용 범위·상태
    const used = document.getElementById('ref-linked-h')!.closest('section')!;
    expect(used.textContent).toContain('전방 안전거리 3단계');
    expect(used.textContent).toContain('KR · NX4 PE · Premium');
    expect(screen.getByText(/오토홀드 \(정차 유지\)/)).toBeTruthy();
    // 출처는 상세 응답의 sources로 — 출처 목록을 따로 부르지 않는다
    expect(calls.some((c) => c.url.startsWith('/api/refdb/sources'))).toBe(false);
    expect(document.querySelector('[data-policy-hint]')!.textContent).toBe(REF_STATUS_POLICY.ACTIVE.hint);
    expect(screen.getByText('정차하면 브레이크 압력을 유지한다.')).toBeTruthy();
    expect(screen.getByText('압력 유지 판단')).toBeTruthy();
    expect(await screen.findByText(/COVESA VSS/)).toBeTruthy();
    expect(screen.queryByText(RD.benchmark)).toBeNull();
    expect(screen.getByRole('link', { name: 'CH-BRK-001' }).getAttribute('href')).toBe('/master/feature-db/CH-BRK-001');
  });

  it('금액 칸(벤치마크 €)은 서버가 줄 때만 보인다', async () => {
    handler = (url) => (url.startsWith('/api/refdb/refs/CH-BRK-009') ? { body: { ...DETAIL, ref: { ...ROW, benchmarkEur: 120000, kearneyNote: 'Kearney 2022' }, subfunctions: [], usedBy: [] } } : api(url));
    mount('author', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    expect(await screen.findByText(RD.benchmark)).toBeTruthy();
    expect(screen.getByText('Kearney 2022')).toBeTruthy();
  });

  it('변경 요청 — 바꾼 칸만 보내고 자동 점검 결과를 보인다, 조회 역할은 이유와 함께 막힌다', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { status: 201, body: { ...CHANGE, awaitingPublish: false, domain: ROW.domain } } : api(url));
    mount('author', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    await screen.findByRole('heading', { level: 1, name: '오토 홀드' });
    fireEvent.click(screen.getByRole('button', { name: RD.change }));
    const dlg = await screen.findByRole('dialog');
    const send = () => within(dlg).getByRole('button', { name: /변경 요청 보내기/ }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(within(dlg).getByText('바꾼 값이 없습니다')).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText(RD.f.asilRep), { target: { value: 'C' } });
    fireEvent.change(within(dlg).getByLabelText('요청 사유'), { target: { value: '사내 실적 반영' } });
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ kind: 'MODIFY', refId: 'CH-BRK-009', after: { asilRep: 'C' }, reason: '사내 실적 반영' }));
    expect(await within(dlg).findByText('규모 근거 비교 행이 없습니다')).toBeTruthy();
    expect(dlg.querySelector('[data-check="SIZE_EVIDENCE"]')!.getAttribute('data-state')).toBe('INFO');
    cleanup();
    mount('viewer', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    const btn = (await screen.findByRole('button', { name: RD.change })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(screen.getByText(/역할이 할 수 있습니다/)).toBeTruthy();
  });

  it('A → B → A로 오가도 변경 요청 서랍은 지금 행의 값으로 시작한다(서랍 입력이 앞 행 값으로 남던 결함)', async () => {
    // B는 A를 선행으로 둔다 — 관계 칸의 링크로 A ↔ B를 오간다. 돌아온 A는 캐시가 있어 로딩 없이 바로 그린다
    const B = { ...ROW, refId: 'CH-BRK-001', nameKo: '기본 제동 보조', nameEn: 'Basic brake assist', asilRep: 'D', tshirt: 'L', requires: ['CH-BRK-009'] };
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: { ...CHANGE, awaitingPublish: false, domain: ROW.domain } };
      if (url.startsWith('/api/refdb/refs/CH-BRK-001')) return { body: { ...DETAIL, ref: B, usedBy: [] } };
      return api(url);
    };
    mount('author', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    await screen.findByRole('heading', { level: 1, name: '오토 홀드' });
    fireEvent.click(screen.getByRole('link', { name: 'CH-BRK-001' }));
    await screen.findByRole('heading', { level: 1, name: '기본 제동 보조' });
    fireEvent.click(screen.getByRole('link', { name: 'CH-BRK-009' }));
    await screen.findByRole('heading', { level: 1, name: '오토 홀드' });
    fireEvent.click(screen.getByRole('button', { name: RD.change }));
    const dlg = await screen.findByRole('dialog');
    expect((within(dlg).getByLabelText(RD.f.nameKo) as HTMLInputElement).value).toBe('오토 홀드');
    expect((within(dlg).getByLabelText(RD.f.asilRep) as HTMLSelectElement).value).toBe('B');
    expect(within(dlg).getByText('바꾼 값이 없습니다')).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText(RD.f.tshirt), { target: { value: 'M' } });
    fireEvent.change(within(dlg).getByLabelText('요청 사유'), { target: { value: '사내 실적 반영' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /변경 요청 보내기/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ kind: 'MODIFY', refId: 'CH-BRK-009', after: { tshirt: 'M' }, reason: '사내 실적 반영' }));
  });

  it('머리에 대표 ASIL·T-shirt 칩', async () => {
    handler = api;
    mount('viewer', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    await screen.findByRole('heading', { level: 1, name: '오토 홀드' });
    expect(document.querySelector('.ds-page [data-meta="asil"]')!.textContent).toBe(`${RD.f.asilRep} B`);
    expect(document.querySelector('.ds-page [data-meta="tshirt"] .ds-mono')!.textContent).toBe('S');
  });
});

describe('Feature DB 변경 요청', () => {
  it('목록에서 승인 뒤 돌아오면 캐시된 발행 미리 보기도 새 승인 요청을 반영한다', async () => {
    let approved = false;
    const reviewed = { ...CHANGE, reviews: [{ reviewerId: 'usr-approver', opinion: 'AGREE' as const, comment: '근거 확인', at: '2026-11-04T01:30:00.000Z' }] };
    const quality = { published: 1052, pending: 0, noSource: 0, attrMissing: 0, awaitingPublish: 0 };
    handler = (url, init) => {
      if (url === '/api/refdb/releases/preview') return { body: {
        release: 'v1.4', latest: 'v1.3', total: approved ? 1 : 0,
        approved: approved ? [{ changeId: CHANGE.changeId, kind: CHANGE.kind, refId: CHANGE.refId, nameKo: ROW.nameKo, status: 'ACTIVE', requestedBy: CHANGE.requestedBy, decidedBy: 'usr-steward', decidedAt: '2026-11-04T02:00:00.000Z' }] : [],
        retiring: [], notify: [], quality: { before: quality, after: quality }, memo: approved ? 'v1.4 발행 — 승인 1건' : '',
      } };
      if (url.endsWith('/decision') && init?.method === 'POST') { approved = true; return { body: { ...reviewed, status: 'APPROVED' } }; }
      if (url.startsWith('/api/refdb/changes/CR-2026-001')) return { body: { ...CHANGE_DETAIL, change: { ...reviewed, status: approved ? 'APPROVED' : 'REVIEW' } } };
      if (url === '/api/refdb/changes') return { body: { items: [{ ...reviewed, status: approved ? 'APPROVED' : 'REVIEW' }] } };
      return api(url, init);
    };
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'steward' }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/master/feature-db/changes']}><AppProvider><Routes>
      <Route path="/master/feature-db/changes" element={<RefChangesScreen />} />
      <Route path="/master/feature-db/changes/:id" element={<RefChangeDetailScreen />} />
    </Routes></AppProvider></MemoryRouter></QueryClientProvider>);
    await screen.findByText(CHANGE.changeId);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/refdb/releases/preview')).toBe(true));
    expect((document.querySelector('[data-ui="publishRefRelease"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: CHANGE.changeId }));
    fireEvent.change(await screen.findByLabelText(D.decideReason), { target: { value: '근거 검토 완료' } });
    fireEvent.click(screen.getByRole('button', { name: D.approve }));
    await waitFor(() => expect(approved).toBe(true));
    fireEvent.click(screen.getByRole('link', { name: D.back }));
    await waitFor(() => expect(document.querySelector(`[data-publish-change="${CHANGE.changeId}"]`)).not.toBeNull());
    const publish = document.querySelector('[data-ui="publishRefRelease"]') as HTMLButtonElement;
    expect(publish.textContent).toBe('v1.4 발행 (1건)');
    expect(publish.disabled).toBe(false);
  });

  it('상세 — 필드 차이·영향 Feature·재계산 안내를 보인다', async () => {
    handler = api;
    mount('viewer', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByText(D.recalc);
    const cells = [...document.querySelectorAll('.ds-diff [role="cell"]')].map((c) => c.textContent);
    expect(cells).toEqual([RD.f.asilRep, 'B', 'C', RD.f.tshirt, 'S', 'M']);
    expect(screen.getByRole('link', { name: /FEAT-00022/ }).getAttribute('href')).toBe('/features/FEAT-00022/1.0.0');
    // 영향은 impact.features — 이름까지
    expect(document.getElementById('cr-impact-h')!.closest('section')!.textContent).toContain('전방 안전거리 3단계');
    expect(screen.getByText(D.recalc)).toBeTruthy();
    // 조회 역할에는 검토·승인 칸이 없다
    expect(screen.queryByRole('button', { name: D.submitReview })).toBeNull();
    expect(screen.queryByRole('button', { name: D.approve })).toBeNull();
  });

  it('도메인 검토자는 의견 칸을 보고, 요청자 본인이면 이유와 함께 막힌다', async () => {
    handler = api;
    mount('approver', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    const send = () => screen.getByRole('button', { name: D.submitReview }) as HTMLButtonElement;
    await screen.findByRole('button', { name: D.submitReview });
    expect(send().disabled).toBe(true);
    expect(screen.getByText(D.why.comment)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(D.comment), { target: { value: '동의합니다' } });
    await waitFor(() => expect(send().disabled).toBe(false));
    expect(screen.queryByRole('button', { name: D.approve })).toBeNull();
    cleanup();
    handler = (url) => (url.startsWith('/api/refdb/changes/CR-2026-001') ? { body: { ...CHANGE_DETAIL, change: { ...CHANGE_DETAIL.change, requestedBy: 'usr-approver' } } } : api(url));
    mount('approver', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByRole('button', { name: D.submitReview });
    // 버튼 이유는 사람이 읽는 문장만 — 내부 규칙 코드(SOD-14)는 보이지 않는다(3초 ⑨)
    const why = screen.getByText(/변경 요청자는 자기 요청을 검토할 수 없습니다/, { selector: '.ds-btn-why__text' });
    expect(why.textContent).not.toMatch(/\bSOD-\d/);
    expect(document.body.textContent).not.toMatch(/\bSOD-\d/);
  });

  it('Feature DB 관리자 — 검토 의견이 없으면 승인은 이유와 함께 막히고 반려는 사유만 있으면 된다', async () => {
    handler = api;
    mount('steward', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByRole('button', { name: D.approve });
    const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(screen.queryByRole('button', { name: D.submitReview })).toBeNull();
    fireEvent.change(screen.getByLabelText(D.decideReason), { target: { value: '근거 부족' } });
    await waitFor(() => expect(btn(D.reject).disabled).toBe(false));
    expect(btn(D.approve).disabled).toBe(true);
    expect(screen.getByText(D.why.noReview)).toBeTruthy();
  });

  it('승인 422 REVIEW_REQUIRED — 그사이 검토 의견이 빠졌으면 서버 문장을 그대로 보인다', async () => {
    const reviewed = { ...CHANGE_DETAIL.change, reviews: [{ reviewerId: 'usr-approver', opinion: 'AGREE' as const, comment: '동의', at: '2026-11-04T01:30:00.000Z' }] };
    handler = (url, init) => {
      if (init?.method === 'POST' && url.endsWith('/decision')) return { status: 422, body: { error: { code: 'GUARD_FAILED', message: '도메인 검토 의견이 하나 이상 있어야 승인할 수 있습니다.', details: { code: 'REVIEW_REQUIRED' } } } };
      if (url.startsWith('/api/refdb/changes/CR-2026-001')) return { body: { ...CHANGE_DETAIL, change: reviewed } };
      return api(url);
    };
    mount('steward', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByRole('button', { name: D.approve });
    fireEvent.change(screen.getByLabelText(D.decideReason), { target: { value: '근거 확인' } });
    const approve = () => screen.getByRole('button', { name: D.approve }) as HTMLButtonElement;
    await waitFor(() => expect(approve().disabled).toBe(false));
    fireEvent.click(approve());
    expect(await screen.findByText(/도메인 검토 의견이 하나 이상 있어야 승인할 수 있습니다/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'APPROVE', reason: '근거 확인' });
  });

  it('목록 — 상태 탭과 발행 대기 수, 관리자의 버전 발행 버튼과 발행 해시', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { status: 201, body: { release: { release: 'v1.4', publishedBy: 'usr-steward', publishedAt: '2026-11-04T02:00:00.000Z', changeIds: ['CR-2026-002'], hash: 'b'.repeat(64), note: '' }, applied: [], retired: [] } } : api(url));
    mount('steward', '/master/feature-db/changes', '/master/feature-db/changes', <RefChangesScreen />);
    expect(await screen.findByText('CR-2026-001')).toBeTruthy();
    expect(screen.getByRole('tab', { name: new RegExp(C.tabs.APPROVED) }).textContent).toContain('1');
    // pill은 낱말(수는 탭이 말한다)
    expect(document.querySelector('[data-key-message] .ds-key__status')!.textContent).toBe(L.awaiting);
    const publish = (await screen.findByRole('button', { name: C.publishBtn(1) })) as HTMLButtonElement;
    // 발행 메모는 필수(W5 P5-4) — 미리 보기가 없으면 비어 있다
    expect(publish.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /발행 메모/ }), { target: { value: 'v1.4 발행 — 승인 1건' } });
    await waitFor(() => expect((screen.getByRole('button', { name: C.publishBtn(1) }) as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('[data-hash]')!.getAttribute('data-hash')).toBe('a'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: C.publishBtn(1) }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/refdb/releases')).toBe(true));
    expect(await screen.findByText(C.published('v1.4'))).toBeTruthy();
    cleanup();
    // 조회 역할에는 발행 칸이 없다, 내보내기는 누구나
    mount('viewer', '/master/feature-db/changes', '/master/feature-db/changes', <RefChangesScreen />);
    await screen.findByText('CR-2026-001');
    expect(screen.queryByRole('button', { name: /버전 발행/ })).toBeNull();
    expect((await screen.findByRole('button', { name: C.export }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('하네스 리뷰 후속(2026-11-04) — 직무 분리 문장·검토 의견·출처 점검', () => {
  const decider = (change: object) => (url: string, init?: RequestInit) => (url.startsWith('/api/refdb/changes/CR-2026-001') && init?.method !== 'POST' ? { body: { ...CHANGE_DETAIL, change: { ...CHANGE_DETAIL.change, ...change } } } : api(url));

  it('관리자 — 요청자 본인이면 승인·반려 모두 문장 이유로 막힌다(코드 없음)', async () => {
    handler = decider({ requestedBy: 'usr-steward' });
    mount('steward', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByRole('button', { name: D.approve });
    fireEvent.change(screen.getByLabelText(D.decideReason), { target: { value: '근거 확인' } });
    expect((screen.getByRole('button', { name: D.reject }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('변경 요청자는 자기 요청을 승인·반려할 수 없습니다', { selector: '.ds-btn-why__text' }).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/\bSOD-\d/);
  });

  it('관리자 — 이 요청에 검토 의견을 낸 사람이면 승인·반려할 수 없다', async () => {
    handler = decider({ reviews: [{ reviewerId: 'usr-steward', opinion: 'AGREE', comment: '동의', at: '2026-11-04T01:30:00.000Z' }] });
    mount('steward', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByRole('button', { name: D.approve });
    expect(screen.getAllByText('이 요청에 검토 의견을 낸 사람은 승인·반려할 수 없습니다', { selector: '.ds-btn-why__text' }).length).toBe(2);
  });

  it("마지막 검토 의견이 '보완'이면 승인은 이유와 함께 막히고, 반려는 된다", async () => {
    handler = decider({
      reviews: [
        { reviewerId: 'usr-a', opinion: 'AGREE', comment: '동의', at: '2026-11-04T01:00:00.000Z' },
        { reviewerId: 'usr-approver', opinion: 'REVISE', comment: '출처 보완', at: '2026-11-04T02:00:00.000Z' },
      ],
    });
    mount('steward', '/master/feature-db/changes/CR-2026-001', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    await screen.findByRole('button', { name: D.approve });
    fireEvent.change(screen.getByLabelText(D.decideReason), { target: { value: '근거 확인' } });
    await waitFor(() => expect((screen.getByRole('button', { name: D.reject }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole('button', { name: D.approve }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(D.why.lastOpinion('보완'), { selector: '.ds-btn-why__text' })).toBeTruthy();
  });

  const SOURCES = [
    { sourceId: 'S10', title: 'COVESA VSS', publisher: 'COVESA', version: '4.2', url: '', checkedAt: '2025-01-10', nextReviewAt: '2026-01-10' },
    { sourceId: 'S01', title: 'ISO 26262', publisher: 'ISO', version: '2018', url: '', checkedAt: '2026-06-01', nextReviewAt: '2099-06-01' },
  ];
  const sourcesApi = (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/refdb/sources/reviews') && init?.method === 'POST') return { status: 201, body: { items: [SOURCES[0]] } };
    if (url.startsWith('/api/refdb/sources')) return { body: { items: SOURCES } };
    return api(url);
  };

  it("목록의 '출처' 탭 — 점검 기한 지난 출처를 앞에, 관리자는 알림이 연 출처를 미리 골라 점검 기록을 남긴다", async () => {
    handler = sourcesApi;
    mount('steward', '/master/feature-db?tab=sources&source=S10', '/master/feature-db', <FeatureDbScreen />);
    const panel = await screen.findByTestId('ref-sources');
    await within(panel).findByText('COVESA VSS');
    expect(document.querySelector('[data-review-due="S10"]')).toBeTruthy();
    expect(document.querySelector('[data-review-due="S01"]')).toBeNull();
    expect(panel.querySelector('[data-due]')!.textContent).toBe(S.dueSome(1));
    const ids = [...panel.querySelectorAll('[data-source-row]')].map((e) => e.getAttribute('data-source-row'));
    expect(ids).toEqual(['S10', 'S01']);
    expect((screen.getByLabelText(S.pickLabel('S10')) as HTMLInputElement).checked).toBe(true);
    const send = () => screen.getByRole('button', { name: S.submit }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(screen.getByText(S.why.note, { selector: '.ds-btn-why__text' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(S.nextReviewAt), { target: { value: '2027-11-04' } });
    fireEvent.change(screen.getByLabelText(S.note), { target: { value: '4.2 그대로 확인' } });
    await waitFor(() => expect(send().disabled).toBe(false));
    fireEvent.click(send());
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ sourceIds: ['S10'], nextReviewAt: '2027-11-04', note: '4.2 그대로 확인', result: 'NO_CHANGE' }));
    expect(await screen.findByText(S.recorded(1))).toBeTruthy();
  });

  it("'출처' 탭 — 관리자가 아니면 고르기·점검 기록 칸이 없다", async () => {
    handler = sourcesApi;
    mount('author', '/master/feature-db?tab=sources', '/master/feature-db', <FeatureDbScreen />);
    await screen.findByText('COVESA VSS');
    expect(screen.queryByTestId('ref-source-review')).toBeNull();
    expect(screen.queryByLabelText(S.pickLabel('S10'))).toBeNull();
  });
});

describe('금액 칸을 보는 역할로 묻는다(하네스 리뷰 F1)', () => {
  it('PLM 기준정보(DB 관리자 겸직)는 기준 행 조회를 DB 관리자 역할로 보내 벤치마크를 받고, 역할이 바뀌면 다시 읽는다', async () => {
    const roles: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      if (url.startsWith('/api/refdb/refs/CH-BRK-009')) roles.push(h['X-Actor-Role'] ?? '');
      const admin = h['X-Actor-Role'] === 'REFDB_ADMIN';
      const body = url.startsWith('/api/refdb/refs/CH-BRK-009') ? { ...DETAIL, ref: admin ? { ...ROW, benchmarkEur: 120000, kearneyNote: 'Kearney 2022' } : ROW } : (api(url)?.body ?? { items: [] });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    mount('steward', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    expect(await screen.findByText(RD.benchmark)).toBeTruthy();
    expect(roles).toEqual(['REFDB_ADMIN']);
    cleanup();
    mount('author', '/master/feature-db/CH-BRK-009', '/master/feature-db/:refId', <RefDetailScreen />);
    await screen.findByRole('heading', { level: 1, name: '오토 홀드' });
    expect(screen.queryByText(RD.benchmark)).toBeNull();
    expect(roles.at(-1)).toBe('FEATURE_AUTHOR');
  });
});
