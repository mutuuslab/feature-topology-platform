// verify 단계 목록 회귀 — 마감 때 켠 엄격 검사·통합 검사가 빠지지 않게 (2026-10-16: conformance가 --strict 없이 돌아 42/42 회귀를 못 막던 문제)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, rel, SKIP_EXIT, walk } from './lib.ts';
import { ALLOWED_SKIP, outcome, resolveOnly, scriptAliases, skipOutcome, STEPS, type Step } from './verify.ts';

const src = readFileSync(join(FF, 'tools', 'verify.ts'), 'utf8');
/** 단계 한 줄 — 정규식 대신 문자열 찾기(단계 ID의 '.'·':'를 이스케이프할 일이 없다) */
const step = (id: string) => src.split('\n').find((l) => l.includes(`{ id: '${id}',`))?.trim() ?? '';

test('conformance는 --strict(42/42)로 돈다', () => assert.match(step('conformance'), /conformance\.ts --strict/));
test('통합 검사(고아 모듈·형제 저장소·CARLA 실행기·정적 데모)가 verify에 있다', () => {
  for (const id of ['deadcode', 'siblings', 'sim:test', 'e2e:static', 'budget', 'ext:check', 'ota:conformance', 'test:hygiene', 'packaging']) assert.ok(step(id), id);
});
test('packaging은 실제 백엔드 빌드·스냅샷 생성 뒤 같은 검사를 돈다 — 클린 체크아웃의 잔존 파일 의존 금지', () => {
  const packaging = STEPS.find((s) => s.id === 'packaging')!;
  const commands = packaging.cmd.replace(/\bnpm\.cmd\b/g, 'npm').split(/\s*&&\s*/);
  const build = commands.indexOf('npm run build -w feature-topology-backend');
  const snapshot = commands.indexOf('node tools/snapshot-api.ts');
  const check = commands.indexOf('node --test tools/packaging.test.mjs tools/demo-publish.test.ts');
  assert.ok(build >= 0, '빌드된 백엔드를 로컬 잔존물로 가정하지 않는다');
  assert.ok(snapshot > build, '실제 스냅샷 생성은 백엔드 빌드 성공 뒤에 돈다');
  assert.ok(check > snapshot, 'packaging 검사는 실제 스냅샷 생성 성공 뒤에 돈다');
  assert.equal(packaging.full, undefined, '기본 CI verify에서도 실행한다');
  assert.equal(packaging.when, undefined, '스냅샷 부재를 skip하지 않는다');
  assert.ok(STEPS.findIndex((s) => s.id === 'contracts:build') < STEPS.indexOf(packaging), '전체 verify는 contracts를 먼저 빌드한다');
});
test('flag-code:check는 openfeature:check 뒤에서 생성기 시험 → 백엔드 빌드 → --check 순으로 돈다 — 20-97 §8.1', () => {
  const s = STEPS.find((x) => x.id === 'flag-code:check')!;
  assert.ok(s, 'flag-code:check 단계가 있다');
  assert.equal(STEPS.indexOf(s), STEPS.findIndex((x) => x.id === 'openfeature:check') + 1, 'openfeature:check 바로 뒤');
  const commands = s.cmd.replace(/\bnpm\.cmd\b/g, 'npm').split(/\s*&&\s*/);
  const unit = commands.indexOf('node --test tools/flag-code/generate-vehicle-apps.test.ts');
  const build = commands.indexOf('npm run build -w feature-topology-backend');
  const check = commands.indexOf('node tools/flag-code/generate-vehicle-apps.ts --check');
  assert.ok(unit >= 0 && build > unit && check > build, '빌드된 백엔드를 잔존물로 가정하지 않고 --check 앞에서 만든다');
  // 생성기·백엔드는 contracts dist를 읽는다 — --only로 이 단계만 돌려도 판정 규칙(rules/flag-coverage.ts) 변경을 잡도록 먼저 빌드한다
  assert.equal(commands[0], 'npm run build --workspace @ff/contracts', 'contracts를 맨 먼저 빌드한다(잔존 dist로 판정하지 않는다)');
  assert.equal(s.full, undefined, '기본 CI verify에서도 실행한다');
  assert.equal(s.when, undefined, '건너뛰지 않는다');
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

test('클라우드 VM 공개 시연 키트 시험이 verify에 있다 — 게이트 우회 방지가 CI의 Docker 작업에만 묶이지 않게(20-99)', () => {
  assert.match(step('cloud:check'), /deploy\/cloud-vm\/test\/compose\.test\.mjs/);
});

// ── 도구 시험 목록 — 새 tools 시험 파일이 verify·CI에서 돌지 않고 묻히지 않게(2026-11-04: refdb/check.test.ts가 어느 단계에도 없었다)
/** verify 단계에 넣지 않는 도구 시험과 이유 */
const NOT_IN_VERIFY: Record<string, string> = {
  'tools/desktop-smoke.test.mjs': 'Windows 패키지 런타임(src-tauri/resources의 node.exe·자산)이 있어야 한다 — desktop:prepare 뒤 tauri beforeBuildCommand가 돌린다',
};
/** STEP 명령에 경로가 없고 NOT_IN_VERIFY에도 없는 시험 파일 */
export function unlistedTests(files: string[], steps: Pick<Step, 'cmd'>[], notIn: Record<string, string>): string[] {
  return files.filter((f) => !steps.some((s) => s.cmd.includes(f)) && !notIn[f]);
}
const toolTests = () => walk(join(FF, 'tools'), ['.test.ts', '.test.mjs'], ['node_modules']).map(rel).sort();

test('tools의 모든 시험 파일은 어떤 verify 단계에서 돌거나 NOT_IN_VERIFY에 이유가 있다', () => {
  const files = toolTests();
  assert.ok(files.length >= 25, `시험 파일이 너무 적다: ${files.length}`);
  assert.deepEqual(unlistedTests(files, STEPS, NOT_IN_VERIFY), []);
  for (const f of Object.keys(NOT_IN_VERIFY)) assert.ok(files.includes(f), `NOT_IN_VERIFY의 ${f}가 없다 — 목록에서 지운다`);
});
test('목록 검사는 단계에 없는 새 시험 파일을 잡는다', () => {
  const files = [...toolTests(), 'tools/refdb/new-check.test.ts'];
  assert.deepEqual(unlistedTests(files, STEPS, NOT_IN_VERIFY), ['tools/refdb/new-check.test.ts']);
  // 회귀: data:check에서 refdb 시험을 빼면 잡힌다
  const without = STEPS.map((s) => ({ cmd: s.cmd.replace(' tools/refdb/check.test.ts', '') }));
  assert.deepEqual(unlistedTests(toolTests(), without, NOT_IN_VERIFY), ['tools/refdb/check.test.ts']);
});

// ── --only 해석
test('--only 모르는 ID는 오류이고 가장 가까운 ID를 제안한다', () => {
  const r = resolveOnly(['--only', 'lint:copi'], STEPS, {});
  assert.equal(r.only, null);
  assert.match(r.error ?? '', /모르는 단계 'lint:copi' — 혹시 'lint:copy'\?/);
  assert.match(resolveOnly(['--only', 'lint:copy,nope'], STEPS, {}).error ?? '', /'nope'/);
});
test('--only 값이 없으면 분명한 오류(TypeError가 아니라)', () => {
  for (const args of [['--only'], ['--only', '--full'], ['--only=']]) assert.match(resolveOnly(args, STEPS, {}).error ?? '', /--only 다음에 단계 ID/, args.join(' '));
});
test('--only는 단계 ID와 npm 스크립트 이름(별칭)을 받는다', () => {
  const aliases = scriptAliases(JSON.parse(readFileSync(join(FF, 'package.json'), 'utf8')).scripts);
  assert.deepEqual(aliases['build:contracts'], ['contracts:build']);
  assert.deepEqual(aliases['refdb:check'], ['data:check']);
  assert.ok(aliases['ads:check']?.includes('ads'));
  const r = resolveOnly(['--only', 'build:contracts,lint:copy,refdb:check'], STEPS, aliases);
  assert.equal(r.error, undefined);
  assert.deepEqual([...r.only!].sort(), ['contracts:build', 'data:check', 'lint:copy']);
  assert.deepEqual([...resolveOnly(['--only=test:hygiene'], STEPS, aliases).only!], ['test:hygiene']);
  assert.equal(resolveOnly(['--full'], STEPS, aliases).only, null);
});
test('verify --only 모르는 ID·빈 값은 종료 2(0단계 "통과"가 아니라)', () => {
  for (const extra of [['--only', 'no-such-step'], ['--only']]) {
    const r = spawnSync(process.execPath, [join(FF, 'tools', 'verify.ts'), ...extra], { cwd: FF, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /verify 통과/);
  }
});

// ── 건너뜀(SKIP) 약속
test('종료 77은 SKIP — CI에서는 ALLOWED_SKIP 단계만 건너뛸 수 있고 나머지는 FAIL', () => {
  assert.deepEqual(outcome({ id: 'lint:copy' }, 0, true), { status: 'PASS' });
  assert.equal(outcome({ id: 'lint:copy' }, 1, false).status, 'FAIL');
  assert.equal(outcome({ id: 'sim:test' }, SKIP_EXIT, false).status, 'SKIP');
  assert.equal(outcome({ id: 'sim:test' }, SKIP_EXIT, true).status, 'SKIP');
  assert.equal(outcome({ id: 'lint:copy' }, SKIP_EXIT, false).status, 'SKIP');
  assert.equal(outcome({ id: 'lint:copy' }, SKIP_EXIT, true).status, 'FAIL');
  assert.equal(skipOutcome({ id: 'e2e:static' }, '아직 없음', true).status, 'FAIL');
  assert.equal(skipOutcome({ id: 'e2e:static' }, '아직 없음', false).status, 'SKIP');
  for (const id of Object.keys(ALLOWED_SKIP)) assert.ok(STEPS.some((s) => s.id === id), `ALLOWED_SKIP ${id}가 단계에 없다`);
});
test('부트스트랩 when 가드는 파일이 생기면 지운다 — 남아 있는 가드는 지금도 거짓이어야 한다', () => {
  for (const s of STEPS) if (s.when) assert.equal(s.when(), false, `${s.id}: when 가드가 이미 참 — 지운다`);
});
test('스스로 건너뛰는 도구(CARLA pytest·형제 저장소)는 verify 안에서 종료 77, 직접 돌리면 0', () => {
  const run = (args: string[], env: Record<string, string>) => spawnSync(process.execPath, args, { cwd: FF, encoding: 'utf8', env: { ...process.env, ...env } }).status;
  const nowhere = join(FF, '.sim', 'no-such-sibling');
  assert.equal(run([join(FF, 'tools', 'carla-doctor.ts'), '--pytest'], { CARLA_PYTHON: join(nowhere, 'python.exe'), FF_VERIFY: '1' }), SKIP_EXIT);
  assert.equal(run([join(FF, 'tools', 'carla-doctor.ts'), '--pytest'], { CARLA_PYTHON: join(nowhere, 'python.exe'), FF_VERIFY: '' }), 0);
  assert.equal(run([join(FF, 'tools', 'siblings.ts')], { FF_IMP_DIR: nowhere, FF_VERIFY: '1' }), SKIP_EXIT);
  assert.equal(run([join(FF, 'tools', 'siblings.ts')], { FF_IMP_DIR: nowhere, FF_VERIFY: '' }), 0);
});
