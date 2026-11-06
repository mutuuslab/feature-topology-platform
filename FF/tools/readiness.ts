// npm run readiness — 출시 준비 게이트. 규칙은 readiness-rules.ts, 목록은 harness/readiness.json.
// done 항목의 검사 실패(되돌아감)·open 항목의 검사 통과(목록 뒤처짐)는 실패, 열린 P0·P1 수는 줄어들기만 한다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ratchet, readJson, rel, walk } from './lib.ts';
import { judge, scanMarkers, validateCatalog, type Catalog } from './readiness-rules.ts';

const catalog = readJson<Catalog>(join(FF, 'harness', 'readiness.json'));

/** 표식을 찾는 시험 파일 — verify의 테스트 단계(test:*·e2e·tools)가 실제로 도는 곳만 */
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const roots = ['backend/test', 'frontend/src', 'contracts/src', 'e2e/tests', 'tools'];
const markers = new Map<string, string[]>();
for (const root of roots) {
  for (const f of walk(join(FF, root), ['.ts', '.tsx'], ['node_modules', 'dist'])) {
    if (!TEST_FILE.test(f) || f.endsWith('readiness.test.ts')) continue;
    for (const id of scanMarkers(readFileSync(f, 'utf8'))) markers.set(id, [...(markers.get(id) ?? []), rel(f)]);
  }
}

const read = (p: string) => {
  const abs = join(FF, p);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

console.log('readiness');
let ok = true;
const problems = validateCatalog(catalog);
const known = new Set(catalog.items.map((i) => i.id));
for (const [id, files] of markers) if (!known.has(id)) problems.push(`시험 표식 ${id}가 목록에 없다 (${files[0]})`);
if (problems.length) {
  ok = false;
  console.error(`  ✕ 목록 오류 ${problems.length}건`);
  for (const p of problems) console.error('    ' + p);
}

const v = judge(catalog, { read, markers });
if (v.regressed.length) {
  ok = false;
  console.error(`  ✕ 완료 항목이 다시 깨졌다 ${v.regressed.length}건`);
  for (const r of v.regressed) console.error(`    ${r.id}: ${r.why.join(' · ')}`);
}
if (v.stale.length) {
  ok = false;
  console.error(`  ✕ 검사는 통과하는데 open인 항목 ${v.stale.length}건 — harness/readiness.json에서 done으로 바꾸세요`);
  for (const r of v.stale) console.error(`    ${r.id}`);
}
const done = catalog.items.filter((i) => i.status === 'done').length;
console.log(`  · 완료 ${done}/${catalog.items.length} · 열림 P0 ${v.open.P0} · P1 ${v.open.P1} · P2 ${v.open.P2}`);
ok = ratchet('readinessOpenP0', v.open.P0, 'max', '출시 준비 열린 P0 수(harness/readiness.json) — 0까지') && ok;
ok = ratchet('readinessOpenP1', v.open.P1, 'max', '출시 준비 열린 P1 수 — 0까지') && ok;
if (ok) console.log('  ✓ 출시 준비 게이트 통과');
process.exit(ok ? 0 : 1);
