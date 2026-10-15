// verify 단계 목록 회귀 — 마감 때 켠 엄격 검사·통합 검사가 빠지지 않게 (2026-10-16: conformance가 --strict 없이 돌아 42/42 회귀를 못 막던 문제)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

const src = readFileSync(join(FF, 'tools', 'verify.ts'), 'utf8');
const step = (id: string) => new RegExp(`\{ id: '${id}',[^\n]*\}`).exec(src)?.[0] ?? '';

test('conformance는 --strict(42/42)로 돈다', () => assert.match(step('conformance'), /conformance\.ts --strict/));
test('통합 검사(고아 모듈·형제 저장소·vECU 사본)가 verify에 있다', () => {
  for (const id of ['deadcode', 'siblings', 'vecu:check']) assert.ok(step(id), id);
});
