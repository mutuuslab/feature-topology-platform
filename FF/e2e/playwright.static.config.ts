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
  use: { baseURL: `http://localhost:${WEB}`, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...devices['Desktop Chrome'] },
  webServer: {
    command: `npm run build -w feature-topology-backend && npm run snapshot:api && npm exec -w feature-topology-frontend -- vite build --outDir dist-static --emptyOutDir && npm exec -w feature-topology-frontend -- vite preview --outDir dist-static --port ${WEB} --strictPort`,
    cwd: '..',
    env: { VITE_DATA_MODE: 'static' },
    url: `http://localhost:${WEB}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
