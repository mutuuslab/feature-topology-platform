// 차량 발신 요청 패널 — 조회·보고·거부 사유를 구분해 보여 주는지 (모의 API). 끝단 흐름은 e2e(vehicle-requests.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { VehicleRequestPanel } from '../screens/ops/VehicleRequests';

let body: unknown;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/requests') ? body : { items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppProvider>
          <VehicleRequestPanel vin="ego-01" />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rec = (o: Record<string, unknown>) => ({ vin: 'ego-01', at: '2026-10-12T01:00:00.000Z', bootId: 'BOOT-7', sequence: 1, reason: null, flags: [], ...o });

describe('차량 발신 요청 패널', () => {
  it('조회·보고·거부를 구분하고, 거부 사유를 업무 문구로 보여 준다', async () => {
    body = {
      cursor: { bootId: 'BOOT-7', sequence: 3 },
      limit: { requests: 30, windowMs: 10_000 },
      items: [
        rec({ requestId: 'VREQ-00003', channel: 'REPORT', type: 'OVERRIDE', outcome: 'REJECTED', reason: 'VEHICLE_OVERRIDE_FORBIDDEN', summary: 'Flag 직접 변경 care_00022_param=false', sequence: 3 }),
        rec({ requestId: 'VREQ-00002', channel: 'REPORT', type: 'CONTEXT', outcome: 'ACCEPTED', summary: '관측값 quality=STALE', sequence: 2, flags: [{ key: 'care_00022_param', value: false, reason: 'ERROR' }] }),
        rec({ requestId: 'VREQ-00001', channel: 'QUERY', type: 'QUERY', outcome: 'ACCEPTED', summary: '조회 (전체)', bootId: null, sequence: null, flags: [{ key: 'care_00022_param', value: true, reason: 'TARGETING_MATCH' }] }),
      ],
    };
    mount();
    const table = await screen.findByRole('table', { name: '차량 발신 요청' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(table).getByText('Flag 직접 변경 금지')).toBeTruthy();
    expect(within(table).getByText('care_00022_param=OFF')).toBeTruthy();
    expect(within(table).getByText('care_00022_param=ON')).toBeTruthy();
    expect(screen.getAllByText('BOOT-7 · #3')).toHaveLength(2); // 보고 위치 + 마지막 보고 행
    expect(screen.getByText(/빈도 한도 30회 \/ 10초/)).toBeTruthy();
  });

  it('요청이 없으면 빈 상태 문구', async () => {
    body = { cursor: null, limit: { requests: 30, windowMs: 10_000 }, items: [] };
    mount();
    expect(await screen.findByText('아직 이 차량이 보낸 요청이 없습니다')).toBeTruthy();
  });
});
