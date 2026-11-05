import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, collectBudgetAssets } from './bundle-budget.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const K = 1024;
const B = { initialGzipKiB: 100, chunkGzipKiB: 10, allow: { VehicleTwinScene: 50 } };

test('첫 화면 합계가 예산을 넘으면 실패', () => {
  assert.equal(judge([{ file: 'main-abcdefgh.js', gzip: 80 * K }, { file: 'main-abcdefgh.css', gzip: 30 * K }], new Set(['main-abcdefgh.js', 'main-abcdefgh.css']), B).length, 1);
});
test('화면 묶음은 하나하나 예산 — 허용 목록은 그 값', () => {
  const r = judge([{ file: 'Policies-ABCDEFGH.js', gzip: 11 * K }, { file: 'VehicleTwinScene-BA4x7Hu-.js', gzip: 40 * K }], new Set(), B);
  assert.deepEqual(r, ['Policies-ABCDEFGH.js 11 KiB > 예산 10 KiB']);
});

test('public 복구 스크립트도 해시 자산과 같은 첫 화면 예산에 합산한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-entry-budget-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/main-abcdefgh.js'), 'main');
    writeFileSync(join(dir, 'boot-check.js'), 'recovery');
    writeFileSync(join(dir, 'index.html'), '<script src="/base/assets/main-abcdefgh.js"></script><script src="/base/boot-check.js?v=1"></script>');
    const { chunks, initial } = collectBudgetAssets(dir);
    assert.deepEqual([...initial].sort(), ['main-abcdefgh.js', 'public:boot-check.js']);
    const total = chunks.filter(c => initial.has(c.file)).reduce((n, c) => n + c.gzip, 0);
    assert.equal(total, gzipSync('main').length + gzipSync('recovery').length);
    assert.equal(judge(chunks, initial, { ...B, initialGzipKiB: (total - 1) / K }).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
