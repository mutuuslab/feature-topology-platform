// 성능 예산 (verify `budget`) — 프론트 빌드(frontend/dist)를 gzip 크기로 잰다. 기준: harness/budgets.json
//   첫 화면: index.html이 처음 받는 스크립트·modulepreload·CSS 합계 ≤ initialGzipKiB
//   화면 묶음: 그 밖의 JS 묶음 하나하나 ≤ chunkGzipKiB (3D 장면처럼 허용 목록에 있는 것은 그 값)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { gzipSync } from 'node:zlib';
import { FF, readJson } from './lib.ts';

export interface Budget {
  initialGzipKiB: number;
  chunkGzipKiB: number;
  allow: Record<string, number>;
}
export interface Chunk {
  file: string;
  gzip: number;
}

/** Include public entry scripts as well as hashed Vite assets; recovery code consumes the same budget. */
export function collectBudgetAssets(dist: string): { chunks: Chunk[]; initial: Set<string> } {
  const chunks = readdirSync(join(dist, 'assets')).filter(f => /\.(js|css)$/.test(f))
    .map(file => ({ file, gzip: gzipSync(readFileSync(join(dist, 'assets', file))).length }));
  const initial = new Set<string>();
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:[?#][^"']*)?)["']/g)) {
    if (/^(?:[a-z]+:)?\/\//i.test(match[1])) continue;
    let path = decodeURIComponent(match[1].split(/[?#]/)[0]).replace(/^\//, '');
    // Pages builds prepend their deployment base; hashed assets still live in dist/assets.
    if (path.includes('/assets/')) path = path.slice(path.indexOf('assets/'));
    if (!existsSync(join(dist, path)) && !path.startsWith('assets/')) path = path.slice(path.lastIndexOf('/') + 1);
    const absolute = resolve(dist, path), inside = relative(resolve(dist), absolute);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`Budget entry escapes build directory: ${path}`);
    const file = path.startsWith('assets/') ? path.slice(7) : `public:${path}`;
    if (!chunks.some(c => c.file === file)) chunks.push({ file, gzip: gzipSync(readFileSync(absolute)).length });
    initial.add(file);
  }
  return { chunks, initial };
}

/** 판정만 — 순수 함수 */
export function judge(chunks: Chunk[], initial: Set<string>, b: Budget): string[] {
  const out: string[] = [];
  const kib = (n: number) => n / 1024;
  const first = chunks.filter((c) => initial.has(c.file)).reduce((n, c) => n + c.gzip, 0);
  if (kib(first) > b.initialGzipKiB) out.push(`첫 화면 ${kib(first).toFixed(0)} KiB > 예산 ${b.initialGzipKiB} KiB`);
  for (const c of chunks) {
    if (initial.has(c.file) || !c.file.endsWith('.js')) continue;
    const name = c.file.replace(/-[\w-]{8}\.js$/, '');
    const cap = b.allow[name] ?? b.chunkGzipKiB;
    if (kib(c.gzip) > cap) out.push(`${c.file} ${kib(c.gzip).toFixed(0)} KiB > 예산 ${cap} KiB`);
  }
  return out;
}

/** 빌드 폴더 하나 판정 — verify `budget`(일반 빌드)과 tools/static-build.ts(정적 공개본 빌드)가 같은 기준(harness/budgets.json)으로 쓴다 */
export function budgetReport(dist: string): { line: string; bad: string[] } {
  const b = readJson<Budget & { firstScreenMs: number }>(join(FF, 'harness', 'budgets.json'));
  const { chunks, initial } = collectBudgetAssets(dist);
  const first = chunks.filter((c) => initial.has(c.file)).reduce((n, c) => n + c.gzip, 0);
  const bad = judge(chunks, initial, b);
  const max = chunks.filter((c) => !initial.has(c.file) && c.file.endsWith('.js') && !Object.keys(b.allow).some((a) => c.file.startsWith(a))).sort((x, y) => y.gzip - x.gzip)[0];
  return { line: `budget  첫 화면 ${(first / 1024).toFixed(1)}/${b.initialGzipKiB} KiB · 화면 묶음 최대 ${max ? `${max.file} ${(max.gzip / 1024).toFixed(1)}` : '-'}/${b.chunkGzipKiB} KiB`, bad };
}

// 사용: node tools/bundle-budget.ts [빌드 폴더] — 기본 frontend/dist(일반 빌드). 정적 공개본은 frontend/dist-static/<포트>/dist
if (process.argv[1]?.endsWith('bundle-budget.ts')) {
  const dist = process.argv[2] ? resolve(process.argv[2]) : join(FF, 'frontend', 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`budget  프론트 빌드가 없습니다 (${dist} — build:frontend 먼저)`);
    process.exit(1);
  }
  const { line, bad } = budgetReport(dist);
  console.log(line);
  for (const x of bad) console.error(`  ✕ ${x}`);
  process.exit(bad.length ? 1 : 0);
}
