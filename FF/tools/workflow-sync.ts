// 담당자 업무 절차(docs/65-workflows) → contracts/src/generated/workflows.ts.
//   node tools/workflow-sync.ts           out/workflows.json에서 생성 모듈을 만든다
//   node tools/workflow-sync.ts --check   생성 모듈이 JSON과 같은지 검사(verify 단계 workflow:check)
// 절차 모델은 같은 저장소(../docs/65-workflows)에 있고 그쪽이 원천이다. JSON은 `python -I scripts/check.py`가 만든다.
// 권한·화면 정합성은 여기서가 아니라 contracts/src/rules/workflows.test.ts(실제 ROUTES 기준)가 검사한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { FF } from './lib.ts';

export const SOURCE = join(FF, '..', 'docs', '65-workflows', 'out', 'workflows.json');
const GENERATED = join(FF, 'contracts', 'src', 'generated', 'workflows.ts');
/** 서버는 211 KB 전체 문서 대신 이 색인(활동·페르소나·역할)만 쓴다 — 같은 JSON에서 생성 */
const GENERATED_INDEX = join(FF, 'backend', 'src', 'generated', 'workflow-index.ts');
/** 메인 화면 절차 지도는 프로세스 메타데이터(13개)만 첫 화면에 싣는다 — 같은 JSON에서 생성 */
const GENERATED_MAP = join(FF, 'contracts', 'src', 'generated', 'workflow-map.ts');
const SCHEMA = 1;

const posix = (p: string) => p.split(sep).join('/');

export function renderWorkflowModule(doc: { schema: number }): string {
  if (doc.schema !== SCHEMA) throw new Error(`workflows.json schema ${doc.schema} — 이 도구는 ${SCHEMA}만 읽는다(tools/workflow-sync.ts와 contracts/src/rules/workflows.ts를 함께 고친다)`);
  return [
    '// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json(업무 절차 모델)에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).',
    "import type { WorkflowDoc } from '../rules/workflows';",
    '',
    `export const WORKFLOWS: WorkflowDoc = ${JSON.stringify(doc, null, 1)};`,
    '',
  ].join('\n');
}

type JsonDoc = {
  schema: number;
  personas: Record<string, string[]>;
  roles: { id: string; name: string; platformRoles: string[] }[];
  processes: { id: string; name: string; group: string; gates: string[]; activities: any[] }[];
};

/** 계약 타입(WorkflowIndexDoc)과 같은 모양 — 서버는 전체 문서를 번들에 넣지 않는다 */
export function indexOf(doc: JsonDoc) {
  if (doc.schema !== SCHEMA) throw new Error(`workflows.json schema ${doc.schema} — 이 도구는 ${SCHEMA}만 읽는다`);
  return {
    schema: doc.schema,
    personas: doc.personas,
    roles: doc.roles.map((r) => ({ id: r.id, name: r.name, platformRoles: r.platformRoles })),
    processes: doc.processes.map((p) => ({ id: p.id, name: p.name })),
    activities: doc.processes.flatMap((p) =>
      p.activities.map((a) => ({
        id: a.id,
        processId: p.id,
        processName: p.name,
        name: a.name,
        trigger: a.trigger,
        gateDecision: a.gateDecision,
        raci: a.raci,
        next: a.next,
        screens: a.platform.screens,
        actions: a.platform.actions,
        anchor: a.platform.anchor ?? null,
        slaHours: a.slaHours ?? null,
      })),
    ),
  };
}

/** 계약 타입(WorkflowMapDoc)과 같은 모양 — 13개 프로세스의 이름·단계·Gate·활동 수 */
export function mapOf(doc: JsonDoc) {
  if (doc.schema !== SCHEMA) throw new Error(`workflows.json schema ${doc.schema} — 이 도구는 ${SCHEMA}만 읽는다`);
  return {
    processes: doc.processes.map((p) => ({ id: p.id, name: p.name, group: p.group, gates: p.gates, activities: p.activities.length })),
  };
}

export function renderMapModule(doc: JsonDoc): string {
  const map = mapOf(doc);
  return [
    '// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).',
    "import type { WorkflowMapDoc } from '../rules/workflows';",
    '',
    `export const WORKFLOW_MAP: WorkflowMapDoc = ${JSON.stringify(map, null, 1)};`,
    '',
  ].join('\n');
}

export function renderIndexModule(doc: JsonDoc): string {
  const index = indexOf(doc);
  return [
    '// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).',
    "import type { WorkflowIndexDoc } from '@ff/contracts';",
    '',
    `export const WORKFLOW_INDEX: WorkflowIndexDoc = ${JSON.stringify(index, null, 1)};`,
    '',
  ].join('\n');
}

const readSource = () => JSON.parse(readFileSync(SOURCE, 'utf8').replace(/^﻿/, ''));

function sync() {
  if (!existsSync(SOURCE)) throw new Error(`업무 절차 JSON이 없습니다: ${SOURCE} — docs/65-workflows에서 python -I scripts/check.py`);
  const doc = readSource();
  mkdirSync(dirname(GENERATED), { recursive: true });
  mkdirSync(dirname(GENERATED_INDEX), { recursive: true });
  mkdirSync(dirname(GENERATED_MAP), { recursive: true });
  writeFileSync(GENERATED, renderWorkflowModule(doc));
  writeFileSync(GENERATED_INDEX, renderIndexModule(doc));
  writeFileSync(GENERATED_MAP, renderMapModule(doc));
  const acts = doc.processes.reduce((n: number, p: { activities: unknown[] }) => n + p.activities.length, 0);
  console.log(`workflow:sync  프로세스 ${doc.processes.length}개 · 활동 ${acts}개 → ${posix(relative(FF, GENERATED))} · ${posix(relative(FF, GENERATED_INDEX))} · ${posix(relative(FF, GENERATED_MAP))}`);
}

function check(): number {
  if (!existsSync(SOURCE)) {
    console.error(`workflow:check  ✗ 업무 절차 JSON 없음: ${posix(relative(FF, SOURCE))}`);
    return 1;
  }
  const doc = readSource();
  const bad: string[] = [];
  if (!existsSync(GENERATED) || readFileSync(GENERATED, 'utf8').replace(/\r\n/g, '\n') !== renderWorkflowModule(doc)) bad.push(posix(relative(FF, GENERATED)));
  if (!existsSync(GENERATED_INDEX) || readFileSync(GENERATED_INDEX, 'utf8').replace(/\r\n/g, '\n') !== renderIndexModule(doc)) bad.push(posix(relative(FF, GENERATED_INDEX)));
  if (!existsSync(GENERATED_MAP) || readFileSync(GENERATED_MAP, 'utf8').replace(/\r\n/g, '\n') !== renderMapModule(doc)) bad.push(posix(relative(FF, GENERATED_MAP)));
  if (bad.length) {
    console.error(`workflow:check  ✗ 생성 모듈이 업무 절차 JSON과 다름(npm run workflow:sync): ${bad.join(', ')}`);
    return 1;
  }
  console.log(`workflow:check  ✓ ${posix(relative(FF, GENERATED))} · ${posix(relative(FF, GENERATED_INDEX))} · ${posix(relative(FF, GENERATED_MAP))} = ${posix(relative(FF, SOURCE))}`);
  return 0;
}

if (posix(process.argv[1] ?? '').endsWith('tools/workflow-sync.ts')) {
  if (process.argv.includes('--check')) process.exit(check());
  sync();
}
