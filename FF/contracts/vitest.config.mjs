// 시험 제한 시간·작업자 상한 — 병렬 작업으로 기계 부하가 크면 작업자 시작·첫 WebCrypto 호출만으로 5초 기본값을 넘고,
// 코어 수만큼 작업자를 띄우면 작업자 시작 대기가 초과된다(2026-10-24). 실제로 멈춘 시험은 여전히 실패한다(20초).
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 20_000, maxWorkers: 6 } });
