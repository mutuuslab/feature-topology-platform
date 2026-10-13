// 보고서 규칙 추적 — 없는 ID는 잡고, @rule 표식만 구현 추적으로 센다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementProblems, renderStatusModule, scanText } from './standards.ts';

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

test('반영 위치 — 플랫폼 규칙은 모두 기존 컴포넌트에, 컴포넌트는 manifest에 있어야 한다', () => {
  const map = { 'FFG-PLT-003': { components: ['D03-02'], wp: 'WP3' as const }, 'FFG-ADS-099': { components: ['D09-01'], wp: 'WP9' as const } };
  assert.deepEqual(placementProblems(['FFG-PLT-003', 'FFG-DEAC-004'], map, ['D03-02']), [
    'FFG-DEAC-004 — 반영할 기존 컴포넌트가 정해지지 않음(standards-map.ts)',
    'FFG-ADS-099 — 플랫폼 적용 규칙이 아님(배치 표에서 뺀다)',
    'FFG-ADS-099 → D09-01 — 42 컴포넌트 manifest에 없는 ID',
  ]);
});

test('규칙 상태 모듈 — 시험은 구현 추적이 있을 때만 센다', () => {
  const text = renderStatusModule([
    { id: 'FFG-PLT-003', implemented: ['a.ts'], tested: ['a.test.ts'] },
    { id: 'FFG-DEAC-004', implemented: [], tested: ['b.test.ts'] },
  ]);
  assert.match(text, /"FFG-PLT-003": \{\s+"implemented": true,\s+"tested": true/);
  assert.match(text, /"FFG-DEAC-004": \{\s+"implemented": false,\s+"tested": false/);
});
