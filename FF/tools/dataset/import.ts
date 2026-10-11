// npm run data:import — data/source/*.xlsx → data/fixtures/v0.81/*.json + manifest.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from '../lib.ts';
import { IMPORTER_VERSION, importWorkbook, serialize, sha256 } from './import-lib.ts';

export const SOURCE = join(FF, 'data', 'source', 'feature_dataset_v0.81.xlsx');
export const OUT = join(FF, 'data', 'fixtures', 'v0.81');

const res = importWorkbook(readFileSync(SOURCE));
mkdirSync(OUT, { recursive: true });

const files: Record<string, { rows: number; sha256: string }> = {};
for (const [name, rows] of Object.entries(res.files)) {
  const text = serialize(rows);
  writeFileSync(join(OUT, `${name}.json`), text);
  files[name] = { rows: rows.length, sha256: sha256(text) };
}
const warningsText = serialize(res.warnings);
writeFileSync(join(OUT, 'warnings.json'), warningsText);

const manifest = {
  dataset: 'Feature_Catalog_BOM_DATASET',
  version: '0.81',
  importer: IMPORTER_VERSION,
  source: { file: 'data/source/feature_dataset_v0.81.xlsx', sha256: res.sourceSha256 },
  files,
  warnings: { count: res.warnings.length, sha256: sha256(warningsText) },
};
writeFileSync(join(OUT, 'manifest.json'), serialize(manifest));

console.log('data:import 완료');
for (const [n, f] of Object.entries(files)) console.log(`  ${n.padEnd(18)} ${String(f.rows).padStart(4)}행`);
console.log(`  경고 ${res.warnings.length}건 → data/fixtures/v0.81/warnings.json`);
