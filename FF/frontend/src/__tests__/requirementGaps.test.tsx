// 기능명세서 공백 보강 화면(B1·B4·B5·B6) — 수신자 규칙·직접 보내기, 감사 변경 전후 값(민감 값 가림)·내보내기, Feature 평가 운영 탭,
// 연계 오류 이력 탭. 모의 API(fetch)로 화면이 계약 모양을 읽고 쓰는지 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SENSITIVE_MASK } from '@ff/contracts';
import { AppProvider } from '../store';
import { NotificationRulesScreen } from '../screens/home/NotificationRules';
import { AuditDiffDrawer, ExportButtons, PeriodFilter } from '../screens/governance/AuditTools';
import { NotificationsScreen } from '../screens/home/Notifications';
import EvaluationsTab from '../screens/features/EvaluationsTab';
import { AuditScreen } from '../screens/governance/AuditEvents';
import IntegrationErrorsTab from '../screens/ext/IntegrationErrorsTab';
import type { AuditEntry } from '../screens/types';

let calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[];

const RULES = {
  teams: ['ADAS기획팀', 'IVI기획팀'],
  items: [
    { event: 'policy.validated', name: '정책 검증 — 승인 요청(GO)·배포 차단(NO-GO)', category: 'DEPLOY', recipients: ['FEATURE_APPROVER', 'OWNER_TEAM', 'AUTHOR'], excludes: '승인 요청은 작성자 본인', requirementIds: [], added: [], updatedBy: null, updatedAt: null },
    { event: 'billing.call.failed', name: '과금 시스템 연계 오류', category: 'INTEGRATION', recipients: ['PRODUCT_AUTHOR', 'OPERATOR'], requirementIds: ['FR-BIL-001-004'], added: [{ kind: 'role', role: 'OPS_LEAD' }], updatedBy: 'usr-opslead', updatedAt: '2026-11-05T01:00:00.000Z' },
  ],
};
const STATS = {
  featureId: 'FEAT-00024',
  period: { from: '2026-11-04', to: '2026-11-06', days: 3, unit: 'DAY' },
  flagKeys: ['ivi_00024_guide'],
  totals: { evaluations: 1500, on: 1200, off: 280, safeDefault: 0, errors: 20 },
  byVariant: [{ variant: 'on', count: 1200 }, { variant: 'off', count: 280 }],
  bySource: [{ source: 'OFREP', count: 1100, on: 900, off: 180, safeDefault: 0, errors: 20 }, { source: 'VEHICLE_SDK', count: 400, on: 300, off: 100, safeDefault: 0, errors: 0 }],
  byApp: [{ appName: 'ivi-nav', environment: 'production', source: 'OFREP', count: 1100, lastDay: '2026-11-06' }],
  byFlag: [{ flagKey: 'ivi_00024_guide', count: 1500, on: 1200, off: 280, safeDefault: 0, errors: 20 }],
  daily: [{ day: '2026-11-05', count: 700, on: 560, off: 120, safeDefault: 0, errors: 20 }, { day: '2026-11-06', count: 800, on: 640, off: 160, safeDefault: 0, errors: 0 }],
};
const ERRORS = {
  counts: { LEGACY: 1, BILLING: 0, SIGNING: 0, PIPELINE: 0 },
  items: [{ errorId: 'ERR-00001', at: '2026-11-05T05:00:00.000Z', system: 'LEGACY', systemName: 'Legacy 연계(해외공장 ERP)', errorType: 'CONNECTION_OFF', target: 'IF-12 해외공장 TMA', message: 'IF-12 연계가 꺼져 있습니다', actorId: 'usr-operator', featureId: null, correlationId: null }],
};

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('/api/notifications/rules/') && method === 'PUT') return json({ ...RULES.items[0], added: [{ kind: 'role', role: 'RELEASE_MANAGER' }] });
      if (url.startsWith('/api/notifications/rules')) return json(RULES);
      if (url.startsWith('/api/notifications/send')) return json({ notificationId: 'NTF-00042', recipients: [{ kind: 'role', role: 'OPERATOR' }] });
      if (url.startsWith('/api/features/FEAT-00024/evaluations')) return json(STATS);
      if (url.startsWith('/api/integrations/errors')) return json(ERRORS);
      if (url.startsWith('/api/audit/policy-stats')) return json({ items: [{ policyId: 'POL-00001', views: 4, updates: 2, approvals: 1, deploys: 1, lastAt: '2026-11-05T01:00:00.000Z', lastAction: 'POLICY_DEPLOY' }] });
      if (url.startsWith('/api/audit/chain')) return json({ ok: true, verified: 10, head: 'h', broken: null, checkedAt: '2026-11-05T01:00:00.000Z' });
      if (url.startsWith('/api/audit/export'))
        return new Response('# sha256=abc\r\nid,at\r\n', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="FF_audit_start_now_1.csv"', 'X-FF-Export-Rows': '12', 'X-FF-Export-SHA256': 'abcdef0123456789abcdef' } });
      return json({ items: [] });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>{el}</AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('수신자 규칙 화면(B1)', () => {
  it('이벤트마다 기본 수신자와 추가 수신자를 보이고, 운영 리더는 추가 수신자를 바꾼다(사유 필수)', async () => {
    mount('opslead', <NotificationRulesScreen />);
    const table = await screen.findByRole('table', { name: '이벤트별 수신자' });
    expect(within(table).getByText('과금 시스템 연계 오류')).toBeTruthy();
    expect(within(table).getAllByText('Feature Owner 팀').length).toBeGreaterThan(0);
    expect(table.querySelector('[data-recipient="role:OPS_LEAD"]')?.textContent).toContain('운영 리더');
    fireEvent.click(within(table).getAllByRole('button', { name: '수신자 더하기' })[0]);
    const drawer = await screen.findByRole('dialog');
    const picker = within(drawer).getByTestId('recipient-picker');
    fireEvent.change(within(picker).getByLabelText('누구'), { target: { value: 'RELEASE_MANAGER' } });
    fireEvent.click(within(picker).getByRole('button', { name: '더하기' }));
    const save = within(drawer).getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(drawer).getByLabelText('바꾸는 이유'), { target: { value: '출시 담당도 검증 결과를 본다' } });
    fireEvent.click(within(drawer).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/api/notifications/rules/policy.validated');
    expect(put.body).toEqual({ recipients: [{ kind: 'role', role: 'RELEASE_MANAGER' }], reason: '출시 담당도 검증 결과를 본다' });
    expect(put.headers['X-Actor-Role']).toBe('OPS_LEAD');
  });

  it('감사 조회자는 바꿀 수 없다 — 단추가 이유와 함께 꺼진다', async () => {
    mount('viewer', <NotificationRulesScreen />);
    const table = await screen.findByRole('table', { name: '이벤트별 수신자' });
    expect((within(table).getAllByRole('button', { name: '수신자 더하기' })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('알림 직접 보내기 — 사람·역할·팀을 골라 보내고 결과 번호를 보인다', async () => {
    mount('opslead', <NotificationRulesScreen />);
    const panel = (await screen.findByText('알림 직접 보내기')).closest('section')!;
    fireEvent.change(within(panel).getByLabelText('제목'), { target: { value: 'Edge 점검' } });
    fireEvent.change(within(panel).getByLabelText('내용'), { target: { value: '22시 5분 멈춤' } });
    const picker = within(panel).getByTestId('recipient-picker');
    fireEvent.change(within(picker).getByLabelText('누구'), { target: { value: 'OPERATOR' } });
    fireEvent.click(within(picker).getByRole('button', { name: '더하기' }));
    fireEvent.click(within(panel).getByRole('button', { name: '보내기' }));
    expect(await within(panel).findByText('NTF-00042 — 수신자 1곳에 보냈습니다.')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/notifications/send')!.body).toEqual({ title: 'Edge 점검', message: '22시 5분 멈춤', severity: 'INFO', recipients: [{ kind: 'role', role: 'OPERATOR' }] });
  });
});

describe('감사 변경 전후 값·내보내기(B4)', () => {
  const entry: AuditEntry = { id: 7, at: '2026-11-05T01:00:00.000Z', actorId: 'usr-steward', actorRole: 'REFDB_ADMIN', action: 'REFDB_CHANGE_DECIDE', target: 'BC-ACC-023', result: 'ALLOWED', reason: null, before: { benchmarkEur: 1200, name: '가' }, after: { benchmarkEur: 1500, name: '나' }, correlationId: null, componentId: 'D01-01' } as AuditEntry;
  it('필드 단위 전후 값 — 금액은 값 대신 가림', async () => {
    mount('viewer', <AuditDiffDrawer entry={entry} onClose={() => undefined} />);
    const d = await screen.findByTestId('audit-diff');
    expect(within(d).getByText('name')).toBeTruthy();
    expect(within(d).getByText('나')).toBeTruthy();
    expect(within(d).getAllByText('가림')).toHaveLength(2);
    expect(d.textContent).not.toContain('1500');
    expect(SENSITIVE_MASK).toBe('(가림)');
  });

  it('CSV 내보내기 — 역할 머리글을 붙여 받고 행 수·해시를 보인다, 작성자는 꺼진다', async () => {
    mount('viewer', <ExportButtons name="auditExport" query={{ from: '2026-11-01', to: undefined }} />);
    fireEvent.click(screen.getByRole('button', { name: 'CSV로 내보내기' }));
    expect(await screen.findByText('12행 · SHA-256 abcdef012345…')).toBeTruthy();
    const c = calls.find((x) => x.url.startsWith('/api/audit/export'))!;
    expect(c.url).toBe('/api/audit/export?from=2026-11-01&format=csv');
    expect(c.headers['X-Actor-Role']).toBe('AUDITOR');
    cleanup();
    mount('author', <ExportButtons name="auditExport" query={{}} />);
    expect((screen.getByRole('button', { name: 'CSV로 내보내기' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('정책 운영 현황 보기 — 감사 화면 안에서 정책별 조회·수정·승인·배포 횟수(화면 제목은 하나)', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'viewer' }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/audit?view=policies']}>
          <AppProvider>
            <Routes>
              <Route path="/audit" element={<AuditScreen />} />
            </Routes>
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const box = await screen.findByTestId('policy-stats');
    expect(await within(box).findByText('POL-00001')).toBeTruthy();
    expect(within(box).getByRole('table').textContent).toContain('정책 배포');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Feature 평가 운영 탭(B5)', () => {
  it('평가·활성·비활성·오류 합계, 일별, 분기값·경로·앱·환경·flag별', async () => {
    mount('viewer', <EvaluationsTab id="FEAT-00024" />);
    const box = await screen.findByTestId('evaluations');
    expect(box.textContent).toContain('1,500');
    expect(box.textContent).toContain('활성 비율 80%');
    expect(within(box).getByRole('list', { name: '일별 평가' }).querySelectorAll('li')).toHaveLength(2);
    expect(within(box).getByRole('table', { name: '애플리케이션·환경별' }).textContent).toContain('ivi-nav');
    expect(within(box).getByRole('table', { name: '평가 경로별' }).textContent).toContain('앱 평가 API(OFREP)');
    expect(within(box).getByRole('table', { name: '분기값별' }).textContent).toContain('활성(on)');
  });
});

describe('연계 오류 이력 탭(B6)', () => {
  it('오류 유형·시점·대상·내용, 시스템 거르기는 질의로', async () => {
    mount('viewer', <IntegrationErrorsTab />);
    const t = await screen.findByRole('table', { name: '오류 이력' });
    expect(t.textContent).toContain('Legacy 연계(해외공장 ERP)');
    expect(t.textContent).toContain('연계 꺼짐');
    fireEvent.change(screen.getByLabelText('시스템'), { target: { value: 'BILLING' } });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/integrations/errors?system=BILLING')).toBe(true));
  });
});

describe('하네스 리뷰 회귀', () => {
  it('알림함 — 앱 밖 주소(//·역슬래시)로 저장된 링크는 알림함으로 돌린다(열린 리다이렉트)', async () => {
    const item = (id: string, link: string) => ({ notificationId: id, eventSeq: 1, eventType: 'notification.sent', aggregate: 'direct:usr-x', createdAt: '2026-11-05T01:00:00.000Z', category: 'DIRECT', severity: 'INFO', title: '점검', fields: [], link, recipients: [], exclude: [], requirementIds: [], readAt: '2026-11-05T02:00:00.000Z' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.startsWith('/api/notifications') ? { items: [item('NTF-1', '//evil.example/x'), item('NTF-2', '/\\evil.example'), item('NTF-3', '/ops/kill')], unread: 0, byCategory: {} } : { items: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    mount('operator', <NotificationsScreen />);
    const rows = await screen.findAllByTestId('notification-row');
    const hrefs = rows.map((r) => within(r).getByRole('link', { name: '열기' }).getAttribute('href'));
    expect(hrefs).toEqual(['/notifications', '/notifications', '/ops/kill']);
  });

  it('수신자 규칙 — 직접 보낸 알림 줄은 추가 수신자를 둘 수 없다(운영 리더에게도 꺼짐)', async () => {
    RULES.items.push({ event: 'notification.sent', name: '직접 보낸 알림', category: 'DIRECT', recipients: ['CHOSEN'], excludes: '보낸 사람 본인', requirementIds: [], added: [], updatedBy: null, updatedAt: null, fixed: true } as any);
    try {
      mount('opslead', <NotificationRulesScreen />);
      const table = await screen.findByRole('table', { name: '이벤트별 수신자' });
      const row = table.querySelector('[data-event="notification.sent"]')!.closest('tr')!;
      expect((within(row).getByRole('button', { name: '수신자 더하기' }) as HTMLButtonElement).disabled).toBe(true);
      const other = table.querySelector('[data-event="policy.validated"]')!.closest('tr')!;
      expect((within(other).getByRole('button', { name: '수신자 더하기' }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      RULES.items.pop();
    }
  });

  it('평가 운영 — 일별 막대의 나머지 칸은 비활성만이 아니다(Safe Default·오류 포함) — 비활성 합계와 같은 이름을 쓰지 않는다', async () => {
    mount('viewer', <EvaluationsTab id="FEAT-00024" />);
    const box = await screen.findByTestId('evaluations');
    const legend = box.querySelector('.ev-legend')!;
    expect(legend.textContent).toContain('활성');
    expect(legend.textContent).toContain('Safe Default');
    const day = within(box).getByRole('list', { name: '일별 평가' }).querySelector('li')!;
    expect(day.getAttribute('aria-label')).toContain('비활성 120');
    expect(day.getAttribute('aria-label')).toContain('오류 20');
  });

  it('기간 고르기 — 날짜가 한국 시간 기준임을 알린다(화면 시각과 같은 기준)', async () => {
    mount('viewer', <PeriodFilter value={{ from: '', to: '' }} onChange={() => undefined} />);
    expect(screen.getByTestId('period-filter').textContent).toContain('한국 시간');
  });
});
