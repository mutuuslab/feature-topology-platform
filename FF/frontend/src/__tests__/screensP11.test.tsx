// P11 화면 — API만 있던 기능: Flag 은퇴(FFG-LCY-011), 데이터·규제 기록(SUMS·Data Act·보존), 감독 기록(직무 분리·사후 검토·변경 기록·재-HARA). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import { RetirementsScreen } from '../screens/policy/Retirements';
import { DataGovernanceScreen } from '../screens/admin/DataGovernance';
import { OversightScreen } from '../screens/admin/Oversight';
import { FeatureVersionActions, PolicyEdit, ProductVersionActions } from '../screens/features/VersionEdit';

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

const RET = (o: object = {}) => ({
  retirementId: 'RET-00001', flagKey: 'ivi_00024_guide', featureId: 'FEAT-00024', featureVersion: '1.0.0', fClass: 'F0', reason: '안내 문구 종료',
  nextReleaseAt: null, requestedBy: 'usr-author', requestedAt: '2026-10-16T01:00:00.000Z', status: 'APPROVED',
  approvals: [{ by: 'usr-approver', role: 'FEATURE_APPROVER', at: '2026-10-16T02:00:00.000Z' }], approvedAt: '2026-10-16T02:00:00.000Z',
  steps: { REMAINING_VEHICLES: { at: '2026-10-16T03:00:00.000Z', by: 'usr-author', data: { onOldVersion: ['ego-01'], unreported: [] } } },
  requiredApprovals: ['FEATURE_APPROVER'], codeRemovalDue: '2026-04-01T00:00:00.000Z', overdue: true, next: 'FINAL_STATE', ...o,
});

describe('Flag 은퇴 (FFG-LCY-011)', () => {
  it('진행 표 — 단계 수·다음 단계·기한 초과는 빨간색, 열면 다음 단계(최종 상태) 기록 본문을 그대로 보낸다', async () => {
    handler = (url, init) => {
      if (url.startsWith('/api/flag-retirements/RET-00001/steps') && init?.method === 'POST') return { status: 201, body: RET({ next: 'CODE_REMOVED' }) };
      if (url.startsWith('/api/flag-retirements')) return { body: { items: [RET()] } };
      if (url.startsWith('/api/policies')) return { body: { items: [{ policyId: 'POL-00003', flagKey: 'ivi_00024_guide', featureId: 'FEAT-00024', featureVersion: '1.0.0', status: 'DEPLOYED' }] } };
    };
    mount('author', '/flag-retirements', <RetirementsScreen />);
    const row = (await screen.findByText('RET-00001')).closest('tr')!;
    expect(within(row).getByText('2/6')).toBeTruthy(); // 1 승인 + 2 남은 차량 확인
    expect(screen.getByTestId('due-RET-00001').textContent).toContain('기한 초과');
    fireEvent.click(row);
    const form = await screen.findByTestId('retire-step');
    expect(screen.getByText(/이전 Version 차량 1대/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('최종 SW Version'), { target: { value: '1.3.0' } });
    fireEvent.change(within(form).getByLabelText('Evidence 참조'), { target: { value: 'EVD-RET-1' } });
    fireEvent.click(within(form).getByRole('button', { name: '단계 기록' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ step: 'FINAL_STATE', swVersion: '1.3.0', completionRate: 100, requiredRate: 95, evidenceRef: 'EVD-RET-1' });
  });

  it('승인 대기 — 필요한 승인 역할을 보이고, 작성자는 승인할 수 없다', async () => {
    handler = (url) => (url.startsWith('/api/flag-retirements') ? { body: { items: [RET({ status: 'REQUESTED', approvals: [], approvedAt: null, steps: {}, requiredApprovals: ['FEATURE_APPROVER', 'SAFETY_OFFICER'], next: 'APPROVED', overdue: false, codeRemovalDue: null })] } } : undefined);
    mount('author', '/flag-retirements', <RetirementsScreen />);
    fireEvent.click((await screen.findByText('RET-00001')).closest('tr')!);
    expect(await screen.findByText(/필요한 승인: Feature 승인자/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '승인' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('데이터·규제 기록', () => {
  it('SUMS — 명령별 RXSWIN·형식승인 영향·사용자 고지, 누락은 빨간색', async () => {
    handler = (url) =>
      url.startsWith('/api/sums')
        ? { body: { retention: { yearsAfterProductionEnd: 10, basis: 'UN R156', unknown: [] }, items: [{ commandId: '0c1d2e3f-aaaa-bbbb-cccc-000000000001', featureId: 'FEAT-00022', featureVersion: '1.0.0', request: 'deactivate', market: 'KR', vehicles: 2, rxswin: 'RX-KR-1', typeApproval: { impact: 'NONE', r156AssessmentId: 'R156-1' }, userNotice: { required: true, textRef: 'NTC-00001' }, missing: ['cn_filing_id'], publicationId: 'PUB-00004', recordedAt: '2026-10-16T01:00:00.000Z', result: { status: 'CONFIRMED', confirmed: 2, denominator: 2, at: 'x' } }] } }
        : undefined;
    mount('viewer', '/admin/data', <DataGovernanceScreen />);
    expect(await screen.findByText('RX-KR-1')).toBeTruthy();
    expect(screen.getByText('필요 · NTC-00001')).toBeTruthy();
    expect(screen.getByText('cn_filing_id')).toBeTruthy();
    expect(screen.getByText('CONFIRMED 2/2')).toBeTruthy();
  });

  it('EU Data Act — 거부 사유 코드, 처리 본문(제3자·범위)을 그대로 보낸다', async () => {
    handler = (url, init) => {
      if (url.startsWith('/api/data-access-requests') && init?.method === 'POST') return { status: 201, body: { requestId: 'DAR-00002', status: 'FULFILLED' } };
      if (url.startsWith('/api/data-access-requests'))
        return { body: { requests: [{ requestId: 'DAR-00001', vin: 'KMH-NX4-0001', status: 'REJECTED', at: '2026-10-16T01:00:00.000Z', requester: 'USER', thirdParty: null, scope: ['FEATURE_STATE'], rejections: [{ code: 'NOT_EU_VEHICLE', message: 'EU 차량 아님' }] }], contractBasis: [], vehicles: [{ vin: 'TMA-NX4-0002', directAccess: 'UNKNOWN' }], findings: [] } };
    };
    mount('operator', '/admin/data?tab=data-act', <DataGovernanceScreen />);
    expect(await screen.findByText('거부 · NOT_EU_VEHICLE')).toBeTruthy();
    expect(screen.getByText('확인 필요')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '차량' }), { target: { value: 'TMA-NX4-0002' } });
    fireEvent.change(screen.getByRole('combobox', { name: '요청자' }), { target: { value: 'THIRD_PARTY' } });
    fireEvent.change(screen.getByLabelText('제3자 ID'), { target: { value: 'TP-1' } });
    fireEvent.change(screen.getByLabelText('제3자 이름'), { target: { value: 'Fleet Co' } });
    fireEvent.click(screen.getByRole('button', { name: '처리' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ vin: 'TMA-NX4-0002', requester: 'THIRD_PARTY', thirdParty: { id: 'TP-1', name: 'Fleet Co', gatekeeper: false }, userAuthorizationRef: null, scope: ['FEATURE_STATE'] });
  });

  it('보존 — 가정값 표시, 삭제는 type-to-confirm 뒤에만 보낸다(법규 담당)', async () => {
    handler = (url, init) => {
      if (url.startsWith('/api/retention/sweep')) return { body: { at: 'x', stores: [] } };
      if (url.startsWith('/api/retention')) return { body: { policies: [{ store: 'telemetry', record: '차량 텔레메트리', category: 'OPERATION', period: { kind: 'DAYS', days: 90, assumed: true }, basis: '가정', personal: false, cutoff: 'x', expired: 4, held: 1, deletable: 3 }], deletions: [] } };
      return init ? undefined : undefined;
    };
    mount('steward', '/admin/data?tab=retention', <DataGovernanceScreen />);
    expect(await screen.findByText('90일 · 가정값')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '기간 지난 행 삭제 (3)' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '기간 지난 행 삭제' }));
    await vi.waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/retention/sweep') && c.method === 'POST')).toBe(true));
  });
});

describe('감독 기록', () => {
  it('직무 분리 — 겸직 계정과 겸한 직무', async () => {
    handler = (url) => (url.startsWith('/api/iam/sod-audit') ? { body: { duties: { RELEASE: ['RELEASE_MANAGER'], KILL_EXECUTION: ['OPS_LEAD'] }, accounts: {}, conflicts: [{ account: 'coordinator', duties: ['RELEASE', 'KILL_EXECUTION'], roles: ['RELEASE_MANAGER', 'OPS_LEAD'] }], postReviews: { issued: 1, reviewed: 0, pending: 1, overdue: 0 } } } : undefined);
    mount('viewer', '/audit/oversight', <OversightScreen />);
    expect(await screen.findByText('출시 + Kill 실행')).toBeTruthy();
    expect(screen.getByText('발행 1 · 검토 0 · 대기 1 · 기한 초과 0')).toBeTruthy();
  });

  it('긴급 권한 사후 검토 — 기한 초과는 빨간색 상태, 차단 화면으로 이어진다', async () => {
    handler = (url) => (url.startsWith('/api/kill-post-reviews') ? { body: { items: [{ killId: 'KILL-00001', featureId: 'FEAT-00024', issuedAt: '2026-10-14T01:00:00.000Z', due: '2026-10-15T01:00:00.000Z', requestedBy: 'usr-operator', approvers: ['usr-safety', 'usr-coordinator'], review: null, status: 'OVERDUE' }] } } : undefined);
    mount('viewer', '/audit/oversight?tab=review', <OversightScreen />);
    expect((await screen.findByRole('link', { name: 'KILL-00001' })).getAttribute('href')).toBe('/ops/kill?id=KILL-00001');
    expect(screen.getByText('기한 초과')).toBeTruthy();
  });

  it('변경 기록 — AI 생성 표시와 근거 누락 발견 · 재-HARA 열린 요청', async () => {
    handler = (url) => {
      if (url.startsWith('/api/change-records')) return { body: { summary: { total: 1, aiGenerated: 1, aiComplete: 0, withFindings: 1 }, items: [{ changeId: 'CHG-001', swId: 'SW-CARE', swVersion: '1.2.1', commit: 'abcdef1234', summary: 's', aiGenerated: { tool: 'Claude Code', toolVersion: '2.1', scope: 'tests' }, evidence: { review: 'PR-1', staticAnalysis: null, tests: 'T-1', coverage: null }, rev: 1, at: 'x', findings: ['STATIC_ANALYSIS_MISSING'] }] } };
      if (url.startsWith('/api/rehara-requests')) return { body: { items: [{ requestId: 'RH-00001', featureId: 'FEAT-00022', featureVersion: '1.1.0', condition: 'SCOPE', detail: '적용 국가 추가', status: 'OPEN', createdAt: 'x', resolvedAt: null, resolvedBy: null }] } };
    };
    mount('viewer', '/audit/oversight?tab=changes', <OversightScreen />);
    expect(await screen.findByText('Claude Code 2.1 · tests')).toBeTruthy();
    expect(screen.getByText('STATIC_ANALYSIS_MISSING')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '재-HARA 요청' }));
    expect(await screen.findByText('열림 — G3 이후 PASS 불가')).toBeTruthy();
  });
});

describe('새 Version·초안 수정', () => {
  const F = { featureId: 'FEAT-00022', version: '1.0.0', lifecycle: 'RELEASED', name: '전방 안전거리', description: 'd', ownerId: 'ADAS팀', asil: 'B', tags: ['adas'], requirementIds: ['REQ-1'] };

  it('출시된 최신 Feature Version — 초안 수정은 없고, 새 Version(minor)을 만들면 새 Version 상세로 간다', async () => {
    handler = (url, init) => (url === '/api/features/FEAT-00022/versions' && init?.method === 'POST' ? { status: 201, body: { feature: { version: '1.1.0' }, changed: [], rejudge: [] } } : undefined);
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/features/FEAT-00022/1.0.0']}>
          <AppProvider>
            <Routes>
              <Route path="/features/:id/:ver" element={<FeatureVersionActions f={F} latest />} />
            </Routes>
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: '초안 수정' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '새 Version' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('변경 사유'), { target: { value: '대상 차종 추가 준비' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '새 Version 만들기' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ baseVersion: '1.0.0', bump: 'minor', reason: '대상 차종 추가 준비' });
  });

  it('PROPOSED 초안 — 초안 수정만 있고, 쉼표 목록을 배열로 보낸다', async () => {
    handler = (url, init) => (init?.method === 'PATCH' ? { body: {} } : undefined);
    mount('author', '/x', <FeatureVersionActions f={{ ...F, version: '0.1.0', lifecycle: 'PROPOSED' }} latest />);
    expect(screen.queryByRole('button', { name: '새 Version' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '초안 수정' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('요구사항 ID (쉼표로 구분)'), { target: { value: 'REQ-1, REQ-9' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/features/FEAT-00022/versions/0.1.0');
    expect(patch.body).toMatchObject({ requirementIds: ['REQ-1', 'REQ-9'], tags: ['adas'], asil: 'B' });
  });

  it('상품 초안 수정 — 저장 결과의 구성 검증을 바로 보인다', async () => {
    handler = (url, init) => (init?.method === 'PATCH' ? { body: { product: {}, composition: { result: 'FAIL', issues: [{ code: 'REQUIRES_MISSING', severity: 'FAIL', message: 'FEAT-00145가 구성에 없음', refs: [] }], features: [] } } } : undefined);
    mount('commerce', '/x', <ProductVersionActions p={{ catalogId: 'CAT-00099', version: '0.1.0', lifecycle: 'PROPOSED', name: 'p', description: '', baselineIds: ['BL-00028'], validFrom: null, validTo: null }} latest />);
    fireEvent.click(screen.getByRole('button', { name: '초안 수정' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    expect(await within(dlg).findByText(/FEAT-00145가 구성에 없음/)).toBeTruthy();
  });

  it('정책 수정 — 배포된 정책엔 버튼이 없고, 초안은 코호트 비율과 함께 보낸다', async () => {
    const P = { policyId: 'POL-00009', status: 'DRAFT', description: 'd', enabled: true, safeDefault: false, rollout: { mode: 'ALL' as const, basisPoints: 10000, salt: 'S' } };
    const { unmount } = mount('author', '/x', <PolicyEdit p={{ ...P, status: 'DEPLOYED' }} />);
    expect(screen.queryByRole('button', { name: '정책 수정' })).toBeNull();
    unmount();
    handler = (url, init) => (init?.method === 'PATCH' ? { body: {} } : undefined);
    mount('author', '/x', <PolicyEdit p={P} />);
    fireEvent.click(screen.getByRole('button', { name: '정책 수정' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByRole('combobox', { name: '롤아웃' }), { target: { value: 'COHORT' } });
    fireEvent.change(within(dlg).getByLabelText('코호트 비율 (basis point, 0~10000)'), { target: { value: '500' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body.rollout).toEqual({ mode: 'COHORT', basisPoints: 500, salt: 'S' });
  });
});
