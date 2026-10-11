// 브라우저 하네스 설정 — e2e 전용 백엔드(9111, 메모리 DB·v0.81 시드)와 프론트(9112)를 직접 띄운다. 포트 8000 금지.
// 개발 서버(9101·9012)와 분리해 매 실행이 깨끗한 시드에서 시작하고, 개발 중인 데이터를 건드리지 않는다.
import { defineConfig, devices } from '@playwright/test';

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
      command: `npm exec -w feature-topology-frontend -- vite ${PREVIEW ? 'preview ' : ''}--port ${WEB} --strictPort`,
      cwd: '..',
      env: { FF_API_PORT: String(API) },
      url: `http://localhost:${WEB}`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
