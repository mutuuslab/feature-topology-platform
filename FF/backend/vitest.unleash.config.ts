import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// 실제 공식 서버 시험은 격리된 sidecar를 시작하는 tools/unleash/live-check.mjs로 실행한다.
export default defineConfig({ ...base, test: { ...base.test, include: ['live-tests/**/*.spec.ts'], maxWorkers: 1 } });
