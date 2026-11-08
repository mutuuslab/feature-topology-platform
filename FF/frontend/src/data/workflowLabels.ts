// 업무 절차의 화면 이름 — 저장·탐색에 쓰는 식별자와 사용자에게 읽히는 문구를 구분한다.
import type { WorkflowDoc } from '@ff/contracts';
import { procedureDisplay as P } from '../copy/procedure-display';
import { localeSnapshot, staticUiText, type UiLanguage } from '../locale/runtime';

type Labels = { process: (id: string) => string; activity: (id: string) => string; text: (value: string) => string };
const LABELS = new WeakMap<WorkflowDoc, Labels>();

export function workflowLabels(doc: WorkflowDoc): Labels {
  const cached = LABELS.get(doc);
  if (cached) return cached;
  const processes = new Map(doc.processes.map((p) => [p.id, p.name]));
  const activities = new Map(doc.processes.flatMap((p) => p.activities.map((a) => [a.id, a.name] as const)));
  const labels: Labels = {
    process: (id) => processes.get(id) ?? P.process,
    activity: (id) => activities.get(id) ?? P.activity,
    // 이름 뒤의 괄호 참조는 덜어내고, 문장 속 참조는 해당 업무 이름으로 읽는다.
    text: (value) => value.replace(/\s*\(FPW\.\d+(?:-A\d+)?\)/g, '').replace(/\bFPW\.\d+(?:-A\d+)?\b/g, (id) => activities.get(id) ?? processes.get(id) ?? P.reference),
  };
  LABELS.set(doc, labels);
  return labels;
}

/** 원천 모델의 식별자·연결은 보존하고 서술 문장만 화면 이름으로 바꾼다. */
export function displayWorkflows(source: WorkflowDoc, language: UiLanguage = localeSnapshot().language): WorkflowDoc {
  const t = (key: string, value: string) => staticUiText('workflow-metadata', key, value);
  // This is a display clone. IDs, RACI, routes, model array order and numeric work-product field keys stay canonical.
  const doc = language === 'en' ? {
    ...source,
    note: t('note', source.note),
    ...(source.referenceModel ? { referenceModel: { ...source.referenceModel, title: t('referenceModel.title', source.referenceModel.title), scope: t('referenceModel.scope', source.referenceModel.scope) } } : {}),
    roles: source.roles.map((role) => ({ ...role, name: t(`${role.id}.name`, role.en || role.name), desc: t(`${role.id}.desc`, role.desc) })),
    departments: source.departments.map((department) => ({ ...department, name: t(`${department.id}.name`, department.en || department.name), desc: t(`${department.id}.desc`, department.desc) })),
    departmentScope: { ...source.departmentScope, note: t('departmentScope.note', source.departmentScope.note), demoNotes: source.departmentScope.demoNotes.map((note, i) => t(`departmentScope.demoNotes.${i}`, note)) },
    departmentSod: source.departmentSod.map((rule, i) => ({ ...rule, note: t(`departmentSod.${i}.note`, rule.note) })),
    processes: source.processes.map((p) => {
      const activityName = (id: string, fallback: string) => t(`${id}.name`, fallback);
      const nodeLabel = (node: { id: string; kind: string; label: string }) => node.kind === 'action' ? activityName(node.id, node.label) : t(`${node.id}.label`, node.label === '시작' ? 'Start' : node.label === '종료' ? 'End' : node.label);
      return {
        ...p, name: t(`${p.id}.name`, p.en || p.name), group: t(`group.${p.group}`, p.group), ref: t(`${p.id}.ref`, p.ref), purpose: t(`${p.id}.purpose`, p.purpose),
        outcomes: p.outcomes.map((outcome) => ({ ...outcome, text: t(`${p.id}.${outcome.id}.text`, outcome.text) })),
        entry: p.entry.map((value, i) => t(`${p.id}.entry.${i}`, value)), exit: p.exit.map((value, i) => t(`${p.id}.exit.${i}`, value)),
        basePractices: p.basePractices?.map((practice) => {
          const sameNamedActivity = p.activities.find((activity) => activity.name === practice.name);
          return { ...practice, name: t(`${practice.id}.name`, sameNamedActivity ? activityName(sameNamedActivity.id, practice.name) : practice.name), definition: t(`${practice.id}.definition`, practice.definition), notes: practice.notes.map((value, i) => t(`${practice.id}.notes.${i}`, value)) };
        }),
        workProducts: p.workProducts.map((product) => ({ ...product, name: t(`${p.id}.${product.key}.name`, product.en || product.name), content: product.content.map((value, i) => t(`${p.id}.${product.key}.content.${i}`, value)) })),
        activities: p.activities.map((activity) => ({ ...activity, name: activityName(activity.id, activity.name), trigger: activity.trigger ? t(`${activity.id}.trigger`, activity.trigger) : activity.trigger, steps: activity.steps.map((value, i) => t(`${activity.id}.steps.${i}`, value)), checks: activity.checks.map((value, i) => t(`${activity.id}.checks.${i}`, value)) })),
        layout: { ...p.layout, lanes: p.layout.lanes.map((lane) => ({ ...lane, label: t(`${lane.role}.name`, source.roles.find((role) => role.id === lane.role)?.en || lane.label) })), nodes: p.layout.nodes.map((node) => ({ ...node, label: nodeLabel(node) })) },
        departmentLayout: { ...p.departmentLayout, lanes: p.departmentLayout.lanes.map((lane) => ({ ...lane, label: t(`${lane.department}.name`, source.departments.find((department) => department.id === lane.department)?.en || lane.label) })), nodes: p.departmentLayout.nodes.map((node) => ({ ...node, label: nodeLabel(node) })) },
      };
    }),
  } : source;
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
