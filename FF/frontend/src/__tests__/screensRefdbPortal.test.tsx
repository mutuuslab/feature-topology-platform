// W5 담당자 개선(P1-8·P1-9·P5-1~P5-12) — SW개발비 및 정보보안 협의 요청·Feature DB 운영(발행 미리 보기·출처 점검·감사 이력)·감사 화면·변경 영향 협력사. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { departmentById } from '../data/departments';
import PortalHome from '../screens/workspaces/Portal';
import WorkspaceHome from '../screens/workspaces/WorkspaceHome';
import { ConsultScreen } from '../screens/workspaces/Consults';
import { RefChangeDetailScreen, RefChangesScreen } from '../screens/refdb/Changes';
import { RefDetailScreen } from '../screens/refdb/RefDetail';
import { SourcesPanel } from '../screens/refdb/Sources';
import { exportDownloadName } from '../screens/refdb/common';
import { searchLocally } from '../screens/refdb/refSearch';
import { RefPicker } from '../screens/home/propose/RefPicker';
import { AuditScreen } from '../screens/governance/AuditEvents';
import ImpactScreen from '../screens/governance/Impact';
import { consult as C } from '../copy/consult';
import { refAwaiting, refBenchmark, refPublish, refSourceReview } from '../copy/refdb';
import { proposeRefMore } from '../copy/propose';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = handler(url, init) ?? { body: { items: [] } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (state: object, path: string, pattern: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify(state));
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

/** 포털 화면에 보이면 안 되는 전문용어(P5-12) — Gate·SLA·OTA·Inputs/Outputs·레인·RACI 글자·절차 코드 */
const JARGON = /\bGate\b|\bSLA\b|\bOTA\b|Inputs|Outputs|레인|FPW\.\d|\bR\s*\/\s*A\b|수행·책임지는 활동이 없습니다/;

const consult = (o: Record<string, unknown> = {}) => ({
  consultId: 'CON-2026-005',
  activityId: 'FPW.7-A07',
  activityName: '형식승인·사용자 고지 확인',
  targetKind: 'FEATURE',
  targetId: 'FEAT-00145@5.4.2',
  targetName: '스마트 크루즈 컨트롤 5.4.2',
  summary: '스마트 크루즈 컨트롤 고객 고지 문구 — 형식승인 조건과 약관이 맞는지 의견을 주세요',
  checks: ['차량 화면 고지 문구가 형식승인 조건(속도 범위)과 같은지', '약관에 기능 제한 안내가 있는지'],
  link: '/features/FEAT-00145/5.4.2',
  fromDept: 'DEP-HOM',
  fromName: '법규인증팀',
  toDept: 'DEP-LEG',
  toName: '법무팀',
  requestedBy: 'usr-steward',
  requestedAt: '2026-11-04T09:00:00.000Z',
  dueAt: '2026-11-09',
  daysLeft: 4,
  status: 'OPEN',
  opinions: [],
  ...o,
});

describe('SW개발비 및 정보보안 — 실제 협의 요청(P5-1·P5-12)', () => {
  it('요청함은 한 줄 요약·요청 부서·기한, 전문용어 없이 — 건은 흐름도가 아니라 "검토할 것 한 장"으로 연다', async () => {
    const items = [consult(), consult({ consultId: 'CON-2026-002', summary: '중국 데이터 현지 처리 의견', fromDept: 'DEP-LEG', fromName: '법무팀', daysLeft: -1, dueAt: '2026-11-04' }), consult({ consultId: 'CON-2026-001', status: 'ANSWERED', opinions: [{ opinion: 'AGREE', memo: '확인', by: 'usr-viewer', department: 'DEP-LEG', at: '2026-11-03T00:00:00Z' }] })];
    handler = (u) => (u.startsWith('/api/consultations?to=DEP-LEG') ? { body: { items, total: 3, open: 2, overdue: 1 } } : undefined);
    mount({ role: 'viewer', department: 'DEP-LEG' }, '/', '/', <PortalHome dept={departmentById('DEP-LEG')!} />);
    const inbox = await screen.findByRole('table', { name: C.portal.inboxCaption });
    const link = within(inbox).getByRole('link', { name: items[0].summary as string });
    // 회귀: 요청함 건이 업무 절차 흐름도(/procedures/FPW.x?a=…)로 열렸다
    expect(link.getAttribute('href')).toBe('/consults/CON-2026-005');
    expect(inbox.textContent).toContain('법규인증팀');
    expect(inbox.textContent).toContain('4일 남음');
    expect(inbox.textContent).toContain('1일 지남');
    expect(document.querySelector('[data-key-message]')!.textContent).toContain('2');
    expect(screen.getByText('기한 지남 1')).toBeTruthy();
    // 의견을 남긴 건은 따로
    expect(screen.getByRole('table', { name: C.portal.done }).textContent).toContain('동의');
    expect(document.body.textContent).not.toMatch(JARGON);
  });

  it('개인정보보호팀 포털 — "수행·책임지는 활동이 없습니다" 대신 실제 건(P5-12)', async () => {
    handler = (u) => (u.startsWith('/api/consultations?to=DEP-DPO') ? { body: { items: [consult({ toDept: 'DEP-DPO', toName: '개인정보보호팀', summary: '운행 감시 지표 수집 항목 — 개인정보 의견' })], total: 1, open: 1, overdue: 0 } } : undefined);
    mount({ role: 'viewer', department: 'DEP-DPO' }, '/', '/', <PortalHome dept={departmentById('DEP-DPO')!} />);
    expect(await screen.findByRole('link', { name: '운행 감시 지표 수집 항목 — 개인정보 의견' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(JARGON);
  });

  it('한 장 화면 — 살펴볼 것·대상·기한, 받은 부서에서 동의·보완·반대 + 메모를 보낸다', async () => {
    handler = (u, init) => {
      if (u.startsWith('/api/consultations/CON-2026-005/opinions') && init?.method === 'POST') return { status: 201, body: consult({ status: 'ANSWERED' }) };
      if (u.startsWith('/api/consultations/CON-2026-005')) return { body: { consultation: consult() } };
      return undefined;
    };
    mount({ role: 'viewer', department: 'DEP-LEG' }, '/consults/CON-2026-005', '/consults/:id', <ConsultScreen />);
    expect(await screen.findByText('차량 화면 고지 문구가 형식승인 조건(속도 범위)과 같은지')).toBeTruthy();
    expect(screen.getByRole('link', { name: `${C.sheet.open} →` }).getAttribute('href')).toBe('/features/FEAT-00145/5.4.2');
    expect(document.body.textContent).not.toMatch(JARGON);
    const send = screen.getByRole('button', { name: C.form.submit });
    expect(send.hasAttribute('disabled')).toBe(true); // 메모 없음
    fireEvent.click(screen.getByRole('radio', { name: C.opinion.REVISE }));
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(C.form.memo) }), { target: { value: '속도 범위를 고지 문구에 넣어 주세요' } });
    const fresh = () => screen.getByRole('button', { name: C.form.submit });
    await waitFor(() => expect(fresh().hasAttribute('disabled')).toBe(false));
    fireEvent.click(fresh());
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ department: 'DEP-LEG', opinion: 'REVISE', memo: '속도 범위를 고지 문구에 넣어 주세요' });
    expect(post.headers['X-Actor-Role']).toBe('AUDITOR');
    expect(await screen.findByText(C.form.sent)).toBeTruthy();
  });

  it('받은 부서가 아니면 의견 버튼이 이유와 함께 막힌다', async () => {
    handler = (u) => (u.startsWith('/api/consultations/CON-2026-005') ? { body: { consultation: consult() } } : undefined);
    mount({ role: 'viewer', department: 'DEP-PUR' }, '/consults/CON-2026-005', '/consults/:id', <ConsultScreen />);
    const send = await screen.findByRole('button', { name: C.form.submit });
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(C.form.memo) }), { target: { value: '동의합니다' } });
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(document.body.textContent).toContain(C.form.why.dept);
  });

  it('요청 부서 홈(법규인증팀)에 보낸 협의와 받은 의견이 보인다', async () => {
    const answered = consult({ status: 'ANSWERED', opinions: [{ opinion: 'REVISE', memo: '속도 범위를 고지 문구에 넣어 주세요', by: 'usr-viewer', department: 'DEP-LEG', at: '2026-11-05T00:00:00Z' }] });
    handler = (u) => (u.startsWith('/api/consultations?from=DEP-HOM') ? { body: { items: [answered], total: 1, open: 0, overdue: 0 } } : undefined);
    mount({ role: 'steward', department: 'DEP-HOM' }, '/', '/', <WorkspaceHome dept={departmentById('DEP-HOM')!} />);
    const panel = await screen.findByRole('region', { name: C.sentPanel.title });
    expect(panel.textContent).toContain('보완');
    expect(panel.textContent).toContain('속도 범위를 고지 문구에 넣어 주세요');
    expect(within(panel).getByRole('link', { name: answered.summary as string }).getAttribute('href')).toBe('/consults/CON-2026-005');
  });
});

describe('Feature DB 검색·고르기(P1-8·P1-9)', () => {
  it('정적 데모 검색도 사내 용어 SCC로 적응형 순항 제어(AD-LON-002)를 찾는다', () => {
    const rows = [
      { refId: 'AD-LON-002', nameKo: '적응형 순항 제어(ACC)', nameEn: 'Adaptive cruise control (ACC)', aliases: [], domain: 'ADAS & AD', component: 'Longitudinal control', status: 'ACTIVE' as const, sourceIds: ['S01'] },
      { refId: 'CH-BRK-009', nameKo: '오토 홀드', nameEn: 'Auto hold', aliases: ['AVH'], domain: 'Chassis', component: 'Brake', status: 'ACTIVE' as const, sourceIds: ['S10'] },
    ];
    expect(searchLocally(rows, { q: 'SCC' }).items.map((r) => r.refId)).toEqual(['AD-LON-002']);
    expect(searchLocally(rows, { q: '스마트 크루즈' }).items.map((r) => r.refId)).toEqual(['AD-LON-002']);
    expect(searchLocally(rows, { source: 'S10' }).items.map((r) => r.refId)).toEqual(['CH-BRK-009']);
  });

  it('검색 0건은 한 문장, 고른 행 ID는 줄 전체 칸에서 한 줄(nowrap)', async () => {
    handler = (u) => (u.startsWith('/api/refdb/refs') ? { body: { items: [], total: 0, offset: 0, limit: 20 } } : undefined);
    const ref = { refId: 'CH-BRK-009', nameKo: '오토 홀드', nameEn: 'Auto hold', status: 'ACTIVE', asilRep: 'B', tshirt: 'S', domain: 'Chassis', component: 'Brake', adminMemo: '' };
    mount({ role: 'author' }, '/', '/', <RefPicker picked={[{ ref: ref as never, role: 'PRIMARY' }]} onChoose={() => {}} onRemove={() => {}} onMakePrimary={() => {}} nodes={[]} domain="" setDomain={() => {}} />);
    const empty = await screen.findByText(proposeRefMore.noResultTitle);
    // 회귀: '표시할 항목이 없습니다'와 '맞는 기준 행이 없습니다 — …' 두 문장이 겹쳤다
    expect(empty.closest('[data-state="empty"]')!.textContent).not.toContain('표시할 항목이 없습니다');
    const id = document.querySelector('[data-chosen-id="CH-BRK-009"]') as HTMLElement;
    expect(id.className).toContain('ds-nowrap');
    // 회귀: 내용이 아이콘 칸(22px)에 들어가 ID가 37px로 세 줄이 됐다
    expect((id.closest('li > span') as HTMLElement).style.gridColumn).toBe('1 / -1');
  });
});

const ROW = { refId: 'BC-ACC-031', status: 'PENDING', replacedBy: null, registeredIn: '', evidenceCheckedAt: '2026-11-04', domain: 'Body & Comfort', cluster: 'Access & security', component: 'Access and locking', swStack: '', lifecycle: '', techStack: '', vehicleType: '', region: '', nameEn: 'Key fob notice', nameKo: '스마트키 안내', aliases: [], autoQuality: '', techQuality: '', asilRep: 'QM', method: '', tshirt: 'S', bundleId: null, bundleRep: null, sizeEvidenceGrade: null, benchmarkEur: null, kearneyNote: '', makeBuyVolume: '', makeBuyPremium: '', relevance: '', sourceIds: ['S01'], sourceDetail: '', remark: '', basisType: '', duplicateOf: null, requires: [], excludes: [], procurement: '', swPackage: '', licenseItem: '', billing: '', definition: null, adminMemo: 'CR-2026-007 등록 화면 추가 요청' };

describe('Feature DB 상세·발행·출처·감사 이력(P5-3~P5-6·P5-9)', () => {
  it('승인됐지만 발행 전인 요청 중 행 — "승인됨 · 다음 발행 대기", 벤치마크가 없으면 이유', async () => {
    handler = (u) =>
      u.startsWith('/api/refdb/refs/BC-ACC-031')
        ? { body: { ref: ROW, sources: [], glossary: [], subfunctions: [], usedBy: [], policy: { status: 'PENDING', replacedBy: null }, awaitingPublish: { changeId: 'CR-2026-007', decidedAt: '2026-11-05T00:00:00Z', label: refAwaiting.pill, hint: '다음 버전이 발행되면 활성이 됩니다.' } } }
        : undefined;
    mount({ role: 'steward' }, '/master/feature-db/BC-ACC-031', '/master/feature-db/:refId', <RefDetailScreen />);
    await screen.findByRole('heading', { level: 1, name: '스마트키 안내' });
    // 회귀: "Feature DB 관리자 승인 전입니다"(틀림)
    await waitFor(() => expect(document.querySelector('[data-key-message]')!.textContent).toContain(refAwaiting.pill));
    expect(document.querySelector('[data-awaiting-publish="CR-2026-007"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('관리자 승인 전입니다');
    expect(screen.getByText(refBenchmark.none)).toBeTruthy();
  });

  const PREVIEW = {
    release: 'v1.5',
    latest: 'v1.4',
    total: 2,
    approved: [{ changeId: 'CR-2026-008', kind: 'ADD', refId: 'BC-ACC-031', nameKo: '스마트키 안내', status: 'REVIEW', requestedBy: 'usr-author', decidedBy: 'usr-steward', decidedAt: '2026-11-05T00:00:00Z' }],
    retiring: [{ changeId: 'CR-2026-009', refId: 'BC-ACC-024', nameKo: '중복 웰컴 라이트', reason: '기존 행과 중복' }],
    notify: [{ featureId: 'FEAT-00195', version: '0.1.0', name: '웰컴 라이트', ownerId: 'usr-author', refId: 'BC-ACC-024' }],
    quality: { before: { published: 1054, pending: 2, noSource: 0, attrMissing: 0, awaitingPublish: 1 }, after: { published: 1056, pending: 0, noSource: 0, attrMissing: 1, awaitingPublish: 0 } },
    memo: 'Feature DB v1.5 발행 — 승인 1건(CR-2026-008) — 반려 정리 1건(CR-2026-009)',
  };

  it('발행 칸 — 묶일 2건(승인 + 반려 → 폐기)·알림 받을 담당·품질 변화를 보이고, 메모를 미리 채운다(P5-4)', async () => {
    handler = (u) => {
      if (u.startsWith('/api/refdb/releases/preview')) return { body: PREVIEW };
      if (u.startsWith('/api/refdb/releases')) return { body: { items: [{ release: 'v1.4', publishedBy: 'usr-steward', publishedAt: '2026-11-04T09:00:00Z', changeIds: ['CR-2026-006'], hash: 'e5fde82d'.padEnd(64, '0'), note: '명칭 정리 묶음' }] } };
      if (u.startsWith('/api/refdb/changes')) return { body: { items: [] } };
      return undefined;
    };
    mount({ role: 'steward' }, '/master/feature-db/changes', '/master/feature-db/changes', <RefChangesScreen />);
    const preview = await screen.findByTestId('ref-publish-preview');
    expect(preview.querySelector('[data-publish-change="CR-2026-008"]')).not.toBeNull();
    expect(preview.querySelector('[data-publish-retire="BC-ACC-024"]')!.textContent).toContain('기존 행과 중복');
    expect(preview.querySelector('[data-publish-notify="FEAT-00195"]')).not.toBeNull();
    expect(preview.textContent).toContain('1054 → 1056');
    await waitFor(() => expect((screen.getByRole('textbox', { name: new RegExp(refPublish.memo) }) as HTMLInputElement).value).toBe(PREVIEW.memo));
    expect(screen.getByRole('button', { name: refPublish.button('v1.5', 2) })).toBeTruthy();
    // 발행 버전 표 — 메모·발행자(보조 열 아님 — 1366에서도 보인다)
    const rel = screen.getByRole('table', { name: 'Feature DB 발행 버전' });
    expect(rel.querySelector('[data-release-note]')!.textContent).toBe('명칭 정리 묶음');
    expect(rel.querySelectorAll('th[data-minor]').length).toBe(0);
  });

  it('메모를 지우면 발행 버튼이 이유와 함께 막힌다(메모 필수)', async () => {
    handler = (u) => (u.startsWith('/api/refdb/releases/preview') ? { body: PREVIEW } : u.startsWith('/api/refdb/releases') ? { body: { items: [] } } : undefined);
    mount({ role: 'steward' }, '/master/feature-db/changes', '/master/feature-db/changes', <RefChangesScreen />);
    const memo = (await screen.findByRole('textbox', { name: new RegExp(refPublish.memo) })) as HTMLInputElement;
    await waitFor(() => expect(memo.value).toBe(PREVIEW.memo));
    fireEvent.change(memo, { target: { value: '' } });
    expect(screen.getByRole('button', { name: refPublish.button('v1.5', 2) }).hasAttribute('disabled')).toBe(true);
    expect(document.body.textContent).toContain(refPublish.memoWhy);
  });

  it('변경 요청 상세 — 감사 이력 패널(요청·검토·결정·발행)과 결정 시각·발행자(P5-6)', async () => {
    const change = { changeId: 'CR-2026-008', kind: 'ADD', refId: 'BC-ACC-031', before: null, after: { nameKo: '스마트키 안내' }, reason: '등록 화면 추가 요청', requestedBy: 'usr-author', requestedAt: '2026-11-04T01:00:00Z', status: 'PUBLISHED', reviews: [], decision: { decision: 'APPROVE', decidedBy: 'usr-steward', reason: '근거 확인', at: '2026-11-05T02:00:00Z' }, release: 'v1.5', checks: [] };
    const trail = {
      changeId: 'CR-2026-008',
      refId: 'BC-ACC-031',
      items: [
        { id: 1, at: '2026-11-04T01:00:00Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'REFDB_ADD_REQUEST', stage: 'REQUEST', target: 'BC-ACC-031', result: 'ALLOWED', reason: null },
        { id: 2, at: '2026-11-04T05:00:00Z', actorId: 'usr-approver', actorRole: 'DOMAIN_REVIEWER', action: 'REFDB_CHANGE_REVIEW', stage: 'REVIEW', target: 'CR-2026-008', result: 'ALLOWED', reason: '검토 동의' },
        { id: 3, at: '2026-11-05T02:00:00Z', actorId: 'usr-steward', actorRole: 'REFDB_ADMIN', action: 'REFDB_CHANGE_DECIDE', stage: 'DECIDE', target: 'CR-2026-008', result: 'ALLOWED', reason: '근거 확인' },
        { id: 4, at: '2026-11-05T03:00:00Z', actorId: 'usr-steward', actorRole: 'REFDB_ADMIN', action: 'REFDB_RELEASE_PUBLISH', stage: 'PUBLISH', target: 'v1.5', result: 'ALLOWED', reason: '발행' },
      ],
      decision: { decision: 'APPROVE', decidedBy: 'usr-steward', at: '2026-11-05T02:00:00Z' },
      release: { release: 'v1.5', publishedBy: 'usr-steward', publishedAt: '2026-11-05T03:00:00Z', note: '발행' },
    };
    handler = (u) => (u.startsWith('/api/refdb/changes/CR-2026-008/audit') ? { body: trail } : u.startsWith('/api/refdb/changes/CR-2026-008') ? { body: { change, checks: [], usedBy: [] } } : undefined);
    mount({ role: 'viewer' }, '/master/feature-db/changes/CR-2026-008', '/master/feature-db/changes/:id', <RefChangeDetailScreen />);
    const list = await screen.findByTestId('cr-audit-trail');
    expect([...list.querySelectorAll('li')].map((li) => li.getAttribute('data-stage'))).toEqual(['REQUEST', 'REVIEW', 'DECIDE', 'PUBLISH']);
    expect(list.textContent).toContain('Feature DB 버전 발행');
    expect(list.textContent).not.toMatch(/REFDB_|usr-/);
    expect(document.body.textContent).toContain('결정 시각');
    expect(screen.getByRole('link', { name: /감사 화면에서 보기/ }).getAttribute('href')).toBe('/audit?prefix=CR-2026-008');
  });

  it('출처 — 다음 점검일 없는 출처 경고, 점검 결과 "개정 있음"이면 영향 행 변경 요청 길(P5-5)', async () => {
    const src = [
      { sourceId: 'S01', title: 'AUTOSAR', publisher: 'AUTOSAR', version: 'R24-11', url: '', checkedAt: '2026-01-01', nextReviewAt: '2027-01-01', usedBy: 12 },
      { sourceId: 'S64', title: '사내 자료', publisher: '', version: '', url: '', checkedAt: null, nextReviewAt: null, usedBy: 3 },
    ];
    handler = (u, init) => {
      if (u.startsWith('/api/refdb/sources/reviews') && init?.method === 'POST') return { status: 201, body: { items: [src[0]], affected: [{ sourceId: 'S01', refIds: ['CH-BRK-009', 'CH-BRK-010'] }] } };
      if (u.startsWith('/api/refdb/sources')) return { body: { items: src, noNextReview: 1 } };
      return undefined;
    };
    mount({ role: 'steward' }, '/master/feature-db?tab=sources&source=S01', '/master/feature-db', <SourcesPanel />);
    expect((await screen.findByText(refSourceReview.noNext(1))).getAttribute('data-no-next-review')).toBe('1');
    expect(document.querySelector('[data-review-unset="S64"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: refSourceReview.results.REVISED }));
    fireEvent.change(screen.getByRole('textbox', { name: /점검 메모/ }), { target: { value: '개정판 확인' } });
    fireEvent.click(screen.getByRole('button', { name: '점검 기록 남기기' }));
    const link = await screen.findByRole('link', { name: `${refSourceReview.makeChange} →` });
    expect(link.getAttribute('href')).toBe('/master/feature-db?source=S01');
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ sourceIds: ['S01'], result: 'REVISED' });
  });

  it('내보내기 받기 이름은 서버 파일 이름과 같다(P5-11)', () => {
    expect(exportDownloadName('attachment; filename="FeatureDB_v1.4.xlsx"', 'v1.4', 'xlsx')).toBe('FeatureDB_v1.4.xlsx');
    expect(exportDownloadName(null, 'v1.4', 'xlsx')).toBe('FeatureDB_v1.4.xlsx');
  });
});

describe('감사 화면(P5-6·P5-10)', () => {
  const AUDIT = [
    { id: 9, at: '2026-11-05T02:00:00.000Z', actorId: 'usr-steward', actorRole: 'REFDB_ADMIN', action: 'REFDB_CHANGE_DECIDE', target: 'CR-2026-008', result: 'ALLOWED', reason: '근거 확인', before: { status: 'REVIEW' }, after: { status: 'APPROVED' } },
    { id: 8, at: '2026-11-05T01:00:00.000Z', actorId: 'usr-quality', actorRole: 'GATE_JUDGE', action: 'GATE_JUDGE', target: 'FEAT-00187@0.1.0', result: 'FAILED', reason: 'x', before: null, after: null },
  ];
  it('행위 한글 이름·전후 값·앞부분 검색(?prefix=)·행위 필터, 체인 카드(마지막 검증·고정점·다시 검증), 헤드라인은 체인이 먼저', async () => {
    handler = (u) => (u.startsWith('/api/audit/chain') ? { body: { ok: true, verified: 1200, head: 'h', broken: null, anchors: { configured: false, checked: 0, lastAt: null }, checkedAt: '2026-11-05T03:00:00.000Z' } } : u.startsWith('/api/audit') ? { body: { items: AUDIT } } : undefined);
    mount({ role: 'viewer' }, '/audit?prefix=CR-2026', '/audit', <AuditScreen />);
    const table = await screen.findByRole('table');
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBe(2));
    expect(table.textContent).toContain('Feature DB 승인·반려');
    expect(table.querySelector('[data-action="REFDB_CHANGE_DECIDE"]')!.getAttribute('title')).toBe('REFDB_CHANGE_DECIDE');
    expect(table.querySelector('[data-audit-change]')!.textContent).toContain('status: REVIEW → APPROVED');
    // 앞부분 검색으로 요청
    expect(calls.some((c) => c.url.includes('targetPrefix=CR-2026'))).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '행위' }), { target: { value: 'REFDB_RELEASE_PUBLISH' } });
    await waitFor(() => expect(calls.some((c) => c.url.includes('action=REFDB_RELEASE_PUBLISH'))).toBe(true));
    // 체인 카드
    const card = screen.getByRole('region', { name: '해시 체인 검증' });
    expect(card.querySelector('[data-chain-checked]')!.textContent).toBe('2026-11-05 12:00');
    expect(card.querySelector('[data-anchor="off"]')).not.toBeNull();
    const before = calls.filter((c) => c.url.startsWith('/api/audit/chain')).length;
    fireEvent.click(within(card).getByRole('button', { name: '다시 검증' }));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/audit/chain')).length).toBe(before + 1));
    // 헤드라인 — 큰 숫자는 실패 수가 아니다(다른 업무 실패가 앞서지 않게), 실패는 상태 표시
    const key = document.querySelector('[data-key-message]')!;
    expect(key.querySelector('.ds-key__value')).toBeNull();
    expect(key.textContent).toContain('해시 체인 정상');
    expect(key.querySelector('.ds-key__status')!.textContent).toBe('실패 기록 1건');
  });
});

describe('변경 영향 분석 — 협력사로 시작(P5-2)', () => {
  it('협력사를 고르면 그 협력사 SW를 쓰는 Feature를 보이고, 바뀐 항목은 한글 이름', async () => {
    handler = (u) => {
      if (u.startsWith('/api/integrations/supplier/deliveries')) return { body: { items: [{ swId: 'SW-DMS-SVC', version: '2.1.0', supplier: 'Tier1-B' }] } };
      if (u.startsWith('/api/master/sw')) return { body: { items: [{ swId: 'SW-DMS-SVC', version: '2.1.0', features: ['FEAT-00190@0.1.0'] }] } };
      if (u.startsWith('/api/impact')) return { body: { feature: { featureId: 'FEAT-00190', version: '0.1.0', name: 'DMS', lifecycle: 'PROPOSED', baselineId: null, ownerId: 'o' }, dependents: [], baselines: [], products: [], rejudge: [], owners: [], summary: { dependents: 0, products: 0, releasedProducts: 0, rejudgeGates: 0 } } };
      if (u.startsWith('/api/features')) return { body: { items: [{ featureId: 'FEAT-00190', version: '0.1.0' }] } };
      return undefined;
    };
    mount({ role: 'viewer' }, '/analysis/impact?supplier=Tier1-B&feature=FEAT-00145&version=5.4.2', '/analysis/impact', <ImpactScreen />);
    const btn = await screen.findByRole('button', { name: 'FEAT-00190 0.1.0 영향 보기' });
    fireEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/impact/FEAT-00190/0.1.0'))).toBe(true));
    // 회귀: 영문 필드 키(ownerId …)가 그대로 보였다
    expect(screen.getByText('담당(Owner)').getAttribute('title')).toBe('ownerId');
    expect(document.querySelector('#target')?.textContent ?? document.body.textContent).not.toMatch(/\bownerId\b/);
  });
});
