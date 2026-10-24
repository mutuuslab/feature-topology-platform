// 결함 기록 점검기 자체의 시험 — 사본 실행 결과를 넣어 판정 규칙만 본다(백엔드는 띄우지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { failsTitles, probeFiles, probeFilesOf, probeProblems } from './defect-probes.ts';

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
  // 판정 두 종류(ADS requirements·Orca items)의 결함 기록을 모두 모으고, 결함이 없는 항목은 넣지 않는다
  const ads = { requirements: { 'FFP-F001': { defect: { probe: 'backend/test/ads/defects.spec.ts' } }, 'FFP-F002': {} } };
  const orca = { items: { HT01: { defect: { probe: 'backend/test/requirements/defects.spec.ts' } }, HT02: { defect: { probe: 'backend/test/ads/defects.spec.ts' } } } };
  assert.deepEqual(probeFilesOf([ads, orca]), ['backend/test/ads/defects.spec.ts', 'backend/test/requirements/defects.spec.ts']);
  assert.deepEqual(probeFilesOf([{ requirements: { 'FFP-F001': {} } }]), []);
  // 커밋된 판정이 가리키는 probe 파일은 실재해야 한다(고친 결함만 남아 비어 있을 수 있다 — 2026-10-24 RD-FN-01)
  for (const f of probeFiles()) assert.ok(existsSync(join(FF, f)), f);
});
