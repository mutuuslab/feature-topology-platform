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
/** 셸(부서 전환·부서 메뉴)은 부서 이름·화면 유형·데모 계정·화면 목록만 첫 화면에 싣는다 — 같은 JSON에서 생성 */
const GENERATED_DEPTS = join(FF, 'contracts', 'src', 'generated', 'departments.ts');
const EXECUTION_SERVER = join(FF, 'backend', 'src', 'generated', 'workflow-execution-model.ts');
const EXECUTION_BROWSER = join(FF, 'contracts', 'src', 'generated', 'workflow-execution-model.ts');
const GENERATED_DIR = dirname(GENERATED);
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

/** Browser data is split at process boundaries. No definition or evidence link is dropped. */
export function renderLazyModules(doc: JsonDoc): Record<string, string> {
  if (doc.schema !== SCHEMA) throw new Error(`workflows.json schema ${doc.schema}`);
  const names = doc.processes.map((p) => {
    if (!/^FPW\.[1-9][0-9]*$/.test(p.id)) throw new Error(`Invalid workflow process ID: ${p.id}`);
    return `workflow-process-${p.id.toLowerCase().replace('.', '-')}`;
  });
  if (new Set(names).size !== names.length) throw new Error('Duplicate workflow process ID');
  const generated = '// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.\n';
  const { processes, ...header } = doc;
  const modules: Record<string, string> = {
    'workflow-index.ts': generated + "import type { WorkflowIndexDoc } from '../rules/workflows';\n" + `export const WORKFLOW_INDEX: WorkflowIndexDoc = ${JSON.stringify(indexOf(doc), null, 1)};\n`,
    'workflow-header.ts': generated + "import type { WorkflowDoc } from '../rules/workflows';\n" + `export const WORKFLOW_HEADER: Omit<WorkflowDoc, 'processes'> = ${JSON.stringify(header, null, 1)};\n`,
    'workflow-loader.ts': generated + "import type { WorkflowDoc } from '../rules/workflows';\nimport { WORKFLOW_HEADER } from './workflow-header';\n" +
      `export async function loadWorkflowDocument(): Promise<WorkflowDoc> {\n const modules = await Promise.all([\n${names.map((n) => `  import('./${n}'),`).join('\n')}\n ]);\n return { ...WORKFLOW_HEADER, processes: modules.map((m) => m.PROCESS) };\n}\n`,
  };
  processes.forEach((p, n) => {
    modules[`${names[n]}.ts`] = generated + "import type { WorkflowProcess } from '../rules/workflows';\n" + `export const PROCESS: WorkflowProcess = ${JSON.stringify(p, null, 1)};\n`;
  });
  return modules;
}

type JsonDoc = {
  schema: number;
  personas: Record<string, string[]>;
  roles: { id: string; name: string; platformRoles: string[] }[];
  processes: { id: string; name: string; group: string; gates: string[]; activities: any[]; workProducts?: { key: string; name: string; content: string[] }[] }[];
  departments: {
    id: string;
    name: string;
    en: string;
    desc: string;
    workspace: string;
    roles: string[];
    personas: string[];
    activities: { part: 'R' | 'A' | 'C' | 'I'; parts: ('R' | 'A' | 'C' | 'I')[] }[];
    screens: { primary: string[]; reference: string[] };
  }[];
  departmentScope: { first: string[] };
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

/** Case execution uses normative output content, not display-only progress checkboxes. */
export function executionModelOf(doc: JsonDoc) {
  return { roles: doc.roles.map((r) => ({id:r.id,name:r.name,platformRoles:r.platformRoles})), personas:doc.personas,
    processes:doc.processes.map((p) => ({id:p.id,name:p.name,products:(p.workProducts ?? []).map((w) => ({key:w.key,name:w.name,content:w.content})),
      activities:p.activities.map((a) => ({id:a.id,name:a.name,processId:p.id,raci:a.raci,inputs:a.inputs,outputs:a.outputs,next:a.next,screens:a.platform.screens,actions:a.platform.actions,checks:a.checks}))})) };
}
export function renderExecutionModule(doc: JsonDoc, browser = false): string {
  return '// 생성 파일 — tools/workflow-sync.ts. 업무 건·산출물 실행 모델.\n' +
    `import type { WorkflowExecutionModel } from '${browser ? '../schemas/workflow-execution' : '@ff/contracts'}';\n` +
    `export const WORKFLOW_EXECUTION_MODEL: WorkflowExecutionModel = ${JSON.stringify(executionModelOf(doc),null,1)};\n`;
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

/** 계약 타입(DepartmentsDoc)·departmentsOf와 같은 모양 */
export function departmentsDocOf(doc: JsonDoc) {
  if (doc.schema !== SCHEMA) throw new Error(`workflows.json schema ${doc.schema} — 이 도구는 ${SCHEMA}만 읽는다`);
  return {
    departments: doc.departments.map((d) => {
      const counts = { R: 0, A: 0, C: 0, I: 0 };
      for (const a of d.activities) for (const k of a.parts) counts[k] += 1;
      return { id: d.id, name: d.name, en: d.en, desc: d.desc, workspace: d.workspace, roles: d.roles, personas: d.personas, screens: d.screens, counts };
    }),
    firstScope: doc.departmentScope.first,
  };
}

export function renderDepartmentsModule(doc: JsonDoc): string {
  return [
    '// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).',
    "import type { DepartmentsDoc } from '../rules/workflows';",
    '',
    `export const DEPARTMENTS: DepartmentsDoc = ${JSON.stringify(departmentsDocOf(doc), null, 1)};`,
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
  writeFileSync(GENERATED_DEPTS, renderDepartmentsModule(doc));
  writeFileSync(EXECUTION_SERVER, renderExecutionModule(doc));
  writeFileSync(EXECUTION_BROWSER, renderExecutionModule(doc,true));
  for (const [name, source] of Object.entries(renderLazyModules(doc))) writeFileSync(join(GENERATED_DIR, name), source);
  const acts = doc.processes.reduce((n: number, p: { activities: unknown[] }) => n + p.activities.length, 0);
  console.log(
    `workflow:sync  프로세스 ${doc.processes.length}개 · 활동 ${acts}개 · 부서 ${doc.departments.length}개 → ${posix(relative(FF, GENERATED))} · ${posix(relative(FF, GENERATED_INDEX))} · ${posix(relative(FF, GENERATED_MAP))} · ${posix(relative(FF, GENERATED_DEPTS))}`,
  );
}

function check(): number {
  if (!existsSync(SOURCE)) {
    console.error(`workflow:check  ✗ 업무 절차 JSON 없음: ${posix(relative(FF, SOURCE))}`);
    return 1;
  }
  const doc = readSource();
  const bad: string[] = [];
  if (!existsSync(EXECUTION_SERVER) || readFileSync(EXECUTION_SERVER,'utf8').replace(/\r\n/g,'\n') !== renderExecutionModule(doc)) bad.push(posix(relative(FF,EXECUTION_SERVER)));
  if (!existsSync(EXECUTION_BROWSER) || readFileSync(EXECUTION_BROWSER,'utf8').replace(/\r\n/g,'\n') !== renderExecutionModule(doc,true)) bad.push(posix(relative(FF,EXECUTION_BROWSER)));
  if (!existsSync(GENERATED) || readFileSync(GENERATED, 'utf8').replace(/\r\n/g, '\n') !== renderWorkflowModule(doc)) bad.push(posix(relative(FF, GENERATED)));
  if (!existsSync(GENERATED_INDEX) || readFileSync(GENERATED_INDEX, 'utf8').replace(/\r\n/g, '\n') !== renderIndexModule(doc)) bad.push(posix(relative(FF, GENERATED_INDEX)));
  if (!existsSync(GENERATED_MAP) || readFileSync(GENERATED_MAP, 'utf8').replace(/\r\n/g, '\n') !== renderMapModule(doc)) bad.push(posix(relative(FF, GENERATED_MAP)));
  if (!existsSync(GENERATED_DEPTS) || readFileSync(GENERATED_DEPTS, 'utf8').replace(/\r\n/g, '\n') !== renderDepartmentsModule(doc)) bad.push(posix(relative(FF, GENERATED_DEPTS)));
  for (const [name, source] of Object.entries(renderLazyModules(doc))) {
    const path = join(GENERATED_DIR, name);
    if (!existsSync(path) || readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== source) bad.push(posix(relative(FF, path)));
  }
  if (bad.length) {
    console.error(`workflow:check  ✗ 생성 모듈이 업무 절차 JSON과 다름(npm run workflow:sync): ${bad.join(', ')}`);
    return 1;
  }
  console.log(`workflow:check  ✓ ${posix(relative(FF, GENERATED))} · ${posix(relative(FF, GENERATED_INDEX))} · ${posix(relative(FF, GENERATED_MAP))} · ${posix(relative(FF, GENERATED_DEPTS))} = ${posix(relative(FF, SOURCE))}`);
  return 0;
}

if (posix(process.argv[1] ?? '').endsWith('tools/workflow-sync.ts')) {
  if (process.argv.includes('--check')) process.exit(check());
  sync();
}
