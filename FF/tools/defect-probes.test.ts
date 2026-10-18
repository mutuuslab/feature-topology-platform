// 결함 기록 점검기 자체의 시험 — 사본 실행 결과를 넣어 판정 규칙만 본다(백엔드는 띄우지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failsTitles, probeFiles, probeProblems } from './defect-probes.ts';

test('it.fails 제목을 따옴표 종류와 상관없이 모은다', () => {
  const src = "it.fails('A-1 하나', async () => {});\n  test.fails(\"B-2 둘\", () => {});\n  it(`C 보통`, () => {});\n";
  assert.deepEqual(failsTitles(src), ['A-1 하나', 'B-2 둘']);
});

test('판정 — 단언 실패만 인정하고, 재현 단계 실패·통과(이미 고침)·결과 없음을 잡는다', () => {
  const expected = [{ file: 'p.spec.ts', titles: ['ok', 'setup', 'fixed', 'gone'] }];
  const results = [
    { file: 'p.spec.ts', title: 'ok', status: 'failed', message: 'AssertionError: expected true to be false' },
    { file: 'p.spec.ts', title: 'setup', status: 'failed', message: "TypeError: Cannot read properties of undefined (reading 'grantId')" },
    { file: 'p.spec.ts', title: 'fixed', status: 'passed', message: '' },
  ];
  const p = probeProblems(expected, results).join('\n');
  assert.doesNotMatch(p, /'ok'/);
  assert.match(p, /'setup' — 요구 단언이 아니라 재현 단계에서 실패함: TypeError/);
  assert.match(p, /'fixed' — it로 바꿔도 통과함/);
  assert.match(p, /'gone' 실행 결과 없음/);
});

test('점검 대상은 ADS·Orca 판정의 결함 probe 파일', () => {
  const files = probeFiles();
  assert.ok(files.includes('backend/test/ads/defects.spec.ts'), files.join(','));
});
