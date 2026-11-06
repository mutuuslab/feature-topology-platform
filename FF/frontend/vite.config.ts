/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { browserRouteSource } from '../tools/browser-routes';

// 포트 9001 (8000 금지). GitHub Pages 배포 시 base 경로 적용(GITHUB_PAGES=1).
const pages = process.env.GITHUB_PAGES === '1';
// 백엔드 포트 — 개발 9101, e2e는 전용 백엔드(FF_API_PORT=9111). dev·preview가 같은 프록시를 쓴다.
const API = `http://localhost:${process.env.FF_API_PORT ?? 9101}`;
const BACKEND_PROXY = { '/api/': API, '/ofrep/': API };
// 배포 헤더(public/_headers의 '/*' 묶음)를 preview에도 건다 — e2e가 실제 배포와 같은 CSP 아래에서 돈다(출시 준비 RD-SEC-12)
function deployHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  let inAll = false;
  for (const line of readFileSync(fileURLToPath(new URL('./public/_headers', import.meta.url)), 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) inAll = line.trim() === '/*';
    else if (inAll) {
      const i = line.indexOf(':');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}
export default defineConfig({
  base: pages ? '/feature-topology-platform/' : '/',
  // 정적 하네스(tools/static-build.ts)는 포트별 공개 폴더(스냅샷 포함)로 빌드한다 — 같은 폴더의 다른 작업이 public/api-snapshot을 바꿔도 겹치지 않게
  publicDir: process.env.FF_PUBLIC_DIR || 'public',
  plugins: [{
    name: 'browser-route-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/contracts/src/routes.ts')) return;
      return { code: browserRouteSource(code), map: null };
    },
  }, react()],
  resolve: {
    // 공용 계약은 소스(TS)를 직접 번들한다 — CJS dist를 거치지 않아 dev·test·build가 같은 코드를 본다.
    alias: { '@ff/contracts': fileURLToPath(new URL('../contracts/src/web.ts', import.meta.url)) },
  },
  server: {
    port: 9012,
    host: true,
    // '/api/'까지 맞춘다 — '/api'만 쓰면 정적 스냅샷 경로 '/api-snapshot/…'까지 백엔드로 넘어간다
    proxy: BACKEND_PROXY, // 백엔드(NestJS) — FF 루트에서 npm run dev:backend
  },
  preview: { proxy: BACKEND_PROXY, headers: deployHeaders() },
  build: {
    rollupOptions: {
      // 계약(contracts/src)은 순수 선언·함수뿐이라 초기화 부수효과가 없다 — 쓰는 export가 있는 모듈만 묶는다(입구 core.ts가 모두 다시 내보내도
      // 쓰지 않는 규칙 모듈이 첫 화면에 실리지 않게). 부수효과가 있는 것은 보고서 카탈로그 설치(report-catalog-installed.ts) 하나뿐이고 화면 입구(web.ts)는 거치지 않는다.
      // 2026-11-06 측정: 정적 첫 화면 314 → 292 KiB(알림·개인정보·롤백 규칙 등 통째로 실리던 모듈이 빠짐). 시험: tools/bundle-budget.test.ts
      treeshake: {
        moduleSideEffects: (id) => {
          const path = id.replace(/\\/g, '/');
          return path.includes('/contracts/src/') && !path.endsWith('/contracts/src/rules/report-catalog-installed.ts') ? false : null;
        },
      },
      // 두 개의 독립 엔트리: 플랫폼(index.html)과 Twin 콘솔(twin.html).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        twin: fileURLToPath(new URL('./twin.html', import.meta.url)),
        external: fileURLToPath(new URL('./external.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          cytoscape: ['cytoscape'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // 기계 부하가 크면(병렬 작업) jsdom 준비·모듈 변환만으로 5초 기본값을 넘는다 — 실제로 멈춘 시험은 여전히 실패
    testTimeout: 20_000,
    // 작업자 상한 — 코어 수만큼 jsdom 작업자를 띄우면 여러 작업이 함께 도는 기계에서 "Failed to start forks worker"(작업자 응답 대기 초과)로
    // 파일이 통째로 빠졌다(2026-10-24). 백엔드와 같은 방식(backend/vitest.config.ts).
    maxWorkers: 6,
  },
});
