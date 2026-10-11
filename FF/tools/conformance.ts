// 42 컴포넌트 준수 검사 — manifest(contracts)가 단일 기준.
// implemented 항목: 백엔드 모듈 디렉터리·테스트 파일·화면 라우트가 실재해야 한다.
// 런타임 검사(엔드포인트가 실제 응답하는지)는 backend/test/conformance.spec.ts가 맡는다.
// --strict: 42개 전부 implemented여야 통과 (P11 마감 단계에서 켠다).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF, ratchet, walk } from './lib.ts';

const require = createRequire(import.meta.url);
const distIndex = join(FF, 'contracts', 'dist', 'index.js');
if (!existsSync(distIndex)) {
  console.error('conformance: contracts가 빌드되지 않았습니다 — npm run build:contracts');
  process.exit(1);
}
const { COMPONENTS } = require(distIndex) as typeof import('../contracts/src/index');

const routeSources = walk(join(FF, 'frontend', 'src'), ['.tsx', '.ts'])
  .filter((f) => /routes\.tsx$|App\.tsx$/.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
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

const implemented = COMPONENTS.filter((c) => c.status === 'implemented').length;
writeFileSync(join(FF, 'harness', 'conformance.json'), JSON.stringify({ implemented, total: COMPONENTS.length, report }, null, 2) + '\n');

console.log(`conformance: 구현 ${implemented}/${COMPONENTS.length}`);
let ok = true;
if (problems.length) {
  ok = false;
  console.error(`  ✕ 준수 위반 ${problems.length}건`);
  for (const p of problems) console.error('    ' + p);
} else console.log('  ✓ implemented 항목의 모듈·테스트·화면 실재');
if (process.argv.includes('--strict') && implemented < COMPONENTS.length) {
  ok = false;
  console.error(`  ✕ --strict: ${COMPONENTS.length - implemented}개 컴포넌트 미구현`);
}
ok = ratchet('implementedComponents', implemented, 'min', '구현 완료 컴포넌트 수 — 줄어들 수 없다') && ok;
process.exit(ok ? 0 : 1);
