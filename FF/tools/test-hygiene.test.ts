// 시험 결정성 검사(test:hygiene) — 규칙이 오늘 본 흔들림 유형을 잡고, 조건 대기·표식 예외는 지나가는지.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inPollLoop, scanSource, scanVitestConfig, type Rule } from './test-hygiene.ts';

const rules = (src: string) => scanSource('x.spec.ts', src).map((f) => f.rule as Rule);

test('고정 포트 listen·--port 인자는 위반, 0(OS가 고른 포트)은 허용 — GLEO 8798 충돌(2026-10-24)', () => {
  assert.deepEqual(rules(`server.listen(8798, '127.0.0.1');`), ['fixed-port']);
  assert.deepEqual(rules(`srv.listen({ host: '127.0.0.1', port: 9199 });`), ['fixed-port']);
  assert.deepEqual(rules(`spawn(node, [script, '--port', '9590']);`), ['fixed-port']);
  assert.deepEqual(rules(`server.listen(0, '127.0.0.1'); spawn(node, [script, '--port', '0']);`), []);
});

test('setTimeout 잠자기는 위반, 조건 대기 반복문 안의 간격은 허용', () => {
  assert.deepEqual(rules(`await new Promise((r) => setTimeout(r, 300));`), ['sleep']);
  assert.deepEqual(rules(`await new Promise((ok) => setTimeout(() => ok(), 50));`), ['sleep']);
  const poll = `const until = async (fn, ok) => {\n  const end = Date.now() + 12_000;\n  while (!ok(await fn())) {\n    if (Date.now() > end) throw new Error('x');\n    await new Promise((r) => setTimeout(r, 100));\n  }\n};`;
  assert.deepEqual(rules(poll), []);
  const retry = `for (let i = 0; i < 60; i++) {\n  try { await get(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }\n}`;
  assert.deepEqual(rules(retry), []);
});

test('짧은 실시간 기한 설정은 위반 — OTA 회신 기한 TIMEOUT(2026-10-25)', () => {
  assert.deepEqual(rules(`const ENV = { PUBLICATION_TIMEOUT_MS: '4000' };`), ['deadline-wait']);
  assert.deepEqual(rules(`process.env.KILL_DEADLINE_MS = '500';`), ['deadline-wait']);
  assert.deepEqual(rules(`const ENV = { FF_OTA_TIMEOUT_MS: '60000', PUBLICATION_TIMEOUT_MS: '600000' };`), []);
});

test('Date.now 비교·경과 시간 단언·waitForTimeout은 위반', () => {
  assert.deepEqual(rules(`expect(Date.now() - t0).toBeLessThan(3000);`), ['date-now']);
  assert.deepEqual(rules(`if (Date.now() > deadline) done = true;`), ['date-now']);
  assert.deepEqual(rules(`await page.waitForTimeout(300);`), ['wait-for-timeout']);
  // 반복문 머리의 안전 상한은 조건 대기
  assert.deepEqual(rules(`while (Date.now() < end) {\n  if (await ready()) break;\n}`), []);
});

test('hygiene-ok 표식(이유 4자 이상)은 같은 줄·윗줄에서 예외, 이유 없는 표식은 위반', () => {
  assert.deepEqual(rules(`// hygiene-ok: 느린 시뮬레이터 흉내\nawait new Promise((r) => setTimeout(r, 1500));`), []);
  assert.deepEqual(rules(`await page.waitForTimeout(300); // hygiene-ok: 애니메이션 끝 기다림`), []);
  assert.equal(rules(`// hygiene-ok\nawait new Promise((r) => setTimeout(r, 10));`).length, 2);
});

test('반복문 판정은 함수 경계를 넘지 않는다', () => {
  const src = `while (x) {\n  const f = () => {\n    SLEEP;\n  };\n}`;
  assert.equal(inPollLoop(src, src.indexOf('SLEEP')), false);
  const inner = `while (x) {\n  if (y) {\n    SLEEP;\n  }\n}`;
  assert.equal(inPollLoop(inner, inner.indexOf('SLEEP')), true);
});

test('vitest 설정 — testTimeout 20초 이상·maxWorkers 1~6이 없으면 위반(5초 기본값·작업자 시작 대기 초과, 2026-10-24)', () => {
  assert.deepEqual(scanVitestConfig('c', `test: { testTimeout: 20_000, maxWorkers: 6 }`), []);
  assert.equal(scanVitestConfig('c', `test: { maxWorkers: 6 }`).length, 1);
  assert.equal(scanVitestConfig('c', `test: { testTimeout: 5000 }`).length, 2);
});
