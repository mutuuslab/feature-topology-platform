// workflow-sync — 생성 모듈 형식과 스키마 버전 검사.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { workflowIndexOf, workflowMapOf } from '../contracts/src/rules/workflows.ts';
import { indexOf, mapOf, renderIndexModule, renderMapModule, renderWorkflowModule, SOURCE } from './workflow-sync.ts';

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

test('메인 화면 지도 메타데이터는 contracts의 workflowMapOf와 같다 — 13개 프로세스만 담는다', () => {
  const doc = JSON.parse(readFileSync(SOURCE, 'utf8'));
  assert.deepEqual(mapOf(doc), workflowMapOf(doc));
  assert.equal(mapOf(doc).processes.length, 13);
  assert.match(renderMapModule(doc), /export const WORKFLOW_MAP: WorkflowMapDoc = /);
});
