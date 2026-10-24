// 정책·검증 이력·차량·사용 권한 저장소 (키 열 + doc JSON)
import { Inject, Injectable } from '@nestjs/common';
import { canonicalJson, PolicySpec, policySpecOf, type Entitlement, type Policy, type PolicyRevision, type PolicyRevisionKind, type Vehicle, type VehicleProfile } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { vehiclePseudonym } from '../../kernel/crypto';
import { DB, type Db } from '../../kernel/db';
import type { ValidatorResult } from '@ff/contracts';

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const parse = <T>(rows: { doc: string }[]) => rows.map((r) => JSON.parse(r.doc) as T);

/**
 * 정책 바이트열 — 정책 내용(PolicySpec 필드만)을 정규 JSON으로. 같은 입력이면 키 순서·부가 필드와 무관하게 같은 바이트열이 나온다.
 * @rule FFG-PLT-014 — 결정적 생성 + 대표 정책 Golden(backend/test/d06/policy-golden.spec.ts, 생성기를 바꾸면 Golden 비교 통과 필요)
 */
export function policyBytes(p: Policy | PolicySpec): string {
  return canonicalJson(PolicySpec.parse(Object.fromEntries(Object.keys(PolicySpec.shape).map((k) => [k, (p as any)[k]]))));
}

/** 정책 내용 해시 — 승인한 내용과 배포할 내용이 같은지(P0 publishCheck HASH_MISMATCH) 확인하는 기준 */
export function policyHash(p: Policy | PolicySpec): string {
  return 'sha256:' + createHash('sha256').update(policyBytes(p)).digest('hex');
}

interface RevisionRow {
  policy_id: string;
  revision: number;
  content_hash: string;
  kind: PolicyRevisionKind;
  changed_by: string;
  changed_at: string;
  restored_from: number | null;
  reason: string | null;
  doc: string;
}
const toRevision = (r: RevisionRow): PolicyRevision => ({
  policyId: r.policy_id,
  revision: r.revision,
  contentHash: r.content_hash,
  kind: r.kind,
  changedBy: r.changed_by,
  changedAt: r.changed_at,
  restoredFrom: r.restored_from,
  reason: r.reason,
  spec: policySpecOf(JSON.parse(r.doc)),
});

export interface ValidationRun {
  runId: string;
  policyId: string;
  policyRevision: number;
  contentHash: string;
  decision: 'GO' | 'HOLD' | 'BLOCKED';
  reasons: string[];
  at: string;
  by: string;
  results: ValidatorResult[];
}

@Injectable()
export class PolicyRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  get(id: string): Policy | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM policy WHERE policy_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  all(): Policy[] {
    return parse<Policy>(this.db.all('SELECT doc FROM policy ORDER BY policy_id'));
  }
  forFeature(featureId: string, version: string): Policy[] {
    return parse<Policy>(this.db.all('SELECT doc FROM policy WHERE feature_id = ? AND feature_version = ? ORDER BY policy_id', featureId, version));
  }
  byFlag(flagKey: string): Policy[] {
    return parse<Policy>(this.db.all('SELECT doc FROM policy WHERE flag_key = ? ORDER BY policy_id', flagKey));
  }
  /** 이 flagKey로 지금 배포된 정책 (차량 평가 기준) */
  deployed(flagKey: string): Policy | undefined {
    const r = this.db.get<{ doc: string }>("SELECT doc FROM policy WHERE flag_key = ? AND status = 'DEPLOYED' ORDER BY revision DESC LIMIT 1", flagKey);
    return r ? JSON.parse(r.doc) : undefined;
  }
  /** Control Point 중 승인·배포 정책이 있는 수 — Lifecycle DEVELOPING→VERIFIED 조건 */
  coverage(featureId: string, version: string): number {
    return this.db.get<{ n: number }>(
      "SELECT count(DISTINCT control_point) AS n FROM policy WHERE feature_id = ? AND feature_version = ? AND status IN ('APPROVED','DEPLOYED')",
      featureId,
      version,
    )!.n;
  }
  /** 새 정책 — 첫 개정본도 함께 남긴다(작성자·작성 시각) */
  insert(p: Policy) {
    this.db.run(
      'INSERT INTO policy (policy_id, feature_id, feature_version, control_point, flag_key, status, revision, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      p.policyId,
      p.featureId,
      p.featureVersion,
      p.controlPoint,
      p.flagKey,
      p.status,
      p.revision,
      JSON.stringify(p),
    );
    this.insertRevision(p, { kind: 'CREATE', by: p.createdBy, at: p.createdAt });
  }
  /**
   * 정책 갱신 — 내용이 바뀌어 개정본이 오르면 revision에 그 개정본 기록(누가·언제·왜)을 넘긴다.
   * 기록 없는 개정본으로 저장하려 하면 거부한다 — 개정본 내용이 덮어써져 사라지지 않게(FR-PVER-002-001).
   */
  update(p: Policy, revision?: { kind: Exclude<PolicyRevisionKind, 'CREATE' | 'IMPORTED'>; by: string; at: string; restoredFrom?: number | null; reason?: string | null }) {
    if (revision) this.insertRevision(p, revision);
    else if (!this.revision(p.policyId, p.revision)) throw new Error(`${p.policyId} r${p.revision} 개정본 기록 없이 정책을 저장하려 했습니다.`);
    this.db.run('UPDATE policy SET status = ?, revision = ?, flag_key = ?, control_point = ?, doc = ? WHERE policy_id = ?', p.status, p.revision, p.flagKey, p.controlPoint, JSON.stringify(p), p.policyId);
  }
  private insertRevision(p: Policy, r: { kind: PolicyRevisionKind; by: string; at: string; restoredFrom?: number | null; reason?: string | null }) {
    this.db.run(
      'INSERT INTO policy_revision (policy_id, revision, content_hash, kind, changed_by, changed_at, restored_from, reason, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.policyId,
      p.revision,
      policyHash(p),
      r.kind,
      r.by,
      r.at,
      r.restoredFrom ?? null,
      r.reason ?? null,
      JSON.stringify(p),
    );
  }
  /** 개정본 목록 — 오름차순 */
  revisions(policyId: string): PolicyRevision[] {
    return this.db
      .all<RevisionRow>('SELECT * FROM policy_revision WHERE policy_id = ? ORDER BY revision', policyId)
      .map(toRevision);
  }
  revision(policyId: string, revision: number): PolicyRevision | undefined {
    const r = this.db.get<RevisionRow>('SELECT * FROM policy_revision WHERE policy_id = ? AND revision = ?', policyId, revision);
    return r ? toRevision(r) : undefined;
  }
  nextId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(policy_id, 5) AS INTEGER)) AS m FROM policy');
    return `POL-${pad((r?.m ?? 0) + 1, 5)}`;
  }

  // 검증 이력 (D06-04)
  insertRun(v: ValidationRun) {
    this.db.run(
      'INSERT INTO validation_run (run_id, policy_id, policy_revision, content_hash, decision, at, by_actor, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      v.runId,
      v.policyId,
      v.policyRevision,
      v.contentHash,
      v.decision,
      v.at,
      v.by,
      JSON.stringify(v),
    );
  }
  run(id: string): ValidationRun | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM validation_run WHERE run_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  runs(policyId?: string): ValidationRun[] {
    return policyId
      ? parse<ValidationRun>(this.db.all('SELECT doc FROM validation_run WHERE policy_id = ? ORDER BY at DESC, run_id DESC', policyId))
      : parse<ValidationRun>(this.db.all('SELECT doc FROM validation_run ORDER BY at DESC, run_id DESC LIMIT 200'));
  }
  nextRunId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(run_id, 5) AS INTEGER)) AS m FROM validation_run');
    return `VAL-${pad((r?.m ?? 0) + 1, 6)}`;
  }
}

@Injectable()
export class FleetRepo {
  /** 권한·성향 쓰기마다 오른다 — 대규모 표본 집계 캐시의 무효화 기준 */
  private rev = 0;
  private synCache: { rev: number; grants: Entitlement[]; byVin: Map<string, Entitlement[]> } | null = null;
  private profCache: { rev: number; profiles: Map<string, VehicleProfile> } | null = null;
  constructor(@Inject(DB) private readonly db: Db) {}
  get revision() {
    return this.rev;
  }
  /** 합성·표본 권한 전부와 VIN별 묶음 — 같은 revision이면 다시 읽지 않는다(5년 운영 표본 수십만 건) */
  syntheticGrants(): { grants: Entitlement[]; byVin: Map<string, Entitlement[]> } {
    if (this.synCache?.rev === this.rev) return this.synCache;
    const grants = this.grants(undefined, 'SYNTHETIC');
    const byVin = new Map<string, Entitlement[]>();
    for (const g of grants) {
      const xs = byVin.get(g.vin);
      if (xs) xs.push(g);
      else byVin.set(g.vin, [g]);
    }
    this.synCache = { rev: this.rev, grants, byVin };
    return this.synCache;
  }
  insertProfile(p: VehicleProfile) {
    this.rev++;
    this.db.run('INSERT INTO vehicle_profile (vin, source, doc) VALUES (?, ?, ?)', p.vin, p.source, JSON.stringify(p));
  }
  insertVehicle(v: Vehicle) {
    this.pseudonyms = null;
    this.db.run('INSERT INTO vehicle (vin, doc) VALUES (?, ?)', v.vin, JSON.stringify(v));
  }
  /** 가명 → VIN 표(차량이 늘 때만 다시 만든다, 트랜잭션 안에서는 만들지 않는다) — OFREP·GLEO가 요청마다 전 차량의 가명을 해시하던 것
   *  (차량 10만 대에서 요청당 해시 10만 번, 출시 준비 RD-P2-01). VIN은 바뀌지 않으므로 가명도 바뀌지 않는다 */
  private pseudonyms: Map<string, string> | null = null;
  vinByPseudonym(pseudonym: string): string | undefined {
    if (this.pseudonyms) return this.pseudonyms.get(pseudonym);
    const map = new Map<string, string>();
    for (const { vin } of this.db.all<{ vin: string }>('SELECT vin FROM vehicle')) map.set(vehiclePseudonym(vin), vin);
    if (!this.db.inTransaction) this.pseudonyms = map;
    return map.get(pseudonym);
  }
  vehicles(): Vehicle[] {
    return parse<Vehicle>(this.db.all('SELECT doc FROM vehicle ORDER BY vin'));
  }
  /** 적용 범위(국가·차종·트림)가 맞는 차량만 — 전체를 읽어 거르지 않는다(식 색인 vehicle_scope, 마이그레이션 070) */
  vehiclesInScope(scopes: { country: string; vehicleModel: string; trim: string }[]): Vehicle[] {
    const uniq = [...new Map(scopes.map((s) => [`${s.country}|${s.vehicleModel}|${s.trim}`, s])).values()];
    if (!uniq.length) return [];
    const where = uniq.map(() => "(json_extract(doc, '$.country') = ? AND json_extract(doc, '$.vehicleModel') = ? AND json_extract(doc, '$.trim') = ?)").join(' OR ');
    return parse<Vehicle>(this.db.all(`SELECT doc FROM vehicle WHERE ${where} ORDER BY vin`, ...uniq.flatMap((s) => [s.country, s.vehicleModel, s.trim])));
  }
  /** 지정한 차량만(없는 VIN은 빠진다), VIN 순 */
  vehiclesByVin(vins: string[]): Vehicle[] {
    const ids = [...new Set(vins)];
    const out: Vehicle[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      out.push(...parse<Vehicle>(this.db.all(`SELECT doc FROM vehicle WHERE vin IN (${chunk.map(() => '?').join(',')})`, ...chunk)));
    }
    return out.sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0));
  }
  /** 차량 한 페이지(VIN 순, after 다음부터) — 목록 화면·가젯이 전체를 받지 않게 */
  vehiclePage(limit: number, after?: string): Vehicle[] {
    return after ? parse<Vehicle>(this.db.all('SELECT doc FROM vehicle WHERE vin > ? ORDER BY vin LIMIT ?', after, limit)) : parse<Vehicle>(this.db.all('SELECT doc FROM vehicle ORDER BY vin LIMIT ?', limit));
  }
  vehicleCounts(): { total: number; sample: number } {
    // 둘 다 색인만 센다(vehicle_scope·vehicle_fleet) — 문서를 풀지 않는다
    const total = this.db.get<{ n: number }>('SELECT count(*) AS n FROM vehicle')!.n;
    const sample = this.db.get<{ n: number }>("SELECT count(*) AS n FROM vehicle WHERE json_extract(doc, '$.fleet') = 'SAMPLE'")!.n;
    return { total, sample };
  }
  vehicle(vin: string): Vehicle | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle WHERE vin = ?', vin);
    return r ? JSON.parse(r.doc) : undefined;
  }
  updateVehicle(v: Vehicle) {
    this.db.run('UPDATE vehicle SET doc = ? WHERE vin = ?', JSON.stringify(v), v.vin);
  }
  /** 차량을 지정하면 그 차량의 전부, 아니면 데모 권한만(합성 모집단은 통계·목록 화면에서 따로 고른다) */
  grants(vin?: string, source: 'DEMO' | 'SYNTHETIC' | 'ALL' = 'DEMO'): Entitlement[] {
    if (vin) return parse<Entitlement>(this.db.all('SELECT doc FROM entitlement WHERE vin = ? ORDER BY grant_id', vin));
    return source === 'ALL' ? parse<Entitlement>(this.db.all('SELECT doc FROM entitlement ORDER BY grant_id')) : parse<Entitlement>(this.db.all('SELECT doc FROM entitlement WHERE source = ? ORDER BY grant_id', source));
  }
  grantsForCatalog(catalogId: string, source: 'DEMO' | 'SYNTHETIC' | 'ALL'): Entitlement[] {
    return source === 'ALL'
      ? parse<Entitlement>(this.db.all('SELECT doc FROM entitlement WHERE catalog_id = ? ORDER BY grant_id', catalogId))
      : parse<Entitlement>(this.db.all('SELECT doc FROM entitlement WHERE catalog_id = ? AND source = ? ORDER BY grant_id', catalogId, source));
  }
  insertGrant(e: Entitlement) {
    this.rev++;
    this.db.run('INSERT INTO entitlement (grant_id, vin, catalog_id, status, source, doc) VALUES (?, ?, ?, ?, ?, ?)', e.grantId, e.vin, e.catalogId, e.status, e.source, JSON.stringify(e));
  }
  /**
   * 권한 다음 번호(ENT-xxxxx) — 합성(ENT-S…)과 섞이지 않는다. 번호는 meta 카운터에 둔다:
   * 권한이 수십만 건이면 매번 최대값을 훑는 질의가 제안 한 건마다 표 전체를 읽는다(5년 운영). 카운터가 없으면 한 번만 최대값으로 맞춘다.
   * 문자열 max는 ENT-99999 > ENT-100000으로 잘못 고르므로 숫자로 비교한다. 호출자의 트랜잭션이 롤백되면 카운터도 함께 되돌아간다.
   * ENT- 번호 권한은 시드 뒤에는 이 함수로만 만든다(직접 번호를 넣으면 카운터와 겹칠 수 있다).
   */
  nextGrantId(): string {
    const cur = this.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seq:grant'");
    const last = cur ? Number(cur.value) : (this.db.get<{ m: number | null }>("SELECT max(CAST(substr(grant_id, 5) AS INTEGER)) AS m FROM entitlement WHERE grant_id NOT LIKE 'ENT-S%'")?.m ?? 0);
    this.db.run("INSERT INTO meta (key, value) VALUES ('seq:grant', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(last + 1));
    return `ENT-${pad(last + 1, 5)}`;
  }
  /** 저장 상태가 ACTIVE인 권한 — 만료 sweep 대상(색인) */
  activeGrants(): Entitlement[] {
    return parse<Entitlement>(this.db.all("SELECT doc FROM entitlement WHERE status = 'ACTIVE' ORDER BY grant_id"));
  }
  profiles(): Map<string, VehicleProfile> {
    if (this.profCache?.rev === this.rev) return this.profCache.profiles;
    const profiles = new Map(parse<VehicleProfile>(this.db.all('SELECT doc FROM vehicle_profile')).map((p) => [p.vin, p]));
    this.profCache = { rev: this.rev, profiles };
    return profiles;
  }
  profile(vin: string): VehicleProfile | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle_profile WHERE vin = ?', vin);
    return r ? JSON.parse(r.doc) : undefined;
  }
  grant(id: string): Entitlement | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM entitlement WHERE grant_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  updateGrant(e: Entitlement) {
    this.rev++;
    this.db.run('UPDATE entitlement SET status = ?, doc = ? WHERE grant_id = ?', e.status, JSON.stringify(e), e.grantId);
  }
}
