/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 포트 9001 (8000 금지). GitHub Pages 배포 시 base 경로 적용(GITHUB_PAGES=1).
const pages = process.env.GITHUB_PAGES === '1';
export default defineConfig({
  base: pages ? '/feature-topology-platform/' : '/',
  plugins: [react()],
  server: {
    port: 9001,
    host: true,
    // proxy: { '/api': 'http://localhost:9101' }, // 백엔드 연동 시 주석 해제
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
