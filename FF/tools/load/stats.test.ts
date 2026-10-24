// 부하 시험 집계·예산 판정(tools/load/stats.ts) — readiness: RD-P2-01
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FF } from '../lib.ts';
import { PROFILES } from './profiles.ts';
import { judge, percentile, summarize } from './stats.ts';

test('최근접 순위 백분위 — 빈 표본 0, 한 개면 그 값, p95는 위에서 5% 안쪽', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([7], 99), 7);
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(xs, 50), 50);
  assert.equal(percentile(xs, 95), 95);
  assert.equal(percentile(xs, 99), 99);
  assert.equal(percentile(xs, 100), 100);
});

test('요약 — 정렬하지 않은 지연도 백분위·최댓값·처리량을 맞게 낸다', () => {
  const s = summarize([30, 10, 20, 40], 2000);
  assert.deepEqual(s, { n: 4, p50: 20, p95: 40, p99: 40, max: 40, rps: 2 });
});

test('예산 판정 — 넘으면 실패, 배수를 곱하고, 예산 없는 시나리오도 실패(측정만 남기지 않는다)', () => {
  const r = (id: string, p95: number) => ({ id, summary: { n: 1, p50: p95, p95, p99: p95, max: p95, rps: 1 } });
  const v = judge([r('a', 90), r('b', 120), r('c', 5)], { p95Ms: { a: 100, b: 100 } }, 1);
  assert.deepEqual(v.map((x) => [x.id, x.ok, x.budget]), [['a', true, 100], ['b', false, 100], ['c', false, null]]);
  assert.equal(judge([r('a', 60)], { p95Ms: { a: 100 } }, 0.5)[0].ok, false);
});

test('예산 파일 — run.ts의 모든 시나리오에 p95 예산이 있고, 숫자 예산만 둔다', () => {
  const budgets = JSON.parse(readFileSync(join(FF, 'harness', 'perf-budgets.json'), 'utf8'));
  const src = readFileSync(join(FF, 'tools', 'load', 'run.ts'), 'utf8');
  const ids = [...src.matchAll(/\{ id: '([a-z0-9.]+)', title:/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, `시나리오가 너무 적다: ${ids.length}`);
  for (const id of ids) assert.equal(typeof budgets.p95Ms[id], 'number', `${id} 예산 없음`);
  for (const id of Object.keys(budgets.p95Ms)) assert.ok(ids.includes(id), `시나리오 없는 예산: ${id}`);
  for (const p of Object.values(PROFILES)) assert.ok(p.budgetScale > 0 && p.requests > 0 && p.concurrency > 0);
});

test('예산은 고치기 전 수치를 반드시 실패시킨다 — 잡음 때문에 넉넉히 둔 예산이 고친 회귀까지 덮지 않게', () => {
  const budgets = JSON.parse(readFileSync(join(FF, 'harness', 'perf-budgets.json'), 'utf8')) as { p95Ms: Record<string, number>; beforeFixP95: Record<string, number> };
  assert.ok(Object.keys(budgets.beforeFixP95).length >= 5);
  for (const [id, before] of Object.entries(budgets.beforeFixP95)) {
    const budget = budgets.p95Ms[id];
    assert.equal(typeof budget, 'number', `${id} 예산 없음`);
    assert.ok(budget * PROFILES.full.budgetScale < before, `${id}: 예산 ${budget} ms가 고치기 전 p95 ${before} ms를 통과시킨다`);
  }
});

