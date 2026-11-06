// ADS 증거 화면 — ADS 사건 보고(ADS-UI07)·Safety Case 근거 지도(ADS-UI08)·요구 추적(ADS-UI10). ux.json 핵심 메시지·판단 불가·미확인·막힘 사유 단언(모의 API).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type AdsCaseNode, type AdsConfigBinding, type AdsDetermination, type AdsEvidenceManifest, type AdsIncidentReport, type AdsMarketDeadline, type AdsReviewFinding, type AdsTraceDoc } from '@ff/contracts';
import { ADS_REVIEWER_NOT_INDEPENDENT, adsIncidentSummary, adsIncidentView, adsPeriodicReport, safetyCaseView, traceSummary } from '../../../contracts/src/rules/ads-evidence';
import { AppProvider } from '../store';
import { IncidentReportDetail, IncidentReportsScreen } from '../screens/ads/IncidentReports';
import SafetyCaseScreen from '../screens/ads/SafetyCase';
import TraceAdsScreen from '../screens/ads/TraceAds';
import { incidentReports as IR } from '../copy/ads-evidence';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;
let handler: Handler;
let calls: { url: string; method: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (role: string, entry: string, pattern: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <AppProvider>
          <Routes>
            <Route path={pattern} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const keyMessage = (c: HTMLElement) => {
  const k = c.querySelectorAll('[data-key-message]');
  expect(k.length).toBe(1);
  return k[0].textContent ?? '';
};

// ── ADS 사건 보고 ──
const NOW = Date.now();
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const KR: AdsMarketDeadline = { market: 'KR', label: '대한민국', shortTermDays: 30, periodicMonths: 12, status: 'APPROVED', approvedBy: 'usr-steward', approvedAt: ago(90 * DAY), basis: '기한 표' };
const US: AdsMarketDeadline = { market: 'US', label: '미국', shortTermDays: 30, periodicMonths: 12, status: 'DRAFT', approvedBy: null, approvedAt: null, basis: '초안' };
const report = (id: string, o: Partial<AdsIncidentReport>): AdsIncidentReport => ({
  reportId: id, featureId: 'FEAT-00004', featureVersion: '4.1.0', vin: 'KMH-GN7-0001', market: 'KR', summary: '사건', occurredAt: null, awareAt: ago(DAY), firstNoticeAt: null,
  activeWindow: { value: 'IN_WINDOW', basis: '차량 보고' }, configSet: 'CFG-FEAT-00004-01', oddProfileRef: 'ODD-FEAT-00004-v1', dssadCorrelationId: 'DSSAD-1', auditTarget: id, shortTermSubmittedAt: null,
  events: [
    { kind: 'VERDICT', label: '활성화 판정 허용', vehicleAt: ago(DAY + 5000), vehicleSeq: 1, serverAt: ago(DAY - 9000), ingestSeq: 2, owner: '차량', ref: null },
    { kind: 'INCIDENT', label: 'ADS 사건 기록', vehicleAt: ago(DAY), vehicleSeq: 2, serverAt: ago(DAY - 1000), ingestSeq: 1, owner: '운전자', ref: null },
  ],
  ...o,
});
const det = (reportId: string): AdsDetermination => ({ reportId, version: 1, decision: 'REPORTABLE', reason: '확정', decidedBy: 'usr-steward', decidedRole: 'REGULATORY_OWNER', decidedAt: ago(DAY) });
const REPORTS = [
  report('ADSI-2026-0001', { awareAt: ago(25 * DAY + 3 * 3600_000), firstNoticeAt: ago(25 * DAY) }),
  report('ADSI-2026-0002', { awareAt: ago(27 * DAY) }),
  report('ADSI-2026-0003', { awareAt: ago(6 * 3600_000 + 60_000), market: 'KR' }),
  report('ADSI-2026-0005', { market: 'US', activeWindow: { value: 'UNDECIDABLE', basis: '근거 부족 — 보고 범위 밖' } }),
];
const DETS = [det('ADSI-2026-0001'), det('ADSI-2026-0002'), det('ADSI-2026-0005')];
const views = REPORTS.map((r) => ({ ...adsIncidentView(r, r.market === 'US' ? US : KR, DETS, new Date(NOW)), featureName: '고속도로 주행 보조 2' }));
const LIST = { at: ago(0), summary: adsIncidentSummary(views), markets: [KR, US], items: views };
const detail = (id: string) => ({ ...views.find((v) => v.reportId === id)!, at: ago(0), determinations: DETS.filter((d) => d.reportId === id), audit: [] });

describe('ADS 사건 보고 (ADS-UI07)', () => {
  it('핵심 메시지 — 확정된 사건 중 기한 7일 안, 후보·판단 불가는 보조 줄로만', async () => {
    handler = (url) => (url.startsWith('/api/incident-reports') ? { body: LIST } : undefined);
    const { container } = mount('viewer', '/ops/incident-reports', '/ops/incident-reports', <IncidentReportsScreen />);
    await screen.findByText('ADSI-2026-0003');
    const nearest = views.find((v) => v.reportId === 'ADSI-2026-0002')!.shortTermDue!;
    expect(keyMessage(container)).toBe(`단기 보고 기한이 7일 안인 ADS 사건 2건 — 가장 가까운 기한 ${IR.md(nearest)}`);
    // 후보는 보고 대상이 아니다 — '보고 대상 후보 — 안전·법규 담당 판단 필요'
    const cand = screen.getByText('ADSI-2026-0003').closest('tr')!;
    expect(cand.textContent).toContain('보고 대상 후보');
    expect(cand.textContent).toContain('안전·법규 담당 판단 필요');
    expect(cand.textContent).toContain('지체 없이 — 인지 후 6시간 경과');
    // 판단 불가 — 근거 부족, 승인 전 시장은 기한 기준 미등록
    const us = screen.getByText('ADSI-2026-0005').closest('tr')!;
    expect(within(us).getByText('판단 불가', { selector: '.ads-unknown__word' })).toBeTruthy();
    expect(us.textContent).toContain('근거 부족');
    expect(us.textContent).toContain('기한 기준 미등록');
    expect(container.querySelector('.ds-summary')!.textContent).toContain('보고 대상 후보 1');
    // 시장별 기한 표 — 승인 전 시장의 초안 행동은 막힘 사유를 글자로
    const blocked = container.querySelector('[data-blocked-action]')!;
    expect(blocked.textContent).toContain('단기 보고 초안 만들기');
    expect(blocked.textContent).toContain('이 시장의 기한 기준이 승인 전이라 기한을 계산하지 않습니다 — 법규 담당의 기한 표 승인이 필요합니다.');
  });

  it('상세 — 차량 시각·서버 수신 시각 두 열과 순서 다름, 운영 감사 기록과 DSSAD를 다른 라벨로, 권한 없으면 막힌 이유', async () => {
    handler = (url) => (url.startsWith('/api/incident-reports/ADSI-2026-0005') ? { body: detail('ADSI-2026-0005') } : undefined);
    const { container } = mount('operator', '/ops/incident-reports/ADSI-2026-0005', '/ops/incident-reports/:id', <IncidentReportDetail />);
    await screen.findByText('DSSAD 기록은 차량 소관 — 상관 ID 링크');
    expect(screen.getByText('운영 감사 기록')).toBeTruthy();
    const tl = container.querySelector('[data-case-timeline]')!;
    expect(within(tl as HTMLElement).getByText('차량 시각')).toBeTruthy();
    expect(within(tl as HTMLElement).getByText('서버 수신 시각')).toBeTruthy();
    expect(container.querySelector('[data-order-differs]')).toBeTruthy();
    expect(keyMessage(container)).toBe('기한 기준 미등록 — 이 시장의 기한 표가 승인 전입니다');
    expect(container.textContent).toContain('이 시장의 기한 기준이 승인 전이라 기한을 계산하지 않습니다');
    expect(container.textContent).toContain('보고 대상 확정·보고 초안 작성·제출 기록은 안전·법규 담당 역할이 할 수 있습니다.');
  });

  it('운영 감사 기록 — 계정 ID·감사 행위 코드를 보이지 않고, 확정 기록은 감사 이력과 겹쳐 두 번 나오지 않는다', async () => {
    const audit = [
      { at: ago(DAY), actor: 'usr-steward', role: 'REGULATORY_OWNER', action: 'ADS_INCIDENT_DETERMINE', result: 'ALLOWED' },
      { at: ago(DAY - 60_000), actor: 'usr-ops', role: 'OPERATOR', action: 'ADS_INCIDENT_DETERMINE', result: 'DENIED' },
    ];
    handler = (url) => (url.startsWith('/api/incident-reports/ADSI-2026-0001') ? { body: { ...detail('ADSI-2026-0001'), audit } } : undefined);
    const { container } = mount('operator', '/ops/incident-reports/ADSI-2026-0001', '/ops/incident-reports/:id', <IncidentReportDetail />);
    await screen.findByText('DSSAD 기록은 차량 소관 — 상관 ID 링크');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/usr-/);
    expect(text).not.toContain('ADS_INCIDENT_DETERMINE');
    const rows = [...container.querySelectorAll('section[aria-labelledby="ads-incident-audit-h"] tbody tr')].map((r) => r.textContent ?? '');
    expect(rows.filter((t) => t.includes('보고 대상 확정 1판'))).toHaveLength(1);
    expect(rows.filter((t) => t.includes('보고 대상 확정'))).toHaveLength(2);
    expect(rows.some((t) => t.includes('거부'))).toBe(true);
  });

  it('보고 대상 확정 — 법규 담당이 사유와 함께 기록한다', async () => {
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: detail('ADSI-2026-0003') };
      if (url.startsWith('/api/incident-reports/ADSI-2026-0003')) return { body: detail('ADSI-2026-0003') };
    };
    const { container } = mount('steward', '/ops/incident-reports/ADSI-2026-0003', '/ops/incident-reports/:id', <IncidentReportDetail />);
    await screen.findByText('보고 대상 확정 기록', { selector: 'h2, h3, .ds-panel__title, *' });
    expect(keyMessage(container)).toBe('보고 대상 후보 — 안전·법규 담당 판단 필요');
    fireEvent.change(screen.getByLabelText('사유(필수)'), { target: { value: '사건 직전 30초 안 ADS 활성' } });
    fireEvent.click(screen.getByRole('button', { name: '확정 기록' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/incident-reports/ADSI-2026-0003/determination');
    expect(post.body).toEqual({ decision: 'REPORTABLE', reason: '사건 직전 30초 안 ADS 활성' });
  });

  it('정기 보고 탭 — 노출량당 확정된 사건, 후보·판단 불가는 비율 밖', async () => {
    const year = new Date(NOW + 9 * 3600_000).getUTCFullYear();
    const months = [{ month: `${year}-01`, hours: 2000, km: 100_000 }];
    handler = (url) => {
      if (url.startsWith('/api/periodic-reports/')) return { body: { ...adsPeriodicReport(year, months, views), featureId: 'FEAT-00004', featureVersion: '4.1.0', basis: '노출량', years: [year] } };
      if (url.startsWith('/api/incident-reports')) return { body: LIST };
    };
    const { container } = mount('viewer', '/ops/incident-reports?tab=periodic', '/ops/incident-reports', <IncidentReportsScreen />);
    await screen.findByText(/비율에 넣지 않습니다/);
    expect(keyMessage(container)).toBe(`${year}년 정기 보고 — 확정된 ADS 사건 3건`);
    expect(calls.some((c) => c.url === `/api/periodic-reports/${year}`)).toBe(true);
  });
});

// ── Safety Case ──
const TARGET: AdsConfigBinding = { policy: 'PB-1', configSet: 'CFG-FEAT-00004-01', odd: 'ODD-FEAT-00004-v1', hw: 'HW3', sw: '4.1.0', model: 'M2', calibration: 'CAL17' };
const man = (id: string, o: Partial<AdsEvidenceManifest> = {}): AdsEvidenceManifest => ({
  manifestId: id, featureId: 'FEAT-00004', featureVersion: '4.1.0', requirementIds: ['FFP-F001'], hazardIds: ['H01'], config: TARGET, tool: { name: 'CARLA', version: '0.9.15', validRange: '고속도로' }, toolValidity: 'IN_RANGE',
  scenario: { id: 'TC01', title: '시나리오' }, expectedTransition: 'a', actualTransition: 'a', timing: { measuredMs: 1, budgetMs: 2, budgetStatus: 'APPROVED' }, result: 'PASS', resultDigest: `sha256:${'0'.repeat(64)}`,
  origin: 'NEW', evidenceRef: 'SAMPLE-EV-000062-VARIANT-CHECK', gateRecordId: 'SIM-G3-000062', author: 'usr-integrator', authoredAt: ago(DAY), review: { status: 'APPROVED', by: 'usr-safety2', at: ago(DAY) }, ...o,
});
const MANS = [man('EVM-0001'), man('EVM-0002', { config: { ...TARGET, sw: '4.0.1' }, origin: 'REUSED' }), man('EVM-0004', { toolValidity: 'OUT_OF_RANGE' }), man('EVM-0005', { review: { status: 'PENDING', by: null, at: null } })];
const node = (nodeId: string, kind: AdsCaseNode['kind'], parentId: string | null, manifestId: string | null = null): AdsCaseNode => ({ nodeId, kind, parentId, text: `${nodeId} 내용`, manifestId });
const NODES = [
  node('C01', 'CLAIM', null), node('C01-A1', 'ARGUMENT', 'C01'), node('C01-A1-E1', 'EVIDENCE', 'C01-A1', 'EVM-0001'), node('C01-A1-E2', 'EVIDENCE', 'C01-A1', 'EVM-0002'),
  node('C02', 'CLAIM', null), node('C02-A1', 'ARGUMENT', 'C02'), node('C02-A1-E1', 'EVIDENCE', 'C02-A1', 'EVM-0004'), node('C02-A1-E2', 'EVIDENCE', 'C02-A1', 'EVM-0005'),
];
const FIND = (status: 'OPEN' | 'CLOSED'): AdsReviewFinding => ({ findingId: 'RF-0001', featureId: 'FEAT-00004', manifestId: 'EVM-0001', severity: 'MAJOR', summary: '측정 기준 오류', status, reviewer: 'usr-safety2', reviewerIndependent: true, openedAt: ago(DAY), closedAt: null, closeReason: null });
const caseBody = (findings: AdsReviewFinding[]) => ({ featureId: 'FEAT-00004', featureVersion: '4.1.0', featureName: '고속도로 주행 보조 2', target: TARGET, findings, features: [{ featureId: 'FEAT-00004', featureVersion: '4.1.0', name: '고속도로 주행 보조 2' }], ...safetyCaseView(NODES, MANS, TARGET, findings) });

describe('Safety Case 근거 지도 (ADS-UI08)', () => {
  it('열린 중대 발견이 있으면 핵심 메시지는 승격 불가 — 형상 불일치·한계·미검토는 글자 배지, 트리는 role=tree', async () => {
    handler = (url) => (url.startsWith('/api/safety-case/FEAT-00004') ? { body: caseBody([FIND('OPEN')]) } : undefined);
    const { container } = mount('viewer', '/verify/safety-case', '/verify/safety-case', <SafetyCaseScreen />);
    await screen.findByRole('tree');
    expect(keyMessage(container)).toBe('다음 단계로 승격할 수 없음 — 열린 중대 발견 1건');
    expect(screen.getByText('승격 불가 — 열린 중대 발견 1건')).toBeTruthy();
    const tree = screen.getByRole('tree');
    expect(within(tree).getByText('형상 불일치 — 재사용 불가')).toBeTruthy();
    expect(within(tree).getByText('한계')).toBeTruthy();
    expect(within(tree).getByText('미검토')).toBeTruthy();
    expect(screen.getAllByRole('treeitem').length).toBe(8);
    expect(container.querySelector('.ds-summary')!.textContent).toContain('Evidence 없는 주장 1/2');
    expect(container.textContent).toContain('원본 Safety Case는 안전 조직 소유');
    // 검토자·작성자는 계정 ID가 아니라 이름으로
    expect(container.textContent).not.toMatch(/usr-/);
    // 키보드 — 왼쪽 화살표로 접으면 아래 항목이 사라진다
    const c1 = container.querySelector('[data-node="C01"]') as HTMLElement;
    fireEvent.keyDown(c1, { key: 'ArrowLeft' });
    expect(c1.getAttribute('aria-expanded')).toBe('false');
  });

  it('열린 중대 발견이 없으면 Evidence 없는 주장 수가 핵심 메시지', async () => {
    handler = (url) => (url.startsWith('/api/safety-case/FEAT-00004') ? { body: caseBody([FIND('CLOSED')]) } : undefined);
    const { container } = mount('viewer', '/verify/safety-case', '/verify/safety-case', <SafetyCaseScreen />);
    await screen.findByRole('tree');
    expect(keyMessage(container)).toBe('Evidence 없는 주장 1건');
  });

  it('발견사항 등록 — Evidence 작성자는 막힌 이유, 다른 Safety Manager는 등록', async () => {
    const md = { ...MANS[0], target: TARGET, linkedNodes: ['C01-A1-E1'], findings: [] };
    handler = (url, init) => {
      if (init?.method === 'POST') return { status: 201, body: FIND('OPEN') };
      if (url.startsWith('/api/evidence-manifests/EVM-0001')) return { body: md };
      if (url.startsWith('/api/safety-case/FEAT-00004')) return { body: caseBody([]) };
    };
    const author = mount('integrator', '/verify/safety-case', '/verify/safety-case', <SafetyCaseScreen />);
    fireEvent.click(await screen.findByText('C01-A1-E1 내용'));
    await screen.findByText('SAMPLE-EV-000062-VARIANT-CHECK');
    expect(author.baseElement.textContent).toContain(ADS_REVIEWER_NOT_INDEPENDENT);
    expect(author.baseElement.textContent).not.toMatch(/usr-/);
    cleanup();
    mount('safety2', '/verify/safety-case', '/verify/safety-case', <SafetyCaseScreen />);
    fireEvent.click(await screen.findByText('C01-A1-E1 내용'));
    const form = await screen.findByTestId('register-finding');
    fireEvent.change(within(form).getByLabelText('내용(필수)'), { target: { value: '시간 측정 기준 확인 필요' } });
    fireEvent.click(within(form).getByRole('button', { name: '발견사항 등록' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ manifestId: 'EVM-0001', severity: 'MAJOR', summary: '시간 측정 기준 확인 필요' });
  });
});

// ── 요구 추적 ──
const SHA = 'abcdef0123456789'.repeat(4);
const req = (id: string, verdict: string | null, evidence: string[] = ['x.ts:1']) => ({
  id, title: `${id} 제목`, category: '승인·변경 통제', priority: 'P0', owner: 'CP', content: '내용', acceptance: '조건', basis: id === 'FFP-F005' ? 'GTR §5.2' : 'GTR §4.1.5',
  tests: ['TC01'], claims: ['C01'], hazards: ['H01'], review: verdict ? { verdict, evidence, tests: [], gap: '차이', plan: ['ADS-BE13'] } : null,
  defects: id === 'FFP-F002' ? [{ probe: 'backend/test/ads/defects.spec.ts:46', title: 'FFP-F002 결함' }] : [],
});
const TRACE: AdsTraceDoc = {
  source: { file: 'r.html', sha256: SHA, revision: '3.0', date: '2026-10-18' },
  reviewed: { sha256: SHA, reviewedAt: '2026-10-18', reviewedCommit: '0681305' },
  requirements: [req('FFP-F001', '구현'), req('FFP-F002', '부분'), req('FFP-F003', '미구현'), req('FFP-F004', '구현', []), req('FFP-F005', null)],
  tests: [{ id: 'TC01', name: '적용 범위', expected: '거부', requirements: ['FFP-F005'], review: null }],
  scenarios: [{ id: 'S01', title: 'ODD 밖', situation: '상황', handling: '목표 처리', review: { current: '현재 처리', gap: '', plan: ['ADS-UI06'] } }],
};

describe('ADS·UNECE 요구 추적 (ADS-UI10)', () => {
  it('핵심 메시지 — 부분·미구현·근거 없음을 센다, 근거 없음·미판정·결과 없음은 따로 보인다', async () => {
    handler = (url) => (url.startsWith('/api/ads/trace') ? { body: { ...TRACE, summary: traceSummary(TRACE) } } : undefined);
    const { container } = mount('viewer', '/trace/ads', '/trace/ads', <TraceAdsScreen />);
    await screen.findByText('FFP-F004 제목');
    expect(keyMessage(container)).toBe('구현되지 않은 요구 3개 — 부분 구현 포함, 5개 중');
    expect(container.textContent).toContain('플랫폼 구현 현황 — 차량 인증 상태가 아닙니다');
    expect(container.textContent).toContain(SHA.slice(0, 8));
    const row = screen.getByText('FFP-F004 제목').closest('tr')!;
    expect(row.textContent).toContain('근거 없음');
    expect(screen.getByText('FFP-F005 제목').closest('tr')!.textContent).toContain('미판정');
    expect(screen.getByText('FFP-F002 제목').closest('tr')!.querySelector('[data-defects="1"]')).toBeTruthy();
    expect(screen.getAllByText('결과 없음').length).toBe(5);
    fireEvent.click(screen.getByText('FFP-F002 제목').closest('tr')!);
    expect(await screen.findByText('backend/test/ads/defects.spec.ts:46 FFP-F002 결함')).toBeTruthy();
  });

  it('표준 개정 영향 조회 — 검토 전 요구·시험도 미판정으로 함께', async () => {
    handler = (url) => (url.startsWith('/api/ads/trace') ? { body: { ...TRACE, summary: traceSummary(TRACE) } } : undefined);
    mount('viewer', '/trace/ads?tab=impact', '/trace/ads', <TraceAdsScreen />);
    const input = await screen.findByLabelText('개정된 조항');
    fireEvent.change(input, { target: { value: '§5.2' } });
    expect(await screen.findByText('영향 요구 1개 · 인수시험 1개')).toBeTruthy();
    expect(screen.getAllByText('미판정').length).toBe(2);
  });
});
