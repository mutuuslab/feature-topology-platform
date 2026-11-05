// 42 컴포넌트 준수 검사 — manifest(contracts)가 단일 기준.
// implemented 항목: 백엔드 모듈 디렉터리·테스트 파일·화면 라우트가 실재해야 한다.
// 역방향(REVERSE): routes.tsx에서 그 컴포넌트로 표시한 화면과 정해 둔 시험 파일 묶음이 manifest에 모두 있어야 한다 — 새 화면·시험이 manifest 밖에서 늘지 않게(2026-11-04: Feature DB 화면 4·시험 17개가 빠져 있었다).
// 런타임 검사(엔드포인트가 실제 응답하는지)는 backend/test/conformance.spec.ts가 맡는다.
// --strict: 42개 전부 implemented여야 통과 (P11 마감 단계에서 켠다).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF, ratchet, rel, walk } from './lib.ts';

type Comp = { id: string; status: string; screens: string[]; tests: string[] };

/** 역방향 검사 대상 — 컴포넌트 → 이 접두어로 시작하는 시험 파일은 모두 manifest tests에 있어야 한다. 화면은 routes.tsx components 표시로 */
export const REVERSE: Record<string, { testPrefixes: string[] }> = {
  'D01-01': { testPrefixes: ['backend/test/d01/refdb', 'contracts/src/rules/refdb/', 'contracts/src/schemas/refdb.'] },
};

/** routes.tsx 항목의 path와 components — 한 항목은 '{ path: '에서 다음 '{ path: ' 전까지(여러 줄 항목 포함) */
export function routeComponents(src: string): { path: string; components: string[] }[] {
  const heads = [...src.matchAll(/\{\s*path:\s*'([^']+)'/g)];
  return heads.map((m, i) => {
    const body = src.slice(m.index, heads[i + 1]?.index ?? src.length);
    const c = /components:\s*\[([^\]]*)\]/.exec(body);
    return { path: m[1], components: c ? [...c[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [] };
  });
}

/** 역방향 불일치 — 화면 표시 ⊆ screens, 접두어 시험 파일 ⊆ tests */
export function reverseProblems(routes: { path: string; components: string[] }[], components: Comp[], testFiles: string[], rules: Record<string, { testPrefixes: string[] }> = REVERSE): string[] {
  const out: string[] = [];
  for (const [id, rule] of Object.entries(rules)) {
    const c = components.find((x) => x.id === id);
    if (!c) { out.push(`${id}: manifest에 없는 컴포넌트`); continue; }
    for (const r of routes) if (r.components.includes(id) && !c.screens.includes(r.path)) out.push(`${id}: routes.tsx 화면 ${r.path}가 manifest screens에 없음`);
    for (const f of testFiles) if (rule.testPrefixes.some((p) => f.startsWith(p)) && !c.tests.includes(f)) out.push(`${id}: 시험 ${f}가 manifest tests에 없음`);
  }
  return out;
}

const TEST_FILE = /\.(spec|test)\.(ts|tsx|mts|mjs)$/;
/** 역방향 대상 시험 파일(FF 기준 상대 경로) */
export function repoTestFiles(): string[] {
  const out: string[] = [];
  for (const d of ['backend/test', 'contracts/src', 'frontend/src', 'e2e/tests']) for (const f of walk(join(FF, d), ['.ts', '.tsx', '.mts', '.mjs'], ['node_modules', 'dist'])) if (TEST_FILE.test(f)) out.push(rel(f));
  return out.sort();
}
export const routeSource = () =>
  walk(join(FF, 'frontend', 'src'), ['.tsx', '.ts'])
    .filter((f) => /routes\.tsx$|App\.tsx$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

function main() {
  const require = createRequire(import.meta.url);
  const distIndex = join(FF, 'contracts', 'dist', 'index.js');
  if (!existsSync(distIndex)) {
    console.error('conformance: contracts가 빌드되지 않았습니다 — npm run build:contracts');
    process.exit(1);
  }
  const { COMPONENTS } = require(distIndex) as typeof import('../contracts/src/index');

  const routeSources = routeSource();
  const hasRoute = (path: string) =>
    routeSources.includes(`path: '${path}'`) || routeSources.includes(`path="${path}"`) || routeSources.includes(`path: "${path}"`);

  const problems: string[] = [];
  const report = COMPONENTS.map((c) => {
    const issues: string[] = [];
    if (c.status === 'implemented') {
      if (!existsSync(join(FF, 'backend', 'src', c.module))) issues.push(`모듈 없음 backend/src/${c.module}`);
      for (const t of c.tests) if (!existsSync(join(FF, t))) issues.push(`테스트 없음 ${t}`);
      for (const s of c.screens) if (!hasRoute(s)) issues.push(`화면 라우트 없음 ${s}`);
      if (!c.endpoints.length) issues.push('endpoints 비어 있음');
    }
    for (const i of issues) problems.push(`${c.id} ${c.ko}: ${i}`);
    return { id: c.id, ko: c.ko, domain: c.domain, tier: c.tier, status: c.status, issues };
  });
  const routes = routeComponents(routeSources);
  problems.push(...reverseProblems(routes, COMPONENTS, repoTestFiles()));
  // 역방향 검사를 아직 켜지 않은 컴포넌트의 화면 표시 불일치 — 정보(실패 아님). 켤 때는 REVERSE에 넣는다
  const others = Object.fromEntries(COMPONENTS.filter((c) => c.status === 'implemented' && !(c.id in REVERSE)).map((c) => [c.id, { testPrefixes: [] }]));
  const info = reverseProblems(routes, COMPONENTS, [], others);

  const implemented = COMPONENTS.filter((c) => c.status === 'implemented').length;
  writeFileSync(join(FF, 'harness', 'conformance.json'), JSON.stringify({ implemented, total: COMPONENTS.length, report }, null, 2) + '\n');

  console.log(`conformance: 구현 ${implemented}/${COMPONENTS.length}`);
  let ok = true;
  if (problems.length) {
    ok = false;
    console.error(`  ✕ 준수 위반 ${problems.length}건`);
    for (const p of problems) console.error('    ' + p);
  } else console.log(`  ✓ implemented 항목의 모듈·테스트·화면 실재 · 역방향(${Object.keys(REVERSE).join(', ')}) 화면·시험 manifest 포함`);
  if (info.length) console.log(`  · 역방향 검사를 켜지 않은 컴포넌트의 화면 표시 불일치 ${info.length}건(정보 — 켤 때 tools/conformance.ts REVERSE)`);
  if (process.argv.includes('--strict') && implemented < COMPONENTS.length) {
    ok = false;
    console.error(`  ✕ --strict: ${COMPONENTS.length - implemented}개 컴포넌트 미구현`);
  }
  ok = ratchet('implementedComponents', implemented, 'min', '구현 완료 컴포넌트 수 — 줄어들 수 없다') && ok;
  process.exit(ok ? 0 : 1);
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('tools/conformance.ts')) main();
