import {defineConfig, mergeConfig} from 'vitest/config';
import base from './vite.config';
// Kept outside default unit discovery; this command fails when capture input is absent.
export default mergeConfig(base,defineConfig({test:{include:['integration/alm-captured.capture.ts'],testTimeout:120_000,maxWorkers:1}}));
