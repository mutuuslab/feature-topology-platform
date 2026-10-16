// 성능 예산 (verify `budget`) — 프론트 빌드(frontend/dist)를 gzip 크기로 잰다. 기준: harness/budgets.json
//   첫 화면: index.html이 처음 받는 스크립트·modulepreload·CSS 합계 ≤ initialGzipKiB
//   화면 묶음: 그 밖의 JS 묶음 하나하나 ≤ chunkGzipKiB (3D 장면처럼 허용 목록에 있는 것은 그 값)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

if (process.argv[1]?.endsWith('bundle-budget.ts')) {
  const dist = join(FF, 'frontend', 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('budget  프론트 빌드가 없습니다 (build:frontend 먼저)');
    process.exit(1);
  }
  const b = readJson<Budget & { firstScreenMs: number }>(join(FF, 'harness', 'budgets.json'));
  const chunks = readdirSync(join(dist, 'assets'))
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => ({ file: f, gzip: gzipSync(readFileSync(join(dist, 'assets', f))).length }));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = new Set([...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]));
  const first = chunks.filter((c) => initial.has(c.file)).reduce((n, c) => n + c.gzip, 0);
  const bad = judge(chunks, initial, b);
  const max = chunks.filter((c) => !initial.has(c.file) && c.file.endsWith('.js') && !Object.keys(b.allow).some((a) => c.file.startsWith(a))).sort((x, y) => y.gzip - x.gzip)[0];
  console.log(`budget  첫 화면 ${(first / 1024).toFixed(0)}/${b.initialGzipKiB} KiB · 화면 묶음 최대 ${max ? `${max.file} ${(max.gzip / 1024).toFixed(0)}` : '-'}/${b.chunkGzipKiB} KiB`);
  for (const x of bad) console.error(`  ✕ ${x}`);
  process.exit(bad.length ? 1 : 0);
}
