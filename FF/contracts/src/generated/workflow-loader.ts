// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowDoc } from '../rules/workflows';
import { WORKFLOW_HEADER } from './workflow-header';
export async function loadWorkflowDocument(): Promise<WorkflowDoc> {
 const modules = await Promise.all([
  import('./workflow-process-fpw-1'),
  import('./workflow-process-fpw-2'),
  import('./workflow-process-fpw-3'),
  import('./workflow-process-fpw-4'),
  import('./workflow-process-fpw-5'),
  import('./workflow-process-fpw-6'),
  import('./workflow-process-fpw-7'),
  import('./workflow-process-fpw-8'),
  import('./workflow-process-fpw-9'),
  import('./workflow-process-fpw-10'),
  import('./workflow-process-fpw-11'),
  import('./workflow-process-fpw-12'),
  import('./workflow-process-fpw-13'),
  import('./workflow-process-fpw-14'),
  import('./workflow-process-fpw-15'),
  import('./workflow-process-fpw-16'),
  import('./workflow-process-fpw-17'),
  import('./workflow-process-fpw-18'),
 ]);
 return { ...WORKFLOW_HEADER, processes: modules.map((m) => m.PROCESS) };
}
