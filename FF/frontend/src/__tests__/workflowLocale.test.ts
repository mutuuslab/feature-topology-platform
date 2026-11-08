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
  expect(untranslatedCopyPaths().some(path => path.startsWith('workflow-metadata.'))).toBe(true);
  expect(JSON.stringify(WORKFLOWS)).toBe(snapshot);
  await changeUiLanguage('ko');
  expect(displayWorkflows(WORKFLOWS)).toEqual(korean);
});
