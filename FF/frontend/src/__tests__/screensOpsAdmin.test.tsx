// 운영·관리 v2 화면 (P10-C4) — 운영 데이터·이벤트, 협력사 이관, 보안·인증서, 설정, 컴플라이언스, SW EO. 모의 API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { STANDARDS_MAP } from '@ff/contracts';
import { AppProvider } from '../store';
import { ComplianceScreen, EoScreen, SecurityScreen, SettingsScreen, SupplierScreen, TelemetryScreen } from '../screens/master/Ops';

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
    handler = (url) => (url.startsWith('/api/sbom') ? { body: SBOM } : url.startsWith('/api/vex') ? { body: VEX } : url.startsWith('/api/pki/keys') ? { body: { items: [{ keyId: 'KEY-0001', alg: 'Ed25519', purpose: 'policy', epoch: 1, status: 'ACTIVE', createdAt: 'x', notAfter: 'y', fingerprint: 'sha256:f0' }] } } : { body: { epoch: 1, approverKeys: 3 } });
    mount('/admin/security', <SecurityScreen />);
    expect(await screen.findByText('KEY-0001')).toBeTruthy();
    expect(await screen.findByText('approverKeys')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'WP8' }).getAttribute('href')).toBe('/arch/components?wp=WP8');
    expect((await screen.findByTestId('origin-urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).textContent).toBe('1건 누락');
    expect(await screen.findByText('CVE-2026-0001')).toBeTruthy();
    expect(screen.getByText('보안 차단 또는 업데이트 결정')).toBeTruthy();
    // 운영자는 VEX를 기록하지 못한다(CSM·FSM)
    expect((screen.getByRole('button', { name: 'VEX 기록' }) as HTMLButtonElement).disabled).toBe(true);
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

  it('SW EO — Version 여러 개인 SW만, 이력 순서', async () => {
    handler = () => ({ body: { items: [{ swId: 'SW-A', version: '1.10.0', name: 'a', ecuPno: 'E1', lifecycle: 'RELEASED', features: [] }, { swId: 'SW-A', version: '1.9.0', name: 'a', ecuPno: 'E1', lifecycle: 'RETIRED', features: [] }, { swId: 'SW-B', version: '1.0.0', name: 'b', ecuPno: 'E2', lifecycle: 'RELEASED', features: [] }] } });
    mount('/change/eo', <EoScreen />);
    expect(await screen.findByText('1.9.0(RETIRED) → 1.10.0(RELEASED)')).toBeTruthy();
    expect(screen.queryByText('SW-B')).toBeNull();
  });
});
