// npm run data:check — 커밋된 픽스처가 manifest와 일치하는지, 원본 xlsx를 다시 적재해도 같은지 검사.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, readJson } from '../lib.ts';
import { importWorkbook, serialize, sha256 } from './import-lib.ts';
import { buildProfiles, PROFILES, serializeProfiles } from './safety-infer.ts';
import { unguardedRequiredQueries } from './static-queries.ts';
import { importFeatureDb, serializeRows, sha256 as refSha } from '../refdb/import-lib.ts';

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

// 정적 데모·실서버 조회 — 필수 질의(requiredQuery)가 있는 조회는 값이 준비될 때까지 enabled로 막는다(빈 값 요청 = 없는 스냅샷·400)
const unguarded = unguardedRequiredQueries();
for (const u of unguarded) errors.push(`${u.file}:${u.line} — '${u.route}' 조회에 enabled가 없다(필수 질의가 비어 있을 때 요청이 나간다 — contracts requiredQuery)`);

// Feature DB 1회 이전본(30-95 §9) — manifest 해시·행 수, 엑셀을 다시 가져와도 같은지, 엑셀 15_DB운영 지표와 같은 수인지
const REFDB = join(FF, 'data', 'reference', 'feature-db', 'v1.3');
const REFDB_SOURCE = join(FF, 'data', 'source', 'feature_db_v1.3.xlsx');
let refdbNote = '';
if (!existsSync(join(REFDB, 'manifest.json'))) errors.push('data/reference/feature-db/v1.3/manifest.json 없음 — npm run refdb:import');
else {
  const rm = readJson(join(REFDB, 'manifest.json'));
  for (const [name, meta] of Object.entries<any>(rm.files)) {
    const text = lf(readFileSync(join(REFDB, `${name}.json`), 'utf8'));
    if (refSha(text) !== meta.sha256) errors.push(`Feature DB ${name}.json 해시 불일치 — 원천은 FF다(D-REF-5). 이전본을 고치려면 npm run refdb:import`);
  }
  const refs = JSON.parse(readFileSync(join(REFDB, 'refs.json'), 'utf8')) as { refId: string; status: string; sourceIds: string[]; domain: string; component: string }[];
  const sources = new Set((JSON.parse(readFileSync(join(REFDB, 'sources.json'), 'utf8')) as { sourceId: string }[]).map((x) => x.sourceId));
  const by = (k: string) => refs.filter((r) => r.status === k).length;
  if (refs.length !== 1052 || by('ACTIVE') !== 995 || by('REVIEW') !== 53 || by('DEPRECATED') !== 4) errors.push(`Feature DB 행 수 ${refs.length}·상태 ${by('ACTIVE')}/${by('REVIEW')}/${by('DEPRECATED')} ≠ 엑셀 1,052·995/53/4`);
  if (new Set(refs.map((r) => r.refId)).size !== refs.length) errors.push('Feature DB ID 중복');
  const lost = [...new Set(refs.flatMap((r) => r.sourceIds).filter((s) => !sources.has(s)))];
  if (lost.length) errors.push(`Feature DB 출처 ID가 출처 목록에 없음: ${lost.join(', ')}`);
  if (new Set(refs.map((r) => r.domain)).size !== 10 || new Set(refs.map((r) => `${r.domain}|${r.component}`)).size !== 69) errors.push('Feature DB 도메인 10·컴포넌트 69가 아님 — 열 대응 확인');
  if (existsSync(REFDB_SOURCE)) {
    const res = importFeatureDb(readFileSync(REFDB_SOURCE));
    if (res.sourceSha256 !== rm.source.sha256) errors.push('Feature DB 원본 xlsx가 바뀜 — npm run refdb:import 후 커밋');
    for (const [name, rows] of Object.entries(res.files)) if (serializeRows(rows) !== lf(readFileSync(join(REFDB, `${name}.json`), 'utf8'))) errors.push(`Feature DB ${name}.json 재가져오기 결과와 다름`);
  }
  refdbNote = ` · Feature DB ${refs.length}행 재가져오기 일치`;
}

console.log('data:check');
if (errors.length) {
  for (const e of errors) console.error('  ✕ ' + e);
  process.exit(1);
}
console.log(`  ✓ 픽스처 ${Object.keys(manifest.files).length}종 · manifest·재적재 일치 (경고 ${manifest.warnings.count}건) · 안전 프로파일 재생성 일치 · 필수 질의 조회는 모두 enabled로 막힘${refdbNote}`);
