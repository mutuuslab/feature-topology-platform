// Inventory of declared workflow display metadata. Business record content and approval values are excluded.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { WorkflowDoc } from '../contracts/src/rules/workflows';
import { FF } from './lib.ts';
const doc: WorkflowDoc = JSON.parse(readFileSync(join(FF, '../docs/65-workflows/out/workflows.json'), 'utf8'));
const file = join(FF, 'frontend/src/locale/en/workflow-metadata.ts');
const catalogue = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const english = new Map<string, string>();
const duplicate: string[] = [];
for (const statement of catalogue.statements) if (ts.isExportAssignment(statement) && ts.isObjectLiteralExpression(statement.expression)) {
  for (const property of statement.expression.properties) if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.name) && ts.isStringLiteralLike(property.initializer)) {
    if (english.has(property.name.text)) duplicate.push(property.name.text);
    english.set(property.name.text, property.initializer.text);
  }
}
const entries = new Map<string, { key: string; source: string; sourceHash: string; status: 'TRANSLATED' | 'SOURCE_ENGLISH' | 'MISSING'; english: string | null }>();
const add = (key: string, source: string, provided?: string) => entries.set(key, { key, source, sourceHash: createHash('sha256').update(source).digest('hex'), status: english.has(key) ? 'TRANSLATED' : provided || !/[가-힣]/.test(source) ? 'SOURCE_ENGLISH' : 'MISSING', english: english.get(key) ?? provided ?? (!/[가-힣]/.test(source) ? source : null) });
add('note', doc.note);
if (doc.referenceModel) { add('referenceModel.title', doc.referenceModel.title); add('referenceModel.scope', doc.referenceModel.scope); }
for (const role of doc.roles) { add(`${role.id}.name`, role.name, role.en); add(`${role.id}.desc`, role.desc); }
for (const department of doc.departments) { add(`${department.id}.name`, department.name, department.en); add(`${department.id}.desc`, department.desc); }
add('departmentScope.note', doc.departmentScope.note);
doc.departmentScope.demoNotes.forEach((value, i) => add(`departmentScope.demoNotes.${i}`, value));
doc.departmentSod.forEach((rule, i) => add(`departmentSod.${i}.note`, rule.note));
for (const p of doc.processes) {
  add(`${p.id}.name`, p.name, p.en); add(`group.${p.group}`, p.group); add(`${p.id}.ref`, p.ref); add(`${p.id}.purpose`, p.purpose);
  p.outcomes.forEach((outcome) => add(`${p.id}.${outcome.id}.text`, outcome.text));
  p.entry.forEach((value, i) => add(`${p.id}.entry.${i}`, value)); p.exit.forEach((value, i) => add(`${p.id}.exit.${i}`, value));
  p.workProducts.forEach((product) => { add(`${p.id}.${product.key}.name`, product.name, product.en); product.content.forEach((value, i) => add(`${p.id}.${product.key}.content.${i}`, value)); });
  p.activities.forEach((activity) => { add(`${activity.id}.name`, activity.name); if (activity.trigger) add(`${activity.id}.trigger`, activity.trigger); activity.steps.forEach((value, i) => add(`${activity.id}.steps.${i}`, value)); activity.checks.forEach((value, i) => add(`${activity.id}.checks.${i}`, value)); });
  p.basePractices?.forEach((practice) => {
    const same = p.activities.find((activity) => activity.name === practice.name);
    add(`${practice.id}.name`, practice.name, same ? english.get(`${same.id}.name`) : undefined);
    add(`${practice.id}.definition`, practice.definition); practice.notes.forEach((value, i) => add(`${practice.id}.notes.${i}`, value));
  });
  for (const node of p.layout.nodes) if (node.kind !== 'action') add(`${node.id}.label`, node.label, node.label === '시작' ? 'Start' : node.label === '종료' ? 'End' : undefined);
}
const unknown = [...english.keys()].filter((key) => !entries.has(key));
const missing = [...entries.values()].filter((entry) => entry.status === 'MISSING');
const output = { schema: 1, scope: 'Read-only workflow display metadata; source order, IDs, RACI, routes, decision values and numeric artifact keys are unchanged.', total: entries.size, missing: missing.length, translated: [...entries.values()].filter((entry) => entry.status === 'TRANSLATED').length, sourceEnglish: [...entries.values()].filter((entry) => entry.status === 'SOURCE_ENGLISH').length, duplicate, unknown, entries: [...entries.values()] };
writeFileSync(join(FF, '../docs/qa/english-workflow-coverage.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ total: output.total, translated: output.translated, sourceEnglish: output.sourceEnglish, missing: output.missing, duplicate, unknown }));
if (duplicate.length || unknown.length) process.exitCode = 1;
