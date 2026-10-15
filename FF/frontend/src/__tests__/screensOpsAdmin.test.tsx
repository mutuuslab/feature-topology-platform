// 운영·관리 v2 화면 (P10-C4) — 운영 데이터·이벤트, 협력사 이관, 보안·인증서, 설정, 컴플라이언스, SW EO. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { STANDARDS_MAP } from '@ff/contracts';
import { AppProvider } from '../store';
import { ComplianceScreen, EoScreen, SecurityScreen, SettingsScreen, SupplierScreen, TelemetryScreen } from '../screens/master/Ops';
import { SafetyKpiScreen } from '../screens/ops/SafetyKpi';

type Handler = (url: string) => { status?: number; body?: unknown } | undefined;
let handler: Handler;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const r = handler(url) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (path: string, el: JSX.Element) => {
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AppProvider>
          <Routes>
            <Route path={path} element={el} />
          </Routes>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('운영·관리 v2', () => {
  it('운영 데이터 — 회신 표, 상태 보고 탭(위반은 FAIL과 코드), 차량 요청 탭', async () => {
    handler = (url) => {
      if (url.startsWith('/api/telemetry/readbacks')) return { body: { items: [{ vin: 'ego-01', publicationId: 'PUB-00001', metricType: 'READBACK', observed: 'sha256:abc', at: '2026-10-12T01:00:00.000Z' }] } };
      if (url.startsWith('/api/vehicles/ego-01/status')) return { body: { vin: 'ego-01', features: [], recent: [{ featureId: 'FEAT-00022', state: 'ACTIVE', reportSeq: 3, accepted: false, violation: { code: 'SEQ_REPLAY', message: '재전송' }, at: '2026-10-12T01:00:00.000Z' }] } };
      if (url.startsWith('/api/vehicles/ego-01/requests')) return { body: { items: [{ requestId: 'VR-1', at: '2026-10-12T01:00:00.000Z', channel: 'REPORT', type: 'OVERRIDE', outcome: 'REJECTED', reason: 'VEHICLE_OVERRIDE_FORBIDDEN', summary: 's' }] } };
      if (url.startsWith('/api/vehicles')) return { body: { items: [{ vin: 'ego-01', label: 'x' }] } };
    };
    mount('/ops/telemetry', <TelemetryScreen />);
    expect(await screen.findByRole('link', { name: 'PUB-00001' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '상태 보고 v2' }));
    expect(await screen.findByText('SEQ_REPLAY')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '차량 요청' }));
    expect(await screen.findByText('VEHICLE_OVERRIDE_FORBIDDEN')).toBeTruthy();
  });

  it('협력사 이관 — 공급사별 납품과 쓰는 Feature', async () => {
    handler = (url) =>
      url.startsWith('/api/integrations/supplier')
        ? { body: { items: [{ swId: 'SW-A', version: '1.0.0', supplier: 'Alpha', artifactId: 'ART-A', checksum: 'sha256:1', ecuPno: 'E1', lifecycle: 'RELEASED' }, { swId: 'SW-B', version: '2.0.0', supplier: 'Beta', artifactId: 'ART-B', checksum: 'sha256:2', ecuPno: 'E2', lifecycle: 'RELEASED' }] } }
        : { body: { items: [{ swId: 'SW-A', version: '1.0.0', features: ['FEAT-00022@1.0.0'] }] } };
    mount('/supplier/portal', <SupplierScreen />);
    const row = (await screen.findByText('SW-A')).closest('tr')!;
    expect(within(row).getByRole('link').getAttribute('href')).toBe('/features/FEAT-00022/1.0.0');
    expect(screen.queryByText('SW-B')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: '공급사' }), { target: { value: 'Beta' } });
    expect(await screen.findByText('SW-B')).toBeTruthy();
  });

  it('보안·인증서 — 키·HSM, SBOM 목록(원산지 발견)·VEX 판정 이력 (D06-11 · FFG-SBOM-002·SEC-006)', async () => {
    const SBOM = { items: [{ serial: 'urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', publicationId: 'PUB-00004', featureId: 'FEAT-00022', featureVersion: '1.0.0', components: 3, originFindings: ['SW-CARE-SDIST-APP@1.2.1(FF): country 없음'] }] };
    const VEX = { items: [{ statement: { vulnId: 'CVE-2026-0001', affects: ['SW-CARE-SDIST-APP@1.2.1'], state: 'affected' }, impact: { action: 'SECURITY_KILL_OR_UPDATE', features: [{ featureId: 'FEAT-00022', featureVersion: '1.0.0', killPath: false }] }, at: 'x' }] };
    const SEC = { items: [{ at: '2026-10-16T01:00:00.000Z', eventId: 'AUTH_FAILURE', code: 'STATE_AUTH_MISMATCH', vehicle: 'vp-7f3a' }], definitions: [{ id: 'AUTH_FAILURE', label: '인증 실패', codes: ['STATE_AUTH_MISMATCH'], threshold: { count: 3, windowMs: 600000, perVehicle: true }, response: 'VSOC 경보', limitChannel: true }] };
    const CDX = { serialNumber: SBOM.items[0].serial, metadata: { timestamp: '2026-10-16T01:00:00.000Z', component: { name: 'PUB-00004', version: '1' } }, components: [{ 'bom-ref': 'SW-CARE-SDIST-APP@1.2.1', type: 'application', name: 'SW-CARE-SDIST-APP', version: '1.2.1', purl: 'pkg:generic/sw-care@1.2.1', properties: [{ name: 'origin:vcs', value: 'git' }] }] };
    handler = (url) => (url.startsWith('/api/sbom/') ? { body: CDX } : url.startsWith('/api/security-events') ? { body: SEC } : url.startsWith('/api/sbom') ? { body: SBOM } : url.startsWith('/api/vex') ? { body: VEX } : url.startsWith('/api/pki/keys') ? { body: { items: [{ keyId: 'KEY-0001', alg: 'Ed25519', purpose: 'policy', epoch: 1, status: 'ACTIVE', createdAt: 'x', notAfter: 'y', fingerprint: 'sha256:f0' }] } } : { body: { epoch: 1, approverKeys: 3 } });
    mount('/admin/security', <SecurityScreen />);
    expect(await screen.findByText('KEY-0001')).toBeTruthy();
    expect(await screen.findByText('approverKeys')).toBeTruthy();
    // 보안 이벤트(IdsM) 정의·기록, 차량 키 epoch 상향은 CSM·FSM만 (운영자 불가)
    expect(await screen.findByText('STATE_AUTH_MISMATCH')).toBeTruthy();
    expect(screen.getByText('10분에 3회 (차량별)')).toBeTruthy();
    expect((screen.getByRole('button', { name: '차량 키 epoch 상향' }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByTestId('origin-urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).textContent).toBe('1건 누락');
    expect(await screen.findByText('CVE-2026-0001')).toBeTruthy();
    expect(screen.getByText('보안 차단 또는 업데이트 결정')).toBeTruthy();
    // 운영자는 VEX를 기록하지 못한다(CSM·FSM)
    expect((screen.getByRole('button', { name: 'VEX 기록' }) as HTMLButtonElement).disabled).toBe(true);
    // SBOM 행을 열면 CycloneDX 본문(구성 요소·원산지 속성)
    fireEvent.click(screen.getByTestId('origin-urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').closest('tr')!);
    const body = await screen.findByTestId('sbom-detail');
    expect(within(body).getByText('pkg:generic/sw-care@1.2.1')).toBeTruthy();
    expect(within(body).getByText('origin:vcs=git')).toBeTruthy();
  });

  it('운행 중 감시 지표 — Version별 지표·경보, 예시값 기준 표시, 부속서 1 (D04-03 · FFG-TEL-009)', async () => {
    const H = 3_600_000;
    const defs = [
      { id: 'KILL_LATENCY_P95', definition: '명령 발행부터 DISABLED·DURABLE 보고까지', type: 'ROUTINE', unit: 'ms', alert: { op: 'ABOVE', example: 24 * H, text: '' } },
      { id: 'STATE_PROOF_FAILURE', definition: 'state_auth·report_seq 검사 실패 건수', type: 'EXCEEDANCE', unit: 'count', alert: { op: 'AT_LEAST', example: 1, text: '' } },
    ];
    const plan = { source: 'EXAMPLE', thresholds: { KILL_LATENCY_P95: 24 * H, STATE_PROOF_FAILURE: 1 }, recordedBy: null, recordedAt: null };
    const OV = {
      definitions: defs,
      coverage: { missing: [], exampleOnly: [{ featureId: 'FEAT-00022', version: '1.0.0' }] },
      alerts: 1,
      items: [{ featureId: 'FEAT-00022', version: '1.0.0', ads: false, plan, metrics: [{ id: 'KILL_LATENCY_P95', value: 8000, previous: null, threshold: 24 * H, alert: false }, { id: 'STATE_PROOF_FAILURE', value: 1, previous: null, threshold: 1, alert: true }] }],
    };
    handler = (url) => (url.includes('/annex1') ? { body: { applicable: false, from: '', to: '', lines: [], missing: [] } } : url.startsWith('/api/safety-kpi') ? { body: OV } : undefined);
    mount('/ops/safety-kpi', <SafetyKpiScreen />);
    expect(await screen.findByText('FEAT-00022')).toBeTruthy();
    expect(screen.getByText('8.0s')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy(); // Safety Case 기준 기록 0/1 — 예시값 사용
    expect(screen.getByText('예시값')).toBeTruthy();
    fireEvent.click(screen.getByText('FEAT-00022'));
    expect(await screen.findByText('ADS 기능이 아니어서 부속서 1 집계 대상이 아닙니다.')).toBeTruthy();
    expect(screen.getByText(/경보 기준 ≥ 1 \(예시값\)/)).toBeTruthy();
    // 현재 기준으로 채워 두고, 운영자는 값을 바꿔도 기록하지 못한다(FSM)
    const input = screen.getByLabelText('상태 증명 실패 (대·건)') as HTMLInputElement;
    expect(input.value).toBe('1');
    fireEvent.change(input, { target: { value: '5' } });
    expect((screen.getByRole('button', { name: '기준 기록' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('설정 — 상태·건수·연계 방식', async () => {
    handler = (url) => (url.startsWith('/api/health') ? { body: { status: 'ok', seed: 'v0.81', counts: { features: 80 } } } : { body: { items: [{ ifId: 'IF-01', name: 'ALM', mode: 'mock' }] } });
    mount('/admin/settings', <SettingsScreen />);
    expect(await screen.findByText('v0.81')).toBeTruthy();
    expect(await screen.findByText('모의')).toBeTruthy();
  });

  it('컴플라이언스 — 규칙 표 전체 수와 미구현 거르기', async () => {
    handler = () => undefined;
    mount('/verify/compliance', <ComplianceScreen />);
    const total = Object.keys(STANDARDS_MAP).length;
    expect(screen.getAllByRole('row')).toHaveLength(total + 1);
    fireEvent.click(screen.getByRole('radio', { name: '미구현' }));
    expect(screen.getAllByRole('row').length).toBeLessThan(total + 1);
  });

  it('컴플라이언스 시장 Profile — Profile 표와 게이트 사전 판정: 검증 필요 시장의 F2 활성화는 FAIL, 비활성화는 허용 (FFG-GEN-003)', async () => {
    handler = () => undefined;
    mount('/verify/compliance', <ComplianceScreen />);
    fireEvent.click(screen.getByRole('tab', { name: '시장 Profile' }));
    expect(await screen.findByText('NA-CA 1.0.0')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('시장'), { target: { value: 'CA' } });
    const verdict = () => screen.getByTestId('cp-verdict').textContent ?? '';
    expect(verdict()).toMatch(/NA-CA 검증 필요 — F2 이상 활성화·복원 차단/);
    fireEvent.change(screen.getByLabelText('요청'), { target: { value: 'deactivate' } });
    expect(verdict()).toMatch(/비활성화는 막지 않는다/);
  });

  it('SW EO — Version 여러 개인 SW만, 이력 순서', async () => {
    handler = () => ({ body: { items: [{ swId: 'SW-A', version: '1.10.0', name: 'a', ecuPno: 'E1', lifecycle: 'RELEASED', features: [] }, { swId: 'SW-A', version: '1.9.0', name: 'a', ecuPno: 'E1', lifecycle: 'RETIRED', features: [] }, { swId: 'SW-B', version: '1.0.0', name: 'b', ecuPno: 'E2', lifecycle: 'RELEASED', features: [] }] } });
    mount('/change/eo', <EoScreen />);
    expect(await screen.findByText('1.9.0(RETIRED) → 1.10.0(RELEASED)')).toBeTruthy();
    expect(screen.queryByText('SW-B')).toBeNull();
  });
});
