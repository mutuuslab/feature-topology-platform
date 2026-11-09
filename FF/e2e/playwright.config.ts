// 브라우저 하네스 설정 — e2e 전용 백엔드(9111, 메모리 DB·v0.81 시드)와 프론트(9112)를 직접 띄운다. 포트 8000 금지.
// 개발 서버(9101·9012)와 분리해 매 실행이 깨끗한 시드에서 시작하고, 개발 중인 데이터를 건드리지 않는다.
import { defineConfig, devices } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { E2E_VEHICLE_ROOT } from './tests/vehicle';

const CI = !!process.env.CI;
// e2e 전용 프론트 포트 — 개발 서버(9012)·다른 프로젝트와 겹치지 않게 분리 (8000 금지)
const WEB = Number(process.env.E2E_WEB_PORT ?? 9112);
process.env.E2E_API_PORT ??= '9111'; // 테스트 파일(API 직접 호출)도 같은 값을 읽는다
const API = Number(process.env.E2E_API_PORT);
// 모의 GitHub(Flag 코드 연결 PR 검사, 20-97 §8.2-4) — 시험 파일이 E2E_GH_PORT에서 띄우고, 백엔드는 이 주소·비밀로 App·webhook을 쓴다
process.env.E2E_GH_PORT ??= String(API + 2);
process.env.E2E_GH_WEBHOOK_SECRET ??= 'e2e-flag-webhook-secret';
const GH_APP_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
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
    // 로그인 게이트를 기본 통과 — 로그인 화면 시험만 storageState를 비운다.
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${WEB}`, localStorage: [{ name: 'ff.auth', value: '1' }] }] },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // 시각 회귀(visual.spec)는 따로 — chromium이 돌 때 --grep-invert가 적용되지 않아 CI(Linux)에서 Windows 기준과 비교되던 문제
  // 브라우저·해상도(출시 준비 RD-P2-03, docs/20-architecture/20-93-browser-support.md):
  //  · chromium — 전체 시험(Edge·Chrome 같은 엔진). firefox·webkit — 핵심 흐름 스모크(browsers.spec)만: 엔진 차이는 레이아웃·폼·대화 상자·
  //    fetch 오류 처리에서 나고, 전체를 세 번 돌리면 기계 시간이 세 배다
  //  · tablet(768)·mobile(390, 보기만) — 좁은 폭 스모크(narrow.spec), 기본은 chromium. E2E_ALL_ENGINES=1이면(verify --full)
  //    좁은 폭도 firefox·webkit으로 한 번 더
  projects: [
    { name: 'chromium', testIgnore: [/visual\.spec\.ts/, /narrow\.spec\.ts/, /topology-benchmark\.spec\.ts/] },
    { name: 'firefox', testMatch: /browsers\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: /browsers\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    { name: 'tablet', testMatch: /narrow\.spec\.ts/, use: { viewport: { width: 768, height: 1024 } } },
    { name: 'mobile', testMatch: /narrow\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    ...(process.env.E2E_ALL_ENGINES
      ? [
          { name: 'tablet-firefox', testMatch: /narrow\.spec\.ts/, use: { ...devices['Desktop Firefox'], viewport: { width: 768, height: 1024 } } },
          { name: 'mobile-webkit', testMatch: /narrow\.spec\.ts/, use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 }, hasTouch: true } },
        ]
      : []),
    { name: 'visual', testMatch: /visual\.spec\.ts/ },
    // RAF intervals are a rendering benchmark. Axe/WebGL in another worker changes the host frame interval.
    // Run the same strict 210-event benchmark once, after every functional browser project.
    { name: 'benchmark', testMatch: /topology-benchmark\.spec\.ts/, workers: 1, fullyParallel: false, dependencies: ['chromium', 'firefox', 'webkit', 'tablet', 'mobile', ...(process.env.E2E_ALL_ENGINES ? ['tablet-firefox', 'mobile-webkit'] : [])] },
  ],
  webServer: [
    {
      command: 'npm run build -w feature-topology-backend && npm start -w feature-topology-backend',
      cwd: '..',
      url: `http://localhost:${API}/api/health`,
      // 가상검증 실행기는 같은 계약의 시험 대역(fake-carla, 결정적) — 실제 CARLA 판정은 backend/test/d06/virtual.spec.ts가 검증 서버(2100)가 떠 있을 때 확인한다
      // FLEET_SIM_TIME_SCALE — 차량 시뮬레이터의 DC 단계 시간(인계·램프)을 줄여 e2e 대기를 짧게(Registry 값 × 0.5)
      // FF_VEHICLE_AUTH=required — 차량 요청은 서명해야 받는다(RD-SEC-08). 시험 차량은 시험 전용 루트(tests/vehicle.ts)에서 파생한 차량 키로 서명한다
      // FF_DEMO_LABELS=on — 기존 시험은 모의 표시가 있는 화면을 본다. 데모 기본(seamless)은 demo-seamless.spec.ts가 응답을 바꿔 확인한다(80-50 D-ALM-17)
      env: { PORT: String(API), FF_DB: ':memory:', FF_SEED: 'v0.81', FF_VEHICLE_AUTH: 'required', FF_HSM_VEHICLE_ROOT: E2E_VEHICLE_ROOT, FLEET_SIM_TIME_SCALE: '0.5', CARLA_RUNNER: resolve(__dirname, '..', 'backend', 'test', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: join(tmpdir(), 'ff-e2e-evidence'), FF_GITHUB_API_URL: `http://localhost:${process.env.E2E_GH_PORT}`, FF_GITHUB_APP_ID: '424242', FF_GITHUB_APP_PRIVATE_KEY: GH_APP_KEY, FF_GITHUB_WEBHOOK_SECRET: process.env.E2E_GH_WEBHOOK_SECRET, FF_DEMO_LABELS: 'on' },
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
