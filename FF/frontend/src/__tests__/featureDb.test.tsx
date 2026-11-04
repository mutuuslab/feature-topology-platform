// Feature DB 화면(/master/feature-db, 30-95) — 현황·품질 지표, 검색 조건을 서버로 보내고, 행을 고르면 상세(출처·연결된 Feature). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { FeatureDbScreen } from '../screens/refdb/FeatureDb';

let calls: string[];
const ROW = { refId: 'CH-BRK-009', status: 'ACTIVE', replacedBy: null, domain: 'Chassis & Vehicle Dynamics', cluster: 'Brake control', component: 'Brake control (ESC/ABS)', swStack: 'Application', nameEn: 'Auto hold', nameKo: '오토 홀드', aliases: ['AVH'], lifecycle: 'Commodity', asilRep: 'B', tshirt: 'S', summary: null };

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const body = url.startsWith('/api/refdb/overview')
      ? { release: 'v1.3', quality: { total: 1052, byStatus: { ACTIVE: 995, REVIEW: 53, DEPRECATED: 4, RETIRED: 0, PENDING: 0 }, noSource: 0, staleEvidence: 0, gradeDShare: 0.8355 }, domains: ['Chassis & Vehicle Dynamics', 'Safety'], pendingRequests: 1 }
      : url.startsWith('/api/refdb/refs/CH-BRK-009')
        ? { ref: { ...ROW, definition: { summary: '정차 중 제동압 유지', scopeIn: ['상태 관리'], scopeOut: ['EPB 제어'] }, sourceDetail: 'VSS Chassis.ParkingBrake' }, sources: [{ sourceId: 'S10', title: 'COVESA VSS', publisher: 'COVESA', edition: 'v6.1' }], subfunctions: [{ candidateId: 'ASF-1', nameKo: '정차 판정' }], usedBy: [{ featureId: 'FEAT-00012', version: '0.1.0', role: 'PRIMARY' }] }
        : url.startsWith('/api/refdb/refs')
          ? { items: [ROW], total: 1, offset: 0, limit: 200 }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = () => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/master/feature-db']}>
        <AppProvider>
          <Routes>
            <Route path="/master/feature-db" element={<FeatureDbScreen />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Feature DB 화면', () => {
  it('제목·전체 행 수·발행 버전·품질 지표를 보인다', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Feature DB' })).toBeTruthy();
    expect(await screen.findByText('1,052')).toBeTruthy();
    expect(screen.getByText('발행 v1.3')).toBeTruthy();
    expect(screen.getByText('84%')).toBeTruthy();
  });

  it('검색어·도메인을 서버 조회 조건으로 보낸다', async () => {
    mount();
    await screen.findByText('오토 홀드');
    fireEvent.change(screen.getByLabelText(/^검색/), { target: { value: 'AVH' } });
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/refdb/refs?') && u.includes('q=AVH'))).toBe(true));
    fireEvent.change(await screen.findByLabelText('도메인'), { target: { value: 'Safety' } });
    await waitFor(() => expect(calls.some((u) => u.includes('domain=Safety'))).toBe(true));
  });

  it('행을 고르면 정의·출처·연결된 Feature를 보인다', async () => {
    mount();
    fireEvent.click(await screen.findByText('오토 홀드'));
    expect(await screen.findByText('정차 중 제동압 유지')).toBeTruthy();
    expect(screen.getByText(/COVESA VSS/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'FEAT-00012 0.1.0' })).toBeTruthy();
  });
});
