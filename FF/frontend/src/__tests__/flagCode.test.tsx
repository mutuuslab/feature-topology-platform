// Flag 코드 연결 화면(20-97 §7·§8.1) — 필터·상태 라벨, 출시 차단 배지, 역할별 버튼(구현 담당/출시 담당/승인자/열람),
// 403·오류·지연, 해제 결정 직무 분리 안내. 응답은 계약 스키마로 검증한 시험용 값이다(백엔드 없이).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FLAG_COVERAGE_LABEL, FlagCoverageDetail, FlagCoverageResponse, FlagScanDetail, FlagEvaluationSeries, FlagEvaluationStat, FlagGateWaiver, FlagPullRequest, FlagReleaseGate, FlagRepository, FlagScanRun, type FlagCoverageRow } from '@ff/contracts';
import { AppProvider } from '../store';
import { flagCode as T } from '../copy/flag-code';
import { ko } from '../copy/ko';
import { CodeRepositoriesScreen, CodeScansScreen, FlagCodeCoverageScreen, FlagCodeDetailScreen, FlagCodeLifecycleScreen, FlagCodeReconcileScreen, FlagEvaluationsScreen } from '../screens/flag-code';
import { FeatureFlagsTab } from '../screens/features/FeatureFlags';
import { routeOf } from '../routes';

const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);
const REPO = 'https://github.com/mutuuslab/vehicle-feature-apps';
const NOW = '2026-11-06T00:00:00.000Z';
const lanesOk = { REGISTRY: 'OK', CODE: 'OK', UNLEASH: 'OK', DEPLOY: 'OK', REPORT: 'OK' } as const;
const usage = (flagKey: string, path: string, line: number) => ({
  repoId: 'FREPO-001',
  scanId: 'FSCAN-000010',
  path,
  line,
  symbol: `client.getBooleanValue(${flagKey.toUpperCase()}, false, ctx)`,
  method: 'getBooleanValue' as const,
  safeDefault: 'EXPLICIT_FALSE' as const,
  contentHash: 'sha256:' + 'c'.repeat(64),
  repository: REPO,
  provider: 'GITHUB' as const,
  commit: C1,
  url: `${REPO}/blob/${C1}/${path}#L${line}`,
  importedAt: NOW,
  importedBy: 'ff-scanner',
  provenance: 'FF_SCAN' as const,
});
const base = (flagKey: string, over: Partial<FlagCoverageRow> = {}): FlagCoverageRow => ({
  flagKey,
  featureId: 'FEAT-00022',
  version: '1.0.0',
  featureName: '차간 거리 경고',
  lifecycle: 'RELEASED',
  package: 'adas',
  controlPoint: 'Signal',
  planSource: 'POLICY',
  policy: { policyId: 'POL-00001', status: 'DEPLOYED', revision: 3 },
  code: { usages: [usage(flagKey, 'packages/adas/src/features/feat-00022/flag-guards.ts', 7)], lastScanAt: NOW, lastSeen: null },
  pullRequest: { prId: 'FPR-000001', kind: 'SCAFFOLD', state: 'MERGED', number: 1, url: null },
  unleash: { configured: true, present: true, revision: 3, archived: false },
  deploy: { publicationId: 'PUB-00001', status: 'CONFIRMED', policyRevision: 3 },
  report: { confirmed: 2, denominator: 2, lastReportAt: NOW },
  status: 'OK',
  severity: 'OK',
  findings: [],
  lanes: { ...lanesOk },
  codeRequired: true,
  releaseBlocking: false,
  waiver: null,
  ...over,
});
const rows: FlagCoverageRow[] = [
  base('care_00022_signal'),
  base('ivi_00031_enable', {
    featureId: 'FEAT-00031',
    version: '1.1.0',
    featureName: '음성 안내',
    lifecycle: 'VERIFIED',
    package: 'ivi',
    controlPoint: 'Flag',
    planSource: 'PLANNED',
    policy: null,
    code: { usages: [], lastScanAt: NOW, lastSeen: null },
    pullRequest: { prId: 'FPR-000004', kind: 'SCAFFOLD', state: 'CLOSED', number: 4, url: null },
    deploy: null,
    report: null,
    status: 'NO_CODE',
    severity: 'BLOCKER',
    findings: [{ status: 'NO_CODE', severity: 'BLOCKER', message: '연결된 저장소의 최신 스캔에 이 Flag 호출이 없습니다.', since: '2026-10-01T00:00:00.000Z', dueAt: null }],
    lanes: { REGISTRY: 'PENDING', CODE: 'MISSING', UNLEASH: 'PENDING', DEPLOY: 'NOT_APPLICABLE', REPORT: 'NOT_APPLICABLE' },
    releaseBlocking: true,
  }),
  base('body_00040_param', {
    featureId: 'FEAT-00040',
    package: 'body',
    controlPoint: 'Parameter',
    status: 'PR_OPEN',
    severity: 'INFO',
    lifecycle: 'DEVELOPING',
    code: { usages: [], lastScanAt: NOW, lastSeen: null },
    pullRequest: { prId: 'FPR-000007', kind: 'SCAFFOLD', state: 'OPEN', number: 7, url: null },
    findings: [{ status: 'PR_OPEN', severity: 'INFO', message: 'FF가 연 Flag PR이 병합을 기다립니다.', since: '2026-11-04T00:00:00.000Z', dueAt: null }],
    lanes: { ...lanesOk, CODE: 'PENDING' },
    releaseBlocking: true,
  }),
  base('chassis_00050_dtc', {
    featureId: 'FEAT-00050',
    package: 'chassis',
    controlPoint: 'DTC',
    lifecycle: 'DEPRECATED',
    status: 'REMOVAL_DUE',
    severity: 'BLOCKER',
    findings: [{ status: 'REMOVAL_DUE', severity: 'BLOCKER', message: '코드 삭제 기한이 지났습니다 — 제거 PR을 병합하세요(남은 호출 1곳).', since: '2026-04-01T00:00:00.000Z', dueAt: '2026-05-01T00:00:00.000Z' }],
    codeRequired: false,
  }),
  base('platform_00060_enable', {
    featureId: 'FEAT-00060',
    package: 'platform',
    status: 'STALE',
    severity: 'WARNING',
    findings: [{ status: 'STALE', severity: 'WARNING', message: '90일 동안 평가가 없습니다 — 사용 여부를 확인하세요.', since: '2026-06-20T00:00:00.000Z', dueAt: null }],
  }),
];
const coverage = FlagCoverageResponse.parse({
  generatedAt: NOW,
  summary: {
    flags: rows.length,
    codeRequired: 4,
    connected: 2,
    releaseBlocking: 2,
    byStatus: { OK: 1, PR_OPEN: 1, NO_CODE: 1, CALL_DELETED: 0, UNREGISTERED_KEY: 0, DYNAMIC_KEY: 0, UNLEASH_MISMATCH: 0, STALE: 1, REMOVAL_DUE: 1 },
    repositories: [{ repoId: 'FREPO-001', displayName: '차량 기능 앱', lastScanAt: NOW, commit: C1, webhook: 'ACTIVE' }],
  },
  rows,
  fileFindings: [{ repoId: 'FREPO-001', commit: C1, status: 'DYNAMIC_KEY', call: { path: 'packages/ivi/src/features/feat-00027/feature.ts', line: 41, symbol: 'client.getBooleanValue(`ivi_${slot}`, false, ctx)', method: 'getBooleanValue' }, since: '2026-10-30T00:00:00.000Z' }],
});
const repos = [
  FlagRepository.parse({
    repoId: 'FREPO-001',
    provider: 'GITHUB',
    repository: REPO,
    displayName: '차량 기능 앱',
    mode: 'DEMO_MIRROR',
    defaultBranch: 'main',
    scanPaths: [],
    packages: [{ name: 'adas', path: 'packages/adas' }, { name: 'ivi', path: 'packages/ivi' }, { name: 'body', path: 'packages/body' }, { name: 'chassis', path: 'packages/chassis' }, { name: 'platform', path: 'packages/platform' }],
    scanIntervalMinutes: 60,
    status: 'ACTIVE',
    installationId: null,
    webhook: { state: 'FAILING', lastDeliveryId: 'dlv-1', lastDeliveryAt: NOW, failureCount: 2, lastError: '서명 불일치' },
    lastScan: { scanId: 'FSCAN-000010', commit: C1, at: NOW, status: 'SUCCEEDED' },
    createdAt: NOW,
    createdBy: 'usr-coordinator',
  }),
];
const scans = [
  FlagScanRun.parse({
    scanId: 'FSCAN-000011',
    repoId: 'FREPO-001',
    trigger: 'PULL_REQUEST',
    ref: 'ff/flags/feat-00031-1.1.0',
    commit: C2,
    baseCommit: C1,
    prNumber: 9,
    status: 'SUCCEEDED',
    queuedAt: NOW,
    finishedAt: NOW,
    resultId: 'R-1',
    summary: { filesScanned: 30, usages: 12, flagKeys: 9, unresolved: 1 },
    attestation: { kind: 'FF_SCANNER', keyId: 'ff-demo-scan-1', signature: 'A'.repeat(86) },
    prCheck: { conclusion: 'failure', findings: [{ code: 'UNREGISTERED_KEY', level: 'FAILURE', flagKey: 'ivi_00031_experiment', path: 'packages/ivi/src/x.ts', line: 3, message: '등록되지 않은 키입니다.' }] },
    error: null,
    requestedBy: 'github-app',
    deliveryId: 'dlv-9',
  }),
  FlagScanRun.parse({ scanId: 'FSCAN-000012', repoId: 'FREPO-001', trigger: 'PUSH', ref: 'main', commit: C1, baseCommit: null, prNumber: null, status: 'REJECTED', queuedAt: NOW, finishedAt: NOW, resultId: null, summary: null, attestation: { kind: 'NONE' }, prCheck: null, error: { code: 'SIGNATURE_INVALID', message: '서명이 커밋과 맞지 않습니다.' }, requestedBy: 'github-app', deliveryId: 'dlv-10' }),
];
const prs = [FlagPullRequest.parse({ prId: 'FPR-000007', repoId: 'FREPO-001', kind: 'SCAFFOLD', featureId: 'FEAT-00040', version: '1.0.0', flagKeys: ['body_00040_param'], branch: 'ff/flags/feat-00040-1.0.0', number: 7, url: null, title: 'Flag 뼈대', state: 'OPEN', checkConclusion: 'SUCCESS', files: [], createdAt: NOW, createdBy: 'ff-bot', mergedAt: null, mergedBy: null, mergeCommit: null, retirementId: null, failure: null })];
const waiver = FlagGateWaiver.parse({ waiverId: 'FWV-0001', flagKey: 'ivi_00031_enable', featureId: 'FEAT-00031', version: '1.1.0', reason: '차량 SW 다음 배포에 함께 넣습니다', expiresAt: '2026-11-20T00:00:00.000Z', state: 'REQUESTED', coverageStatus: 'NO_CODE', requestedBy: 'usr-integrator', requestedAt: NOW, decidedBy: null, decidedAt: null, comment: null });
const gate = FlagReleaseGate.parse({ featureId: 'FEAT-00031', version: '1.1.0', pass: false, blockers: [{ flagKey: 'ivi_00031_enable', status: 'NO_CODE', message: '연결된 저장소의 최신 스캔에 이 Flag 호출이 없습니다.' }], waived: [], checkedAt: NOW });
const stat = (flagKey: string, source: 'UNLEASH_EDGE' | 'VEHICLE_REPORT', fallbacks: { reason: string; count: number }[]) =>
  FlagEvaluationStat.parse({ flagKey, window: '24h', source, evaluations: 10000, enabled: 6000, disabled: 4000, variants: [{ name: 'on', count: 6000 }, { name: 'off', count: 4000 }], fallbacks, errors: 3, vehicles: 120, lastEvaluatedAt: NOW });
const evaluations = [stat('care_00022_signal', 'UNLEASH_EDGE', [{ reason: 'TTL_EXPIRED', count: 40 }]), stat('ivi_00024_guide', 'VEHICLE_REPORT', [{ reason: 'SIGNATURE_INVALID', count: 300 }])];
const hours = Array.from({ length: 24 }, (_, i) => new Date(Date.parse(NOW) - (23 - i) * 3600_000).toISOString());
const series = FlagEvaluationSeries.parse({ flagKey: 'ivi_00024_guide', window: '24h', bucketMinutes: 60, buckets: hours.map((h, i) => ({ bucketStart: h, source: 'VEHICLE_REPORT', evaluations: 400 + i, enabled: 200, fallbacks: i === 20 ? 250 : 2, errors: 0 })), stats: [] });

const scanDetail = FlagScanDetail.parse({
  scan: scans[0],
  manifest: {
    format: 'ff-flag-source/v2',
    provider: 'GITHUB',
    repository: REPO,
    ref: 'ff/flags/feat-00031-1.1.0',
    commit: C2,
    scannedAt: NOW,
    scanner: { name: 'ff-flag-scan', version: '2.0.0' },
    filesScanned: 30,
    usages: [],
    unresolved: [{ path: 'packages/ivi/src/features/feat-00027/feature.ts', line: 41, symbol: 'client.getBooleanValue(`ivi_${slot}`)', method: 'getBooleanValue' }],
  },
  provenance: 'FF_SCAN',
  verified: true,
});
let override: Record<string, { status: number; body?: unknown; gate?: Promise<void> }> = {};
let posted: { url: string; body: any; role?: string }[] = [];
let createPrFails = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function respond(url: string): unknown {
  const path = url.split('?')[0];
  if (path === '/api/flag-code/coverage') return coverage;
  if (path.startsWith('/api/flag-code/coverage/')) return FlagCoverageDetail.parse({ row: rows.find((r) => r.flagKey === decodeURIComponent(path.split('/').pop()!)) ?? rows[0], history: [{ repoId: 'FREPO-001', scanId: 'FSCAN-000009', commit: C2, at: '2026-10-20T00:00:00.000Z', usages: 1 }], pullRequests: [], waivers: [waiver] });
  if (path === '/api/flag-code/repositories') return { items: repos };
  if (path === '/api/flag-code/scans') return { items: scans, nextCursor: null };
  if (path.startsWith('/api/flag-code/scans/')) return scanDetail;
  if (path === '/api/flag-code/pull-requests') return { items: prs };
  if (path === '/api/flag-code/waivers') return { items: [waiver] };
  if (path === '/api/flag-code/evaluations') return { items: evaluations };
  if (path.startsWith('/api/flag-code/evaluations/')) return series;
  if (path.endsWith('/flag-code-gate')) return gate;
  if (path === '/api/flag-retirements') return { items: [{ retirementId: 'RET-0001', flagKey: 'chassis_00050_dtc', status: 'APPROVED' }] };
  if (path === '/api/feature-flags') return [{ flagKey: 'ivi_00031_enable', featureId: 'FEAT-00031', version: '1.1.0', featureName: '음성 안내', policy: null, sources: [], publication: null }];
  return { items: [] };
}
beforeEach(() => {
  localStorage.clear();
  override = {};
  posted = [];
  createPrFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0];
      if (init?.method && init.method !== 'GET') {
        posted.push({ url, body: JSON.parse(String(init.body)), role: (init.headers as Record<string, string>)['X-Actor-Role'] });
        if (url === '/api/flag-code/pull-requests' && createPrFails) return json({ prId: 'FPR-000099', state: 'FAILED', failure: 'FF_GITHUB_APP_ID가 없습니다.' }, 201);
        return json({ ok: true }, 201);
      }
      const o = override[path];
      if (o?.gate) await o.gate;
      if (o) return json(o.body ?? { error: { code: o.status === 403 ? 'FORBIDDEN' : 'INTERNAL', message: '조회하지 못했습니다' } }, o.status);
      return json(respond(url));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(el: React.ReactNode, { role = 'viewer', at = '/', path = '*' }: { role?: string; at?: string; path?: string } = {}) {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Flag 코드 연결 — 경로', () => {
  it('8개 화면이 메뉴 또는 부모 아래에서 열린다', () => {
    expect(routeOf('/flag-code')?.title).toBe('Flag 코드 연결');
    expect(routeOf('/flag-code/flags/care_00022_signal')?.parent).toBe('/flag-code');
    expect(routeOf('/flag-code/reconcile')?.title).toBe('어긋남 대사판');
    expect(routeOf('/flag-code/lifecycle')?.title).toBe('Flag 수명 관리');
    expect(routeOf('/ops/flag-evaluations')?.path).toBe('/ops/flag-evaluations');
    expect(routeOf('/integration/code-repositories/FREPO-001')?.parent).toBe('/integration/code-repositories');
    expect(routeOf('/integration/code-scans')?.parent).toBe('/integration/code-repositories');
  });
});

describe('현황 — 필터·상태 라벨·출시 차단', () => {
  it('계약 상태 라벨로 그리고, 출시 차단 수를 핵심 메시지로 말한다', async () => {
    mount(<FlagCodeCoverageScreen />);
    const table = await screen.findByRole('table', { name: T.coverage.table });
    expect(within(table).getByText(FLAG_COVERAGE_LABEL.NO_CODE)).toBeVisible();
    expect(within(table).getByText(FLAG_COVERAGE_LABEL.PR_OPEN)).toBeVisible();
    expect(document.querySelector('[data-key-message]')).toHaveTextContent(`2${T.coverage.keyBlocked}`);
    // 소스 줄은 커밋에 고정된 링크(새 창)
    expect(within(table).getAllByRole('link', { name: /flag-guards\.ts:7/ })[0]).toHaveAttribute('href', `${REPO}/blob/${C1}/packages/adas/src/features/feat-00022/flag-guards.ts#L7`);
  });
  it('상태·패키지 필터는 화면에서 걸고 주소에 남긴다', async () => {
    mount(<FlagCodeCoverageScreen />);
    const table = await screen.findByRole('table', { name: T.coverage.table });
    fireEvent.change(screen.getByLabelText(T.col.status), { target: { value: 'NO_CODE' } });
    await waitFor(() => expect(within(table).queryByText('care_00022_signal')).not.toBeInTheDocument());
    expect(within(table).getByText('ivi_00031_enable')).toBeVisible();
    fireEvent.change(screen.getByLabelText(T.col.status), { target: { value: 'ATTENTION' } });
    fireEvent.change(screen.getByLabelText(T.col.pkg), { target: { value: 'body' } });
    await waitFor(() => expect(within(table).queryByText('ivi_00031_enable')).not.toBeInTheDocument());
    expect(within(table).getByText('body_00040_param')).toBeVisible();
  });
  it('구현 담당만 PR 다시 만들기를 누르고, 열람 계정에는 이유가 보인다', async () => {
    mount(<FlagCodeCoverageScreen />, { role: 'viewer' });
    const btn = await screen.findByRole('button', { name: T.next.createPr });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/구현 담당자 역할이 할 수 있습니다/)).toBeVisible();
    cleanup();
    mount(<FlagCodeCoverageScreen />, { role: 'integrator' });
    fireEvent.click(await screen.findByRole('button', { name: T.next.createPr }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: T.next.createPr }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ url: '/api/flag-code/pull-requests', role: 'IMPLEMENTER', body: { featureId: 'FEAT-00031', version: '1.1.0', repoId: 'FREPO-001', flagKeys: ['ivi_00031_enable'] } });
  });
  it('PR 생성이 실패(201·FAILED)하면 열었다고 하지 않고 이유를 보인다', async () => {
    createPrFails = true;
    mount(<FlagCodeCoverageScreen />, { role: 'integrator' });
    fireEvent.click(await screen.findByRole('button', { name: T.next.createPr }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: T.next.createPr }));
    expect(await screen.findByText(T.actions.createPrFailed('FF_GITHUB_APP_ID가 없습니다.'))).toBeVisible();
    expect(screen.queryByText(T.actions.createPrDone)).not.toBeInTheDocument();
  });
});

describe('조회 상태 — 403·오류·지연', () => {
  it('권한 없음은 권한 상태로, 서버 오류는 다시 시도와 함께', async () => {
    override['/api/flag-code/coverage'] = { status: 403 };
    mount(<FlagCodeCoverageScreen />);
    expect(await screen.findByText(ko.state.forbiddenTitle)).toBeVisible();
    cleanup();
    override['/api/flag-code/coverage'] = { status: 500 };
    mount(<FlagCodeReconcileScreen />);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible();
  });
  it('지연 중에는 뼈대(로딩)를 보이고, 응답이 오면 표로 바뀐다', async () => {
    // 응답을 시험이 풀어 줄 때까지 붙잡는다(고정 대기 없이)
    let release!: () => void;
    override['/api/flag-code/coverage'] = { status: 200, body: coverage, gate: new Promise<void>((r) => (release = r)) };
    mount(<FlagCodeCoverageScreen />);
    expect(await screen.findByRole('progressbar')).toBeVisible();
    release();
    expect(await screen.findByRole('table', { name: T.coverage.table })).toBeVisible();
  });
  it('계약과 다른 응답은 빈 화면이 아니라 오류로 보인다', async () => {
    override['/api/flag-code/coverage'] = { status: 200, body: [{ flagKey: 'x' }] };
    mount(<FlagCodeLifecycleScreen />);
    expect(await screen.findByRole('alert')).toBeVisible();
  });
});

describe('대사판 — 상태별 열·다음 할 일·해제 직무 분리', () => {
  it('상태별 열에 카드를 두고 동적 키는 파일 카드로 보인다', async () => {
    mount(<FlagCodeReconcileScreen />, { role: 'integrator' });
    const col = await screen.findByRole('region', { name: FLAG_COVERAGE_LABEL.NO_CODE });
    expect(within(col).getByRole('link', { name: 'ivi_00031_enable' })).toHaveAttribute('href', '/flag-code/flags/ivi_00031_enable');
    expect(within(col).getByRole('button', { name: T.next.requestWaiver })).toBeEnabled();
    const dyn = screen.getByRole('region', { name: FLAG_COVERAGE_LABEL.DYNAMIC_KEY });
    expect(within(dyn).getByText(T.reconcile.dynamicFile)).toBeVisible();
    // 열린 PR은 시연 저장소에서 병합으로 재현
    const pr = screen.getByRole('region', { name: FLAG_COVERAGE_LABEL.PR_OPEN });
    fireEvent.click(within(pr).getByRole('button', { name: T.next.demoMerge }));
    await waitFor(() => expect(posted[0]?.url).toBe('/api/flag-code/pull-requests/FPR-000007/demo-merge'));
  });
  it('해제를 요청한 사람은 같은 해제를 결정할 수 없다는 이유를 본다', async () => {
    mount(<FlagCodeReconcileScreen />, { role: 'integrator' });
    const box = await screen.findByTestId('waiver-decide-FWV-0001');
    expect(within(box).getByRole('button', { name: T.actions.approve })).toBeDisabled();
    expect(within(box).getByText(T.actions.selfDecision)).toBeVisible();
  });
  it('Feature 승인자는 의견을 쓰고 승인한다(개인 서명 안내)', async () => {
    mount(<FlagCodeReconcileScreen />, { role: 'approver' });
    const box = await screen.findByTestId('waiver-decide-FWV-0001');
    expect(within(box).getByText(new RegExp(T.actions.personalSign))).toBeVisible();
    fireEvent.change(within(box).getByLabelText(new RegExp(T.actions.decideComment)), { target: { value: '다음 배포 확인' } });
    fireEvent.click(within(box).getByRole('button', { name: T.actions.approve }));
    await waitFor(() => expect(posted[0]).toMatchObject({ url: '/api/flag-code/waivers/FWV-0001/decision', role: 'FEATURE_APPROVER', body: { decision: 'APPROVE' } }));
  });
});

describe('상세·Feature Flag 탭·정책 쪽 연결', () => {
  it('5원천 칸과 어긋남·해제 이력, 재스캔은 사유가 있어야 보낸다', async () => {
    mount(<FlagCodeDetailScreen />, { role: 'integrator', at: '/flag-code/flags/ivi_00031_enable', path: '/flag-code/flags/:flagKey' });
    expect(await screen.findByRole('heading', { level: 1, name: T.detail.title })).toBeVisible();
    const lanes = screen.getByRole('list', { name: T.detail.lanes });
    expect(lanes.querySelector('[data-lane-name="CODE"]')).toHaveAttribute('data-lane', 'MISSING');
    expect(screen.getByText(T.waiverState.REQUESTED)).toBeVisible();
    expect(screen.getByRole('table', { name: T.detail.history })).toHaveTextContent('FSCAN-000009');
    fireEvent.click(screen.getByRole('button', { name: T.next.rescan }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: T.next.rescan });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(T.actions.reason)), { target: { value: '수정 커밋 확인' } });
    // 이유 문구가 사라지면 버튼을 감싼 요소가 바뀐다 — 다시 찾는다
    fireEvent.click(within(dialog).getByRole('button', { name: T.next.rescan }));
    await waitFor(() => expect(posted[0]).toMatchObject({ url: '/api/flag-code/repositories/FREPO-001/scans', role: 'IMPLEMENTER', body: { reason: '수정 커밋 확인' } }));
  });
  it('Feature Flag 탭 — 출시 관문 막힘과 1단계 대사 배지, 정책 없는 계획 Flag는 정책 대기', async () => {
    mount(<FeatureFlagsTab id="FEAT-00031" ver="1.1.0" />);
    const g = await screen.findByTestId('flag-release-gate');
    expect(g).toHaveTextContent(T.feature.gateBlocked(1));
    expect(within(g).getByRole('link', { name: T.feature.toReconcile })).toHaveAttribute('href', '/flag-code/reconcile');
    const badge = await screen.findByTestId('coverage-ivi_00031_enable');
    expect(badge).toHaveTextContent(FLAG_COVERAGE_LABEL.NO_CODE);
    expect(within(badge).getByRole('link', { name: T.common.detailArrow })).toHaveAttribute('href', '/flag-code/flags/ivi_00031_enable');
    expect(screen.getAllByText('정책 대기').length).toBeGreaterThan(0);
  });
  it('Feature Flag 탭 — 배지는 이 Version으로 판정한 대사(출시 관문과 같은 판정)를 읽는다', async () => {
    mount(<FeatureFlagsTab id="FEAT-00031" ver="1.1.0" />);
    await screen.findByTestId('coverage-ivi_00031_enable');
    const urls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => u).filter((u) => u.startsWith('/api/flag-code/coverage'));
    expect(urls).toContain('/api/flag-code/coverage?featureId=FEAT-00031&version=1.1.0');
    expect(urls).not.toContain('/api/flag-code/coverage');
  });
});

describe('수명 관리·평가·저장소·스캔', () => {
  it('제거 대상은 기한 경과와 제거 PR 버튼(승인된 Retirement 연결)을 보인다', async () => {
    mount(<FlagCodeLifecycleScreen />, { role: 'integrator' });
    const table = await screen.findByRole('table', { name: T.lifecycle.removal });
    expect(within(table).getByText(/기한 \d+일 지남/)).toBeVisible();
    fireEvent.click(within(table).getByRole('button', { name: T.next.removalPr }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: T.next.removalPr }));
    await waitFor(() => expect(posted[0]).toMatchObject({ url: '/api/flag-code/removal-pull-requests', body: { flagKey: 'chassis_00050_dtc', retirementId: 'RET-0001', repoId: 'FREPO-001' } }));
  });
  it('평가 모니터링 — 서명 오류 폴백 급증 Flag를 먼저 고르고 시계열·지도로 잇는다', async () => {
    mount(<FlagEvaluationsScreen />);
    expect(await screen.findByText(T.evaluations.keySpike)).toBeVisible();
    expect(await screen.findByTestId('flag-eval-trend')).toBeVisible();
    expect(screen.getByRole('link', { name: T.evaluations.toMap })).toHaveAttribute('href', '/fleet/map?lens=activation&flagKey=ivi_00024_guide');
    expect(screen.getByRole('button', { name: T.evaluations.select('ivi_00024_guide') })).toHaveAttribute('aria-pressed', 'true');
  });
  it('저장소 설정은 출시 담당만 — 구현 담당에게는 직무 분리 이유', async () => {
    mount(<CodeRepositoriesScreen />, { role: 'integrator' });
    expect(await screen.findByRole('button', { name: T.repos.connect })).toBeDisabled();
    expect(screen.getByText(T.repos.settingsOwner)).toBeVisible();
    expect(await screen.findByText(T.webhook.FAILING)).toBeVisible();
    cleanup();
    mount(<CodeRepositoriesScreen />, { role: 'coordinator' });
    expect(await screen.findByRole('button', { name: T.repos.connect })).toBeEnabled();
  });
  it('스캔 기록 — 거부 건수, 행을 열면 서명·PR 검사·동적 키 위치', async () => {
    mount(<CodeScansScreen />);
    expect(await screen.findByText(T.scans.keyRejected)).toBeVisible();
    fireEvent.click(screen.getAllByText(T.attestation.FF_SCANNER)[0]);
    const detail = await screen.findByTestId('scan-detail');
    expect(within(detail).getByText(T.checkCode.UNREGISTERED_KEY)).toBeVisible();
    expect(await within(detail).findByText(T.scans.resultProvenance.FF_SCAN)).toBeVisible();
    expect(await within(detail).findByText(T.scans.unresolved)).toBeVisible();
    expect(within(detail).getByRole('link', { name: /feature\.ts:41/ })).toHaveAttribute('href', `${REPO}/blob/${C2}/packages/ivi/src/features/feat-00027/feature.ts#L41`);
  });
});
