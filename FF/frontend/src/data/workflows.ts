// 업무 절차 데이터(211 KB)는 첫 화면 번들에 넣지 않는다 — 화면·패널이 열릴 때 한 번만 불러온다(bundle 예산).
import { useEffect, useMemo, useState } from 'react';
import type { WorkflowDoc } from '@ff/contracts';
import { displayWorkflows } from './workflowLabels';
import { useUiLocale } from '../locale/react';

let loading: Promise<WorkflowDoc> | undefined;
const loadRawWorkflows = (): Promise<WorkflowDoc> => (loading ??= import('../../../contracts/src/generated/workflow-loader').then((m) => m.loadWorkflowDocument()));
export const loadWorkflows = (): Promise<WorkflowDoc> => loadRawWorkflows().then((doc) => displayWorkflows(doc));

/** null = 불러오는 중, 'fail' = 실패 */
export function useWorkflowResource() {
  const locale = useUiLocale();
  const [doc, setDoc] = useState<WorkflowDoc | null | 'fail'>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setDoc(null);
    loadRawWorkflows().then(
      (d) => live && setDoc(d),
      () => {
        loading = undefined;
        if (live) setDoc('fail');
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const displayed = useMemo(() => doc && doc !== 'fail' ? displayWorkflows(doc, locale.language) : doc, [doc, locale.language, locale.revision]);
  return { doc: displayed, retry: () => { loading = undefined; setAttempt((n) => n + 1); } };
}

/** Existing consumers keep the same read-only document contract. */
export function useWorkflows(): WorkflowDoc | null | 'fail' {
  return useWorkflowResource().doc;
}
