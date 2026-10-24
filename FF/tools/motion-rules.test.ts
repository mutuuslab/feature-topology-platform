// 모션 규칙 회귀 시험 — 모션 체계 v1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMotionCss, checkMotionTsx, fixMotionCss, keyframeName, literalTimes } from './motion-rules.ts';

const ALLOW = { loops: { 'ds-shimmer': '로딩 골격' }, oneShots: { 'lg-rule': '로그인 첫 등장' } };

test('함수 밖의 0이 아닌 시간 리터럴만 잡는다', () => {
  assert.deepEqual(literalTimes('width .3s ease'), ['.3s']);
  assert.deepEqual(literalTimes('background var(--t-fast) var(--ease)'), []);
  assert.deepEqual(literalTimes('opacity 0s, transform 120ms'), ['120ms']);
  assert.deepEqual(literalTimes('x calc(var(--d, 3200ms) * 1) linear'), []);
});

test('animation 값에서 키프레임 이름을 찾는다', () => {
  assert.equal(keyframeName('ds-shimmer 1.3s var(--ease) infinite'), 'ds-shimmer');
  assert.equal(keyframeName('1.4s ease-in-out infinite pulse'), 'pulse');
  assert.equal(keyframeName('none'), null);
});

test('CSS: 허용 목록 밖 무한 반복과 토큰이 아닌 시간을 찾는다 — 토큰·허용 목록은 통과', () => {
  const css = `.a { transition: width .3s ease; }
.b { transition: background var(--t-fast) var(--ease); }
.c { animation: ds-shimmer 1.3s var(--ease) infinite; }
.d { animation: tsPulse 1.35s ease-out infinite; }
.e { animation: lg-rule 0.9s ease-out both; }
.f { animation: ds-fade var(--t-base) var(--ease), pop 200ms ease; }
/* .g { animation: x 1s infinite } */`;
  assert.deepEqual(
    checkMotionCss(css, ALLOW).map((f) => `${f.line}:${f.kind}:${f.name ?? ''}`),
    ['1:literal:', '4:loop:tsPulse', '6:literal:pop'],
  );
});

test('--fix: 시간 리터럴을 가장 가까운 토큰으로, 무한 반복·허용 목록은 그대로', () => {
  const css = `.a{transition:width .3s ease, opacity 120ms}
.b{animation: x 1s infinite}
.e{animation: lg-rule 0.9s ease-out both}
.f{animation: pop 200ms ease both}`;
  const out = fixMotionCss(css, ALLOW);
  assert.match(out, /transition: width var\(--t-slow\) ease, opacity var\(--t-fast\)/);
  assert.match(out, /animation: x 1s infinite/);
  assert.match(out, /lg-rule 0\.9s/);
  assert.match(out, /pop var\(--t-base\) ease both/);
  assert.deepEqual(checkMotionCss(out, ALLOW).map((f) => f.kind), ['loop']);
});

test('TSX 인라인 style도 본다', () => {
  const tsx = `<div style={{ transition: 'width .3s', animation: 'pulse 1.4s infinite' }} /><i style={{ transition: 'opacity var(--t-fast)' }} />`;
  assert.deepEqual(checkMotionTsx(tsx, ALLOW).map((f) => f.kind), ['literal', 'loop']);
});
