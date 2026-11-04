// npm run refdb:import — data/source/feature_db_v1.3.xlsx → data/reference/feature-db/v1.3/*.json + manifest.json (1회 이전, 30-95 §9)
// 이후 원천은 FF다(D-REF-5). 빈 DB 첫 기동 때 시드가 이 JSON을 'v1.3 (엑셀 가져옴)' 발행으로 넣는다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from '../lib.ts';
import { REFDB_IMPORTER_VERSION, REFDB_RELEASE, importFeatureDb, serializeRows, sha256 } from './import-lib.ts';

export const REFDB_SOURCE = join(FF, 'data', 'source', 'feature_db_v1.3.xlsx');
export const REFDB_OUT = join(FF, 'data', 'reference', 'feature-db', REFDB_RELEASE);

const res = importFeatureDb(readFileSync(REFDB_SOURCE));
mkdirSync(REFDB_OUT, { recursive: true });
const files: Record<string, { rows: number; sha256: string }> = {};
for (const [name, rows] of Object.entries(res.files)) {
  const body = serializeRows(rows);
  writeFileSync(join(REFDB_OUT, `${name}.json`), body);
  files[name] = { rows: rows.length, sha256: sha256(body) };
}
const warningsText = serializeRows(res.warnings);
writeFileSync(join(REFDB_OUT, 'warnings.json'), warningsText);
const manifest = {
  dataset: 'Automotive_SW_개발비_산정도구_FeatureDB',
  release: REFDB_RELEASE,
  importer: REFDB_IMPORTER_VERSION,
  source: { file: 'data/source/feature_db_v1.3.xlsx', sha256: res.sourceSha256 },
  files,
  warnings: { count: res.warnings.length, sha256: sha256(warningsText) },
};
writeFileSync(join(REFDB_OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`refdb:import ${REFDB_RELEASE} — ${Object.entries(files).map(([k, v]) => `${k} ${v.rows}`).join(' · ')} · 경고 ${res.warnings.length}`);
