// 공개 정적 데모 가상검증 화면(2026-11-06 로컬 의존 점검) — 검증 서버 패널에 빌드 PC의 호스트·포트·실행기·Python 경로를 보이지 않고,
// 실행 기록으로 시뮬레이터 이름·버전·마지막 실행 시각을 보인다. 서버 모드는 운영자에게 필요한 호스트·포트를 그대로 보인다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { snapshotFile } from '@ff/contracts';
import { AppProvider } from '../store';
import { when } from '../screens/shared';
import { virtualCopy as T } from '../copy/virtual';

vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), STATIC_MODE: true }));
const { VirtualValidationScreen } = await import('../screens/policy/Virtual');

// 예전 스냅샷 그대로(빌드 PC 정보가 실린 상태) — 화면이 그런 값이 와도 보이지 않아야 한다
const STATUS = { available: false, mode: 'auto', simulator: 'CARLA', host: '127.0.0.1', port: 2100, server: null, runner: 'C:\\project\\FF\\backend\\test\\fixtures\\fake-carla\\ffcarla_cli.mjs', python: 'C:/project/2026-10-17_Carlra/.venv/Scripts/python.exe', reason: 'CARLA 검증 서버 127.0.0.1:2100 응답 없음', queue: { running: 0, waiting: 0 } };
const RUN = (runId: string, at: string) => ({ runId, policyId: 'POL-00003', policyRevision: 1, contentHash: 'h', featureId: 'FEAT-00022', featureVersion: '1.0.0', vin: 'ego-01', scenarioId: 'SCN-FEAT00022-FAULT-ONBOARD', role: 'FAULT_ONBOARD', source: 'carla', simulator: 'CARLA', testId: `TEST-${runId}`, overall: 'PASS', gateResult: 'PASS', criteria: [], evaluation: null, evidence: { files: [] }, repro: { toolVersion: 'ff-carla 1.0 · CARLA 0.9.16 · Town04', scenarioHash: 'a', scriptHash: 'b', seed: 0, map: 'Town04' }, error: null, at, by: 'u', tms: null });
const RUNS = [RUN('VV-00002', '2026-11-03T02:00:00.000Z'), RUN('VV-00001', '2026-11-01T02:00:00.000Z')];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/api/sim/status') || url.includes(snapshotFile('/api/sim/status')) ? STATUS : url.includes('virtual-validations') && !url.includes('scenarios') && !url.includes('combinations') ? { items: RUNS } : { items: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('공개 정적 데모 — 가상검증 검증 서버 패널', () => {
  it('호스트·포트·실행기·Python 경로 대신 시뮬레이터 이름·버전과 마지막 실행 시각', async () => {
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'quality' }));
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/validations/virtual']}>
          <AppProvider>
            <Routes>
              <Route path="/validations/virtual" element={<VirtualValidationScreen />} />
            </Routes>
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('CARLA 0.9.16 · Town04')).toBeTruthy();
    expect(screen.getByText(T.recorded)).toBeTruthy();
    const panel = container.querySelector('[data-tour="sim-status"]')!.textContent ?? '';
    expect(panel).toContain(when('2026-11-03T02:00:00.000Z')); // 마지막 실행(실행 기록 기준)
    expect(panel).toContain(T.lastRunNote(2));
    expect(panel).not.toMatch(/127\.0\.0\.1|2100|ffcarla_cli|python|[A-Za-z]:[\\/]/);
    expect(screen.queryByText(T.runner)).toBeNull();
  });
});
