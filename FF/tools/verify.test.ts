// verify 단계 목록 회귀 — 마감 때 켠 엄격 검사·통합 검사가 빠지지 않게 (2026-10-16: conformance가 --strict 없이 돌아 42/42 회귀를 못 막던 문제)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

const src = readFileSync(join(FF, 'tools', 'verify.ts'), 'utf8');
/** 단계 한 줄 — 정규식 대신 문자열 찾기(단계 ID의 '.'·':'를 이스케이프할 일이 없다) */
const step = (id: string) => src.split('\n').find((l) => l.includes(`{ id: '${id}',`))?.trim() ?? '';

test('conformance는 --strict(42/42)로 돈다', () => assert.match(step('conformance'), /conformance\.ts --strict/));
test('통합 검사(고아 모듈·형제 저장소·CARLA 실행기·정적 데모)가 verify에 있다', () => {
  for (const id of ['deadcode', 'siblings', 'sim:test', 'e2e:static', 'budget', 'ext:check', 'ota:conformance', 'test:hygiene']) assert.ok(step(id), id);
});
test('운영 빌드 검사(build:prod)와 SSO e2e(e2e:oidc)가 verify에 있다 — 데모 로그인이 운영 번들에 다시 실리지 않게', () => {
  assert.match(step('build:prod'), /prod-bundle\.test\.ts/);
  assert.match(step('e2e:oidc'), /playwright\.oidc\.config\.ts/);
  assert.ok(src.indexOf("id: 'build:prod'") > src.indexOf("id: 'build:frontend'"), 'build:prod는 build:frontend 뒤(데모 빌드 대조)');
});
test('빈 DB 첫 실행 e2e(e2e:firstrun)가 verify에 있고 화면 빌드 뒤에 돈다 — 출시 준비 RD-OPS-02', () => {
  assert.match(step('e2e:firstrun'), /playwright\.firstrun\.config\.ts/);
  assert.ok(src.indexOf("id: 'e2e:firstrun'") > src.indexOf("id: 'build:frontend'"), 'e2e:firstrun은 build:frontend 뒤(preview로 dist를 띄운다)');
});
test('부하 시험(perf)·브라우저 엔진(e2e:engines)이 verify에 있다 — 출시 준비 RD-P2-01·03', () => {
  assert.match(step('perf'), /tools\/load\/run\.ts --profile light/);
  assert.match(step('perf:full'), /--profile full/);
  assert.match(step('perf:full'), /full: true/);
  assert.match(step('e2e:engines'), /E2E_ALL_ENGINES/);
  assert.ok(src.indexOf("id: 'perf'") < src.indexOf("id: 'e2e',"), 'perf는 e2e 앞(백엔드를 빌드한다)');
});
