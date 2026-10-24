// npm run flaky — 시험 파일 위치로 실행 방법을 고른다(vitest 작업 공간·Playwright 설정·node --test).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { planFor } from './flaky.ts';
import { FF } from './lib.ts';

test('backend·contracts·frontend는 그 작업 공간에서 vitest run, 매 회 새 프로세스', () => {
  const p = planFor('backend/test/d04/ota-server.spec.ts', 5);
  assert.equal(p.cwd, join(FF, 'backend'));
  assert.match(p.cmd, /vitest run test\/d04\/ota-server\.spec\.ts$/);
  assert.equal(p.selfRepeating, false);
  assert.match(planFor('frontend/src/__tests__/largeLists.test.tsx', 3, 'DataTable').cmd, /-t DataTable$/);
});

test('e2e는 폴더에 맞는 Playwright 설정과 --repeat-each N(서버는 한 번)', () => {
  const p = planFor('e2e/static/static.spec.ts', 4);
  assert.equal(p.cwd, join(FF, 'e2e'));
  assert.match(p.cmd, /-c playwright\.static\.config\.ts static\/static\.spec\.ts --repeat-each 4 --retries 0/);
  assert.equal(p.selfRepeating, true);
  assert.match(planFor('e2e/tests/dashboard.spec.ts', 2).cmd, /-c playwright\.config\.ts tests\/dashboard\.spec\.ts/);
  assert.match(planFor('e2e/oidc/sso.spec.ts', 2).cmd, /playwright\.oidc\.config\.ts/);
});

test('tools 시험은 node --test, 모르는 위치는 거부', () => {
  assert.match(planFor('tools/verify.test.ts', 2).cmd, /^node --test tools\/verify\.test\.ts$/);
  assert.throws(() => planFor('docs/x.md', 2), /알 수 없는 시험 위치/);
});
