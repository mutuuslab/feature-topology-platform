// readiness: RD-FN-02 — 정책 상세의 배포 이력·되돌리기. 모의 API로 이력 표·되돌릴 수 있는지(서버 사유)·요청 본문(기준 배포 묶음)·412 안내를 본다.
// 실제 백엔드와의 끝단 흐름(요청 → 승인 → 실행 → 지금 배포 바뀜)은 e2e(policy.spec.ts)가 맡는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { PolicyHistory } from '../screens/policy/PolicyHistory';

type Reply = { status?: number; body: unknown };
let handler: (url: string, init?: RequestInit) => Reply;
const calls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
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
      <MemoryRouter>
        <AppProvider>
          <PolicyHistory policyId="POL-00005" />
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const versionRow = async (text: string) => within(await screen.findByRole('table', { name: '되돌릴 수 있는 버전' })).getByText(text).closest('tr')!;
const ref = (policyId: string, revision = 1) => ({ policyId, revision, contentHash: `sha256:${policyId}`, featureId: 'FEAT-00022', featureVersion: '1.0.0' });
const HISTORY = {
  policyId: 'POL-00005',
  flagKey: 'care_00022_param',
  deploymentId: 'PUB-00012',
  current: ref('POL-00005'),
  deployments: [
    { publicationId: 'PUB-00012', policyId: 'POL-00005', revision: 1, status: 'CONFIRMED', confirmed: 6, denominator: 6, createdAt: '2026-10-12T02:00:00.000Z', createdBy: 'han.release', current: true, rollbackExecutionId: null },
    { publicationId: 'PUB-00010', policyId: 'POL-00004', revision: 1, status: 'CONFIRMED', confirmed: 6, denominator: 6, createdAt: '2026-10-12T01:00:00.000Z', createdBy: 'han.release', current: false, rollbackExecutionId: null },
  ],
  versions: [
    { ...ref('POL-00005'), status: 'DEPLOYED', description: '감속 r2', approvedBy: 'lee.approver', deployedAt: '2026-10-12T02:00:00.000Z', current: true, rollback: null },
    { ...ref('POL-00004'), status: 'RETIRED', description: '감속 r1', approvedBy: 'lee.approver', deployedAt: '2026-10-12T01:00:00.000Z', current: false, rollback: { eligible: true, blockers: [] } },
    { ...ref('POL-00002'), status: 'RETIRED', description: '시드', approvedBy: 'usr-approver', deployedAt: '2026-10-01T00:00:00.000Z', current: false, rollback: { eligible: false, blockers: [{ code: 'GATE_NOT_PASSED', message: '이 정책 내용으로 통과(GO)한 검증 기록이 없습니다' }] } },
  ],
  requests: [],
  executions: [],
};

describe('정책 배포 이력·되돌리기 (RD-FN-02)', () => {
  it('배포한 버전(지금 표시)과 되돌릴 수 있는 버전·막는 사유를 보여 준다', async () => {
    handler = () => ({ body: HISTORY });
    mount();
    expect(await screen.findByTestId('policy-current-deployment')).toHaveProperty('textContent', '지금 배포: POL-00005 r1 · 배포 ID PUB-00012');
    const deps = screen.getByRole('table', { name: '배포한 버전' });
    expect(within(deps).getByText('PUB-00012 · 지금')).toBeTruthy();
    expect(within(deps).getByText('PUB-00010')).toBeTruthy();
    const vers = screen.getByRole('table', { name: '되돌릴 수 있는 버전' });
    const seed = within(vers).getByText('POL-00002 r1').closest('tr')!;
    expect(within(seed).getByText(/통과\(GO\)한 검증 기록이 없습니다/)).toBeTruthy();
    expect(within(seed).queryByRole('button', { name: '이 버전으로 되돌리기' })).toBeNull();
  });

  it('되돌리기 요청은 화면이 본 지금 배포(expectedDeploymentId)·사유·승인대상자를 보낸다', async () => {
    handler = (url, init) => (init?.method === 'POST' ? { status: 201, body: { requestId: 'RBR-00001', status: 'REQUESTED' } } : { body: HISTORY });
    mount();
    const row = await versionRow('POL-00004 r1');
    fireEvent.click(within(row).getByRole('button', { name: '이 버전으로 되돌리기' }));
    const dlg = await screen.findByRole('dialog', { name: 'POL-00004 r1로 되돌리기' });
    const submit = within(dlg).getByRole('button', { name: '되돌리기 요청' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // 사유 전
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: '감속 과다 — 이전 값' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '되돌리기 요청' })); // 활성화되면 이유 문구 감싸개가 빠져 새 요소가 된다
    await waitFor(() => expect(calls.some((c) => c.url === '/api/policies/POL-00005/rollback' && c.init?.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.url.endsWith('/rollback'))!;
    const body = JSON.parse(String(post.init!.body));
    expect(body).toMatchObject({ recovery: { policyId: 'POL-00004' }, expectedDeploymentId: 'PUB-00012', reason: '감속 과다 — 이전 값' });
    expect(body.approvers).toHaveLength(1);
    expect(body.approvers[0]).not.toBe('usr-ops'); // 요청자 본인은 고를 수 없다
    expect(new Headers(post.init!.headers).get('Idempotency-Key')).toBeTruthy(); // 재전송 안전
    expect(await within(dlg).findByText(/RBR-00001을\(를\) 만들었습니다/)).toBeTruthy();
  });

  it('그사이 배포가 바뀌면(412) 낡은 화면이라고 알리고 같은 요청을 다시 보내지 못하게 한다', async () => {
    handler = (url, init) =>
      init?.method === 'POST' ? { status: 412, body: { error: { code: 'PRECONDITION_FAILED', message: '화면을 연 뒤 배포가 바뀌었습니다(지금 PUB-00013)', details: { deploymentId: 'PUB-00013' } } } } : { body: HISTORY };
    mount();
    fireEvent.click(within(await versionRow('POL-00004 r1')).getByRole('button', { name: '이 버전으로 되돌리기' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByRole('textbox'), { target: { value: '되돌림' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '되돌리기 요청' }));
    expect(await within(dlg).findByText(/이력을 새로 읽었습니다 — 다시 고르세요/)).toBeTruthy();
    expect((within(dlg).getByRole('button', { name: '되돌리기 요청' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('진행 중인 되돌리기가 있으면 새 요청 버튼을 막고 그 요청(승인·실행)을 보여 준다', async () => {
    const req = { requestId: 'RBR-00001', deploymentId: 'PUB-00012', featureId: 'FEAT-00022', flagKey: 'care_00022_param', deployed: ref('POL-00005'), targetTypes: ['POLICY_VERSION'], recovery: ref('POL-00004'), scope: { featureIds: ['FEAT-00022'], variantRules: [], productionRegions: [], marketRegions: [], swVersions: [], vins: [] }, reason: '감속 과다', approvers: ['usr-opslead'], requestedBy: 'usr-ops', requestedAt: '2026-10-12T03:00:00.000Z', status: 'REQUESTED', decision: null, executionId: null };
    handler = () => ({ body: { ...HISTORY, requests: [req] } });
    mount();
    expect(await screen.findByTestId('rollback-pending')).toBeTruthy();
    const row = await versionRow('POL-00004 r1');
    expect((within(row).getByRole('button', { name: '이 버전으로 되돌리기' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('지금 배포가 없으면 되돌릴 배포가 없다고 알린다', async () => {
    handler = () => ({ body: { ...HISTORY, deploymentId: null, current: null, deployments: [], versions: [] } });
    mount();
    expect(await screen.findByText(/지금 배포된 정책이 없습니다/)).toBeTruthy();
  });
});
