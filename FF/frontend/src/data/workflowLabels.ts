// 업무 절차의 화면 이름 — 저장·탐색에 쓰는 식별자와 사용자에게 읽히는 문구를 구분한다.
import type { WorkflowDoc } from '@ff/contracts';
import { procedures as P } from '../copy/procedures';

type Labels = { process: (id: string) => string; activity: (id: string) => string; text: (value: string) => string };
const LABELS = new WeakMap<WorkflowDoc, Labels>();

export function workflowLabels(doc: WorkflowDoc): Labels {
  const cached = LABELS.get(doc);
  if (cached) return cached;
  const processes = new Map(doc.processes.map((p) => [p.id, p.name]));
  const activities = new Map(doc.processes.flatMap((p) => p.activities.map((a) => [a.id, a.name] as const)));
  const labels: Labels = {
    process: (id) => processes.get(id) ?? P.display.process,
    activity: (id) => activities.get(id) ?? P.display.activity,
    // 이름 뒤의 괄호 참조는 덜어내고, 문장 속 참조는 해당 업무 이름으로 읽는다.
    text: (value) => value.replace(/\s*\(FPW\.\d+(?:-A\d+)?\)/g, '').replace(/\bFPW\.\d+(?:-A\d+)?\b/g, (id) => activities.get(id) ?? processes.get(id) ?? P.display.reference),
  };
  LABELS.set(doc, labels);
  return labels;
}

/** 원천 모델의 식별자·연결은 보존하고 서술 문장만 화면 이름으로 바꾼다. */
export function displayWorkflows(doc: WorkflowDoc): WorkflowDoc {
  const { text } = workflowLabels(doc);
  return {
    ...doc,
    processes: doc.processes.map((p) => ({
      ...p,
      purpose: text(p.purpose),
      outcomes: p.outcomes.map((o) => ({ ...o, text: text(o.text) })),
      entry: p.entry.map(text),
      exit: p.exit.map(text),
      workProducts: p.workProducts.map((w) => ({ ...w, name: text(w.name), content: w.content.map(text) })),
      activities: p.activities.map((a) => ({ ...a, name: text(a.name), ...(a.trigger ? { trigger: text(a.trigger) } : {}), steps: a.steps.map(text), checks: a.checks.map(text) })),
    })),
  };
}
