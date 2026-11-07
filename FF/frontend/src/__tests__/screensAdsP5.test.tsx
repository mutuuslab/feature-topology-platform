// ADS 구성 마감 화면(P5) — 정책 컴파일 검사·적용 장소 추가(/config/odd), 발행 후보·복구 결정(/config/compat), 출고 실물 구성 대조(/baselines/eol),
// OTA 설치 단계(/ops/ota-installs), 전송 캠페인(/deployments/campaigns/:id), 분류 입력·지원 종료 연습(Feature 상세 패널). 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from '../store';
import OddProfilesScreen from '../screens/ads/OddProfiles';
import CompatSetsScreen from '../screens/ads/CompatSets';
import EolChecksScreen from '../screens/bom/EolChecks';
import OtaInstallsScreen from '../screens/ads/OtaInstalls';
import CampaignScreen from '../screens/ads/Campaign';
import { AdsClassificationPanel } from '../screens/ads/AdsClassification';

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

const mount = (role: string, path: string, route: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={route} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const keyText = () => document.querySelector('[data-key-message]')?.textContent ?? '';

const PROFILE = {
  profileId: 'ODD-FEAT-00004-v1', featureId: 'FEAT-00004', featureVersion: '4.1.0', version: 1, status: 'APPROVED', basedOn: null,
  conditions: [], envelope: [], mapVersions: ['2.2'], infraVersions: ['IF-1.5'], sites: [], createdBy: 'usr-author', createdAt: '2026-10-01T00:00:00Z', approvedBy: 'usr-safety', approvedAt: '2026-10-05T00:00:00Z', approvalReason: '승인',
};

describe('ODD 프로파일 — 정책 컴파일 검사·적용 장소 추가', () => {
  beforeEach(() => {
    handler = (url) => {
      if (url.includes('/api/odd-profiles/ODD-FEAT-00004-v1')) {
        return {
          body: {
            profile: PROFILE, feature: null, issues: [], blockedReason: null, deploy: [], deployCounts: { WITHIN: 0, EXCEEDS: 0, UNDECIDABLE: 0 }, flagKeys: [], policies: [], configSets: [], base: null, diff: [],
            sites: [{ siteId: 'SITE-1001', name: '판교 시범 구역', kind: 'ZONE', mapVersion: '2.2', infraVersion: 'IF-1.5', impactConfirmed: false, status: 'PENDING', reason: '승인 대기 — 변경 영향(인증·안전 판단) 참조 없음', code: 'IMPACT_REVIEW_OPEN', requested: true }],
            compile: [
              { flagKey: 'hda2_00004_speed', against: 'ODD-FEAT-00004-v1', blockers: [{ code: 'ODD_ENVELOPE_EXCEEDED', message: '최고 속도 140 km/h 이하(포함) — 상한 130 km/h 이하(포함) 밖', ref: 'DS-0001' }] },
              { flagKey: 'hda2_00004_lane', against: 'ODD-FEAT-00004-v1', blockers: [] },
            ],
            logs: { oddRef: 'ODD-FEAT-00004-v1', ALLOW: 3, DENY: 1, UNKNOWN: 0, total: 4 },
          },
        };
      }
      if (url.includes('/api/odd-profiles')) return { body: { items: [{ profileId: 'ODD-FEAT-00004-v1', featureId: 'FEAT-00004', featureVersion: '4.1.0', featureName: '고속도로 주행 보조 2', version: 1, status: 'APPROVED', issues: 0, deploy: { WITHIN: 1, EXCEEDS: 1, UNDECIDABLE: 0 }, sites: { APPROVED: 0, PENDING: 1, EXPOSURE_HOLD: 0 } }], summary: { exceeds: 1, undecidable: 0, within: 1, total: 2 } } };
      return undefined;
    };
  });

  it('컴파일 탭 — 빌드 거부 Flag와 설정 ID·사유, 통과 Flag는 빌드 가능, 프로파일별 판정 로그', async () => {
    mount('quality', '/config/odd?profile=ODD-FEAT-00004-v1&detail=compile', '/config/odd', <OddProfilesScreen />);
    await waitFor(() => expect(document.querySelector('[data-odd-compile]')).toBeTruthy());
    expect(document.querySelector('[data-compile-blocked="hda2_00004_speed"]')?.textContent).toContain('DS-0001');
    expect(screen.getByText('빌드 가능 — 승인 상한 안')).toBeTruthy();
    expect(document.querySelector('[data-odd-logs]')?.textContent).toContain('허용 3 · 거부 1');
  });

  it('적용 장소 탭 — 승인 대기 장소는 기능안전 담당이 사유를 적어 승인 요청, 작성자는 승인 대신 막힘 사유', async () => {
    mount('quality', '/config/odd?profile=ODD-FEAT-00004-v1&detail=sites', '/config/odd', <OddProfilesScreen />);
    const input = await screen.findByLabelText('승인 사유');
    fireEvent.change(input, { target: { value: '영향 확정 확인' } });
    fireEvent.click(screen.getByRole('button', { name: '장소 승인' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/sites/SITE-1001/approve'))).toBe(true));
  });
});

describe('승인 구성 조합 — 발행 후보·복구 결정', () => {
  beforeEach(() => {
    handler = (url) => {
      if (url.includes('/publish-preview')) return { body: { policyId: 'POL-00002', featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_param', scope: 6, enforced: false, targets: ['a', 'b', 'c', 'd', 'e', 'f'], excluded: [{ vin: 'KMH-NX4-0001', code: 'RECOVERY_PARTIAL', reason: '99211-NX400 복구됨 · 95790-NX300 미복구' }], blockers: [], warnings: [] } };
      if (url.includes('/api/policies')) return { body: { items: [{ policyId: 'POL-00002', status: 'DEPLOYED', featureId: 'FEAT-00022', featureVersion: '1.0.0' }] } };
      if (url.includes('/recovery-decisions')) return { body: { items: [{ decisionId: 'RCV-00001', vin: 'KMH-NX4-0004', path: 'SAFE_STATE', decidedBy: 'usr-safety', rationale: '복구 후보 보안 최소 버전 미달', configSetRef: 'CFG-FEAT-00022-01', decidedAt: '2026-11-06T00:00:00Z', verdict: { cls: 'BELOW_SECURITY_MIN', code: 'SECURITY_MIN_VIOLATION', reasons: [] }, reactivation: { eligible: false, reason: '조건 부족 — 승인 조합 밖(복구 뒤 재검증)' } }] } };
      if (url.includes('/api/config-sets')) return { body: { items: [{ setId: 'CFG-FEAT-00022-01', featureId: 'FEAT-00022', featureVersion: '1.0.0', hw: [], ecuSw: [], model: null, calibration: null, oddProfileId: null, flagKey: null, securityMin: [], status: 'APPROVED', approvedBy: 'v', approvedAt: '2026-10-01T00:00:00Z', featureName: 'SCC', counts: { MATCH: 2, MISMATCH: 1, PARTIAL_RECOVERY: 1, BELOW_SECURITY_MIN: 1, UNCONFIRMED: 1 } }], summary: { outside: 3, partial: 1, unconfirmed: 1, match: 2, total: 6, counts: { MATCH: 2, MISMATCH: 1, PARTIAL_RECOVERY: 1, BELOW_SECURITY_MIN: 1, UNCONFIRMED: 1 } }, staleAfterMs: 86400000, unverified: { count: 2, items: [{ featureId: 'FEAT-00024', version: '1.0.0', name: 'x', fClass: 'F1' }] }, decisions: 1 } };
      return undefined;
    };
  });

  it('발행 후보 탭 — ADAS는 대상 유지·사유만, 조합 미검증 Feature 수', async () => {
    mount('steward', '/config/compat?tab=publish', '/config/compat', <CompatSetsScreen />);
    await waitFor(() => expect(document.querySelector('[data-publish-preview="POL-00002"]')).toBeTruthy());
    expect(document.querySelector('[data-publish-preview="POL-00002"]')?.textContent).toContain('KMH-NX4-0001 — 부분 복구');
    expect(screen.getByText(/ADAS — 대상 유지, 사유만 기록/)).toBeTruthy();
    expect(document.body.textContent).toContain('조합 미검증 Feature 2건');
  });

  it('복구 결정 탭 — 결정 기록과 재활성화 후보 사유, 권한 없으면 막힘 사유', async () => {
    mount('steward', '/config/compat?tab=recovery', '/config/compat', <CompatSetsScreen />);
    await screen.findByText('복구 후보 보안 최소 버전 미달');
    expect(screen.getByText('조건 부족 — 승인 조합 밖(복구 뒤 재검증)')).toBeTruthy();
    expect(screen.getByText('복구 결정은 운영 리더·기능안전 담당자 역할이 할 수 있습니다.')).toBeTruthy();
  });
});

describe('출고 실물 구성 대조 /baselines/eol', () => {
  it('핵심 메시지 품질 보류 N대, 실물 미확인 별도, 해제는 불일치가 남으면 막힘 사유', async () => {
    handler = (url) => {
      if (url.includes('/api/plants/eol/vehicles/KMH-NX4-0001'))
        return { body: { vin: 'KMH-NX4-0001', label: 'NX4', plant: 'HMMC 체코 공장', scannedAt: '2026-11-03T00:00:00Z', verdict: 'MISMATCH', verdictLabel: '불일치', reason: '불일치 부품 1개', parts: [{ ecuPno: '95790-NX300', ordered: 'Rev.C', built: 'Rev.B', kind: 'REVISION' }], orderEcus: [], builtEcus: [], status: 'QUALITY_HOLD', statusLabel: '품질 보류', checks: [], acceptance: { items: [{ featureId: 'FEAT-00022', name: 'SCC', group: 'DRIVING', state: 'POST_DELIVERY' }], summary: { accepted: 0, total: 1, postDelivery: 1, unconfirmed: 0 } } } };
      if (url.includes('/api/plants/eol/mismatches'))
        return { body: { items: [{ vin: 'KMH-NX4-0001', label: 'NX4', plant: 'HMMC 체코 공장', scannedAt: '2026-11-03T00:00:00Z', verdict: 'MISMATCH', verdictLabel: '불일치', reason: '불일치 부품 1개', parts: [], orderEcus: [{ ecuPno: '95790-NX300', hwRevision: 'Rev.C' }], builtEcus: [{ ecuPno: '95790-NX300', hwRevision: 'Rev.B' }], status: 'QUALITY_HOLD', statusLabel: '품질 보류' }], summary: { total: 1, hold: 3, unconfirmed: 1, match: 0, shippedWithMismatch: 0 }, ledger: '공장 품질 시스템' } };
      return undefined;
    };
    mount('steward', '/baselines/eol?vin=KMH-NX4-0001', '/baselines/eol', <EolChecksScreen />);
    await waitFor(() => expect(keyText()).toContain('품질 보류 차량 3대 — 주문 사양과 실물 구성 불일치'));
    expect(document.body.textContent).toContain('실물 미확인 1대');
    expect(document.body.textContent).toContain('실물 구성 원장: 공장 품질 시스템');
    await waitFor(() => expect(document.querySelector('[data-eol-acceptance]')?.textContent).toContain('인도 후 확인 대기'));
    fireEvent.change(screen.getByLabelText('결정'), { target: { value: 'RELEASE' } });
    expect(await screen.findByText('불일치 부품 1개가 남아 있습니다 — 공장 품질 시스템에서 해소한 뒤 다시 대조하세요.')).toBeTruthy();
  });
});

describe('OTA 설치 단계 /ops/ota-installs', () => {
  it('5단계 띠·갈림 상태 줄·실패 원인 세 칸, 운행 제한은 예상 글자', async () => {
    handler = (url) => {
      if (url.includes('/api/vehicles/ego-01/installs'))
        return { body: { vin: 'ego-01', view: { step: 3, of: 5, stage: 'DEFERRED', label: '설치 준비', branch: { kind: 'DEFERRED', text: '설치 보류 — 전원 부족(차량 보고)' }, restriction: '약 25분 운행 제한(예상)', customerNotice: '설치 중 운행 제한 약 25분(예상)', confirmed: false, stale: false, lastAt: '2026-11-06T00:50:00Z', failureKind: null, safeState: null }, axis: 'NOT_INSTALLED', manifest: { confirmed: false, partial: false, missing: [] }, reactivation: null, history: [], source: 'SIMULATED' } };
      if (url.includes('/api/ota/installs'))
        return { body: { items: [{ vin: 'ego-01', label: 'ego', stage: 'DEFERRED', label2: '설치 준비', step: 3, branch: { kind: 'DEFERRED', text: '설치 보류 — 전원 부족(차량 보고)' }, confirmed: false, stale: false, lastAt: '2026-11-06T00:50:00Z', axis: 'NOT_INSTALLED', failureKind: null, restriction: null, reactivation: null }], failures: { POWER: 1, LINK: 2, VERIFY: 1 }, summary: { vehicles: 1, confirmed: 1, partialFailure: 1, recoveryNeeded: 1, stale: 0 } } };
      return undefined;
    };
    mount('operator', '/ops/ota-installs?vin=ego-01', '/ops/ota-installs', <OtaInstallsScreen />);
    await waitFor(() => expect(keyText()).toContain('설치 확인 1대 — 실패·복구 필요 2대'));
    expect(document.querySelector('[data-install-failures]')?.textContent).toContain('전원 1 · 통신 2 · 검증 1');
    await waitFor(() => expect(document.querySelector('[data-install-strip]')).toBeTruthy());
    expect(document.querySelector('[data-install-strip] [aria-current="step"]')?.textContent).toContain('3/5');
    expect(document.querySelector('[data-install-branch="DEFERRED"]')?.textContent).toContain('설치 보류 — 전원 부족(차량 보고)');
    expect(document.body.textContent).toContain('설치 중 운행 제한 약 25분(예상)');
    expect(document.body.textContent).not.toMatch(/운행 가능/);
  });
});

describe('전송 캠페인 /deployments/campaigns/:id', () => {
  it('캠페인으로 게시본·정책 릴리스를 찾는다', async () => {
    handler = (url) => (url.includes('/api/campaigns/CMP-00002') ? { body: { campaignId: 'CMP-00002', publications: [{ publicationId: 'PUB-00002', kind: 'POLICY', status: 'DISPATCHED', featureId: 'FEAT-00022', featureVersion: '1.0.0', flagKey: 'care_00022_param', targets: 6, bundleDigest: 'sha256:' + 'a'.repeat(64) }], policies: [{ policyId: 'POL-00002', flagKey: 'care_00022_param', featureId: 'FEAT-00022', featureVersion: '1.0.0', status: 'DEPLOYED' }] } } : undefined);
    mount('operator', '/deployments/campaigns/CMP-00002', '/deployments/campaigns/:id', <CampaignScreen />);
    await waitFor(() => expect(keyText()).toContain('게시본 1건 · 정책 릴리스 1건'));
    expect(screen.getByRole('link', { name: 'POL-00002' })).toBeTruthy();
  });
});

describe('Feature 분류 패널 — 입력·확정·지원 종료 연습', () => {
  it('거부 규칙 켜짐 문구, 확정 전 분류는 기능안전 담당이 확정, 최근 연습 네 칸', async () => {
    handler = (url) => {
      if (url.includes('/support-drills')) return { body: { items: [{ drillId: 'DRL-00001', runBy: 'system', runAt: '2026-11-06T00:00:00Z', passed: false, horizonDays: 90, checks: [{ id: 'BASELINE_KEPT', label: '기준선 유지', result: 'FAIL', basis: '검증 기준선 보유 2/6대' }, { id: 'BLOCK_KEPT', label: '차단 유지', result: 'PASS', basis: '진행 중 차단 없음' }, { id: 'KEY_RENEWAL', label: '키 갱신 유지', result: 'PASS', basis: 'policy 2027-06-01' }, { id: 'NO_UNAPPROVED_ON', label: '미승인 ON 없음', result: 'PASS', basis: '미승인 ON 0대' }] }] } };
      if (url.includes('/classification'))
        return { body: { featureId: 'FEAT-00019', version: '2.0.0', lifecycle: 'PROPOSED', classification: { featureId: 'FEAT-00019', version: '2.0.0', adsFeature: false, ddtImpact: 'PARTIAL', safetyRelated: true, owner: 'VD팀', source: 'MANUAL', status: 'DRAFT', confirmedBy: null, confirmedAt: null, lifecycleOwners: { CREATE: 'a', OPERATE: 'b', SUSPEND: 'c', DISPOSE: 'd' } }, completeness: { classified: false, gaps: ['CONFIRM'], inferred: false }, baselines: [], safetyProfileStatus: null, ruleEnabled: true, ownerHistory: [{ state: 'CREATE', ownerId: 'a', assignedAt: '2026-11-06T00:00:00Z', assignedBy: 'usr-author' }] } };
      return undefined;
    };
    mount('quality', '/f', '/f', <AdsClassificationPanel id="FEAT-00019" ver="2.0.0" lifecycle="PROPOSED" />);
    expect(await screen.findByText(/출시 전이 거부 규칙이 켜져 있습니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('확정 사유'), { target: { value: '4축 확인' } });
    fireEvent.click(screen.getByRole('button', { name: '분류 확정' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/classification/confirm'))).toBe(true));
    await waitFor(() => expect(document.querySelectorAll('[data-drill-check]').length).toBe(4));
    expect(screen.getByText('연습 실패 1칸')).toBeTruthy();
  });
});
