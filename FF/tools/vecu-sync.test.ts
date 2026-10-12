// vECU 동기화 허용 목록 — 웹 실행 파일만, 약관·로컬 전용 자산은 어떤 경우에도 빠진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFiles } from './vecu-sync.ts';

test('허용 목록만 고르고, 실사 스플랫·로컬 전용 모델·도구·시험·문서는 뺀다', () => {
  const all = [
    'index.html', 'js/main.js', 'js/features/feat00022.js', 'js/vendor/ff_evaluate.js', 'ff/FEAT-00022_sample.json',
    'assets/car.glb.b64.txt', 'assets/user/ioniq6.glb', 'assets/user/x.b64.txt',
    'splat/nurec_3a42.aspl', 'splat/scene.json', 'splat_test.html', 'tools/ffval_cli.mjs', 'tools/nurec_scene.py',
    'tests/js/ffval_cli.test.mjs', 'harness/ref/a.png', 'docs/FF_VIRTUAL_VALIDATION.md', 'run_sil.py', 'CLAUDE.md', 'js/nurec_loader.js',
  ];
  assert.deepEqual(selectFiles(all), ['assets/car.glb.b64.txt', 'ff/FEAT-00022_sample.json', 'index.html', 'js/features/feat00022.js', 'js/main.js', 'js/vendor/ff_evaluate.js']);
});
