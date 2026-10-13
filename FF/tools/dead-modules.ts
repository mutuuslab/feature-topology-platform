// 프론트 소스 중 진입점(frontend/*.html 의 script)에서 import로 닿지 않는 모듈을 찾는다 (P10-C3 레거시 정리용).
// 테스트에서만 쓰이는 모듈은 "testOnly"로 따로 보인다(정본 데이터 계층 계약 시험용 — 허용). 사용: node tools/dead-modules.ts [--json|--check]
// --check (verify): 어디서도 안 쓰는 모듈이 하나라도 있으면 실패 — 레거시를 지운 뒤 고아가 남지 않게 한다.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '../frontend/src');
const WEB = resolve(SRC, '..');
// 진입점 = frontend/*.html 의 <script src="/src/…">
const ENTRIES = readdirSync(WEB)
  .filter((n) => n.endsWith('.html'))
  .flatMap((n) => [...readFileSync(join(WEB, n), 'utf8').matchAll(/src="\/src\/([^"]+)"/g)].map((m) => join(SRC, m[1])))
  .filter(existsSync);

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(tsx?|css)$/.test(n) ? [join(d, n)] : []));
const files = walk(SRC);
const isTest = (f: string) => /__tests__|[\\/]test[\\/]|\.test\.tsx?$|\.d\.ts$/.test(f);

const resolveImport = (from: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};
const deps = (f: string) => {
  const s = readFileSync(f, 'utf8');
  const out: string[] = [];
  for (const m of s.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|@import\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
    const r = resolveImport(f, m[1] ?? m[2] ?? m[3] ?? m[4]);
    if (r) out.push(r);
  }
  return out;
};

const reach = (roots: string[]) => {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...deps(f));
  }
  return seen;
};

const live = reach(ENTRIES);
const viaTests = reach(files.filter(isTest));
const dead = files.filter((f) => !isTest(f) && !live.has(f));
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');
const result = { entries: ENTRIES.map(rel), dead: dead.filter((f) => !viaTests.has(f)).map(rel), testOnly: dead.filter((f) => viaTests.has(f)).map(rel) };
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`진입점: ${result.entries.join(', ')}`);
  console.log(`어디서도 안 쓰는 모듈 ${result.dead.length}개:\n  ${result.dead.join('\n  ')}`);
  console.log(`테스트에서만 쓰는 모듈 ${result.testOnly.length}개:\n  ${result.testOnly.join('\n  ')}`);
}
if (process.argv.includes('--check') && result.dead.length) {
  console.error(`✗ 진입점에서 닿지 않는 모듈 ${result.dead.length}개 — 지우거나 연결하세요`);
  process.exit(1);
}
