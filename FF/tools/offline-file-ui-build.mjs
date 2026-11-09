// Standalone file:// UI bundles. Input source and captured data are never overwritten.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { browserRouteSource } from './browser-routes.ts';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const entries = [
  { name: 'main', source: 'index.html', html: 'platform.html' },
  { name: 'external', source: 'external.html', html: 'external-app.html' },
  { name: 'twin', source: 'twin.html', html: 'twin-app.html' },
];
const MAX_INLINE_BYTES = 512 * 1024 * 1024;

function classicHtml(html, favicon) {
  // File URLs cannot load ESM cross-origin. All dependency imports are in the IIFE.
  let result = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, '')
    .replace(/\s(?:crossorigin(?:=["'][^"']*["'])?|type=["']module["'])/gi, '')
    .replace(/<script\b[^>]*\bsrc=["'][^"']*boot-check\.js["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<aside\b[^>]*\bid=["']boot-recovery["'][\s\S]*?<\/aside>/gi, '')
    .replace(/<link\b[^>]*rel=["']icon["'][^>]*>/gi, '');
  result = result.replace(/<script\b([^>]*\bsrc=["'][^"']+["'][^>]*)>/gi, (_all, attrs) => `<script${/\bdefer\b/i.test(attrs) ? attrs : ' defer' + attrs}>`);
  // Classic defer scripts execute in document order, before React's entry point.
  const bootstrap = '<script defer src="./offline-manifest.js"></script>\n    <script defer src="./offline-runtime.js"></script>\n    ';
  const entry = result.search(/<script\b[^>]*\bsrc=["'][^"']*app-(?:main|external|twin)\.js["']/i);
  if (entry < 0) throw new Error('Offline HTML has no emitted application script');
  result = result.slice(0, entry) + bootstrap + result.slice(entry);
  return result.replace('</head>', `    <link rel="icon" type="image/svg+xml" href="${favicon}">\n  </head>`);
}

/** Build three independent classic bundles; merge them into the caller's package. */
export async function buildOfflineUi({ outDir } = {}) {
  if (!outDir) throw new Error('buildOfflineUi requires outDir');
  const output = resolve(outDir);
  if (output === root || output === frontend || output.startsWith(frontend + sep)) throw new Error('Offline output must be outside frontend source');
  mkdirSync(output, { recursive: true });
  const staging = mkdtempSync(join(output, '.ui-build-'));
  const faviconPath = join(frontend, 'public/brand/mutuus-symbol.svg');
  const favicon = 'data:image/svg+xml;base64,' + readFileSync(faviconPath).toString('base64');
  const artifacts = [];
  try {
    for (const entry of entries) {
      const stage = join(staging, entry.name);
      const result = await build({
        configFile: false, root: frontend, base: './', envDir: false, envPrefix: 'FF_OFFLINE_NO_HOST_VALUES_',
        publicDir: false, mode: 'production', logLevel: 'warn',
        define: { 'import.meta.env.VITE_DATA_MODE': JSON.stringify('static'), 'import.meta.env.VITE_AUTH': JSON.stringify('demo') },
        plugins: [{ name: 'offline-browser-route-metadata', enforce: 'pre', transform(code, id) {
          if (!id.replace(/\\/g, '/').endsWith('/contracts/src/routes.ts')) return;
          return { code: browserRouteSource(code, { dropSummary: true, dropSample: true }), map: null };
        } }, react()],
        resolve: { alias: { '@ff/contracts': join(root, 'contracts/src/web.ts') } },
        build: {
          outDir: stage, emptyOutDir: true, cssCodeSplit: false,
          assetsInlineLimit: MAX_INLINE_BYTES, modulePreload: false, sourcemap: false,
          rollupOptions: {
            input: join(frontend, entry.source),
            treeshake: { moduleSideEffects(id) {
              const path = id.replace(/\\/g, '/');
              return path.includes('/contracts/src/') && !path.endsWith('/contracts/src/rules/report-catalog-installed.ts') ? false : null;
            } },
            output: { format: 'iife', name: `FeaturePlatformOffline_${entry.name}`, inlineDynamicImports: true,
              entryFileNames: `app-${entry.name}.js`, assetFileNames: 'assets/[name]-[hash][extname]' },
          },
        },
      });
      const builds = Array.isArray(result) ? result : [result];
      const chunks = builds.flatMap((bundle) => 'output' in bundle ? bundle.output.filter((part) => part.type === 'chunk') : []);
      if (chunks.length !== 1 || chunks.some((part) => part.imports.length || part.dynamicImports.length)) throw new Error(`${entry.name}: standalone build emitted a dependency chunk`);
      const html = classicHtml(readFileSync(join(stage, entry.source), 'utf8'), favicon);
      if (/type=["']module["']|\bcrossorigin\b|rel=["']modulepreload["']/i.test(html)) throw new Error(`${entry.name}: module-only HTML remains`);
      writeFileSync(join(output, entry.html), html);
      for (const name of readdirSync(stage)) {
        if (name === entry.source) continue;
        cpSync(join(stage, name), join(output, name), { recursive: true });
      }
      artifacts.push({ entry: entry.name, html: entry.html, script: `app-${entry.name}.js`, jsBytes: Buffer.byteLength(chunks[0].code, 'utf8'), imports: [], dynamicImports: [] });
    }
    const report = { format: 'iife', dataMode: 'static', base: './', entries: artifacts,
      assetsInlineLimit: MAX_INLINE_BYTES, note: 'UI only. Manifest, offline runtime, wrappers and data are supplied separately.' };
    writeFileSync(join(output, 'offline-ui-build.json'), JSON.stringify(report, null, 2));
    return report;
  } finally {
    // This is only the unique staging directory created above, never caller data.
    const relation = relative(output, staging);
    if (relation.startsWith('.ui-build-') && !relation.includes(sep) && resolve(dirname(staging)) === output && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node tools/offline-file-ui-build.mjs --out <directory>');
  const report = await buildOfflineUi({ outDir: args[1] });
  console.log(JSON.stringify(report));
}
