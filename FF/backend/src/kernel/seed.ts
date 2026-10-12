// 부팅 시 v0.81 데이터셋 픽스처를 한 트랜잭션으로 적재한다 (FF_SEED=v0.81 기본, none이면 생략).
// 이미 적재된 DB(meta.seed 존재)는 건드리지 않는다 — 운영 중 변경을 덮어쓰지 않기 위해.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, DATASET_FILES, EntitlementSchema, syntheticTrials, VehicleSchema, type Dataset, type Entitlement, type VehicleProfile } from '@ff/contracts';
import { z } from 'zod';
import type { Db } from './db';

export const DEFAULT_FIXTURES = join(__dirname, '..', '..', '..', 'data', 'fixtures', 'v0.81');
/** 데이터셋 밖의 데모 데이터 — Fleet·사용 권한 (Fleet 연계 IF-06/07·결제 시스템의 모의) */
export const DEMO_FIXTURES = join(__dirname, '..', '..', '..', 'data', 'fixtures', 'demo');

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
    for (const f of ds.features) db.run('INSERT INTO feature_version (feature_id, version, lifecycle, baseline_id, doc) VALUES (?, ?, ?, ?, ?)', f.featureId, f.version, f.lifecycle, f.baselineId, j(f));
    for (const b of ds.bomItems) db.run('INSERT INTO baseline (baseline_id, feature_id, version, content_hash, doc) VALUES (?, ?, ?, ?, ?)', b.baselineId, b.featureId, b.version, null, j(b));
    for (const p of ds.products) db.run('INSERT INTO product (catalog_id, version, lifecycle, doc) VALUES (?, ?, ?, ?)', p.catalogId, p.version, p.lifecycle, j(p));
    for (const d of ds.dependencies)
      db.run('INSERT INTO dependency (dependency_id, type, source_feature_id, source_version, target_feature_id, target_version, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', d.dependencyId, d.type, d.sourceFeatureId, d.sourceVersion, d.targetFeatureId, d.targetVersion, j(d));
    for (const g of ds.gateRecords)
      db.run('INSERT INTO gate_record (gate_record_id, feature_id, feature_version, gate, status, judged_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', g.gateRecordId, g.featureId, g.featureVersion, g.gate, g.status, g.judgedAt, j(g));
    for (const e of ds.evidence) db.run('INSERT INTO evidence (evidence_ref, gate_record_id, doc) VALUES (?, ?, ?)', e.evidenceRef, e.gateRecordId, j(e));
    for (const f of ds.featureFunctions) db.run('INSERT INTO feature_function (feature_id, feature_version, function_id, doc) VALUES (?, ?, ?, ?)', f.featureId, f.featureVersion, f.functionId, j(f));
    for (const s of ds.swMaster) db.run('INSERT INTO sw_master (sw_id, version, ecu_pno, doc) VALUES (?, ?, ?, ?)', s.swId, s.version, s.ecuPno, j(s));
    for (const e of ds.ecuMaster) db.run('INSERT INTO ecu_master (ecu_pno, doc) VALUES (?, ?)', e.ecuPno, j(e));
    for (const v of ds.versionRationale) db.run('INSERT INTO version_rationale (feature_id, doc) VALUES (?, ?)', v.featureId, j(v));
    for (const r of ds.precheckRules) db.run('INSERT INTO precheck_rule (rule_id, doc) VALUES (?, ?)', r.ruleId, j(r));
    db.run("INSERT INTO meta (key, value) VALUES ('seed', ?)", label);
  });
  const counts = Object.fromEntries(Object.entries(ds).map(([k, v]) => [k, (v as unknown[]).length]));
  return { seeded: true, counts };
}

/** 시드 기준일(KST) — FF_CLOCK_AT(시험 고정 시각)이 있으면 그 날, 없으면 오늘. 데모 권한 날짜는 이 날 기준 상대값이다 */
export function seedAnchor(): string {
  const t = process.env.FF_CLOCK_AT ? new Date(process.env.FF_CLOCK_AT) : new Date();
  return new Date(t.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 데모 권한 픽스처 — 날짜는 기준일로부터의 일수(고정 날짜는 시간이 지나면 데모를 깨뜨린다) */
const DemoGrant = z
  .object({
    grantId: z.string(),
    vin: z.string(),
    catalogId: z.string(),
    kind: z.enum(['구독', '구매', '체험']),
    status: z.string(),
    offeredDays: z.number().int().optional(),
    acceptedDays: z.number().int().optional(),
    fromDays: z.number().int(),
    toDays: z.number().int(),
    trialDays: z.number().int().optional(),
    convertedDays: z.number().int().optional(),
    convertedPlan: z.enum(['구독', '구매']).optional(),
    fromTrial: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
const DemoProfile = z.object({ vin: z.string(), region: z.string(), ageBand: z.string(), drivingStyle: z.string(), adasUsage: z.string() }).strict();

export function demoGrants(dir: string, anchor: string): Entitlement[] {
  const d = (n: number | undefined) => (n === undefined ? null : addDays(anchor, n));
  return DemoGrant.array()
    .parse(JSON.parse(readFileSync(join(dir, 'entitlements.json'), 'utf8')))
    .map((g) =>
      EntitlementSchema.parse({
        grantId: g.grantId,
        vin: g.vin,
        catalogId: g.catalogId,
        kind: g.kind,
        status: g.status,
        validFrom: d(g.fromDays),
        validTo: d(g.toDays),
        offeredAt: d(g.offeredDays),
        acceptedAt: d(g.acceptedDays),
        trialDays: g.trialDays ?? null,
        convertedAt: d(g.convertedDays),
        convertedPlan: g.convertedPlan ?? null,
        fromTrial: g.fromTrial ?? null,
        note: g.note ?? null,
        source: 'DEMO',
      }),
    );
}

/** 합성 모집단 크기 — FF_SYNTHETIC=0이면 넣지 않는다(기본 3000대) */
const syntheticSize = () => {
  const n = Number(process.env.FF_SYNTHETIC ?? 3000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** 데모 Fleet·사용 권한·차량 성향 + 통계용 합성 체험 모집단 시드 — 데이터셋 시드와 별개로 한 번만 */
export function seedDemo(db: Db, dir = process.env.FF_DEMO_FIXTURES ?? DEMO_FIXTURES, anchor = seedAnchor()): boolean {
  if (db.get("SELECT value FROM meta WHERE key = 'seed-demo'")) return false;
  const fleet = VehicleSchema.array().parse(JSON.parse(readFileSync(join(dir, 'fleet.json'), 'utf8')));
  const ents = demoGrants(dir, anchor);
  const byVin = new Map(fleet.map((v) => [v.vin, v]));
  const profiles: VehicleProfile[] = DemoProfile.array()
    .parse(JSON.parse(readFileSync(join(dir, 'profiles.json'), 'utf8')))
    .map((p) => {
      const v = byVin.get(p.vin);
      if (!v) throw new Error(`profiles.json: Fleet에 없는 차량 ${p.vin}`);
      return { ...p, vin: v.vin, country: v.country, vehicleModel: v.vehicleModel, trim: v.trim, source: 'DEMO' } as VehicleProfile;
    });
  const syn = syntheticSize() ? syntheticTrials(syntheticSize(), anchor) : { profiles: [], grants: [] };
  const insertGrant = (e: Entitlement) => db.run('INSERT INTO entitlement (grant_id, vin, catalog_id, status, source, doc) VALUES (?, ?, ?, ?, ?, ?)', e.grantId, e.vin, e.catalogId, e.status, e.source, JSON.stringify(e));
  db.tx(() => {
    for (const v of fleet) db.run('INSERT INTO vehicle (vin, doc) VALUES (?, ?)', v.vin, JSON.stringify(v));
    for (const e of ents) insertGrant(e);
    for (const p of [...profiles, ...syn.profiles]) db.run('INSERT INTO vehicle_profile (vin, source, doc) VALUES (?, ?, ?)', p.vin, p.source, JSON.stringify(p));
    for (const e of syn.grants) insertGrant(EntitlementSchema.parse(e));
    db.run("INSERT INTO meta (key, value) VALUES ('seed-demo', ?)", `v2 ${anchor} synthetic=${syn.grants.length}`);
  });
  return true;
}
