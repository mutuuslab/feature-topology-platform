// 컴플라이언스 룰 레지스트리 화면(/verify/compliance?tab=registry, FR-CRC-001·002) — 목록·필터, 상세(버전·변경 이력·승인 요청·후보 Feature),
// 승인 대상자 결정, 등록 폼 입력 검사(URL·종료일), 배포 검증 결과(미충족 룰·항목)와 적용 룰. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ComplianceRule } from '@ff/contracts';
import { AppProvider } from '../store';
import { ComplianceRegistryTab } from '../screens/master/ComplianceRules';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any; role: string | null; id: string | null }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, role: h.get('X-Actor-Role'), id: h.get('X-Actor-Id') });
      const r = handler(url, init) ?? { body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, path = '/verify/compliance?tab=registry') => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path="/verify/compliance" element={<ComplianceRegistryTab />} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const rule = (o: Partial<ComplianceRule>): ComplianceRule => ({
  ruleId: 'CR-SAF-001',
  name: 'ASIL 기능 Safe Default 꺼짐',
  type: 'SAFETY',
  scope: { markets: ['KR', 'EU'], featureIds: [], rolloutModes: [], asil: ['B', 'C'], cal: [] },
  criteria: [{ check: 'SAFE_DEFAULT_OFF' }],
  approverIds: ['usr-steward'],
  evidence: { url: 'https://www.iso.org/standard/68385.html', docName: 'ISO 26262-3:2018', clause: '§7.4.2.3', memo: null },
  validFrom: '2026-01-01',
  validTo: null,
  version: '1.1',
  status: 'APPROVED',
  ownerId: 'usr-quality',
  createdBy: 'usr-quality',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'usr-quality',
  updatedAt: '2026-11-01T00:00:00.000Z',
  decidedBy: 'usr-steward',
  decidedAt: '2026-11-01T01:00:00.000Z',
  retiredAt: null,
  ...o,
});
const RULES = [
  rule({}),
  rule({ ruleId: 'CR-SEC-004', name: 'CAL3 이상 Feature 코호트 단계 배포', type: 'SECURITY', status: 'PROPOSED', version: '1.0', ownerId: 'usr-integrator', createdBy: 'usr-integrator', updatedBy: 'usr-integrator', criteria: [{ check: 'STAGED_ROLLOUT' }, { check: 'GATE_PASS', gate: 'G7' }], decidedBy: null, decidedAt: null }),
  rule({ ruleId: 'CR-PRV-006', name: 'EU 데이터 접근 임시 점검', type: 'PRIVACY', status: 'RETIRED', version: '1.0', validTo: '2026-06-30', scope: { markets: ['EU'], featureIds: [], rolloutModes: [], asil: [], cal: [] } }),
];
const DETAIL = {
  rule: RULES[1],
  versions: [{ ruleId: 'CR-SEC-004', version: '1.0', status: 'PROPOSED', content: RULES[1], createdBy: 'usr-integrator', createdAt: '2026-11-01T00:00:00.000Z', decidedBy: null, decidedAt: null, decisionReason: null }],
  changes: [
    { id: 1, ruleId: 'CR-SEC-004', version: '1.0', action: 'CREATE', field: 'status', before: null, after: 'PROPOSED', by: 'usr-integrator', at: '2026-11-01T00:00:00.000Z', reason: null },
    { id: 2, ruleId: 'CR-SEC-004', version: '1.0', action: 'REQUEST', field: 'approvalRequest', before: null, after: { requestId: 'CRQ-00001' }, by: 'usr-integrator', at: '2026-11-01T00:01:00.000Z', reason: '검토 요청' },
  ],
  requests: [{ requestId: 'CRQ-00001', ruleId: 'CR-SEC-004', version: '1.0', requestedBy: 'usr-integrator', approverIds: ['usr-steward'], requestedAt: '2026-11-01T00:01:00.000Z', note: '검토 요청', status: 'OPEN', decidedBy: null, decidedAt: null, reason: null }],
};
const CHECKS = {
  items: [
    { stage: 'DEPLOY', checkId: 'CHK-1', policyId: 'POL-00007', policyRevision: 1, featureId: 'FEAT-00022', featureVersion: '1.0.0', market: 'KR', at: '2026-11-02T00:00:00.000Z', by: 'usr-coordinator', result: 'FAIL', decision: 'BLOCKED', unmet: [{ ruleId: 'CR-PRV-003', item: 'NO_VEHICLE_ID_TARGETING', message: '룰 CR-PRV-003 v1.0 — 차량 식별자로 대상을 지정했습니다' }], rules: [] },
    { stage: 'VALIDATE', checkId: 'VAL-000003', policyId: 'POL-00005', policyRevision: 2, featureId: 'FEAT-00010', featureVersion: '2.0.0', market: 'EU', at: '2026-11-01T00:00:00.000Z', by: 'usr-author', result: 'PASS', decision: 'GO', unmet: [], rules: [] },
  ],
};
const APPLICABLE = { policyId: 'POL-00007', featureId: 'FEAT-00022', featureVersion: '1.0.0', market: 'KR', rolloutMode: 'COHORT', asil: 'B', cal: 'CAL2', at: '2026-11-07T00:00:00.000Z', rules: [{ ruleId: 'CR-SAF-001', version: '1.1', name: 'ASIL 기능 Safe Default 꺼짐', type: 'SAFETY', status: 'APPROVED', approved: true, effective: true, applied: true, reason: '승인 · 유효 기간 안 — 적용' }] };
const CANDIDATES = { items: [{ featureId: 'FEAT-00010', version: '2.0.0', name: '운전자 상태 감지', country: 'EU', asil: 'C', lifecycle: 'DEVELOPING', ownerId: 'Cabin안전기획팀' }], total: 1 };

const api: Handler = (url, init) => {
  if (url.startsWith('/api/compliance-rules/feature-candidates')) return { body: CANDIDATES };
  if (url.startsWith('/api/compliance-rules/applicable')) return { body: APPLICABLE };
  if (url.startsWith('/api/compliance-rules/CR-SEC-004/decision')) return { status: 201, body: { ...RULES[1], status: 'APPROVED' } };
  if (url.startsWith('/api/compliance-rules/CR-SEC-004')) return { body: DETAIL };
  if (url === '/api/compliance-rules' && init?.method === 'POST') return { status: 201, body: rule({ ruleId: 'CR-LEG-010', status: 'PROPOSED', version: '1.0' }) };
  if (url.startsWith('/api/compliance-rules')) return { body: { items: RULES } };
  if (url.startsWith('/api/compliance-validations')) return { body: CHECKS };
  return undefined;
};

describe('컴플라이언스 룰 레지스트리 화면', () => {
  it('목록 — 상태 요약과 상태 필터, 룰 유형·검증 기준·유효 기간을 보인다', async () => {
    handler = api;
    mount('viewer');
    const table = await screen.findByRole('table', { name: '컴플라이언스 룰' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('CR-SEC-004')).toBeTruthy();
    expect(within(table).getAllByText(/Safe Default 꺼짐/).length).toBeGreaterThan(0);
    expect(within(table).getByText(/G7 Gate 통과/)).toBeTruthy();
    expect(within(table).getByText('2026-01-01 ~ 2026-06-30')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /승인 대기/ }));
    expect(within(screen.getByRole('table', { name: '컴플라이언스 룰' })).getAllByRole('row')).toHaveLength(2);
    // 조회 전용 역할은 등록 버튼이 막힌다
    expect((screen.getByRole('button', { name: '룰 등록' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('상세 — 버전·변경 이력·승인 요청·적용 대상 Feature 후보, 지정 승인 대상자가 사유와 함께 승인한다', async () => {
    handler = api;
    mount('steward', '/verify/compliance?tab=registry&rule=CR-SEC-004');
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText('CRQ-00001');
    expect(within(dlg).getByText('ISO 26262-3:2018')).toBeTruthy();
    expect(within(dlg).getByRole('link', { name: '근거 문서 열기' }).getAttribute('href')).toBe('https://www.iso.org/standard/68385.html');
    expect(within(dlg).getAllByText('승인 요청').length).toBeGreaterThan(0);
    expect(await within(dlg).findByText('FEAT-00010')).toBeTruthy();
    expect(calls.some((c) => c.url.startsWith('/api/compliance-rules/feature-candidates?markets=KR%2CEU&asil=B%2CC'))).toBe(true);
    fireEvent.change(within(dlg).getByLabelText('결정 사유'), { target: { value: '단계 배포 기준 확인' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '승인' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/decision'))).toBeTruthy());
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/decision'))!;
    expect(post).toMatchObject({ body: { decision: 'APPROVE', reason: '단계 배포 기준 확인' }, role: 'REGULATORY_OWNER', id: 'usr-steward' });
  });

  it('승인 대상자가 아니면 결정 버튼이 막힌다(사유 표시)', async () => {
    handler = api;
    mount('quality', '/verify/compliance?tab=registry&rule=CR-SEC-004');
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText('CRQ-00001');
    expect((within(dlg).getByRole('button', { name: '승인' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dlg).getByText('이 룰의 승인 대상자만 결정할 수 있습니다')).toBeTruthy();
  });

  it('등록 — 근거 URL 형식·종료일을 화면에서 먼저 막고, 맞으면 계약 본문으로 보낸다', async () => {
    handler = api;
    mount('steward');
    await screen.findByRole('table', { name: '컴플라이언스 룰' });
    fireEvent.click(screen.getByRole('button', { name: '룰 등록' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText(/^룰 ID/), { target: { value: 'CR-LEG-010' } });
    fireEvent.change(within(dlg).getByLabelText('룰 명칭'), { target: { value: '시장 Profile 확인' } });
    fireEvent.change(within(dlg).getByLabelText('룰 유형'), { target: { value: 'LEGAL' } });
    fireEvent.click(within(dlg).getByRole('checkbox', { name: 'KR' }));
    fireEvent.click(within(dlg).getByRole('checkbox', { name: '시장 Profile 확인' }));
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /박유진/ }));
    fireEvent.change(within(dlg).getByLabelText(/^근거 URL/), { target: { value: 'ftp://law.example/a' } });
    fireEvent.change(within(dlg).getByLabelText('근거 문서명'), { target: { value: '자동차관리법' } });
    fireEvent.change(within(dlg).getByLabelText('유효 시작일'), { target: { value: '2026-12-01' } });
    fireEvent.change(within(dlg).getByLabelText(/^유효 종료일/), { target: { value: '2026-11-30' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    expect(await within(dlg).findByText(/http:\/\/ 또는 https:\/\//)).toBeTruthy();
    expect(within(dlg).getByText(/유효 종료일은 유효 시작일보다 빠를 수 없습니다/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(within(dlg).getByLabelText(/^근거 URL/), { target: { value: 'https://www.law.go.kr/법령/자동차관리법' } });
    fireEvent.change(within(dlg).getByLabelText(/^유효 종료일/), { target: { value: '' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      ruleId: 'CR-LEG-010',
      name: '시장 Profile 확인',
      type: 'LEGAL',
      scope: { markets: ['KR'] },
      criteria: [{ check: 'MARKET_PROFILE_CONFIRMED' }],
      approverIds: ['usr-quality'],
      evidence: { url: 'https://www.law.go.kr/법령/자동차관리법', docName: '자동차관리법' },
      validFrom: '2026-12-01',
      validTo: null,
    });
  });

  it('배포 검증 결과 — 미충족 룰·항목, 줄을 고르면 그 정책에 지금 적용할 룰', async () => {
    handler = api;
    mount('viewer');
    const t = await screen.findByRole('table', { name: '배포 검증 결과' });
    expect(within(t).getByText(/CR-PRV-003/)).toBeTruthy();
    expect(within(t).getByText(/차량 식별자로 대상 지정 금지/)).toBeTruthy();
    expect(within(t).getByText('배포 시점')).toBeTruthy();
    expect(await screen.findByText(/POL-00007에 적용할 룰/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/compliance-rules/applicable?policyId=POL-00007')).toBe(true);
  });
});
