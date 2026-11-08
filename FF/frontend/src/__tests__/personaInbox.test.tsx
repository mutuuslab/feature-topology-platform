// 담당자 E2E W2 — 검토함·홈·알림·사람 표시. 모의 API로 담당자마다 자기 대기열을 보고 대상으로 가는지 확인한다.
//  P2-1 Baseline 확정 요청 조회 상태(PENDING) · P2-3 정의 승인·Feature DB 검토 대기열, 차단 '내 차례' 칸 이유 · P3-6 부서별·급한 순서·기한 배지·요청 시각
//  P1-4 Sign-off 대기·인계 링크 · P1-1 열 수 = 목록 수 · P2-5/P1-11 역할별 핵심 메시지·내 업무·내 Feature · P4-9 부서 전환 알림·복귀
//  P2-4 Feature 상세 행위자 헤더 · P1-6 다음 차례·권한 없는 버튼 이유 · P1-5/P2-10 사람 이름·한국 시각
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider, initial, reducer } from '../store';
import { ApprovalInboxScreen, HomeScreen } from '../screens/home/Inbox';
import { byUrgency, inDept } from '../screens/home/queues';
import FeatureDetail from '../screens/features/FeatureDetail';
import { humanText, localTime, personLabel, personName, remaining } from '../data/people';
import { departmentById } from '../data/departments';
import { personaRnR } from '../shell/DepartmentSwitcher';
import { loadWorkflows } from '../data/workflows';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; headers: Record<string, string> }[];
const NOW = Date.parse('2026-11-05T01:00:00.000Z');

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = handler(url, init) ?? { body: { items: [] } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = (state: object, path: string, routePath: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify(state));
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
};

const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const WQ = {
  definitions: [
    { featureId: 'FEAT-00191', version: '0.1.0', name: '야간 보행자 경고', lifecycle: 'PROPOSED', ownerId: 'ADAS기획팀', createdBy: 'usr-author', since: at(-90) },
    { featureId: 'FEAT-00192', version: '0.1.0', name: '내가 낸 제안', lifecycle: 'PROPOSED', ownerId: 'ADAS기획팀', createdBy: 'usr-approver', since: at(-60) },
  ],
  signoffs: [{ featureId: 'FEAT-00196', version: '1.0.0', name: '원격 공조 예약', lifecycle: 'VERIFIED', ownerId: 'ADAS기획팀', createdBy: null, since: at(-30), stale: false }],
  releasable: [{ featureId: 'FEAT-00197', version: '1.0.0', name: '서명된 Feature', lifecycle: 'VERIFIED', ownerId: 'ADAS기획팀', createdBy: null, since: at(-20), signedBy: 'usr-author', signedAt: at(-20) }],
  gates: [
    { featureId: 'FEAT-00189', version: '0.2.0', name: '시험 대상', lifecycle: 'DEVELOPING', ownerId: 'x', createdBy: null, since: at(-300), gate: 'G5', status: null },
    { featureId: 'FEAT-00189', version: '0.2.0', name: '시험 대상', lifecycle: 'DEVELOPING', ownerId: 'x', createdBy: null, since: at(-300), gate: 'G4', status: null },
  ],
  classifications: [{ featureId: 'FEAT-00190', version: '0.1.0', name: '분류 대상', lifecycle: 'PROPOSED', ownerId: 'x', createdBy: null, since: at(-500), fClass: 'F2' }],
  recent: [
    { featureId: 'FEAT-00198', version: '0.1.0', name: '방금 만든 [P1] Feature', lifecycle: 'PROPOSED', ownerId: 'ADAS기획팀', createdBy: 'usr-author', since: at(-1) },
    { featureId: 'FEAT-00013', version: '1.0.0', name: '시드 Feature', lifecycle: 'PROPOSED', ownerId: 'x', createdBy: null, since: null },
  ],
};
const KILLS = [
  { killId: 'KILL-00005', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'REQUESTED', fClass: 'F2', reasonCategory: 'SAFETY', requestedBy: 'usr-operator', requestedAt: at(-100), expiresAt: at(20), approvals: [] },
  { killId: 'KILL-00004', featureId: 'FEAT-00029', featureVersion: '1.0.0', status: 'REQUESTED', fClass: 'F2', reasonCategory: 'SAFETY', requestedBy: 'usr-operator', requestedAt: at(-50), expiresAt: at(70), approvals: [] },
];
const CHANGES = [
  { changeId: 'CR-2026-010', kind: 'MODIFY', refId: 'AD-LON-002', status: 'REVIEW', requestedBy: 'usr-author', requestedAt: at(-40), reviews: [] },
  { changeId: 'CR-2026-011', kind: 'ADD', refId: 'BC-ACC-031', status: 'REVIEW', requestedBy: 'usr-steward', requestedAt: at(-45), reviews: [{ reviewerId: 'usr-approver' }] },
];
const POST = [{ killId: 'KILL-00003', featureId: 'FEAT-00022', due: at(-10), requestedBy: 'usr-operator', approvers: ['usr-quality', 'usr-integrator'], status: 'OVERDUE' }];

const api: Handler = (url) => {
  if (url.startsWith('/api/work-queues')) return { body: WQ };
  if (url.startsWith('/api/kill-requests')) return { body: { items: KILLS } };
  if (url.startsWith('/api/kill-post-reviews')) return { body: { items: POST } };
  if (url.startsWith('/api/refdb/changes')) return { body: { items: CHANGES } };
  if (url.startsWith('/api/baselines/requests')) return { body: { items: [{ requestId: 'BR-00001', featureId: 'FEAT-00188', version: '1.0.0', requestedBy: 'usr-author', requestedAt: at(-200) }] } };
  if (url.startsWith('/api/features?')) return { body: { total: 0, items: [], facets: { lifecycle: {}, country: {}, vehicleModel: {} } } };
  return undefined;
};

describe('P2-1 Baseline 확정 요청 — 계약의 대기 상태(PENDING)로 묻는다', () => {
  it('검토함과 콘솔 홈이 status=PENDING으로 조회한다(REQUESTED 0건 결함)', async () => {
    handler = api;
    mount({ role: 'steward' }, '/admin/approval', '/admin/approval', <ApprovalInboxScreen />);
    expect(await screen.findByText('FEAT-00188 1.0.0')).toBeTruthy();
    cleanup();
    mount({ role: 'steward', department: 'DEP-PLM' }, '/', '/', <HomeScreen />);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/baselines/requests')).length).toBeGreaterThanOrEqual(2));
    const urls = calls.filter((c) => c.url.startsWith('/api/baselines/requests')).map((c) => c.url);
    expect(urls.every((u) => u.includes('status=PENDING'))).toBe(true);
    expect(urls.some((u) => u.includes('REQUESTED'))).toBe(false);
  });
});

describe('P2-3 검토함 — 정의 승인·Feature DB 검토 대기열, 차단 내 차례의 이유', () => {
  it('정의 승인자(approver) — 남이 낸 G1~G3 PASS 제안은 내 차례, 내가 낸 것은 이유와 함께 아님 · Feature DB는 요청자·이미 의견 낸 건 제외', async () => {
    handler = api;
    mount({ role: 'approver' }, '/admin/approval', '/admin/approval', <ApprovalInboxScreen />);
    const def = await screen.findByRole('region', { name: '정의 승인 대기' });
    expect(within(def).getByText('FEAT-00191 0.1.0')).toBeTruthy();
    expect(within(def).queryByText('FEAT-00192 0.1.0')).toBeNull();
    // 작성자 이름(계정 ID 아님)
    expect(within(def).getAllByText('김민영').length).toBeGreaterThan(0);
    expect(def.textContent).not.toMatch(/usr-/);
    const ref = screen.getByRole('region', { name: 'Feature DB 검토 대기' });
    expect(within(ref).getByText(/CR-2026-010/)).toBeTruthy();
    expect(within(ref).queryByText(/CR-2026-011/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /전체/ }));
    const own = (await screen.findByText('FEAT-00192 0.1.0')).closest('tr')!;
    expect(within(own).getByText(/내가 작성한 제안은 승인할 수 없습니다/)).toBeTruthy();
    const reviewed = screen.getByText(/CR-2026-011/).closest('tr')!;
    expect(within(reviewed).getByText('이미 검토 의견을 냈습니다')).toBeTruthy();
    expect(within(own).getByRole('link', { name: '열기' }).getAttribute('href')).toBe('/features/FEAT-00192/0.1.0');
  });

  it('긴급 차단 — 내 차례면 어느 칸(FSM·CSM)으로 승인하는지 보이고, 기한이 가까운 것이 먼저', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    handler = api;
    mount({ role: 'integrator' }, '/admin/approval', '/admin/approval', <ApprovalInboxScreen />);
    const kill = await screen.findByRole('region', { name: '긴급 차단 승인' });
    const rows = within(kill).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('KILL-00005'); // 남은 20분
    expect(rows[1].textContent).toContain('KILL-00004'); // 남은 1시간 10분
    expect(within(rows[0]).getByText('남은 20분')).toBeTruthy();
    expect(within(rows[0]).getByText(/칸으로 승인/)).toBeTruthy();
    expect(within(kill).getAllByText('서준호').length).toBe(2);
  });
});

describe('P3-6 결재함 — 부서 대기열·급한 순서·기한 배지·요청 시각', () => {
  it('법규인증팀은 권한이 있는 형식승인 영향 판단 대기열에서 안전 분석 화면으로 간다', async () => {
    handler = (url, init) => url.startsWith('/api/work-queues') ? { body: { ...WQ, homologations: [
      { featureId: 'FEAT-00189', version: '0.2.0', name: '형식승인 영향 대상', lifecycle: 'DEVELOPING', ownerId: 'x', createdBy: null, since: at(-30) },
    ] } } : api(url, init);
    mount({ role: 'steward', department: 'DEP-HOM' }, '/', '/', <HomeScreen />);
    const list = await waitFor(() => {
      const l = document.querySelector('[data-queue-dept="DEP-HOM"]');
      expect(l?.querySelector('li[data-queue="homologation"]')).toBeTruthy();
      return l as HTMLElement;
    });
    expect(list.textContent).toContain('형식승인 영향 판단 대기');
    expect(list.querySelector('[data-queue="gate"]')).toBeNull();
    expect(document.querySelector('.ws-target a')?.getAttribute('href')).toBe('/features/FEAT-00189/0.2.0?tab=safety#safety-analysis-h');
  });

  it('시험·검증팀(DEP-VAL)은 G5만, 품질팀(DEP-QA)은 사후 검토·G4 — 기능안전팀은 차단이 맨 앞', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    handler = api;
    mount({ role: 'quality', department: 'DEP-VAL' }, '/', '/', <HomeScreen />);
    const list = await waitFor(() => {
      const l = document.querySelector('[data-queue-dept="DEP-VAL"]');
      if (!l || !l.querySelector('li')) throw new Error('대기열 없음');
      return l as HTMLElement;
    });
    expect([...list.querySelectorAll('li')].map((li) => li.getAttribute('data-queue'))).toEqual(['gate']);
    expect(list.textContent).toContain('G5');
    expect(list.textContent).not.toContain('G4');
    // 요청 시각이 빈 칸이 아니다(한국 시각)
    expect(list.querySelector('.ws-queue__since')?.textContent).toBe(localTime(at(-300)));
    cleanup();
    mount({ role: 'viewer', department: 'DEP-QA' }, '/', '/', <HomeScreen />);
    const qa = await waitFor(() => {
      const l = document.querySelector('[data-queue-dept="DEP-QA"]');
      if (!l || !l.querySelector('li')) throw new Error('대기열 없음');
      return l as HTMLElement;
    });
    const qs = [...qa.querySelectorAll('li')].map((li) => li.getAttribute('data-queue'));
    expect(qs[0]).toBe('postReview');
    expect(qa.textContent).toContain('기한 지남 10분');
    cleanup();
    mount({ role: 'quality', department: 'DEP-FS' }, '/', '/', <HomeScreen />);
    fireEvent.click(await screen.findByRole('radio', { name: /부서 전체/ }));
    const fs = document.querySelector('[data-queue-dept="DEP-FS"]') as HTMLElement;
    await waitFor(() => expect(fs.querySelectorAll('li').length).toBeGreaterThan(1));
    const order = [...fs.querySelectorAll('li')].map((li) => li.getAttribute('data-queue'));
    expect(order[0]).toBe('kill');
    expect(order.indexOf('kill')).toBeLessThan(order.indexOf('safety'));
  });

  it('급한 순서 규칙 — 차단(기한) → 복원 → 사후 검토 → Gate → … → 분류 → 연계 충돌', () => {
    const it = (queue: any, due: string | null, since: string | null, key: string) => ({ queue, due, since, key });
    const sorted = byUrgency([it('safety', null, at(-999), 'a'), it('gate', null, at(-5), 'b'), it('kill', at(90), null, 'c'), it('kill', at(10), null, 'd'), it('sync', null, at(-9999), 'e'), it('postReview', at(-1), null, 'f')]);
    expect(sorted.map((x) => x.key)).toEqual(['d', 'c', 'f', 'b', 'a', 'e']);
    expect(inDept({ queue: 'gate', gate: 'G5' }, 'DEP-VAL')).toBe(true);
    expect(inDept({ queue: 'gate', gate: 'G4' }, 'DEP-VAL')).toBe(false);
    expect(inDept({ queue: 'kill', gate: null }, 'DEP-CS')).toBe(true);
  });
});

describe('기획 스튜디오 — Sign-off 대기·내 Feature·열 수·인계 링크·역할별 핵심 메시지', () => {
  const FEATS = [
    ...Array.from({ length: 7 }, (_, i) => ({ featureId: `FEAT-001${String(i).padStart(2, '0')}`, version: '1.0.0', name: `개발 ${i}`, lifecycle: 'DEVELOPING', country: 'KR', vehicleModel: 'NX4', asil: 'QM' })),
    ...Array.from({ length: 6 }, (_, i) => ({ featureId: `FEAT-002${String(i).padStart(2, '0')}`, version: '1.0.0', name: `승인 ${i}`, lifecycle: 'APPROVED', country: 'KR', vehicleModel: 'NX4', asil: 'QM' })),
  ];
  const studioApi: Handler = (url) => (url.startsWith('/api/features?') ? { body: { total: FEATS.length, items: FEATS, facets: { lifecycle: {}, country: {}, vehicleModel: {} } } } : api(url));

  it('P1-1 열 숫자 = 그 Lifecycle 하나 — 정의 승인과 개발을 나눠 "외 N건" 링크 목록과 같다', async () => {
    handler = studioApi;
    mount({ role: 'author', department: 'DEP-PDP' }, '/', '/', <HomeScreen />);
    const dev = await waitFor(() => {
      const c = document.querySelector('.ws-col[data-lifecycle="DEVELOPING"]');
      if (!c) throw new Error('열 없음');
      return c as HTMLElement;
    });
    await waitFor(() => expect(dev.querySelector('.ws-col__n')?.textContent).toBe('7'));
    expect(dev.querySelector('.ws-more')?.getAttribute('href')).toBe('/features?lifecycle=DEVELOPING');
    expect(dev.querySelector('.ws-more')?.getAttribute('data-more-count')).toBe('2');
    const app = document.querySelector('.ws-col[data-lifecycle="APPROVED"]') as HTMLElement;
    expect(app.querySelector('.ws-col__n')?.textContent).toBe('6');
    expect(app.querySelector('.ws-more')?.getAttribute('href')).toBe('/features?lifecycle=APPROVED');
  });

  it('P1-4 Feature Owner — Sign-off 대기 목록이 대상으로 가고, 핵심 메시지가 내 차례 · 내 Feature는 방금 만든 것이 맨 위', async () => {
    handler = studioApi;
    mount({ role: 'author', department: 'DEP-PDP' }, '/', '/', <HomeScreen />);
    const q = await screen.findByRole('region', { name: 'Release Sign-off 대기' });
    expect(within(q).getByRole('link', { name: '원격 공조 예약' }).getAttribute('href')).toBe('/features/FEAT-00196/1.0.0');
    await waitFor(() => expect(document.querySelector('[data-key-message]')?.textContent).toContain('Release Sign-off 대기'));
    const mine = screen.getByRole('region', { name: '내 Feature' });
    expect(within(mine).getAllByRole('link')[0].textContent).toBe('방금 만든 [P1] Feature');
    expect(within(mine).queryByText('시드 Feature')).toBeNull();
  });

  it('P1-4 인계 항목은 모두 화면 링크다(href 없는 항목 0) · P1-13 내 업무는 일하는 화면으로 가고 절차 문서는 보조', async () => {
    handler = studioApi;
    mount({ role: 'author', department: 'DEP-PDP' }, '/', '/', <HomeScreen />);
    await waitFor(() => expect(document.querySelectorAll('[data-handoff-link]').length).toBeGreaterThan(0), { timeout: 8000 });
    const hand = [...document.querySelectorAll('.ws-hand li')];
    expect(hand.length).toBe(document.querySelectorAll('[data-handoff-link]').length);
    for (const a of document.querySelectorAll('[data-handoff-link]')) expect(a.getAttribute('href')).toMatch(/^\//);
    const work = [...document.querySelectorAll('[data-work-link]')];
    expect(work.length).toBeGreaterThan(0);
    expect(work.some((a) => !a.getAttribute('href')!.startsWith('/procedures'))).toBe(true);
    expect(document.querySelectorAll('.ws-work__doc').length).toBe(work.length);
  });

  it('기획팀 approver는 팀의 정의 승인만 집계하고 시스템엔지니어링팀의 기준 검토는 섞지 않는다', async () => {
    handler = studioApi;
    mount({ role: 'approver', department: 'DEP-PDP' }, '/', '/', <HomeScreen />);
    await waitFor(() => expect(document.querySelector('[data-key-message]')?.textContent).toContain('정의 승인 대기'));
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('1');
    const tiles = document.querySelector('[data-role-queues]') as HTMLElement;
    expect(tiles.querySelector('[data-queue="definition"] a')?.getAttribute('href')).toBe('/features/FEAT-00191/0.1.0');
    expect(tiles.querySelector('[data-queue="refReview"] .ws-fdb__n')?.textContent).toBe('0');
    expect(tiles.querySelector('a[href="/master/feature-db/changes/CR-2026-010"]')).toBeNull();
    // 작성자 전용 Sign-off 대기 목록은 approver 홈에도 보이지만 approver의 '내 Feature'는 없다
    expect(screen.queryByRole('region', { name: '내 Feature' })).toBeNull();
  });

  it('시스템엔지니어링팀 approver는 팀의 기준 검토 행을 실제 상세로 연결한다', async () => {
    handler = studioApi;
    mount({ role: 'approver', department: 'DEP-SE' }, '/', '/', <HomeScreen />);
    await waitFor(() => expect(document.querySelector('[data-role-queues] [data-queue="refReview"] a[href="/master/feature-db/changes/CR-2026-010"]')).not.toBeNull());
  });

  it('P2-5 엔지니어링 콘솔 — 출시 담당(coordinator)은 출시 가능·배포 대기가 핵심 메시지', async () => {
    handler = (url) => (url.startsWith('/api/policies?status=APPROVED') ? { body: { items: [{ policyId: 'POL-00006', flagKey: 'care_x', featureId: 'FEAT-00188', featureVersion: '1.0.0', status: 'APPROVED', createdBy: 'usr-commerce', createdAt: at(-10) }] } } : api(url));
    mount({ role: 'coordinator', department: 'DEP-INT' }, '/', '/', <HomeScreen />);
    await waitFor(() => expect(document.querySelector('[data-key-message]')?.textContent).toMatch(/출시 가능.*배포 대기|배포 대기.*출시 가능/));
    expect(document.querySelector('[data-key-message] .ds-key__value')?.textContent).toBe('2');
  });
});

describe('P4-9 부서 전환 — 역할이 바뀌면 알리고, 전체 보기로 돌아오면 원래 역할', () => {
  it('운영자(operator) → 개인정보보호팀(viewer)으로 바뀌면 알림, 전체 보기로 돌아오면 operator', () => {
    const s1 = reducer({ ...initial, role: 'operator' }, { t: 'DEPT', department: 'DEP-DPO' });
    expect(s1).toMatchObject({ role: 'viewer', department: 'DEP-DPO', allRole: 'operator' });
    expect(s1.toast?.msg).toMatch(/역할이 .*차량 운영.* → .*조회/);
    const s2 = reducer(s1, { t: 'DEPT', department: 'DEP-PUR' });
    expect(s2.allRole).toBe('operator'); // 부서끼리 옮겨도 전체 보기 역할은 그대로 기억
    const s3 = reducer(s2, { t: 'DEPT', department: 'ALL' });
    expect(s3).toMatchObject({ role: 'operator', department: 'ALL', allRole: null });
    expect(s3.toast?.msg).toMatch(/원래 역할/);
    // 역할이 같으면 알리지 않는다
    expect(reducer({ ...initial, role: 'operator', toast: null }, { t: 'DEPT', department: 'DEP-OPS' }).toast).toBeNull();
  });

  it('부서 안 역할 이름은 R&R 이름 — 상품기획팀 approver는 상품 Owner, 시스템엔지니어링팀 approver는 요구 Owner·도메인 검토자', async () => {
    const doc = await loadWorkflows();
    expect(personaRnR(doc, departmentById('DEP-PDP')!, 'approver')).toBe('상품 Owner');
    expect(personaRnR(doc, departmentById('DEP-SE')!, 'approver')).toBe('요구 Owner·도메인 검토자');
    expect(personaRnR(doc, departmentById('DEP-PDP')!, 'author')).toBe('Feature Owner');
  });
});

describe('Feature 상세 — 행위자 헤더(P2-4)·다음 차례(P1-6)', () => {
  const DETAIL = {
    feature: { featureId: 'FEAT-00191', version: '0.1.0', name: '야간 보행자 경고', lifecycle: 'PROPOSED', country: 'KR', vehicleModel: 'NX4', trim: 'P', ownerId: 'ADAS기획팀', asil: 'QM', tags: [], controlPoints: [], requirementIds: [], description: 'x', upgVc: [], functions: [], swIds: [], swVersions: [], ecuPnos: [], dependencyIds: [], featureRefs: [{ refId: 'AD-LON-002', role: 'PRIMARY', refVersion: 'v1.4' }], _missing: {} },
    meta: { createdBy: 'usr-author', createdAt: at(-90) },
    gates: {},
    dependencies: { outgoing: [], incoming: [] },
    functions: [],
    trace: [],
    baseline: null,
    products: [],
    pendingBaselineRequest: null,
    transitions: [
      {
        to: 'APPROVED',
        ko: '정의 승인',
        auto: false,
        roles: ['Feature 승인자'],
        blockers: [
          { code: 'GATE_UNJUDGED', message: 'G2 Requirement Gate 미판정', ref: 'G2' },
          { code: 'REFDB_LINK_BLOCKED', message: '기준 행 CH-BRK-024이(가) 요청 중입니다', ref: 'CH-BRK-024' },
          { code: 'ROLE', message: '허용 역할이 아닙니다 (Feature 승인자)' },
        ],
      },
    ],
    versions: [{ version: '0.1.0', lifecycle: 'PROPOSED', baselineId: null }],
  };

  it('상세는 행위자 헤더로 묻고, 권한 없는 전이 버튼은 막고 이유 · 다음 차례에 다음 부서·역할과 기준 행 막힘까지', async () => {
    handler = (url) => (url === '/api/features/FEAT-00191/versions/0.1.0' ? { body: DETAIL } : undefined);
    mount({ role: 'author' }, '/features/FEAT-00191/0.1.0', '/features/:id/:ver', <FeatureDetail />);
    await screen.findByRole('heading', { level: 1 });
    const req = calls.find((c) => c.url === '/api/features/FEAT-00191/versions/0.1.0')!;
    expect(req.headers['X-Actor-Id']).toBe('usr-author');
    expect(req.headers['X-Actor-Role']).toBe('FEATURE_AUTHOR');
    const btn = screen.getByRole('button', { name: /APPROVED로 전이/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.closest('.ds-btn-why')?.textContent).toContain('권한이 없습니다 — Feature 승인자만');
    const next = screen.getByRole('region', { name: '다음 차례' });
    expect(next.textContent).toContain('내 차례가 아닙니다');
    expect(next.textContent).toMatch(/시스템엔지니어링팀|상품기획팀/);
    expect(next.textContent).toContain('기준 행 CH-BRK-024이(가) 요청 중입니다');
    expect(next.textContent).toContain('G2 Requirement Gate 미판정');
  });

  it('정의 승인자가 열면 같은 Feature에서 버튼이 열리고 "지금 정의 승인할 수 있습니다"', async () => {
    const ok = { ...DETAIL, transitions: [{ ...DETAIL.transitions[0], blockers: [] }] };
    handler = (url) => (url === '/api/features/FEAT-00191/versions/0.1.0' ? { body: ok } : undefined);
    mount({ role: 'approver' }, '/features/FEAT-00191/0.1.0', '/features/:id/:ver', <FeatureDetail />);
    await screen.findByRole('heading', { level: 1 });
    expect(calls.find((c) => c.url === '/api/features/FEAT-00191/versions/0.1.0')!.headers['X-Actor-Role']).toBe('FEATURE_APPROVER');
    expect((screen.getByRole('button', { name: /APPROVED로 전이/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('region', { name: '다음 차례' }).textContent).toContain('지금 정의 승인할 수 있습니다');
  });
});

describe('P1-5·P2-10 사람·시각 표시', () => {
  it('계정 ID → 이름·소속, 서버 문장 속 ID·ISO 시각 → 이름·한국 시각, 남은 시간', () => {
    expect(personName('usr-author')).toBe('김민영');
    expect(personLabel('usr-approver')).toMatch(/^이지수 \(.+\)$/);
    expect(personName('system:refdb-review')).toBe('시스템(자동)');
    expect(personName('usr-unknownx')).not.toMatch(/usr-/);
    expect(humanText('요청자 usr-operator · 2026-11-05T01:00:00.000Z')).toBe('요청자 서준호 · 2026-11-05 10:00');
    expect(localTime('2026-10-18T01:00:00.000Z')).toBe('2026-10-18 10:00');
    expect(remaining(at(80), NOW)).toMatchObject({ overdue: false, text: '1시간 20분' });
    expect(remaining(at(-10), NOW)).toMatchObject({ overdue: true, text: '10분' });
  });
});
