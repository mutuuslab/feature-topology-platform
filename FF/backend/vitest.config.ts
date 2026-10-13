import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest 데코레이터 메타데이터(emitDecoratorMetadata)는 esbuild가 못 만들므로 swc로 변환한다.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    // node:sqlite 실험 기능 경고로 출력이 덮이지 않게
    // 워커 상한 — 코어 수만큼 띄우면 여러 세션이 함께 도는 기계에서 Nest 부팅·vECU·PoC 시험이 30 s 시간 초과로 흔들렸다(2026-10-14).
    // 상한 6이면 전체 시간은 거의 같고(부팅이 병목) 부하에 둔감하다.
    poolOptions: { forks: { execArgv: ['--disable-warning=ExperimentalWarning'], maxForks: 6, minForks: 1 } },
  },
});
