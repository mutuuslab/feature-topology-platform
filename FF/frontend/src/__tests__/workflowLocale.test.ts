import { afterEach, expect, it } from 'vitest';
import { WORKFLOWS } from '../../../contracts/src/generated/workflows';
import { displayWorkflows } from '../data/workflowLabels';
import { changeUiLanguage, __resetLocaleForTest, untranslatedCopyPaths } from '../locale/runtime';
afterEach(__resetLocaleForTest);

it('uses English workflow display names while preserving source topology, RACI, guards and numeric artifact keys', async () => {
  const snapshot = JSON.stringify(WORKFLOWS);
  const korean = displayWorkflows(WORKFLOWS);
  await changeUiLanguage('en');
  const english = displayWorkflows(WORKFLOWS);
  const hara=english.processes.find(process=>process.id==='FPW.2')!;
  expect(hara.purpose).toContain('HARA, TARA and SOTIF');
  expect(hara.workProducts.find(product=>product.key==='WP-IMPACT-ANALYSIS')?.content[0]).toBe('Previous Version and changed Registry attributes and Topology relationships');
  expect(english.processes.flatMap(p => p.activities).map(a => a.name).filter(name => /[가-힣]/.test(name))).toEqual([]);
  for (const [i, process] of english.processes.entries()) {
    const raw = WORKFLOWS.processes[i];
    expect({ id:process.id,gates:process.gates,rules:process.rules }).toEqual({ id:raw.id,gates:raw.gates,rules:raw.rules });
    process.activities.forEach((activity,j) => expect({ ...activity,name:raw.activities[j].name,trigger:raw.activities[j].trigger,steps:raw.activities[j].steps,checks:raw.activities[j].checks }).toEqual(raw.activities[j]));
    process.workProducts.forEach((product,j) => {
      const source = raw.workProducts[j];
      expect(product.content.map((_,key) => String(key))).toEqual(source.content.map((_,key) => String(key)));
      expect({ ...product,name:source.name,content:source.content }).toEqual(source);
    });
    process.basePractices?.forEach((practice,j) => expect({ ...practice,name:raw.basePractices![j].name,definition:raw.basePractices![j].definition,notes:raw.basePractices![j].notes }).toEqual(raw.basePractices![j]));
    for (const layout of ['layout','departmentLayout'] as const) {
      expect({ ...process[layout],lanes:raw[layout].lanes,nodes:raw[layout].nodes }).toEqual(raw[layout]);
      process[layout].nodes.forEach((node,j) => expect({ ...node,label:raw[layout].nodes[j].label }).toEqual(raw[layout].nodes[j]));
      process[layout].lanes.forEach((lane,j) => expect({ ...lane,label:raw[layout].lanes[j].label }).toEqual(raw[layout].lanes[j]));
    }
  }
  english.roles.forEach((role,i) => expect({ ...role,name:WORKFLOWS.roles[i].name,desc:WORKFLOWS.roles[i].desc }).toEqual(WORKFLOWS.roles[i]));
  english.departments.forEach((department,i) => expect({ ...department,name:WORKFLOWS.departments[i].name,desc:WORKFLOWS.departments[i].desc }).toEqual(WORKFLOWS.departments[i]));
  const visibleText = [
    english.note, english.referenceModel?.title, english.referenceModel?.scope,
    ...english.roles.flatMap(role => [role.name,role.desc]),
    ...english.departments.flatMap(department => [department.name,department.desc]),
    english.departmentScope.note, ...english.departmentScope.demoNotes,
    ...english.departmentSod.map(rule => rule.note),
    ...english.processes.flatMap(process => [process.name,process.group,process.ref,process.purpose,
      ...process.entry,...process.exit,...process.outcomes.map(outcome => outcome.text),
      ...process.workProducts.flatMap(product => [product.name,...product.content]),
      ...process.activities.flatMap(activity => [activity.name,activity.trigger,...activity.steps,...activity.checks]),
      ...(process.basePractices?.flatMap(practice => [practice.name,practice.definition,...practice.notes]) ?? []),
      ...process.layout.lanes.map(lane => lane.label),...process.layout.nodes.map(node => node.label),
      ...process.departmentLayout.lanes.map(lane => lane.label),...process.departmentLayout.nodes.map(node => node.label),
    ]),
  ];
  expect(visibleText.filter(value => value && /[가-힣]/.test(value))).toEqual([]);
  expect(untranslatedCopyPaths().filter(path => path.startsWith('workflow-metadata.'))).toEqual([]);
  expect(JSON.stringify(WORKFLOWS)).toBe(snapshot);
  await changeUiLanguage('ko');
  expect(displayWorkflows(WORKFLOWS)).toEqual(korean);
});
