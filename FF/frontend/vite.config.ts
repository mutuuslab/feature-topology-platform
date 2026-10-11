/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 포트 9001 (8000 금지). GitHub Pages 배포 시 base 경로 적용(GITHUB_PAGES=1).
const pages = process.env.GITHUB_PAGES === '1';
export default defineConfig({
  base: pages ? '/feature-topology-platform/' : '/',
  plugins: [react()],
  resolve: {
    // 공용 계약은 소스(TS)를 직접 번들한다 — CJS dist를 거치지 않아 dev·test·build가 같은 코드를 본다.
    alias: { '@ff/contracts': fileURLToPath(new URL('../contracts/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 9012,
    host: true,
    // '/api/'까지 맞춘다 — '/api'만 쓰면 정적 스냅샷 경로 '/api-snapshot/…'까지 백엔드로 넘어간다
    proxy: { '/api/': 'http://localhost:9101' }, // 백엔드(NestJS) — FF 루트에서 npm run dev:backend
  },
  build: {
    rollupOptions: {
      // 두 개의 독립 엔트리: 플랫폼(index.html)과 Twin 콘솔(twin.html).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        twin: fileURLToPath(new URL('./twin.html', import.meta.url)),
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
  },
});
