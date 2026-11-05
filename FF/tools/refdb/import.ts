// npm run refdb:import -- <xlsx 경로> [--force] — Feature DB 1회 이전(30-95 §9). 엑셀 → data/reference/feature-db/v1.3/*.json + manifest.json.
// 이전 뒤에는 FF가 원천이다(D-REF-5): 대상 파일이 이미 있고 내용이 다르면 쓰지 않는다. 다시 이전할 때만 --force.
// 원본 엑셀은 읽기만 한다(수정하지 않음).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FF } from '../lib.ts';
import { importWorkbook, RELEASE, renderFiles } from './import-lib.ts';

export const OUT = join(FF, 'data', 'reference', 'feature-db', RELEASE);

const args = process.argv.slice(2);
const force = args.includes('--force');
const src = args.find((a) => !a.startsWith('--'));
if (!src) {
  console.error('사용법: npm run refdb:import -- <Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx> [--force]');
  process.exit(2);
}
if (!existsSync(src)) {
  console.error(`엑셀 파일이 없습니다: ${src}`);
  process.exit(2);
}

const res = importWorkbook(readFileSync(src));
const texts = renderFiles(res, basename(src));
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const changed = Object.entries(texts).filter(([name, text]) => {
  const p = join(OUT, name);
  return existsSync(p) && lf(readFileSync(p, 'utf8')) !== text;
});
if (changed.length && !force) {
  console.error(`refdb:import 중단 — ${OUT}의 기존 파일과 다릅니다(이전 뒤에는 FF가 원천). 다시 이전하려면 --force:`);
  for (const [name] of changed) console.error(`  ≠ ${name}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(texts)) writeFileSync(join(OUT, name), text);

console.log(`refdb:import 완료 → data/reference/feature-db/${RELEASE}${changed.length ? ` (--force: ${changed.length}개 파일 갱신)` : ''}`);
for (const [name, rows] of Object.entries(res.files)) console.log(`  ${name.padEnd(13)} ${String(rows.length).padStart(5)}행`);
console.log(`  상태 ${Object.entries(res.statusCounts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`  03b 정의 ${res.definitionRefIds.length}행 · 경고 ${res.warnings.length}건`);
for (const w of res.warnings.slice(0, 20)) console.log(`  ! ${w}`);
