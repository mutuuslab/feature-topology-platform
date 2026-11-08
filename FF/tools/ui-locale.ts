// Explicit UI-copy inventory. Source coverage is not a claim that every product view has been accepted.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { FF } from './lib.ts';

const root = join(FF, 'frontend/src/copy');
const locale = join(FF, 'frontend/src/locale');
const korean = /[가-힣]/;
const files = readdirSync(root).filter((name) => name.endsWith('.ts')).sort();
const prop = (name: ts.PropertyName) => ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : name.getText();
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return unwrap(node.expression);
  return node;
}
function leaves(node: ts.Expression, path: string, out: { path: string; kind: string; text: string; sourceHash: string }[], onlyKorean = true) {
  node = unwrap(node);
  if (ts.isCallExpression(node) && node.expression.getText() === 'localizedCopy') return leaves(node.arguments[1], path, out, onlyKorean);
  if (ts.isObjectLiteralExpression(node)) {
    for (const entry of node.properties) if (ts.isPropertyAssignment(entry)) leaves(entry.initializer, `${path}.${prop(entry.name)}`, out, onlyKorean);
  } else if (ts.isArrayLiteralExpression(node)) {
    node.elements.forEach((entry, index) => { if (ts.isExpression(entry)) leaves(entry, `${path}.${index}`, out, onlyKorean); });
  } else if (ts.isStringLiteralLike(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isTemplateExpression(node)) {
    const text = ts.isStringLiteralLike(node) ? node.text : node.getText();
    if (!onlyKorean || korean.test(text)) out.push({ path, kind: ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? 'function' : 'text', text, sourceHash: createHash('sha256').update(text).digest('hex') });
  }
}
const inventory: { module: string; file: string; leaves: { path: string; kind: string; text: string; sourceHash: string }[]; connectedExports: string[] }[] = [];
const allowed = new Map<string, Set<string>>();
const apply = process.argv.includes('--connect');
const scaffold = process.argv.includes('--scaffold');
mkdirSync(join(locale, 'en'), { recursive: true });
for (const name of files) {
  const file = join(root, name), module = basename(name, '.ts');
  const sourceText = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const entry: typeof inventory[number] = { module, file: `FF/frontend/src/copy/${name}`, leaves: [], connectedExports: [] };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const key = `${module}.${declaration.name.text}`;
      leaves(declaration.initializer, key, entry.leaves);
      const all: typeof entry.leaves = [];
      leaves(declaration.initializer, key, all, false);
      const keys = allowed.get(module) ?? new Set<string>();
      all.forEach((leaf) => keys.add(leaf.path)); allowed.set(module, keys);
      const initializer = unwrap(declaration.initializer);
      if (ts.isCallExpression(initializer) && initializer.expression.getText(source) === 'localizedCopy') entry.connectedExports.push(declaration.name.text);
      else if ((ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)) && entry.leaves.some((leaf) => leaf.path.startsWith(`${key}.`))) {
        entry.connectedExports.push(declaration.name.text);
        if (apply) edits.push({ start: declaration.initializer.getStart(source), end: declaration.initializer.end, text: `/* @__PURE__ */ localizedCopy('${key}', ${declaration.initializer.getText(source)})` });
      }
    }
  }
  if (apply && edits.length) {
    let text = sourceText;
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    text = `import { localizedCopy } from '../locale/runtime';\n${text}`;
    writeFileSync(file, text);
  }
  inventory.push(entry);
}
if (scaffold) {
  for (const module of inventory) {
    const file = join(locale, 'en', `${module.module}.ts`);
    if (!existsSync(file)) writeFileSync(file, '// Untranslated entries fall back to Korean and remain in the coverage ledger.\nexport default {};\n');
  }
  const ready = readdirSync(join(locale, 'en')).filter((name) => name.endsWith('.ts')).filter((name) => {
    const source = ts.createSourceFile(name, readFileSync(join(locale, 'en', name), 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.some((statement) => ts.isExportAssignment(statement) && ts.isObjectLiteralExpression(unwrap(statement.expression)) && (unwrap(statement.expression) as ts.ObjectLiteralExpression).properties.length > 0);
  });
  const imports = ready.map((file) => { const module = basename(file, '.ts'); return `  '${module}': () => import('./en/${module}'),`; }).join('\n');
  writeFileSync(join(locale, 'english-catalogues.ts'), `// Generated by tools/ui-locale.ts --scaffold. English stays in lazy modules.\nconst loaders = {\n${imports}\n};\nexport async function loadEnglishCatalogues(): Promise<Record<string, Record<string, unknown>>> {\n  return Object.fromEntries(await Promise.all(Object.entries(loaders).map(async ([name, load]) => [name, (await load()).default])));\n}\n`);
}
const coverage = inventory.map((entry) => {
  const file = join(locale, 'en', `${entry.module}.ts`);
  const keys = new Set<string>();
  if (existsSync(file)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) if (ts.isExportAssignment(statement)) {
      const object = unwrap(statement.expression);
      if (ts.isObjectLiteralExpression(object)) for (const property of object.properties) if (ts.isPropertyAssignment(property)) keys.add(`${entry.module}.${prop(property.name)}`);
    }
  }
  const required = entry.leaves.map((leaf) => leaf.path);
  const missing = required.filter((path) => !keys.has(path));
  return { module: entry.module, source: entry.file, required: required.length, translated: required.length - missing.length, missing, unknownTranslationKeys: [...keys].filter((path) => !allowed.get(entry.module)?.has(path)), sourceHash: createHash('sha256').update(entry.leaves.map((leaf) => `${leaf.path}\0${leaf.sourceHash}\n`).join('')).digest('hex') };
});
const target = join(FF, '..', 'docs/qa/english-copy-inventory.json');
writeFileSync(target, JSON.stringify({ schema: 1, scope: 'Static UI copy only; no translation of user records, permission values or canonical business decisions.', moduleCount: inventory.length, requiredLeaves: inventory.reduce((n, entry) => n + entry.leaves.length, 0), modules: inventory }, null, 2) + '\n');
writeFileSync(join(FF, '..', 'docs/qa/english-copy-coverage.json'), JSON.stringify({ schema: 1, scope: 'Source-copy coverage; remaining static metadata, API-generated messages and rendered view acceptance require separate checks.', required: coverage.reduce((n, entry) => n + entry.required, 0), translated: coverage.reduce((n, entry) => n + entry.translated, 0), modules: coverage }, null, 2) + '\n');
console.log(JSON.stringify({ modules: inventory.length, leaves: inventory.reduce((n, entry) => n + entry.leaves.length, 0), connectedExports: inventory.reduce((n, entry) => n + entry.connectedExports.length, 0), inventory: target }));
