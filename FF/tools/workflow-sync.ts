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

const readSource = () => JSON.parse(readFileSync(SOURCE, 'utf8').replace(/^﻿/, ''));

function sync() {
  if (!existsSync(SOURCE)) throw new Error(`업무 절차 JSON이 없습니다: ${SOURCE} — docs/65-workflows에서 python -I scripts/check.py`);
  const doc = readSource();
  mkdirSync(dirname(GENERATED), { recursive: true });
  writeFileSync(GENERATED, renderWorkflowModule(doc));
  const acts = doc.processes.reduce((n: number, p: { activities: unknown[] }) => n + p.activities.length, 0);
  console.log(`workflow:sync  프로세스 ${doc.processes.length}개 · 활동 ${acts}개 → ${posix(relative(FF, GENERATED))}`);
}

function check(): number {
  if (!existsSync(SOURCE)) {
    console.error(`workflow:check  ✗ 업무 절차 JSON 없음: ${posix(relative(FF, SOURCE))}`);
    return 1;
  }
  const want = renderWorkflowModule(readSource());
  if (!existsSync(GENERATED) || readFileSync(GENERATED, 'utf8').replace(/\r\n/g, '\n') !== want) {
    console.error(`workflow:check  ✗ 생성 모듈이 업무 절차 JSON과 다름(npm run workflow:sync): ${posix(relative(FF, GENERATED))}`);
    return 1;
  }
  console.log(`workflow:check  ✓ ${posix(relative(FF, GENERATED))} = ${posix(relative(FF, SOURCE))}`);
  return 0;
}

if (posix(process.argv[1] ?? '').endsWith('tools/workflow-sync.ts')) {
  if (process.argv.includes('--check')) process.exit(check());
  sync();
}
