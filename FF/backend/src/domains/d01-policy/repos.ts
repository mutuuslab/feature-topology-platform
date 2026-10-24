// d01 정책 관리 도메인의 저장소 — 키 열 + doc(JSON). 읽을 때 contracts 스키마 타입으로 돌려준다.
// 서비스는 SQL을 직접 쓰지 않고 이 저장소만 쓴다(Postgres 전환 시 교체 지점).
import { Inject, Injectable } from '@nestjs/common';
import {
  compareVersion,
  type BomItemRow,
  type DependencyRow,
  type EcuMasterRow,
  type EvidenceRow,
  type FeatureFunctionRow,
  type FeatureVersionRow,
  type GateId,
  type GateRecordRow,
  type PrecheckRuleRow,
  type ProductRow,
  type SwMasterRow,
  type VersionRationaleRow,
} from '@ff/contracts';
import { DB, type Db } from '../../kernel/db';

const parse = <T>(rows: { doc: string }[]): T[] => rows.map((r) => JSON.parse(r.doc) as T);
const byVersion = <T extends { version: string }>(a: T, b: T) => compareVersion(a.version, b.version);
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export interface FeatureMeta {
  createdBy: string | null;
  createdAt: string | null;
}

export interface BaselineRequest {
  requestId: string;
  featureId: string;
  version: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedAt: string;
  reason: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  baselineId: string | null;
}

export interface BaselineRecord {
  baselineId: string;
  featureId: string;
  version: string;
  contentHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  requestId: string | null;
  snapshot: BomItemRow;
}

/** 캐시한 행을 호출자가 고치지 못하게(고치면 엄격 모드에서 TypeError) — 캐시 오염 대신 바로 드러난다 */
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

@Injectable()
export class FeatureRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  /** all() 캐시 — 이 저장소의 쓰기(insert·update)가 rev를 올려 무효화한다. 트랜잭션 안에서는 만들지 않는다(롤백될 내용이 캐시에 남지 않게).
   *  Feature 목록·대시보드가 요청마다 2천여 버전 문서를 다시 파싱·정렬하던 것(출시 준비 RD-P2-01). 한 설치 = 한 프로세스(SQLite 단일 쓰기) 전제 */
  private rev = 0;
  private cache: { rev: number; rows: readonly FeatureVersionRow[] } | null = null;

  get(featureId: string, version: string): FeatureVersionRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_version WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? JSON.parse(r.doc) : undefined;
  }
  meta(featureId: string, version: string): FeatureMeta {
    const r = this.db.get<{ created_by: string | null; created_at: string | null }>(
      'SELECT created_by, created_at FROM feature_version WHERE feature_id = ? AND version = ?',
      featureId,
      version,
    );
    return { createdBy: r?.created_by ?? null, createdAt: r?.created_at ?? null };
  }
  versions(featureId: string): FeatureVersionRow[] {
    return parse<FeatureVersionRow>(this.db.all('SELECT doc FROM feature_version WHERE feature_id = ?', featureId)).sort(byVersion);
  }
  all(): FeatureVersionRow[] {
    if (this.cache?.rev === this.rev) return this.cache.rows.slice();
    // Feature ID는 'FEAT-' + 숫자(ASCII) — 코드 단위 비교가 localeCompare와 같은 순서이고 훨씬 빠르다
    const rows = parse<FeatureVersionRow>(this.db.all('SELECT doc FROM feature_version ORDER BY feature_id')).sort(
      (a, b) => (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0) || byVersion(a, b),
    );
    if (this.db.inTransaction) return rows;
    this.cache = { rev: this.rev, rows: deepFreeze(rows) };
    return rows.slice();
  }
  insert(f: FeatureVersionRow, meta: FeatureMeta) {
    this.rev++;
    this.cache = null;
    this.db.run(
      'INSERT INTO feature_version (feature_id, version, lifecycle, baseline_id, doc, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      f.featureId,
      f.version,
      f.lifecycle,
      f.baselineId,
      JSON.stringify(f),
      meta.createdBy,
      meta.createdAt,
    );
  }
  update(f: FeatureVersionRow) {
    this.rev++;
    this.cache = null;
    this.db.run(
      'UPDATE feature_version SET lifecycle = ?, baseline_id = ?, doc = ? WHERE feature_id = ? AND version = ?',
      f.lifecycle,
      f.baselineId,
      JSON.stringify(f),
      f.featureId,
      f.version,
    );
  }
  nextFeatureId(): string {
    const r = this.db.get<{ m: number | null }>("SELECT max(CAST(substr(feature_id, 6) AS INTEGER)) AS m FROM feature_version");
    return `FEAT-${pad((r?.m ?? 0) + 1, 5)}`;
  }
  /** 같은 적용 범위(국가·차종·트림)의 같은·유사 명칭 Feature — 중복 등록 방지 */
  similar(name: string, country: string, vehicleModel: string, trim: string): FeatureVersionRow[] {
    const key = name.replace(/\s+/g, '').toLowerCase();
    return this.all().filter(
      (f) =>
        f.country === country &&
        f.vehicleModel === vehicleModel &&
        f.trim === trim &&
        (f.name.replace(/\s+/g, '').toLowerCase().includes(key) || key.includes(f.name.replace(/\s+/g, '').toLowerCase())),
    );
  }
}

@Injectable()
export class GateRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  private rev = 0;
  private statusCache: { rev: number; map: Map<string, Record<string, string>> } | null = null;

  history(featureId: string, version: string): GateRecordRow[] {
    return parse<GateRecordRow>(
      this.db.all('SELECT doc FROM gate_record WHERE feature_id = ? AND feature_version = ? ORDER BY gate, judged_at, gate_record_id', featureId, version),
    );
  }
  /** Gate별 최신 레코드 (재판정 시 새 레코드가 생기므로 시각·ID가 가장 늦은 것) */
  latest(featureId: string, version: string): Partial<Record<GateId, GateRecordRow>> {
    const out: Partial<Record<GateId, GateRecordRow>> = {};
    for (const g of this.history(featureId, version)) out[g.gate] = g;
    return out;
  }
  /** Feature 버전별 Gate별 최신 상태 — latest()와 같은 순서(gate, judged_at, gate_record_id)로 마지막 것. 본문(doc)은 읽지 않는다.
   *  keys가 null이면 전체, 아니면 그 버전들만(목록 한 페이지) — 키는 'FEAT-xxxxx@버전' */
  latestStatuses(keys: { featureId: string; version: string }[] | null): Map<string, Record<string, string>> {
    const out = new Map<string, Record<string, string>>();
    const put = (r: { feature_id: string; feature_version: string; gate: string; status: string }) => {
      const k = `${r.feature_id}@${r.feature_version}`;
      const m = out.get(k) ?? {};
      m[r.gate] = r.status;
      out.set(k, m);
    };
    type R = { feature_id: string; feature_version: string; gate: string; status: string };
    if (keys === null) {
      // 전체 표는 캐시한다(Gate 기록 쓰기는 insert뿐 — rev로 무효화, 트랜잭션 안에서는 만들지 않는다)
      if (this.statusCache?.rev === this.rev) return this.statusCache.map;
      for (const r of this.db.all<R>('SELECT feature_id, feature_version, gate, status FROM gate_record ORDER BY gate, judged_at, gate_record_id')) put(r);
      for (const v of out.values()) Object.freeze(v);
      if (!this.db.inTransaction) this.statusCache = { rev: this.rev, map: out };
      return out;
    }
    const want = new Set(keys.map((k) => `${k.featureId}@${k.version}`));
    const ids = [...new Set(keys.map((k) => k.featureId))];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.all<R>(`SELECT feature_id, feature_version, gate, status FROM gate_record WHERE feature_id IN (${chunk.map(() => '?').join(',')}) ORDER BY gate, judged_at, gate_record_id`, ...chunk);
      for (const r of rows) if (want.has(`${r.feature_id}@${r.feature_version}`)) put(r);
    }
    return out;
  }
  insert(g: GateRecordRow) {
    this.rev++;
    this.statusCache = null;
    this.db.run(
      'INSERT INTO gate_record (gate_record_id, feature_id, feature_version, gate, status, judged_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)',
      g.gateRecordId,
      g.featureId,
      g.featureVersion,
      g.gate,
      g.status,
      g.judgedAt,
      JSON.stringify(g),
    );
  }
  /** SIM-Gn-NNNNNN의 일련번호는 Gate와 무관하게 전역 증가 */
  nextId(gate: GateId): string {
    const r = this.db.get<{ m: number | null }>("SELECT max(CAST(substr(gate_record_id, 8) AS INTEGER)) AS m FROM gate_record");
    return `SIM-${gate}-${pad((r?.m ?? 0) + 1, 6)}`;
  }
  all(): GateRecordRow[] {
    return parse<GateRecordRow>(this.db.all('SELECT doc FROM gate_record ORDER BY gate_record_id'));
  }
  allEvidence(): EvidenceRow[] {
    return parse<EvidenceRow>(this.db.all('SELECT doc FROM evidence ORDER BY gate_record_id'));
  }
  precheckRules(): PrecheckRuleRow[] {
    return parse<PrecheckRuleRow>(this.db.all('SELECT doc FROM precheck_rule ORDER BY rule_id'));
  }
  evidence(gateRecordId: string): EvidenceRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM evidence WHERE gate_record_id = ?', gateRecordId);
    return r ? JSON.parse(r.doc) : undefined;
  }
}

@Injectable()
export class TopologyRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  all(): DependencyRow[] {
    return parse<DependencyRow>(this.db.all('SELECT doc FROM dependency ORDER BY dependency_id'));
  }
  outgoing(featureId: string, version: string): DependencyRow[] {
    return parse<DependencyRow>(this.db.all('SELECT doc FROM dependency WHERE source_feature_id = ? AND source_version = ? ORDER BY dependency_id', featureId, version));
  }
  incoming(featureId: string): DependencyRow[] {
    return parse<DependencyRow>(this.db.all('SELECT doc FROM dependency WHERE target_feature_id = ? ORDER BY dependency_id', featureId));
  }
  functions(featureId: string, version: string): FeatureFunctionRow[] {
    return parse<FeatureFunctionRow>(this.db.all('SELECT doc FROM feature_function WHERE feature_id = ? AND feature_version = ?', featureId, version)).sort(
      (a, b) => a.sequence - b.sequence,
    );
  }
  sw(swId: string, version: string): SwMasterRow[] {
    return parse<SwMasterRow>(this.db.all('SELECT doc FROM sw_master WHERE sw_id = ? AND version = ?', swId, version));
  }
  ecu(ecuPno: string): EcuMasterRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ecu_master WHERE ecu_pno = ?', ecuPno);
    return r ? JSON.parse(r.doc) : undefined;
  }
  get(dependencyId: string): DependencyRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM dependency WHERE dependency_id = ?', dependencyId);
    return r ? JSON.parse(r.doc) : undefined;
  }
  insert(d: DependencyRow) {
    this.db.run(
      'INSERT INTO dependency (dependency_id, type, source_feature_id, source_version, target_feature_id, target_version, doc) VALUES (?, ?, ?, ?, ?, ?, ?)',
      d.dependencyId,
      d.type,
      d.sourceFeatureId,
      d.sourceVersion,
      d.targetFeatureId,
      d.targetVersion,
      JSON.stringify(d),
    );
  }
  update(d: DependencyRow) {
    this.db.run('UPDATE dependency SET target_version = ?, doc = ? WHERE dependency_id = ?', d.targetVersion, JSON.stringify(d), d.dependencyId);
  }
  nextId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(dependency_id, 5) AS INTEGER)) AS m FROM dependency');
    return `DEP-${pad((r?.m ?? 0) + 1, 5)}`;
  }
  allFunctions(): FeatureFunctionRow[] {
    return parse<FeatureFunctionRow>(this.db.all('SELECT doc FROM feature_function'));
  }
  allSw(): SwMasterRow[] {
    return parse<SwMasterRow>(this.db.all('SELECT doc FROM sw_master'));
  }
  allEcu(): EcuMasterRow[] {
    return parse<EcuMasterRow>(this.db.all('SELECT doc FROM ecu_master'));
  }
  allRationale(): VersionRationaleRow[] {
    return parse<VersionRationaleRow>(this.db.all('SELECT doc FROM version_rationale'));
  }
  rationale(featureId: string): VersionRationaleRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM version_rationale WHERE feature_id = ?', featureId);
    return r ? JSON.parse(r.doc) : undefined;
  }
}

@Injectable()
export class BaselineRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  private map(r: any): BaselineRecord {
    return {
      baselineId: r.baseline_id,
      featureId: r.feature_id,
      version: r.version,
      contentHash: r.content_hash,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      requestId: r.request_id,
      snapshot: JSON.parse(r.doc),
    };
  }
  get(baselineId: string): BaselineRecord | undefined {
    const r = this.db.get('SELECT * FROM baseline WHERE baseline_id = ?', baselineId);
    return r ? this.map(r) : undefined;
  }
  forVersion(featureId: string, version: string): BaselineRecord | undefined {
    const r = this.db.get('SELECT * FROM baseline WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? this.map(r) : undefined;
  }
  forFeature(featureId: string): BaselineRecord[] {
    return this.db.all('SELECT * FROM baseline WHERE feature_id = ?', featureId).map((r) => this.map(r)).sort(byVersion);
  }
  all(): BaselineRecord[] {
    return this.db.all('SELECT * FROM baseline ORDER BY baseline_id').map((r) => this.map(r));
  }
  missingHash(): BaselineRecord[] {
    return this.db.all('SELECT * FROM baseline WHERE content_hash IS NULL').map((r) => this.map(r));
  }
  setHash(baselineId: string, hash: string) {
    this.db.run('UPDATE baseline SET content_hash = ? WHERE baseline_id = ?', hash, baselineId);
  }
  /** Lifecycle만 갱신 (Baseline은 Lifecycle을 제외하고 불변) */
  setLifecycle(baselineId: string, snapshot: BomItemRow) {
    this.db.run('UPDATE baseline SET doc = ? WHERE baseline_id = ?', JSON.stringify(snapshot), baselineId);
  }
  insert(b: BaselineRecord) {
    this.db.run(
      'INSERT INTO baseline (baseline_id, feature_id, version, content_hash, doc, approved_by, approved_at, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      b.baselineId,
      b.featureId,
      b.version,
      b.contentHash,
      JSON.stringify(b.snapshot),
      b.approvedBy,
      b.approvedAt,
      b.requestId,
    );
  }
  nextId(): string {
    const r = this.db.get<{ m: number | null }>("SELECT max(CAST(substr(baseline_id, 4) AS INTEGER)) AS m FROM baseline");
    return `BL-${pad((r?.m ?? 0) + 1, 5)}`;
  }

  // 확정 승인 요청
  private mapReq(r: any): BaselineRequest {
    return {
      requestId: r.request_id,
      featureId: r.feature_id,
      version: r.version,
      status: r.status,
      requestedBy: r.requested_by,
      requestedAt: r.requested_at,
      reason: r.reason,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
      decisionReason: r.decision_reason,
      baselineId: r.baseline_id,
    };
  }
  request(id: string): BaselineRequest | undefined {
    const r = this.db.get('SELECT * FROM baseline_request WHERE request_id = ?', id);
    return r ? this.mapReq(r) : undefined;
  }
  requests(status?: BaselineRequest['status']): BaselineRequest[] {
    const rows = status
      ? this.db.all('SELECT * FROM baseline_request WHERE status = ? ORDER BY requested_at DESC, request_id DESC', status)
      : this.db.all('SELECT * FROM baseline_request ORDER BY requested_at DESC, request_id DESC');
    return rows.map((r) => this.mapReq(r));
  }
  pendingFor(featureId: string, version: string): BaselineRequest | undefined {
    const r = this.db.get("SELECT * FROM baseline_request WHERE feature_id = ? AND version = ? AND status = 'PENDING'", featureId, version);
    return r ? this.mapReq(r) : undefined;
  }
  insertRequest(q: BaselineRequest) {
    this.db.run(
      'INSERT INTO baseline_request (request_id, feature_id, version, status, requested_by, requested_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
      q.requestId,
      q.featureId,
      q.version,
      q.status,
      q.requestedBy,
      q.requestedAt,
      q.reason,
    );
  }
  decide(q: BaselineRequest) {
    this.db.run(
      'UPDATE baseline_request SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ?, baseline_id = ? WHERE request_id = ?',
      q.status,
      q.decidedBy,
      q.decidedAt,
      q.decisionReason,
      q.baselineId,
      q.requestId,
    );
  }
  nextRequestId(): string {
    const r = this.db.get<{ m: number | null }>("SELECT max(CAST(substr(request_id, 4) AS INTEGER)) AS m FROM baseline_request");
    return `BR-${pad((r?.m ?? 0) + 1, 5)}`;
  }
}

export interface ProductMeta {
  createdBy: string | null;
  configApprovedBy: string | null;
  releaseApprovedBy: string | null;
}

@Injectable()
export class ProductRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  get(catalogId: string, version: string): ProductRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM product WHERE catalog_id = ? AND version = ?', catalogId, version);
    return r ? JSON.parse(r.doc) : undefined;
  }
  versions(catalogId: string): ProductRow[] {
    return parse<ProductRow>(this.db.all('SELECT doc FROM product WHERE catalog_id = ?', catalogId)).sort(byVersion);
  }
  meta(catalogId: string, version: string): ProductMeta {
    const r = this.db.get<any>('SELECT created_by, config_approved_by, release_approved_by FROM product WHERE catalog_id = ? AND version = ?', catalogId, version);
    return { createdBy: r?.created_by ?? null, configApprovedBy: r?.config_approved_by ?? null, releaseApprovedBy: r?.release_approved_by ?? null };
  }
  insert(p: ProductRow, createdBy: string, createdAt: string) {
    this.db.run(
      'INSERT INTO product (catalog_id, version, lifecycle, doc, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      p.catalogId,
      p.version,
      p.lifecycle,
      JSON.stringify(p),
      createdBy,
      createdAt,
    );
  }
  update(p: ProductRow) {
    this.db.run('UPDATE product SET lifecycle = ?, doc = ? WHERE catalog_id = ? AND version = ?', p.lifecycle, JSON.stringify(p), p.catalogId, p.version);
  }
  setApprover(catalogId: string, version: string, kind: 'CONFIG' | 'RELEASE', actorId: string) {
    this.db.run(`UPDATE product SET ${kind === 'CONFIG' ? 'config_approved_by' : 'release_approved_by'} = ? WHERE catalog_id = ? AND version = ?`, actorId, catalogId, version);
  }
  nextCatalogId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(catalog_id, 5) AS INTEGER)) AS m FROM product');
    return `CAT-${pad((r?.m ?? 0) + 1, 5)}`;
  }
  all(): ProductRow[] {
    return parse<ProductRow>(this.db.all('SELECT doc FROM product ORDER BY catalog_id')).sort((a, b) => a.catalogId.localeCompare(b.catalogId) || byVersion(a, b));
  }
  /** 이 Baseline을 구성에 쓰는 상품 Version (역추적 — FK 아님) */
  usingBaseline(baselineId: string): ProductRow[] {
    return this.all().filter((p) => p.baselineIds.includes(baselineId));
  }
}
