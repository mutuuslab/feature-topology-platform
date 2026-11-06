// 공개 정적 데모(VITE_DATA_MODE=static)에 빈 상태 금지(2026-11-05 사용자 규칙) — 알림 센터·종·운영 지표·업무 절차·OpenFeature는
// 정적에서도 tools/snapshot-api.ts가 받아 둔 스냅샷으로 채운다. 회귀: 이 화면들은 정적에서 조회를 끄고
// '읽기 전용 데모에서는 …없습니다'·'정적 시연에서는 …수집하지 않습니다' 안내만 그렸다.
// 화면이 요청하는 스냅샷 파일 이름은 snapshot-api의 질의 목록과 정확히 같아야 한다(키 순서 포함) — 다르면 공개 사이트에서 404 오류 상자다.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// 정적 모드는 모듈을 읽을 때 정해진다(api/client STATIC_MODE) — 어떤 모듈보다 먼저
vi.hoisted(() => {
  vi.stubEnv('VITE_DATA_MODE', 'static');
});
// 도구 공용 유틸(lib.ts)은 import.meta.url로 FF 경로를 찾는다 — jsdom에서는 그 경로만 준다(스냅샷 백엔드는 직접 실행할 때만 뜬다)
vi.mock('../../../tools/lib.ts', () => ({ FF: join(__dirname, '..', '..', '..') }));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const { NOTIFICATION_CATEGORIES, ofrepSnapshotFile, routeUrl, snapshotFile } = await import('@ff/contracts');
const { notificationQueries } = await import('../../../tools/snapshot-api');
const { STATIC_MODE } = await import('../api/client');
const { AppProvider } = await import('../store');
const { NotificationsScreen } = await import('../screens/home/Notifications');
const { NotificationBell } = await import('../shell/NotificationBell');
const { default: TelemetryObservability } = await import('../screens/ops/TelemetryObservability');
const { OpenFeaturePanel } = await import('../screens/policy/OpenFeaturePanel');
const { __resetProcedureStore, procedureStore, useProcedureInbox, useProcedureSummary } = await import('../data/procedureProgress');
const { ko } = await import('../copy/ko');

type Item = { notificationId: string; category: string; severity: string; title: string; fields: { label: string; value: string }[]; link: string; createdAt: string; readAt: string | null };
const ntf = (id: number, category: string, readAt: string | null = null): Item => ({ notificationId: `NTF-${String(id).padStart(5, '0')}`, category, severity: 'INFO', title: `${category} 알림 ${id}`, fields: [], link: '/', createdAt: '2026-11-05T01:00:00.000Z', readAt });
const ITEMS = [ntf(4, 'APPROVAL'), ntf(3, 'GATE'), ntf(2, 'GATE', '2026-11-05T02:00:00.000Z'), ntf(1, 'SAFETY')];

/** 백엔드처럼 거른 받은 알림(notification.service inbox) */
function inbox(q: Record<string, unknown>) {
  const unreadAll = ITEMS.filter((n) => !n.readAt);
  const byCategory: Record<string, number> = {};
  for (const n of unreadAll) if (!q.category || n.category === q.category) byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
  const items = ITEMS.filter((n) => (!q.unread || !n.readAt) && (!q.category || n.category === q.category)).slice(0, Number(q.limit));
  return { items, unread: Object.values(byCategory).reduce((a, b) => a + b, 0), byCategory };
}

// 차량 회신은 요청 ID가 없다 — 같은 게시본의 발행 이벤트와 그 차량의 회신 이벤트로 잇는다
const READBACK = { vin: 'ego-01', publicationId: 'PUB-00001', at: '2026-11-05T01:00:00.000Z', observed: 'sha256:aa' };
const EVENTS = [
  { id: 'e1', seq: 1, at: '2026-11-05T00:59:00.000Z', type: 'publication.signed', aggregate: 'PUB-00001', correlationId: 'boot-sync', componentId: 'D02-03', payload: { publicationId: 'PUB-00001' } },
  { id: 'e2', seq: 2, at: '2026-11-05T01:00:00.000Z', type: 'vehicle.readback', aggregate: 'ego-01', correlationId: null, componentId: 'D02-03', payload: { publicationId: 'PUB-00001' } },
  { id: 'e3', seq: 3, at: '2026-11-05T01:00:01.000Z', type: 'vehicle.readback', aggregate: 'lead-01', correlationId: null, componentId: 'D02-03', payload: { publicationId: 'PUB-00001' } },
];

const METRICS = ['# HELP ff_http_requests_total HTTP 요청 수', '# TYPE ff_http_requests_total counter', 'ff_http_requests_total{method="GET",route="/api/features",status="200"} 7'].join('\n');
const PROC_SUMMARY = { todo: 3, review: 1, overdue: 0, done: 2, total: 6, processes: [] };
const PROC_INBOX = { items: [{ activityId: 'FPW.7-A08', name: 'Canary 판정 기준', processId: 'FPW.7', duty: 'R', dueAt: null, overdue: false }], updatedAt: null };

/** 스냅샷 파일 → 본문. snapshot-api가 저장하는 것과 같은 이름 */
function files(): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const q of notificationQueries(NOTIFICATION_CATEGORIES)) m.set(snapshotFile(routeUrl('notifications', {}, q)), inbox(q));
  m.set(snapshotFile(routeUrl('killRequests', {}, { status: 'ACTIVE' })), { items: [] });
  // 플랫폼 이벤트(정적은 받아 둔 최근 이벤트를 한 번 읽는다)
  m.set(snapshotFile(routeUrl('events', {}, { limit: 500, recent: '1' })), { items: EVENTS });
  m.set(snapshotFile(routeUrl('readbacks')), { items: [READBACK] });
  m.set(snapshotFile(routeUrl('otelSpans', {}, { limit: 300 })), { items: [] });
  m.set(snapshotFile(routeUrl('healthMetrics')), { text: METRICS, capturedAt: '2026-11-05T03:00:00.000Z' });
  m.set(snapshotFile(routeUrl('procedureState')), { items: [], done: ['FPW.1-A01'], updatedAt: null });
  m.set(snapshotFile(routeUrl('procedureSummary')), PROC_SUMMARY);
  m.set(snapshotFile(routeUrl('procedureInbox')), PROC_INBOX);
  m.set(ofrepSnapshotFile('ego-01'), {
    bulk: { flags: [{ key: 'ivi_00024_guide', value: true, variant: 'on', reason: 'TARGETING_MATCH', metadata: { policyId: 'POL-00003' } }] },
    flags: { ivi_00024_guide: { key: 'ivi_00024_guide', value: true, variant: 'on', reason: 'TARGETING_MATCH' } },
    evaluatedAt: '2026-11-05T03:00:00.000Z',
  });
  return m;
}

let requested: string[];
let missing: string[];
beforeEach(() => {
  localStorage.clear();
  __resetProcedureStore();
  requested = [];
  missing = [];
  const snap = files();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = String(url).replace(/^\//, '');
      requested.push(file);
      // 없는 파일 — 정적 호스팅의 SPA 대체 응답(index.html, 200)
      if (!snap.has(file)) {
        missing.push(file);
        return new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response(JSON.stringify(snap.get(file)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path.split('?')[0]} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const STATIC_EMPTY = /읽기 전용 데모에서는|백엔드에 연결|정적 시연에서는|수집하지 않습니다/;

describe('정적 데모 — 스냅샷으로 채운다', () => {
  it('정적 모드로 읽혔다', () => {
    expect(STATIC_MODE).toBe(true);
  });

  it('알림 센터 — 받은 알림·범주 수가 보이고, 안 읽음/전체·범주 전환이 모두 스냅샷 파일에 있다. 읽음 처리는 열려 있다', async () => {
    mount('/notifications', <NotificationsScreen />);
    // 기본 보기(안 읽음) — 안 읽은 3건
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(3));
    expect(document.body.textContent).not.toMatch(STATIC_EMPTY);
    // 이벤트 이력(500건)은 받지 않는다 — 새 이벤트로 다시 읽기만(2026-11-06 홈 속도)
    expect(requested.some((f) => f.includes('events_'))).toBe(false);
    // 읽음은 이 브라우저의 시연 데이터로 처리된다(2026-11-06, 20-60) — 버튼이 열려 있다
    for (const b of screen.getAllByRole('button', { name: ko.notify.markRead })) expect((b as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: ko.notify.markAll }) as HTMLButtonElement).disabled).toBe(false);
    // 범주 고르기 — 받은 알림이 있는 범주만(빈 범주를 골라 빈 목록이 보이지 않게)
    const select = screen.getByRole('combobox', { name: ko.notify.categoryLabel }) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value).filter(Boolean);
    expect(options.sort()).toEqual(['APPROVAL', 'GATE', 'SAFETY']);
    for (const c of options) {
      fireEvent.change(select, { target: { value: c } });
      await waitFor(() => expect(screen.getAllByTestId('notification-row').length).toBeGreaterThan(0));
    }
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${ko.notify.all}`) }));
    await waitFor(() => expect(screen.getAllByTestId('notification-row')).toHaveLength(4));
    for (const c of options) {
      fireEvent.change(select, { target: { value: c } });
      await waitFor(() => expect(screen.getAllByTestId('notification-row').every((r) => within(r).getByText(new RegExp(`^${c} 알림`)))).toBe(true));
    }
    expect(missing).toEqual([]);
    expect(document.querySelector('[data-state="error"]')).toBeNull();
  });

  it('상단 종 — 안 읽음 배지와 최근 알림 목록', async () => {
    mount('/', <NotificationBell />);
    expect((await screen.findByTestId('notify-badge')).textContent).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: ko.shell.notificationsUnread(3) }));
    const pop = await screen.findByRole('dialog', { name: ko.notify.popoverTitle });
    expect(within(pop).getAllByRole('listitem')).toHaveLength(4);
    expect(pop.textContent).not.toMatch(STATIC_EMPTY);
    expect(requested.some((f) => f.includes('events_'))).toBe(false);
    expect(missing).toEqual([]);
  });

  it('운영 지표 탭 — 스냅샷의 Prometheus 텍스트를 같은 표로 그린다', async () => {
    mount('/ops/telemetry?observe=metrics', <TelemetryObservability />);
    const table = await screen.findByRole('table', { name: '처리 지표' });
    expect(within(table).getByText('GET /api/features')).toBeTruthy();
    expect(within(table).getByText('7')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(STATIC_EMPTY);
    expect(requested).toContain(snapshotFile(routeUrl('healthMetrics')));
  });

  it('차량 회신 상세 — 같은 게시본의 발행·이 차량 회신 이벤트를 연결한다(요청 ID가 없어 늘 「연결된 이벤트 없음」이던 결함)', async () => {
    mount('/ops/telemetry?observe=readbacks', <TelemetryObservability />);
    const table = await screen.findByRole('table', { name: '차량 회신' });
    fireEvent.click(within(table).getAllByRole('row')[1]);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('publication.signed')).toBeTruthy();
    expect(within(drawer).getAllByText('vehicle.readback')).toHaveLength(1);
    expect(within(drawer).queryByText('같은 요청 ID로 연결된 이벤트가 없습니다.')).toBeNull();
  });

  it('업무 절차 — 검토함·요약·완료 상태를 스냅샷에서 읽는다(처음 열면 스냅샷 완료로 시작)', async () => {
    let inboxState: ReturnType<typeof useProcedureInbox> | null = null;
    let summary: ReturnType<typeof useProcedureSummary> = null;
    function Probe() {
      inboxState = useProcedureInbox('author');
      summary = useProcedureSummary('author');
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    await act(async () => {
      procedureStore.hydrate('author');
    });
    // 불러오기가 끝나기를 결과 상태로 기다린다(고정 시간 잠자기 없이)
    await waitFor(() => expect(summary).toEqual(PROC_SUMMARY));
    await waitFor(() => expect(procedureStore.isDone('FPW.1-A01')).toBe(true));
    expect(inboxState!.status).toBe('ready');
    expect(inboxState!.data).toEqual(PROC_INBOX);
    expect(procedureStore.isDone('FPW.1-A01')).toBe(true);
    expect(missing).toEqual([]);
  });

  it('OpenFeature — 스냅샷의 bulk 평가로 SDK 값·사유를 보인다(bulk에 없는 키는 SDK처럼 FLAG_NOT_FOUND)', async () => {
    mount('/activation/decide', <OpenFeaturePanel vin="ego-01" flagKey="ivi_00024_guide" serverValue={true} />);
    expect((await screen.findByTestId('of-value')).textContent).toBe('ON');
    expect(screen.getByText('TARGETING_MATCH')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(STATIC_EMPTY);
    cleanup();
    mount('/activation/decide', <OpenFeaturePanel vin="ego-01" flagKey="care_00022_signal" serverValue={null} />);
    expect((await screen.findByTestId('of-value')).textContent).toBe('OFF');
    expect(screen.getByText(/FLAG_NOT_FOUND/)).toBeTruthy();
    expect(missing).toEqual([]);
  });
});
