// SSO 하네스 (verify `e2e:oidc`) — 운영 빌드 방식 그대로: 시험 IdP(9613) + FF_AUTH=oidc 백엔드(9611, 메모리 DB·v0.81 시드)
// + VITE_AUTH=oidc 프론트 빌드(dist-oidc, preview 9612). 포트는 E2E_OIDC_* 로 바꾼다(8000 금지).
// 확인: SSO 버튼 → IdP → 대시보드에 사용자 이름, 역할 선택기는 부여 역할만, 승인 동작, 로그아웃, 헤더 위조 401.
import { defineConfig, devices } from '@playwright/test';
import { CLIENT_ID, CLIENT_SECRET, ROLE_MAP } from './oidc/users.mjs';

const WEB = Number((process.env.E2E_OIDC_WEB_PORT ??= '9612'));
const API = Number((process.env.E2E_OIDC_API_PORT ??= '9611'));
const IDP = Number((process.env.E2E_OIDC_IDP_PORT ??= '9613'));
const PUBLIC = `http://localhost:${WEB}`;

export default defineConfig({
  testDir: './oidc',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 한 백엔드·한 시험 IdP를 함께 쓴다 — 순서대로
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: PUBLIC,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON oidc/fake-idp.mjs',
      env: { E2E_OIDC_IDP_PORT: String(IDP) },
      url: `http://127.0.0.1:${IDP}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run build -w feature-topology-backend && npm start -w feature-topology-backend',
      cwd: '..',
      url: `http://localhost:${API}/api/health`,
      env: {
        PORT: String(API),
        FF_DB: ':memory:',
        FF_SEED: 'v0.81',
        FF_AUTH: 'oidc',
        OIDC_ISSUER: `http://127.0.0.1:${IDP}`,
        OIDC_CLIENT_ID: CLIENT_ID,
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_ROLE_MAP: ROLE_MAP,
        FF_PUBLIC_URL: PUBLIC,
        FF_SESSION_SECRET: 'e2e-session-secret-0123456789abcdef-0123456789',
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm exec -w feature-topology-frontend -- vite build --outDir dist-oidc --emptyOutDir --logLevel error && npm exec -w feature-topology-frontend -- vite preview --outDir dist-oidc --port ${WEB} --strictPort`,
      cwd: '..',
      env: { VITE_AUTH: 'oidc', FF_API_PORT: String(API) },
      url: PUBLIC,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
