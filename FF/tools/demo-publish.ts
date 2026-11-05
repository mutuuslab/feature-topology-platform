// Publish a local demo UI without invalidating chunks referenced by already-open tabs.
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Validate entry documents and their literal local JS/CSS dependencies before touching the served tree. */
export function validateDemoUi(from: string) {
  const source = resolve(from);
  if (!existsSync(join(source, 'index.html')) || !existsSync(join(source, 'assets'))) throw new Error('Complete UI build required before publishing.');
  const files: string[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isSymbolicLink()) throw new Error('UI release must not contain symbolic links.'); if (entry.isDirectory()) walk(path); else files.push(relative(source, path)); } };
  walk(source);
  const available = new Set(files), visited = new Set<string>();
  const origin = 'https://ff-ui-build.invalid';
  const visitRef = (ref: string, parent: string) => {
    if (!ref.trim() || ref.trim().startsWith('#')) return;
    let url: URL;
    try { url = new URL(ref, origin + '/' + parent.split(sep).map(encodeURIComponent).join('/')); } catch { throw new Error(`Invalid local UI asset reference in ${parent}`); }
    if (url.origin !== origin) return; // External/data/blob resources are outside this local build.
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw new Error(`Invalid local UI asset path in ${parent}`); }
    const file = relative(source, resolve(source, '.' + pathname));
    if (!available.has(file)) throw new Error(`Missing local UI asset: ${file} (referenced from ${parent})`);
    visit(file);
  };
  const javascript = (text: string, file: string) => {
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const scan = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) visitRef(node.moduleSpecifier.text, file);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) visitRef(node.arguments[0].text, file);
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[1]?.getText(parsed).replace(/\s/g, '') === 'import.meta.url') visitRef(node.arguments[0].text, file);
      ts.forEachChild(node, scan);
    };
    scan(parsed);
  };
  const css = (text: string, file: string) => {
    for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) visitRef(m[1] ?? m[2] ?? m[3], file);
    for (const m of text.matchAll(/@import\s+(?:"([^"]+)"|'([^']+)')/gi)) visitRef(m[1] ?? m[2], file);
  };
  const visit = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    if (/\.html$/i.test(file)) {
      const html = readFileSync(join(source, file), 'utf8');
      for (const m of html.matchAll(/<(script|link|img)\b[^>]*>/gi)) {
        const attributes: Record<string, string> = {};
        for (const a of m[0].matchAll(/\b(src|href|rel)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attributes[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4]).replace(/&amp;/g, '&');
        if (m[1].toLowerCase() === 'link' && !/\b(stylesheet|modulepreload|preload|icon|manifest)\b/i.test(attributes.rel ?? '')) continue;
        const ref = attributes.src ?? attributes.href;
        if (ref) visitRef(ref, file);
      }
      for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) javascript(m[1], file);
      for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) css(m[1], file);
    } else if (/\.(?:m?js)$/i.test(file)) javascript(readFileSync(join(source, file), 'utf8'), file);
    else if (/\.css$/i.test(file)) css(readFileSync(join(source, file), 'utf8'), file);
  };
  for (const file of files.filter(file => /\.html$/i.test(file))) visit(file);
  return { source, files };
}

export function publishDemoUi(from: string, to: string) {
  const source = resolve(from), target = resolve(to);
  const within = (parent: string, child: string) => { const r = relative(parent, child); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !resolve(r).startsWith('\\\\')); };
  if (source === target || within(source, target) || within(target, source)) throw new Error('UI source and served directory must be separate, non-nested directories.');
  const { files } = validateDemoUi(source);
  const entries = files.filter(file => /\.html$/i.test(file));
  // Assets first, entry documents last. Old content-addressed chunks are deliberately retained.
  for (const file of files.filter(file => !/\.html$/i.test(file))) { const output = join(target, file); mkdirSync(dirname(output), { recursive: true }); copyFileSync(join(source, file), output); }
  for (const file of entries) {
    const output = join(target, file), staged = join(dirname(output), `.ff-ui-${randomUUID()}.tmp`);
    if (!within(target, output) || !within(target, staged)) throw new Error('Entry paths must stay inside the served UI directory.');
    mkdirSync(dirname(output), { recursive: true });
    let owned = false;
    try { copyFileSync(join(source, file), staged, constants.COPYFILE_EXCL); owned = true; renameSync(staged, output); }
    finally { if (owned && existsSync(staged)) unlinkSync(staged); }
  }
  const proof = { publishedAt: new Date().toISOString(), indexSha256: createHash('sha256').update(readFileSync(join(source, 'index.html'))).digest('hex'), filesCopied: files.length, previousAssetsRetained: true };
  writeFileSync(join(target, 'ui-release.json'), JSON.stringify(proof, null, 2));
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const from = arg('--from'), to = arg('--to');
  if (!from || !to) throw new Error('Usage: node tools/demo-publish.ts --from <complete build> --to <separate served folder>');
  console.log(JSON.stringify(publishDemoUi(from, to)));
}
