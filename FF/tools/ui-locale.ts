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
let localInitializers = new Map<string, ts.Expression>();
let unresolvedCopyReferences: { path: string; expression: string; kind: string }[] = [];
function leaves(node: ts.Expression, path: string, out: { path: string; kind: string; text: string; sourceHash: string }[], onlyKorean = true, seen = new Set<string>()) {
  node = unwrap(node);
  if (ts.isIdentifier(node) && localInitializers.has(node.text) && !seen.has(node.text)) {
    return leaves(localInitializers.get(node.text)!, path, out, onlyKorean, new Set([...seen, node.text]));
  }
  if (ts.isCallExpression(node) && node.expression.getText() === 'localizedCopy') {
    // Aggregated exports can already contain localized child exports. Count each canonical copy path once.
    if (ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text !== path) return;
    return leaves(node.arguments[1], path, out, onlyKorean, seen);
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const entry of node.properties) {
      if (ts.isPropertyAssignment(entry)) leaves(entry.initializer, `${path}.${prop(entry.name)}`, out, onlyKorean, seen);
      else if (ts.isShorthandPropertyAssignment(entry)) leaves(entry.name, `${path}.${entry.name.text}`, out, onlyKorean, seen);
      else if (onlyKorean && ts.isSpreadAssignment(entry)) unresolvedCopyReferences.push({ path: `${path}.*`, expression: entry.expression.getText(), kind: 'spread' });
      else if (onlyKorean && ts.isMethodDeclaration(entry)) unresolvedCopyReferences.push({ path: `${path}.${prop(entry.name)}`, expression: entry.getText(), kind: 'method' });
      else if (onlyKorean && ts.isGetAccessorDeclaration(entry)) unresolvedCopyReferences.push({ path: `${path}.${prop(entry.name)}`, expression: entry.body?.getText() ?? '', kind: 'late-getter' });
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    node.elements.forEach((entry, index) => { if (ts.isExpression(entry)) leaves(entry, `${path}.${index}`, out, onlyKorean, seen); });
  } else if (ts.isStringLiteralLike(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isTemplateExpression(node)) {
    const text = ts.isStringLiteralLike(node) ? node.text : node.getText();
    if (!onlyKorean || korean.test(text)) out.push({ path, kind: ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? 'function' : 'text', text, sourceHash: createHash('sha256').update(text).digest('hex') });
  } else if (onlyKorean && (ts.isIdentifier(node) && !['undefined','NaN','Infinity'].includes(node.text) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node) || ts.isConditionalExpression(node))) {
    unresolvedCopyReferences.push({ path, expression: node.getText(), kind: ts.SyntaxKind[node.kind] });
  }
}
const inventory: { module: string; file: string; leaves: { path: string; kind: string; text: string; sourceHash: string }[]; connectedExports: string[]; unresolvedCopyReferences: typeof unresolvedCopyReferences }[] = [];
const allowed = new Map<string, Set<string>>();
const signatures = new Map<string, string>();
const signature = (node: ts.Expression) => ts.isArrowFunction(node) || ts.isFunctionExpression(node)
  ? node.parameters.map((parameter) => parameter.getText().replace(/\s+/g, '')).join(',') : null;
const apply = process.argv.includes('--connect');
const scaffold = process.argv.includes('--scaffold');
mkdirSync(join(locale, 'en'), { recursive: true });
for (const name of files) {
  const file = join(root, name), module = basename(name, '.ts');
  const sourceText = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  localInitializers = new Map(source.statements.flatMap((statement) => ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) && declaration.initializer ? [[declaration.name.text, declaration.initializer] as const] : []) : []));
  const edits: { start: number; end: number; text: string }[] = [];
  unresolvedCopyReferences = [];
  const entry: typeof inventory[number] = { module, file: `FF/frontend/src/copy/${name}`, leaves: [], connectedExports: [], unresolvedCopyReferences };
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
      for (const leaf of all.filter((candidate) => candidate.kind === 'function')) {
        const parsed = ts.createSourceFile('signature.ts', `const candidate = ${leaf.text};`, ts.ScriptTarget.Latest, true);
        const statement = parsed.statements[0];
        if (ts.isVariableStatement(statement)) {
          const initializer = statement.declarationList.declarations[0]?.initializer;
          if (initializer) signatures.set(leaf.path, signature(initializer)!);
        }
      }
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
    if (!sourceText.includes("import { localizedCopy } from '../locale/runtime'")) text = `import { localizedCopy } from '../locale/runtime';\n${text}`;
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
  const duplicateTranslationKeys: string[] = [];
  const incompatibleFunctionSignatures: string[] = [];
  if (existsSync(file)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) if (ts.isExportAssignment(statement)) {
      const object = unwrap(statement.expression);
      if (ts.isObjectLiteralExpression(object)) for (const property of object.properties) if (ts.isPropertyAssignment(property)) {
        const key = `${entry.module}.${prop(property.name)}`;
        if (keys.has(key)) duplicateTranslationKeys.push(key);
        keys.add(key);
        if (signatures.has(key) && signature(unwrap(property.initializer)) !== signatures.get(key)) incompatibleFunctionSignatures.push(key);
      }
    }
  }
  const required = entry.leaves.map((leaf) => leaf.path);
  const missing = required.filter((path) => !keys.has(path));
  return { module: entry.module, source: entry.file, required: required.length, translated: required.length - missing.length, missing, unknownTranslationKeys: [...keys].filter((path) => !allowed.get(entry.module)?.has(path)), duplicateTranslationKeys, incompatibleFunctionSignatures, sourceHash: createHash('sha256').update(entry.leaves.map((leaf) => `${leaf.path}\0${leaf.sourceHash}\n`).join('')).digest('hex') };
});
const target = join(FF, '..', 'docs/qa/english-copy-inventory.json');
writeFileSync(target, JSON.stringify({ schema: 1, scope: 'Static UI copy only; no translation of user records, permission values or canonical business decisions.', moduleCount: inventory.length, requiredLeaves: inventory.reduce((n, entry) => n + entry.leaves.length, 0), modules: inventory }, null, 2) + '\n');
writeFileSync(join(FF, '..', 'docs/qa/english-copy-coverage.json'), JSON.stringify({ schema: 1, scope: 'Source-copy coverage; remaining static metadata, API-generated messages and rendered view acceptance require separate checks.', required: coverage.reduce((n, entry) => n + entry.required, 0), translated: coverage.reduce((n, entry) => n + entry.translated, 0), modules: coverage }, null, 2) + '\n');
console.log(JSON.stringify({ modules: inventory.length, leaves: inventory.reduce((n, entry) => n + entry.leaves.length, 0), connectedExports: inventory.reduce((n, entry) => n + entry.connectedExports.length, 0), inventory: target }));
const invalid = coverage.filter((entry) => entry.unknownTranslationKeys.length || entry.duplicateTranslationKeys.length || entry.incompatibleFunctionSignatures.length);
if (invalid.length) console.error(JSON.stringify(invalid.map(({ module, unknownTranslationKeys, duplicateTranslationKeys, incompatibleFunctionSignatures }) => ({ module, unknownTranslationKeys, duplicateTranslationKeys, incompatibleFunctionSignatures }))));
if (process.argv.includes('--check') && invalid.length) process.exitCode = 1;
