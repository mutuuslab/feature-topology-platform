// 브라우저 하네스 설정 — 백엔드(9101, 메모리 DB·v0.81 시드)와 프론트(Vite 9112)를 직접 띄운다. 포트 8000 금지.
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
// e2e 전용 프론트 포트 — 개발 서버(9012)·다른 프로젝트와 겹치지 않게 분리 (8000 금지)
const WEB = Number(process.env.E2E_WEB_PORT ?? 9112);
const API = Number(process.env.E2E_API_PORT ?? 9101);

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
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: 'npm run build -w feature-topology-backend && npm start -w feature-topology-backend',
      cwd: '..',
      url: `http://localhost:${API}/api/health`,
      env: { PORT: String(API), FF_DB: ':memory:', FF_SEED: 'v0.81' },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: `npm exec -w feature-topology-frontend -- vite --port ${WEB} --strictPort`,
      cwd: '..',
      url: `http://localhost:${WEB}`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
