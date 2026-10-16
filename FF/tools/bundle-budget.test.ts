import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from './bundle-budget.ts';

const K = 1024;
const B = { initialGzipKiB: 100, chunkGzipKiB: 10, allow: { VehicleTwinScene: 50 } };

test('첫 화면 합계가 예산을 넘으면 실패', () => {
  assert.equal(judge([{ file: 'main-abcdefgh.js', gzip: 80 * K }, { file: 'main-abcdefgh.css', gzip: 30 * K }], new Set(['main-abcdefgh.js', 'main-abcdefgh.css']), B).length, 1);
});
test('화면 묶음은 하나하나 예산 — 허용 목록은 그 값', () => {
  const r = judge([{ file: 'Policies-ABCDEFGH.js', gzip: 11 * K }, { file: 'VehicleTwinScene-BA4x7Hu-.js', gzip: 40 * K }], new Set(), B);
  assert.deepEqual(r, ['Policies-ABCDEFGH.js 11 KiB > 예산 10 KiB']);
});
