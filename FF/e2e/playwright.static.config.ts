// 정적 데모 하네스 (verify `e2e:static`) — Cloudflare 배포본과 같은 방식(VITE_DATA_MODE=static + snapshot:api)으로 빌드해
// 메뉴·하위 화면을 모두 열고, 화면이 요청한 스냅샷 파일이 전부 JSON으로 있는지 본다.
// 배경(2026-10-16): 화면이 쓰는 조회 API 104개 중 61개가 스냅샷에 없어 공개 사이트에서 오류로 보였는데, 실서버 e2e는 이를 잡지 못했다.
import { defineConfig, devices } from '@playwright/test';

const WEB = Number(process.env.E2E_STATIC_PORT ?? 9123); // 8000 금지

export default defineConfig({
  testDir: './static',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB}`,
    // 정적 데모도 로그인 게이트가 있다 — 하네스는 미리 로그인한 상태로 메뉴를 돈다.
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${WEB}`, localStorage: [{ name: 'ff.auth', value: '1' }] }] },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // tools/static-build.ts — 계약(dist)·백엔드를 다시 만들고(snapshot:api가 계약의 스냅샷 파일 이름 함수를 dist에서 읽는다),
    // 공개 배포와 같은 시드(cloudflare.yml, E2E_STATIC_SEED=base면 기본 시드)로 스냅샷을 찍어 포트별 폴더에 빌드한다.
    // 같은 폴더의 다른 작업과 빌드 단계만 잠금(STATIC_BUILD_LOCK)으로 나눈다 — 기다림·전시 시드 스냅샷까지 넉넉히
    command: `node tools/static-build.ts ${WEB} && npm exec -w feature-topology-frontend -- vite preview --outDir dist-static/${WEB}/dist --port ${WEB} --strictPort`,
    cwd: '..',
    env: { VITE_DATA_MODE: 'static' },
    url: `http://localhost:${WEB}`,
    reuseExistingServer: false,
    timeout: 1_800_000,
  },
});
