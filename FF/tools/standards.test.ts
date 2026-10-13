// 보고서 규칙 추적 — 없는 ID는 잡고, @rule 표식만 구현 추적으로 센다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './standards.ts';

const known = { rules: new Set(['FFG-PLT-003', 'FFG-DEAC-004']), tests: new Set(['TC-FF-11']) };

test('카탈로그에 없는 규칙·시험 ID는 파일:줄과 함께 보고한다', () => {
  const s = scanText('a.ts', "// FFG-PLT-099 오타\nconst x = 'TC-FF-99';", known);
  assert.deepEqual(s.unknown, ['a.ts:1  FFG-PLT-099 — 보고서 v1.1 카탈로그에 없는 규칙 ID', 'a.ts:2  TC-FF-99 — 보고서 시험 카탈로그(TC-FF-01~60)에 없는 ID']);
});

test('구현 추적은 @rule 표식만 — 단순 언급은 세지 않는다', () => {
  const s = scanText('b.ts', '// 운영자가 고르지 않는다(FFG-PLT-003)\n * @rule FFG-DEAC-004, FFG-PLT-003 — 판정 함수', known);
  assert.deepEqual(s.tags, ['FFG-DEAC-004', 'FFG-PLT-003']);
  assert.deepEqual(s.mentions, ['FFG-PLT-003', 'FFG-DEAC-004', 'FFG-PLT-003']);
  assert.deepEqual(s.unknown, []);
});
