// 롤백 화면(D03-04) — 배포 선택·복구 가능 버전·미리보기·수동 롤백 요청, 지정 승인대상자 승인, 승인된 요청 실행, 이력. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { RollbackScreen } from '../screens/ops/Rollback';

let calls: { url: string; method: string; body: any; headers: Record<string, string> }[];

const REF = (policyId: string, revision = 1, featureVersion = '1.0.0') => ({ policyId, revision, contentHash: `sha256:${policyId}`, featureId: 'FEAT-00022', featureVersion });
const SCOPE = { featureIds: ['FEAT-00022'], variantRules: [], productionRegions: [], marketRegions: [], swVersions: [], vins: [] };
const REQUEST = (status: string) => ({ requestId: 'RBR-00001', deploymentId: 'PUB-00010', featureId: 'FEAT-00022', flagKey: 'care_00022_param', deployed: REF('POL-00005'), targetTypes: ['POLICY_VERSION'], recovery: REF('POL-00004'), scope: SCOPE, reason: '감속 과다', approvers: ['usr-coordinator'], requestedBy: 'usr-operator', requestedAt: '2026-10-17T01:00:00.000Z', status, decision: status === 'REQUESTED' ? null : { decision: 'APPROVE', by: 'usr-coordinator', role: 'OPS_LEAD', at: '2026-10-17T01:05:00.000Z', comment: '확인' }, executionId: null });
let requestStatus = 'REQUESTED';
const DETAIL = () => ({
  deploymentId: 'PUB-00010',
  current: true,
  feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계' },
  deployed: { ...REF('POL-00005'), flagKey: 'care_00022_param', deployedBy: 'han.release', deployedAt: '2026-10-16T00:00:00.000Z' },
  publication: { status: 'CONFIRMED', confirmed: 6, denominator: 6, targets: 6 },
  policyChanges: [{ revision: 1, kind: 'CREATE', changedBy: 'usr-author', changedAt: '2026-10-15T00:00:00.000Z', restoredFrom: null, reason: null, before: null, after: {}, changes: [] }],
  deploymentHistory: [{ publicationId: 'PUB-00010', policyId: 'POL-00005', revision: 1, status: 'CONFIRMED', confirmed: 6, denominator: 6, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'han.release', rollback: null }],
  swHistory: { available: false, note: 'SW 변경 이력의 원천은 OTA(IF-05)' },
  candidates: [
    { ...REF('POL-00004'), status: 'RETIRED', deployedAt: '2026-10-14T00:00:00.000Z', artifactId: 'PUB-00008', eligible: true, blockers: [] },
    { ...REF('POL-00002'), status: 'RETIRED', deployedAt: '2026-10-01T00:00:00.000Z', artifactId: 'PUB-00001', eligible: false, blockers: [{ code: 'GATE_NOT_PASSED', message: '이 정책 내용으로 통과(GO)한 검증 기록이 없습니다' }] },
  ],
  plans: [],
  requests: requestStatus === 'NONE' ? [] : [REQUEST(requestStatus)],
});
const EXEC = { executionId: 'RBX-00001', mode: 'MANUAL', planId: null, requestId: 'RBR-00001', deploymentId: 'PUB-00010', featureId: 'FEAT-00022', flagKey: 'care_00022_param', targetTypes: ['POLICY_VERSION'], trigger: { kind: 'MANUAL', detail: '감속 과다' }, before: REF('POL-00005'), after: REF('POL-00004'), sourceArtifactId: 'PUB-00008', artifactId: 'PUB-00011', vehicleGroups: [{ productionRegion: 'KMH', marketRegion: 'KR', variant: 'F111A114001', vehicleModel: 'NX4 PE', trim: 'Premium', swVersion: '1.2.1', vins: ['KMH-NX4-0001'] }], vins: ['KMH-NX4-0001'], status: 'COMPLETED', result: 'SUCCESS', failureReason: null, failedAt: null, requestedBy: 'usr-operator', approvedBy: 'usr-coordinator', deploymentRequestedBy: 'han.release', startedAt: '2026-10-17T02:00:00.000Z', finishedAt: '2026-10-17T02:01:00.000Z' };

beforeEach(() => {
  localStorage.clear();
  calls = [];
  requestStatus = 'REQUESTED';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
      let body: unknown = { items: [] };
      if (url === '/api/rollbacks/deployments') body = { items: [{ deploymentId: 'PUB-00010', flagKey: 'care_00022_param', controlPoint: 'Parameter', feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계' }, deployed: REF('POL-00005'), deployedAt: '2026-10-16T00:00:00.000Z', publication: { status: 'CONFIRMED', confirmed: 6, denominator: 6 }, candidates: 2, eligible: 1, plans: 0 }] };
      else if (url.startsWith('/api/rollbacks/deployments/')) body = DETAIL();
      else if (url === '/api/rollbacks/preview') body = { applicable: true, blockers: [], impact: { features: [{ featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', role: 'TARGET' }] }, vehicleGroups: EXEC.vehicleGroups, vins: ['KMH-NX4-0001'] };
      else if (url.startsWith('/api/rollbacks/RBX')) body = EXEC;
      else if (url.startsWith('/api/rollbacks')) body = { items: [EXEC] };
      else if (url === '/api/rollback-requests' && method === 'POST') body = { ...REQUEST('REQUESTED'), requestId: 'RBR-00002' };
      else if (url.startsWith('/api/rollback-requests/RBR-00001/execute')) body = { ...EXEC, status: 'RUNNING', result: null };
      else if (url.startsWith('/api/rollback-requests/RBR-00001/decision')) body = REQUEST('APPROVED');
      else if (url.startsWith('/api/rollback-requests/RBR-00001')) body = REQUEST(requestStatus);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path: string) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/ops/rollback" element={<RollbackScreen />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('롤백 화면', () => {
  it('배포를 고르면 복구 가능 버전(불가 사유 포함)이 보이고, 미리보기 후 수동 롤백을 요청한다', async () => {
    requestStatus = 'NONE';
    mount('operator', '/ops/rollback');
    fireEvent.click(await screen.findByText('care_00022_param'));
    const cands = await screen.findByRole('table', { name: '복구 가능 버전' });
    expect(within(cands).getByText('이 정책 내용으로 통과(GO)한 검증 기록이 없습니다')).toBeTruthy();
    expect(screen.getByText(/SW 변경 이력의 원천은 OTA/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: '수동 롤백 요청' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // 사유 전
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }));
    expect(await screen.findByText('적용 가능 — 요청할 수 있습니다')).toBeTruthy();
    expect(screen.getByRole('table', { name: '영향 차량 그룹' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '복구 사유' }), { target: { value: 'P5 감속 과다' } });
    fireEvent.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/rollback-requests')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/rollback-requests')!;
    expect(post.body).toEqual({ deploymentId: 'PUB-00010', targetTypes: ['POLICY_VERSION'], recovery: { policyId: 'POL-00004' }, scope: SCOPE, approvers: ['usr-approver'], reason: 'P5 감속 과다' });
    expect(post.headers['X-Actor-Id']).toBe('usr-operator');
    expect(await screen.findByText(/RBR-00002을\(를\) 만들었습니다/)).toBeTruthy();
  });

  it('알림 링크(?request=)로 열면 그 배포가 열리고, 지정 승인대상자만 승인·반려할 수 있다', async () => {
    mount('coordinator', '/ops/rollback?request=RBR-00001');
    const item = await screen.findByTestId('rollback-pending');
    fireEvent.change(within(item).getByRole('textbox', { name: '승인 의견' }), { target: { value: '현장 보고 확인' } });
    fireEvent.click(within(item).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/rollback-requests/RBR-00001/decision')).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/decision'))!.body).toEqual({ decision: 'APPROVE', comment: '현장 보고 확인' });
    cleanup();
    mount('steward', '/ops/rollback?request=RBR-00001');
    const other = await screen.findByTestId('rollback-pending');
    expect(within(other).queryByRole('button', { name: '승인' })).toBeNull();
    expect(within(other).getByText('지정된 승인대상자만 승인·반려할 수 있습니다.')).toBeTruthy();
  });

  it('승인된 요청은 실행하고, 이력 행을 열면 실행 기록이 보인다', async () => {
    requestStatus = 'APPROVED';
    mount('operator', '/ops/rollback?deployment=PUB-00010');
    const item = await screen.findByTestId('rollback-pending');
    fireEvent.click(within(item).getByRole('button', { name: '실행' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/rollback-requests/RBR-00001/execute')).toBe(true));
    const hist = await screen.findByRole('table', { name: '롤백 이력' });
    fireEvent.click(within(hist).getByText('RBX-00001'));
    const dlg = await screen.findByRole('dialog', { name: '롤백 RBX-00001' });
    expect(await within(dlg).findByText('PUB-00011')).toBeTruthy();
    expect(within(dlg).getByText(/완료 · 성공/)).toBeTruthy();
  });
});
