// 정적 데모(STATIC_MODE, 스냅샷만) — 읽기와 쓰기 권한을 나눈다(공개 데모 빈 화면 제거, 2026-11-05).
// usePermission은 정적에서 늘 막혀 있어(쓰기 차단) 그 값을 읽기 표시 조건으로 쓰던 화면이 '보안 담당자만…'·'금액 보기는…' 안내로 비었다.
// 읽기는 useReadPermission(정적이면 역할과 상관없이 보임), 쓰기 버튼은 그대로 막힌다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PERSONAL_DATA_INVENTORY, PERSONAL_RETENTION } from '@ff/contracts';
import { AppProvider } from '../store';
import { costBasis as B, costCalib as C } from '../copy/cost';
import { privacy as PV } from '../copy/privacy';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), STATIC_MODE: true }));

const { DataGovernanceScreen } = await import('../screens/admin/DataGovernance');
const { CostBasisScreen } = await import('../screens/cost/CostBasis');
const { default: ReadOnlyOperationOverview } = await import('../screens/home/dashboard/ReadOnlyOperationOverview');

let files: Record<string, unknown>;
let urls: string[];

beforeEach(() => {
  localStorage.clear();
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      // 시험 대역 — 조회 경로별 응답(client의 스냅샷 경로 변환은 모듈 안쪽이라 여기서는 API 경로로 온다)
      const body = files[url.split('?')[0]] ?? { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
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

describe('정적 데모 — 읽기 화면은 역할과 상관없이 보인다', () => {
  it('개인정보 요청 목록 — 작성자 역할로도 스냅샷 목록을 읽고, 실행 버튼은 막힌다', async () => {
    const REQ = { requestId: 'PRV-00001', subjectKind: 'USER', subjectId: 'usr-leaver', pseudonym: 'psn-0123456789abcdef', basis: 'EMPLOYMENT_END', reason: '퇴직', status: 'REQUESTED', requestedBy: 'usr-csm', requestedAt: '2026-10-25T00:00:00.000Z', decidedBy: null, decidedAt: null, decisionReason: null, preview: { dashboard: 1 }, result: null };
    files = {
      '/api/privacy/inventory': { stores: PERSONAL_DATA_INVENTORY, retention: PERSONAL_RETENTION.map((p) => ({ ...p, days: p.defaultDays })), lake: { configured: false } },
      '/api/privacy/requests': { items: [REQ] },
    };
    mount('author', '/admin/data', <DataGovernanceScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: '개인정보' }));
    expect(await screen.findByRole('table', { name: PV.requests })).toBeTruthy();
    expect(screen.getByText('PRV-00001')).toBeTruthy();
    expect(screen.queryByText(PV.noAccess)).toBeNull();
    expect(urls.some((u) => u.startsWith('/api/privacy/requests'))).toBe(true);
    for (const b of screen.queryAllByRole('button', { name: PV.execute })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('계수·단가 표 — 금액 역할이 아니어도 표 내용과 교정 제안을 읽고, 초안·발행은 막힌다', async () => {
    const list = { items: [{ version: 'v1.3', status: 'PUBLISHED', note: '엑셀 산정 도구 v1.3에서 옮김', createdBy: 'seed', createdAt: '2026-11-04T00:00:00Z', publishedBy: 'seed', publishedAt: '2026-11-04T00:00:00Z' }], latest: 'v1.3' };
    const basis = { version: 'v1.3', status: 'PUBLISHED', note: '', basis: { version: 'v1.3', vat: 0.1, benchmark: { fx: 1545.16, anchorEur: 10000 }, commonPct: { pm: 0.032, scm: 0.015, pi: 0.02 }, checklist: [], rates: { daysPerMonth: 20.5, kosa: { 'IT PM': { daily: 492_036, monthly: 10_086_804 } }, roles: [{ role: 'PM', kosaJob: 'IT PM', engineeringGrade: '기술사', inhouseMonthly: null }] } } };
    const calibration = { basisVersion: 'v1.3', anchorEur: 10000, suggestion: 12345.678, ratio: 0.2345678, samples: [{ kind: 'single', id: 'BC-BCM-002', nameKo: '실내등', eur: 10000, ptsAsil: 1, eurPerPt: 10000 }], mre: { projects: 0, approvedProjects: 0, n: 0, missing: 0, avg: null, byComponent: [], rows: [] } };
    files = { '/api/cost/basis': list, '/api/cost/basis/v1.3': basis, '/api/cost/calibration': calibration };
    mount('author', '/procurement/sw-cost/basis', <CostBasisScreen />);
    expect(await screen.findByText('10,086,804원')).toBeTruthy();
    expect(screen.queryByText(B.moneyOnly)).toBeNull();
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/cost/calibration'))).toBe(true));
    expect((screen.getByRole('button', { name: B.draft }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: C.draft }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('홈 운영 현황 — 운영 데이터 열람 역할이 아닌 계정(상품 권리)도 차량 회신을 읽는다', async () => {
    files = {};
    mount('commerce', '/', <ReadOnlyOperationOverview role="commerce" />);
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/telemetry/readbacks'))).toBe(true));
  });
});
