// ADS 구성 화면 — ODD 프로파일(/config/odd, ADS-UI04)·승인 구성 조합(/config/compat, ADS-UI05)·VIN 지원 판정(/activation/decide, ORC-UI02). 모의 API.
// harness/ads/ux.json 확정안의 핵심 메시지·판단 불가·미확인·막힘 사유를 단언한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type ConfigSet, type OddCondition, type OddProfile, type VehicleConfigReport } from '@ff/contracts';
import { classifyVehicleConfig, compareDeploySettings, countVerdicts, decideEligibility, ELIGIBILITY_LABEL, ELIGIBILITY_STATES, oddApprovalBlockedReason, oddConditionDiff, ODD_SELF_APPROVAL, siteStatus, validateOddProfile } from '../../../contracts/src/rules/ads-config';
import { AppProvider } from '../store';
import { DEMO_ACCOUNTS } from '../data/demoAccounts';
import OddProfilesScreen from '../screens/ads/OddProfiles';
import CompatSetsScreen from '../screens/ads/CompatSets';
import { ActivationScreen } from '../screens/policy/Runtime';

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
const keyText = () => document.querySelector('[data-key-message]')?.textContent ?? '';

// ── ODD 프로파일 ──
const sp = (op: OddCondition['op'], value: number, unit: string): OddCondition => ({ key: 'speedMax', axis: 'DYNAMIC', label: '최고 속도', op, value, unit });
const ENVELOPE: OddCondition[] = [sp('LE', 130, 'km/h')];
const EXCL: OddCondition = { key: 'roadSection', axis: 'EXCLUSION', label: '배제 구간', op: 'IN', value: ['톨게이트'], unit: null };
const site = (siteId: string, mapVersion: string, impactConfirmed: boolean) => ({ siteId, name: `장소 ${siteId}`, kind: 'ROAD_SECTION' as const, mapVersion, infraVersion: 'IF-1.5', impactConfirmed });
const profile = (over: Partial<OddProfile>): OddProfile => ({
  profileId: 'ODD-FEAT-00004-v1', featureId: 'FEAT-00004', featureVersion: '4.1.0', version: 1, status: 'APPROVED', basedOn: null,
  conditions: [sp('LE', 80, 'km/h'), EXCL], envelope: ENVELOPE, mapVersions: ['2.2'], infraVersions: ['IF-1.5'],
  sites: [site('SITE-0001', '2.2', true), site('SITE-0002', '2.2', false), site('SITE-0003', '2.3', true)],
  createdBy: 'usr-author', createdAt: '2026-10-01T00:00:00Z', approvedBy: 'usr-safety', approvedAt: '2026-10-05T00:00:00Z', approvalReason: '승인', ...over,
});
const V1 = profile({});
const V2 = profile({ profileId: 'ODD-FEAT-00004-v2', version: 2, status: 'DRAFT', basedOn: 'ODD-FEAT-00004-v1', conditions: [EXCL, sp('LE', 40, 'm/s')], approvedBy: null, approvedAt: null, approvalReason: null });
const SETTINGS = [
  { settingId: 'DS-1', featureId: 'FEAT-00004', featureVersion: '4.1.0', flagKey: 'hda2_00004_speed', key: 'speedMax', label: '작동 최고 속도', op: 'LE' as const, value: 140, unit: 'km/h' },
  { settingId: 'DS-2', featureId: 'FEAT-00004', featureVersion: '4.1.0', flagKey: 'hda2_00004_weather', key: 'speedMax', label: '보정값', op: 'LE' as const, value: 0.4, unit: 'in/h' },
];
const detail = (p: OddProfile, base: OddProfile | null) => {
  const issues = validateOddProfile(p);
  const deploy = compareDeploySettings(SETTINGS, p.envelope);
  return {
    profile: p, feature: { featureId: 'FEAT-00004', version: '4.1.0', name: '고속도로 주행 보조 2', lifecycle: 'RELEASED' }, issues,
    blockedReason: p.status === 'DRAFT' ? oddApprovalBlockedReason(issues) : null, deploy, deployCounts: countVerdicts(deploy),
    sites: p.sites.map((s) => ({ ...s, ...siteStatus(s, p) })), flagKeys: ['hda2_00004_speed'], policies: [], configSets: ['CFG-FEAT-00004-01'],
    base: base ? { profileId: base.profileId, version: base.version, status: base.status } : null, diff: base ? oddConditionDiff(base.conditions, p.conditions) : [],
  };
};
const listItem = (p: OddProfile) => ({ profileId: p.profileId, featureId: p.featureId, featureVersion: p.featureVersion, featureName: '고속도로 주행 보조 2', version: p.version, status: p.status, issues: validateOddProfile(p).length, deploy: { WITHIN: 4, EXCEEDS: 3, UNDECIDABLE: 1 }, sites: { APPROVED: 1, PENDING: 1, EXPOSURE_HOLD: 1 } });
const oddHandler = (summary = { exceeds: 3, undecidable: 1, within: 4, total: 8 }, profiles = [V1, V2]): Handler => (url) => {
  if (url.startsWith('/api/odd-profiles/ODD-FEAT-00004-v2')) return { body: detail(V2, V1) };
  if (url.startsWith('/api/odd-profiles/ODD-FEAT-00004-v1')) return { body: detail(V1, null) };
  if (url.startsWith('/api/odd-profiles')) return { body: { items: profiles.map(listItem), summary } };
  return undefined;
};

describe('ODD 프로파일 /config/odd', () => {
  it('핵심 메시지 — 승인 상한을 넘는 배포 설정 3건, 판단 불가 1건 별도', async () => {
    handler = oddHandler();
    mount('quality', '/config/odd', <OddProfilesScreen />);
    await waitFor(() => expect(keyText()).toContain('승인 상한을 넘는 배포 설정 3건 — 판단 불가 1건 별도'));
    expect(document.querySelectorAll('[data-key-message]')).toHaveLength(1);
  });

  it("'모두 상한 안'은 판단 불가 0건일 때만 — 판단 불가가 있으면 그 수를 값으로", async () => {
    handler = oddHandler({ exceeds: 0, undecidable: 1, within: 7, total: 8 });
    mount('quality', '/config/odd', <OddProfilesScreen />);
    await waitFor(() => expect(keyText()).toContain('판단 불가 1건'));
    expect(keyText()).not.toContain('모두 상한 안');
    cleanup();
    handler = oddHandler({ exceeds: 0, undecidable: 0, within: 8, total: 8 });
    mount('quality', '/config/odd', <OddProfilesScreen />);
    await waitFor(() => expect(keyText()).toContain('모두 상한 안'));
  });

  it('첫 진입은 오류가 남은 초안 — 배제 맨 위·단위 경계 글자·변경 전후, 승인 막힘 사유(BlockedAction)', async () => {
    handler = oddHandler();
    mount('quality', '/config/odd', <OddProfilesScreen />);
    const table = await screen.findByRole('table', { name: '축별 조건 — 배제 맨 위' });
    const first = within(table).getAllByRole('row')[1];
    expect(first.querySelector('[data-exclusion]')?.textContent).toBe('배제');
    expect(within(table).getByText('40 m/s 이하(포함)')).toBeTruthy();
    expect(screen.getByText('80 km/h 이하(포함)')).toBeTruthy(); // 변경 전(v1)
    const blocked = document.querySelector('[data-blocked-action]')!;
    expect(blocked.textContent).toContain('프로파일 승인');
    expect(blocked.textContent).toContain('의미 검증 오류 2건(속도 단위 혼용 km/h·m/s, 승인 상한 초과)이 남아 승인할 수 없습니다 — 초안에서 고친 뒤 다시 검증하세요.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it("'적용 장소' 탭 — 승인됨·승인 대기·노출 보류를 탭 머리 SummaryLine으로, 사유는 행 글자", async () => {
    handler = oddHandler();
    mount('quality', '/config/odd?profile=ODD-FEAT-00004-v1&detail=sites', <OddProfilesScreen />);
    expect(await screen.findByText('노출 보류 — 지도 버전 2.3이 승인 상한 밖')).toBeTruthy();
    const summary = screen.getByRole('group', { name: '적용 장소 상태' });
    expect(summary.textContent).toContain('승인됨');
    expect(summary.textContent).toContain('승인 대기');
    expect(summary.textContent).toContain('노출 보류');
    expect(document.querySelectorAll('[data-key-message]')).toHaveLength(1);
  });

  it('배포 설정 대조 — 단위를 해석하지 못한 값은 판단 불가(상한 안으로 세지 않음)', async () => {
    handler = oddHandler();
    mount('quality', '/config/odd?profile=ODD-FEAT-00004-v1&detail=deploy', <OddProfilesScreen />);
    await screen.findByRole('table', { name: '배포 설정 대조 — 승인 상한 기준' });
    expect(document.querySelector('[data-unknown="UNDECIDABLE"]')?.textContent).toContain('판단 불가');
    expect(screen.getByText('확대 — 승인 상한 초과')).toBeTruthy();
  });

  it('오류 없는 초안 — 작성자는 막힘 사유(FSM 역할), 기능안전 담당은 사유를 적고 승인', async () => {
    const clean = profile({ profileId: 'ODD-FEAT-00004-v2', version: 2, status: 'DRAFT', basedOn: 'ODD-FEAT-00004-v1', approvedBy: null, approvedAt: null, approvalReason: null, conditions: [EXCL, sp('LE', 100, 'km/h')] });
    handler = (url, init) => {
      if (init?.method === 'POST') return { body: detail({ ...clean, status: 'APPROVED' }, V1) };
      if (url.startsWith('/api/odd-profiles/ODD-FEAT-00004-v2')) return { body: detail(clean, V1) };
      return oddHandler(undefined, [V1, clean])(url, init);
    };
    mount('author', '/config/odd', <OddProfilesScreen />);
    expect(await screen.findByText(/프로파일 승인은 기능안전 담당자\(FSM\) 역할이 할 수 있습니다/)).toBeTruthy();
    cleanup();
    mount('quality', '/config/odd', <OddProfilesScreen />);
    fireEvent.change(await screen.findByLabelText('승인 사유'), { target: { value: '시험 결과 검토' } });
    fireEvent.click(screen.getByRole('button', { name: '프로파일 승인' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.url).toBe('/api/odd-profiles/ODD-FEAT-00004-v2/approve'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ reason: '시험 결과 검토' });
  });

  it('직무 분리 — 초안 작성자인 기능안전 담당은 승인 대신 막힘 사유, 승인 기록은 계정 ID가 아니라 이름', async () => {
    const me = DEMO_ACCOUNTS.find((a) => a.key === 'quality')!.id;
    const own = profile({ profileId: 'ODD-FEAT-00004-v2', version: 2, status: 'DRAFT', basedOn: 'ODD-FEAT-00004-v1', createdBy: me, approvedBy: null, approvedAt: null, approvalReason: null, conditions: [EXCL, sp('LE', 100, 'km/h')] });
    handler = (url, init) => (url.startsWith('/api/odd-profiles/ODD-FEAT-00004-v2') ? { body: detail(own, V1) } : oddHandler(undefined, [V1, own])(url, init));
    mount('quality', '/config/odd', <OddProfilesScreen />);
    const blocked = await waitFor(() => {
      const b = document.querySelector('[data-blocked-action]');
      expect(b).toBeTruthy();
      return b!;
    });
    expect(blocked.textContent).toContain(ODD_SELF_APPROVAL);
    expect(screen.queryByLabelText('승인 사유')).toBeNull();
    cleanup();
    handler = oddHandler();
    const { container } = mount('viewer', '/config/odd?profile=ODD-FEAT-00004-v1', <OddProfilesScreen />);
    await screen.findAllByText('요청자');
    expect(container.textContent).not.toMatch(/usr-/);
  });
});

// ── 승인 구성 조합 ──
const NOW = Date.parse('2026-11-06T01:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const SET: ConfigSet = {
  setId: 'CFG-FEAT-00022-01', featureId: 'FEAT-00022', featureVersion: '1.0.0',
  hw: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }, { ecuPno: '95790-NX300', hwRevision: 'Rev.C' }],
  ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.2.1' }, { ecuPno: '95790-NX300', swId: 'SW-CAMERA-FW', version: '8.1.0' }],
  model: { id: 'MDL-GAP-ESTIMATOR', version: '1.4.0' }, calibration: { id: 'CAL-NX4-SDIST', version: '2026.10' }, oddProfileId: 'ODD-FEAT-00022-v1', flagKey: 'care_00022_param',
  securityMin: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }], status: 'APPROVED', approvedBy: 'usr-variant', approvedAt: ago(500),
};
const rep = (vin: string, sdist: string, over: Partial<VehicleConfigReport> = {}): VehicleConfigReport => ({
  vin, reportedAt: ago(1),
  ecus: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B', sw: [{ swId: 'SW-CARE-SDIST-APP', version: sdist }] }, { ecuPno: '95790-NX300', hwRevision: 'Rev.C', sw: [{ swId: 'SW-CAMERA-FW', version: '8.1.0' }] }],
  model: SET.model, calibration: SET.calibration, recovery: null, recoveryCandidate: null, ...over,
});
const REPORTS = [
  rep('ego-01', '1.2.1'),
  rep('KMH-NX4-0001', '1.2.1', { recovery: { targets: ['99211-NX400', '95790-NX300'], recovered: ['99211-NX400'] } }),
  rep('KMH-NX4-0002', '1.2.0', { recoveryCandidate: { swId: 'SW-CARE-SDIST-APP', version: '1.1.9' } }),
  rep('KMH-NX4-0003', '1.2.1', { reportedAt: ago(72) }),
  rep('KMH-NX4-0004', '1.1.9'),
];
const ROWS = REPORTS.map((r) => ({ vin: r.vin, label: r.vin, reportedAt: r.reportedAt, sw: r.ecus.flatMap((e) => e.sw), ...classifyVehicleConfig(SET, r, NOW) }));
const compatHandler: Handler = (url) => {
  if (url.startsWith('/api/config-sets/CFG-FEAT-00022-01/vehicles')) return { body: { set: { ...SET, featureName: '전방 안전거리 3단계' }, items: ROWS, staleAfterMs: 86_400_000, now: new Date(NOW).toISOString() } };
  if (url.startsWith('/api/config-sets'))
    return { body: { items: [{ ...SET, featureName: '전방 안전거리 3단계', counts: { MATCH: 1, MISMATCH: 1, PARTIAL_RECOVERY: 1, BELOW_SECURITY_MIN: 1, UNCONFIRMED: 1 } }], summary: { outside: 3, partial: 1, unconfirmed: 1, match: 1, total: 5, counts: { MATCH: 1, MISMATCH: 1, PARTIAL_RECOVERY: 1, BELOW_SECURITY_MIN: 1, UNCONFIRMED: 1 } }, staleAfterMs: 86_400_000 } };
  return undefined;
};

describe('승인 구성 조합 /config/compat', () => {
  it("핵심 메시지 — 승인 조합 밖 차량 3대(부분 복구 1대 포함), 형상 미확인 1대는 따로", async () => {
    handler = compatHandler;
    mount('viewer', '/config/compat', <CompatSetsScreen />);
    await waitFor(() => expect(keyText()).toContain('승인 조합 밖 차량 3대 — 부분 복구 1대 포함'));
    expect(document.querySelector('[data-unknown="UNCONFIRMED"]')?.textContent).toContain('형상 미확인 1대');
    // 조합 등록은 차량 사양·Variant 담당 — 다른 역할은 막힘 사유 글자
    expect(document.querySelector('[data-blocked-action]')?.textContent).toContain('조합 등록은 차량 사양·Variant 담당자 역할이 할 수 있습니다.');
    expect(await screen.findByRole('table', { name: '승인 조합 — 1행 = 한 조합' })).toBeTruthy();
  });

  it('차량 대조 탭 — 부분 복구는 ECU별 글자, 보안 최소 버전 아래 복구 후보 불가, 형상 미확인은 부합으로 세지 않음', async () => {
    handler = compatHandler;
    mount('viewer', '/config/compat?tab=vehicles', <CompatSetsScreen />);
    expect(await screen.findByText('복구 후보 불가 — 보안 최소 버전 미달(SW-CARE-SDIST-APP 1.1.9 < 1.2.0)')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'ECU별 복구' }).textContent).toContain('미복구');
    const dist = document.querySelector('[data-stage-counts]')!;
    expect(dist.querySelector('[data-segment="MATCH"]')?.getAttribute('data-count')).toBe('1');
    expect(dist.querySelector('[data-segment="UNCONFIRMED"]')?.getAttribute('data-count')).toBe('1');
  });

  it('등록 — 보안 최소 버전보다 낮은 ECU SW면 등록 버튼 대신 막힘 사유', async () => {
    handler = compatHandler;
    mount('steward', '/config/compat', <CompatSetsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '승인 조합 등록' }));
    fireEvent.change(await screen.findByLabelText('SW-CARE-SDIST-APP 버전'), { target: { value: '1.1.0' } });
    expect(await screen.findByText('ECU SW 하나가 보안 최소 버전보다 낮아 이 조합을 등록할 수 없습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '등록' }).getAttribute('aria-disabled')).toBe('true'); // 막힌 행동 — 포커스 순서에 남는 비활성 버튼
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

// ── VIN 지원 판정 ──
const reportFor = (sdist: string, h = 1): VehicleConfigReport => ({ vin: 'V', reportedAt: ago(h), ecus: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B', sw: [{ swId: 'SW-CARE-SDIST-APP', version: sdist }] }], model: null, calibration: null, recovery: null, recoveryCandidate: null });
const elig = (report: VehicleConfigReport | null) => {
  const d = decideEligibility({
    vehicle: { vin: 'KMH-NX4-0004', country: 'KR' }, catalog: { catalogId: 'CAT-00019', country: 'KR', saleType: '체험' },
    legalProfile: { profileId: 'KR', status: 'CONFIRMED' }, productApproval: { approvedBy: 'usr' },
    feature: { featureId: 'FEAT-00022', version: '1.0.0', swId: 'SW-CARE-SDIST-APP', requiredSw: '1.2.1', ecuPnos: ['99211-NX400'] },
    asBuiltEcus: null, report, grants: [], now: NOW,
  });
  return {
    vin: 'KMH-NX4-0004', vehicle: { vin: 'KMH-NX4-0004', label: '구형 SW 차량', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' },
    catalog: { catalogId: 'CAT-00019', name: 'Beginner Care Pass 1회 체험', version: '1.0.0', country: 'KR', saleType: '체험' }, feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계' },
    state: d.state, label: ELIGIBILITY_LABEL[d.state], headline: d.headline, reasons: d.reasons, states: ELIGIBILITY_STATES, otaLinked: false,
    configSet: { setId: 'CFG-FEAT-00022-01', cls: 'BELOW_SECURITY_MIN' }, checkedAt: new Date(NOW).toISOString(), observedAt: report?.reportedAt ?? null, staleAfterMs: 86_400_000,
  };
};
const VEH = { items: [{ vin: 'ego-01', label: 'PoC', quality: 'TRUSTED' }, { vin: 'KMH-NX4-0004', label: '구형 SW 차량', quality: 'TRUSTED' }] };
const PRODUCTS = { items: [{ catalogId: 'CAT-00002', name: 'Highway Driving Package' }, { catalogId: 'CAT-00019', name: 'Beginner Care Pass 1회 체험' }] };
const eligHandler = (report: VehicleConfigReport | null): Handler => (url) => {
  if (url.startsWith('/api/vehicles/KMH-NX4-0004/eligibility')) return { body: elig(report) };
  if (url.startsWith('/api/vehicles')) return { body: VEH };
  if (url.startsWith('/api/products')) return { body: PRODUCTS };
  if (url.startsWith('/api/policies')) return { body: { items: [{ flagKey: 'care_00022_param', status: 'DEPLOYED' }] } };
  return undefined;
};

describe('VIN 지원 판정 /activation/decide', () => {
  it("첫 화면은 VIN 지원 판정 — '차량 확인 필요 — SW 1.2.1 필요, 설치 기록 연동 전이라 미확인', 사유 4칸 표, 결제 직전 재확인", async () => {
    handler = eligHandler(reportFor('1.1.9'));
    mount('viewer', '/activation/decide', <ActivationScreen />);
    await waitFor(() => expect(keyText()).toContain('차량 확인 필요 — SW 1.2.1 필요, 설치 기록 연동 전이라 미확인'));
    expect(calls.some((c) => c.url === '/api/vehicles/KMH-NX4-0004/eligibility?catalogId=CAT-00019')).toBe(true);
    expect(calls.some((c) => c.url.startsWith('/api/activation/decide'))).toBe(false);
    const table = screen.getByRole('table', { name: '판정 사유' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent?.slice(0, 4))).toEqual(['시장 승인', 'SW미확인', 'HW충족', '권리충족'].map((x) => x.slice(0, 4)));
    expect(rows[1].querySelector('[data-unknown="UNCONFIRMED"]')).toBeTruthy();
    expect(rows[1].textContent).toContain('SW 1.2.1 필요(현재 1.1.9) — 설치 기록 연동 전');
    // 4상태 목록 — '업데이트 후 가능'은 설치 기록 연동 뒤 판정(회색 글자)
    expect(document.querySelector('[data-state="UPDATE_REQUIRED"]')?.textContent).toContain('설치 기록 연동 뒤 판정');
    expect(document.querySelector('[data-state="VEHICLE_CHECK"]')?.getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('[data-recheck]')?.textContent).toBe('결제 직전 다시 확인합니다 — 그때 판정이 바뀌면 주문을 받지 않습니다');
    expect(screen.getByRole('tab', { name: '정책 평가' })).toBeTruthy();
    expect(screen.queryByText('ON')).toBeNull();
  });

  it("형상 보고가 오래되면 '차량 확인 필요 — 미확인(형상 보고 3일 전)', 보고가 없으면 판단 불가 — 구매 가능으로 표시하지 않음", async () => {
    handler = eligHandler(reportFor('1.2.1', 72));
    mount('viewer', '/activation/decide', <ActivationScreen />);
    await waitFor(() => expect(keyText()).toContain('차량 확인 필요 — 미확인(형상 보고 3일 전)'));
    expect(keyText()).not.toContain('바로 구매 가능');
    cleanup();
    handler = eligHandler(null);
    mount('viewer', '/activation/decide', <ActivationScreen />);
    await waitFor(() => expect(keyText()).toContain('차량 확인 필요 — 판단 불가(출고 구성 기록 없음)'));
  });

  it("'정책 평가' 탭 — flagKey만 준 주소(정책 상세 링크)는 정책 평가로 연다", async () => {
    handler = (url) => {
      if (url.startsWith('/api/activation/decide')) return { body: { vehicle: VEH.items[0], entitlement: { active: true }, result: { flagKey: 'care_00022_param', value: true, variant: 'on', decision: 'ALLOW', reason: 'POLICY_MATCH', policyId: 'POL-00002', revision: 1, trace: [] } } };
      return eligHandler(null)(url);
    };
    mount('viewer', '/activation/decide?flagKey=care_00022_param', <ActivationScreen />);
    await waitFor(() => expect(keyText()).toContain('정책 ON(의도) — 차량 실행은 차량이 판단'));
    expect(screen.getByRole('tab', { name: '정책 평가' }).getAttribute('aria-selected')).toBe('true');
  });
});
