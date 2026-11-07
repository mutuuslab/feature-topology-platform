// AC 화면 — 승인 조합 제안→승인(작성자 ≠ 승인자)·보안 최소 버전 표(사이버보안 담당 승인)·권한 범위. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ConfigSet, RoleScope, SecurityMinEntry } from '@ff/contracts';
import { AppProvider } from '../store';
import CompatSetsScreen from '../screens/ads/CompatSets';
import { RoleScopePanel } from '../screens/admin/RoleScopes';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

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

const mount = (role: string, path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
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

const AT = '2026-11-06T01:00:00.000Z';
const base = {
  featureId: 'FEAT-00004', featureVersion: '4.1.0', hw: [{ ecuPno: '99211-GN700', hwRevision: 'Rev.B' }], model: null, calibration: null, oddProfileId: null, flagKey: null,
  securityMin: [{ swId: 'SW-HDA2-APP', version: '4.0.5' }], featureName: '고속도로 주행 보조 2', counts: { MATCH: 1, MISMATCH: 0, PARTIAL_RECOVERY: 0, BELOW_SECURITY_MIN: 0, UNCONFIRMED: 0 },
};
const APPROVED: ConfigSet = { ...base, setId: 'CFG-FEAT-00004-01', ecuSw: [{ ecuPno: '99211-GN700', swId: 'SW-HDA2-APP', version: '4.1.0' }], status: 'APPROVED', proposedBy: 'usr-steward', proposedAt: AT, approvedBy: 'usr-quality', approvedAt: AT };
const proposed = (by: string): ConfigSet => ({ ...base, setId: 'CFG-FEAT-00004-02', ecuSw: [{ ecuPno: '99211-GN700', swId: 'SW-HDA2-APP', version: '4.1.2' }], status: 'PROPOSED', proposedBy: by, proposedAt: AT, approvedBy: null, approvedAt: null });
const MINS: SecurityMinEntry[] = [
  { entryId: 'SMV-0001', swId: 'SW-HDA2-APP', version: '4.0.5', status: 'APPROVED', rationale: 'HDA2 앱 취약점 대응', proposedBy: 'usr-steward', proposedAt: AT, approvedBy: 'usr-integrator', approvedAt: AT, approvalReason: '확인' },
  { entryId: 'SMV-0002', swId: 'SW-HDA2-APP', version: '4.1.0', status: 'PROPOSED', rationale: '원격 진단 포트 대응', proposedBy: 'usr-integrator', proposedAt: AT, approvedBy: null, approvedAt: null, approvalReason: null },
];
const handlerWith = (pendingBy: string): Handler => (url) => {
  if (url.startsWith('/api/security-mins')) return { body: { items: MINS, current: [{ swId: 'SW-HDA2-APP', version: '4.0.5' }], pending: 1, unregistered: ['SW-RADAR-SVC'] } };
  if (url.startsWith('/api/config-sets/') && url.includes('/approve')) return { status: 201, body: { ...proposed(pendingBy), status: 'APPROVED', approvedBy: 'usr-quality' } };
  if (url.startsWith('/api/config-sets'))
    return { body: { items: [APPROVED, proposed(pendingBy)], summary: { outside: 0, partial: 0, unconfirmed: 0, match: 1, total: 1, counts: base.counts }, staleAfterMs: 86_400_000, pending: 1 } };
  return undefined;
};

describe('승인 조합 제안 → 승인', () => {
  it('승인 대기 조합 — 상태 글자·승인 대기 수, 기능안전 담당은 사유를 적고 승인한다', async () => {
    handler = handlerWith('usr-steward');
    mount('quality', '/config/compat', <CompatSetsScreen />);
    expect(await screen.findByText('승인 대기 조합 1개 — 승인 전에는 차량 대조·발행에 쓰지 않습니다')).toBeTruthy();
    expect(screen.getAllByText('승인 대기').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '조합 승인' }));
    fireEvent.change(await screen.findByLabelText('승인 사유'), { target: { value: '형상 확인' } });
    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/config-sets/CFG-FEAT-00004-02/approve'))).toBe(true));
    expect(document.body.textContent).not.toMatch(/usr-/);
  });

  it('제안자 본인은 승인 버튼 대신 직무 분리 사유, 다른 역할은 권한 사유', async () => {
    handler = handlerWith('usr-quality');
    mount('quality', '/config/compat', <CompatSetsScreen />);
    expect(await screen.findByText('조합을 제안한 사람은 그 조합을 승인할 수 없습니다 — 다른 담당자가 승인합니다.')).toBeTruthy();
    cleanup();
    handler = handlerWith('usr-steward');
    mount('viewer', '/config/compat', <CompatSetsScreen />);
    expect(await screen.findByText('조합 승인은 기능안전 담당자(FSM) 역할이 할 수 있습니다.')).toBeTruthy();
  });
});

describe('보안 최소 버전 표', () => {
  it('지금 하한·이력·표에 없는 SW, 제안자 본인은 승인 대신 사유', async () => {
    handler = handlerWith('usr-steward');
    mount('integrator', '/config/compat?tab=security', <CompatSetsScreen />);
    expect(await screen.findByRole('table', { name: 'SW별 지금 하한' })).toBeTruthy();
    expect(screen.getByText(/표에 없는 SW 1개/).textContent).toContain('SW-RADAR-SVC');
    expect(screen.getByText('보안 최소 버전을 제안한 사람은 그 값을 승인할 수 없습니다 — 다른 사이버보안 담당자가 승인합니다.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/usr-/);
  });

  it('등록 서랍 — 표에 없는 SW가 든 조합은 등록 버튼 대신 사유', async () => {
    handler = (url) => (url.startsWith('/api/security-mins') ? { body: { items: [], current: [{ swId: 'SW-ADAS-FW', version: '11.0.0' }], pending: 0, unregistered: [] } } : handlerWith('usr-steward')(url));
    mount('steward', '/config/compat', <CompatSetsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '승인 조합 등록' }));
    expect(await screen.findByText(/보안 최소 버전 표에 승인된 값이 없는 SW가 있어/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '등록' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('권한 범위', () => {
  it('계정별 시장·Feature·환경, 내부 계정 ID를 보이지 않는다', async () => {
    const items: RoleScope[] = [{ accountId: 'usr-operator', markets: ['KR', 'EU'], featureIds: null, environments: ['demo'], assignedBy: 'usr-integrator', assignedAt: AT, reason: '일본 시장 운영은 현지 조직 담당' }];
    handler = (url) => (url.startsWith('/api/iam/scopes') ? { body: { items, environment: 'demo', commands: ['issueKill', 'deployPolicy'] } } : undefined);
    mount('viewer', '/admin/iam', <RoleScopePanel />);
    expect(await screen.findByRole('table', { name: '권한 범위' })).toBeTruthy();
    expect(screen.getByText('KR, EU')).toBeTruthy();
    expect(screen.getByText('전체')).toBeTruthy();
    expect(document.body.textContent).toContain('긴급 차단 요청, 정책 배포');
    expect(document.body.textContent).not.toMatch(/usr-/);
  });
});
