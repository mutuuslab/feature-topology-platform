// 빈 DB 첫 실행 하네스 (verify `e2e:firstrun`) — 출시 준비 RD-OPS-02.
// 고객 설치처럼 데모 데이터 없이(FF_SEED=none) 새 파일 DB로 백엔드를 띄우고, 모든 메뉴가 오류 없이 빈 상태 안내를 보이는지,
// 데모 식별자(FEAT-00022·VIN-DEMO…)가 화면에 새어 나오지 않는지, 첫 Feature를 화면으로 등록할 수 있는지 본다.
// 운영 모드 자체(https SSO·Secure 쿠키)는 브라우저 시험이 http라 여기서 켜지 않는다 — 백엔드 시험 backend/test/kernel/first-run.spec.ts가 본다.
// 화면은 verify가 방금 만든 빌드(frontend/dist)를 preview로 띄운다. 포트는 E2E_FIRSTRUN_* (8000 금지).
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = Number((process.env.E2E_FIRSTRUN_WEB_PORT ??= '9712'));
const API = Number((process.env.E2E_FIRSTRUN_API_PORT ??= '9711'));
// 실행마다 비운 새 파일 DB — 서버 명령이 지우고 시작한다(설정 파일은 작업자마다 다시 읽히므로 여기서 지우지 않는다)
const DB = join(tmpdir(), `ff-e2e-firstrun-${API}.db`);
const fresh = `node -e "for (const s of ['', '-wal', '-shm']) require('fs').rmSync(process.argv[1] + s, { force: true })" "${DB}"`;

export default defineConfig({
  testDir: './firstrun',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB}`,
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${WEB}`, localStorage: [{ name: 'ff.auth', value: '1' }] }] },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // 빈 상태를 먼저 모두 본 뒤에 첫 등록(같은 DB를 쓰므로 순서가 있다)
  projects: [
    { name: 'empty', testMatch: /empty\.spec\.ts/ },
    { name: 'first-feature', testMatch: /first-feature\.spec\.ts/, dependencies: ['empty'] },
  ],
  webServer: [
    {
      command: `${fresh} && npm run build -w feature-topology-backend && npm start -w feature-topology-backend`,
      cwd: '..',
      url: `http://localhost:${API}/api/health/ready`,
      env: { PORT: String(API), FF_DB: DB, FF_SEED: 'none', FF_INSTANCE_ID: 'e2e-firstrun', UNLEASH_MODE: 'off', SIM_MODE: 'off', GLEO_MODE: 'off', FF_EXT_SYNC_SEED: '0' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm exec -w feature-topology-frontend -- vite preview --port ${WEB} --strictPort`,
      cwd: '..',
      env: { FF_API_PORT: String(API) },
      url: `http://localhost:${WEB}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
