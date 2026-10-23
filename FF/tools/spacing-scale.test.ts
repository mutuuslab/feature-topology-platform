// 간격·반경 규칙 — 결함 7(간격 6px 5,657회 무토큰, 반경 13종) 회귀 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCss, checkTsx, fixCss, fixTsx, onSpaceScale, snapRadius, snapSpace } from './spacing-scale.ts';

test('스케일: 4px 격자 + 반 단계 2·6px, 40px 초과는 8의 배수', () => {
  for (const v of [0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 72, -6]) assert.equal(onSpaceScale(v), true, String(v));
  for (const v of [3, 5, 7, 9, 10, 11, 14, 18, 22, 28, 36, 100]) assert.equal(onSpaceScale(v), false, String(v));
});

test('스냅은 가까운 값, 같은 거리면 작은 쪽, 부호 보존', () => {
  assert.deepEqual([3, 5, 7, 9, 10, 11, 14, 18, 22, 28, 36, 100, -10].map(snapSpace), [2, 4, 6, 8, 8, 12, 12, 16, 20, 24, 32, 96, -8]);
});

test('반경은 3단 + pill', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 20, 99, 999].map(snapRadius), [
    'var(--r-sm)', 'var(--r-sm)', 'var(--r-sm)', 'var(--r)', 'var(--r)', 'var(--r-lg)', 'var(--r-lg)', 'var(--r-lg)', 'var(--r-lg)', 'var(--r-lg)',
    'var(--r-pill)', 'var(--r-pill)', 'var(--r-pill)',
  ]);
});

test('CSS: 스케일 밖 간격·px 반경을 찾고 고친다 — 함수 안 값과 주석은 건드리지 않는다', () => {
  const css = `.a{padding:5px 9px;border-radius:20px}
.b { margin-top: -10px; gap: 6px; border-radius: 0 2px 2px 0; }
.c { padding: clamp(28px, 5vw, 72px); border-radius: 50%; }
.d { border-radius: var(--radius-sm, 4px); padding: calc(var(--sp-2) - 1px) 7px; }
/* padding: 5px; border-radius: 4px */`;
  const found = checkCss(css);
  assert.deepEqual(found.map((f) => `${f.line}:${f.kind}`), ['1:space', '2:space', '4:space', '1:radius', '2:radius']);
  const fixed = fixCss(css);
  assert.match(fixed, /\.a\{padding:4px 8px;border-radius:var\(--r-pill\)\}/);
  assert.match(fixed, /margin-top: -8px; gap: 6px; border-radius: 0 var\(--r-sm\) var\(--r-sm\) 0;/);
  assert.match(fixed, /padding: clamp\(28px, 5vw, 72px\); border-radius: 50%;/);
  assert.match(fixed, /border-radius: var\(--radius-sm, 4px\); padding: calc\(var\(--sp-2\) - 1px\) 6px;/);
  assert.deepEqual(checkCss(fixed), []);
});

test('TSX 인라인 style: 숫자·문자열 값 모두', () => {
  const tsx = `<div style={{ padding: '5px 6px', gap: 10, borderRadius: 3, marginTop: 4, borderRadius: '50%' }} />`;
  assert.equal(checkTsx(tsx).length, 3);
  const fixed = fixTsx(tsx);
  assert.equal(fixed, `<div style={{ padding: '4px 6px', gap: 8, borderRadius: 'var(--r-sm)', marginTop: 4, borderRadius: '50%' }} />`);
  assert.deepEqual(checkTsx(fixed), []);
});
