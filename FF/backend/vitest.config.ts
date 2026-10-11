import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest 데코레이터 메타데이터(emitDecoratorMetadata)는 esbuild가 못 만들므로 swc로 변환한다.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
    globals: false,
  },
});
