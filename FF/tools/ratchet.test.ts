// 래칫 지표를 쓰는 도구는 모두 tools/ratchet.ts 목록에 있어야 한다 — 빠지면 개선값을 --update로 잠글 수 없다(standards가 빠졌던 회귀)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

test('ratchet()을 부르는 도구가 모두 npm run ratchet 목록에 있다', () => {
  const runner = readFileSync(join(FF, 'tools', 'ratchet.ts'), 'utf8');
  const users = readdirSync(join(FF, 'tools'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !['lib.ts', 'ratchet.ts'].includes(f))
    .filter((f) => /\bratchet\(/.test(readFileSync(join(FF, 'tools', f), 'utf8')));
  assert.deepEqual(users.filter((f) => !runner.includes(`'tools/${f}'`)), []);
});
