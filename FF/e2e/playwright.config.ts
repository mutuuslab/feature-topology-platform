// 브라우저 하네스 설정 — e2e 전용 백엔드(9111, 메모리 DB·v0.81 시드)와 프론트(9112)를 직접 띄운다. 포트 8000 금지.
// 개발 서버(9101·9012)와 분리해 매 실행이 깨끗한 시드에서 시작하고, 개발 중인 데이터를 건드리지 않는다.
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CI = !!process.env.CI;
// e2e 전용 프론트 포트 — 개발 서버(9012)·다른 프로젝트와 겹치지 않게 분리 (8000 금지)
const WEB = Number(process.env.E2E_WEB_PORT ?? 9112);
process.env.E2E_API_PORT ??= '9111'; // 테스트 파일(API 직접 호출)도 같은 값을 읽는다
const API = Number(process.env.E2E_API_PORT);
// E2E_WEB=preview — verify가 방금 만든 빌드(dist)를 띄운다. 개발 서버의 첫 요청 컴파일 지연이 병렬 실행에서 시간 초과를 낸다.
const PREVIEW = process.env.E2E_WEB === 'preview';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' } },
  fullyParallel: true,
  workers: CI ? 2 : 4,
  retries: CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  use: {
    baseURL: `http://localhost:${WEB}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // poc.spec은 FEAT-00022를 실제로 긴급 차단·이상 건을 만든다 — 다른 시험이 모두 끝난 뒤 따로 돈다
  // 시각 회귀(visual.spec)는 따로 — poc의 의존 프로젝트로 chromium이 돌 때 --grep-invert가 적용되지 않아 CI(Linux)에서 Windows 기준과 비교되던 문제
  projects: [
    { name: 'chromium', testIgnore: /(poc|visual)\.spec\.ts/ },
    { name: 'poc', testMatch: /poc\.spec\.ts/, dependencies: ['chromium'] },
    { name: 'visual', testMatch: /visual\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npm run build -w feature-topology-backend && npm start -w feature-topology-backend',
      cwd: '..',
      url: `http://localhost:${API}/api/health`,
      // 가상검증 실행기는 같은 계약의 시험 대역(fake-carla, 결정적) — 실제 CARLA 판정은 backend/test/d06/virtual.spec.ts가 검증 서버(2100)가 떠 있을 때 확인한다
      // FLEET_SIM_TIME_SCALE — 차량 시뮬레이터의 DC 단계 시간(인계·램프)을 줄여 e2e 대기를 짧게(Registry 값 × 0.5)
      env: { PORT: String(API), FF_DB: ':memory:', FF_SEED: 'v0.81', FLEET_SIM_TIME_SCALE: '0.5', CARLA_RUNNER: resolve(__dirname, '..', 'backend', 'test', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: join(tmpdir(), 'ff-e2e-evidence') },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: `npm exec -w feature-topology-frontend -- vite ${PREVIEW ? 'preview ' : ''}--port ${WEB} --strictPort`,
      cwd: '..',
      env: { FF_API_PORT: String(API) },
      url: `http://localhost:${WEB}`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
