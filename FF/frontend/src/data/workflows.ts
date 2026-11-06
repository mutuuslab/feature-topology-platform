// 업무 절차 데이터(211 KB)는 첫 화면 번들에 넣지 않는다 — 화면·패널이 열릴 때 한 번만 불러온다(bundle 예산).
import { useEffect, useState } from 'react';
import type { WorkflowDoc } from '@ff/contracts';
import { displayWorkflows } from './workflowLabels';

let loading: Promise<WorkflowDoc> | undefined;
export const loadWorkflows = (): Promise<WorkflowDoc> => (loading ??= import('../../../contracts/src/generated/workflows').then((m) => displayWorkflows(m.WORKFLOWS)));

/** null = 불러오는 중, 'fail' = 실패 */
export function useWorkflows(): WorkflowDoc | null | 'fail' {
  const [doc, setDoc] = useState<WorkflowDoc | null | 'fail'>(null);
  useEffect(() => {
    let live = true;
    loadWorkflows().then(
      (d) => live && setDoc(d),
      () => {
        loading = undefined;
        if (live) setDoc('fail');
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return doc;
}
