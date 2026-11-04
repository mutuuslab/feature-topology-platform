import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, basename } from 'node:path';
import { scanFlagSource, scanGit, repositoryUrl, sourceUrl } from './flag-sources.ts';

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
