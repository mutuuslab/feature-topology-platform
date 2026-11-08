// 정적 공개본(STATIC_MODE) — '정적이라 비었다'는 안내 대신 받아 둔 데이터를 보인다(2026-11-05 사용자 규칙·코디네이터 목록).
//  · 이벤트 실시간 패널: 받아 둔 최근 이벤트 흐름 · 감사 이력: 다음 쪽도 읽는다 · Feature DB 내보내기: 받아 둔 파일
//  · 모의 연계 표시 없음(D-ALM-17) · 따라하기: 준비된 시나리오와 보기 모드만 · Feature 전이 버튼: 지금 역할로 판정(보기 전용 안내 없음)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TUTORIALS } from '@ff/contracts';
import { AppProvider } from '../store';
import { ko } from '../copy/ko';
import { lists as L } from '../copy/lists';
import { refChanges as RC } from '../copy/refdb';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), STATIC_MODE: true }));

const { EventsScreen, AuditScreen } = await import('../screens/governance/AuditEvents');
const { LearnHub, LearnRun } = await import('../screens/learn/Learn');
const { RefChangesScreen } = await import('../screens/refdb/Changes');
const { staticExportFile } = await import('../screens/refdb/common');
const { connectionLabel } = await import('../api/connections');
const { default: FeatureDetail } = await import('../screens/features/FeatureDetail');
const { learnStore } = await import('../shell/learn');

let reply: (url: string) => unknown;
let urls: string[];

beforeEach(() => {
  localStorage.clear();
  learnStore.reload();
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('.xlsx')) return new Response(new Blob(['PK']), { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
      return new Response(JSON.stringify(reply(url) ?? { items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, pattern: string, el: JSX.Element, role = 'author') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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

const ev = (seq: number) => ({ seq, at: `2026-11-05T0${seq % 10}:00:00.000Z`, type: `EVENT_${seq}`, aggregate: `AGG-${seq}`, componentId: null, payload: { status: 'OK' } });

describe('정적 공개본 — 정적 안내 대신 데이터', () => {
  it('이벤트 — 실시간 패널이 받아 둔 최근 이벤트를 흐름으로 보이고, 표식은 저장된 흐름', async () => {
    reply = (u) => (u.startsWith('/api/events') ? { items: [ev(1), ev(2), ev(3)] } : undefined);
    mount('/events', '/events', <EventsScreen />);
    const live = await screen.findByRole('list');
    await waitFor(() => expect(within(live).getAllByRole('listitem')).toHaveLength(3));
    expect(within(live).getAllByRole('listitem')[0].textContent).toContain('EVENT_3');
    expect(screen.queryByText(/실시간 연결이 없습니다/)).toBeNull();
    expect(screen.getByText(`SSE · ${ko.events.status.static}`)).toBeTruthy();
  });

  it('감사 이력 — 다음 쪽을 막지 않고 커서로 이어 읽는다', async () => {
    const row = (id: number) => ({ id, at: '2026-11-05T00:00:00.000Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'POLICY_CREATE', target: `POL-${id}`, result: 'ALLOWED', before: null, after: null, reason: null, componentId: null });
    reply = (u) => (u.startsWith('/api/audit/chain') ? { ok: true, verified: 3, head: null, broken: null } : u.includes('cursor=c2') ? { items: [row(1)], nextCursor: null } : u.startsWith('/api/audit') ? { items: [row(3), row(2)], nextCursor: 'c2' } : undefined);
    mount('/audit', '/audit', <AuditScreen />);
    const more = await screen.findByRole('button', { name: L.loadMore });
    expect((more as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(more);
    await waitFor(() => expect(urls.some((u) => u.includes('cursor=c2'))).toBe(true));
    await waitFor(() => expect(document.querySelector('#main, body')!.textContent).toContain('POL-1'));
  });

  it('Feature DB 내보내기 — 막지 않고 받아 둔 발행본 파일을 내려받는다', async () => {
    reply = (u) => (u.startsWith('/api/refdb/releases') ? { items: [{ release: 'v1.3', publishedAt: '2026-11-04T00:00:00Z', publishedBy: 'seed', note: '', changeIds: [], hash: 'h' }] } : undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    mount('/master/feature-db/changes', '/master/feature-db/changes', <RefChangesScreen />, 'steward');
    // 발행 목록이 오면 버튼이 다시 그려진다 — 매번 새로 찾는다
    const exportButton = () => screen.getByRole('button', { name: RC.export }) as HTMLButtonElement;
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    const file = staticExportFile('/api/refdb/export?format=xlsx&release=v1.3');
    expect(file).toBe('api-snapshot/refdb_export_format_xlsx_release_v1.3.xlsx');
    await waitFor(() => expect(urls.some((u) => u.endsWith(file))).toBe(true));
  });

  it('모의 연계 — 정적 공개본은 상태를 읽기 전에도 표시하지 않는다(D-ALM-17), 꺼진 연결만 연결 안 됨', () => {
    expect(connectionLabel(null, null)).toBe('none');
    expect(connectionLabel({ mode: 'mock' }, 'demo')).toBe('none');
    expect(connectionLabel({ mode: 'off' }, 'demo')).toBe('disconnected');
  });

  it('따라하기 — 시나리오를 모두 싣고(준비 중 묶음 없음), 시나리오는 보기 모드만', () => {
    mount('/learn', '/learn', <LearnHub />);
    // 따라하기 시나리오는 모두 준비됐다(learn 병합 — 상태 칸 없음, 통합 12단계) — 정적에서도 전부 싣는다
    const ready = TUTORIALS;
    expect(screen.getAllByRole('listitem')).toHaveLength(ready.length);
    cleanup();
    mount(`/learn/${ready[0].id}`, '/learn/:id', <LearnRun />);
    expect(screen.getByRole('button', { name: ko.learn.mode.view })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ko.learn.mode.self })).toBeNull(); // 정적은 보기만(직접 하기는 쓰기가 필요)
    expect(screen.queryByText(/아직 연결 전/)).toBeNull();
  });

  it('Feature 전이 버튼 — 정적에서도 지금 역할로 판정한다(받아 둔 상세의 역할 막힘은 다시 계산, 쓰기는 시연 데이터)', async () => {
    const F13 = { featureId: 'FEAT-00013', version: '0.3.0', isLatest: true, name: '예측 공조', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', lifecycle: 'PROPOSED', baselineId: null, ownerId: 'ADAS상품기획팀', asil: 'B', tags: [], controlPoints: ['Signal'], gates: {} };
    const DETAIL = {
      feature: { ...F13, requirementIds: ['REQ-1'], description: '예측', upgVc: [], functions: [], swIds: [], swVersions: [], ecuPnos: [], dependencyIds: [], catalogIds: [], gateRecordIds: [], _missing: {} },
      meta: { createdBy: null, createdAt: null },
      gates: {},
      dependencies: { outgoing: [], incoming: [] },
      functions: [],
      trace: [],
      baseline: null,
      products: [],
      pendingBaselineRequest: null,
      transitions: [{ to: 'APPROVED', ko: '정의 승인', auto: false, roles: ['Feature 승인자'], blockers: [{ code: 'ROLE', message: '역할', ref: null }] }],
      versions: [{ version: '0.3.0', lifecycle: 'PROPOSED', baselineId: null }],
    };
    reply = () => DETAIL;
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />);
    await screen.findByRole('heading', { level: 1 });
    const lc = document.querySelector('.feature-lifecycle-actions') as HTMLElement;
    // 작성자 — 정의 승인은 승인자 몫(역할 막힘 사유), 읽기 전용 안내는 없다
    expect(lc.textContent).not.toContain(ko.page.readOnly);
    // 전이와 P10의 '정의 승인 반려'는 별도 행동이다 — 정확한 전이 이름으로 역할 판정을 확인한다.
    expect(within(lc).getByRole('button', { name: 'APPROVED로 전이', exact: true })).toHaveProperty('disabled', true);
    cleanup();
    // 승인자 — 받아 둔 상세에는 역할 막힘이 찍혀 있어도 지금 역할로 다시 판정해 누를 수 있다
    mount('/features/FEAT-00013/0.3.0', '/features/:id/:ver', <FeatureDetail />, 'approver');
    await screen.findByRole('heading', { level: 1 });
    const lc2 = document.querySelector('.feature-lifecycle-actions') as HTMLElement;
    expect(within(lc2).getByRole('button', { name: 'APPROVED로 전이', exact: true })).toHaveProperty('disabled', false);
  });
});
