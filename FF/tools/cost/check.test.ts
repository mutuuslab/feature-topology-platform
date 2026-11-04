// 개발비 산정 data:check 부분 — 계수 표·기준값·원본 엑셀·데모 시드 정합.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCost } from './check.ts';

test('계수 표·기준값·원본 엑셀·데모 시드가 서로 맞는다', () => {
  assert.deepEqual(checkCost().errors, []);
});

// 배포 묶음(Docker·데스크톱)에 양식(data/source)이 실리는지는 tools/packaging.test.mjs가 백엔드의 data/ 경로로 검사한다.
