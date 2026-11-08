// workflow-sync — 생성 모듈 형식과 스키마 버전 검사.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workflowIndexOf, workflowMapOf } from '../contracts/src/rules/workflows.ts';
import { indexOf, mapOf, renderIndexModule, renderMapModule, renderWorkflowModule, renderLazyModules, SOURCE } from './workflow-sync.ts';

test('스키마 버전이 다르면 생성하지 않는다(타입과 데이터가 어긋나지 않게)', () => {
  assert.throws(() => renderWorkflowModule({ schema: 2 }), /schema 2/);
});

test('같은 JSON이면 같은 모듈 — 머리말은 손으로 고치지 말라고 알린다', () => {
  const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const a = renderWorkflowModule(doc);
  assert.equal(a, renderWorkflowModule(JSON.parse(JSON.stringify(doc))));
  assert.match(a.split('\n')[0], /생성 파일 — tools\/workflow-sync\.ts/);
  assert.match(a, /export const WORKFLOWS: WorkflowDoc = /);
});

test('서버 색인은 contracts의 workflowIndexOf와 같은 모양이다(두 구현이 갈라지지 않게)', () => {
  const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));
  assert.deepEqual(indexOf(doc), workflowIndexOf(doc));
  const mod = renderIndexModule(doc);
  assert.match(mod, /export const WORKFLOW_INDEX: WorkflowIndexDoc = /);
});

test('메인 화면 지도 메타데이터는 contracts의 workflowMapOf와 같다 — 18개 프로세스를 모두 담는다', () => {
  const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));
  assert.deepEqual(mapOf(doc), workflowMapOf(doc));
  assert.equal(mapOf(doc).processes.length, 18);
  assert.match(renderMapModule(doc), /export const WORKFLOW_MAP: WorkflowMapDoc = /);
});

test('분할 지연 데이터는 전체 모델을 손실 없이 재구성한다 — 상세·RACI·추적·좌표를 보존한다', () => {
  const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const modules = renderLazyModules(doc);
  const json = (source: string) => JSON.parse(source.slice(source.indexOf(' = ') + 3).trim().replace(/;$/, ''));
  const reconstructed = { ...json(modules['workflow-header.ts']), processes: doc.processes.map((p: { id: string }) => json(modules[`workflow-process-${p.id.toLowerCase().replace('.', '-')}.ts`])) };
  assert.deepEqual(reconstructed, doc);
  assert.equal(Object.keys(modules).length, doc.processes.length + 3);
  assert.deepEqual(json(modules['workflow-index.ts']), workflowIndexOf(doc));
  assert.doesNotMatch(modules['workflow-index.ts'], /basePractices|definition|workProducts/);
  assert.equal((modules['workflow-loader.ts'].match(/import\('\.\/workflow-process-/g) ?? []).length, doc.processes.length);
  assert.doesNotMatch(modules['workflow-loader.ts'], /generated\/workflows|https?:|[A-Z]:\\/);
});

test('분할 파일 경로를 임의 ID로 만들거나 같은 프로세스를 덮어쓰지 않는다', () => {
  const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));
  assert.throws(() => renderLazyModules({ ...doc, processes: [{ ...doc.processes[0], id: '../escape' }] }), /Invalid workflow process ID/);
  assert.throws(() => renderLazyModules({ ...doc, processes: [doc.processes[0], doc.processes[0]] }), /Duplicate workflow process ID/);
});
