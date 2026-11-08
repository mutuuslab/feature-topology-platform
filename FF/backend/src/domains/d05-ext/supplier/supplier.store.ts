import type { SupplierArtifactRow, SupplierCriteriaRow, SupplierMappingRow, SupplierPackageRow, SupplierReviewRow } from '@ff/contracts';
import type { Db } from '../../../kernel/db';

const parse = <T>(rows: { doc: string }[]): T[] => rows.map((r) => JSON.parse(r.doc) as T);
/** DB 접근만 담당한다. 산출물·기준·검수는 추가만, 패키지는 서비스의 전이 규칙을 거쳐 갱신한다. */
export class SupplierStore {
  constructor(readonly db: Db) {}
  next(table: 'supplier_mapping' | 'supplier_package' | 'supplier_artifact' | 'supplier_criteria' | 'supplier_review', column: string, prefix: string) {
    const n = this.db.get<{ n: number | null }>(`SELECT max(CAST(substr(${column}, ${prefix.length + 1}) AS INTEGER)) AS n FROM ${table}`)?.n ?? 0;
    return prefix + String(n + 1).padStart(5, '0');
  }
  mappings(featureId?: string): SupplierMappingRow[] {
    return parse(this.db.all(`SELECT doc FROM supplier_mapping ${featureId ? 'WHERE feature_id = ?' : ''} ORDER BY map_id`, ...(featureId ? [featureId] : [])));
  }
  mapping(id: string) { return this.mappings().find((m) => m.mapId === id); }
  putMapping(m: SupplierMappingRow, insert = false) {
    if (insert) this.db.run('INSERT INTO supplier_mapping (map_id, feature_id, supplier, function_id, doc) VALUES (?, ?, ?, ?, ?)', m.mapId, m.featureId, m.supplier, m.supplierFunctionId, JSON.stringify(m));
    else this.db.run('UPDATE supplier_mapping SET doc = ? WHERE map_id = ?', JSON.stringify(m), m.mapId);
  }
  packages(featureId?: string): SupplierPackageRow[] {
    return parse(this.db.all(`SELECT doc FROM supplier_package ${featureId ? 'WHERE feature_id = ?' : ''} ORDER BY package_id`, ...(featureId ? [featureId] : [])));
  }
  package(id: string): SupplierPackageRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM supplier_package WHERE package_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  putPackage(p: SupplierPackageRow, insert = false) {
    if (insert) this.db.run('INSERT INTO supplier_package (package_id, feature_id, feature_version, supplier, version, status, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', p.packageId, p.featureId, p.featureVersion, p.supplier, p.version, p.status, JSON.stringify(p));
    else this.db.run('UPDATE supplier_package SET status = ?, doc = ? WHERE package_id = ?', p.status, JSON.stringify(p), p.packageId);
  }
  artifacts(packageId: string): SupplierArtifactRow[] { return parse(this.db.all('SELECT doc FROM supplier_artifact WHERE package_id = ? ORDER BY record_id', packageId)); }
  artifact(id: string): SupplierArtifactRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM supplier_artifact WHERE record_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  addArtifact(a: SupplierArtifactRow) { this.db.run('INSERT INTO supplier_artifact (record_id, package_id, type, submitted_at, doc) VALUES (?, ?, ?, ?, ?)', a.recordId, a.packageId, a.type, a.submittedAt, JSON.stringify(a)); }
  criteria(featureId: string): SupplierCriteriaRow[] { return parse(this.db.all('SELECT doc FROM supplier_criteria WHERE feature_id = ? ORDER BY revision', featureId)); }
  addCriteria(c: SupplierCriteriaRow) { this.db.run('INSERT INTO supplier_criteria (criteria_id, feature_id, revision, doc) VALUES (?, ?, ?, ?)', c.criteriaId, c.featureId, c.revision, JSON.stringify(c)); }
  reviews(packageId: string): SupplierReviewRow[] { return parse(this.db.all('SELECT doc FROM supplier_review WHERE package_id = ? ORDER BY review_id', packageId)); }
  addReview(r: SupplierReviewRow) { this.db.run('INSERT INTO supplier_review (review_id, package_id, doc) VALUES (?, ?, ?)', r.reviewId, r.packageId, JSON.stringify(r)); }
}
