// 부팅 시 v0.81 데이터셋 픽스처를 한 트랜잭션으로 적재한다 (FF_SEED=v0.81 기본, none이면 생략).
// 이미 적재된 DB(meta.seed 존재)는 건드리지 않는다 — 운영 중 변경을 덮어쓰지 않기 위해.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATASET_FILES, type Dataset } from '@ff/contracts';
import type { Db } from './db';

export const DEFAULT_FIXTURES = join(__dirname, '..', '..', '..', 'data', 'fixtures', 'v0.81');

export function loadFixtures(dir = process.env.FF_FIXTURES ?? DEFAULT_FIXTURES): Dataset {
  const ds = {} as Record<string, unknown[]>;
  for (const [name, schema] of Object.entries(DATASET_FILES)) {
    const rows = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as unknown[];
    // 픽스처는 data:check로 이미 검증되지만, 계약이 바뀐 뒤의 오래된 픽스처를 부팅에서 바로 잡는다.
    ds[name] = rows.map((r, i) => {
      const p = (schema as any).safeParse(r);
      if (!p.success) throw new Error(`픽스처 ${name}[${i}] 스키마 위반: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}`);
      return p.data;
    });
  }
  return ds as unknown as Dataset;
}

export function seedDataset(db: Db, ds: Dataset, label = 'v0.81'): { seeded: boolean; counts: Record<string, number> } {
  const existing = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seed'");
  if (existing) return { seeded: false, counts: {} };
  const j = (x: unknown) => JSON.stringify(x);
  db.tx(() => {
    for (const f of ds.features) db.run('INSERT INTO feature_version VALUES (?, ?, ?, ?, ?)', f.featureId, f.version, f.lifecycle, f.baselineId, j(f));
    for (const b of ds.bomItems) db.run('INSERT INTO baseline VALUES (?, ?, ?, ?, ?)', b.baselineId, b.featureId, b.version, null, j(b));
    for (const p of ds.products) db.run('INSERT INTO product VALUES (?, ?, ?, ?)', p.catalogId, p.version, p.lifecycle, j(p));
    for (const d of ds.dependencies)
      db.run('INSERT INTO dependency VALUES (?, ?, ?, ?, ?, ?, ?)', d.dependencyId, d.type, d.sourceFeatureId, d.sourceVersion, d.targetFeatureId, d.targetVersion, j(d));
    for (const g of ds.gateRecords)
      db.run('INSERT INTO gate_record VALUES (?, ?, ?, ?, ?, ?, ?)', g.gateRecordId, g.featureId, g.featureVersion, g.gate, g.status, g.judgedAt, j(g));
    for (const e of ds.evidence) db.run('INSERT INTO evidence VALUES (?, ?, ?)', e.evidenceRef, e.gateRecordId, j(e));
    for (const f of ds.featureFunctions) db.run('INSERT INTO feature_function VALUES (?, ?, ?, ?)', f.featureId, f.featureVersion, f.functionId, j(f));
    for (const s of ds.swMaster) db.run('INSERT INTO sw_master VALUES (?, ?, ?, ?)', s.swId, s.version, s.ecuPno, j(s));
    for (const e of ds.ecuMaster) db.run('INSERT INTO ecu_master VALUES (?, ?)', e.ecuPno, j(e));
    for (const v of ds.versionRationale) db.run('INSERT INTO version_rationale VALUES (?, ?)', v.featureId, j(v));
    for (const r of ds.precheckRules) db.run('INSERT INTO precheck_rule VALUES (?, ?)', r.ruleId, j(r));
    db.run("INSERT INTO meta (key, value) VALUES ('seed', ?)", label);
  });
  const counts = Object.fromEntries(Object.entries(ds).map(([k, v]) => [k, (v as unknown[]).length]));
  return { seeded: true, counts };
}
