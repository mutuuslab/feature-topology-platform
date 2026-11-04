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
import { featureDb as L, refChangeDetail as D, refChanges as C, refDetail as RD } from '../copy/refdb';

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
    return { body: { items, total: q ? 1 : 1052, offset: 0, limit: 50, facets: { domain: [], component: [], status: [] }, release: 'v1.3' } };
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
    expect(key.querySelector('.ds-key__status')!.textContent).toBe(L.awaiting(2));
    const summary = screen.getByRole('group', { name: L.quality });
    expect(summary.textContent).toContain(`${L.q.stale} 12`);
    expect(summary.textContent).toContain('83.6%');
    expect(document.querySelector('.ds-kpis')).toBeNull();
    // 컴포넌트는 도메인을 고르기 전에는 막혀 있고, 고르면 그 도메인의 컴포넌트만
    const comp = screen.getByLabelText(L.component) as HTMLSelectElement;
    expect(comp.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(L.domain), { target: { value: 'Chassis & Vehicle Dynamics' } });
    await waitFor(() => expect((screen.getByLabelText(L.component) as HTMLSelectElement).disabled).toBe(false));
    const opts = [...(screen.getByLabelText(L.component) as HTMLSelectElement).options].map((o) => o.value);
    expect(opts).toEqual(['', 'Brake control (ESC/ABS)']);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/refdb/refs?') && c.url.includes('domain=Chassis'))).toBe(true));
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
});

describe('Feature DB 변경 요청', () => {
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
    expect(screen.getByText(/SOD-14/)).toBeTruthy();
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
    const publish = (await screen.findByRole('button', { name: C.publishBtn(1) })) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    expect(document.querySelector('[data-hash]')!.getAttribute('data-hash')).toBe('a'.repeat(64));
    fireEvent.click(publish);
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
