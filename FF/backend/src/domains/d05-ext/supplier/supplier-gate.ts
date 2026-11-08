// D01 Gate와 D05 검수가 같은 DB 사실을 읽는다. 모듈 순환/클라이언트 PASS/이전 Feature Version 승인을 사용하지 않는다.
import { acceptanceCheck, latestArtifacts, SUPPLIER_ARTIFACT_TYPES, SubmitSupplierArtifactBody, type FeatureVersionRow, type SupplierArtifactRow, type SupplierPackageRow, type SwMasterRow } from '@ff/contracts';
import type { Db } from '../../../kernel/db';
import { verifyArtifact } from './supplier-proof';
import { SupplierStore } from './supplier.store';

const KEYS: (keyof SubmitSupplierArtifactBody)[] = ['type', 'version', 'title', 'uri', 'checksum', 'text', 'apiFormat', 'mappingIds', 'capability', 'variants', 'diagnostics', 'safety', 'testEvidence', 'releaseNote'];
export function checkedArtifacts(store: SupplierStore, pkg: SupplierPackageRow): SupplierArtifactRow[] {
  return store.artifacts(pkg.packageId).map((a) => {
    const parsed = SubmitSupplierArtifactBody.safeParse(Object.fromEntries(KEYS.map((k) => [k, a[k]])));
    return { ...a, integrity: parsed.success ? verifyArtifact(pkg, parsed.data).integrity : 'MISMATCH' };
  });
}
export function supplierPackageCheck(store: SupplierStore, pkg: SupplierPackageRow, f: FeatureVersionRow) {
  const criteria = store.criteria(f.featureId).at(-1) ?? null;
  const versions = store.db.all<{ version: string }>('SELECT version FROM feature_version WHERE feature_id = ?', f.featureId).map((r) => r.version);
  return acceptanceCheck({ pkg, latest: latestArtifacts(checkedArtifacts(store, pkg)), criteria, feature: f, featureVersions: versions, activeMappingIds: store.mappings(f.featureId).filter((m) => m.supplier === pkg.supplier && m.status === 'ACTIVE').map((m) => m.mapId) });
}
/** 정확히 Internal/OEM인 SW만 내부 개발이다. Internal/Tier1-* 혼합 공급사는 외부 검수가 필요하다. */
export function supplierGateFacts(db: Db, f: FeatureVersionRow) {
  const store = new SupplierStore(db);
  const sw = db.all<{ doc: string }>('SELECT doc FROM sw_master').map((r) => JSON.parse(r.doc) as SwMasterRow);
  const suppliers = new Set<string>();
  const internal = new Set(['Internal', 'OEM']);
  f.swIds.forEach((id, i) => {
    const rows = sw.filter((s) => s.swId === id && s.version === f.swVersions[i]);
    if (!rows.length) suppliers.add(`공급사 미확인(${id}@${f.swVersions[i] ?? '?'})`);
    for (const s of rows) if (!internal.has(s.supplier)) suppliers.add(s.supplier || `공급사 미확인(${id})`);
  });
  const packages = store.packages(f.featureId).filter((p) => p.featureVersion === f.version);
  for (const p of packages) suppliers.add(p.supplier);
  // SW가 없는 외부 기능은 대상 Version에 생성한 패키지로 범위를 명시한다. 다른 Version의 매핑을 현재 범위로 확대하지 않는다.
  const blockers: string[] = [];
  const accepted: string[] = [];
  for (const supplier of suppliers) {
    const valid = packages.filter((p) => p.supplier === supplier && p.status === 'ACCEPTED').find((p) => {
      const check = supplierPackageCheck(store, p, f);
      const review = store.reviews(p.packageId).at(-1);
      return check.verdict === 'MET' && !!review && review.decision === 'ACCEPT' && review.criteriaRevision === check.criteriaRevision && review.reviewedBy !== p.submittedBy && SUPPLIER_ARTIFACT_TYPES.every((t) => review.items.some((i) => i.type === t && i.result === 'PASS'));
    });
    if (valid) accepted.push(valid.packageId);
    else blockers.push(`${supplier}: 이 Feature Version의 검증된 10항목·현재 기준·분리 검수 합격 패키지가 없습니다`);
  }
  return { applicable: suppliers.size > 0, suppliers: [...suppliers], accepted, blockers };
}
