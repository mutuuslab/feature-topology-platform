// vECU 동기화 허용 목록 — 웹 실행 파일만, 약관·로컬 전용 자산은 어떤 경우에도 빠진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driftOf, selectFiles, sha } from './vecu-sync.ts';

test('허용 목록만 고르고, 실사 스플랫·로컬 전용 모델·도구·시험·문서는 뺀다', () => {
  const all = [
    'index.html', 'js/main.js', 'js/features/feat00022.js', 'js/vendor/ff_evaluate.js', 'ff/FEAT-00022_sample.json',
    'assets/car.glb.b64.txt', 'assets/user/ioniq6.glb', 'assets/user/x.b64.txt',
    'splat/nurec_3a42.aspl', 'splat/scene.json', 'splat_test.html', 'tools/ffval_cli.mjs', 'tools/nurec_scene.py',
    'tests/js/ffval_cli.test.mjs', 'harness/ref/a.png', 'docs/FF_VIRTUAL_VALIDATION.md', 'run_sil.py', 'CLAUDE.md', 'js/nurec_loader.js',
  ];
  assert.deepEqual(selectFiles(all), ['assets/car.glb.b64.txt', 'ff/FEAT-00022_sample.json', 'index.html', 'js/features/feat00022.js', 'js/main.js', 'js/vendor/ff_evaluate.js']);
});

test('해시는 줄끝과 무관 — Windows 체크아웃(CRLF)과 CI 체크아웃(LF)이 같은 매니페스트를 통과한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vecu-eol-'));
  writeFileSync(join(dir, 'a.js'), 'const a = 1;\r\nconst b = 2;\r\n');
  writeFileSync(join(dir, 'b.js'), 'const a = 1;\nconst b = 2;\n');
  assert.equal(sha(join(dir, 'a.js')), sha(join(dir, 'b.js')));
});

// 회귀(2026-10-16): vECU 원본의 평가기 사본(js/vendor/ff_evaluate.js)이 다시 만들어졌는데 사이트 사본은 예전 것 — 매니페스트 비교만으로는 못 잡았다
test('원본 대비 낡음 — 바뀐 파일·새 파일·없어진 파일을 찾고, 같으면 비어 있다', () => {
  assert.deepEqual(driftOf({ 'index.html': 'a', 'js/x.js': 'b' }, { 'index.html': 'a', 'js/x.js': 'b' }), []);
  assert.deepEqual(driftOf({ 'index.html': 'a', 'js/vendor/ff_evaluate.js': 'NEW', 'js/new.js': 'c' }, { 'index.html': 'a', 'js/vendor/ff_evaluate.js': 'OLD', 'js/gone.js': 'd' }), [
    '원본에 새 파일: js/new.js',
    '원본에서 없어짐: js/gone.js',
    '원본이 바뀜: js/vendor/ff_evaluate.js',
  ]);
});
