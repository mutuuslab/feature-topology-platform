import swc from 'unplugin-swc';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Nest 데코레이터 메타데이터(emitDecoratorMetadata)는 esbuild가 못 만들므로 swc로 변환한다.
export default defineConfig({
  // Pin both test imports and transformed Nest controllers to this worktree's built contract.
  resolve: { alias: { '@ff/contracts': resolve(__dirname, '../contracts/dist/index.js') } },
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    // node:sqlite 실험 기능 경고로 출력이 덮이지 않게
    // 워커 상한 — 코어 수만큼 띄우면 여러 세션이 함께 도는 기계에서 Nest 부팅·가상검증·PoC 시험이 30 s 시간 초과로 흔들렸다(2026-10-14).
    // CI의 작은 CPU에서 Nest 앱 여섯 개가 동시에 부팅하면 실제 서비스 시험이 기한과 경주했다.
    // 세 개로 제한해 부팅·서명 부하를 나누며 시험 제한 시간과 모든 단언은 그대로 유지한다.
    // (vitest 4부터 poolOptions는 최상위 옵션 — forks 풀은 기본값)
    execArgv: ['--disable-warning=ExperimentalWarning'],
    maxWorkers: 3,
    // 시험 제한 시간 — 병렬 작업으로 기계 부하가 크면 Nest 부팅·첫 서명만으로 5초 기본값을 넘었다(2026-10-24, conformance·delivery·vehicle-auth).
    // contracts·frontend와 같은 20초. 실제로 멈춘 시험은 여전히 실패한다
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
