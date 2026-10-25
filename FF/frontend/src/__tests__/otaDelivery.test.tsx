// readiness: RD-UX-04 — OTA 서버 연동(IF-05)이 live면 게시본 연계 호출의 '모의' 표시가 사라지고, 모의면 남는다.
// readiness: RD-OPS-04 — OTA 전달 실패는 '전달 실패(재시도 가능)'로 보이고 같은 작업 ID로 다시 제출한다(게시본은 그대로).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { DeploymentDetail } from '../screens/ops/Deployments';
import { connections as CN } from '../copy/connections';
import { ota as O } from '../copy/ota';

const calls: { url: string; init?: RequestInit }[] = [];
let otaMode: 'live' | 'mock' = 'live';
let delivery: Record<string, unknown> | null = null;

const PUB = {
  publicationId: 'PUB-00007',
  kind: 'POLICY',
  status: 'DISPATCHED',
  channel: 'OTA',
  campaignId: 'OTJ-PUB-00007',
  createdBy: 'u',
  createdAt: '2026-10-24T01:00:00.000Z',
  deadlineAt: '2026-10-24T02:00:00.000Z',
  closedAt: null,
  confirmed: 0,
  denominator: 2,
  ackOnly: [],
  nodes: [],
  payload: { publicationId: 'PUB-00007', sequence: 3, featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_ota', targets: ['ego-01', 'lead-01'], desired: 'sha256:x', policy: { policyId: 'POL-00009', revision: 1 }, kill: null },
  signature: { keyId: 'KEY-0001', alg: 'Ed25519', payloadHash: 'sha256:abc', signature: 'zz' },
};
const FAILED = { jobId: 'OTJ-PUB-00007', state: 'RETRY_WAIT', serverState: null, otaJobId: null, attempts: 2, nextAttemptAt: '2026-10-24T01:00:30.000Z', lastError: { code: 'UNAVAILABLE', status: 503, retryable: true, message: 'OTA 서버 POST /ota/v1/jobs → HTTP 503 UNAVAILABLE' }, targets: 2, counts: {}, vehicles: [] };

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url.startsWith('/api/system/connections')
        ? { mode: 'production', items: [{ key: 'ota', mode: otaMode, ifId: 'IF-05', liveAdapter: true }] }
        : url.startsWith('/api/ota/jobs/') && init?.method === 'POST'
          ? { ...FAILED, state: 'SUBMITTED', otaJobId: 'ota-1', attempts: 1, lastError: null, nextAttemptAt: null }
          : url.startsWith('/api/publications/PUB-00007')
            ? { publication: PUB, verification: { valid: true, reason: 'SIGNATURE_VALID' }, readbacks: [], calls: [{ ifId: 'IF-13', at: 'x', request: {}, response: {} }], delivery }
            : { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(role = 'operator') {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/deployments/PUB-00007']}>
        <AppProvider>
          <Routes>
            <Route path="/deployments/:id" element={<DeploymentDetail />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('게시본 상세 — OTA 서버 전달(IF-05)', () => {
  it('OTA 연결이 live면 연계 호출 패널에 모의·연결 안 됨 표시가 없다', async () => {
    otaMode = 'live';
    delivery = null;
    mount();
    expect(await screen.findByText('SIGNATURE_VALID')).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/system/connections'))).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector('section[aria-labelledby="calls-h"] [data-connection]')).toBeNull();
    expect(screen.queryByText(CN.label.disconnected)).toBeNull();
  });

  it('모의면(운영 설치) 연계 호출 패널에 "연결 안 됨" 표시가 남는다', async () => {
    otaMode = 'mock';
    delivery = null;
    mount();
    await waitFor(() => expect(document.querySelector('section[aria-labelledby="calls-h"] [data-connection="disconnected"]')).toBeTruthy());
  });

  it('전달 실패(재시도 가능) — 상태·마지막 오류·게시본은 남아 있다는 안내, 다시 제출은 같은 작업 ID로', async () => {
    otaMode = 'live';
    delivery = FAILED;
    mount();
    const panel = (await screen.findByText(O.title)).closest('section') as HTMLElement;
    expect(within(panel).getByText(O.state.RETRY_WAIT)).toBeTruthy();
    expect(within(panel).getByText(O.kept)).toBeTruthy();
    expect(within(panel).getByText(/UNAVAILABLE · HTTP 503/)).toBeTruthy();
    expect(within(panel).getByText(O.noVehicles)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: O.retry }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: 'OTA 서버 복구 확인' } });
    fireEvent.click(within(dlg).getByRole('button', { name: O.retry }));
    await waitFor(() => expect(calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/api/ota/jobs/OTJ-PUB-00007/retry'))).toBeTruthy());
    const sent = calls.find((c) => c.url.endsWith('/retry'))!;
    expect(JSON.parse(String(sent.init!.body))).toEqual({ reason: 'OTA 서버 복구 확인' });
  });

  it('접수 뒤에는 다시 제출 단추가 없고 차량별 결과를 보인다', async () => {
    otaMode = 'live';
    delivery = { ...FAILED, state: 'COMPLETED', otaJobId: 'ota-1', attempts: 1, lastError: null, nextAttemptAt: null, counts: { DELIVERED: 1, NO_RESPONSE: 1 }, vehicles: [{ vin: 'ego-01', outcome: 'DELIVERED', detail: '시도 1', at: '2026-10-24T01:00:05.000Z' }, { vin: 'lead-01', outcome: 'NO_RESPONSE', detail: 'NOT_CONNECTED', at: '2026-10-24T02:00:00.000Z' }] };
    mount();
    const panel = (await screen.findByText(O.title)).closest('section') as HTMLElement;
    expect(within(panel).getByText(O.state.COMPLETED)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: O.retry })).toBeNull();
    expect(within(panel).getByText(O.outcome.NO_RESPONSE)).toBeTruthy();
    expect(within(panel).getByText('NOT_CONNECTED')).toBeTruthy();
    expect(within(panel).getByText(O.outcome.DELIVERED)).toBeTruthy();
  });
});
