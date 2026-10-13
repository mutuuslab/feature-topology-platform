// npm run data:check — 커밋된 픽스처가 manifest와 일치하는지, 원본 xlsx를 다시 적재해도 같은지 검사.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, readJson } from '../lib.ts';
import { importWorkbook, serialize, sha256 } from './import-lib.ts';
import { buildProfiles, PROFILES, serializeProfiles } from './safety-infer.ts';

const OUT = join(FF, 'data', 'fixtures', 'v0.81');
const SOURCE = join(FF, 'data', 'source', 'feature_dataset_v0.81.xlsx');
const lf = (s: string) => s.replace(/\r\n/g, '\n');

const errors: string[] = [];
const manifest = readJson(join(OUT, 'manifest.json'));
for (const [name, meta] of Object.entries<any>(manifest.files)) {
  const p = join(OUT, `${name}.json`);
  if (!existsSync(p)) { errors.push(`${name}.json 없음`); continue; }
  const text = lf(readFileSync(p, 'utf8'));
  if (sha256(text) !== meta.sha256) errors.push(`${name}.json 해시 불일치 (손으로 고쳤다면 data:import로 다시 생성)`);
  const rows = JSON.parse(text).length;
  if (rows !== meta.rows) errors.push(`${name}.json 행 수 ${rows} ≠ manifest ${meta.rows}`);
}

if (existsSync(SOURCE)) {
  const buf = readFileSync(SOURCE);
  const res = importWorkbook(buf);
  if (res.sourceSha256 !== manifest.source.sha256) errors.push('원본 xlsx가 바뀜 — npm run data:import 후 커밋하세요');
  for (const [name, rows] of Object.entries(res.files)) {
    const committed = lf(readFileSync(join(OUT, `${name}.json`), 'utf8'));
    if (serialize(rows) !== committed) errors.push(`${name}.json 재적재 결과와 다름 (적재기 비결정성 또는 수동 수정)`);
  }
}

// 안전 프로파일 초안(보고서 5.7) — Feature Version 전부를 덮고, 데이터셋에서 다시 만들어도 같아야 한다
if (!existsSync(PROFILES)) errors.push('data/fixtures/safety/profiles.json 없음 — node tools/dataset/safety-infer.ts');
else if (lf(readFileSync(PROFILES, 'utf8')) !== serializeProfiles(buildProfiles())) errors.push('safety/profiles.json이 재생성 결과와 다름 — node tools/dataset/safety-infer.ts 후 커밋(손으로 고치지 않는다)');

console.log('data:check');
if (errors.length) {
  for (const e of errors) console.error('  ✕ ' + e);
  process.exit(1);
}
console.log(`  ✓ 픽스처 ${Object.keys(manifest.files).length}종 · manifest·재적재 일치 (경고 ${manifest.warnings.count}건) · 안전 프로파일 재생성 일치`);
