import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishDemoUi } from './demo-publish.ts';

test('open tabs retain their old chunks while new entry documents reference published new assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'ff-ui-release-')), source = join(root, 'build'), target = join(root, 'served');
  mkdirSync(join(source, 'assets'), { recursive: true }); mkdirSync(join(target, 'assets'), { recursive: true });
  writeFileSync(join(target, 'assets', 'Impact-old.js'), 'old module'); writeFileSync(join(source, 'assets', 'Impact-new.js'), 'new module'); writeFileSync(join(source, 'index.html'), '<script src="/assets/Impact-new.js"></script>');
  const proof = publishDemoUi(source, target);
  assert.equal(readFileSync(join(target, 'assets', 'Impact-old.js'), 'utf8'), 'old module');
  assert.equal(readFileSync(join(target, 'assets', 'Impact-new.js'), 'utf8'), 'new module');
  assert.match(readFileSync(join(target, 'index.html'), 'utf8'), /Impact-new/); assert.equal(proof.previousAssetsRetained, true);
});

test('incomplete or overlapping releases are rejected before changing the running entry document', () => {
  const root = mkdtempSync(join(tmpdir(), 'ff-ui-reject-')), source = join(root, 'incomplete'), target = join(root, 'served');
  mkdirSync(source); mkdirSync(target); writeFileSync(join(target, 'index.html'), 'running');
  assert.throws(() => publishDemoUi(source, target), /Complete/);
  assert.throws(() => publishDemoUi(target, join(target, 'nested')), /separate/);
  assert.equal(readFileSync(join(target, 'index.html'), 'utf8'), 'running');
});

test('missing local entry assets are rejected before overwriting a running UI', () => {
  const root = mkdtempSync(join(tmpdir(), 'ff-ui-entry-reject-')), source = join(root, 'build'), target = join(root, 'served');
  mkdirSync(join(source, 'assets'), { recursive: true }); mkdirSync(target); writeFileSync(join(target, 'index.html'), 'running');
  writeFileSync(join(source, 'index.html'), '<script type="module" src="/assets/main-missing.js"></script>');
  assert.throws(() => publishDemoUi(source, target), /Missing local UI asset/);
  assert.equal(readFileSync(join(target, 'index.html'), 'utf8'), 'running');
});

test('missing transitive JavaScript and CSS assets are rejected before any copy', () => {
  for (const [file, content] of [['main.js', 'export const open=()=>import("./lazy-missing.js");'], ['main.css', '@font-face{src:url("./font-missing.woff2")}']]) {
    const root = mkdtempSync(join(tmpdir(), 'ff-ui-dependency-reject-')), source = join(root, 'build'), target = join(root, 'served');
    mkdirSync(join(source, 'assets'), { recursive: true }); mkdirSync(target); writeFileSync(join(target, 'index.html'), 'running');
    writeFileSync(join(source, 'index.html'), file.endsWith('.js') ? `<script type="module" src="/assets/${file}"></script>` : `<link rel="stylesheet" href="/assets/${file}">`);
    writeFileSync(join(source, 'assets', file), content);
    assert.throws(() => publishDemoUi(source, target), /Missing local UI asset/);
    assert.equal(readFileSync(join(target, 'index.html'), 'utf8'), 'running');
  }
});

test('a complete cyclic module and CSS resource graph publishes entries without leftover staging files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ff-ui-graph-')), source = join(root, 'build'), target = join(root, 'served');
  mkdirSync(join(source, 'assets'), { recursive: true }); mkdirSync(target); writeFileSync(join(target, 'index.html'), 'running');
  writeFileSync(join(source, 'index.html'), '<script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="./assets/main.css?v=1">');
  writeFileSync(join(source, 'external.html'), '<script src="./assets/shared.js"></script>');
  writeFileSync(join(source, 'assets', 'main.js'), 'import "./shared.js"; export const x=1; export const open=()=>import("./lazy.js?v=1#module");');
  writeFileSync(join(source, 'assets', 'shared.js'), 'import {x} from "./main.js"; export const read=()=>x;');
  writeFileSync(join(source, 'assets', 'lazy.js'), 'export default true;');
  writeFileSync(join(source, 'assets', 'main.css'), '@import "./palette.css";');
  writeFileSync(join(source, 'assets', 'palette.css'), '.page{background-image:url("./pixel.svg?v=1#icon")}');
  writeFileSync(join(source, 'assets', 'pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" id="icon"/>');
  const proof = publishDemoUi(source, target);
  assert.equal(proof.filesCopied, 8);
  assert.match(readFileSync(join(target, 'index.html'), 'utf8'), /main.js/);
  assert.match(readFileSync(join(target, 'external.html'), 'utf8'), /shared.js/);
  assert.deepEqual(readdirSync(target).filter(name => name.startsWith('.ff-ui-')), []);
});

test('a broken secondary HTML entry cannot replace either running entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'ff-ui-secondary-reject-')), source = join(root, 'build'), target = join(root, 'served');
  mkdirSync(join(source, 'assets'), { recursive: true }); mkdirSync(target);
  writeFileSync(join(target, 'index.html'), 'running main'); writeFileSync(join(target, 'external.html'), 'running external');
  writeFileSync(join(source, 'index.html'), '<script src="/assets/main.js"></script>'); writeFileSync(join(source, 'assets', 'main.js'), 'export {};');
  writeFileSync(join(source, 'external.html'), '<script src="/assets/external-missing.js"></script>');
  assert.throws(() => publishDemoUi(source, target), /Missing local UI asset/);
  assert.equal(readFileSync(join(target, 'index.html'), 'utf8'), 'running main');
  assert.equal(readFileSync(join(target, 'external.html'), 'utf8'), 'running external');
  assert.deepEqual(readdirSync(target).filter(name => name.startsWith('.ff-ui-')), []);
});
