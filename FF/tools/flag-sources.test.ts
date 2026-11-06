import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, basename, dirname } from 'node:path';
import { scanFlagSource, scanGit, scanGitV2, repositoryUrl, sourceUrl } from './flag-sources.ts';
import { scanFlagFiles } from '../backend/src/domains/d01-policy/flag-code/scanner.ts';

// ── v2(20-97 §1.3) — 상수 해석·동적 키 위치 ──
const FLAGS = "export const CARE_00022_PARAM = 'care_00022_param' as const;\nexport const IVI_LIST = 'ivi_00027_voice';\nconst LOCAL_ONLY = 'not_exported';\n";
const GUARDS = [
  "import { CARE_00022_PARAM, IVI_LIST as VOICE } from './flags.ts';",
  "import { LOCAL_ONLY } from './flags';",
  "const SAME = 'care_00022_signal';",
  'let MUTABLE = SAME;',
  "export const a = (c, ctx) => c.getBooleanValue(CARE_00022_PARAM, false, ctx);",
  'export const b = (c) => c.isEnabled(VOICE);',
  'export const d = (c) => c.getBooleanValue(SAME, false);',
  'export const e = (c) => c.getBooleanValue(MUTABLE, false);',
  'export const f = (c, n) => c.getBooleanValue(`ivi_${n}_x`, false);',
  'export const g = (c) => c.getBooleanValue(LOCAL_ONLY, false);',
  "export const h = (c, SAME) => c.getBooleanValue(SAME, false);",
  "export const i = (c) => c.getBooleanValue('literal_key', true);",
].join('\n');

test('v2: 같은 파일·상대 import 상수(as const 포함)를 키로 풀고 via를 남긴다', () => {
  const r = scanFlagFiles([{ path: 'packages/adas/src/f/flags.ts', source: FLAGS }, { path: 'packages/adas/src/f/flag-guards.ts', source: GUARDS }]);
  assert.deepEqual(r.usages.map((u) => [u.flagKey, u.line, u.via, u.safeDefault]), [
    ['care_00022_param', 5, 'CONST', 'EXPLICIT_FALSE'],
    ['ivi_00027_voice', 6, 'CONST', 'SDK_DEFAULT'],
    ['care_00022_signal', 7, 'CONST', 'EXPLICIT_FALSE'],
    ['literal_key', 12, 'LITERAL', 'UNCONFIRMED'],
  ]);
});

test('v2: 재할당 가능한 let·템플릿 치환·내보내지 않은 상수·가려진 이름은 동적 키 위치로 남는다', () => {
  const r = scanFlagFiles([{ path: 'packages/adas/src/f/flags.ts', source: FLAGS }, { path: 'packages/adas/src/f/flag-guards.ts', source: GUARDS }]);
  assert.deepEqual(r.unresolved.map((u) => [u.path, u.line, u.symbol, u.method]), [
    ['packages/adas/src/f/flag-guards.ts', 8, 'c.getBooleanValue', 'getBooleanValue'],
    ['packages/adas/src/f/flag-guards.ts', 9, 'c.getBooleanValue', 'getBooleanValue'],
    ['packages/adas/src/f/flag-guards.ts', 10, 'c.getBooleanValue', 'getBooleanValue'],
    ['packages/adas/src/f/flag-guards.ts', 11, 'c.getBooleanValue', 'getBooleanValue'],
  ]);
});

test('v2: 문자열 리터럴 호출의 줄·내용 해시·기본값 분류는 v1과 같다', () => {
  const source = "client.getBooleanValue('care_signal', false);\n\nclient.isEnabled('x_key');\nclient.getBooleanValue(dyn, false);\n";
  const v1 = scanFlagSource(source, 'src/a.ts');
  const v2 = scanFlagFiles([{ path: 'src/a.ts', source }]);
  assert.deepEqual(v2.usages.map(({ via: _via, ...u }) => u), v1.usages);
  assert.equal(v2.unresolved.length, v1.unresolved);
});

test('v2: Git 커밋을 묶음으로 스캔해 브랜치·스캐너·unresolved를 싣는다', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'ff-flags-git-'));
  t.after(() => rmSync(realpathSync(repo), { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${repo.replace(/\\/g, '/')}`, '-c', 'user.name=Flag harness', '-c', 'user.email=flag-harness@example.invalid', '-C', repo, ...args], { stdio: 'pipe' });
  git('init', '--initial-branch=main');
  for (const [p, s] of [['packages/adas/src/f/flags.ts', FLAGS], ['packages/adas/src/f/flag-guards.ts', GUARDS]]) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), s);
  }
  git('add', '-A');
  git('commit', '-m', 'v2');
  const m = scanGitV2(repo, 'https://github.com/mutuuslab/vehicle-feature-apps', 'HEAD', [], undefined, '2026-11-06T00:00:00+09:00');
  assert.equal(m.format, 'ff-flag-source/v2');
  assert.equal(m.ref, 'main');
  assert.equal(m.provider, 'GITHUB');
  assert.equal(m.scannedAt, '2026-11-05T15:00:00.000Z');
  assert.equal(m.filesScanned, 2);
  assert.equal(m.usages.filter((u) => u.via === 'CONST').length, 3);
  assert.equal(m.unresolved.length, 4);
});

test('실제 SDK 호출만 찾고 주석·설명 문자열을 제외한다. 동적 키와 안전 기본값 미확인을 알린다', () => {
  const source = `// client.getBooleanValue('comment', false)\nconst doc = "client.isEnabled('text')";\nclient.getBooleanValue('care_signal', false);\nclient.getBooleanValue('unsafe', true);\nclient.isEnabled(unknownKey);`;
  const result = scanFlagSource(source, 'src/feature.ts');
  assert.deepEqual(result.usages.map((u) => [u.flagKey, u.line, u.safeDefault]), [['care_signal', 3, 'EXPLICIT_FALSE'], ['unsafe', 4, 'UNCONFIRMED']]);
  assert.equal(result.unresolved, 1);
});

test('저장소 링크는 비밀값을 허용하지 않고 코드 경로와 줄을 정확히 인코딩한다', () => {
  for (const url of ['https://user:secret@gitlab.example/a/b', 'https://gitlab.example/a?token=secret', 'http://gitlab.example/a']) assert.throws(() => repositoryUrl(url));
  assert.equal(sourceUrl('GITLAB', 'https://gitlab.example/team/repo.git', 'a'.repeat(40), 'src/한 글.ts', 7), `https://gitlab.example/team/repo/-/blob/${'a'.repeat(40)}/src/%ED%95%9C%20%EA%B8%80.ts#L7`);
});

test('Git의 확정 커밋에서 읽으므로 미커밋 수정·추가 파일은 결과를 바꾸지 않는다', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'ff-flags-git-'));
  t.after(() => {
    const base = realpathSync(tmpdir());
    const target = realpathSync(repo);
    assert.ok(target.startsWith(base + sep) && basename(target).startsWith('ff-flags-git-'));
    rmSync(target, { recursive: true, force: true });
  });
  const git = (...args: string[]) => execFileSync('git', ['-c', `safe.directory=${repo.replace(/\\/g, '/')}`, '-c', 'user.name=Flag harness', '-c', 'user.email=flag-harness@example.invalid', '-C', repo, ...args], { stdio: 'pipe' });
  git('init', '--initial-branch=main');
  writeFileSync(join(repo, 'feature.ts'), "client.getBooleanValue('care_signal', false);\n");
  git('add', '--', 'feature.ts');
  git('commit', '-m', '소스 추적 시험');
  const commit = git('rev-parse', 'HEAD').toString().trim();
  writeFileSync(join(repo, 'feature.ts'), "client.getBooleanValue('dirty', true);\n");
  writeFileSync(join(repo, 'untracked.ts'), "client.isEnabled('untracked');\n");
  const manifest = scanGit(repo, 'https://gitlab.example/vehicle/controller');
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.filesScanned, 1);
  assert.deepEqual(manifest.usages.map((u) => u.flagKey), ['care_signal']);
  assert.match(manifest.usages[0].contentHash, /^sha256:[a-f0-9]{64}$/);
});
