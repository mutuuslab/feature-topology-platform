// contracts 입구 — 백엔드·도구·시험. 보고서 규칙 카탈로그를 바로 설치한다(화면은 web.ts).
export * from './core';
export { flagAdoptionCounts, type AdoptionMetricState } from './rules/adoption-metrics';
export * from './rules/report-catalog-installed';
export * from './schemas/lake';
export * from './schemas/ads-config-fixture';
export * from './schemas/ads-evidence-fixture';
export * from './schemas/ads-state-fixture';
export * from './schemas/ads-change-fixture';
// ADS 화면 규칙 — 첫 화면 묶음(web.ts)에서 빼고 화면은 파일에서 직접 읽는다(contracts/src/rules/ads-*.ts)
export * from './rules/ads-config';
export * from './rules/ads-evidence';
export * from './rules/ads-state';
export * from './rules/ads-change';
// 런타임 OpenAPI 명세 — 서버만(화면 묶음 제외)
export * from './rules/openapi-doc';
// Feature 관계 유형·추적 연결(P3) — 화면은 파일에서 직접 읽는다
export * from './rules/relation-types';
export * from './schemas/trace-link';
export * from './rules/trace-link';
export * from './rules/ads-p5';
// Lifecycle·Gate 보강(P10) — Go/No-Go·N/A·자동 검사·반려·즉시 폐기·Baseline 비교·출시 후보 통합 스냅샷
export * from './rules/gate-outcome';
export * from './rules/gate-checks';
export * from './rules/feature-retire';
export * from './rules/baseline-p10';
export * from './rules/policy-stage';
export * from './schemas/supplier';
// 기존 core.CheckResult와 이름을 구분한다. 협력사 전용 판정은 SupplierCheckResult로 공개한다.
export { SUPPLIER_ARTIFACT_LABEL, SUPPLIER_CRITERION_LABEL, REQUIRED_SUPPLIER_ARTIFACTS, CHECKSUM_FORMAT, SCOPE_RELATION_LABEL, CONTRACT_GAP_LABEL, latestArtifacts, missingArtifacts, packagingQuality, evaluateCriterion, acceptanceCheck, semverGreater, supplierOfSw, supplierScope, evidenceStatus, contractGaps, supplierContactsFor } from './rules/supplier';
export type { SupplierSwc, SupplierMappingRow, ArtifactIntegrity, SupplierArtifactRow, SupplierPackageRow, SupplierCriteriaRow, SupplierReviewRow, SupplierContact, SupplierDirectoryEntry, CheckResult as SupplierCheckResult, QualityCheck, FeatureScopeInput, CriterionResult, AcceptanceVerdict, AcceptanceCheck, ScopeRelation, EvidenceStatus, ContractGapKind, ScopeSw, SupplierScopeEntry, ContractGapRow } from './rules/supplier';
// 분류 계층 L0~L5·적용 지역 코드·브랜드(TX, B7 (b)) — 화면은 파일에서 직접 읽는다
export * from './schemas/taxonomy-tree';
export * from './rules/taxonomy-tree';
export * from './rules/region-code';
export * from './schemas/global-scope';
export * from './rules/global-scope';

export * from './schemas/vehicle-message';

export * from './schemas/vehicle-message.vectors';

export * from './rules/ota-reconcile';

export * from './rules/policy-cache';
